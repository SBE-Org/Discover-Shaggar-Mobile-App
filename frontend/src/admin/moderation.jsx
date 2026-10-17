// Public input: suggestions (new places and corrections), problem reports, and visitor photos & menus.
import { useState } from 'react';
import { SECTORS, TYPES, typeLabel, REPORT_TYPES, REPORT_STATUSES, PHOTO_RIGHTS, STATUS_LABELS, isTypeActive } from '../shared/catalog.js';
import { formatLatLon } from '../shared/coords.js';
import {
  api, toast, can, subLabel, PageHead, Loading, Empty, Fld, Sel, subcityOptions, val, useFormErrors, openDialog, closeDialog, Dlg, confirmDlg,
  relTime, fmtDateTime, invalidatePlaces, loadUsers, refreshCounts, useAsync, Notice, NavButton, nav, BusyButton, Icon,
} from './core.jsx';

const Seg = ({ opts, cur, set }) => (
  <div className="seg" style={{ margin: 0 }}>{opts.map(([k, l]) => <button key={k} aria-pressed={String(cur === k)} onClick={() => set(k)}>{l}</button>)}</div>
);

/* ---------- suggestions ---------- */
let sugTabSaved = 'new';
const FIELDS = [['name', 'Name'], ['sector', 'Category group'], ['type', 'Category'], ['subcity_id', 'Sub-city'], ['woreda', 'Woreda'], ['kebele', 'Landmark'], ['description', 'Description'], ['phone', 'Phone'], ['hours', 'Hours'], ['website', 'Website'], ['fee', 'Fee']];

export function SuggestionsView() {
  const [tab, setTabRaw] = useState(sugTabSaved);
  const setTab = (t) => { sugTabSaved = t; setTabRaw(t); };
  const q = useAsync(() => api.suggestions(tab).then((r) => r.items), [tab]);
  const head = <PageHead title="Suggestions" sub="New places and corrections sent by residents and visitors. Nothing changes until you accept it."
    right={<Seg opts={[['new', 'To review'], ['accepted', 'Accepted'], ['rejected', 'Rejected']]} cur={tab} set={setTab} />} />;
  if (q.error) return <>{head}<Notice error={q.error} /></>;
  if (!q.data) return <>{head}<Loading n={4} /></>;
  const sugs = q.data;
  const after = () => { refreshCounts(); q.reload(); };
  const reject = async (s) => {
    const reason = await confirmDlg('Reject suggestion', 'Reject this suggestion? Any photo sent with it is deleted.', { okLabel: 'Reject', danger: true, note: 'Note (optional)' });
    if (reason === null) return;
    try { await api.reject(s.id, reason); toast('Suggestion rejected'); after(); } catch (e) { toast(e.message, 'bad'); }
  };
  const open = async (s) => {
    if (s.place_id) {
      let cur = {};
      try { cur = await api.place(s.place_id); } catch { /* deleted */ }
      openDialog(() => <CorrectionDialog s={s} cur={cur} after={after} />);
      return;
    }
    openDialog(() => <NewPlaceDialog s={s} after={after} />);
  };
  return (
    <>{head}
      {sugs.length ? <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Suggestion</th><th>Location</th><th>From</th><th>Received</th><th></th></tr></thead><tbody>
        {sugs.map((s) => { const d = s.data || {}; return (
          <tr key={s.id}><td><b>{d.name}</b><span className="sub">{s.place_id ? <>Correction to <NavButton style={{ padding: 0 }} to={'places/' + s.place_id}>{s.place_name || 'a place'}</NavButton></> : 'New place'} · {typeLabel(d.sector, d.type)}{s.photo ? ' · with photo' : ''}</span></td>
            <td className="mono">{formatLatLon(s.lat, s.lon)}<span className="sub">{s.accuracy_m ? '±' + Math.round(s.accuracy_m) + ' m GPS · ' : ''}{subLabel(s.subcity_id)}</span></td>
            <td>{s.contact_name || 'Anonymous'}<span className="sub mono">{s.contact_phone || ''}</span></td><td className="muted">{relTime(s.created_at)}{s.reviewer ? <span className="sub">by {s.reviewer}</span> : null}</td>
            <td><div className="acts">{tab === 'new' ? <><button className="btn sm danger" onClick={() => reject(s)}>Reject</button><BusyButton className="btn sm primary" onClick={() => open(s)}>Review</BusyButton></> : s.place_id ? <button className="btn sm" onClick={() => nav('places/' + s.place_id)}>Open place</button> : null}</div></td></tr>
        ); })}
      </tbody></table></div> : <div className="card"><Empty title={tab === 'new' ? 'Inbox zero' : 'Nothing here'} text={tab === 'new' ? 'New suggestions from the public app appear here.' : ''} icon="inbox" /></div>}
    </>
  );
}

function CorrectionDialog({ s, cur, after }) {
  const d = s.data || {};
  const [msg, setMsg] = useState('');
  const show = (k, v) => (k === 'sector' ? SECTORS[v]?.label : k === 'type' ? typeLabel(d.sector || cur.sector, v) : k === 'subcity_id' ? subLabel(v) : v) ?? '';
  const rows = [...FIELDS, ['coords', 'Location']].map(([k, l]) => {
    const now = k === 'coords' ? (cur.lat != null ? formatLatLon(cur.lat, cur.lon) : '') : cur[k];
    const prop = k === 'coords' ? formatLatLon(s.lat, s.lon) : d[k];
    if (prop === undefined || prop === '' || String(prop) === String(now ?? '')) return null;
    return [<div key={k + 'h'} className="h" style={{ background: 'none', textTransform: 'none', letterSpacing: 0, font: '600 12.5px var(--f-body)' }}><label className="check" style={{ minHeight: 0 }}><input type="checkbox" id={'sf-' + k} defaultChecked />{l}</label></div>,
      <div key={k + 'n'}>{show(k, now) || <span className="muted">empty</span>}</div>, <div key={k + 'p'} className="chg">{show(k, prop)}</div>];
  }).filter(Boolean);
  const apply = async () => {
    const body = {};
    for (const [k] of FIELDS) if (val('sf-' + k)) body[k] = d[k];
    if (val('sf-coords')) body.coords = formatLatLon(s.lat, s.lon);
    if ((body.type || body.sector) && !body.sector) body.sector = d.sector;
    if (body.sector && !body.type) body.type = d.type;
    body.use_photo = !!val('sf-photo');
    try { await api.accept(s.id, body); closeDialog(); invalidatePlaces(); toast('Correction applied'); after(); } catch (e) { setMsg(e.message); }
  };
  return (
    <Dlg title="Review correction" wide foot={<><button className="btn" onClick={closeDialog}>Cancel</button><BusyButton className="btn primary" onClick={apply}>Apply ticked changes</BusyButton></>}>
      <p className="help" style={{ marginBottom: 10 }}>Tick the changes to apply to <b>{cur.name || 'the place'}</b>. The current record stays as it is for anything you leave unticked.</p>
      <div className="compare"><div className="h">Field</div><div className="h">Current</div><div className="h">Proposed</div>{rows.length ? rows : <div style={{ gridColumn: '1/-1' }} className="help">No differences found.</div>}</div>
      {s.photo ? <div style={{ marginTop: 12 }}><img src={s.photo} alt="" style={{ maxWidth: 240, borderRadius: 12 }} /><label className="check"><input type="checkbox" id="sf-photo" defaultChecked />Add this photo ({s.photo_consent ? 'sender gave permission' : 'rights not confirmed'})</label></div> : null}
      <p className="help" style={{ marginTop: 10 }}>Sent by {s.contact_name || 'an anonymous visitor'} {s.contact_phone || ''} · {fmtDateTime(s.created_at)}</p><p className="formerr">{msg}</p>
    </Dlg>
  );
}

function NewPlaceDialog({ s, after }) {
  const d = s.data || {};
  const f = useFormErrors();
  const [sector, setSector] = useState(d.sector);
  const sectorOpts = Object.keys(SECTORS).filter((k) => SECTORS[k].active !== false).map((k) => [k, SECTORS[k].label]);
  const E = f.errors;
  const accept = async () => {
    const body = {};
    for (const k of ['name', 'sector', 'type', 'coords', 'phone', 'woreda', 'kebele', 'hours', 'website', 'description']) body[k] = val('sg-' + k);
    body.subcity_id = Number(val('sg-subcity_id'));
    body.status = val('sg-status');
    body.use_photo = document.getElementById('sg-usephoto') ? val('sg-usephoto') : false;
    if (document.getElementById('sg-photo_rights')) body.photo_rights = val('sg-photo_rights');
    try {
      const p = await api.accept(s.id, body);
      closeDialog(); invalidatePlaces();
      toast(`${p.name} added as ${STATUS_LABELS[p.status]}`);
      after();
    } catch (e) { f.setErrors(e.details || {}, e.message); }
  };
  return (
    <Dlg title="Review new place" wide foot={<><button className="btn" onClick={closeDialog}>Cancel</button><BusyButton className="btn primary" onClick={accept}>Accept</BusyButton></>}>
      <div ref={f.ref}><div className="fgrid">
        <Fld k="name" label="Name" errors={E}><input id="sg-name" defaultValue={d.name} /></Fld>
        <Fld k="subcity_id" label="Sub-city" errors={E}><Sel id="sg-subcity_id" opts={subcityOptions()} cur={String(d.subcity_id ?? '')} /></Fld>
        <Fld k="sector" label="Category group" errors={E}><Sel id="sg-sector" opts={sectorOpts} cur={d.sector} onChange={(e) => setSector(e.target.value)} /></Fld>
        <Fld k="type" label="Category" errors={E}><Sel key={sector} id="sg-type" opts={Object.entries(TYPES[sector] || {}).filter(([k]) => isTypeActive(sector, k))} cur={sector === d.sector ? d.type : ''} /></Fld>
        <Fld k="coords" label="Coordinates" errors={E} help={<><a href={`https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}`} target="_blank" rel="noopener">Check in Google Maps</a>{s.accuracy_m ? ` · sent with ±${Math.round(s.accuracy_m)} m GPS` : ' · typed or picked by the sender'}</>}><input id="sg-coords" defaultValue={formatLatLon(s.lat, s.lon)} className="mono" /></Fld>
        <Fld k="phone" label="Phone" errors={E}><input id="sg-phone" defaultValue={d.phone} /></Fld>
        <Fld k="woreda" label="Woreda" errors={E}><input id="sg-woreda" defaultValue={d.woreda} /></Fld><Fld k="kebele" label="Landmark" errors={E}><input id="sg-kebele" defaultValue={d.kebele} /></Fld>
        <Fld k="hours" label="Hours" errors={E}><input id="sg-hours" defaultValue={d.hours} /></Fld><Fld k="website" label="Website" errors={E}><input id="sg-website" defaultValue={d.website} /></Fld>
        <div className="wide"><Fld k="description" label="Description" errors={E}><textarea id="sg-description" defaultValue={d.description} rows={3} /></Fld></div>
        {s.photo ? <div className="wide" style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}><img src={s.photo} alt="" style={{ width: 180, borderRadius: 12 }} /><div className="sect"><label className="check"><input type="checkbox" id="sg-usephoto" defaultChecked />Use this photo</label>
          {s.photo_consent ? <span className="help">The sender confirmed they took it and allow publication.</span> : <Fld k="photo_rights" label="Photo rights" errors={E}><Sel id="sg-photo_rights" opts={Object.entries(PHOTO_RIGHTS).filter(([k]) => k !== 'withdrawn' && k !== 'bureau')} cur="unknown" /></Fld>}</div></div> : null}
        <div className="wide"><Fld k="status" label="After accepting" errors={E}><Sel id="sg-status" opts={[['submitted', 'Put it in the review queue (Submitted)'], ...(can('places.review') ? [['verified', 'I have checked it: mark Verified']] : []), ...(can('places.publish') ? [['published', 'Publish now']] : [])]} cur={can('places.review') ? 'verified' : 'submitted'} /></Fld></div>
      </div><p className="help">Sent by {s.contact_name || 'an anonymous visitor'} <span className="mono">{s.contact_phone || ''}</span> · {fmtDateTime(s.created_at)}</p><p className="formerr">{f.msg}</p></div>
    </Dlg>
  );
}

/* ---------- problem reports ---------- */
let repTabSaved = 'active';
export function ReportsView() {
  const [tab, setTabRaw] = useState(repTabSaved);
  const setTab = (t) => { repTabSaved = t; setTabRaw(t); };
  const q = useAsync(() => api.reports(tab).then((r) => r.items), [tab]);
  const head = <PageHead title="Problem reports" sub="Wrong pins, closed places, broken links and other issues reported from the app. Each has a code the sender can track."
    right={<Seg opts={[['active', 'Open'], ['resolved', 'Resolved'], ['rejected', 'Not accepted'], ['', 'All']]} cur={tab} set={setTab} />} />;
  if (q.error) return <>{head}<Notice error={q.error} /></>;
  if (!q.data) return <>{head}<Loading n={4} /></>;
  const reps = q.data;
  const open = async (r) => {
    const staff = (await loadUsers().catch(() => [])).filter((u) => u.active);
    openDialog(() => <ReportDialog r={r} staff={staff} after={() => { refreshCounts(); q.reload(); }} />);
  };
  return (
    <>{head}
      {reps.length ? <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Code</th><th>Problem</th><th>About</th><th>Status</th><th>Received</th><th></th></tr></thead><tbody>
        {reps.map((r) => (
          <tr key={r.id}><td className="mono">{r.code}</td><td><b>{REPORT_TYPES[r.issue_type] || r.issue_type}</b><span className="sub">{(r.description || '').slice(0, 90)}</span></td>
            <td>{r.place_id ? <NavButton style={{ padding: 0 }} to={'places/' + r.place_id}>{r.place_name || 'Place'}</NavButton> : r.trip_id ? <NavButton style={{ padding: 0 }} to={'trips/' + r.trip_id}>{r.trip_title || 'Trip'}</NavButton> : <span className="muted">General</span>}</td>
            <td><span className={'pill st-' + r.status}>{REPORT_STATUSES[r.status]}</span>{r.assignee ? <span className="sub">{r.assignee}</span> : null}</td><td className="muted">{relTime(r.created_at)}</td>
            <td><div className="acts"><BusyButton className="btn sm primary" onClick={() => open(r)}>Handle</BusyButton></div></td></tr>
        ))}</tbody></table></div> : <div className="card"><Empty title="No reports here" icon="flag" /></div>}
    </>
  );
}

function ReportDialog({ r, staff, after }) {
  const [msg, setMsg] = useState('');
  const save = async () => {
    const body = { status: val('rp-status'), resolution: val('rp-resolution') };
    if (document.getElementById('rp-assigned')) body.assigned_to = val('rp-assigned') || null;
    try { await api.updateReport(r.id, body); closeDialog(); toast('Report updated'); after(); } catch (e) { setMsg(e.message); }
  };
  return (
    <Dlg title={'Report ' + r.code} foot={<><button className="btn" onClick={closeDialog}>Cancel</button><BusyButton className="btn primary" onClick={save}>Save</BusyButton></>}>
      <div className="sect">
        <div><b>{REPORT_TYPES[r.issue_type]}</b>{r.place_name ? ` · ${r.place_name}` : ''}<p style={{ marginTop: 6, whiteSpace: 'pre-line' }}>{r.description || 'No description.'}</p>
          <p className="help" style={{ marginTop: 6 }}>{fmtDateTime(r.created_at)}{r.contact ? <> · contact: <span className="mono">{r.contact}</span></> : ' · no contact given'}</p></div>
        <div className="fgrid"><Fld k="status" label="Status"><Sel id="rp-status" opts={Object.entries(REPORT_STATUSES)} cur={r.status} /></Fld>
          {staff.length ? <Fld k="assigned_to" label="Assigned to"><Sel id="rp-assigned" opts={[['', 'Nobody'], ...staff.map((u) => [String(u.id), u.name])]} cur={String(r.assigned_to ?? '')} /></Fld> : <div />}</div>
        <Fld k="resolution" label="Resolution note (the sender sees this when they track the code)"><textarea id="rp-resolution" defaultValue={r.resolution} rows={3} maxLength={1000} /></Fld>
        {r.place_id && can('places.edit') ? <button className="btn sm" onClick={() => nav('places/' + r.place_id)}><Icon n="edit" />Open the place to fix it</button> : null}<p className="formerr">{msg}</p></div>
    </Dlg>
  );
}

/* ---------- visitor photos & menus ---------- */
let coSaved = { tab: 'pending', kind: '' };
export function ContributionsView() {
  const [st, setSt] = useState(coSaved);
  const set = (k) => (v) => { coSaved = { ...st, [k]: v }; setSt(coSaved); };
  const q = useAsync(() => api.contributions({ status: st.tab, kind: st.kind }).then((r) => r.items), [st.tab, st.kind]);
  const done = (msg) => { closeDialog(); toast(msg); refreshCounts(); q.reload(); };
  const head = <PageHead title="Visitor photos & menus" sub="Photos shared by visitors and menu items added by customers or data-entry staff. Nothing appears in the app until it is approved."
    right={<><Seg opts={[['', 'All'], ['photo', 'Photos'], ['menu', 'Menu items']]} cur={st.kind} set={set('kind')} /><Seg opts={[['pending', 'To approve'], ['approved', 'Approved'], ['rejected', 'Rejected']]} cur={st.tab} set={set('tab')} /></>} />;
  let body;
  if (q.error) body = <Notice error={q.error} />;
  else if (!q.data) body = <Loading n={4} />;
  else if (!q.data.length) body = <div className="card"><Empty title={st.tab === 'pending' ? 'Nothing waiting' : 'Nothing here'} text={st.tab === 'pending' ? 'Photos and menu items from the app appear here for approval.' : ''} icon="camera" /></div>;
  else body = <div className="pgrid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))' }}>{q.data.map((c) => <CoCard key={c.kind + c.id} c={c} done={done} />)}</div>;
  return <>{head}<div id="coList">{body}</div></>;
}

function CoCard({ c, done }) {
  const img = c.kind === 'photo' ? c.url : c.photo;
  const approve = () => api.decide(c.kind, c.id, 'approve').then(() => done('Approved and published'));
  const reject = () => openDialog(() => <Dlg title="Reject" foot={<><button className="btn" onClick={closeDialog}>Cancel</button><BusyButton className="btn danger solid" onClick={() => api.decide(c.kind, c.id, 'reject', { note: val('co-note') }).then(() => done('Rejected'))}>Reject</BusyButton></>}>
    <p>Tell the team why (optional). The {c.kind === 'photo' ? 'photo is deleted' : 'item is not published'}.</p><div className="sect" style={{ marginTop: 12 }}><Fld k="note" label="Reason"><input id="co-note" placeholder="Blurry, shows people up close, wrong place…" /></Fld></div></Dlg>);
  const edit = () => openDialog(() => <Dlg title={c.kind === 'photo' ? 'Edit and approve photo' : 'Edit and approve menu item'} wide foot={<><button className="btn" onClick={closeDialog}>Cancel</button><BusyButton className="btn primary" onClick={() => {
    const b = c.kind === 'photo' ? { caption: val('co-caption') } : { edits: { name: val('co-name'), price: val('co-price'), section: val('co-section'), description: val('co-desc') } };
    return api.decide(c.kind, c.id, 'approve', b).then(() => done('Approved'));
  }}><Icon n="check" />Save and approve</BusyButton></>}>
    <div className="sect">{c.kind === 'photo' ? <><img src={c.url} alt="" style={{ width: '100%', borderRadius: 12, marginBottom: 12 }} /><Fld k="caption" label="Caption"><input id="co-caption" defaultValue={c.caption} maxLength={200} /></Fld></>
      : <div className="fgrid"><Fld k="name" label="Name"><input id="co-name" defaultValue={c.name} /></Fld><Fld k="price" label="Price (ETB)"><input id="co-price" defaultValue={c.price ?? ''} inputMode="decimal" /></Fld><Fld k="section" label="Section"><input id="co-section" defaultValue={c.section} /></Fld><Fld k="description" label="Description"><input id="co-desc" defaultValue={c.description} /></Fld></div>}</div>
  </Dlg>);
  const view = () => openDialog(() => <Dlg title={c.caption || c.name || 'Photo'} wide><img src={c.url || c.photo} alt="" style={{ width: '100%', borderRadius: 12 }} /></Dlg>);
  return (
    <div className="pcard">{img ? <img src={img} alt="" loading="lazy" onClick={view} style={{ cursor: 'zoom-in' }} /> : <div style={{ aspectRatio: '4/3', display: 'grid', placeItems: 'center', background: 'var(--brand-tint)', color: 'var(--brand)' }}><Icon n="list" /></div>}
      <div className="pb"><b>{c.kind === 'photo' ? c.caption || 'Visitor photo' : <>{c.name}{c.price != null ? <> · <span className="mono">ETB {c.price}</span></> : null}</>}</b>
        <span className="help">{c.kind === 'photo' ? 'Photo' : 'Menu · ' + c.section} for <NavButton style={{ padding: 0 }} to={'places/' + c.place_id}>{c.place_name}</NavButton> · {subLabel(c.subcity_id)}</span>
        <span className="help">From {c.submitter_name || c.creator || (c.source === 'staff' ? 'staff' : 'an anonymous visitor')}{c.contact ? <> · <span className="mono">{c.contact}</span></> : null} · {relTime(c.created_at)}</span>
        {c.description ? <span className="help">{c.description}</span> : null}
        {c.reviewer ? <span className="help">{c.status === 'approved' ? 'Approved' : 'Rejected'} by {c.reviewer}{c.review_note ? ': “' + c.review_note + '”' : ''}</span> : null}
        {c.status === 'pending' ? <div className="row2"><BusyButton className="btn sm primary" onClick={approve}><Icon n="check" />Approve</BusyButton><button className="btn sm" onClick={edit}>Edit &amp; approve</button><button className="btn sm danger" onClick={reject}>Reject</button></div> : null}</div></div>
  );
}
