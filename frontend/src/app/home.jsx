// Home, Saved and More screens; content pages; problem reports and tracking; language choice.
import { useState } from 'react';
import { SECTORS, SECTOR_IDS, LANGS, REPORT_TYPES, REPORT_STATUSES, INTEREST_GROUPS, INTEREST_LABELS, isAttraction, subcityCode, SUBCITY_IDS } from '../shared/catalog.js';
import { Icon, SectorBadge, RawSvg, toast, copyText, fmtDate, rememberCode, savedCodes } from '../lib/util.js';
import { api } from '../lib/api.js';
import { S, data, actions, emit, isStaff, subName, savedList, recentList, unsave, openModal } from '../lib/store.js';
import { t, tr, sectorName, typeName, setLang, getLang } from '../lib/i18n.js';
import { sceneSvg, heroSvg } from '../lib/art.js';
import { brand, Logo } from '../lib/brand.js';
import { PlaceRow } from './places.jsx';
import { TripCard } from './trips.jsx';
import { PageHead, SecHead, ModalHead, Field, Honeypot, Empty } from './common.jsx';
import * as M from './map.js';
import { canPrompt, promptInstall, isStandalone, manualKind } from '../lib/install.js';

// "Discover Shaggar" with the last word highlighted in a red block.
function HeroTitle() {
  const words = t('home.hello').split(' ');
  return words.length > 1 ? <>{words.slice(0, -1).join(' ')} <em>{words[words.length - 1]}</em></> : <>{words[0]} <em>Shaggar</em></>;
}
const siteName = () => brand.name || S.config?.settings?.['site.name'] || 'Discover Shaggar';

/* ---------- Home (FR-001) ---------- */
function annClick(a) {
  if (a.link_kind === 'place' && a.link_value) return () => actions.openProfile(a.link_value);
  if (a.link_kind === 'trip' && a.link_value) return () => actions.openTrip(a.link_value);
  if (a.link_kind === 'page' && a.link_value) return () => openPage(a.link_value);
  return null;
}
const CardImg = ({ p }) => (p.cover ? <img src={p.cover} alt="" loading="lazy" /> : <RawSvg svg={sceneSvg(p.sector, p.id, '', p.type)} />);
const PlaceCard = ({ p }) => (
  <button className="hcard" onClick={() => actions.openProfile(p.id)}><div className="hc-img"><CardImg p={p} />{p.verified ? <span className="pill st-ok">{t('p.verified')}</span> : null}</div>
    <div className="hc-b"><b>{tr(p, 'name')}</b><small>{typeName(p.sector, p.type)} · {subName(p.subcity_id)}</small></div></button>
);
const goMap = (sheet = 'half') => { S.sheet = sheet; actions.setView('map'); };

export function Home() {
  const now = new Date().toISOString();
  const anns = data.announcements.filter((a) => (!a.starts_at || a.starts_at <= now) && (!a.ends_at || a.ends_at >= now));
  let featured = data.places.filter((p) => p.featured);
  if (featured.length < 4) featured = featured.concat(data.places.filter((p) => !p.featured && isAttraction(p)).sort((a, b) => (b.cover ? 1 : 0) - (a.cover ? 1 : 0) || (b.verified - a.verified)).slice(0, 8 - featured.length));
  const trips = data.trips.filter((x) => !x.past).slice(0, 6);
  const counts = Object.fromEntries(SECTOR_IDS.map((k) => [k, data.places.filter((p) => p.sector === k).length]));
  const recent = recentList().slice(0, 6);
  let staffCard = null;
  if (isStaff()) {
    const s = data.stats?.my || {};
    const n = (s.to_verify || 0) + (s.to_publish || 0) + (s.returned || 0) + data.suggestions.length + data.reports.length;
    staffCard = <button className="staffcard" onClick={() => actions.setView('admin')}><Icon n="shield" /><span><b>Admin</b><small>{n ? `${n} item${n === 1 ? '' : 's'} need your attention` : 'Capture places, review and publish'}</small></span><Icon n="chev" /></button>;
  }
  return (
    <div>
      <header className="homehero"><div className="bg" aria-hidden="true">{brand.hero ? <img src={brand.hero} alt="" /> : <RawSvg svg={heroSvg()} />}</div>
        <div className="brandline"><span className="logo"><Logo size={36} /></span><span><b>{siteName()}</b><small>{brand.tagline || ''}</small></span></div>
        <h1><HeroTitle /></h1><p>{t('home.sub')}</p>
        <button className="homesearch" onClick={() => { goMap('half'); actions.focusSearch?.(); }}><Icon n="search" /><span>{t('home.search')}</span></button>
        <div className="homeacts"><button className="btn primary sm" onClick={actions.nearMe}><Icon n="locate" />{t('home.nearme')}</button><button className="btn sm" onClick={() => actions.setView('map')}><Icon n="map" />{t('nav.map')}</button><button className="btn sm" onClick={() => actions.setView('plan')}><Icon n="route" />{t('home.plan')}</button></div>
      </header>
      {staffCard}
      {anns.map((a) => {
        const click = annClick(a);
        const inner = <><Icon n={a.tone === 'warn' ? 'alert' : a.tone === 'event' ? 'calendar' : 'megaphone'} /><span><b>{tr(a, 'title')}</b>{tr(a, 'body') ? <small>{tr(a, 'body')}</small> : null}</span></>;
        return click ? <button key={a.id} className={'ann tone-' + a.tone} onClick={click}>{inner}</button> : <div key={a.id} className={'ann tone-' + a.tone}>{inner}</div>;
      })}
      {S.offline ? <div className="notice">You are offline. Showing places saved on this phone{S.cacheAt ? ' from ' + fmtDate(new Date(S.cacheAt).toISOString()) : ''}.</div> : null}
      <SecHead title={t('home.categories')} />
      <div className="catgrid">{SECTOR_IDS.map((k) => (
        <button key={k} className="catbtn" style={{ '--c': SECTORS[k].color }} onClick={() => { S.sector = k; S.nearChip = null; S.sel = null; S.q = ''; S.sub = null; goMap('half'); }}><SectorBadge sector={k} /><b>{sectorName(k)}</b><small>{counts[k]}</small></button>
      ))}</div>
      {featured.length ? <><SecHead title={t('home.featured')} more={<button className="linkbtn" onClick={() => actions.setView('discover')}>{t('see_all')}</button>} />
        <div className="hscroll">{featured.map((p) => <PlaceCard key={p.id} p={p} />)}</div></> : null}
      <SecHead title={t('home.upcoming')} more={<button className="linkbtn" onClick={() => actions.setView('trips')}>{t('see_all')}</button>} />
      {trips.length ? <div className="hscroll">{trips.map((x) => <TripCard key={x.id} x={x} compact />)}</div> : <div className="card"><p className="help">{t('t.none_sub')}</p></div>}
      <SecHead title={t('home.discover')} />
      <div className="interest">{Object.keys(INTEREST_GROUPS).map((g) => (
        <button key={g} onClick={() => { S.discTab = g; actions.setView('discover'); }}><Icon n={g === 'nature' ? 'mountain' : g === 'adventure' ? 'route' : 'bank'} /><b>{INTEREST_LABELS[g]}</b><small>{data.places.filter((p) => isAttraction(p) && INTEREST_GROUPS[g].includes(p.type)).length} places</small></button>
      ))}</div>
      <button className="plancard" onClick={() => actions.setView('plan')}><Icon n="route" /><span><b>{t('home.plan')}</b><small>{t('home.plan_sub')}</small></span><Icon n="chev" /></button>
      <SecHead title={t('home.areas')} more={<button className="linkbtn" onClick={() => actions.setView('areas')}>{t('see_all')}</button>} />
      <div className="chips flat wrap">{SUBCITY_IDS.map((id) => <button key={id} className="chip" onClick={() => actions.areaOpen(id)}><span className="mono" style={{ color: 'var(--cyan)' }}>{subcityCode(id)}</span>{subName(id)}</button>)}</div>
      {recent.length ? <><SecHead title={t('home.recent')} /><div className="card list-card">{recent.map((p) => <PlaceRow key={p.id} p={data.byId.get(p.id) || p} />)}</div></> : null}
      <p className="help" style={{ marginTop: 22, textAlign: 'center' }}>{data.places.length} verified places · {siteName()}</p>
    </div>
  );
}

/* ---------- Saved ---------- */
export function Saved() {
  const saved = savedList(), recent = recentList();
  return (
    <div><PageHead title={t('nav.saved')} sub="Kept on this phone, available without a connection." />
      {saved.length
        ? <div className="card list-card">{saved.map((p) => <div key={p.id} className="arow"><PlaceRow p={data.byId.get(p.id) || p} />{p.gone ? <span className="pill st-unv">No longer listed</span> : null}<button className="iconbtn" onClick={() => { unsave(p.id); emit(); }} aria-label="Remove"><Icon n="x" /></button></div>)}</div>
        : <div className="card"><Empty icon="bookmark" title={t('saved.empty')} text={t('saved.empty_sub')} /></div>}
      {saved.length ? <button className="btn block" onClick={() => {
        const ids = saved.map((p) => p.id); S.route = null; S.sel = null; S.sector = 'all'; S.q = ''; actions.setView('map');
        setTimeout(() => M.fitPoints(ids.map((id) => data.byId.get(id)).filter(Boolean), 15), 60);
      }}><Icon n="map" />Show saved places on the map</button> : null}
      {recent.length ? <><h3 className="sech">{t('home.recent')}</h3><div className="card list-card">{recent.map((p) => <PlaceRow key={p.id} p={data.byId.get(p.id) || p} />)}</div></> : null}
    </div>
  );
}

/* ---------- More ---------- */
const Row = ({ icon, color, title, sub, onClick }) => (
  <button className="row" onClick={onClick}><span className="sbadge" style={{ '--c': color }}><Icon n={icon} /></span><span className="rt"><b>{title}</b>{sub ? <small>{sub}</small> : null}</span><Icon n="chev" /></button>
);
export function More() {
  const pages = data.pages.filter((p) => p.in_menu);
  return (
    <div><PageHead title={t('nav.more')} />
      <h3 className="sech">{t('m.language')}</h3>
      <div className="seg" role="group" aria-label={t('m.language')}>{Object.entries(LANGS).map(([k, l]) => <button key={k} aria-pressed={String(getLang() === k)} lang={k} onClick={() => { setLang(k); toast(LANGS[k]); }}>{l}</button>)}</div>
      {getLang() !== 'en' ? <p className="help" style={{ margin: '-6px 4px 10px' }}>Where a translation is not ready yet, English is shown.</p> : null}
      {!isStandalone() ? <div className="card list-card">
        <Row icon="smartphone" color="var(--brand)" title="Install app" sub="Add it to your home screen. Opens full screen and works with a weak connection." onClick={installApp} />
      </div> : null}
      <div className="card list-card">
        {isStaff() ? <Row icon="bookmark" color="var(--cyan)" title={t('nav.saved')} sub={savedList().length + ' places'} onClick={() => actions.setView('saved')} /> : null}
        <Row icon="route" color="var(--violet)" title={t('home.plan')} sub={t('home.plan_sub')} onClick={() => actions.setView('plan')} />
        <Row icon="compass" color="#FFB547" title={t('home.discover')} sub="Nature, adventure, culture and history" onClick={() => actions.setView('discover')} />
        <Row icon="plus" color="var(--ok)" title={t('m.suggest')} sub="Missing a place? Send it with its GPS location." onClick={actions.addPlace} />
        <Row icon="flag" color="var(--warn)" title={t('act.report')} sub="Wrong pin, closed place, broken link…" onClick={() => reportForm({})} />
        <Row icon="search" color="#6FB2FF" title={t('m.track')} sub="Use the code you received" onClick={actions.trackOpen} />
      </div>
      <h3 className="sech">{t('m.info')}</h3>
      <div className="card list-card">{pages.length ? pages.map((p) => (
        <button key={p.slug} className="row" onClick={() => openPage(p.slug)}><span className="sbadge" style={{ '--c': 'var(--muted)' }}><Icon n={p.slug === 'privacy' ? 'lock' : p.slug === 'help' ? 'info' : p.slug === 'contact' ? 'phone' : 'doc'} /></span><span className="rt"><b>{tr(p, 'title')}</b></span><Icon n="chev" /></button>
      )) : <p className="help" style={{ padding: 12 }}>No pages yet.</p>}</div>
      <h3 className="sech">Staff</h3>
      <div className="card list-card">
        <Row icon="shield" color="var(--cyan)" title={S.me ? t('nav.admin') : t('m.staff')} sub={S.me ? S.me.name + ' · ' + S.me.role_name : 'For Tourism Bureau and sub-city staff'} onClick={() => actions.setView('admin')} />
        {S.me ? <a className="row" href="/admin" target="_blank" rel="noopener" style={{ textDecoration: 'none', color: 'inherit' }}><span className="sbadge" style={{ '--c': 'var(--violet)' }}><Icon n="ext" /></span><span className="rt"><b>Open the admin web portal</b><small>Full tools on a computer or tablet</small></span><Icon n="chev" /></a> : null}
      </div>
      <p className="help" style={{ textAlign: 'center', marginTop: 20 }}>{siteName()} · Map data © OpenStreetMap contributors{S.config?.settings?.['site.contact_phone'] ? ' · ' + S.config.settings['site.contact_phone'] : ''}</p>
    </div>
  );
}

/* ---------- install the app ---------- */
const INSTALL_STEPS = {
  ios: ['Tap the Share button (the square with an arrow) at the bottom of Safari. On iPad it is at the top.', 'Scroll down and tap “Add to Home Screen”.', 'Tap “Add”. The app appears on your home screen.'],
  'ios-other': ['Tap the Share button (the square with an arrow) next to the address bar.', 'Tap “Add to Home Screen”. If you do not see it, open this page in Safari and try there.', 'Tap “Add”.'],
  android: ['Tap the menu (⋮) at the top right of the browser.', 'Tap “Install app” or “Add to Home screen”.', 'Tap “Install”. The app appears on your home screen and in your app list.'],
  'android-firefox': ['Tap the menu (⋮) of Firefox.', 'Tap “Install” or “Add to Home screen”.', 'Confirm. For the best result you can also open this page in Chrome.'],
  inapp: ['This page is open inside another app (for example Telegram or Facebook), which cannot install apps.', 'Tap the menu (⋮ or …) and choose “Open in browser” or “Open in Chrome / Safari”.', 'Then come back to More → Install app.'],
  desktop: ['Click the install icon at the right end of the address bar, or open the browser menu.', 'Choose “Install Discover Shaggar” or “Install app”.', 'Click “Install”.'],
};
async function installApp() {
  if (canPrompt()) {
    const r = await promptInstall();
    if (r === 'accepted') toast('Installing… the app will appear on your home screen.');
    return;
  }
  const kind = manualKind();
  const steps = INSTALL_STEPS[kind].map((s) => s.replace('Discover Shaggar', brand.name));
  openModal(() => <><ModalHead title="Install app" /><div className="mbody">
    <p className="help" style={{ marginBottom: 12 }}>{kind === 'inapp' ? 'One extra step first:' : 'Your browser does not show an install button here, so add it in three steps:'}</p>
    <ol style={{ paddingLeft: 20, display: "grid", gap: 10, color: "var(--fg)", lineHeight: 1.5, fontSize: 15 }}>{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
    {kind !== 'inapp' ? <p className="help" style={{ marginTop: 14 }}>Already installed? Open it from your home screen. The page must be opened with https:// for installing to work.</p> : null}
    <button className="btn block" style={{ marginTop: 16 }} onClick={() => copyText(location.origin)}><Icon n="copy" />Copy the app link</button>
  </div></>);
}
actions.installApp = installApp;

/* ---------- content pages ---------- */
function Prose({ text }) {
  const blocks = String(text || '').split(/\n\s*\n/);
  const bullet = /^\s*[•\-*]\s+/;
  return <div className="prose">{blocks.map((b, i) => {
    const lines = b.split('\n');
    if (lines.every((l) => bullet.test(l))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{l.replace(bullet, '')}</li>)}</ul>;
    if (lines.length > 1 && lines.slice(1).every((l) => bullet.test(l))) return [<h4 key={i + 'h'}>{lines[0]}</h4>, <ul key={i}>{lines.slice(1).map((l, j) => <li key={j}>{l.replace(bullet, '')}</li>)}</ul>];
    return <p key={i}>{lines.map((l, j) => [j ? <br key={j} /> : null, l])}</p>;
  })}</div>;
}
export async function openPage(slug) {
  let p = data.pages.find((x) => x.slug === slug && x.body !== undefined);
  try { p = await api.page(slug); } catch (e) { if (!p) { toast(e.message, 'bad'); return; } }
  openModal(() => <><ModalHead title={tr(p, 'title')} /><div className="mbody"><Prose text={tr(p, 'body')} />{getLang() !== 'en' && !p['body_' + getLang()] ? <p className="help">{t('p.trmissing')}</p> : null}<p className="help" style={{ marginTop: 18 }}>Updated {fmtDate(p.updated_at)}</p></div></>);
  try { history.replaceState(null, '', '#page-' + slug); } catch { /* ignore */ }
}
actions.openPage = openPage;

/* ---------- problem reports (FR-040 to FR-042) ---------- */
function ReportForm({ placeId = '', tripId = '', title }) {
  const [type, setType] = useState(placeId ? Object.keys(REPORT_TYPES)[0] : '');
  const [f, setF] = useState({ description: '', contact: '', hp: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(null);
  if (code) {
    return <><ModalHead title="Thank you" /><div className="mbody"><Empty icon="check" title="Report sent"><span>Your report code is</span><div className="codebig">{code}</div><span>Keep it to check progress under More → {t('m.track')}.</span><button className="btn" onClick={() => copyText(code)}><Icon n="copy" />Copy code</button></Empty></div></>;
  }
  async function send() {
    if (!type) { setErr('Choose what is wrong.'); return; }
    setBusy(true);
    try {
      const r = await api.report({ place_id: placeId || undefined, trip_id: tripId || undefined, issue_type: type, description: f.description, contact: f.contact, hp: f.hp });
      rememberCode(r.code, 'report');
      setCode(r.code);
    } catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <>
      <ModalHead title={t('act.report')} />
      <div className="mbody"><form className="form" id="repForm" onSubmit={(e) => e.preventDefault()}>{title ? <div className="info">About <b>{title}</b></div> : null}
        <div className="f" data-f="issue_type"><span>What is wrong?</span><div className="radios">{Object.entries(REPORT_TYPES).map(([k, l]) => <label key={k} className="check"><input type="radio" name="rtype" value={k} checked={type === k} onChange={() => setType(k)} />{l}</label>)}</div><em className="ferr" hidden /></div>
        <Field k="description" label="Details"><textarea maxLength={2000} placeholder="What did you find? Where is the right entrance?" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <label className="f"><span>Phone or email (optional)</span><input maxLength={120} autoComplete="tel" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} /></label>
        <p className="help">Only Bureau staff see your contact details, in case they need to ask you something. They are removed after the report is closed.</p>
        <Honeypot value={f.hp} onChange={(v) => setF({ ...f, hp: v })} />
        <p className="formerr" role="alert">{err}</p></form></div>
      <div className="mfoot"><button className="btn" onClick={actions.closeModal}>Cancel</button><button className="btn primary" disabled={busy} onClick={send}>Send report</button></div>
    </>
  );
}
function reportForm(props) { openModal(() => <ReportForm {...props} />); }
Object.assign(actions, {
  reportPlace: (id) => { const p = data.byId.get(id); reportForm({ placeId: id, title: p ? tr(p, 'name') : '' }); },
  reportTrip: (id, title) => reportForm({ tripId: id, title }),
  reportGeneral: () => reportForm({}),
});

/* ---------- tracking a report or registration ---------- */
function Track() {
  const codes = savedCodes();
  const [code, setCode] = useState(codes[0]?.code || '');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState('');
  const [out, setOut] = useState(null);
  const [sure, setSure] = useState(false);
  async function go() {
    const c = code.trim().toUpperCase();
    setErr(''); setOut(null); setSure(false);
    try {
      if (c.startsWith('TR-')) setOut({ kind: 'trip', r: await api.lookupRegistration({ code: c, phone }) });
      else setOut({ kind: 'report', r: await api.trackReport(c) });
    } catch (e) { setErr(e.message); }
  }
  async function cancelReg() {
    if (!sure) { setSure(true); return; }
    try { await api.lookupRegistration({ code: code.trim(), phone, cancel: true }); toast('Registration cancelled'); go(); }
    catch (e) { toast(e.message, 'bad'); }
  }
  const r = out?.r;
  return (
    <>
      <ModalHead title={t('m.track')} />
      <div className="mbody"><form className="form" id="trkForm" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <label className="f"><span>Code</span><input id="trk-code" className="mono" placeholder="SR-XXXXXX or TR-XXXXXX" autoCapitalize="characters" value={code} onChange={(e) => setCode(e.target.value)} /></label>
        <label className="f" id="trk-phone-f"><span>Phone used when registering (trip codes only)</span><input id="trk-phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <p className="formerr" role="alert">{err}</p>
        <div id="trkOut">{out?.kind === 'trip' ? (
          <div className="card"><b>{r.title}</b><p className="help">{new Date(r.start_at).toLocaleString()} · {r.party_size} people · <span className={'pill st-' + r.status}>{r.status}</span></p>
            {r.status !== 'cancelled' ? <button type="button" className="btn sm danger" style={{ marginTop: 10 }} onClick={cancelReg}>{sure ? 'Tap again to cancel' : 'Cancel my registration'}</button> : null}
            <button type="button" className="btn sm" style={{ marginTop: 10 }} onClick={() => actions.openTrip(r.trip_id)}>Open trip</button></div>
        ) : out?.kind === 'report' ? (
          <div className="card"><b>{REPORT_TYPES[r.issue_type] || r.issue_type}</b>{r.place_name ? ` · ${r.place_name}` : ''}<p style={{ margin: '8px 0' }}><span className={'pill st-' + r.status}>{REPORT_STATUSES[r.status] || r.status}</span></p>
            {r.resolution ? <p>{r.resolution}</p> : <p className="help">The Bureau has not added a note yet.</p>}<p className="help">Sent {fmtDate(r.created_at)} · updated {fmtDate(r.updated_at)}</p></div>
        ) : null}</div>
        {codes.length ? <p className="help">Codes on this phone: {codes.map((c, i) => <span key={i}><button type="button" className="linkbtn" onClick={() => setCode(c.code)}>{c.code}</button> </span>)}</p> : null}
      </form></div>
      <div className="mfoot"><button className="btn" onClick={actions.closeModal}>Close</button><button className="btn primary" onClick={go}>Check</button></div>
    </>
  );
}
actions.trackOpen = () => openModal(() => <Track />);
