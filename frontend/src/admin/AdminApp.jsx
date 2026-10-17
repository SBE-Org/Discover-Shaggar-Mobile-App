// Admin web portal: sign-in, layout, navigation and routing. Each section lives in its own module.
import { useEffect, useRef, useState } from 'react';
import { useStore, ui } from '../lib/store.js';
import { applyBrand, brand, Logo } from '../lib/brand.js';
import { heroSvg } from '../lib/art.js';
import { A, api, canAny, go, nav, parseRoute, loadSubcities, loadCatalog, closeDialog, refreshCounts, toast, Icon, emit } from './core.jsx';
import { DashboardView } from './dashboard.jsx';
import { PlacesView, QueueView } from './places.jsx';
import { SuggestionsView, ReportsView, ContributionsView } from './moderation.jsx';
import { TripsView } from './trips.jsx';
import { PagesView, AnnouncementsView, CategoriesView, AreasView } from './content.jsx';
import { UsersView, RolesView, ActivityView, AccountView } from './people.jsx';
import { SettingsView, DataView, SystemView, BrandingView } from './system.jsx';

const NAV = [
  ['Overview', [['dashboard', 'Dashboard', 'chart', ['reports.view', 'places.view']]]],
  ['Directory', [
    ['places', 'Places', 'pin', ['places.view']],
    ['queue', 'Review queue', 'check', ['places.review', 'places.publish', 'places.submit']],
    ['areas', 'Sub-cities', 'grid', ['areas.manage', 'reports.view']],
    ['categories', 'Categories', 'tag', ['catalog.manage']],
  ]],
  ['Public input', [
    ['contributions', 'Visitor photos & menus', 'camera', ['contributions.manage']],
    ['suggestions', 'Suggestions', 'inbox', ['moderation.manage']],
    ['reports', 'Problem reports', 'flag', ['moderation.manage']],
  ]],
  ['Trips & content', [
    ['trips', 'Trips & events', 'calendar', ['trips.manage']],
    ['announcements', 'Announcements', 'megaphone', ['content.manage']],
    ['pages', 'Pages', 'doc', ['content.manage']],
  ]],
  ['Administration', [
    ['users', 'Staff & teams', 'users', ['users.manage', 'team.manage']],
    ['roles', 'Roles & permissions', 'key', ['roles.manage']],
    ['activity', 'Activity log', 'history', ['audit.view']],
    ['data', 'Import & export', 'db', ['places.import', 'places.export']],
    ['branding', 'Logo & branding', 'star', ['settings.manage']],
    ['settings', 'Settings', 'cog', ['settings.manage']],
    ['system', 'System & backups', 'shield', ['system.backup']],
  ]],
];
const VIEWS = {
  dashboard: ['Dashboard', ['reports.view', 'places.view'], DashboardView],
  places: ['Places', ['places.view'], PlacesView],
  queue: ['Review queue', ['places.review', 'places.publish', 'places.submit'], QueueView],
  areas: ['Sub-cities', ['areas.manage', 'reports.view'], AreasView],
  categories: ['Categories', ['catalog.manage'], CategoriesView],
  contributions: ['Visitor photos & menus', ['contributions.manage'], ContributionsView],
  suggestions: ['Suggestions', ['moderation.manage'], SuggestionsView],
  reports: ['Problem reports', ['moderation.manage'], ReportsView],
  trips: ['Trips & events', ['trips.manage'], TripsView],
  announcements: ['Announcements', ['content.manage'], AnnouncementsView],
  pages: ['Pages', ['content.manage'], PagesView],
  users: ['Staff & teams', ['users.manage', 'team.manage'], UsersView],
  roles: ['Roles & permissions', ['roles.manage'], RolesView],
  activity: ['Activity log', ['audit.view'], ActivityView],
  data: ['Import & export', ['places.import', 'places.export'], DataView],
  branding: ['Logo & branding', ['settings.manage'], BrandingView],
  settings: ['Settings', ['settings.manage'], SettingsView],
  system: ['System & backups', ['system.backup'], SystemView],
  account: ['My account', null, AccountView],
};
const allowed = (perms) => !perms || canAny(...perms);
const firstView = () => { for (const [, items] of NAV) for (const [v, , , p] of items) if (allowed(p)) return v; return 'account'; };

function paintBrand(settings) {
  applyBrand(settings);
  document.body.style.setProperty('--hero', brand.hero ? `url("${brand.hero}")` : `url("data:image/svg+xml,${encodeURIComponent(heroSvg())}")`);
  emit();
}
A.paintBrand = paintBrand;

/* ---------- sign in ---------- */
function Login({ onIn }) {
  const [ticket, setTicket] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const first = useRef(null);
  useEffect(() => { setTimeout(() => first.current?.focus(), 30); }, [ticket]);
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setErr('');
    if (!ticket) {
      const email = document.getElementById('lg-email').value.trim(), pass = document.getElementById('lg-pass').value;
      if (!email || !pass) { setErr('Enter your email and password.'); return; }
      setBusy(true);
      try {
        const r = await api.login(email, pass);
        if (r.mfa_required) { setTicket(r.ticket); setBusy(false); return; }
        await onIn();
      } catch (x) { setErr(x.message); setBusy(false); }
    } else {
      setBusy(true);
      try { await api.loginMfa(ticket, document.getElementById('lg-code').value.trim()); await onIn(); }
      catch (x) { setErr(x.message); setBusy(false); if (x.status === 401 && /again/.test(x.message)) setTimeout(() => { setTicket(null); setErr(''); }, 1500); }
    }
  };
  return (
    <div id="login" className="loginwrap"><div className="logincard">
      <div className="brand"><span className="logo"><Logo size={36} /></span><div><b>{brand.name}</b><small>Administration portal</small></div></div>
      {ticket ? <><h1>Two-step sign-in</h1><p className="help">Enter the 6-digit code from your authenticator app.</p>
        <form id="lf" className="form" onSubmit={submit}><label className="f" data-f="code"><span>Code</span><input ref={first} id="lg-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]*" /></label>
          <p className="formerr">{err}</p><button className="btn primary block" disabled={busy}>Verify</button><button className="btn block" type="button" onClick={() => { setTicket(null); setErr(''); }}>Start again</button></form></>
        : <><h1>Sign in</h1><p className="help">For Tourism Bureau and sub-city staff. Your access depends on your role.</p>
          <form id="lf" className="form" onSubmit={submit}><label className="f" data-f="email"><span>Email</span><input ref={first} id="lg-email" type="email" autoComplete="username" required /></label>
            <label className="f" data-f="password"><span>Password</span><input id="lg-pass" type="password" autoComplete="current-password" required /></label>
            <p className="formerr">{err}</p><button className="btn primary block" disabled={busy}>Sign in</button></form></>}
      <p className="help" style={{ marginTop: 18 }}>Residents and visitors do not need an account. <a href="/">Open the public app</a>.</p></div></div>
  );
}

/* ---------- shell ---------- */
function Nav() {
  const cur = A.route.view;
  const badge = A.counts;
  return (
    <nav id="nav">{NAV.map(([group, items]) => {
      const vis = items.filter(([, , , p]) => allowed(p));
      if (!vis.length) return null;
      return <div key={group} className="ngroup"><span className="label">{group}</span>{vis.map(([v, l, i]) => (
        <a key={v} href={'/admin/' + v} aria-current={cur === v ? 'page' : undefined} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); nav(v); }}><Icon n={i} /><span>{l}</span>{badge[v] ? <i className="nb">{badge[v]}</i> : null}</a>
      ))}</div>;
    })}</nav>
  );
}
function MeBox({ logout }) {
  const me = A.me;
  return (
    <div id="me" className="mebox"><button className="mebtn" aria-current={A.route.view === 'account' ? 'page' : undefined} onClick={() => nav('account')}><span className="avatar">{me.name.slice(0, 1).toUpperCase()}</span>
      <span className="who"><b>{me.name}</b><small>{me.role_name}{me.subcity_id !== null && me.subcity_id !== undefined ? ' · ' + (A.subcities.get(me.subcity_id)?.name || 'Sub-city ' + me.subcity_id) : ''}</small></span></button>
      <div className="merow"><a className="btn sm" href="/" target="_blank" rel="noopener"><Icon n="smartphone" />Public app</a><button className="btn sm" onClick={logout}><Icon n="logout" />Sign out</button></div></div>
  );
}

function Dialog() {
  const box = useRef(null);
  useEffect(() => {
    if (!A.dialog) return undefined;
    const t = setTimeout(() => box.current?.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=file]),select,textarea')?.focus(), 30);
    return () => clearTimeout(t);
  }, [A.dialogKey]);
  return (
    <div id="modal" className="amodal" hidden={!A.dialog} ref={box} onClick={(e) => { if (e.target.id === 'modal') closeDialog(); }}>
      {A.dialog ? <DialogBody key={A.dialogKey} render={A.dialog.render} /> : null}
    </div>
  );
}
const DialogBody = ({ render }) => render();

function Main() {
  const { view, id } = A.route;
  const v = VIEWS[view];
  const ok = v && allowed(v[1]) && !(A.me.must_change_password && view !== 'account');
  const ref = useRef(null);
  useEffect(() => {
    if (A.me.must_change_password && view !== 'account') { toast('Choose a new password before you continue.'); go('account', null, { replace: true }); return; }
    if (!ok) { go(firstView(), null, { replace: true }); return; }
    document.title = v[0] + ' · ' + brand.name + ' Admin';
    if (ref.current) ref.current.scrollTop = 0;
    window.scrollTo(0, 0);
  }, [view, id, ok]);
  if (!ok) return <main id="main" className="main" tabIndex={-1} ref={ref} />;
  const View = v[2];
  return <main id="main" className="main" tabIndex={-1} ref={ref}><View key={view + '/' + (id || '') + '/' + (A.routeKey || 0)} id={id} /></main>;
}

export function AdminApp() {
  useStore();
  const [booted, setBooted] = useState(false);
  const afterLogin = async () => {
    const me = await api.me();
    A.me = me.user;
    await Promise.all([loadSubcities(), loadCatalog()]);
    const r = parseRoute();
    A.route = r.view === 'login' ? { view: firstView(), id: null } : r;
    emit();
    refreshCounts();
  };
  useEffect(() => {
    (async () => {
      try {
        const cfg = await api.config();
        A.config = cfg;
        paintBrand(cfg.settings || {});
        if (cfg.user) { A.me = cfg.user; await afterLogin(); }
      } catch (e) { toast(e.message, 'bad'); }
      setBooted(true);
    })();
    const onPop = () => { A.route = parseRoute(); closeDialog(); emit(); };
    const onKey = (e) => { if (e.key === 'Escape') closeDialog(); };
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', onKey);
    const timer = setInterval(() => { if (A.me && document.visibilityState === 'visible') refreshCounts(); }, 120000);
    return () => { window.removeEventListener('popstate', onPop); document.removeEventListener('keydown', onKey); clearInterval(timer); };
  }, []);
  useEffect(() => { document.body.classList.toggle('signed', !!A.me); });
  const logout = async () => {
    try { await api.logout(); } catch { /* signed out anyway */ }
    A.me = null; A.places = null; A.users = null;
    closeDialog();
    history.replaceState(null, '', '/admin');
    emit();
  };
  const toastEl = <div key={ui.toastKey} className={'toast ' + (ui.toast?.kind || '')} id="toast" role="status" hidden={!ui.toast}>{ui.toast?.msg}</div>;
  if (!booted) return toastEl;
  if (!A.me) return <><Login onIn={afterLogin} /><Dialog />{toastEl}</>;
  return (
    <>
      <div id="shell" className={'shell' + (A.navOpen ? ' navopen' : '')}>
        <aside className="side" aria-label="Admin navigation">
          <div className="brand"><span className="logo" id="sideLogo"><Logo size={36} /></span><div><b id="sideName">{brand.name}</b><small>Administration</small></div></div>
          <Nav />
          <MeBox logout={logout} />
        </aside>
        <div className="mainwrap">
          <div className="topbar"><button className="iconbtn" id="menuBtn" aria-label="Menu" onClick={() => { A.navOpen = !A.navOpen; emit(); }}><Icon n="list" /></button><b id="topName">{brand.name} Admin</b></div>
          <Main />
        </div>
      </div>
      <Dialog />
      {toastEl}
    </>
  );
}
