// Place editor used for: adding (staff), editing (staff), suggesting (public),
// suggesting a fix (public) and reviewing a suggestion (staff).
import { useEffect, useReducer, useRef, useState } from 'react';
import { SECTORS, SECTOR_IDS, TYPES, STATUS_LABELS, subcityCode, isTypeActive } from '../shared/catalog.js';
import { parseCoords, formatLatLon, formatHemi, formatDistance } from '../shared/coords.js';
import { Icon, toast, shrinkImage } from '../lib/util.js';
import { api } from '../lib/api.js';
import { S, data, actions, can, subName, nearestSub, SUBCITY_IDS, upsertLocal, removeLocal, emit, loadEditorData, openModal } from '../lib/store.js';
import { ModalHead, Field, useScrollToError, ConfirmButton } from './common.jsx';

const TITLES = { add: 'Add a place', edit: 'Edit place', suggest: 'Suggest a place', fix: 'Suggest a correction', review: 'Review suggestion' };

export function blankDraft() {
  return {
    mode: can('places.create') ? 'add' : 'suggest', id: '', placeId: '', suggId: '',
    name: '', sector: SECTOR_IDS.includes('tourism') ? 'tourism' : SECTOR_IDS[0], type: '', subcity_id: S.me?.subcity_id ?? '', woreda: '', kebele: '',
    coords: '', accuracy_m: null, coord_source: '', description: '', phone: '', hours: '', website: '',
    fee: '', best_time: '', parking: '', status: 'pending', active: true, verified: false,
    contact_name: '', contact_phone: '', photo: null, photos: [], suggPhoto: null, usePhoto: true,
    accuracy_note: '', gps_original: null, photo_consent: false, target: can('places.review') ? 'verified' : 'submitted', hp: '',
  };
}

export function draftFromPlace(p, mode) {
  return {
    ...blankDraft(), mode, id: mode === 'edit' ? p.id : '', placeId: p.id,
    name: p.name, sector: p.sector, type: p.type, subcity_id: String(p.subcity_id), woreda: p.woreda, kebele: p.kebele,
    coords: formatLatLon(p.lat, p.lon), accuracy_m: p.accuracy_m, coord_source: p.coord_source,
    description: p.description, phone: p.phone, hours: p.hours, website: p.website, fee: p.fee, best_time: p.best_time, parking: p.parking,
    status: p.status, active: p.active, verified: p.verified, photos: p.photos || [], workflow_note: p.workflow_note || '',
  };
}

export function draftFromSuggestion(s) {
  const d = s.data || {};
  const base = s.place_id ? data.byId.get(s.place_id) : null;
  return {
    ...(base ? draftFromPlace(base, 'review') : blankDraft()), mode: 'review', suggId: s.id, placeId: s.place_id || '',
    ...Object.fromEntries(Object.entries(d).filter(([k]) => !['lat', 'lon'].includes(k))),
    subcity_id: d.subcity_id ?? (base ? String(base.subcity_id) : ''), coords: formatLatLon(s.lat, s.lon), accuracy_m: s.accuracy_m,
    status: base ? base.status : 'reviewed', suggPhoto: s.photo, usePhoto: true, contact_name: s.contact_name, contact_phone: s.contact_phone,
  };
}

/** Feedback under the coordinates box: hemisphere form, swapped numbers, distance to the sub-city centre. */
function CoordFeedback({ d }) {
  const r = parseCoords(d.coords);
  if (!r) return <div className="cfb" id="cfb" />;
  if (r.error) return <div className="cfb bad" id="cfb">{r.error}</div>;
  const ns = nearestSub(r.lat, r.lon);
  const parts = [formatHemi(r.lat, r.lon)];
  if (r.swapped) parts.push('latitude and longitude were swapped, fixed');
  if (d.accuracy_m) parts.push('±' + Math.round(d.accuracy_m) + ' m');
  if (ns) parts.push(formatDistance(ns.d) + ' from the ' + subName(ns.id) + ' centre');
  return (
    <div className={'cfb ' + (r.inRegion ? 'ok' : 'warn')} id="cfb">{parts.join(' · ')}{r.inRegion ? null : <><br />This point is outside the Shaggar area. Check the numbers.</>}
      {' · '}<a href={`https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lon}`} target="_blank" rel="noopener">check in Google Maps</a></div>
  );
}

/* ---------- live GPS capture: keep reading until the fix is precise ---------- */
function useGps(d, onUse) {
  const [gps, setGps] = useState(null); // null | { wait: true } | { lat, lon, acc }
  const watch = useRef(null), timer = useRef(null), best = useRef(null);
  const stop = () => { if (watch.current !== null) navigator.geolocation.clearWatch(watch.current); watch.current = null; clearTimeout(timer.current); };
  useEffect(() => stop, []);
  const use = () => {
    const b = best.current; if (!b) return;
    stop(); setGps(null);
    onUse(b);
  };
  const start = () => {
    if (!('geolocation' in navigator)) { toast('This browser cannot share location. Paste coordinates instead.', 'bad'); return; }
    if (!window.isSecureContext) { toast('GPS needs the site to be opened over https.', 'bad'); return; }
    stop(); best.current = null; setGps({ wait: true });
    const t0 = Date.now();
    watch.current = navigator.geolocation.watchPosition((pos) => {
      const { latitude: lat, longitude: lon, accuracy: acc } = pos.coords;
      if (!best.current || acc <= best.current.acc) best.current = { lat, lon, acc };
      setGps({ ...best.current });
      if (best.current.acc <= Math.min(8, S.config?.settings?.['gps.good_accuracy_m'] || 10) && Date.now() - t0 > 3000) use();
    }, (err) => {
      stop(); setGps(null);
      toast(err.code === 1 ? 'Location permission was denied. Allow it in your browser settings.' : 'Could not get a GPS fix. Try outdoors or pick on the map.', 'bad');
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
    timer.current = setTimeout(() => { if (best.current) setGps({ ...best.current }); }, 30000);
  };
  return { gps, start, use, cancel: () => { stop(); setGps(null); }, stop };
}

function GpsLive({ gps, onUse, onCancel }) {
  if (!gps) return <div id="gpsLive" hidden />;
  if (gps.wait) return <div id="gpsLive"><div className="gpslive"><span className="label">Acquiring satellites…</span><div className="meter"><i style={{ width: '8%' }} /></div></div></div>;
  const a = gps.acc, pct = Math.max(6, Math.min(100, 100 - (a - 5) * 2));
  const good = S.config?.settings?.['gps.good_accuracy_m'] || 10, max = S.config?.settings?.['gps.max_accuracy_m'] || 20;
  return (
    <div id="gpsLive"><div className="gpslive"><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: 10 }}>
      <div><span className="label">Accuracy</span><div className="acc">±{Math.round(a)} m</div></div>
      <span className="mono" style={{ color: 'var(--cyan)', fontSize: 13 }}>{formatLatLon(gps.lat, gps.lon)}</span></div>
      <div className="meter"><i style={{ width: pct + '%' }} /></div>
      <p className="help">{a <= good ? 'Excellent fix.' : a <= max ? 'Good. Waiting a little longer can improve it.' : 'Weak signal. Move outdoors, away from tall buildings and trees, or retry. You will be asked why if you keep this reading.'}</p>
      <div style={{ display: 'flex', gap: 8 }}><button type="button" className="btn sm" onClick={onCancel}>Cancel</button><button type="button" className="btn sm primary" onClick={onUse}><Icon n="check" />Use ±{Math.round(a)} m</button></div></div></div>
  );
}

function Editor({ draft }) {
  const d = draft;
  const [, force] = useReducer((x) => x + 1, 0);
  const [errors, setErrors] = useState({});
  const [formErr, setFormErr] = useState('');
  const [dups, setDups] = useState(null);
  const [saving, setSaving] = useState(''); // '' | 'save' | 'submit'
  const [showAccNote, setShowAccNote] = useState(null);
  const formRef = useScrollToError(errors, formErr);
  const dupRef = useRef(null);
  const staff = ['add', 'edit', 'review'].includes(d.mode), pub = d.mode === 'suggest' || d.mode === 'fix';
  if (!d.type || !TYPES[d.sector]?.[d.type]) d.type = Object.keys(TYPES[d.sector] || {}).find((k) => isTypeActive(d.sector, k)) || '';
  const maxAcc = S.config?.settings?.['gps.max_accuracy_m'] || 20;
  const weak = d.coord_source === 'gps' && d.accuracy_m > maxAcc;
  const tourism = d.sector === 'tourism';

  const set = (k, v) => {
    d[k] = v;
    if (errors[k]) { const e = { ...errors }; delete e[k]; setErrors(e); }
    force();
  };
  const bind = (k) => ({ value: d[k] ?? '', onChange: (e) => set(k, e.target.value) });
  const setCoords = (v) => {
    d.accuracy_m = null; d.coord_source = 'typed';
    set('coords', v);
    autoSub();
  };
  const autoSub = () => {
    const r = parseCoords(d.coords);
    if (r && !r.error && (d.subcity_id === '' || d.subcity_id === null || d.subcity_id === undefined)) { const ns = nearestSub(r.lat, r.lon); if (ns) { d.subcity_id = String(ns.id); force(); } }
  };
  useEffect(() => { autoSub(); }, []);

  const gpsCtl = useGps(d, (b) => {
    d.coords = formatLatLon(b.lat, b.lon); d.accuracy_m = b.acc; d.coord_source = 'gps';
    d.gps_original = { lat: +b.lat.toFixed(6), lon: +b.lon.toFixed(6), accuracy_m: Math.round(b.acc * 10) / 10 };
    setShowAccNote(b.acc > maxAcc);
    autoSub(); force();
    toast('GPS location saved, ±' + Math.round(b.acc) + ' m');
  });

  const close = () => { gpsCtl.stop(); S.draft = null; actions.closeModal(); };
  const pickOnMap = () => {
    gpsCtl.stop();
    const r = parseCoords(d.coords);
    actions.startPick({
      initial: r && !r.error ? [r.lat, r.lon] : null,
      title: 'Move the map until the crosshair is on the entrance',
      onUse: (lat, lon) => {
        // Keep the original GPS reading as evidence when the pin is adjusted by hand (spec 6.1 step 4).
        if (d.coord_source === 'gps' && d.accuracy_m != null && !d.gps_original) { const r0 = parseCoords(d.coords); if (r0 && !r0.error) d.gps_original = { lat: r0.lat, lon: r0.lon, accuracy_m: d.accuracy_m }; }
        d.coords = formatLatLon(lat, lon); d.accuracy_m = null; d.coord_source = 'map';
        const ns = nearestSub(lat, lon); if (ns && !d.subcity_id) d.subcity_id = String(ns.id);
        openEditor(d);
      },
      onCancel: () => openEditor(d),
    });
  };
  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    toast('Preparing photo…');
    shrinkImage(f).then((url) => { d.photo = url; force(); }).catch((x) => toast(x.message, 'bad'));
  };
  const delPhoto = async (id) => {
    try { const p = await api.deletePhoto(id); d.photos = p.photos; upsertLocal(p); toast('Photo deleted'); emit(); force(); }
    catch (e) { toast(e.message, 'bad'); }
  };
  const del = async () => {
    try { await api.deletePlace(d.id); removeLocal(d.id); S.sel = null; S.draft = null; actions.closeModal(); toast('Place deleted'); emit(); }
    catch (e) { toast(e.message, 'bad'); }
  };

  async function save(submit) {
    // Check locally first so people get instant, specific feedback.
    const local = {};
    if (!String(d.name).trim()) local.name = 'Enter the place name.';
    if (!d.type) local.type = 'Choose the category.';
    const c = parseCoords(d.coords);
    if (!c) local.coords = 'Add the GPS coordinates: use your GPS, pick on the map, or paste them.';
    else if (c.error) local.coords = c.error;
    if (d.mode !== 'suggest' && d.mode !== 'fix' && (d.subcity_id === '' || d.subcity_id === null || d.subcity_id === undefined)) local.subcity_id = 'Choose the sub-city.';
    if (Object.keys(local).length) { setErrors(local); setFormErr('Some fields need attention.'); return; }

    const body = {
      name: d.name, sector: d.sector, type: d.type, woreda: d.woreda, kebele: d.kebele,
      coords: d.coords, accuracy_m: d.accuracy_m, coord_source: d.coord_source || 'typed',
      description: d.description, phone: d.phone, hours: d.hours, website: d.website,
      fee: d.fee || '', best_time: d.best_time || '', parking: d.parking || '',
    };
    if (d.subcity_id !== '' && d.subcity_id !== null && d.subcity_id !== undefined) body.subcity_id = Number(d.subcity_id);
    setSaving(submit ? 'submit' : 'save');
    try {
      if (pub) {
        Object.assign(body, { place_id: d.placeId || undefined, contact_name: d.contact_name, contact_phone: d.contact_phone, hp: d.hp || '', photo_consent: !!d.photo_consent });
        if (d.photo) body.photo = d.photo;
        await api.suggest(body);
        S.draft = null; actions.closeModal();
        toast('Thank you. Sent to the Bureau for review.');
        return;
      }
      Object.assign(body, { active: !!d.active });
      if (can('places.review')) body.verified = !!d.verified;
      if (d.accuracy_note) body.accuracy_note = d.accuracy_note;
      if (d.gps_original) body.gps_original = d.gps_original;
      if (d.confirm_duplicate) body.confirm_duplicate = true;
      if (submit) body.submit = true;
      let place;
      if (d.mode === 'review') {
        place = await api.accept(d.suggId, { ...body, use_photo: d.usePhoto, status: d.target });
        if (d.photo) place = await api.updatePlace(place.id, { photo: d.photo });
        await loadEditorData();
      } else if (d.mode === 'edit') {
        const cur = data.byId.get(d.id);
        if (cur && Math.abs(cur.lat - c.lat) < 1e-7 && Math.abs(cur.lon - c.lon) < 1e-7) { delete body.coords; delete body.accuracy_m; delete body.coord_source; delete body.gps_original; }
        if (d.photo) body.photo = d.photo;
        place = await api.updatePlace(d.id, body);
      } else {
        if (d.photo) body.photo = d.photo;
        place = await api.createPlace(body);
      }
      upsertLocal(place);
      S.draft = null; actions.closeModal();
      toast(d.mode === 'review' ? `Suggestion accepted (${STATUS_LABELS[place.status]})` : submit ? 'Saved and sent for review' : d.mode === 'edit' ? 'Place saved' : 'Draft saved. Submit it when it is ready.');
      loadEditorData().catch(() => {});
      emit();
    } catch (e) {
      setSaving('');
      if (e.status === 409 && e.details?.duplicates) {
        setDups(e.details.duplicates);
        setTimeout(() => dupRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30);
        return;
      }
      if (e.details?.accuracy_note) setShowAccNote(true);
      setErrors(e.details || {});
      setFormErr(e.status === 401 ? 'Your session ended. Sign in again from the Admin tab.' : e.message);
    }
  }

  const typeOpts = Object.entries(TYPES[d.sector] || {}).filter(([k]) => isTypeActive(d.sector, k) || k === d.type);
  const sectors = SECTOR_IDS.concat(SECTOR_IDS.includes(d.sector) ? [] : [d.sector]);
  const canSubmitStep = (d.mode === 'add' || ['draft', 'needs_correction'].includes(d.status)) && can('places.submit');
  const accHidden = showAccNote === null ? !(weak || d.accuracy_note) : !showAccNote;
  return (
    <>
      <ModalHead title={TITLES[d.mode]} onClose={close} />
      <div className="mbody"><form className="form" id="edForm" noValidate ref={formRef} onSubmit={(e) => e.preventDefault()}>
        {pub ? <div className="info">The city Bureau checks every suggestion before it appears on the public map.</div> : null}
        {d.mode === 'review' && d.placeId ? <div className="info">This is a correction to <b>{data.byId.get(d.placeId)?.name || 'an existing place'}</b>. Saving updates that place.</div> : null}
        {d.mode === 'edit' && d.workflow_note && d.status === 'needs_correction' ? <div className="notice"><b>Reviewer note:</b> {d.workflow_note}</div> : null}
        <div id="dupBox" ref={dupRef}>{dups ? (
          <div className="notice"><b>This may already be in the directory:</b>{dups.map((x) => <div key={x.id} style={{ marginTop: 6 }}>{x.name} <span className="help">· {x.distance_m} m away · {STATUS_LABELS[x.status] || x.status}</span></div>)}
            <button type="button" className="btn sm" style={{ marginTop: 10 }} onClick={() => { d.confirm_duplicate = true; setDups(null); toast('Tap Save again to confirm.'); }}>It is a different place, save anyway</button></div>
        ) : null}</div>
        <Field k="name" label="Name" error={errors.name}><input id="ed-name" maxLength={120} autoComplete="off" placeholder="e.g. Sebeta General Hospital" {...bind('name')} /></Field>
        <div className="two">
          <Field k="sector" label="Sector" error={errors.sector}><select id="ed-sector" value={d.sector} onChange={(e) => { d.sector = e.target.value; d.type = Object.keys(TYPES[d.sector] || {}).find((k) => isTypeActive(d.sector, k)) || ''; force(); }}>
            {sectors.map((k) => <option key={k} value={k}>{SECTORS[k]?.label || k}</option>)}</select></Field>
          <Field k="type" label="Type" error={errors.type}><select id="ed-type" {...bind('type')}>{typeOpts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        </div>

        <div className="gpsbox">
          <Field k="coords" label="GPS coordinates · latitude, longitude" error={errors.coords}><input id="ed-coords" inputMode="text" autoComplete="off" spellCheck="false" placeholder="9.012345, 38.745678" value={d.coords} onChange={(e) => setCoords(e.target.value)} /></Field>
          <CoordFeedback d={d} />
          <GpsLive gps={gpsCtl.gps} onUse={gpsCtl.use} onCancel={gpsCtl.cancel} />
          {staff ? <div data-f="accuracy_note" className={'f' + (errors.accuracy_note ? ' invalid' : '')} hidden={accHidden} id="accNote"><span>Why is the accuracy above ±{maxAcc} m?</span>
            <input id="ed-accuracy_note" maxLength={500} placeholder="Dense trees at the gate; pin checked on satellite" {...bind('accuracy_note')} /><em className="ferr" hidden={!errors.accuracy_note}>{errors.accuracy_note}</em></div> : null}
          <div className="tools">
            <button type="button" className="btn sm" onClick={gpsCtl.start}><Icon n="locate" />Use my GPS</button>
            <button type="button" className="btn sm" onClick={pickOnMap}><Icon n="target" />Pick on map</button>
          </div>
          <p className="help">Standing at the place? Stand at the main public entrance, use your GPS outdoors and wait for ±{S.config?.settings?.['gps.good_accuracy_m'] || 10} m or better. You can also paste numbers or a Google Maps link: long-press the spot in Google Maps and copy the coordinates.</p>
        </div>

        <div className="two">
          <Field k="subcity_id" label="Subcity" error={errors.subcity_id}><select id="ed-subcity_id" value={String(d.subcity_id ?? '')} onChange={(e) => set('subcity_id', e.target.value)}><option value="">Choose…</option>
            {SUBCITY_IDS.map((id) => <option key={id} value={String(id)}>{subcityCode(id)} · {subName(id)}</option>)}</select></Field>
          <Field k="woreda" label="Woreda" error={errors.woreda}><input id="ed-woreda" maxLength={60} placeholder="Woreda 03" {...bind('woreda')} /></Field>
        </div>
        <Field k="kebele" label="Kebele, street or landmark" error={errors.kebele}><input id="ed-kebele" maxLength={80} {...bind('kebele')} /></Field>
        <Field k="description" label="Description" error={errors.description}><textarea id="ed-description" maxLength={2000} placeholder="What is here and what visitors should know" {...bind('description')} /></Field>
        <div className="two">
          <Field k="phone" label="Phone" error={errors.phone}><input id="ed-phone" type="tel" maxLength={40} placeholder="+251 …" {...bind('phone')} /></Field>
          <Field k="hours" label="Opening hours" error={errors.hours}><input id="ed-hours" maxLength={120} placeholder="Mon–Fri 08:30–17:00" {...bind('hours')} /></Field>
        </div>
        <Field k="website" label="Website" error={errors.website}><input id="ed-website" type="url" maxLength={200} placeholder="https://" {...bind('website')} /></Field>
        {tourism ? <>
          <div className="two"><Field k="fee" label="Entrance fee" error={errors.fee}><input id="ed-fee" maxLength={80} placeholder="ETB 100 per adult" {...bind('fee')} /></Field>
            <Field k="best_time" label="Best time to visit" error={errors.best_time}><input id="ed-best_time" maxLength={80} {...bind('best_time')} /></Field></div>
          <Field k="parking" label="Parking" error={errors.parking}><input id="ed-parking" maxLength={80} {...bind('parking')} /></Field>
        </> : null}

        <div className="f"><span>Photos</span><div className="photos" id="edPhotos">
          {(d.photos || []).map((ph) => <figure key={ph.id}><img src={ph.url} alt="" /><button type="button" onClick={() => delPhoto(ph.id)} aria-label="Delete photo"><Icon n="x" /></button></figure>)}
          {d.suggPhoto && d.usePhoto ? <figure><img src={d.suggPhoto} alt="Photo sent with the suggestion" /><button type="button" onClick={() => { d.usePhoto = false; force(); }} aria-label="Do not use this photo"><Icon n="x" /></button></figure> : null}
          {d.photo ? <figure><img src={d.photo} alt="New photo" /><button type="button" onClick={() => { d.photo = null; force(); }} aria-label="Remove new photo"><Icon n="x" /></button></figure> : null}
          <label className="btn sm"><Icon n="camera" />{d.photo ? 'Replace photo' : 'Add photo'}<input type="file" id="ed-file" accept="image/*" className="vh" onChange={onFile} /></label>
        </div><p className="help">Photos are resized on your phone before upload to save data.</p></div>

        {staff ? <>
          {d.mode === 'review' && !d.placeId ? <Field k="target" label="After accepting" error={errors.target}><select id="ed-target" {...bind('target')}>
            {[['submitted', 'Put it in the review queue'], ...(can('places.review') ? [['verified', 'I checked it: mark Verified']] : []), ...(can('places.publish') ? [['published', 'Publish now']] : [])].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field> : null}
          {d.mode === 'edit' ? <div className="info">Status: <b>{STATUS_LABELS[d.status] || d.status}</b>. Review and publishing steps are in Admin → Tasks and in the admin portal.</div> : null}
          <label className="check"><input type="checkbox" id="ed-active" checked={!!d.active} onChange={(e) => set('active', e.target.checked)} />Show in the app when published</label>
          {can('places.review') ? <label className="check"><input type="checkbox" id="ed-verified" checked={!!d.verified} onChange={(e) => set('verified', e.target.checked)} />Location checked on site by staff</label> : null}
        </> : null}
        {pub && d.photo ? <label className="check"><input type="checkbox" id="ed-photo_consent" checked={!!d.photo_consent} onChange={(e) => set('photo_consent', e.target.checked)} />I took this photo and allow the city to publish it</label> : null}
        {pub ? <>
          <div className="two"><Field k="contact_name" label="Your name (optional)" error={errors.contact_name}><input id="ed-contact_name" maxLength={80} autoComplete="name" {...bind('contact_name')} /></Field>
            <Field k="contact_phone" label="Your phone (optional)" error={errors.contact_phone}><input id="ed-contact_phone" type="tel" maxLength={40} autoComplete="tel" {...bind('contact_phone')} /></Field></div>
          <p className="help">Only Bureau staff see your contact details, in case they need to ask about the place.</p>
          <input type="text" id="ed-hp" name="hp" tabIndex={-1} autoComplete="off" className="vh" aria-hidden="true" {...bind('hp')} />
        </> : null}
        {d.mode === 'review' && (d.contact_name || d.contact_phone) ? <div className="info">Sent by {d.contact_name || 'a resident'} <span className="mono">{d.contact_phone}</span></div> : null}
        <p className="formerr" id="edErr" role="alert">{formErr}</p>
      </form></div>
      <div className="mfoot">
        {d.mode === 'edit' && can('places.delete') ? <ConfirmButton className="btn danger" style={{ flex: '0 0 auto' }} onConfirm={del} confirmLabel="Delete for good"><Icon n="trash" /></ConfirmButton> : null}
        <button type="button" className="btn" onClick={close}>Cancel</button>
        {pub ? <button type="button" className="btn primary" id="edSave" disabled={!!saving} onClick={() => save(false)}>{saving ? 'Saving…' : 'Send to Bureau'}</button>
          : d.mode === 'review' ? <button type="button" className="btn primary" id="edSave" disabled={!!saving} onClick={() => save(false)}>{saving ? 'Saving…' : 'Accept and save'}</button>
            : <>
              <button type="button" className={'btn' + (canSubmitStep ? '' : ' primary')} id="edSave" disabled={!!saving} onClick={() => save(false)}>{saving === 'save' ? 'Saving…' : d.mode === 'add' ? 'Save draft' : 'Save'}</button>
              {canSubmitStep ? <button type="button" className="btn primary" id="edSubmit" disabled={!!saving} onClick={() => save(true)}>{saving === 'submit' ? 'Saving…' : 'Save and submit'}</button> : null}
            </>}
      </div>
    </>
  );
}

export function openEditor(draft) {
  S.draft = draft;
  openModal(() => <Editor draft={draft} />, { onClose: null });
}
Object.assign(actions, { openEditor, draftFromPlace, draftFromSuggestion, blankDraft, closeEditor: () => { S.draft = null; actions.closeModal(); } });
