// Administration: system settings, CSV import/export, system health with backups, and logo & branding.
import { useState } from 'react';
import { subcityCode, STATUS_LABELS } from '../shared/catalog.js';
import { formatLatLon } from '../shared/coords.js';
import { brand, Logo, applyBrand } from '../lib/brand.js';
import { heroSvg } from '../lib/art.js';
import { shrinkImage, RawSvg } from '../lib/util.js';
import {
  A, api, toast, can, PageHead, Loading, Fld, Check, val, setVal, useFormErrors, confirmDlg, relTime, BusyButton, useAsync, Notice, invalidatePlaces, Icon, emit, readTextFile,
} from './core.jsx';

/* ---------- settings ---------- */
const GROUPS = [
  ['Site', [['site.contact_email', 'Public contact email', 'text'], ['site.contact_phone', 'Public contact phone', 'text']]],
  ['Publishing workflow', [['workflow.allow_self_approval', 'Allow people to verify or publish records they created or submitted', 'bool', 'The specification recommends keeping this off. Turn it on only for very small teams, with a written policy.']]],
  ['Location quality', [['gps.good_accuracy_m', 'Target GPS accuracy (metres)', 'num', 'Capture stops automatically once this is reached.'], ['gps.max_accuracy_m', 'Ask for a reason above (metres)', 'num', 'Collectors must retry, move the pin or explain readings worse than this.']]],
  ['Visitor contributions', [['public.visitor_photos', 'Let visitors share photos of tourist sites (approved by a supervisor first)', 'bool'], ['public.customer_menu_items', 'Let customers add dishes and prices to menus (approved by a supervisor first)', 'bool']]],
  ['Review schedule', [['review.warn_days', 'Warn this many days before a review is due', 'num'], ['public.show_stale_warning', 'Show “may be out of date” on places past their review date', 'bool']]],
  ['Security', [['security.require_mfa_admins', 'Require two-step sign-in for publishing and administration', 'bool', 'Staff without it lose publish, delete, user, role, settings and backup permissions until they turn it on.'], ['security.session_days', 'Stay signed in for (days)', 'num']]],
  ['Privacy and retention', [['privacy.registration_retention_days', 'Delete trip registrations this many days after the trip', 'num'], ['privacy.report_contact_retention_days', 'Remove contact details from resolved reports after (days)', 'num']]],
];
export function SettingsView() {
  const q = useAsync(() => api.settings(), []);
  const f = useFormErrors();
  const sub = 'Rules that apply to everyone. Every change is recorded in the activity log.';
  if (q.error) return <><PageHead title="Settings" sub={sub} /><Notice error={q.error} /></>;
  if (!q.data) return <><PageHead title="Settings" sub={sub} /><Loading n={4} /></>;
  const v = q.data.values;
  const save = async () => {
    const body = {};
    for (const [, items] of GROUPS) for (const [k, , type] of items) { const x = val('s-' + k); body[k] = type === 'num' ? Number(x) : x; }
    try { await api.saveSettings(body); A.config = await api.config(); toast('Settings saved'); } catch (e) { f.setErrors(e.details, e.message); }
  };
  return (
    <>
      <PageHead title="Settings" sub={sub} right={<BusyButton className="btn primary" onClick={save}><Icon n="check" />Save settings</BusyButton>} />
      <div id="setform" ref={f.ref}>{GROUPS.map(([g, items]) => (
        <div key={g} className="card"><h3>{g}</h3><div className="fgrid">{items.map(([k, l, type, help]) => (type === 'bool'
          ? <div key={k} className="wide"><Check id={'s-' + k} label={l} on={!!v[k]} />{help ? <p className="help" style={{ margin: '-4px 0 0 30px' }}>{help}</p> : null}</div>
          : <Fld key={k} k={k} label={l} errors={f.errors} help={help || ''}><input id={'s-' + k} defaultValue={v[k] ?? ''} {...(type === 'num' ? { type: 'number', min: 0 } : { maxLength: 200 })} /></Fld>))}</div></div>
      ))}<p className="formerr">{f.msg}</p></div>
    </>
  );
}

/* ---------- import & export ---------- */
let impSaved = null;
export function DataView() {
  const [imp, setImpRaw] = useState(impSaved);
  const setImp = (x) => { impSaved = x; setImpRaw(x); };
  const check = async () => {
    const text = val('impText');
    if (!text.trim()) { toast('Paste CSV rows or choose a file first.', 'bad'); return; }
    try { setImp({ text, result: await api.importCsv(text, true) }); } catch (e) { toast(e.message, 'bad'); }
  };
  const r = imp?.result;
  return (
    <>
      <PageHead title="Import & export" sub="Bring in places from a spreadsheet, or download the directory." />
      {can('places.export') ? <div className="card"><h3>Export</h3><p className="help" style={{ marginBottom: 12 }}>All places you can see, with status, translations, coordinates, accuracy and review dates. Opens in Excel. Exports are logged.</p>
        <a className="btn" href="/api/export.csv"><Icon n="down" />Download places (CSV)</a> <a className="btn" href="/samples/import-template.csv"><Icon n="doc" />Import template</a></div> : null}
      {can('places.import') ? <>
        <div className="card"><h3>Import from a spreadsheet</h3>
          <p className="help" style={{ marginBottom: 12 }}>Save your sheet as CSV. Required: <b>name</b> and <b>latitude</b>/<b>longitude</b> (or one <b>coordinates</b> column). Optional: sector, type, subcity (number, code or name), woreda, kebele, phone, email, hours, website, fee, description, name_om, name_am, alt_names, source, owner_department, accuracy_m, status, verified.
            Imported data is a starting point, not proof: rows arrive as <b>Submitted</b> unless your role may verify or publish.</p>
          <label className="btn sm" style={{ marginBottom: 10 }}><Icon n="upload" />Choose CSV file<input type="file" accept=".csv,text/csv,text/plain" className="vh" onChange={async (e) => {
            const fl = e.target.files?.[0]; if (!fl) return;
            try { setVal('impText', await readTextFile(fl)); await check(); } catch (x) { toast(x.message, 'bad'); }
          }} /></label>
          <textarea className="input" id="impText" placeholder="…or paste CSV rows here" rows={8} defaultValue={imp?.text || ''} key={imp ? 'has' : 'empty'} />
          <div style={{ marginTop: 10 }}><BusyButton className="btn" onClick={check}>Check rows</BusyButton></div></div>
        <div id="impResult">{r ? <div className="card"><h3>Check result</h3><p><span className="ok">{r.ready} ready</span>{r.errors.length ? <> · <span className="bad">{r.errors.length} will be skipped</span></> : null}</p>
          {r.errors.length ? <ul className="errlist">{r.errors.slice(0, 15).map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}{r.errors.length > 15 ? <li>…and {r.errors.length - 15} more</li> : null}</ul> : null}
          {r.preview.length ? <div className="tbl-wrap" style={{ marginTop: 12 }}><table className="tbl"><thead><tr><th>Name</th><th>Coordinates</th><th>Sub-city</th><th>Status</th></tr></thead><tbody>{r.preview.map((p, i) => <tr key={i}><td>{p.name}</td><td className="mono">{formatLatLon(p.lat, p.lon)}</td><td>{subcityCode(p.subcity_id)}</td><td>{STATUS_LABELS[p.status] || p.status}</td></tr>)}</tbody></table></div> : null}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}><BusyButton className="btn primary" disabled={!r.ready} onClick={async () => { const x = await api.importCsv(imp.text, false); setImp(null); invalidatePlaces(); toast(`Imported ${x.imported} place${x.imported === 1 ? '' : 's'}`); }}>Import {r.ready} places</BusyButton>
            <button className="btn" onClick={() => setImp(null)}>Clear</button></div></div> : null}</div>
      </> : null}
    </>
  );
}

/* ---------- system & backups ---------- */
export function SystemView() {
  const q = useAsync(() => api.system(), []);
  const [chk, setChk] = useState(null);
  const sub = 'Health of the server and database, and copies of the data.';
  if (q.error) return <><PageHead title="System & backups" sub={sub} /><Notice error={q.error} /></>;
  if (!q.data) return <><PageHead title="System & backups" sub={sub} /><Loading n={4} /></>;
  const s = q.data;
  const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
  const stale = !s.last_backup || Date.now() - new Date(s.last_backup) > 2 * 864e5;
  return (
    <>
      <PageHead title="System & backups" sub={sub} right={<>
        <BusyButton className="btn" onClick={async () => setChk(await api.systemCheck())}><Icon n="check" />Check database</BusyButton>
        <BusyButton className="btn primary" onClick={async () => { if ((await confirmDlg('Back up now', 'Make a copy of the database?', { okLabel: 'Back up' })) === null) return; const r = await api.backup(); toast('Backup saved: ' + r.name); q.reload(); }}><Icon n="db" />Back up now</BusyButton></>} />
      {stale ? <div className="notice">No backup in the last two days. The server makes one automatically every day; you can also run <span className="mono">npm run backup</span> on a schedule, and MongoDB Atlas keeps its own snapshots on paid tiers.</div> : null}
      <div className="kpis">
        <div className="kpi"><span className="label">Uptime</span><b>{Math.floor(s.uptime_s / 86400)}d {Math.floor((s.uptime_s % 86400) / 3600)}h</b><small>Node {s.node} · {s.memory_mb} MB memory</small></div>
        <div className="kpi"><span className="label">Database</span><b>{mb(s.db_bytes)}</b><small>{s.sessions} active sessions</small></div>
        <div className="kpi"><span className="label">Photos</span><b>{s.uploads}</b><small>{mb(s.upload_bytes)}</small></div>
        <div className={'kpi ' + (stale ? 'bad' : 'ok')}><span className="label">Last backup</span><b>{s.last_backup ? relTime(s.last_backup) : 'Never'}</b><small>{s.backups.length} kept in the database</small></div>
      </div>
      <div id="sysCheckBox">{chk ? <div className={chk.integrity === 'ok' && !chk.foreign_key_problems ? 'info' : 'notice'} style={{ marginBottom: 14 }}>Integrity check: <b>{chk.integrity}</b> · broken links between records: <b>{chk.foreign_key_problems}</b></div> : null}</div>
      <div className="card"><h3>Backups</h3>{s.backups.length ? <div className="tbl-wrap"><table className="tbl"><thead><tr><th>File</th><th>Made</th><th className="num">Size</th><th></th></tr></thead><tbody>
        {s.backups.map((b) => <tr key={b.name}><td className="mono">{b.name}</td><td className="muted">{new Date(b.at).toLocaleString()}</td><td className="num">{mb(b.bytes)}</td><td><div className="acts"><a className="btn sm" href={'/api/system/backups/' + encodeURIComponent(b.name)}><Icon n="down" />Download</a></div></td></tr>)}</tbody></table></div> : <p className="help">No backups yet.</p>}
        <p className="help" style={{ marginTop: 12 }}>A backup is a compressed copy of every collection, photos included, stored in MongoDB. Download one regularly and keep it off the server. To restore, run <span className="mono">npm run restore -- backup.json.gz --yes</span> in the backend folder.</p></div>
    </>
  );
}

/* ---------- logo & branding ---------- */
const SWATCHES = ['#C8102E', '#A50E23', '#DA121A', '#E4002B', '#141212'];
export function BrandingView() {
  const q = useAsync(() => api.settings().then((r) => r.values), []);
  const f = useFormErrors();
  const sub = 'Change the logo, name and colour of the app and this portal. Changes appear for everyone at their next visit.';
  if (q.error) return <><PageHead title="Logo & branding" sub={sub} /><Notice error={q.error} /></>;
  if (!q.data) return <><PageHead title="Logo & branding" sub={sub} /><Loading n={3} /></>;
  const values = q.data;
  applyBrand(values);
  const refresh = async (v) => { q.set(v); A.config = await api.config(); A.paintBrand?.(A.config.settings); emit(); };
  const color = (c) => document.documentElement.style.setProperty('--brand', c);
  const upload = (k) => async (e) => {
    const fl = e.target.files?.[0]; if (!fl) return;
    try {
      const img = await shrinkImage(fl, k === 'logo' ? 512 : 2000, k === 'logo' ? 'image/png' : 'image/jpeg');
      toast('Uploading…');
      await refresh((await api.uploadBrand(k, img)).values);
      toast(k === 'logo' ? 'New logo saved' : 'Home picture saved');
    } catch (x) { toast(x.message, 'bad'); }
  };
  const reset = async (k) => {
    if ((await confirmDlg('Go back to the default', `Remove the uploaded ${k === 'logo' ? 'logo' : 'picture'} and use the built-in one?`, { okLabel: 'Use default' })) === null) return;
    await refresh((await api.resetBrand(k)).values);
  };
  const save = async () => {
    const body = { 'site.name': val('b-name'), 'brand.tagline': val('b-tagline'), 'brand.primary': val('b-primary') };
    try { const r = await api.saveSettings(body); await refresh(r.values); toast('Branding saved'); } catch (e) { f.setErrors(e.details, e.message); }
  };
  return (
    <>
      <PageHead title="Logo & branding" sub={sub} right={<BusyButton className="btn primary" onClick={save}><Icon n="check" />Save name and colour</BusyButton>} />
      <div className="brandprev">
        <div className="box"><h3 style={{ margin: 0 }}>Logo</h3><div className="logo-lg"><Logo size={84} /></div>
          <p className="help">Square PNG with a transparent background works best, at least 512 × 512 pixels. It is used on the app home screen, the map search bar, this portal, the browser tab and when people install the app on their phone.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><label className="btn sm primary"><Icon n="upload" />Upload new logo<input type="file" accept="image/png,image/jpeg,image/webp" className="vh" onChange={upload('logo')} /></label>
            {brand.logo ? <BusyButton className="btn sm" onClick={() => reset('logo')}>Use the default logo</BusyButton> : null}</div></div>
        <div className="box"><h3 style={{ margin: 0 }}>Home picture</h3><div className="hero-sm">{brand.hero ? <img src={brand.hero} alt="" /> : <RawSvg svg={heroSvg()} />}</div>
          <p className="help">Shown behind the title on the app’s Home screen and the portal sign-in page. Use a wide photo of Shaggar you have the rights to, at least 1600 pixels wide.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><label className="btn sm primary"><Icon n="upload" />Upload picture<input type="file" accept="image/png,image/jpeg,image/webp" className="vh" onChange={upload('hero')} /></label>
            {brand.hero ? <BusyButton className="btn sm" onClick={() => reset('hero')}>Use the illustration</BusyButton> : null}</div></div>
      </div>
      <div className="card" id="brform" ref={f.ref} style={{ marginTop: 14 }}><h3>Name and colour</h3><div className="fgrid">
        <Fld k="site.name" label="App name" errors={f.errors} help="Shown after the logo, in the browser tab and on the phone home screen."><input id="b-name" defaultValue={values['site.name']} maxLength={60} /></Fld>
        <Fld k="brand.tagline" label="Tagline" errors={f.errors}><input id="b-tagline" defaultValue={values['brand.tagline']} maxLength={120} /></Fld>
        <Fld k="brand.primary" label="Main colour" errors={f.errors} help="Shaggar red is the default. Buttons, highlights and the active menu use this colour; black and white stay as they are.">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><input id="b-primary" type="color" defaultValue={values['brand.primary'] || '#C8102E'} style={{ width: 56, height: 42, padding: 2 }} onInput={(e) => color(e.target.value)} />
            {SWATCHES.map((c) => <button key={c} type="button" className="iconbtn sm" style={{ background: c, borderColor: c }} aria-label={'Use ' + c} onClick={(e) => { e.preventDefault(); setVal('b-primary', c); color(c); }} />)}</div></Fld>
      </div><p className="formerr">{f.msg}</p></div>
    </>
  );
}
