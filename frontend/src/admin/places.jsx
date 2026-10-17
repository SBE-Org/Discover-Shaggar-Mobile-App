// Places: filterable table with bulk actions, the full place editor, and the review queue.
import { useEffect, useRef, useState } from 'react';
import {
  SECTORS, SECTOR_IDS, TYPES, STATUSES, STATUS_LABELS, WORKFLOW, CONDITIONS, FACILITIES, COORD_SOURCES, PHOTO_RIGHTS, typeLabel, subcityCode,
  isTypeActive, CITY_BOUNDS, hasMenu, MENU_SECTIONS,
} from '../shared/catalog.js';
import { parseCoords, formatLatLon, haversine, pointInBoundary } from '../shared/coords.js';
import { shrinkImage, fmtDate } from '../lib/util.js';
import {
  A, api, can, canAny, go, nav, subLabel, StatusPill, SectorDot, PageHead, Loading, Empty, Fld, Sel, Check, subcityOptions, val, setVal, useFormErrors,
  LangFields, openDialog, closeDialog, Dlg, confirmDlg, loadPlaces, invalidatePlaces, relTime, fmtDateTime, BusyButton, useAsync, Notice, NavLink, NavButton,
  refreshCounts, toast, Icon,
} from './core.jsx';
import { Changes } from './people.jsx';

const PAGE = 50;
const FLAGS = {
  overdue: ['Review overdue', (p) => p.stale], no_photo: ['No photo', (p) => !p.photo_count],
  low_accuracy: ['Low GPS accuracy', (p) => (p.accuracy_m != null ? p.accuracy_m > (A.config?.settings?.['gps.max_accuracy_m'] || 20) : p.coord_source === 'import')],
  missing_translation: ['Missing translation', (p) => !p.name_om || !p.name_am || (p.description && (!p.description_om || !p.description_am))],
  unverified: ['Not verified on site', (p) => !p.verified], boundary: ['Outside boundary', (p) => !!p.boundary_flag],
  featured: ['Featured', (p) => p.featured], hidden: ['Hidden from app', (p) => !p.active],
  due_soon: ['Review due soon', (p) => p.status === 'published' && !p.stale && new Date(p.review_due) - Date.now() < (A.config?.settings?.['review.warn_days'] || 30) * 864e5],
};
const pf = { q: '', status: 'all', sector: 'all', sub: 'all', flag: 'all', mine: false, sort: 'updated', page: 0 };
const selected = new Set();
const isOwn = (p) => p.created_by === A.me.id || p.submitted_by === A.me.id;

export function Flags({ p }) {
  return (
    <span className="flags">
      {p.stale ? <span className="flag bad">Review overdue</span> : null}
      {!p.photo_count ? <span className="flag">No photo</span> : null}
      {FLAGS.low_accuracy[1](p) ? <span className="flag">{p.accuracy_m != null ? '±' + Math.round(p.accuracy_m) + ' m' : 'Accuracy unknown'}</span> : null}
      {FLAGS.missing_translation[1](p) ? <span className="flag">Translation</span> : null}
      {p.boundary_flag ? <span className="flag bad">Boundary</span> : null}
      {p.condition && p.condition !== 'open' ? <span className="flag">{CONDITIONS[p.condition]}</span> : null}
      {!p.active ? <span className="flag">Hidden</span> : null}
      {p.featured ? <span className="flag ok">Featured</span> : null}
    </span>
  );
}

/* ======================= list ======================= */
function filtered() {
  const q = pf.q.trim().toLowerCase();
  const list = (A.places || []).filter((p) => (pf.status === 'all' || p.status === pf.status) && (pf.sector === 'all' || p.sector === pf.sector) &&
    (pf.sub === 'all' || String(p.subcity_id) === pf.sub) && (pf.flag === 'all' || FLAGS[pf.flag]?.[1](p)) &&
    (!pf.mine || p.created_by === A.me.id || p.submitted_by === A.me.id) &&
    (!q || [p.name, p.name_om, p.name_am, p.alt_names, p.woreda, p.kebele, typeLabel(p.sector, p.type)].join(' ').toLowerCase().includes(q)));
  const by = { updated: (a, b) => b.updated_at.localeCompare(a.updated_at), name: (a, b) => a.name.localeCompare(b.name), due: (a, b) => a.review_due.localeCompare(b.review_due), created: (a, b) => b.created_at.localeCompare(a.created_at) };
  return list.sort(by[pf.sort] || by.updated);
}

export function PlacesView({ id }) {
  if (id) return <PlaceEditor key={id} id={id === 'new' ? null : id} />;
  return <PlacesList />;
}

function PlacesList() {
  if (A.placeFilter) { Object.assign(pf, { status: 'all', flag: 'all', sector: 'all', sub: 'all', q: '', page: 0 }, A.placeFilter); A.placeFilter = null; }
  const [, force] = useState(0);
  const redraw = () => force((n) => n + 1);
  const q = useAsync(() => loadPlaces(), []);
  const search = useRef(null);
  const set = (k) => (e) => { pf[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; pf.page = 0; redraw(); };
  const head = <PageHead title="Places" sub="Every record in the directory, in every status. Only published, visible places appear in the public app."
    right={<>{can('places.export') ? <a className="btn" href="/api/export.csv"><Icon n="down" />Export CSV</a> : null}{can('places.create') ? <button className="btn primary" onClick={() => nav('places/new')}><Icon n="plus" />Add place</button> : null}</>} />;
  const toolbar = (
    <div className="tbar">
      <div className="search"><Icon n="search" /><label className="vh" htmlFor="pq">Search</label><input id="pq" type="search" placeholder="Name, translation, woreda, landmark" defaultValue={pf.q}
        onChange={(e) => { clearTimeout(search.current); const v = e.target.value; search.current = setTimeout(() => { pf.q = v; pf.page = 0; redraw(); }, 150); }} /></div>
      <Sel id="pf-status" opts={[['all', 'All statuses'], ...STATUSES.map((s) => [s, STATUS_LABELS[s]])]} cur={pf.status} onChange={set('status')} aria-label="Status" />
      <Sel id="pf-sector" opts={[['all', 'All categories'], ...Object.keys(SECTORS).map((k) => [k, SECTORS[k].label])]} cur={pf.sector} onChange={set('sector')} aria-label="Category" />
      {A.me.subcity_id == null ? <Sel id="pf-sub" opts={[['all', 'All sub-cities'], ...subcityOptions()]} cur={pf.sub} onChange={set('sub')} aria-label="Sub-city" /> : null}
      <Sel id="pf-flag" opts={[['all', 'Any quality flag'], ...Object.entries(FLAGS).map(([k, [l]]) => [k, l])]} cur={pf.flag} onChange={set('flag')} aria-label="Quality" />
      <Sel id="pf-sort" opts={[['updated', 'Recently changed'], ['name', 'Name A–Z'], ['due', 'Review due first'], ['created', 'Newest']]} cur={pf.sort} onChange={set('sort')} aria-label="Sort" />
      <label className="check" style={{ minHeight: 42 }}><input type="checkbox" id="pf-mine" defaultChecked={pf.mine} onChange={set('mine')} />Mine</label>
    </div>
  );
  if (q.error) return <>{head}{toolbar}<div id="plist"><Notice error={q.error} /></div></>;
  if (!q.data) return <>{head}{toolbar}<div id="plist"><Loading n={8} /></div></>;
  if (!A.places.length) return <>{head}{toolbar}<div id="plist"><div className="card"><Empty title="No places yet" text="Add the first place, or import your spreadsheet from Import & export." icon="pin" /></div></div></>;
  const list = filtered();
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  pf.page = Math.min(pf.page, pages - 1);
  const rows = list.slice(pf.page * PAGE, (pf.page + 1) * PAGE);
  for (const sid of [...selected]) if (!list.some((p) => p.id === sid)) selected.delete(sid);
  const bulk = async (a) => {
    let note = '';
    if (a === 'return') { note = await confirmDlg('Return for correction', `Return ${selected.size} record(s) to their contributors?`, { okLabel: 'Return', note: 'What needs fixing?' }); if (note === null) return; }
    else if (['archive', 'unpublish'].includes(a)) { if ((await confirmDlg(a === 'archive' ? 'Archive records' : 'Unpublish records', `${a === 'archive' ? 'Archive' : 'Unpublish'} ${selected.size} record(s)? They will disappear from the public app.`, { okLabel: a === 'archive' ? 'Archive' : 'Unpublish', danger: true })) === null) return; }
    const r = await api.bulk([...selected], a, note);
    toast(`${r.ok} updated${r.failed ? ` · ${r.failed} skipped: ${r.results.find((x) => !x.ok)?.error}` : ''}`, r.failed ? 'bad' : '');
    selected.clear();
    await loadPlaces(true); redraw(); refreshCounts();
  };
  const B = ({ a, primary, children }) => <BusyButton className={'btn sm' + (primary ? ' primary' : '')} onClick={() => bulk(a)}>{children}</BusyButton>;
  return (
    <>{head}{toolbar}
      <div id="plist">
        <div className="tbl-wrap"><table className="tbl"><thead><tr>
          <th style={{ width: 34 }}><input type="checkbox" aria-label="Select all on this page" checked={!!rows.length && rows.every((p) => selected.has(p.id))} onChange={(e) => { rows.forEach((p) => (e.target.checked ? selected.add(p.id) : selected.delete(p.id))); redraw(); }} /></th>
          <th>Place</th><th>Sub-city</th><th>Status</th><th>Flags</th><th className="num">Photos</th><th>Review due</th><th>Updated</th></tr></thead><tbody>
          {rows.length ? rows.map((p) => (
            <tr key={p.id} className={selected.has(p.id) ? 'sel' : undefined}><td><input type="checkbox" checked={selected.has(p.id)} aria-label={'Select ' + p.name} onChange={(e) => { if (e.target.checked) selected.add(p.id); else selected.delete(p.id); redraw(); }} /></td>
              <td><NavLink className="rowlink" to={'places/' + p.id}><SectorDot sector={p.sector} /><span>{p.name}<span className="sub">{typeLabel(p.sector, p.type)}{p.verified ? ' · verified on site' : ''}</span></span></NavLink></td>
              <td className="muted">{subcityCode(p.subcity_id)}</td><td><StatusPill s={p.status} />{p.workflow_note && p.status === 'needs_correction' ? <span className="sub" title={p.workflow_note}>“{p.workflow_note.slice(0, 40)}”</span> : null}</td>
              <td><Flags p={p} /></td><td className="num">{p.photo_count}</td>
              <td className="muted">{p.status === 'published' ? fmtDate(p.review_due) : '—'}</td><td className="muted">{relTime(p.updated_at)}</td></tr>
          )) : <tr><td colSpan={8}><Empty title="Nothing matches these filters" /></td></tr>}
        </tbody></table></div>
        <div className="pager"><span>{list.length} of {A.places.length} records</span><span>{pages > 1 ? <><button className="btn sm" disabled={!pf.page} onClick={() => { pf.page--; redraw(); window.scrollTo(0, 0); }}>Previous</button> Page {pf.page + 1} of {pages} <button className="btn sm" disabled={pf.page >= pages - 1} onClick={() => { pf.page++; redraw(); window.scrollTo(0, 0); }}>Next</button></> : null}</span></div>
        {selected.size ? <div className="bulkbar"><b>{selected.size} selected</b>
          {can('places.submit') ? <B a="submit">Submit</B> : null}
          {can('places.review') ? <><B a="verify">Verify</B><B a="return">Return…</B><B a="reviewed">Mark reviewed</B></> : null}
          {can('places.publish') ? <><B a="publish" primary>Publish</B><B a="unpublish">Unpublish</B><B a="archive">Archive</B></> : null}
          {can('content.manage') ? <><B a="feature">Feature</B><B a="unfeature">Unfeature</B></> : null}
          <button className="btn sm" onClick={() => { selected.clear(); redraw(); }}>Clear</button></div> : null}
      </div>
    </>
  );
}

/* ======================= editor ======================= */
const actionsFor = (p) => Object.entries(WORKFLOW).filter(([, w]) => w.from.includes(p.status) && can(w.perm));
const canEditPlace = (p) => can('places.edit') && (A.me.subcity_id == null || A.me.subcity_id === p.subcity_id) &&
  !(['published', 'archived'].includes(p.status) && !can('places.publish') && !can('places.review')) && !(p.status === 'verified' && !can('places.review'));
const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];

function nearestSubOf(lat, lon) {
  for (const s of A.subcities.values()) if (s.boundary && pointInBoundary(lat, lon, s.boundary)) return { id: s.id, d: 0, inside: true };
  let best = null;
  for (const s of A.subcities.values()) { if (s.lat == null) continue; const d = haversine(lat, lon, s.lat, s.lon); if (!best || d < best.d) best = { id: s.id, d }; }
  return best;
}

function HoursGrid({ h, dis }) {
  const [on, setOn] = useState(() => Object.fromEntries(DAYS.map(([k]) => [k, !!h?.[k]?.[0]])));
  return (
    <div className="hours" id="hoursGrid">
      {DAYS.map(([k, l]) => {
        const r = h?.[k]?.[0];
        return (
          <div key={k} className="hrow"><b>{l}</b><label className="check" style={{ minHeight: 0 }}><input type="checkbox" id={'hc-' + k} checked={on[k]} disabled={dis} onChange={(e) => setOn({ ...on, [k]: e.target.checked })} />Open</label>
            <input type="time" id={'ho-' + k} defaultValue={r?.[0] || '08:30'} disabled={!on[k] || dis} aria-label={l + ' opens'} /><input type="time" id={'hx-' + k} defaultValue={r?.[1] || '17:00'} disabled={!on[k] || dis} aria-label={l + ' closes'} /></div>
        );
      })}
      <div style={{ display: 'flex', gap: 6 }}><button type="button" className="btn sm" disabled={dis} onClick={() => {
        const o = val('ho-mon'), c = val('hx-mon'), m = on.mon;
        const next = { ...on };
        for (const k of ['tue', 'wed', 'thu', 'fri']) { next[k] = m; setVal('ho-' + k, o); setVal('hx-' + k, c); }
        setOn(next);
      }}>Copy Monday to weekdays</button></div>
    </div>
  );
}
const readHours = () => {
  const out = {};
  for (const [k] of DAYS) out[k] = val('hc-' + k) ? [[val('ho-' + k), val('hx-' + k)]] : [];
  return Object.values(out).some((x) => x.length) ? out : null;
};

function PhotoBox({ P, setP, editable, newPhoto, setNewPhoto }) {
  const list = P?.photos || [];
  const onFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const url = await shrinkImage(f);
      if (!P) { setNewPhoto(url); return; }
      toast('Uploading…');
      setP(await api.addPhoto(P.id, { photo: url, credit: val('nph-credit'), rights: val('nph-rights') }));
      toast('Photo added'); invalidatePlaces();
    } catch (x) { toast(x.message, 'bad'); }
  };
  return (
    <div className="sect" id="photoBox">
      {list.length ? <div className="pgrid">{list.map((ph) => (
        <div key={ph.id} className={'pcard' + (ph.is_primary ? ' primary' : '')}><img src={ph.url} alt={ph.alt || ''} loading="lazy" />
          {ph.status === 'pending' || ph.source === 'visitor' ? <div style={{ padding: '8px 10px 0' }} className="flags">{ph.status === 'pending' ? <span className="flag">Waiting for approval</span> : null}{ph.source === 'visitor' ? <span className="flag ok">Visitor photo</span> : null}</div> : null}
          <div className="pb"><input id={'phc-' + ph.id} defaultValue={ph.caption} placeholder="Caption" aria-label="Caption" disabled={!editable} />
            <input id={'phr-' + ph.id} defaultValue={ph.credit} placeholder="Photographer / source" aria-label="Credit" disabled={!editable} />
            <input id={'pha-' + ph.id} defaultValue={ph.alt} placeholder="Alt text for screen readers" aria-label="Alt text" disabled={!editable} />
            <Sel id={'phs-' + ph.id} opts={Object.entries(PHOTO_RIGHTS)} cur={ph.rights} aria-label="Rights" disabled={!editable} />
            {editable ? <div className="row2"><BusyButton className="btn sm" onClick={async () => { setP(await api.updatePhoto(ph.id, { caption: val('phc-' + ph.id), credit: val('phr-' + ph.id), alt: val('pha-' + ph.id), rights: val('phs-' + ph.id) })); toast('Photo details saved'); }}>Save</BusyButton>
              {ph.is_primary ? <span className="flag ok" style={{ alignSelf: 'center' }}>Cover</span> : <BusyButton className="btn sm" onClick={async () => { setP(await api.updatePhoto(ph.id, { is_primary: true })); invalidatePlaces(); }}>Make cover</BusyButton>}
              <button className="iconbtn sm" aria-label="Delete photo" onClick={async () => {
                if ((await confirmDlg('Delete photo', 'Delete this photo for good?', { okLabel: 'Delete', danger: true })) === null) return;
                try { setP(await api.deletePhoto(ph.id)); invalidatePlaces(); toast('Photo deleted'); } catch (x) { toast(x.message, 'bad'); }
              }}><Icon n="trash" /></button></div> : null}</div></div>
      ))}</div> : <p className="help">No photos yet.</p>}
      {editable ? <>
        <div className="fgrid" style={{ alignItems: 'end' }}><Fld k="nph-credit" label="New photo credit"><input id="nph-credit" placeholder="Photographer or source" /></Fld><Fld k="nph-rights" label="Rights"><Sel id="nph-rights" opts={Object.entries(PHOTO_RIGHTS).filter(([k]) => k !== 'withdrawn')} cur="bureau" /></Fld></div>
        <label className="btn sm" style={{ justifySelf: 'start' }}><Icon n="camera" />{P ? 'Upload a photo' : newPhoto ? 'Replace photo' : 'Choose a photo'}<input type="file" accept="image/*" className="vh" onChange={onFile} /></label>
        {!P && newPhoto ? <img src={newPhoto} alt="" style={{ maxWidth: 200, borderRadius: 12 }} /> : null}
      </> : null}
    </div>
  );
}

const money = (m) => (m.price == null ? '—' : 'ETB ' + Number(m.price).toLocaleString());
function MenuBox({ P, setP }) {
  const list = P?.menu || [];
  const mayEdit = canEditPlace(P) || can('places.edit');
  const secs = [...new Set(list.map((m) => m.section))];
  const edit = (m) => openDialog(() => <MenuItemDialog P={P} setP={setP} m={m || { section: MENU_SECTIONS[0], available: true, tags: [] }} />);
  return (
    <div id="menuBox">
      {list.length ? secs.map((sec) => <div key={sec}><h4 className="sech" style={{ margin: '12px 0 6px' }}>{sec}</h4><div className="tbl-wrap"><table className="tbl"><tbody>{list.filter((m) => m.section === sec).map((m) => (
        <tr key={m.id}><td style={{ width: 54 }}>{m.photo ? <img src={m.photo} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 10 }} /> : null}</td>
          <td><b>{m.name}</b>{m.name_am ? <> <span className="muted">{m.name_am}</span></> : null}<span className="sub">{m.description || ''}{m.tags?.length ? ' · ' + m.tags.join(', ') : ''}</span></td>
          <td className="num">{money(m)}</td>
          <td>{m.status === 'pending' ? <span className="flag">Waiting for approval</span> : !m.available ? <span className="flag">Not available</span> : null}{m.source === 'customer' ? <span className="flag ok">Customer</span> : null}</td>
          <td><div className="acts">{mayEdit ? <button className="btn sm" onClick={() => edit(m)}>Edit</button> : null}</div></td></tr>
      ))}</tbody></table></div></div>) : <p className="help">No menu items yet.</p>}
      {mayEdit ? <button className="btn sm" style={{ marginTop: 12 }} onClick={() => edit(null)}><Icon n="plus" />Add item</button> : null}
      {P.status === 'published' && !can('contributions.manage') ? <p className="help" style={{ marginTop: 8 }}>This place is live: new items and changes wait for your supervisor’s approval.</p> : null}
    </div>
  );
}
const TAGS = ['fasting', 'vegetarian', 'spicy', 'popular', 'new', 'halal'];
function MenuItemDialog({ P, setP, m }) {
  const f = useFormErrors();
  const [photo, setPhoto] = useState(null);
  return (
    <Dlg title={m.id ? 'Edit menu item' : 'Add menu item'} wide foot={<>
      {m.id ? <button className="btn danger" style={{ marginRight: 'auto' }} onClick={async () => { try { await api.deleteMenuItem(m.id); closeDialog(); setP(await api.place(P.id)); toast('Item deleted'); } catch (e) { toast(e.message, 'bad'); } }}><Icon n="trash" />Delete</button> : null}
      <button className="btn" onClick={closeDialog}>Cancel</button>
      <BusyButton className="btn primary" onClick={async () => {
        const b = { name: val('mn-name'), price: val('mn-price'), name_am: val('mn-name_am'), name_om: val('mn-name_om'), section: val('mn-section'), price_note: val('mn-price_note'), description: val('mn-description'), available: val('mn-available'), tags: TAGS.filter((x) => val('mnt-' + x)) };
        if (photo) b.photo = photo;
        try { await (m.id ? api.updateMenuItem(m.id, b) : api.addMenuItem(P.id, b)); closeDialog(); setP(await api.place(P.id)); toast('Menu saved'); } catch (e) { f.setErrors(e.details, e.message); }
      }}>Save</BusyButton></>}>
      <div className="sect" id="mnform" ref={f.ref}><div className="fgrid">
        <Fld k="name" label="Name" errors={f.errors}><input id="mn-name" defaultValue={m.name} maxLength={120} /></Fld><Fld k="price" label="Price (ETB)" errors={f.errors}><input id="mn-price" defaultValue={m.price ?? ''} inputMode="decimal" /></Fld>
        <Fld k="name_am" label="Name in Amharic" errors={f.errors}><input id="mn-name_am" defaultValue={m.name_am} /></Fld><Fld k="name_om" label="Name in Afaan Oromoo" errors={f.errors}><input id="mn-name_om" defaultValue={m.name_om} /></Fld>
        <Fld k="section" label="Section" errors={f.errors}><input id="mn-section" list="mnSections" defaultValue={m.section} /><datalist id="mnSections">{MENU_SECTIONS.map((x) => <option key={x} value={x} />)}</datalist></Fld>
        <Fld k="price_note" label="Price note" errors={f.errors}><input id="mn-price_note" defaultValue={m.price_note} placeholder="per person, half/full portion…" /></Fld>
        <div className="wide"><Fld k="description" label="Description" errors={f.errors}><input id="mn-description" defaultValue={m.description} maxLength={500} /></Fld></div></div>
        <div className="checks">{TAGS.map((x) => <Check key={x} id={'mnt-' + x} label={x[0].toUpperCase() + x.slice(1)} on={(m.tags || []).includes(x)} />)}<Check id="mn-available" label="Available now" on={m.available !== false} /></div>
        <label className="btn sm" style={{ justifySelf: 'start' }}><Icon n="camera" />{m.photo ? 'Replace photo' : 'Add photo'}<input type="file" accept="image/*" className="vh" onChange={async (e) => { const fl = e.target.files?.[0]; if (fl) setPhoto(await shrinkImage(fl, 1200)); }} /></label>
        <span className="help" id="mnPhotoInfo">{photo ? 'Photo ready, saved with the item.' : ''}</span>
        <p className="formerr">{f.msg}</p></div>
    </Dlg>
  );
}

function History({ P, onRestored }) {
  const [h, setH] = useState(null);
  const [err, setErr] = useState(null);
  const show = async () => { setH('loading'); try { setH((await api.history(P.id)).items); } catch (e) { setErr(e); setH(null); } };
  const canRestore = canAny('places.review', 'places.publish') && can('places.edit');
  return (
    <div className="card"><h3>Change history <button className="linkbtn" onClick={show}>Show</button></h3><div id="histBox">
      {err ? <p className="bad">{err.message}</p> : h === 'loading' ? <Loading n={2} /> : h ? <div className="feed">{h.length ? h.map((a) => (
        <div key={a.id} style={{ display: 'block' }}><span><b>{a.user_name || 'System'}</b> {a.action === 'status' ? `${STATUS_LABELS[a.detail?.from] || ''} → ${STATUS_LABELS[a.detail?.to] || ''}` : a.action.replace('_', ' ')}</span>
          <time style={{ float: 'right' }}>{relTime(a.created_at)}</time>{a.detail?.note ? <div className="help">“{a.detail.note}”</div> : null}{a.detail?.changes ? <Changes ch={a.detail.changes} /> : null}
          {canRestore && a.action === 'update' && a.detail?.changes && Object.keys(a.detail.changes).length ? <button className="linkbtn" onClick={async () => {
            if ((await confirmDlg('Restore previous values', 'Put back the values from before this change? The restore is itself recorded in the history.', { okLabel: 'Restore' })) === null) return;
            try { const r = await api.revert(a.id); toast('Restored: ' + r.restored.join(', ')); invalidatePlaces(); onRestored(); } catch (e) { toast(e.message, 'bad'); }
          }}>Restore previous values</button> : null}</div>
      )) : <p className="help">No changes recorded.</p>}</div> : null}
    </div></div>
  );
}

function SideBox({ P, editable, save, reload }) {
  const settings = A.config?.settings || {};
  if (!P) {
    return <>
      <div className="card wfbox"><h3>Save</h3><p className="help">New records start as drafts. Submit when the details and location are ready for a reviewer.</p>
        <BusyButton className="btn primary" onClick={() => save(true)}><Icon n="check" />Save and submit for review</BusyButton><BusyButton className="btn" onClick={() => save(false)}>Save as draft</BusyButton></div>
      <div className="card"><h3>Field checklist</h3><ul className="errlist" style={{ color: 'var(--muted)' }}><li>Stand at the main public entrance.</li><li>Aim for GPS accuracy of ±{settings['gps.good_accuracy_m'] || 10} m; above ±{settings['gps.max_accuracy_m'] || 20} m you will be asked why.</li><li>Check the pin on the satellite map.</li><li>Only take photos where permitted.</li><li>Record hours, contacts and facilities only when verified.</li></ul></div>
    </>;
  }
  const acts_ = actionsFor(P);
  const own = isOwn(P);
  const ppl = P.people || {};
  const wf = async (a) => {
    const w = WORKFLOW[a];
    let note = '';
    if (w.note) { note = await confirmDlg(w.label, a === 'reject' ? 'Reject this record? It will not be published.' : 'The contributor will see your note and can fix the record.', { okLabel: w.label, note: 'Note for the contributor', danger: a === 'reject' }); if (note === null) return; }
    else if (['archive', 'unpublish'].includes(a)) { if ((await confirmDlg(w.label, 'This removes the place from the public app. You can restore it later.', { okLabel: w.label, danger: true })) === null) return; }
    const p = await api.workflow(P.id, a, note); invalidatePlaces(); toast(`${p.name}: ${STATUS_LABELS[p.status]}`); refreshCounts(); reload(p);
  };
  return <>
    <div className="card wfbox"><div className="now"><h3 style={{ margin: 0 }}>Workflow</h3><StatusPill s={P.status} /></div>
      {P.workflow_note && ['needs_correction', 'rejected'].includes(P.status) ? <div className="wfnote"><b>Reviewer note:</b> {P.workflow_note}</div> : null}
      {editable ? <><BusyButton className="btn primary" onClick={() => save(false)}><Icon n="check" />Save changes</BusyButton>{['draft', 'needs_correction'].includes(P.status) && can('places.submit') ? <BusyButton className="btn" onClick={() => save(true)}>Save and submit</BusyButton> : null}</> : null}
      {acts_.filter(([k]) => k !== 'submit').map(([k, w]) => {
        const blocked = w.own === false && own && !A.config?.settings?.['workflow.allow_self_approval'];
        if (k === 'verify' && acts_.some(([x]) => x === 'approve')) return null;
        return <BusyButton key={k} className={'btn ' + (k === 'publish' || k === 'approve' ? 'primary' : ['reject', 'archive'].includes(k) ? 'danger' : '')} disabled={blocked} title={blocked ? 'You created or submitted this record. Another reviewer must do this step.' : undefined} onClick={() => wf(k)}>{w.label}</BusyButton>;
      })}
      {acts_.some(([, w]) => w.own === false) && own ? <p className="help">You created or submitted this record, so another reviewer must verify or publish it.</p> : null}
      {P.status === 'published' && can('places.review') ? <BusyButton className="btn" onClick={async () => { const p = await api.markReviewed(P.id); invalidatePlaces(); toast('Marked as reviewed today'); reload(p); }}><Icon n="check" />Confirm still accurate</BusyButton> : null}
      <div className="people">
        {P.created_by ? <span>Created by <b>{ppl[P.created_by] || '—'}</b> · {fmtDate(P.created_at)}</span> : <span>Created {fmtDate(P.created_at)}{P.source === 'Public suggestion' ? ' from a public suggestion' : ''}</span>}
        {P.submitted_by ? <span>Submitted by <b>{ppl[P.submitted_by] || '—'}</b> · {fmtDate(P.submitted_at)}</span> : null}
        {P.reviewed_by ? <span>Reviewed by <b>{ppl[P.reviewed_by] || '—'}</b> · {fmtDate(P.reviewed_at)}</span> : null}
        {P.published_by ? <span>Published by <b>{ppl[P.published_by] || '—'}</b> · {fmtDate(P.published_at)}</span> : null}
        {P.status === 'published' ? <span>Next review <b className={P.stale ? 'bad' : undefined}>{fmtDate(P.review_due)}</b>{P.stale ? ' (overdue)' : ''}</span> : null}
      </div>
      {can('places.delete') ? <button className="btn danger sm" onClick={async () => {
        if ((await confirmDlg('Delete permanently', <>Delete <b>{P.name}</b> and its photos? This cannot be undone. Archiving keeps the history instead.</>, { okLabel: 'Delete for good', danger: true })) === null) return;
        try { await api.deletePlace(P.id); invalidatePlaces(); toast('Place deleted'); go('places'); } catch (e) { toast(e.message, 'bad'); }
      }}><Icon n="trash" />Delete permanently</button> : null}
    </div>
    <div className="card"><h3>Location evidence</h3><div className="evid">{(P.evidence || []).length ? P.evidence.map((e) => (
      <div key={e.id}><span className="mono">{formatLatLon(e.lat, e.lon)}{e.accuracy_m != null ? ' · ±' + Math.round(e.accuracy_m) + ' m' : ''}</span>
        <span className="help">{COORD_SOURCES[e.method] || e.method} · {e.collector_name || 'Public'} · {fmtDateTime(e.captured_at)}</span>{e.notes ? <span className="help">{e.notes}</span> : null}</div>
    )) : <p className="help">No readings recorded.</p>}</div></div>
    <History P={P} onRestored={() => reload()} />
  </>;
}

/** Map with a draggable pin for the place location (Leaflet, as before). */
function usePickMap(boxRef, p, editable, onMapSet) {
  const ref = useRef({ map: null, marker: null });
  const placeMarker = (lat, lon, draggable = true) => {
    const s = ref.current; if (!s.map) return;
    if (!s.marker) {
      s.marker = window.L.marker([lat, lon], { draggable, icon: window.L.divIcon({ className: '', html: '<div class="refdot" style="background:var(--brand)"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(s.map);
      s.marker.on('dragend', () => { const c = s.marker.getLatLng(); onMapSet.current(c.lat, c.lng); });
    } else s.marker.setLatLng([lat, lon]);
  };
  useEffect(() => {
    const box = boxRef.current;
    if (typeof window.L === 'undefined') { box.innerHTML = '<div class="nomap">The map could not load. Type or paste the coordinates instead.</div>'; return undefined; }
    box.innerHTML = '';
    const L = window.L, cfg = A.config?.tiles || {};
    const map = L.map(box, { zoomControl: true, attributionControl: true });
    ref.current.map = map;
    const street = L.tileLayer(cfg.dark || 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 20, maxNativeZoom: 19, subdomains: 'abcd', attribution: cfg.darkAttribution || '&copy; OpenStreetMap contributors &copy; CARTO' });
    const sat = L.tileLayer(cfg.satellite || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 19, attribution: cfg.satelliteAttribution || 'Imagery &copy; Esri' });
    sat.addTo(map);
    L.control.layers({ Satellite: sat, Streets: street }, {}, { position: 'topright' }).addTo(map);
    for (const s of A.subcities.values()) if (s.boundary) L.geoJSON(s.boundary, { style: { color: '#C8102E', weight: 1.5, fill: false, dashArray: '4 4' }, interactive: false }).addTo(map);
    if (p.lat != null) { map.setView([p.lat, p.lon], 18); placeMarker(p.lat, p.lon, editable); }
    else map.fitBounds(CITY_BOUNDS);
    if (editable) map.on('click', (e) => onMapSet.current(e.latlng.lat, e.latlng.lng));
    setTimeout(() => map.invalidateSize?.(), 50);
    return () => { try { map.remove(); } catch { /* ignore */ } ref.current = { map: null, marker: null }; };
  }, []);
  return { placeMarker, map: () => ref.current.map };
}

function PlaceEditor({ id }) {
  const [P, setP] = useState(null);
  const [state, setState] = useState(id ? 'loading' : 'ready');
  const [error, setError] = useState(null);
  const [v, setV] = useState(0); // remount the form after a save so it shows the saved values
  const load = async (fresh) => {
    if (fresh) { setP(fresh); setV((n) => n + 1); return; }
    try { setP(await api.place(id)); setState('ready'); setV((n) => n + 1); } catch (e) { setError(e); setState('error'); }
  };
  useEffect(() => { if (id) load(); else if (!can('places.create')) go('places'); }, [id]);
  if (state === 'loading') return <Loading n={6} />;
  if (state === 'error') return <Notice error={error} />;
  return <PlaceForm key={v} P={P} setP={setP} reload={load} />;
}

function PlaceForm({ P, setP, reload }) {
  const p = P || { sector: SECTOR_IDS[0], type: Object.keys(TYPES[SECTOR_IDS[0]] || {})[0], condition: 'open', active: true, facilities: [], subcity_id: A.me.subcity_id ?? '', status: 'draft' };
  const editable = !P || canEditPlace(P);
  const dis = !editable;
  const f = useFormErrors();
  const [sector, setSector] = useState(p.sector);
  const [cfb, setCfb] = useState({ cls: 'cfb', text: '' });
  const [accInfo, setAccInfo] = useState(P?.accuracy_m != null ? `Recorded accuracy ±${Math.round(P.accuracy_m)} m · ${COORD_SOURCES[P.coord_source] || P.coord_source}` : P ? `Source: ${COORD_SOURCES[P.coord_source] || P.coord_source || 'unknown'}` : '');
  const [gpsOn, setGpsOn] = useState(false);
  const [newPhoto, setNewPhoto] = useState(null);
  const coordState = useRef({ source: null, accuracy: null });
  const gpsOriginal = useRef(null);
  const gpsWatch = useRef(null);
  const boxRef = useRef(null);
  const onMapSet = useRef(() => {});
  const pm = usePickMap(boxRef, p, editable, onMapSet);
  const sectorOpts = Object.keys(SECTORS).filter((k) => SECTORS[k].active !== false || k === p.sector).map((k) => [k, SECTORS[k].label]);
  const typeOpts = (s) => Object.entries(TYPES[s] || {}).filter(([k]) => isTypeActive(s, k) || (k === p.type && s === p.sector));

  function coordFeedback(autoSub = false) {
    const r = parseCoords(val('p-coords'));
    if (!r) { setCfb({ cls: 'cfb', text: '' }); return; }
    if (r.error) { setCfb({ cls: 'cfb bad', text: r.error }); return; }
    const ns = nearestSubOf(r.lat, r.lon), sel = document.getElementById('p-subcity_id');
    if (ns && sel && autoSub && (!sel.value || !P) && [...sel.options].some((o) => o.value === String(ns.id))) sel.value = String(ns.id);
    const parts = [];
    if (r.swapped) parts.push('latitude and longitude were swapped and fixed');
    if (ns) parts.push(ns.inside ? `inside ${subLabel(ns.id)}` : `nearest centre: ${subLabel(ns.id)}`);
    let text = (parts.join(' · ') || 'Coordinates look fine') + (r.inRegion ? '' : ' · This point is outside the Shaggar area. Check the numbers.');
    if (P && !(Math.abs(r.lat - P.lat) < 1e-7 && Math.abs(r.lon - P.lon) < 1e-7)) text += ' · Location changed: the record will need re-verification.';
    setCfb({ cls: 'cfb ' + (r.inRegion ? 'ok' : 'warn'), text });
  }
  function setCoords(lat, lon, source, accuracy = null) {
    setVal('p-coords', formatLatLon(lat, lon));
    coordState.current = { source, accuracy };
    pm.placeMarker(lat, lon);
    setAccInfo(accuracy != null ? `GPS accuracy ±${Math.round(accuracy)} m` : source === 'map' ? 'Set on the map (pin adjusted by hand)' : '');
    coordFeedback(true);
  }
  onMapSet.current = (lat, lon) => setCoords(lat, lon, 'map');
  useEffect(() => { coordFeedback(); }, []);
  useEffect(() => () => { if (gpsWatch.current !== null) navigator.geolocation.clearWatch(gpsWatch.current); }, []);

  const gps = () => {
    if (!navigator.geolocation) { toast('This device cannot share its location.', 'bad'); return; }
    if (gpsWatch.current !== null) { navigator.geolocation.clearWatch(gpsWatch.current); gpsWatch.current = null; setGpsOn(false); return; }
    let best = null; const start = Date.now();
    setGpsOn(true); setAccInfo('Waiting for satellites…');
    gpsWatch.current = navigator.geolocation.watchPosition((pos) => {
      const { latitude: lat, longitude: lon, accuracy } = pos.coords;
      if (!best || accuracy <= best.acc) best = { lat, lon, acc: accuracy };
      gpsOriginal.current = { lat: best.lat, lon: best.lon, accuracy_m: Math.round(best.acc * 10) / 10 };
      setCoords(best.lat, best.lon, 'gps', best.acc);
      pm.map()?.setView([best.lat, best.lon], 18);
      if (best.acc <= (A.config?.settings?.['gps.good_accuracy_m'] || 10) && Date.now() - start > 3000) { navigator.geolocation.clearWatch(gpsWatch.current); gpsWatch.current = null; setGpsOn(false); toast(`GPS fixed at ±${Math.round(best.acc)} m`); }
    }, (err) => { toast(err.code === 1 ? 'Location permission was denied.' : 'Could not get a GPS fix.', 'bad'); gpsWatch.current = null; setGpsOn(false); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  };

  function collect() {
    const body = {};
    for (const k of ['name', 'name_om', 'name_am']) body[k] = val('p-' + k);
    for (const k of ['description', 'description_om', 'description_am']) body[k] = val('pd-' + k);
    for (const k of ['alt_names', 'sector', 'type', 'condition', 'woreda', 'kebele', 'visitor_tips', 'safety', 'phone', 'email', 'website', 'hours', 'accessibility', 'source', 'owner_department', 'review_months']) body[k] = val('p-' + k) ?? undefined;
    for (const k of ['fee', 'best_time', 'parking']) if (document.getElementById('p-' + k)) body[k] = val('p-' + k);
    body.active = val('p-active');
    if (document.getElementById('p-featured')) body.featured = val('p-featured');
    if (document.getElementById('p-verified')) body.verified = val('p-verified');
    body.subcity_id = val('p-subcity_id') === '' ? '' : Number(val('p-subcity_id'));
    body.coords = val('p-coords');
    body.facilities = Object.keys(FACILITIES).filter((k) => val('fac-' + k));
    body.hours_json = readHours();
    const r = parseCoords(body.coords);
    const moved = !P || !r || r.error || !(Math.abs(r.lat - P.lat) < 1e-7 && Math.abs(r.lon - P.lon) < 1e-7);
    if (moved) {
      body.coord_source = coordState.current.source || 'typed';
      body.accuracy_m = coordState.current.source === 'gps' ? coordState.current.accuracy : null;
      if (gpsOriginal.current && coordState.current.source !== 'gps') body.gps_original = gpsOriginal.current;
    } else delete body.coords;
    return body;
  }
  async function save(submit, extra = {}) {
    const body = { ...collect(), ...extra };
    if (!P && newPhoto) body.photo = newPhoto;
    if (submit) body.submit = true;
    if (!body.name?.trim()) { f.setErrors({ 'p-name': 'Enter the place name.' }, 'Some fields need attention.'); return; }
    try {
      const saved = P ? await api.updatePlace(P.id, body) : await api.createPlace(body);
      invalidatePlaces();
      toast(P ? 'Saved' : 'Place created');
      refreshCounts();
      if (!P) go('places', saved.id, { replace: true }); else reload(saved);
    } catch (e) {
      if (e.status === 409 && e.details?.duplicates) {
        openDialog(() => <Dlg title="Possible duplicate" foot={<><button className="btn" onClick={closeDialog}>Go back</button><button className="btn primary" id="dupOk" onClick={() => { closeDialog(); save(submit, { ...extra, confirm_duplicate: true }); }}>It is a different place, save</button></>}>
          <p>This looks like a place that is already in the directory:</p><div className="qlist" style={{ marginTop: 10 }}>{e.details.duplicates.map((d) => <button key={d.id} onClick={() => nav('places/' + d.id)}><span>{d.name} <span className="sub">{STATUS_LABELS[d.status]} · {d.distance_m} m away · {Math.round(d.score * 100)}% name match</span></span><Icon n="chev" /></button>)}</div></Dlg>);
        return;
      }
      if (e.details?.accuracy_note) {
        const note = await confirmDlg('Low GPS accuracy', e.message, { okLabel: 'Save with this note', note: 'Why is the accuracy low?', notePlaceholder: 'Dense trees at the gate; pin checked against satellite image' });
        if (note) save(submit, { ...extra, accuracy_note: note });
        return;
      }
      const map_ = {}; for (const [k, v] of Object.entries(e.details || {})) map_[k.startsWith('description') ? 'pd-' + k : (['name', 'name_om', 'name_am'].includes(k) ? 'p-' + k : k)] = v;
      f.setErrors(map_, e.message);
    }
  }

  const E = f.errors;
  return (
    <>
      <button className="crumb" onClick={() => nav('places')}><Icon n="back" />All places</button>
      <PageHead title={P ? P.name : 'Add a place'} sub={P ? <><StatusPill s={P.status} /> {typeLabel(P.sector, P.type)} · {subLabel(P.subcity_id)} · updated {relTime(P.updated_at)}</> : 'Fill in what you know. You can save a draft and finish later.'}
        right={P && P.status === 'published' ? <a className="btn" href={'/#place-' + P.id} target="_blank" rel="noopener"><Icon n="eye" />View in app</a> : null} />
      {!editable ? <div className="notice">{P.status === 'published' ? 'Published records can only be changed by reviewers or approvers.' : 'This record is verified. A reviewer must return it for correction before it can be edited.'}</div> : null}
      <div className="split"><div id="pform" ref={f.ref}>
        <div className="card"><h3>Name and category</h3><div className="sect">
          <LangFields prefix="p-" rec={P || {}} fields={[['name', 'Name', 'input', { maxLength: 120, disabled: dis }]]} errors={E} />
          <Fld k="p-alt_names" label="Other spellings and local names" errors={E} help="Helps people find the place when they spell it differently (FR-003)."><input id="p-alt_names" defaultValue={p.alt_names} maxLength={300} placeholder="Separate with commas" disabled={dis} /></Fld>
          <div className="fgrid3">
            <Fld k="sector" label="Category group" errors={E}><Sel id="p-sector" opts={sectorOpts} cur={p.sector} disabled={dis} onChange={(e) => setSector(e.target.value)} /></Fld>
            <Fld k="type" label="Category" errors={E}><Sel key={sector} id="p-type" opts={sector === p.sector ? typeOpts(sector) : Object.entries(TYPES[sector] || {}).filter(([k]) => isTypeActive(sector, k))} cur={sector === p.sector ? p.type : ''} disabled={dis} /></Fld>
            <Fld k="condition" label="Current condition" errors={E}><Sel id="p-condition" opts={Object.entries(CONDITIONS)} cur={p.condition || 'open'} disabled={dis} /></Fld>
          </div>
          <div className="checks"><Check id="p-active" label="Show in the public app when published" on={p.active !== false} disabled={dis} />
            {can('content.manage') ? <Check id="p-featured" label="Feature on the Home screen" on={!!p.featured} disabled={dis} /> : null}</div>
        </div></div>

        <div className="card"><h3>Location <span className="help">WGS 84 decimal degrees · main public entrance</span></h3><div className="sect">
          <div className="pickmap" id="pmap" ref={boxRef}><div className="nomap">Loading map…</div></div>
          <div className="fgrid">
            <Fld k="coords" label="Coordinates (latitude, longitude)" errors={E} help="Paste numbers, a Google Maps link or degrees-minutes-seconds, or drag the pin.">
              <input id="p-coords" defaultValue={P ? formatLatLon(P.lat, P.lon) : ''} className="mono" placeholder="9.012345, 38.745678" disabled={dis} onChange={() => {
                coordState.current = { source: 'typed', accuracy: null };
                const r = parseCoords(val('p-coords'));
                if (r && !r.error) { pm.placeMarker(r.lat, r.lon); const m = pm.map(); m?.setView([r.lat, r.lon], Math.max(m.getZoom(), 17)); }
                coordFeedback(true);
              }} /></Fld>
            <Fld k="subcity_id" label="Sub-city" errors={E}><Sel id="p-subcity_id" opts={[['', 'Choose…'], ...subcityOptions().filter(([x]) => A.me.subcity_id == null || x === String(A.me.subcity_id))]} cur={String(p.subcity_id ?? '')} disabled={dis} /></Fld>
          </div>
          <div id="cfb" className={cfb.cls}>{cfb.text}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{editable ? <button type="button" className="btn sm" onClick={gps}><Icon n={gpsOn ? 'x' : 'locate'} />{gpsOn ? 'Stop GPS' : "Use this device's GPS"}</button> : null}
            <span className="help" id="accInfo">{accInfo}</span></div>
          <div className="fgrid">
            <Fld k="woreda" label="Woreda" errors={E}><input id="p-woreda" defaultValue={p.woreda} maxLength={60} disabled={dis} /></Fld>
            <Fld k="kebele" label="Address, kebele or landmark" errors={E}><input id="p-kebele" defaultValue={p.kebele} maxLength={160} placeholder="Near the main roundabout, opposite …" disabled={dis} /></Fld>
          </div>
          {P?.boundary_flag ? <div className="notice">This point lies outside the approved boundary of its sub-city. Check the pin or the sub-city.</div> : null}
        </div></div>

        <div className="card"><h3>Description and visitor information</h3><div className="sect">
          <LangFields prefix="pd-" rec={P || {}} fields={[['description', 'Description', 'area', { rows: 6, maxLength: 4000, disabled: dis }]]} errors={E} />
          <div className="fgrid">
            <Fld k="visitor_tips" label="Visitor guidance" errors={E}><textarea id="p-visitor_tips" defaultValue={p.visitor_tips} rows={3} maxLength={1500} placeholder="What to expect, rules, what to bring" disabled={dis} /></Fld>
            <Fld k="safety" label="Safety and conservation" errors={E}><textarea id="p-safety" defaultValue={p.safety} rows={3} maxLength={1000} disabled={dis} /></Fld>
          </div>
        </div></div>

        <div className="card"><h3>Contacts and opening hours</h3><div className="sect">
          <div className="fgrid3">
            <Fld k="phone" label="Phone" errors={E}><input id="p-phone" defaultValue={p.phone} type="tel" maxLength={40} disabled={dis} /></Fld>
            <Fld k="email" label="Email" errors={E}><input id="p-email" defaultValue={p.email} type="email" maxLength={120} disabled={dis} /></Fld>
            <Fld k="website" label="Website" errors={E}><input id="p-website" defaultValue={p.website} maxLength={200} placeholder="https://" disabled={dis} /></Fld>
          </div>
          <Fld k="hours" label="Opening hours (as shown)" errors={E} help="Also fill the weekly table below so the app can show “Open now”."><input id="p-hours" defaultValue={p.hours} maxLength={160} placeholder="Mon–Fri 08:30–17:00, Sat 08:30–12:30" disabled={dis} /></Fld>
          <HoursGrid h={p.hours_json} dis={dis} />
          {p.sector === 'tourism' || P?.fee || P?.best_time ? <div className="fgrid3">
            <Fld k="fee" label="Entrance fee" errors={E}><input id="p-fee" defaultValue={p.fee} maxLength={120} disabled={dis} /></Fld>
            <Fld k="best_time" label="Best time to visit" errors={E}><input id="p-best_time" defaultValue={p.best_time} maxLength={120} disabled={dis} /></Fld>
            <Fld k="parking" label="Parking" errors={E}><input id="p-parking" defaultValue={p.parking} maxLength={120} disabled={dis} /></Fld></div> : null}
        </div></div>

        <div className="card"><h3>Facilities and accessibility <span className="help">tick only what has been checked</span></h3><div className="sect">
          <div className="checks">{Object.entries(FACILITIES).map(([k, l]) => <Check key={k} id={'fac-' + k} label={l} on={(p.facilities || []).includes(k)} disabled={dis} />)}</div>
          <Fld k="accessibility" label="Accessibility details" errors={E}><textarea id="p-accessibility" defaultValue={p.accessibility} rows={2} maxLength={600} placeholder="Ramps, step-free routes, accessible toilets, assistance" disabled={dis} /></Fld>
        </div></div>

        <div className="card"><h3>Photos <span className="help">only approved photos with confirmed rights appear in the app</span></h3><PhotoBox P={P} setP={setP} editable={editable} newPhoto={newPhoto} setNewPhoto={setNewPhoto} /></div>
        {P && (hasMenu(P) || P.menu?.length) ? <div className="card"><h3>Menu <span className="help">dishes, drinks or rooms with prices</span></h3><MenuBox P={P} setP={setP} /></div> : null}

        <div className="card"><h3>Source and review</h3><div className="sect"><div className="fgrid3">
          <Fld k="source" label="Data source" errors={E}><input id="p-source" defaultValue={p.source} maxLength={200} placeholder="Field survey, official list…" disabled={dis} /></Fld>
          <Fld k="owner_department" label="Responsible department" errors={E}><input id="p-owner_department" defaultValue={p.owner_department} maxLength={120} disabled={dis} /></Fld>
          <Fld k="review_months" label="Review every (months)" errors={E}><input id="p-review_months" defaultValue={p.review_months ?? ''} type="number" min="1" max="36" placeholder={'Default ' + (SECTORS[p.sector]?.review_months || 12)} disabled={dis} /></Fld>
        </div>
          {can('places.review') ? <Check id="p-verified" label="Location and key details checked on site by staff" on={!!p.verified} disabled={dis} /> : null}
        </div></div>
        <p className="formerr">{f.msg}</p>
      </div>
      <aside><SideBox P={P} editable={editable} save={save} reload={reload} /></aside></div>
    </>
  );
}

/* ======================= review queue ======================= */
export function QueueView() {
  const q = useAsync(() => loadPlaces(true), []);
  const head = <PageHead title="Review queue" sub="Data entry submits → the sub-city supervisor approves. Nobody approves their own work, and records from senior staff go to a senior approver." />;
  if (!q.data && !q.error) return <><PageHead title="Review queue" sub="Draft → Submitted → Verified → Published. Nobody approves a record they created or submitted." /><Loading n={6} /></>;
  if (q.error) return <>{head}<Notice error={q.error} /></>;
  const all = A.places;
  const sections = [
    can('places.review') && [can('places.publish') ? 'Waiting for approval' : 'Waiting for verification', can('places.publish') ? 'Entered by data-entry staff. Check details, photos and pin, then approve to publish in one step, or return with a note.' : 'Check the details, photos and pin against the site and landmarks.', all.filter((p) => p.status === 'submitted'), can('places.publish') ? 'approve' : 'verify'],
    can('places.publish') && ['Ready to approve and publish', 'Verified by a reviewer. Publishing makes them visible to the public.', all.filter((p) => p.status === 'verified'), 'publish'],
    ['Returned for correction', 'Fix what the reviewer asked for, then submit again.', all.filter((p) => p.status === 'needs_correction' && (isOwn(p) || can('places.review'))), 'edit'],
    ['Drafts', 'Not yet submitted.', all.filter((p) => p.status === 'draft' && (isOwn(p) || can('places.review'))), 'submit'],
    can('places.review') && ['Due for periodic review', 'Published records past their review date. Confirm they are still correct.', all.filter((p) => p.stale), 'reviewed'],
  ].filter(Boolean);
  const wf = async (p, a) => {
    let note = '';
    if (a === 'return') { note = await confirmDlg('Return for correction', 'What needs fixing?', { okLabel: 'Return', note: 'Note for the contributor' }); if (note === null) return; }
    const x = await api.workflow(p.id, a, note); toast(`${x.name}: ${STATUS_LABELS[x.status]}`); refreshCounts(); q.reload();
  };
  const Buttons = ({ p, act }) => {
    const own = isOwn(p) && !A.config?.settings?.['workflow.allow_self_approval'];
    const label = { approve: 'Approve', verify: 'Verify', publish: 'Publish' }[act];
    return <>
      <button className="btn sm" onClick={() => nav('places/' + p.id)}>Open</button>
      {label ? <><BusyButton className="btn sm" onClick={() => wf(p, 'return')}>Return…</BusyButton><BusyButton className="btn sm primary" disabled={own} title={own ? 'You created or submitted this' : undefined} onClick={() => wf(p, act)}>{label}</BusyButton></> : null}
      {act === 'submit' && can('places.submit') ? <BusyButton className="btn sm primary" onClick={() => wf(p, 'submit')}>Submit</BusyButton> : null}
      {act === 'reviewed' ? <BusyButton className="btn sm primary" onClick={async () => { await api.markReviewed(p.id); toast('Marked as reviewed'); q.reload(); }}>Still accurate</BusyButton> : null}
    </>;
  };
  return (
    <>{head}{sections.map(([title, help, list, act]) => (
      <div key={title} className="card"><h3>{title} <span className="help">{list.length}</span></h3><p className="help" style={{ margin: '-8px 0 12px' }}>{help}</p>
        {list.length ? <div className="tbl-wrap"><table className="tbl"><tbody>{list.slice(0, 100).map((p) => (
          <tr key={p.id}>
            <td><NavLink className="rowlink" to={'places/' + p.id}><SectorDot sector={p.sector} /><span>{p.name}<span className="sub">{typeLabel(p.sector, p.type)} · {subcityCode(p.subcity_id)}</span></span></NavLink></td>
            <td><Flags p={p} />{p.workflow_note && p.status === 'needs_correction' ? <span className="sub">“{p.workflow_note}”</span> : null}</td>
            <td className="muted">{relTime(p.status === 'published' ? p.review_due : p.updated_at)}</td>
            <td><div className="acts"><Buttons p={p} act={act} /></div></td></tr>
        ))}</tbody></table></div> : <p className="help">Nothing here.</p>}</div>
    ))}</>
  );
}
export { NavButton };
