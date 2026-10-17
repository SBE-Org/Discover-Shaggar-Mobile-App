// Admin portal core: state, permission checks, navigation, dialogs, form helpers and small widgets.
import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../lib/api.js';
import { applyCatalog, SECTORS, STATUS_LABELS, subcityCode, defaultSubcityName, SUBCITY_IDS } from '../shared/catalog.js';
import { Icon, toast, fmtDate } from '../lib/util.js';
import { emit } from '../lib/store.js';

export { api, toast, fmtDate, Icon, emit };

export const A = {
  me: null, config: null, route: { view: 'dashboard', id: null }, subcities: new Map(), users: null, roles: null,
  places: null, placesAt: 0, dialog: null, dialogKey: 0, counts: { suggestions: 0, reports: 0, queue: 0, contributions: 0 }, navOpen: false,
};

export const can = (p) => !!A.me && A.me.permissions.includes(p);
export const canAny = (...p) => p.some(can);
export const subName = (id) => (id === null || id === undefined ? 'City-wide' : A.subcities.get(id)?.name || defaultSubcityName(id));
export const subLabel = (id) => (id === null || id === undefined || id === '' ? 'City-wide' : subcityCode(Number(id)) + ' · ' + subName(Number(id)));
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const relTime = (iso) => {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  if (s < 86400 * 30) return Math.round(s / 86400) + ' d ago';
  return fmtDate(iso);
};
export const StatusPill = ({ s }) => <span className={'pill st-' + s}>{STATUS_LABELS[s] || s}</span>;
export const SectorDot = ({ sector }) => <span className="sdot" style={{ '--c': SECTORS[sector]?.color || '#888' }} title={SECTORS[sector]?.label || sector} />;

/* ---------- navigation (real addresses under /admin) ---------- */
export function go(view, id = null, { replace = false } = {}) {
  A.route = { view, id };
  A.navOpen = false;
  const url = '/admin/' + view + (id ? '/' + encodeURIComponent(id) : '');
  try { if (location.pathname !== url) history[replace ? 'replaceState' : 'pushState'](null, '', url); } catch { /* ignore */ }
  A.routeKey = (A.routeKey || 0) + 1;
  emit();
}
/** Navigate from a "view/id" string, as used by the menu and links. */
export const nav = (v) => { closeDialog(); const [view, ...rest] = String(v).split('/'); go(view, rest.length ? rest.join('/') : null); };
export function parseRoute() {
  const parts = location.pathname.replace(/^\/admin\/?/, '').split('/').filter(Boolean);
  return { view: parts[0] || 'dashboard', id: parts[1] ? decodeURIComponent(parts[1]) : null };
}
/** A link inside the portal that navigates without reloading the page. */
export function NavLink({ to, className, children, style }) {
  return <a className={className} style={style} href={'/admin/' + to} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); nav(to); }}>{children}</a>;
}
export const NavButton = ({ to, className = 'linkbtn', style, children }) => <button type="button" className={className} style={style} onClick={() => nav(to)}>{children}</button>;

/* ---------- data ---------- */
export async function loadSubcities() {
  const r = await api.subcities();
  A.subcities = new Map(r.items.map((s) => [s.id, s]));
}
export async function loadCatalog() {
  const c = await api.catalog();
  applyCatalog(c);
  return c;
}
/** All places visible to this user (staff scope), cached for a minute. */
export async function loadPlaces(force = false) {
  if (!force && A.places && Date.now() - A.placesAt < 60000) return A.places;
  const r = await api.places({ scope: 'all', limit: 10000 });
  A.places = r.items; A.placesAt = Date.now();
  return A.places;
}
export const invalidatePlaces = () => { A.places = null; };
export async function loadUsers(force = false) {
  if (!force && A.users) return A.users;
  if (!canAny('users.manage', 'team.manage', 'audit.view')) return [];
  A.users = (await api.users()).items;
  return A.users;
}
export async function refreshCounts() {
  try {
    if (canAny('reports.view', 'places.view')) {
      const s = await api.stats();
      A.counts = { suggestions: s.suggestions, reports: s.reports, contributions: s.contributions || 0, queue: (s.my?.to_verify || 0) + (s.my?.to_publish || 0) + (s.my?.returned || 0) };
      emit();
    }
  } catch { /* ignore */ }
}

/**
 * Load data for a view. Returns { data, error, loading, reload, set }.
 * `deps` work like useEffect dependencies.
 */
export function useAsync(fn, deps = []) {
  const [st, setSt] = useState({ data: null, error: null, loading: true });
  const run = useRef(0);
  const load = useCallback(async () => {
    const n = ++run.current;
    setSt((s) => ({ ...s, loading: true, error: null }));
    try { const data = await fn(); if (n === run.current) setSt({ data, error: null, loading: false }); }
    catch (e) { if (n === run.current) setSt({ data: null, error: e, loading: false }); }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return { ...st, reload: load, set: (data) => setSt({ data, error: null, loading: false }) };
}

/* ---------- dialogs ---------- */
/** Open a dialog. `render` returns a <Dlg>; it is called on every render so it can read live state. */
export function openDialog(render, { onClose = null } = {}) {
  A.dialog = { render, onClose };
  A.dialogKey++;
  emit();
}
export function closeDialog() {
  if (!A.dialog) return;
  const c = A.dialog.onClose;
  A.dialog = null;
  emit();
  c?.();
}
/** Dialog frame: title, body and footer (the .dlg markup of the portal styles). */
export function Dlg({ title, wide = false, foot = null, children }) {
  return (
    <div className={'dlg' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-labelledby="dlgTitle">
      <header><h2 id="dlgTitle">{title}</h2><button className="iconbtn" onClick={closeDialog} aria-label="Close"><Icon n="x" /></button></header>
      <div className="dlg-body">{children}</div>{foot ? <footer>{foot}</footer> : null}
    </div>
  );
}

function ConfirmDialog({ title, message, okLabel, danger, note, notePlaceholder, finish }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  return (
    <Dlg title={title} foot={<><button className="btn" onClick={closeDialog}>Cancel</button><button className={'btn ' + (danger ? 'danger solid' : 'primary')} id="cfOk" onClick={() => {
      const v = note ? text.trim() : '';
      if (note && note !== 'Note (optional)' && !v) { setErr('Please add a short note.'); return; }
      finish(v); closeDialog();
    }}>{okLabel}</button></>}>
      <p>{message}</p>
      {note ? <><label className="f" style={{ marginTop: 14 }}><span>{note === true ? 'Note' : note}</span><textarea id="cfNote" rows="3" placeholder={notePlaceholder} value={text} onChange={(e) => setText(e.target.value)} /></label><p className="formerr" id="cfErr">{err}</p></> : null}
    </Dlg>
  );
}
/** Ask for confirmation (optionally with a note). Resolves to the note text, or null if cancelled. */
export function confirmDlg(title, message, { okLabel = 'Confirm', danger = false, note = false, notePlaceholder = '' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); };
    openDialog(() => <ConfirmDialog title={title} message={message} okLabel={okLabel} danger={danger} note={note} notePlaceholder={notePlaceholder} finish={finish} />, { onClose: () => finish(null) });
  });
}

/* ---------- forms ---------- */
// Portal forms keep their values in the inputs themselves (uncontrolled, read with val() on save),
// and show server errors next to each field through the `errors` object.
export function Fld({ k, label, errors, help = '', cls = '', children }) {
  const err = errors?.[k];
  return (
    <label className={'f ' + cls + (err ? ' invalid' : '')} data-f={k}><span>{label}</span>{children}{help ? <small className="help">{help}</small> : null}<em className="ferr" hidden={!err}>{err}</em></label>
  );
}
/** A <select> from [value, label] pairs. */
export const Sel = ({ id, opts, cur, ...rest }) => (
  <select id={id} name={id} defaultValue={String(cur ?? '')} {...rest}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
);
export const Check = ({ id, label, on, ...rest }) => <label className="check"><input type="checkbox" id={id} defaultChecked={!!on} {...rest} />{label}</label>;
export const subcityOptions = (withAll = false, allLabel = 'City-wide') => [...(withAll ? [['', allLabel]] : []), ...SUBCITY_IDS.map((id) => [String(id), subLabel(id)])];

export const val = (id) => { const el = document.getElementById(id); if (!el) return undefined; return el.type === 'checkbox' ? el.checked : el.value; };
export const setVal = (id, v) => { const el = document.getElementById(id); if (el) { if (el.type === 'checkbox') el.checked = !!v; else el.value = v; } };

/** Scroll to the first invalid field (or the form error) after errors change. */
export function useFormErrors() {
  const [errors, setErrorsRaw] = useState({});
  const [msg, setMsg] = useState('');
  const ref = useRef(null);
  const setErrors = (details, message = '') => { setErrorsRaw(details || {}); setMsg(message || ''); };
  useEffect(() => {
    if (!ref.current) return;
    const first = ref.current.querySelector('.f.invalid') || (msg ? ref.current.querySelector('.formerr') : null);
    first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [errors, msg]);
  return { errors, msg, setErrors, ref };
}

/** Language tabs for multilingual fields (English, Afaan Oromoo, Amharic). */
const LANGS3 = [['en', 'English', ''], ['om', 'Afaan Oromoo', '_om'], ['am', 'አማርኛ', '_am']];
export function LangFields({ prefix, rec, fields, errors }) {
  const [cur, setCur] = useState('en');
  return (
    <div className="langs" data-langs={prefix}>
      <div className="ltabs" role="tablist">{LANGS3.map(([k, l, sfx], i) => {
        const miss = i > 0 && fields.some(([f]) => !rec?.[f + sfx] && rec?.[f]);
        return <button key={k} type="button" role="tab" aria-selected={String(cur === k)} onClick={() => setCur(k)}>{l}{miss ? <> <i className="miss" title="Translation missing" /></> : null}</button>;
      })}</div>
      {LANGS3.map(([k, , sfx]) => (
        <div key={k} className="lpane" data-p={prefix} data-l={k} hidden={cur !== k}>
          {fields.map(([f, label, kind, attrs = {}]) => (
            <Fld key={f} k={prefix + f + sfx} label={label} errors={errors}>
              {kind === 'area' ? <textarea id={prefix + f + sfx} name={prefix + f + sfx} rows={5} defaultValue={rec?.[f + sfx] ?? ''} {...attrs} /> : <input id={prefix + f + sfx} name={prefix + f + sfx} defaultValue={rec?.[f + sfx] ?? ''} {...attrs} />}
            </Fld>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ---------- widgets ---------- */
export const Empty = ({ title, text = '', icon = 'spark' }) => <div className="empty"><div className="glyph"><Icon n={icon} /></div><b>{title}</b>{text ? <span>{text}</span> : null}</div>;
export const Loading = ({ n = 4 }) => Array.from({ length: n }, (_, i) => <div key={i} className="skeleton" />);
export function Kpi({ label, value, hint = '', tone = '', onClick, icon = '' }) {
  const inner = <>{icon ? <span className="kico"><Icon n={icon} /></span> : null}<span className="label">{label}</span><b>{value}</b>{hint ? <small>{hint}</small> : null}</>;
  return onClick ? <button className={'kpi ' + tone} onClick={onClick}>{inner}</button> : <div className={'kpi ' + tone}>{inner}</div>;
}
export const PageHead = ({ title, sub = null, right = null }) => <header className="phead"><div><h1>{title}</h1>{sub ? <p>{sub}</p> : null}</div><div className="phead-r">{right}</div></header>;
export const Notice = ({ error }) => <div className="notice">{error?.message || String(error)}</div>;

/** A button that is disabled while its async action runs and shows failures as a toast. */
export function BusyButton({ onClick, className = 'btn', children, ...rest }) {
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  return (
    <button type="button" className={className + (busy ? ' busy' : '')} {...rest} disabled={busy || rest.disabled} onClick={async (e) => {
      setBusy(true);
      try { await onClick(e); } catch (err) { if (err?.message) toast(err.message, 'bad'); } finally { if (live.current) setBusy(false); }
    }}>{children}</button>
  );
}

/** Read a text file the person chose. */
export function readTextFile(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result || '')); r.onerror = () => rej(new Error('Could not read the file.')); r.readAsText(file); });
}
