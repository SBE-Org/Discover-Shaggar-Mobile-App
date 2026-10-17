// Trips and events: list, editor with ordered stops, status changes with public updates, gallery and registrations.
import { useEffect, useState } from 'react';
import { TRIP_STATUSES, TRIP_STATUS_LABELS, TRIP_CATEGORIES, REGISTRATION_MODES, PHOTO_RIGHTS, subcityCode } from '../shared/catalog.js';
import { formatLatLon } from '../shared/coords.js';
import { shrinkImage } from '../lib/util.js';
import {
  A, api, toast, can, go, nav, subLabel, PageHead, Loading, Empty, Fld, Sel, Check, subcityOptions, val, useFormErrors, LangFields,
  openDialog, closeDialog, Dlg, confirmDlg, loadPlaces, relTime, fmtDateTime, BusyButton, useAsync, Notice, NavLink, Icon,
} from './core.jsx';

const TPill = ({ s }) => <span className={'pill st-' + s}>{TRIP_STATUS_LABELS[s] || s}</span>;
// datetime-local value in Ethiopia time (UTC+3), whatever the browser's zone.
const toLocal = (iso) => (iso ? new Date(new Date(iso).getTime() + 3 * 3600e3).toISOString().slice(0, 16) : '');
const fmtEt = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { timeZone: 'Africa/Addis_Ababa', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
let tTabSaved = 'upcoming';

export function TripsView({ id }) {
  if (id) return <TripEditor key={id} id={id === 'new' ? null : id} />;
  return <TripList />;
}

function TripList() {
  const [tab, setTabRaw] = useState(tTabSaved);
  const setTab = (t) => { tTabSaved = t; setTabRaw(t); };
  const q = useAsync(async () => {
    let items = (await api.trips({ scope: 'all', when: ['upcoming', 'past'].includes(tab) ? tab : '', status: tab === 'draft' ? 'draft' : '' })).items;
    if (tab === 'upcoming') items = items.filter((t) => t.status !== 'draft');
    return items;
  }, [tab]);
  let body;
  if (q.error) body = <Notice error={q.error} />;
  else if (!q.data) body = <Loading n={5} />;
  else if (!q.data.length) body = <div className="card"><Empty title="No trips here" text="Create a trip or event to show it in the app’s Trips tab." icon="calendar" /></div>;
  else body = <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Trip or event</th><th>When (Ethiopia time)</th><th>Status</th><th className="num">Registered</th><th>Registration</th><th></th></tr></thead><tbody>
    {q.data.map((t) => (
      <tr key={t.id}><td><NavLink className="rowlink" to={'trips/' + t.id}>{t.title}</NavLink><span className="sub">{TRIP_CATEGORIES[t.category] || ''} · {subLabel(t.subcity_id)}{t.featured ? ' · featured' : ''}</span></td>
        <td className="muted">{fmtEt(t.start_at)}{t.past ? <span className="sub">ended</span> : null}</td><td><TPill s={t.status} /></td>
        <td className="num">{t.registered}{t.capacity ? ' / ' + t.capacity : ''}{t.enquiries ? <span className="sub">{t.enquiries} enquiries</span> : null}</td>
        <td className="muted">{REGISTRATION_MODES[t.registration_mode]}</td><td><div className="acts"><button className="btn sm" onClick={() => nav('trips/' + t.id)}>Open</button></div></td></tr>
    ))}</tbody></table></div>;
  return (
    <>
      <PageHead title="Trips & events" sub="Guided trips, festivals and community events. Drafts are private until you schedule or open them."
        right={<><div className="seg" style={{ margin: 0 }}>{[['upcoming', 'Upcoming'], ['draft', 'Drafts'], ['past', 'Past'], ['all', 'All']].map(([k, l]) => <button key={k} aria-pressed={String(tab === k)} onClick={() => setTab(k)}>{l}</button>)}</div>
          <button className="btn primary" onClick={() => nav('trips/new')}><Icon n="plus" />New trip or event</button></>} />
      <div id="tlist">{body}</div>
    </>
  );
}

function TripEditor({ id }) {
  const [T, setT] = useState(null);
  const [state, setState] = useState('loading');
  const [error, setError] = useState(null);
  const [v, setV] = useState(0);
  const reload = (t) => { setT(t); setV((n) => n + 1); };
  useEffect(() => {
    (async () => {
      try { if (id) setT(await api.trip(id)); await loadPlaces().catch(() => []); setState('ready'); } catch (e) { setError(e); setState('error'); }
    })();
  }, [id]);
  if (state === 'loading') return <Loading n={6} />;
  if (state === 'error') return <Notice error={error} />;
  return <TripForm key={v} T={T} setT={setT} reload={reload} />;
}

function PlaceSelect({ id, cur, none = 'None', onChange }) {
  const list = (A.places || []).filter((p) => p.status === 'published' || p.id === cur).sort((a, b) => a.name.localeCompare(b.name));
  return <select id={id} defaultValue={cur || ''} onChange={onChange}><option value="">{none}</option>{list.map((p) => <option key={p.id} value={p.id}>{p.name} · {subcityCode(p.subcity_id)}</option>)}</select>;
}

let stopKey = 0;
const blankStop = () => ({ k: ++stopKey, place_id: '', title: '', coords: '', planned_time: '', notes: '' });

function Stops({ stops, setStops }) {
  // Inputs are uncontrolled; read their values before changing the list so nothing typed is lost.
  const read = () => stops.map((s) => ({ k: s.k, place_id: val('st-place-' + s.k) || '', title: val('st-title-' + s.k) || '', coords: val('st-coords-' + s.k) || '', planned_time: val('st-time-' + s.k) || '', notes: val('st-notes-' + s.k) || '' }));
  const change = (fn) => { const next = read(); fn(next); setStops([...next]); };
  return (
    <>
      <div className="stops" id="stopsBox">{stops.length ? stops.map((s, i) => (
        <div key={s.k} className="stopr"><span className="n">{i + 1}</span>
          <div style={{ display: 'grid', gap: 6 }}><PlaceSelect id={'st-place-' + s.k} cur={s.place_id} none="Not in the directory: type a name →" onChange={() => change(() => {})} />
            <input id={'st-title-' + s.k} defaultValue={s.title} placeholder="Stop name (if not in the directory)" hidden={!!s.place_id} /></div>
          <input id={'st-coords-' + s.k} defaultValue={s.coords} placeholder="Coordinates (optional)" className="mono" hidden={!!s.place_id} />
          <input id={'st-time-' + s.k} defaultValue={s.planned_time} placeholder="09:30" />
          <div className="acts"><button className="iconbtn sm" aria-label="Move up" disabled={!i} onClick={() => change((l) => { [l[i - 1], l[i]] = [l[i], l[i - 1]]; })}><Icon n="arrowup" /></button>
            <button className="iconbtn sm" aria-label="Move down" disabled={i >= stops.length - 1} onClick={() => change((l) => { [l[i + 1], l[i]] = [l[i], l[i + 1]]; })}><Icon n="arrowdown" /></button>
            <button className="iconbtn sm" aria-label="Remove stop" onClick={() => change((l) => { l.splice(i, 1); })}><Icon n="trash" /></button></div>
          <input id={'st-notes-' + s.k} defaultValue={s.notes} placeholder="Notes for this stop" style={{ gridColumn: '2/-1' }} /></div>
      )) : <p className="help">No stops yet. Add the places the trip visits, in order.</p>}</div>
      <button className="btn sm" style={{ marginTop: 10 }} onClick={() => change((l) => { l.push(blankStop()); })}><Icon n="plus" />Add stop</button>
    </>
  );
}

function TripForm({ T, setT, reload }) {
  const t = T || { category: 'nature', registration_mode: 'none', is_free: true, status: 'draft' };
  const f = useFormErrors();
  const [stops, setStops] = useState(() => (T?.stops || []).map((s) => ({ k: ++stopKey, place_id: s.place_id || '', title: s.place_id ? '' : s.title, coords: !s.place_id && s.lat != null ? formatLatLon(s.lat, s.lon) : '', planned_time: s.planned_time, notes: s.notes })));
  const [cover, setCover] = useState(null);
  const E = f.errors;
  const readStops = () => stops.map((s) => ({ place_id: val('st-place-' + s.k) || null, title: val('st-title-' + s.k) || '', coords: val('st-place-' + s.k) ? '' : val('st-coords-' + s.k) || '', planned_time: val('st-time-' + s.k) || '', notes: val('st-notes-' + s.k) || '' }));
  const collect = () => {
    const b = {};
    for (const k of ['title', 'title_om', 'title_am', 'description', 'description_om', 'description_am']) b[k] = val('t-' + k);
    for (const k of ['summary', 'category', 'language', 'start_at', 'end_at', 'duration_note', 'date_note', 'meeting_point', 'meeting_place_id', 'meeting_coords', 'organizer', 'contact_phone', 'contact_email', 'price', 'eligibility', 'includes', 'excludes', 'what_to_bring', 'accessibility', 'safety', 'cancellation_policy', 'registration_mode', 'capacity', 'registration_closes_at', 'recap']) {
      const x = val('t-' + k); if (x !== undefined) b[k] = x;
    }
    b.subcity_id = val('t-subcity_id');
    b.is_free = val('t-is_free');
    if (document.getElementById('t-featured')) b.featured = val('t-featured');
    b.stops = readStops();
    if (cover) b.cover = cover;
    return b;
  };
  const save = async () => {
    const body = collect();
    try {
      const saved = await (T ? api.updateTrip(T.id, body) : api.createTrip(body));
      toast(T ? 'Trip saved' : 'Draft created');
      if (!T) go('trips', saved.id, { replace: true }); else reload(saved);
    } catch (e) {
      const d = {}; for (const [k, x] of Object.entries(e.details || {})) d[k.startsWith('title') || k.startsWith('description') ? 't-' + k : k] = x;
      f.setErrors(d, e.message);
    }
  };
  const applyStatus = async () => {
    const s = val('t-newstatus');
    if (s === T.status) { toast('That is already the status.'); return; }
    let msg = '';
    if (['cancelled', 'postponed'].includes(s)) { msg = await confirmDlg(TRIP_STATUS_LABELS[s], 'Tell participants why and what happens next. The message is shown on the trip page.', { okLabel: 'Apply', note: 'Message to participants', danger: s === 'cancelled' }); if (msg === null) return; }
    else if (s !== 'draft' && T.status === 'draft' && (await confirmDlg('Make public', `Set the status to “${TRIP_STATUS_LABELS[s]}”? The trip will appear in the public app.`, { okLabel: 'Make public' })) === null) return;
    const r = await api.tripStatus(T.id, s, msg);
    toast(`Status: ${TRIP_STATUS_LABELS[s]}${r.to_notify && msg ? ` · ${r.to_notify} registrant(s) to contact (download the CSV)` : ''}`);
    reload(r);
  };
  const del = async () => {
    if ((await confirmDlg('Delete draft', 'Delete this draft for good?', { okLabel: 'Delete', danger: true })) === null) return;
    try { await api.deleteTrip(T.id); toast('Draft deleted'); go('trips'); } catch (e) { toast(e.message, 'bad'); }
  };
  const coverUrl = cover || T?.cover;
  const ta = (k, label, rows = 3) => <Fld k={k} label={label} errors={E}><textarea id={'t-' + k} defaultValue={t[k]} rows={rows} /></Fld>;
  const inp = (k, label, attrs = {}) => <Fld k={k} label={label} errors={E}><input id={'t-' + k} defaultValue={t[k] ?? ''} {...attrs} /></Fld>;
  return (
    <>
      <button className="crumb" onClick={() => nav('trips')}><Icon n="back" />All trips</button>
      <PageHead title={T ? T.title : 'New trip or event'} sub={T ? <><TPill s={T.status} /> {fmtEt(T.start_at)} · {T.registered}{T.capacity ? '/' + T.capacity : ''} registered</> : 'Saved as a draft. Nothing is public until you change the status.'} />
      <div className="split"><div id="tform" ref={f.ref}>
        <div className="card"><h3>Title and description</h3><div className="sect">
          <LangFields prefix="t-" rec={T || {}} fields={[['title', 'Title', 'input', { maxLength: 140 }], ['description', 'Full description', 'area', { rows: 6 }]]} errors={E} />
          {inp('summary', 'Short summary (shown on cards)', { maxLength: 300 })}
          <div className="fgrid3"><Fld k="category" label="Type" errors={E}><Sel id="t-category" opts={Object.entries(TRIP_CATEGORIES)} cur={t.category} /></Fld>
            <Fld k="subcity_id" label="Sub-city" errors={E}><Sel id="t-subcity_id" opts={subcityOptions(true)} cur={String(t.subcity_id ?? '')} /></Fld>
            {inp('language', 'Language(s)', { maxLength: 80, placeholder: 'Afaan Oromoo, English' })}</div>
          {can('content.manage') ? <Check id="t-featured" label="Feature on the Home screen" on={!!t.featured} /> : null}
        </div></div>
        <div className="card"><h3>Date, time and meeting point <span className="help">times are Ethiopia time (UTC+3)</span></h3><div className="sect">
          <div className="fgrid3"><Fld k="start_at" label="Starts" errors={E}><input id="t-start_at" type="datetime-local" defaultValue={toLocal(t.start_at)} /></Fld>
            <Fld k="end_at" label="Ends" errors={E}><input id="t-end_at" type="datetime-local" defaultValue={toLocal(t.end_at)} /></Fld>
            {inp('duration_note', 'Duration', { maxLength: 120, placeholder: 'About 5 hours, 8 km walk' })}</div>
          {inp('date_note', 'Date note', { maxLength: 160, placeholder: 'Date follows the Ethiopian calendar and may move by a day' })}
          <div className="fgrid">{inp('meeting_point', 'Meeting point', { maxLength: 240 })}
            <Fld k="meeting_place_id" label="Meeting place in the directory (optional)" errors={E}><PlaceSelect id="t-meeting_place_id" cur={t.meeting_place_id} /></Fld>
            <Fld k="meeting_coords" label="Meeting point coordinates (optional)" errors={E}><input id="t-meeting_coords" defaultValue={t.meeting_lat != null ? formatLatLon(t.meeting_lat, t.meeting_lon) : ''} className="mono" placeholder="9.01, 38.74" /></Fld></div>
        </div></div>
        <div className="card"><h3>Stops in order <span className="help">each stop can link to a place record</span></h3><Stops stops={stops} setStops={setStops} /></div>
        <div className="card"><h3>Practical details</h3><div className="sect">
          <div className="fgrid3">{inp('organizer', 'Organiser', { maxLength: 120 })}{inp('contact_phone', 'Contact phone', { maxLength: 40 })}{inp('contact_email', 'Contact email', { maxLength: 120 })}</div>
          <div className="fgrid3">{inp('price', 'Price', { maxLength: 120, placeholder: 'ETB 300 per person' })}
            <div className="f"><span>Cost</span><Check id="t-is_free" label="Free of charge" on={t.is_free !== false} /></div>
            {inp('eligibility', 'Who can join', { maxLength: 400, placeholder: 'Ages 12+, moderate fitness' })}</div>
          <div className="fgrid">{ta('includes', 'Included')}{ta('excludes', 'Not included')}{ta('what_to_bring', 'What to bring and wear')}{ta('accessibility', 'Accessibility')}{ta('safety', 'Safety guidance')}{ta('cancellation_policy', 'Cancellation and postponement policy')}</div>
        </div></div>
        <div className="card"><h3>Registration</h3><div className="sect"><div className="fgrid3">
          <Fld k="registration_mode" label="How people sign up" errors={E}><Sel id="t-registration_mode" opts={Object.entries(REGISTRATION_MODES)} cur={t.registration_mode} /></Fld>
          {inp('capacity', 'Capacity (people)', { type: 'number', min: 1, placeholder: 'No limit' })}
          <Fld k="registration_closes_at" label="Registration closes" errors={E}><input id="t-registration_closes_at" type="datetime-local" defaultValue={toLocal(t.registration_closes_at)} /></Fld></div>
          <p className="help">Registration collects name, phone, optional email and party size, with consent to the privacy notice. Registrations are deleted automatically after the retention period in Settings.</p></div></div>
        {T ? <div className="card"><h3>Recap and gallery <span className="help">after the trip</span></h3><div className="sect">{ta('recap', 'Recap story', 4)}<div id="tGallery"><Gallery T={T} setT={setT} /></div></div></div> : null}
        <p className="formerr">{f.msg}</p>
      </div>
      <aside>
        <div className="card wfbox"><div className="now"><h3 style={{ margin: 0 }}>Status</h3><TPill s={t.status} /></div>
          <BusyButton className="btn primary" onClick={save}><Icon n="check" />{T ? 'Save changes' : 'Create draft'}</BusyButton>
          {T ? <><Fld k="tstat" label="Change status"><Sel id="t-newstatus" opts={TRIP_STATUSES.map((s) => [s, TRIP_STATUS_LABELS[s]])} cur={t.status} /></Fld><BusyButton className="btn" onClick={applyStatus}>Apply status</BusyButton>
            <p className="help">Scheduled and later statuses are public. Postponing or cancelling asks for a message that appears on the trip page.</p>
            {t.status === 'draft' ? <button className="btn danger sm" onClick={del}><Icon n="trash" />Delete draft</button> : null}</> : null}
        </div>
        <div className="card"><h3>Cover image</h3><div id="coverBox">
          {coverUrl ? <img src={coverUrl} alt="" style={{ width: '100%', borderRadius: 12, marginBottom: 10 }} /> : <p className="help">No cover image.</p>}
          <label className="btn sm"><Icon n="camera" />{coverUrl ? 'Replace' : 'Choose image'}<input type="file" accept="image/*" className="vh" onChange={async (e) => { const fl = e.target.files?.[0]; if (!fl) return; try { setCover(await shrinkImage(fl)); } catch (x) { toast(x.message, 'bad'); } }} /></label>
          {cover ? <p className="help">Saved when you save the trip.</p> : null}</div></div>
        {T ? <>
          <div className="card"><h3>Public updates</h3><div className="feed">{(T.updates || []).length ? T.updates.map((u) => (
            <div key={u.id}><span>{u.message}<span className="sub">{fmtDateTime(u.created_at)}</span></span><button className="iconbtn sm" aria-label="Delete update" onClick={async () => { try { reload(await api.deleteTripUpdate(T.id, u.id)); } catch (e) { toast(e.message, 'bad'); } }}><Icon n="x" /></button></div>
          )) : <p className="help">No updates yet.</p>}</div>
            <Fld k="tupd" label="Post an update"><textarea id="t-update" rows={2} placeholder="Meeting time moved to 07:30" /></Fld>
            <BusyButton className="btn sm" style={{ marginTop: 8 }} onClick={async () => { const m = val('t-update').trim(); if (!m) { toast('Write the update first.', 'bad'); return; } const r = await api.tripUpdate(T.id, m); toast('Update posted'); reload(r); }}>Post update</BusyButton></div>
          {can('trips.registrations') ? <div className="card"><h3>Registrations <span className="help">{T.registered}{T.capacity ? '/' + T.capacity : ''}</span></h3><BusyButton className="btn sm" onClick={() => openRegs(T)}><Icon n="users" />View list</BusyButton> <a className="btn sm" href={`/api/trips/${T.id}/registrations.csv`}><Icon n="down" />CSV</a></div> : null}
        </> : null}
      </aside></div>
    </>
  );
}

function Gallery({ T, setT }) {
  return <>
    <div className="pgrid">{(T.photos || []).map((ph) => (
      <div key={ph.id} className="pcard"><img src={ph.url} alt="" /><div className="pb"><span className="help">{ph.caption || ''} {ph.credit ? '· ' + ph.credit : ''} · {PHOTO_RIGHTS[ph.rights]}</span>
        <BusyButton className="btn sm danger" onClick={async () => setT(await api.deleteTripPhoto(ph.id))}>Remove</BusyButton></div></div>
    ))}</div>
    <div className="fgrid" style={{ marginTop: 10 }}><Fld k="gcap" label="Caption"><input id="g-caption" /></Fld><Fld k="gcred" label="Credit"><input id="g-credit" /></Fld></div>
    <label className="btn sm" style={{ marginTop: 8 }}><Icon n="camera" />Add photo<input type="file" accept="image/*" className="vh" onChange={async (e) => {
      const fl = e.target.files?.[0]; if (!fl) return;
      try { const url = await shrinkImage(fl); setT(await api.tripPhoto(T.id, { photo: url, caption: val('g-caption'), credit: val('g-credit') })); toast('Photo added'); } catch (x) { toast(x.message, 'bad'); }
    }} /></label>
  </>;
}

async function openRegs(T) {
  const items = (await api.registrations(T.id)).items;
  const opts = [['confirmed', 'Confirmed'], ['waitlist', 'Waiting list'], ['attended', 'Attended'], ['no_show', 'No-show'], ['cancelled', 'Cancelled']];
  openDialog(() => (
    <Dlg title={'Registrations · ' + T.title} wide foot={<><a className="btn" href={`/api/trips/${T.id}/registrations.csv`}><Icon n="down" />Download CSV</a><button className="btn primary" onClick={closeDialog}>Done</button></>}>
      {items.length ? <><div className="tbl-wrap"><table className="tbl"><thead><tr><th>Code</th><th>Name</th><th>Phone</th><th className="num">People</th><th>Type</th><th>Status</th><th>When</th></tr></thead><tbody>
        {items.map((g) => (
          <tr key={g.id}><td className="mono">{g.code}</td><td>{g.name}{g.notes ? <span className="sub">{g.notes}</span> : null}</td><td className="mono"><a href={'tel:' + g.phone.replace(/\s/g, '')}>{g.phone}</a>{g.email ? <span className="sub">{g.email}</span> : null}</td>
            <td className="num">{g.party_size}</td><td className="muted">{g.kind === 'enquiry' ? 'Enquiry' : 'Registration'}</td>
            <td><Sel id={'rg-' + g.id} opts={opts} cur={g.status} aria-label="Status" onChange={async (e) => { try { await api.updateRegistration(g.id, e.target.value); toast('Updated'); } catch (x) { toast(x.message, 'bad'); } }} /></td><td className="muted">{relTime(g.created_at)}</td></tr>
        ))}</tbody></table></div>
        <p className="help" style={{ marginTop: 8 }}>Personal data. Viewing this list is recorded in the activity log.</p></> : <p className="help">No registrations yet.</p>}
    </Dlg>
  ));
}
