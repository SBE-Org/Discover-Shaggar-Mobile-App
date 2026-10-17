// People and oversight: staff accounts, roles & permissions, the activity log and the signed-in user's account.
import { useEffect, useState } from 'react';
import { STATUS_LABELS, TRIP_STATUS_LABELS, levelName } from '../shared/catalog.js';
import {
  A, api, can, go, nav, subLabel, PageHead, Loading, Empty, Fld, Sel, Check, subcityOptions, val, useFormErrors, openDialog, closeDialog, Dlg,
  confirmDlg, relTime, fmtDateTime, loadUsers, BusyButton, useAsync, Notice, NavButton, toast, Icon, emit,
} from './core.jsx';

/* ---------- shared: describe audit entries ---------- */
export const VERB = {
  create: 'created', update: 'updated', delete: 'deleted', status: 'changed the status of', accept: 'accepted', reject: 'rejected', import: 'imported',
  export: 'exported', login: 'signed in', login_failed: 'failed to sign in', logout: 'signed out', password: 'changed their password', photo_add: 'added a photo to',
  photo_delete: 'removed a photo from', photo_update: 'edited a photo of', reviewed: 'confirmed as still accurate', feature: 'featured', unfeature: 'unfeatured',
  mfa_enable: 'turned on two-step sign-in', mfa_disable: 'turned off two-step sign-in', backup: 'made a backup', download: 'downloaded', view: 'viewed',
  trip_update: 'posted an update on', trip_update_delete: 'removed an update from', retention: 'deleted old personal data:',
};
const ENTITY = { place: 'place', user: 'account', role: 'role', trip: 'trip', page: 'page', announcement: 'announcement', category: 'category', subcity: 'sub-city', settings: 'settings', suggestion: 'suggestion', report: 'report', registration: 'registration', registrations: 'registrations of trip', audit: 'activity log', system: 'system', backup: 'backup' };
const short = (v) => { if (v === null || v === undefined || v === '') return '∅'; const s = typeof v === 'object' ? JSON.stringify(v) : String(v); return s.length > 120 ? s.slice(0, 117) + '…' : s; };
export function Changes({ ch }) {
  const keys = Object.keys(ch || {});
  if (!keys.length) return null;
  return <div className="diff">{keys.slice(0, 12).map((k) => <div key={k}><span className="k">{k}</span><span><del>{short(ch[k][0])}</del> → <ins>{short(ch[k][1])}</ins></span></div>)}{keys.length > 12 ? <div><span className="k">…</span><span>{keys.length - 12} more</span></div> : null}</div>;
}
export function AuditLine({ a }) {
  let d = a.detail;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = {}; } }
  d ||= {};
  const name = d.name || d.title || d.email || d.label || (a.action === 'import' ? `${d.rows} places` : a.action === 'export' && d.rows ? `${d.rows} rows` : '') || a.entity_id || '';
  const link = a.entity === 'place' && a.entity_id && a.action !== 'delete' ? <NavButton to={'places/' + a.entity_id} style={{ padding: 0 }}>{name}</NavButton>
    : a.entity === 'trip' && a.entity_id && a.action !== 'delete' ? <NavButton to={'trips/' + a.entity_id} style={{ padding: 0 }}>{name}</NavButton> : name;
  const who = <b>{a.user_name || (a.action === 'login_failed' ? 'Someone' : 'System')}</b>;
  if (['login', 'logout', 'password', 'mfa_enable', 'mfa_disable'].includes(a.action)) return <>{who} {VERB[a.action]}</>;
  if (a.action === 'login_failed') return <>{who} failed to sign in as <span className="mono">{d.email || ''}</span>{d.mfa ? ' (wrong code)' : ''}</>;
  const SL = a.entity === 'trip' ? TRIP_STATUS_LABELS : STATUS_LABELS;
  if (a.action === 'status') return <>{who} moved {ENTITY[a.entity] || a.entity} {link} {d.from ? `from ${SL[d.from] || d.from} ` : ''}to <b>{SL[d.to] || d.to}</b>{d.auto ? <> <span className="muted">(automatically, capacity reached)</span></> : null}{d.note ? <> <span className="muted">“{d.note}”</span></> : null}{d.message ? <> <span className="muted">“{d.message}”</span></> : null}</>;
  if (a.entity === 'suggestion') return <>{who} {VERB[a.action] || a.action} a public suggestion{d.place ? <> → <NavButton to={'places/' + d.place} style={{ padding: 0 }}>open place</NavButton></> : null}{d.reason ? <> <span className="muted">“{d.reason}”</span></> : null}</>;
  if (a.action === 'retention') return <>{who} {VERB.retention} {d.deleted} registration(s) older than {d.older_than_days} days</>;
  return <>{who} {VERB[a.action] || a.action} {ENTITY[a.entity] || a.entity} {link}{d.restored_from ? <> <span className="flag ok">restore</span></> : null}</>;
}

/* ---------- staff accounts ---------- */
let roles = null;
async function loadRoles(force) { if (!roles || force) roles = (await api.roles()).items; return roles; }
const Lvl = ({ n }) => <span className={'lvl ' + (n >= 60 ? '' : n >= 40 ? 'l2' : 'l1')} title={'Hierarchy level ' + n}>{levelName(n)}</span>;
const Hier = ({ steps }) => <div className="hier">{steps.map(([i, l], k) => [k ? <span key={'a' + k} className="arrow">→</span> : null, <span key={k} className="step"><Icon n={i} />{l}</span>])}</div>;
const roleOpts = (cur) => roles.filter((r) => r.assignable || r.key === cur).map((r) => [r.key, `${r.name} (${levelName(r.level)})`]);
const subOpts = () => (A.me.subcity_id !== null && A.me.subcity_id !== undefined ? [[String(A.me.subcity_id), subLabel(A.me.subcity_id)]] : subcityOptions(true, 'Whole city'));
const genPass = () => { const c = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const a = crypto.getRandomValues(new Uint8Array(14)); let s = [...a].map((b) => c[b % c.length]).join(''); if (!/\d/.test(s)) s = s.slice(0, 13) + '7'; return s; };
let uFilter = 'all';

export function UsersView() {
  const scoped = A.me.subcity_id !== null && A.me.subcity_id !== undefined;
  const [filter, setFilter] = useState(uFilter);
  const q = useAsync(async () => { const [users] = await Promise.all([loadUsers(true), loadRoles(true)]); return users; }, []);
  const head = <PageHead title={scoped ? `Team · ${subLabel(A.me.subcity_id)}` : 'Staff & teams'}
    sub={scoped ? 'The staff of your sub-city. You can add and manage data-entry staff; their work comes to you for approval.' : 'Administrator → Central supervisor → Sub-city supervisor → Data entry. Each person manages only the accounts below their level.'}
    right={<button className="btn primary" onClick={() => openDialog(() => <NewUser reload={q.reload} />)}><Icon n="plus" />{scoped ? 'Add data-entry staff' : 'Add staff member'}</button>} />;
  if (q.loading && !q.data) return <>{head}<Loading n={5} /></>;
  if (q.error) return <>{head}<Notice error={q.error} /></>;
  const users = q.data;
  const subs = [...new Set(users.map((u) => u.subcity_id))].sort((x, y) => (x ?? -1) - (y ?? -1));
  const list = users.filter((u) => filter === 'all' || String(u.subcity_id ?? 'city') === filter);
  return (
    <>{head}
      <Hier steps={[['shield', 'Administrator'], ['users', 'Central supervisor'], ['check', 'Sub-city supervisor'], ['edit', 'Data entry']]} />
      {!scoped ? <div className="tbar"><Sel id="uf" opts={[['all', 'Everyone'], ...subs.map((x) => [String(x ?? 'city'), x === null ? 'City-wide staff' : subLabel(x)])]} cur={filter} aria-label="Sub-city" onChange={(e) => { uFilter = e.target.value; setFilter(e.target.value); }} /></div> : null}
      <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Name</th><th>Role</th><th>Level</th><th>Works on</th><th>Two-step</th><th>Status</th><th>Last sign-in</th><th /></tr></thead><tbody>
        {list.map((u) => (
          <tr key={u.id} style={u.active ? undefined : { opacity: 0.55 }}><td><b>{u.name}</b>{u.id === A.me.id ? <> <span className="flag ok">You</span></> : null}<span className="sub">{u.email}{u.phone ? ' · ' + u.phone : ''}</span></td>
            <td>{u.role_name || u.role}</td><td><Lvl n={u.level ?? 0} /></td><td className="muted">{subLabel(u.subcity_id)}</td><td>{u.mfa_enabled ? <span className="flag ok">On</span> : <span className="flag">Off</span>}</td>
            <td>{!u.active ? <span className="pill st-archived">Deactivated</span> : u.locked ? <span className="pill st-rejected">Locked</span> : u.must_change_password ? <span className="pill st-submitted">Must set password</span> : <span className="pill st-published">Active</span>}</td>
            <td className="muted">{u.last_login_at ? relTime(u.last_login_at) : 'Never'}</td>
            <td><div className="acts">{u.manageable || u.id === A.me.id ? <BusyButton className="btn sm" onClick={() => editUser(u, q.reload)}>Manage</BusyButton> : <span className="help">Above your level</span>}</div></td></tr>
        ))}</tbody></table></div>
      <div className="card" style={{ marginTop: 14 }}><h3>Roles at a glance</h3><div className="feed">{roles.map((r) => <div key={r.key}><span><b>{r.name}</b> <Lvl n={r.level} /><span className="sub">{r.description}</span></span><span className="mono muted">{r.users} active</span></div>)}</div>
        {can('roles.manage') ? <button className="btn sm" style={{ marginTop: 10 }} onClick={() => nav('roles')}>Edit roles and permissions</button> : null}</div>
    </>
  );
}

function NewUser({ reload }) {
  const f = useFormErrors();
  const [pw] = useState(genPass);
  return (
    <Dlg title="Add staff member" wide foot={<><button className="btn" onClick={closeDialog}>Cancel</button><BusyButton className="btn primary" onClick={async () => {
      const b = { name: val('u-name'), email: val('u-email'), role: val('u-role'), subcity_id: val('u-subcity_id'), phone: val('u-phone'), password: val('u-password') };
      try { await api.createUser(b); closeDialog(); toast('Account created. Share the temporary password privately.'); reload(); } catch (e) { f.setErrors(e.details, e.message); }
    }}><Icon n="plus" />Create account</BusyButton></>}>
      <div className="sect" id="uform" ref={f.ref}><div className="fgrid">
        <Fld k="name" label="Full name" errors={f.errors}><input id="u-name" /></Fld><Fld k="email" label="Email" errors={f.errors}><input id="u-email" type="email" /></Fld>
        <Fld k="role" label="Role" errors={f.errors} help="Data entry: enters places, photos and menus. A sub-city supervisor approves their work."><Sel id="u-role" opts={roleOpts()} cur="data_entry" /></Fld>
        <Fld k="subcity_id" label="Works on" errors={f.errors} help="Give supervisors and data entry their sub-city, so work is shared out and does not all land on the central team."><Sel id="u-subcity_id" opts={subOpts()} cur={A.me.subcity_id ?? ''} /></Fld>
        <Fld k="phone" label="Phone (optional)" errors={f.errors}><input id="u-phone" /></Fld>
        <Fld k="password" label="Temporary password" errors={f.errors} help="Share it privately. They must choose a new one at first sign-in."><input id="u-password" defaultValue={pw} className="mono" /></Fld>
      </div><p className="formerr">{f.msg}</p></div>
    </Dlg>
  );
}

async function editUser(u, reload) {
  let sessions = [];
  try { sessions = (await api.userSessions(u.id)).items; } catch { /* ignore */ }
  openDialog(() => <EditUser u={u} sessions={sessions} reload={reload} />);
}
function EditUser({ u, sessions, reload }) {
  const f = useFormErrors();
  const self = u.id === A.me.id;
  const flag = async (k) => { try { await api.updateUser(u.id, { [k]: true }); closeDialog(); toast('Done'); reload(); } catch (e) { toast(e.message, 'bad'); } };
  return (
    <Dlg title={u.name} wide foot={<><button className="btn" onClick={closeDialog}>Cancel</button><BusyButton className="btn primary" onClick={async () => {
      const b = { name: val('ue-name'), phone: val('ue-phone'), subcity_id: val('ue-subcity_id') };
      if (!document.getElementById('ue-role').disabled) b.role = val('ue-role');
      try { await api.updateUser(u.id, b); closeDialog(); toast('Saved'); reload(); } catch (e) { f.setErrors(e.details, e.message); }
    }}>Save</BusyButton></>}>
      <div className="sect" id="ueform" ref={f.ref}><div className="fgrid">
        <Fld k="name" label="Full name" errors={f.errors}><input id="ue-name" defaultValue={u.name} /></Fld><Fld k="phone" label="Phone" errors={f.errors}><input id="ue-phone" defaultValue={u.phone} /></Fld>
        <Fld k="role" label="Role" errors={f.errors} help={self ? 'Another administrator must change your role.' : ''}><Sel id="ue-role" opts={roleOpts(u.role)} cur={u.role} disabled={self} /></Fld>
        <Fld k="subcity_id" label="Works on" errors={f.errors}><Sel id="ue-subcity_id" opts={subOpts()} cur={u.subcity_id ?? ''} disabled={self && !A.me.permissions.includes('users.manage')} /></Fld></div>
        <div className="card" style={{ margin: 0 }}><h3>Security</h3><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={async () => {
            const pw = genPass();
            if ((await confirmDlg('Reset password', <>Set the temporary password <b className="mono">{pw}</b>? They will be signed out and must choose a new password at next sign-in. Copy it now.</>, { okLabel: 'Reset' })) === null) return;
            try { await api.updateUser(u.id, { password: pw }); toast('Password reset. Share it privately.'); reload(); } catch (e) { toast(e.message, 'bad'); }
          }}><Icon n="key" />Reset password</button>
          {u.locked ? <button className="btn sm" onClick={() => flag('unlock')}><Icon n="lock" />Unlock</button> : null}
          {u.mfa_enabled ? <button className="btn sm" onClick={() => flag('reset_mfa')}>Reset two-step sign-in</button> : null}
          {sessions.length ? <button className="btn sm" onClick={() => flag('signout')}>Sign out everywhere ({sessions.length})</button> : null}
          {!self ? <button className={'btn sm ' + (u.active ? 'danger' : '')} onClick={async () => {
            const on = !u.active;
            if (!on && (await confirmDlg('Deactivate account', 'They will be signed out and cannot sign in until reactivated. Their past work stays in the records.', { okLabel: 'Deactivate', danger: true })) === null) return;
            try { await api.updateUser(u.id, { active: on }); closeDialog(); toast(on ? 'Reactivated' : 'Deactivated'); reload(); } catch (e) { toast(e.message, 'bad'); }
          }}>{u.active ? 'Deactivate' : 'Reactivate'}</button> : null}</div>
          {sessions.length ? <div className="feed" style={{ marginTop: 10 }}>{sessions.map((s, i) => <div key={i}><span className="help">{(s.user_agent || 'Unknown device').slice(0, 70)}</span><time>{s.ip || ''} · {relTime(s.created_at)}</time></div>)}</div> : <p className="help" style={{ marginTop: 8 }}>Not signed in anywhere.</p>}
        </div>
        <p className="help">Created {fmtDateTime(u.created_at)} · last sign-in {u.last_login_at ? fmtDateTime(u.last_login_at) : 'never'}. <button className="linkbtn" onClick={() => { closeDialog(); af.user = String(u.id); go('activity'); }}>See their activity</button></p>
        <p className="formerr">{f.msg}</p></div>
    </Dlg>
  );
}

/* ---------- roles & permissions ---------- */
export function RolesView() {
  const q = useAsync(async () => { const [perms] = await Promise.all([api.permissions().then((r) => r.items), loadRoles(true)]); return { perms, draft: Object.fromEntries(roles.map((r) => [r.key, new Set(r.permissions)])), levels: {}, dirty: {} }; }, []);
  const [, force] = useState(0);
  const head = <PageHead title="Roles & permissions" sub="Tick what each role may do. Changes apply at the next page load for everyone with that role. The Bureau administrator always has every permission."
    right={<button className="btn primary" onClick={() => openDialog(() => <NewRole reload={q.reload} />)}><Icon n="plus" />New role</button>} />;
  if (q.loading && !q.data) return <>{head}<Loading n={6} /></>;
  if (q.error) return <>{head}<Notice error={q.error} /></>;
  const { perms, draft, levels, dirty } = q.data;
  const groups = [...new Set(perms.map((p) => p.group))];
  const touch = (k) => { dirty[k] = true; force((n) => n + 1); };
  return (
    <>{head}
      <div className="tbl-wrap"><table className="tbl matrix"><thead><tr><th>Permission</th>{roles.map((r) => <th key={r.key} className="rc">{r.name}<span className="sub">{r.users} user{r.users === 1 ? '' : 's'}</span></th>)}</tr></thead><tbody>
        <tr className="grp"><td colSpan={roles.length + 1}>Hierarchy</td></tr>
        <tr><td>Level<span className="sub">Higher levels manage and approve the work of lower levels</span></td>{roles.map((r) => <td key={r.key} className="rc">{r.key === 'admin' ? <b>100</b>
          : <input type="number" min="0" max="99" defaultValue={r.level} style={{ width: 64, height: 34, borderRadius: 8, border: '1px solid var(--line-strong)', textAlign: 'center' }} aria-label={r.name + ' level'} onChange={(e) => { levels[r.key] = Number(e.target.value); touch(r.key); }} />}</td>)}</tr>
        {groups.map((g) => [
          <tr key={g} className="grp"><td colSpan={roles.length + 1}>{g}</td></tr>,
          ...perms.filter((p) => p.group === g).map((p) => (
            <tr key={p.key}><td>{p.label}<span className="sub mono">{p.key}</span></td>
              {roles.map((r) => <td key={r.key} className="rc"><input type="checkbox" aria-label={`${r.name}: ${p.label}`} defaultChecked={r.permissions.includes('*') || r.permissions.includes(p.key)} disabled={r.key === 'admin'}
                onChange={(e) => { if (e.target.checked) draft[r.key].add(p.key); else draft[r.key].delete(p.key); touch(r.key); }} /></td>)}</tr>
          )),
        ])}
        <tr><td />{roles.map((r) => <td key={r.key} className="rc">{r.key === 'admin' ? <span className="help">Locked</span>
          : <BusyButton className={'btn sm' + (dirty[r.key] ? ' primary' : '')} id={'rs-' + r.key} disabled={!dirty[r.key]} onClick={async () => {
            await api.updateRole(r.key, { permissions: [...draft[r.key]], ...(levels[r.key] !== undefined ? { level: levels[r.key] } : {}) }); toast('Role saved'); q.reload();
          }}>Save</BusyButton>}
          {!r.is_system && !r.users ? <button className="linkbtn" onClick={async () => {
            if ((await confirmDlg('Delete role', 'Delete this role?', { okLabel: 'Delete', danger: true })) === null) return;
            try { await api.deleteRole(r.key); q.reload(); } catch (e) { toast(e.message, 'bad'); }
          }}>Delete</button> : null}</td>)}</tr>
      </tbody></table></div>
      <p className="help" style={{ marginTop: 10 }}>“Places: see unpublished records” lets a role open drafts and the review queue. Sub-city scope is set per person on Staff accounts. Nobody can grant a permission they do not hold, and every change here is recorded in the activity log.</p>
    </>
  );
}
function NewRole({ reload }) {
  const f = useFormErrors();
  return (
    <Dlg title="New role" foot={<><button className="btn" onClick={closeDialog}>Cancel</button><BusyButton className="btn primary" onClick={async () => {
      const from = roles.find((r) => r.key === val('r-copy'));
      try { await api.createRole({ name: val('r-name'), description: val('r-description'), permissions: from ? from.permissions : [], level: Number(val('r-level')) }); closeDialog(); toast('Role created. Tick its permissions.'); reload(); }
      catch (e) { f.setErrors(e.details, e.message); }
    }}>Create</BusyButton></>}>
      <div className="sect" id="rform" ref={f.ref}>
        <Fld k="name" label="Role name" errors={f.errors}><input id="r-name" placeholder="Trip coordinator" /></Fld>
        <Fld k="description" label="What is it for?" errors={f.errors}><input id="r-description" /></Fld>
        <Fld k="level" label="Level (0–99)" errors={f.errors} help="Data entry 20 · reviewer 40 · sub-city supervisor 50 · central 60–70."><input id="r-level" defaultValue={30} type="number" min="0" max="99" /></Fld>
        <Fld k="copy" label="Start from" errors={f.errors}><Sel id="r-copy" opts={[['', 'No permissions'], ...roles.filter((r) => r.key !== 'admin').map((r) => [r.key, r.name])]} cur="" /></Fld>
        <p className="formerr">{f.msg}</p></div>
    </Dlg>
  );
}

/* ---------- activity log ---------- */
export const af = { user: '', action: '', entity: '', from: '', to: '', q: '', security: false };
export function ActivityView() {
  const users = useAsync(() => loadUsers().catch(() => []), []);
  const [st, setSt] = useState({ items: [], next: null, actions: [], loading: true, error: null, v: 0 });
  const load = async (more) => {
    try {
      const r = await api.audit({ ...af, security: af.security ? 1 : '', before: more ? st.next : '', limit: 100 });
      setSt((s) => ({ items: more ? s.items.concat(r.items) : r.items, next: r.next, actions: r.actions, loading: false, error: null, v: s.v + 1 }));
    } catch (e) { setSt((s) => ({ ...s, loading: false, error: e })); }
  };
  useEffect(() => { load(false); }, []);
  const filter = () => { Object.assign(af, { q: val('lf-q'), user: val('lf-user'), entity: val('lf-entity'), action: val('lf-action'), from: val('lf-from'), to: val('lf-to'), security: val('lf-security') }); load(false); };
  const canRestore = (can('places.review') || can('places.publish')) && can('places.edit');
  return (
    <>
      <PageHead title="Activity log" sub="Who changed what and when, including sign-ins, permission changes and exports. Place edits keep their previous values so they can be restored."
        right={<button className="btn" onClick={() => { const p = new URLSearchParams(Object.entries({ ...af, security: af.security ? 1 : '' }).filter(([, v]) => v)); location.href = '/api/audit.csv?' + p; }}><Icon n="down" />Export CSV</button>} />
      <div className="tbar">
        <div className="search"><Icon n="search" /><input id="lf-q" type="search" placeholder="Search names, IDs, details or IP" defaultValue={af.q} onBlur={filter} onKeyDown={(e) => { if (e.key === 'Enter') filter(); }} /></div>
        <Sel id="lf-user" opts={[['', 'Anyone'], ...(users.data || []).map((u) => [String(u.id), u.name])]} cur={af.user} onChange={filter} aria-label="Person" key={'u' + (users.data?.length || 0)} />
        <Sel id="lf-entity" opts={[['', 'Any record'], ['place', 'Places'], ['trip', 'Trips'], ['user', 'Accounts'], ['role', 'Roles'], ['settings', 'Settings'], ['page', 'Pages'], ['announcement', 'Announcements'], ['category', 'Categories'], ['subcity', 'Sub-cities'], ['suggestion', 'Suggestions'], ['report', 'Reports'], ['registrations', 'Registrations']]} cur={af.entity} onChange={filter} aria-label="Record type" />
        <Sel id="lf-action" opts={[['', 'Any action'], ...st.actions.map((a) => [a, VERB[a] || a])]} cur={af.action} onChange={filter} aria-label="Action" key={'a' + st.actions.length} />
        <input type="date" id="lf-from" defaultValue={af.from} onChange={filter} aria-label="From" /><input type="date" id="lf-to" defaultValue={af.to} onChange={filter} aria-label="To" />
        <label className="check" style={{ minHeight: 42 }}><input type="checkbox" id="lf-security" defaultChecked={af.security} onChange={filter} />Security only</label>
      </div>
      <div className="card list-card" id="logBox">{st.loading ? <Loading n={8} /> : st.error ? <p className="bad" style={{ padding: 14 }}>{st.error.message}</p> : st.items.length ? <>
        <div className="timeline">{st.items.map((a) => (
          <div key={a.id} className="ev"><time title={a.created_at}>{fmtDateTime(a.created_at)}</time>
            <div><AuditLine a={a} />{a.detail?.changes ? <Changes ch={a.detail.changes} /> : null}{a.detail?.fields && !a.detail?.changes ? <div className="help">Fields: {a.detail.fields.join(', ')}</div> : null}
              {a.detail?.added?.length || a.detail?.removed?.length ? <div className="diff">{a.detail.added?.length ? <div><span className="k">granted</span><ins>{a.detail.added.join(', ')}</ins></div> : null}{a.detail.removed?.length ? <div><span className="k">removed</span><del>{a.detail.removed.join(', ')}</del></div> : null}</div> : null}</div>
            <div style={{ textAlign: 'right' }}><span className="mono muted" style={{ fontSize: 11 }}>{a.ip || ''}</span>{canRestore && a.entity === 'place' && a.action === 'update' && a.detail?.changes && Object.keys(a.detail.changes).length ? <><br /><button className="linkbtn" onClick={async () => {
              if ((await confirmDlg('Restore previous values', 'Put back the values from before this change? The restore is recorded too.', { okLabel: 'Restore' })) === null) return;
              try { const r = await api.revert(a.id); toast('Restored: ' + r.restored.join(', ')); load(false); } catch (e) { toast(e.message, 'bad'); }
            }}>Restore</button></> : null}</div></div>
        ))}</div>
        {st.next ? <div style={{ textAlign: 'center', padding: 10 }}><BusyButton className="btn" onClick={() => load(true)}>Load older entries</BusyButton></div> : null}
      </> : <Empty title="No activity matches these filters" icon="history" />}</div>
    </>
  );
}

/* ---------- my account ---------- */
function MfaBox() {
  const [setup, setSetup] = useState(null);
  const f = useFormErrors();
  const me = A.me;
  if (me.mfa_enabled) {
    return <><p className="help">On. You will be asked for a 6-digit code from your authenticator app when you sign in.</p>
      <div className="sect" style={{ marginTop: 12 }} ref={f.ref}><Fld k="mp" label="Password"><input id="mf-pass" type="password" /></Fld><Fld k="mc" label="Current code"><input id="mf-code" inputMode="numeric" maxLength={6} /></Fld>
        <p className="formerr">{f.msg}</p><BusyButton className="btn danger" onClick={async () => {
          try { await api.mfaDisable(val('mf-pass'), val('mf-code')); A.me = (await api.me()).user; toast('Two-step sign-in is off'); emit(); } catch (e) { f.setErrors({}, e.message); }
        }}>Turn off</BusyButton></div></>;
  }
  if (setup) {
    return <><ol className="help" style={{ paddingLeft: 18, display: 'grid', gap: 6 }}><li>Install an authenticator app (Google Authenticator, Microsoft Authenticator, or similar).</li><li>Add an account with this key, or open the link on your phone:</li></ol>
      <div className="secret" style={{ margin: '10px 0' }}>{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</div><a className="btn sm" href={setup.otpauth}><Icon n="smartphone" />Open in authenticator app</a>
      <div className="sect" style={{ marginTop: 12 }} ref={f.ref}><Fld k="code" label="Enter the 6-digit code it shows"><input id="mf-code" inputMode="numeric" maxLength={6} autoComplete="one-time-code" /></Fld><p className="formerr">{f.msg}</p>
        <BusyButton className="btn primary" onClick={async () => {
          try { await api.mfaEnable(val('mf-code')); A.me = (await api.me()).user; toast('Two-step sign-in is on'); emit(); } catch (e) { f.setErrors({}, e.message); }
        }}>Turn on</BusyButton></div></>;
  }
  return <><p className="help">Adds a 6-digit code from your phone to every sign-in, so a stolen password is not enough. Strongly recommended for anyone who publishes or manages staff.</p>
    <BusyButton className="btn primary" style={{ marginTop: 12 }} onClick={async () => setSetup(await api.mfaSetup())}><Icon n="lock" />Set up</BusyButton></>;
}
export function AccountView() {
  const me = A.me;
  const f = useFormErrors();
  return (
    <>
      <PageHead title="My account" sub={`${me.email} · ${me.role_name} · ${subLabel(me.subcity_id)}`} />
      {me.must_change_password ? <div className="notice">Choose your own password to continue. The one you were given was temporary.</div> : null}
      {me.mfa_gate ? <div className="notice">Your organisation requires two-step sign-in for your role. Turn it on below to unlock publishing and administration tools.</div> : null}
      <div className="grid2"><div className="card" id="pwform" ref={f.ref}><h3>Password</h3><div className="sect">
        <Fld k="current" label="Current password" errors={f.errors}><input id="pw-current" type="password" autoComplete="current-password" /></Fld>
        <Fld k="next" label="New password" errors={f.errors} help="At least 10 characters with letters and numbers."><input id="pw-next" type="password" autoComplete="new-password" /></Fld>
        <p className="formerr">{f.msg}</p><BusyButton className="btn primary" onClick={async () => {
          try {
            await api.changePassword(val('pw-current'), val('pw-next'));
            toast('Password updated');
            const wasForced = A.me.must_change_password;
            A.me = (await api.me()).user;
            if (wasForced) go('dashboard'); else emit();
          } catch (e) { f.setErrors(e.details, e.message); }
        }}>Update password</BusyButton></div></div>
        <div className="card" id="mfabox"><h3>Two-step sign-in</h3><MfaBox /></div></div>
      <div className="card"><h3>What you can do</h3><div className="flags">{me.permissions.length ? me.permissions.map((p) => <span key={p} className="flag ok">{p}</span>) : <span className="help">No permissions yet. Ask an administrator.</span>}</div></div>
    </>
  );
}
