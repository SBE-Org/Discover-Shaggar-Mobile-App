// Mobile Admin page: staff sign-in (with two-step codes), a task queue with one-tap review actions, field capture,
// the public inbox, quick trip and announcement updates, sub-city centres and recent activity.
// Everything is limited by the person's role; the full toolset is in the admin web portal (/admin).
import { useEffect, useState } from 'react';
import { SECTORS, SECTOR_IDS, STATUSES, STATUS_LABELS, WORKFLOW, NEXT_ACTION, REPORT_TYPES, REPORT_STATUSES, TRIP_STATUSES, TRIP_STATUS_LABELS, typeLabel } from '../shared/catalog.js';
import { parseCoords, formatLatLon } from '../shared/coords.js';
import { Icon, SectorBadge, toast, fmtDate } from '../lib/util.js';
import { api } from '../lib/api.js';
import { S, data, actions, emit, can, isStaff, subName, subPhone, subCentre, subcityCode, SUBCITY_IDS, loadEditorData, loadPublic, upsertLocal, openModal } from '../lib/store.js';
import { openEditor, draftFromPlace, draftFromSuggestion, blankDraft } from './editor.jsx';
import { ModalHead, ConfirmButton, Empty } from './common.jsx';

// Data loaded on demand for some tabs (kept between visits, like before).
const cache = { activity: null, trips: null, anns: null, contribs: null };
let mfaTicket = null;
const rel = (iso) => { const s = (Date.now() - new Date(iso)) / 1000; return s < 3600 ? Math.max(1, Math.round(s / 60)) + ' min' : s < 86400 ? Math.round(s / 3600) + ' h' : Math.round(s / 86400) + ' d'; };
const isOwn = (p) => p.created_by === S.me?.id || p.submitted_by === S.me?.id;
const selfOk = () => !!S.config?.settings?.['workflow.allow_self_approval'];
const Skel = ({ n = 1 }) => Array.from({ length: n }, (_, i) => <div key={i} className="skeleton" />);

export function Staff() {
  if (!S.me) return <Login />;
  if (S.me.must_change_password) return <ForcePassword />;
  if (!isStaff()) return <div className="card"><div className="empty">Your account has no admin access yet. Ask a Bureau administrator to give you a role.</div><button className="btn block" onClick={actions.logout}><Icon n="logout" />Sign out</button></div>;
  const tabs = [['tasks', 'Tasks']];
  if (can('places.view')) tabs.push(['places', 'Places']);
  const inboxN = data.suggestions.length + data.reports.length + (data.stats?.contributions || 0);
  if (can('moderation.manage') || can('contributions.manage')) tabs.push(['inbox', 'Inbox' + (inboxN ? ' · ' + inboxN : '')]);
  if (can('trips.manage')) tabs.push(['trips', 'Trips']);
  if (can('content.manage')) tabs.push(['news', 'News']);
  if (can('areas.manage')) tabs.push(['areas', 'Areas']);
  if (can('audit.view')) tabs.push(['activity', 'Activity']);
  if (!tabs.some(([k]) => k === S.btab)) S.btab = 'tasks';
  const Body = { tasks: Tasks, places: PlacesTab, inbox: Inbox, trips: TripsTab, news: NewsTab, areas: AreasTab, activity: ActivityTab }[S.btab] || Tasks;
  return (
    <div>
      <header className="ph"><div><h1>City <em>Admin</em></h1><p>Capture, review and publish. Use the admin web portal on a computer for everything else.</p></div></header>
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
        <div className="whoami"><span className="avatar">{(S.me.name || '?').slice(0, 1).toUpperCase()}</span><div><b>{S.me.name}</b><div className="help">{S.me.role_name}{S.me.subcity_id != null ? ' · ' + subName(S.me.subcity_id) : ' · whole city'}</div></div></div>
        <div style={{ display: 'flex', gap: 6 }}><a className="iconbtn" href="/admin" target="_blank" rel="noopener" aria-label="Open the admin web portal" title="Admin portal"><Icon n="ext" /></a><button className="iconbtn" onClick={actions.logout} aria-label="Sign out" title="Sign out"><Icon n="logout" /></button></div>
      </div>
      {S.me.mfa_gate ? <div className="notice">Turn on two-step sign-in in the admin portal (My account) to unlock publishing.</div> : null}
      <div className="seg" role="group" aria-label="Section">{tabs.map(([k, l]) => <button key={k} aria-pressed={String(S.btab === k)} onClick={() => { S.btab = k; if (k === 'inbox') cache.contribs = null; if (k === 'activity') cache.activity = null; if (k === 'trips') cache.trips = null; if (k === 'news') cache.anns = null; emit(); }}>{l}</button>)}</div>
      <div id="bBody"><Body /></div>
    </div>
  );
}

/* ---------- sign in ---------- */
async function afterLogin() {
  const cfg = await api.config();
  S.config = cfg; S.me = cfg.user; S.btab = 'tasks';
  await Promise.all([loadPublic(), loadEditorData()]);
  toast('Welcome, ' + S.me.name);
}
function Login() {
  const [email, setEmail] = useState(''), [pass, setPass] = useState(''), [code, setCode] = useState('');
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false), [, setStep] = useState(0);
  const login = async () => {
    if (!email.trim() || !pass) { setErr('Enter your email and password.'); return; }
    setBusy(true);
    try {
      const r = await api.login(email.trim(), pass);
      if (r.mfa_required) { mfaTicket = r.ticket; setBusy(false); setErr(''); setStep((n) => n + 1); return; }
      await afterLogin();
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  const verify = async () => {
    setBusy(true);
    try { await api.loginMfa(mfaTicket, code.trim()); mfaTicket = null; await afterLogin(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); (mfaTicket ? verify : login)(); } };
  return (
    <div className="login"><div className="card">
      <div className="mark"><Icon n="shield" /></div>
      {mfaTicket ? <>
        <h2 style={{ fontSize: 22 }}>Two-step sign-in</h2><p className="help" style={{ margin: '6px 0 18px' }}>Enter the 6-digit code from your authenticator app.</p>
        <form className="form" id="loginForm" onSubmit={(e) => e.preventDefault()} onKeyDown={onKey}><label className="f"><span>Code</span><input id="lg-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} /></label>
          <p className="formerr" id="lgErr" role="alert">{err}</p><button className="btn primary block" id="lgBtn" disabled={busy} onClick={verify}>Verify</button><button className="btn block" type="button" style={{ marginTop: 8 }} onClick={() => { mfaTicket = null; setErr(''); setStep((n) => n + 1); }}>Start again</button></form>
      </> : <>
        <h2 style={{ fontSize: 22 }}>Staff sign in</h2>
        <p className="help" style={{ margin: '6px 0 18px' }}>For Tourism Bureau and sub-city staff who capture, review and publish places, trips and news. Residents can suggest places without an account.</p>
        <form className="form" id="loginForm" onSubmit={(e) => e.preventDefault()} onKeyDown={onKey}>
          <label className="f"><span>Email</span><input id="lg-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="f"><span>Password</span><input id="lg-pass" type="password" autoComplete="current-password" required value={pass} onChange={(e) => setPass(e.target.value)} /></label>
          <p className="formerr" id="lgErr" role="alert">{err}</p>
          <button className="btn primary block" id="lgBtn" disabled={busy} onClick={login}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <button className="btn block" style={{ marginTop: 10 }} onClick={actions.addPlace}><Icon n="plus" />Suggest a place instead</button>
      </>}
    </div></div>
  );
}
actions.logout = async () => {
  try { await api.logout(); } catch { /* signed out anyway */ }
  S.me = null; data.all = null; data.suggestions = []; data.reports = []; data.stats = null;
  Object.keys(cache).forEach((k) => { cache[k] = null; });
  emit(); toast('Signed out');
};

function ForcePassword() {
  const [cur, setCur] = useState(''), [next, setNext] = useState(''), [err, setErr] = useState('');
  return (
    <div className="login"><div className="card"><div className="mark"><Icon n="key" /></div><h2 style={{ fontSize: 22 }}>Choose your password</h2>
      <p className="help" style={{ margin: '6px 0 18px' }}>You signed in with a temporary password. Choose your own to continue.</p>
      <form className="form" onSubmit={(e) => e.preventDefault()}><label className="f"><span>Temporary password</span><input id="pw-cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></label>
        <label className="f"><span>New password</span><input id="pw-new" type="password" autoComplete="new-password" placeholder="10+ letters and numbers" value={next} onChange={(e) => setNext(e.target.value)} /></label>
        <p className="formerr" id="pwErr">{err}</p>
        <button className="btn primary block" onClick={async () => { try { await api.changePassword(cur, next); toast('Password updated'); await afterLogin(); } catch (e) { setErr(e.message); } }}>Save password</button>
        <button className="btn block" type="button" style={{ marginTop: 8 }} onClick={actions.logout}>Sign out</button></form></div></div>
  );
}

/* ---------- tasks ---------- */
async function runWf(id, action, note = '') {
  const p = await api.workflow(id, action, note);
  upsertLocal(p);
  toast(`${p.name}: ${STATUS_LABELS[p.status]}`);
  await loadEditorData();
}
const editPlace = async (id) => {
  let p = data.byId.get(id); if (!p) return;
  try { p = Object.assign(p, await api.place(p.id)); } catch { /* summary is enough */ }
  openEditor(draftFromPlace(p, 'edit'));
};

function WfNote({ id, a }) {
  const w = WORKFLOW[a];
  const p = data.byId.get(id);
  const [note, setNote] = useState(''), [err, setErr] = useState('');
  return (
    <>
      <ModalHead title={w.label} />
      <div className="mbody"><form className="form" onSubmit={(e) => e.preventDefault()}><div className="info">{p?.name || ''}</div><label className="f"><span>What needs fixing?</span><textarea id="wf-note" maxLength={1000} placeholder="Add a photo of the entrance; the pin is on the wrong side of the road" value={note} onChange={(e) => setNote(e.target.value)} /></label><p className="formerr" id="wfErr">{err}</p></form></div>
      <div className="mfoot"><button className="btn" onClick={actions.closeModal}>Cancel</button><button className="btn primary" onClick={async () => {
        if (!note.trim()) { setErr('Add a short note.'); return; }
        try { await runWf(id, a, note.trim()); actions.closeModal(); } catch (e) { setErr(e.message); }
      }}>{w.label}</button></div>
    </>
  );
}

function WfButton({ p, a, primary, label }) {
  const [busy, setBusy] = useState(false);
  const w = WORKFLOW[a];
  const blocked = w.own === false && isOwn(p) && !selfOk();
  return (
    <button className={'btn sm' + (primary ? ' primary' : '')} disabled={blocked || busy} title={blocked ? 'Another reviewer must do this' : undefined} onClick={async () => {
      if (w.note) { openModal(() => <WfNote id={p.id} a={a} />); return; }
      setBusy(true);
      try { await runWf(p.id, a); } catch (e) { toast(e.message, 'bad'); setBusy(false); }
    }}>{label || (a === 'return' ? 'Return' : a === 'approve' ? 'Approve' : w.label.replace('Submit for review', 'Submit'))}</button>
  );
}

function ReviewedButton({ p }) {
  const [busy, setBusy] = useState(false);
  return <button className="btn sm primary" disabled={busy} onClick={async () => { setBusy(true); try { const x = await api.markReviewed(p.id); upsertLocal(x); toast('Marked as reviewed today'); await loadEditorData(); } catch (e) { toast(e.message, 'bad'); setBusy(false); } }}>Still accurate</button>;
}

const RowWithActions = ({ p, children }) => (
  <div className="arow wf"><button className="row" onClick={() => editPlace(p.id)}><SectorBadge sector={p.sector} /><span className="rt"><b>{p.name}</b><small>{typeLabel(p.sector, p.type)} · {subcityCode(p.subcity_id)} · {rel(p.updated_at)}{p.workflow_note && p.status === 'needs_correction' ? ' · “' + p.workflow_note + '”' : ''}</small></span></button>{children}</div>
);

function Tasks() {
  const all = data.all || [];
  const s = data.stats;
  const tv = can('places.review') ? all.filter((p) => p.status === 'submitted') : [];
  const tp = can('places.publish') ? all.filter((p) => p.status === 'verified') : [];
  const mine = all.filter((p) => isOwn(p) && ['draft', 'needs_correction'].includes(p.status));
  const overdue = can('places.review') ? all.filter((p) => p.stale) : [];
  const Section = ({ title, list, btns, help }) => (list.length ? <>
    <h3 className="sech">{title} · {list.length}</h3>{help ? <p className="help" style={{ margin: '-4px 4px 8px' }}>{help}</p> : null}
    <div className="card list-card">{list.slice(0, 30).map((p) => <RowWithActions key={p.id} p={p}>{btns(p)}</RowWithActions>)}</div></> : null);
  const anyTask = tv.length + tp.length + mine.length + overdue.length;
  return (
    <>
      {can('places.create') ? <button className="capture" onClick={() => openEditor(blankDraft())}><Icon n="locate" /><span><b>Capture a place</b><small>Stand at the entrance, record GPS, add photos and details</small></span><Icon n="chev" /></button> : null}
      {s ? <div className="tiles"><div className="tile hot"><span className="label">Places</span><div className="v">{s.total}</div></div><div className="tile"><span className="label">Published</span><div className="v">{s.published}</div></div>
        <div className="tile"><span className="label">To review</span><div className="v" style={tv.length + tp.length ? { color: 'var(--warn)' } : undefined}>{tv.length + tp.length}</div></div><div className="tile"><span className="label">Overdue review</span><div className="v" style={s.overdue ? { color: 'var(--bad)' } : undefined}>{s.overdue}</div></div></div> : null}
      <Section title={can('places.publish') ? 'Waiting for your approval' : 'Waiting for verification'} list={tv} btns={(p) => <><WfButton p={p} a="return" /><WfButton p={p} a={can('places.publish') ? 'approve' : 'verify'} primary /></>}
        help={can('places.publish') ? 'Data entered by your team. Check details, photos and pin, then approve to publish, or return it with a note.' : 'Check details, photos and pin against the site.'} />
      <Section title="Ready to publish" list={tp} btns={(p) => <><WfButton p={p} a="return" /><WfButton p={p} a="publish" primary /></>} />
      {!can('places.review') && can('places.submit') ? <p className="help" style={{ margin: '4px 4px 0' }}>When you tap <b>Submit</b>, your sub-city supervisor checks the record and approves it, or returns it to you with a note.</p> : null}
      <Section title="Your drafts and returned records" list={mine} btns={(p) => (can('places.submit') ? <WfButton p={p} a="submit" primary /> : null)} />
      <Section title="Due for periodic review" list={overdue} btns={(p) => <ReviewedButton p={p} />} help="Confirm the details are still correct, or open and fix them." />
      {!anyTask ? <div className="card"><Empty icon="check" title="All caught up" text="Nothing is waiting for you right now." /></div> : null}
      {can('moderation.manage') && (data.suggestions.length || data.reports.length) ? <button className="btn block" onClick={() => { S.btab = 'inbox'; cache.contribs = null; emit(); }}><Icon n="inbox" />{data.suggestions.length} suggestions · {data.reports.length} reports in the inbox</button> : null}
    </>
  );
}

/* ---------- places ---------- */
function filteredAll() {
  const q = S.bq.trim().toLowerCase();
  return (data.all || []).filter((p) => (S.bSec === 'all' || p.sector === S.bSec) && (S.bSub === 'all' || String(p.subcity_id) === S.bSub) &&
    (S.bStat === 'all' || (S.bStat === 'mine' ? isOwn(p) : S.bStat === 'inactive' ? !p.active : S.bStat === 'unverified' ? !p.verified : p.status === S.bStat)) &&
    (!q || (p.name + ' ' + (p.name_om || '') + ' ' + (p.name_am || '') + ' ' + typeLabel(p.sector, p.type) + ' ' + p.woreda).toLowerCase().includes(q))).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}
function PlacesTab() {
  const list = filteredAll(), rows = list.slice(0, S.bLimit);
  const stat = [['all', 'All'], ['mine', 'Mine'], ...STATUSES.map((k) => [k, STATUS_LABELS[k]]), ['unverified', 'Not verified'], ['inactive', 'Hidden']];
  return (
    <>
      <div className="search"><Icon n="search" /><label className="vh" htmlFor="bq">Search places</label><input id="bq" type="search" value={S.bq} placeholder="Name, woreda or type" autoComplete="off" onChange={(e) => { S.bq = e.target.value; S.bLimit = 40; emit(); }} /></div>
      <div className="chips flat" style={{ padding: '0 0 4px' }}>{stat.map(([k, l]) => <button key={k} className="chip" aria-pressed={String(S.bStat === k)} onClick={() => { S.bStat = k; S.bLimit = 40; emit(); }}>{l}</button>)}</div>
      <div className="duo"><select id="bSec" aria-label="Category" value={S.bSec} onChange={(e) => { S.bSec = e.target.value; emit(); }}><option value="all">All categories</option>{SECTOR_IDS.map((k) => <option key={k} value={k}>{SECTORS[k].label}</option>)}</select>
        <select id="bSub" aria-label="Sub-city" value={S.bSub} onChange={(e) => { S.bSub = e.target.value; emit(); }}><option value="all">All sub-cities</option>{SUBCITY_IDS.map((id) => <option key={id} value={String(id)}>{subcityCode(id) + ' ' + subName(id)}</option>)}</select></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 2px 10px' }}><span className="help" id="bCount">{list.length} record{list.length === 1 ? '' : 's'}</span>{can('places.create') ? <button className="btn primary sm" onClick={() => openEditor(blankDraft())}><Icon n="plus" />Add place</button> : null}</div>
      <div id="bList"><div className="card list-card">{rows.length ? rows.map((p) => {
        const a = NEXT_ACTION[p.status], w = a && WORKFLOW[a];
        const show = w && can(w.perm) && !(w.own === false && isOwn(p) && !selfOk());
        return (
          <div key={p.id} className="arow" style={p.active ? undefined : { opacity: 0.55 }}><button className="row" onClick={() => editPlace(p.id)}><SectorBadge sector={p.sector} /><span className="rt"><b>{p.name}</b><small><span className="mono">{p.lat.toFixed(5)}, {p.lon.toFixed(5)}</span> · {subcityCode(p.subcity_id)}{p.verified ? ' · verified' : ''}{p.stale ? ' · review overdue' : ''}</small></span><span className={'pill st-' + p.status}>{STATUS_LABELS[p.status]}</span></button>
            {show ? <WfButton p={p} a={a} primary label={w.label.replace('Approve & publish', 'Publish').replace('Submit for review', 'Submit')} /> : null}</div>
        );
      }) : <div className="empty">No records match these filters.</div>}</div>
        {list.length > S.bLimit ? <div style={{ textAlign: 'center' }}><button className="btn" onClick={() => { S.bLimit += 40; emit(); }}>Show more</button></div> : null}</div>
    </>
  );
}

/* ---------- inbox: suggestions and problem reports ---------- */
const inflight = {};
function useLoad(key, loader) {
  useEffect(() => {
    if (cache[key] || inflight[key]) return;
    inflight[key] = true;
    loader().then((v) => { cache[key] = v; }).catch((e) => { cache[key] = []; if (e?.message) toast(e.message, 'bad'); }).finally(() => { delete inflight[key]; emit(); });
  });
  return cache[key];
}
function Contributions() {
  const contribs = useLoad('contribs', async () => (await api.contributions({ status: 'pending' })).items);
  if (!can('contributions.manage')) return null;
  if (!contribs) return <div className="skeleton" />;
  if (!contribs.length) return null;
  const decide = async (c, d) => {
    try { await api.decide(c.kind, c.id, d); toast(d === 'approve' ? 'Approved and published' : 'Rejected'); cache.contribs = null; emit(); loadEditorData(); }
    catch (e) { toast(e.message, 'bad'); }
  };
  return (
    <><h3 className="sech">Visitor photos and menu items · {contribs.length}</h3><div className="card">{contribs.map((c) => (
      <div key={c.kind + c.id} className="qitem">
        {c.kind === 'photo' ? <img src={c.url} alt="" /> : c.photo ? <img src={c.photo} alt="" /> : <span className="ph0"><Icon n="list" /></span>}
        <div><b>{c.kind === 'photo' ? c.caption || 'Visitor photo' : c.name}{c.kind === 'menu' && c.price != null ? <> · <span className="mono">ETB {c.price}</span></> : null}</b>
          <div className="help">{c.kind === 'photo' ? 'Photo' : 'Menu item · ' + c.section} · {c.place_name} · {subcityCode(c.subcity_id)} · from {c.submitter_name || c.creator || (c.source === 'staff' ? 'staff' : 'a visitor')}</div>
          <div className="acts"><ApproveBtn onClick={() => decide(c, 'approve')} /><ConfirmButton className="btn sm danger" confirmLabel="Tap again to reject" onConfirm={() => decide(c, 'reject')}>Reject</ConfirmButton></div></div></div>
    ))}</div></>
  );
}
function ApproveBtn({ onClick }) {
  const [busy, setBusy] = useState(false);
  return <button className="btn sm primary" disabled={busy} onClick={async () => { setBusy(true); try { await onClick(); } finally { setBusy(false); } }}><Icon n="check" />Approve</button>;
}

function ResolveReport({ r }) {
  const [status, setStatus] = useState('resolved'), [note, setNote] = useState(r.resolution || ''), [err, setErr] = useState('');
  return (
    <>
      <ModalHead title={'Report ' + r.code} />
      <div className="mbody"><form className="form" onSubmit={(e) => e.preventDefault()}><div className="info"><b>{REPORT_TYPES[r.issue_type]}</b>{r.description ? <><br />{r.description}</> : null}{r.contact ? <><br /><span className="mono">{r.contact}</span></> : null}</div>
        <label className="f"><span>Status</span><select id="rr-status" value={status} onChange={(e) => setStatus(e.target.value)}>{Object.entries(REPORT_STATUSES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="f"><span>Note for the sender (they see it with their code)</span><textarea id="rr-note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label><p className="formerr" id="rrErr">{err}</p></form></div>
      <div className="mfoot"><button className="btn" onClick={actions.closeModal}>Cancel</button><button className="btn primary" onClick={async () => {
        try { await api.updateReport(r.id, { status, resolution: note }); actions.closeModal(); toast('Report updated'); await loadEditorData(); } catch (e) { setErr(e.message); }
      }}>Save</button></div>
    </>
  );
}

function Inbox() {
  const sug = data.suggestions, reps = data.reports;
  const showContrib = can('contributions.manage') && (cache.contribs === null || cache.contribs.length > 0);
  if (!sug.length && !reps.length && !showContrib) return <div className="card"><Empty icon="inbox" title="Inbox zero" text="Suggestions, corrections and problem reports from the public land here." /></div>;
  return (
    <>
      <Contributions />
      {sug.length ? <><h3 className="sech">Suggestions · {sug.length}</h3><div className="card">{sug.map((s) => {
        const d = s.data || {};
        return (
          <div key={s.id} className="sugg">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>{SECTORS[d.sector] ? <SectorBadge sector={d.sector} /> : null}<div style={{ minWidth: 0 }}><b>{d.name}</b>
              <div className="help">{s.place_id ? 'Correction to ' + (s.place_name || 'a place') : 'New place'} · {typeLabel(d.sector, d.type)} · {fmtDate(s.created_at)}</div>
              <div className="mono" style={{ fontSize: 12.5, color: 'var(--cyan)' }}>{formatLatLon(s.lat, s.lon)}{s.accuracy_m ? ' · ±' + Math.round(s.accuracy_m) + ' m GPS' : ''}</div></div></div>
            {s.photo ? <img src={s.photo} alt="Photo sent with the suggestion" loading="lazy" /> : null}
            {d.description ? <p className="help">{d.description}</p> : null}
            <div className="acts"><button className="btn sm primary" onClick={() => openEditor(draftFromSuggestion(s))}><Icon n="check" />Review and accept</button>
              <a className="btn sm" href={`https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}`} target="_blank" rel="noopener"><Icon n="ext" />Check location</a>
              <ConfirmButton className="btn sm danger" confirmLabel="Tap again to reject" onConfirm={async () => { try { await api.reject(s.id); toast('Suggestion rejected'); await loadEditorData(); } catch (e) { toast(e.message, 'bad'); } }}>Reject</ConfirmButton></div></div>
        );
      })}</div></> : null}
      {reps.length ? <><h3 className="sech">Problem reports · {reps.length}</h3><div className="card">{reps.map((r) => (
        <div key={r.id} className="sugg"><div><b>{REPORT_TYPES[r.issue_type] || r.issue_type}</b> <span className={'pill st-' + r.status}>{REPORT_STATUSES[r.status]}</span>
          <div className="help">{r.code} · {r.place_name ? r.place_name : r.trip_title ? r.trip_title : 'General'} · {fmtDate(r.created_at)}</div></div>{r.description ? <p className="help">{r.description}</p> : null}
          <div className="acts">{r.place_id ? <button className="btn sm" onClick={() => editPlace(r.place_id)}><Icon n="edit" />Fix the place</button> : null}<button className="btn sm primary" onClick={() => openModal(() => <ResolveReport r={r} />)}>Resolve…</button></div></div>
      ))}</div></> : null}
    </>
  );
}

/* ---------- trips: quick status changes and updates ---------- */
function TripQuick({ x }) {
  const [st, setSt] = useState(x.status), [msg, setMsg] = useState(''), [err, setErr] = useState('');
  return (
    <>
      <ModalHead title={x.title} />
      <div className="mbody"><form className="form" onSubmit={(e) => e.preventDefault()}><label className="f"><span>Status</span><select id="tq-status" value={st} onChange={(e) => setSt(e.target.value)}>{TRIP_STATUSES.map((s) => <option key={s} value={s}>{TRIP_STATUS_LABELS[s]}</option>)}</select></label>
        <label className="f"><span>Message to participants (shown on the trip page; required for postponed or cancelled)</span><textarea id="tq-msg" maxLength={1000} value={msg} onChange={(e) => setMsg(e.target.value)} /></label><p className="formerr" id="tqErr">{err}</p></form></div>
      <div className="mfoot"><button className="btn" onClick={actions.closeModal}>Cancel</button><button className="btn primary" onClick={async () => {
        const m = msg.trim();
        try {
          if (st !== x.status) { const r = await api.tripStatus(x.id, st, m); toast(`Status: ${TRIP_STATUS_LABELS[st]}${r.to_notify && m ? ` · contact ${r.to_notify} registrant(s)` : ''}`); }
          else if (m) { await api.tripUpdate(x.id, m); toast('Update posted'); }
          actions.closeModal(); cache.trips = null; emit(); loadPublic();
        } catch (e) { setErr(e.message); }
      }}>Save</button></div>
    </>
  );
}
function TripsTab() {
  const trips = useLoad('trips', async () => (await api.trips({ scope: 'all' })).items.filter((x) => !x.past || x.status === 'draft'));
  if (!trips) return <Skel n={3} />;
  return (
    <>
      <a className="btn block" href="/admin/trips/new" target="_blank" rel="noopener" style={{ marginBottom: 12 }}><Icon n="plus" />New trip (admin portal)</a>
      {trips.length ? <div className="card list-card">{trips.map((x) => (
        <div key={x.id} className="sugg"><div><b>{x.title}</b> <span className={'pill st-' + (x.status === 'published' ? 'ok' : x.status)}>{TRIP_STATUS_LABELS[x.status]}</span>
          <div className="help">{new Date(x.start_at).toLocaleString(undefined, { timeZone: 'Africa/Addis_Ababa', dateStyle: 'medium', timeStyle: 'short' })} · {x.registered}{x.capacity ? '/' + x.capacity : ''} registered</div></div>
          <div className="acts"><button className="btn sm" onClick={() => openModal(() => <TripQuick x={x} />)}>Change status / post update</button><a className="btn sm" href={'/admin/trips/' + x.id} target="_blank" rel="noopener"><Icon n="ext" />Edit</a></div></div>
      ))}</div> : <div className="card"><div className="empty">No upcoming trips or drafts.</div></div>}
    </>
  );
}

/* ---------- news: quick announcements ---------- */
function NewsTab() {
  const anns = useLoad('anns', async () => (await api.announcements(true)).items);
  const [f, setF] = useState({ title: '', body: '', tone: 'info', ends: '' }), [err, setErr] = useState('');
  if (!anns) return <Skel n={2} />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <div className="card"><h3>Post to the Home screen</h3><form className="form" onSubmit={(e) => e.preventDefault()}><label className="f"><span>Title</span><input id="an-title" maxLength={120} placeholder="Road to the forest closed on Sunday" value={f.title} onChange={set('title')} /></label>
        <label className="f"><span>Text</span><textarea id="an-body" maxLength={600} value={f.body} onChange={set('body')} /></label>
        <div className="two"><label className="f"><span>Style</span><select id="an-tone" value={f.tone} onChange={set('tone')}><option value="info">Information</option><option value="event">Event</option><option value="warn">Warning or closure</option><option value="success">Good news</option></select></label>
          <label className="f"><span>Show until</span><input id="an-ends" type="date" value={f.ends} onChange={set('ends')} /></label></div>
        <p className="formerr" id="anErr">{err}</p>
        <button className="btn primary" onClick={async () => {
          try { await api.createAnnouncement({ title: f.title, body: f.body, tone: f.tone, ends_at: f.ends ? f.ends + 'T23:59' : '' }); toast('Posted'); setF({ title: '', body: '', tone: 'info', ends: '' }); setErr(''); cache.anns = null; emit(); loadPublic(); }
          catch (e) { setErr(e.message); }
        }}><Icon n="megaphone" />Post now</button></form></div>
      <div className="card list-card">{anns.length ? anns.map((a) => (
        <div key={a.id} className="arow"><div className="row" style={{ cursor: 'default' }}><span className="rt"><b>{a.title}</b><small>{a.active ? 'On' : 'Off'}{a.ends_at ? ' · until ' + fmtDate(a.ends_at) : ''}</small></span></div>
          <button className="btn sm" onClick={async () => { try { await api.updateAnnouncement(a.id, { active: !a.active }); cache.anns = null; emit(); loadPublic(); } catch (e) { toast(e.message, 'bad'); } }}>{a.active ? 'Switch off' : 'Switch on'}</button></div>
      )) : <p className="help" style={{ padding: 12 }}>No announcements yet.</p>}</div>
      <p className="help">Translations, dates, links and pages are edited in the admin portal.</p>
    </>
  );
}

/* ---------- areas (sub-city centres) ---------- */
// Values typed here survive a trip to the map to pick a centre.
const areaDraft = {};
function AreaRow({ id }) {
  const c = subCentre(id);
  const d = (areaDraft[id] ||= { name: data.subcities.get(id)?.name || '', phone: subPhone(id), coords: c ? formatLatLon(c.lat, c.lon) : '' });
  const [, setN] = useState(0);
  const set = (k) => (e) => { d[k] = e.target.value; setN((n) => n + 1); };
  return (
    <div className="subrow"><span className="code">{subcityCode(id)}</span><div className="col">
      <label className="vh" htmlFor={'an-' + id}>Name</label><input className="input" id={'an-' + id} value={d.name} onChange={set('name')} />
      <label className="vh" htmlFor={'ap-' + id}>Phone</label><input className="input" id={'ap-' + id} value={d.phone} onChange={set('phone')} placeholder="Main phone line" />
      <div className="two"><label className="vh" htmlFor={'ac-' + id}>Centre</label><input className="input mono" id={'ac-' + id} value={d.coords} onChange={set('coords')} placeholder="Centre: lat, lon" />
        <button className="btn sm" onClick={() => {
          const cur = parseCoords(d.coords);
          actions.startPick({
            initial: cur && !cur.error ? [cur.lat, cur.lon] : null, title: 'Centre of ' + (d.name || subName(id)),
            onUse: (lat, lon) => { d.coords = formatLatLon(lat, lon); S.btab = 'areas'; actions.setView('admin'); setTimeout(() => document.getElementById('ac-' + id)?.scrollIntoView({ block: 'center' }), 60); toast('Centre set. Tap Save ' + subcityCode(id) + '.'); },
            onCancel: () => { S.btab = 'areas'; actions.setView('admin'); },
          });
        }}><Icon n="target" />Map</button></div>
      <div><button className="btn sm primary" onClick={async () => {
        const cur = data.subcities.get(id) || {};
        try {
          const s = await api.saveSubcity(id, { ...cur, boundary: undefined, name: d.name, phone: d.phone, coords: d.coords });
          data.subcities.set(id, { ...cur, ...s });
          delete areaDraft[id];
          toast('Saved ' + subcityCode(id));
        } catch (e) { toast(e.message, 'bad'); }
      }}>Save {subcityCode(id)}</button></div></div></div>
  );
}
function AreasTab() {
  return (
    <>
      <p className="help" style={{ margin: '0 2px 12px' }}>Set each sub-city’s official name, main phone line and centre point. New places are assigned to the boundary or nearest centre automatically. Boundaries are loaded in the admin portal.</p>
      <div className="card list-card">{SUBCITY_IDS.map((id) => <AreaRow key={id} id={id} />)}</div>
    </>
  );
}

/* ---------- activity (read only) ---------- */
const VERB = { create: 'created', update: 'updated', delete: 'deleted', status: 'moved', accept: 'accepted', reject: 'rejected', import: 'imported', login: 'signed in', login_failed: 'failed sign-in', logout: 'signed out', password: 'changed password', photo_add: 'added a photo to', photo_delete: 'removed a photo from', reviewed: 'reviewed', export: 'exported' };
function ActivityTab() {
  const activity = useLoad('activity', async () => (await api.audit({ limit: 60 })).items);
  if (!activity) return <Skel n={3} />;
  return (
    <div className="card"><h3>Recent activity</h3><div className="audit">{activity.length ? activity.map((a) => {
      const d = a.detail || {};
      const what = d.name || d.title || d.email || (a.action === 'import' ? d.rows + ' places' : a.entity);
      return <div key={a.id}><span><b>{a.user_name || 'System'}</b> {VERB[a.action] || a.action} {what || ''}{d.to ? ' → ' + (STATUS_LABELS[d.to] || TRIP_STATUS_LABELS[d.to] || d.to) : ''}</span><span>{rel(a.created_at)}</span></div>;
    }) : <p className="help">Nothing yet.</p>}</div><a className="btn sm" style={{ marginTop: 12 }} href="/admin/activity" target="_blank" rel="noopener"><Icon n="ext" />Full activity log</a></div>
  );
}
