// Trips & events (FR-030 to FR-036): upcoming and past lists, trip details with stops and route, registration or enquiry.
import { useEffect, useState } from 'react';
import { TRIP_STATUS_LABELS, TRIP_CATEGORIES, SECTORS } from '../shared/catalog.js';
import { Icon, RawSvg, toast, copyText, rememberCode } from '../lib/util.js';
import { api } from '../lib/api.js';
import { S, data, actions, emit, subName, can, openModal } from '../lib/store.js';
import { t, tr, getLang } from '../lib/i18n.js';
import { formatLatLon } from '../shared/coords.js';
import { sceneSvg } from '../lib/art.js';
import { PageHead, ModalHead, Field, Honeypot, Empty, useScrollToError } from './common.jsx';
import * as M from './map.js';

const TRIP_ART = { nature: 'tourism', adventure: 'tourism', culture: 'government', festival: 'business', community: 'business', education: 'education' };
const LOCALE = () => ({ en: 'en-GB', om: 'om-ET', am: 'am-ET' }[getLang()] || undefined);
export const fmtWhen = (iso, opts = {}) => new Date(iso).toLocaleString(LOCALE(), { timeZone: 'Africa/Addis_Ababa', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', ...opts });
const DayBox = ({ iso }) => { const d = new Date(new Date(iso).getTime() + 3 * 3600e3); return <span className="daybox"><b>{d.getUTCDate()}</b><small>{d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}</small></span>; };
function StatusChip({ x }) {
  if (['postponed', 'cancelled', 'full'].includes(x.status) || x.past) return <span className={'pill st-' + (x.past ? 'completed' : x.status)}>{x.past ? 'Ended' : x.status === 'full' ? t('t.full') : TRIP_STATUS_LABELS[x.status]}</span>;
  if (x.registration_open) return <span className="pill st-open">{x.registration_mode === 'enquiry' ? 'Enquiries open' : 'Registration open'}</span>;
  return null;
}
const Art = ({ x }) => (x.cover ? <img src={x.cover} alt="" loading="lazy" /> : <RawSvg svg={sceneSvg(TRIP_ART[x.category] || 'tourism', x.id)} />);

export function TripCard({ x, compact = false }) {
  return (
    <button className={'tcard' + (compact ? ' compact' : '')} onClick={() => openTrip(x.id)}>
      <div className="tc-img"><Art x={x} /><DayBox iso={x.start_at} /></div>
      <div className="tc-b"><b>{tr(x, 'title')}</b><small>{fmtWhen(x.start_at)}{x.subcity_id != null ? ' · ' + subName(x.subcity_id) : ''}</small>
        <span className="tc-m"><StatusChip x={x} />{x.is_free ? <span className="pill">{t('t.free')}</span> : x.price ? <span className="pill">{x.price}</span> : null}{x.spots_left != null && !x.past && x.status === 'open' ? <span className="pill">{x.spots_left} {t('t.spots')}</span> : null}</span></div></button>
  );
}

let past = null;
export function Trips() {
  const tab = S.tripTab;
  const [, setLoaded] = useState(0);
  useEffect(() => {
    if (tab === 'past' && !past) api.trips({ when: 'past' }).then((r) => { past = r.items; }).catch(() => { past = []; }).finally(() => setLoaded((n) => n + 1));
  }, [tab]);
  if (tab === 'past' && !past) return <><PageHead title={t('nav.trips')} />{[0, 1, 2].map((i) => <div key={i} className="skeleton" />)}</>;
  const list = tab === 'past' ? past : data.trips.filter((x) => !x.past);
  const cats = [...new Set(list.map((x) => x.category))];
  return (
    <div><PageHead title={t('nav.trips')} sub="Guided trips, festivals and community events, published by the Tourism Bureau." />
      <div className="seg" role="group">
        <button aria-pressed={String(tab === 'upcoming')} onClick={() => { S.tripTab = 'upcoming'; emit(); }}>{t('t.upcoming')}</button>
        <button aria-pressed={String(tab === 'past')} onClick={() => { S.tripTab = 'past'; emit(); }}>{t('t.past')}</button>
        <button onClick={() => actions.setView('plan')}>{t('home.plan')}</button></div>
      {cats.length > 1 ? <div className="chips flat" style={{ padding: '0 0 12px' }}>{cats.map((c) => <span key={c} className="chip" style={{ cursor: 'default' }}>{TRIP_CATEGORIES[c] || c} · {list.filter((x) => x.category === c).length}</span>)}</div> : null}
      {list.length ? <div className="tlist">{list.map((x) => <TripCard key={x.id} x={x} />)}</div>
        : <div className="card"><Empty icon="calendar" title={t('t.none')} text={t('t.none_sub')}><button className="btn" onClick={() => actions.setView('plan')}><Icon n="route" />{t('home.plan')}</button></Empty></div>}
      {can('trips.manage') ? <a className="btn block" style={{ marginTop: 12 }} href="/admin/trips" target="_blank" rel="noopener"><Icon n="plus" />Create or edit trips in the admin portal</a> : null}
    </div>
  );
}

const Block = ({ label, text }) => (text ? <div><h4 className="sech" style={{ margin: '0 0 6px' }}>{label}</h4><p className="ddesc">{text}</p></div> : null);

function TripDetail({ x }) {
  const gmaps = x.meeting_lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${x.meeting_lat},${x.meeting_lon}` : x.meeting_place ? `https://www.google.com/maps/dir/?api=1&destination=${x.meeting_place.lat},${x.meeting_place.lon}` : '';
  const canReg = x.registration_open || (x.registration_mode === 'enquiry' && !x.past && !['cancelled', 'completed'].includes(x.status));
  const hasRoute = x.stops.filter((s) => s.lat != null).length > 0;
  return (
    <>
      <ModalHead title={tr(x, 'title')} hiddenTitle />
      <div className="mbody"><article className="detail">
        <div className="hero"><Art x={x} /><div className="hcap"><span className="pill" style={{ '--c': 'var(--violet)' }}>{TRIP_CATEGORIES[x.category] || ''}</span><StatusChip x={x} /></div></div>
        <div><h2 style={{ fontSize: 22 }}>{tr(x, 'title')}</h2><p className="muted" style={{ marginTop: 6 }}>{fmtWhen(x.start_at, { year: 'numeric' })}{x.end_at ? ' – ' + fmtWhen(x.end_at, { weekday: undefined }) : ''} (Ethiopia time)</p>{x.date_note ? <p className="help">{x.date_note}</p> : null}</div>
        {x.updates?.length ? <div className="notice"><b>{t('t.updates')}</b>{x.updates.map((u) => <p key={u.id} style={{ marginTop: 6 }}>{u.message} <span className="help">· {new Date(u.created_at).toLocaleDateString()}</span></p>)}</div> : null}
        {canReg ? <button className="btn primary block" onClick={() => openModal(() => <Register x={x} />)}><Icon n="check" />{t(x.registration_mode === 'enquiry' ? 't.enquire' : 't.register')}</button> : null}
        {x.summary ? <p className="ddesc"><b>{x.summary}</b></p> : null}{tr(x, 'description') ? <p className="ddesc">{tr(x, 'description')}</p> : null}
        <div className="spec">
          <div className="wide"><span className="label">{t('t.meeting')}</span><div className="v">{x.meeting_point || x.meeting_place?.name || 'To be announced'}{x.meeting_lat != null ? <div className="mono" style={{ color: 'var(--cyan)', fontSize: 13, marginTop: 4 }}>{formatLatLon(x.meeting_lat, x.meeting_lon)}</div> : null}</div>
            {gmaps ? <div className="gps-tools"><a className="btn sm" href={gmaps} target="_blank" rel="noopener"><Icon n="ext" />{t('act.directions')}</a>{x.meeting_place?.id ? <button className="btn sm" onClick={() => actions.openProfile(x.meeting_place.id)}>Place details</button> : null}</div> : null}</div>
          <div><span className="label">Cost</span><div className="v">{x.is_free ? t('t.free') : x.price || 'Ask the organiser'}</div></div>
          <div><span className="label">Places</span><div className="v">{x.capacity ? `${x.spots_left} of ${x.capacity} left` : 'No limit'}</div></div>
          {x.duration_note ? <div><span className="label">Duration</span><div className="v">{x.duration_note}</div></div> : null}
          {x.language ? <div><span className="label">Language</span><div className="v">{x.language}</div></div> : null}
          {x.organizer || x.contact_phone ? <div className="wide"><span className="label">Organiser</span><div className="v">{x.organizer}{x.contact_phone ? <> · <a className="mono" href={'tel:' + x.contact_phone.replace(/\s/g, '')}>{x.contact_phone}</a></> : null}{x.contact_email ? <> · <a href={'mailto:' + x.contact_email}>{x.contact_email}</a></> : null}</div></div> : null}
        </div>
        {x.stops.length ? <div><h4 className="sech" style={{ margin: '0 0 8px' }}>{t('t.stops')}</h4><div className="tl">{x.stops.map((s) => (
          <div key={s.seq} className="stop" style={{ '--c': SECTORS[s.sector]?.color || 'var(--cyan)' }}><span className="t">{s.planned_time || 'Stop ' + s.seq}</span>
            {s.place_id ? <button className="pl" onClick={() => actions.openProfile(s.place_id)}>{s.title}</button> : <span className="pl">{s.title}</span>}{s.notes ? <span className="leg">{s.notes}</span> : null}</div>
        ))}</div>
          {hasRoute ? <button className="btn block" onClick={() => tripRoute(x)}><Icon n="route" />{t('t.route')}</button> : null}</div> : null}
        <Block label="Included" text={x.includes} /><Block label="Not included" text={x.excludes} /><Block label={t('t.bring')} text={x.what_to_bring} /><Block label="Who can join" text={x.eligibility} />
        <Block label={t('p.access')} text={x.accessibility} /><Block label={t('p.safety')} text={x.safety} /><Block label="Cancellation and postponement" text={x.cancellation_policy} />
        {x.recap ? <Block label="Recap" text={x.recap} /> : null}
        {x.photos?.length ? <div className="hscroll">{x.photos.map((p) => <figure key={p.id} className="gfig"><img src={p.url} alt={p.caption || ''} loading="lazy" /><figcaption>{[p.caption, p.credit ? '© ' + p.credit : ''].filter(Boolean).join(' · ')}</figcaption></figure>)}</div> : null}
        <div className="actions"><button className="btn" onClick={() => tripShare(x)}><Icon n="share" />{t('act.share')}</button><button className="btn" onClick={() => actions.reportTrip(x.id, tr(x, 'title'))}><Icon n="flag" />{t('act.report')}</button></div>
      </article></div>
    </>
  );
}

export async function openTrip(id) {
  let x;
  try { x = await api.trip(id); } catch (e) { toast(e.message, 'bad'); return; }
  openModal(() => <TripDetail x={x} />);
  try { history.replaceState(null, '', '#trip-' + id); } catch { /* ignore */ }
}
actions.openTrip = openTrip;

async function tripShare(x) {
  const url = location.origin + '/#trip-' + x.id;
  try { if (navigator.share) { await navigator.share({ title: tr(x, 'title'), url }); return; } } catch { return; }
  copyText(url);
}
function tripRoute(x) {
  const pts = x.stops.filter((s) => s.lat != null).map((s) => (s.place_id && data.byId.get(s.place_id)) || { id: 'stop' + s.seq, lat: s.lat, lon: s.lon });
  S.route = pts.map((p) => (data.byId.has(p.id) ? p.id : p));
  S.sector = 'all'; S.nearChip = null; S.q = ''; S.sub = null; S.sel = null;
  actions.closeModal(); actions.setView('map');
  setTimeout(() => M.fitPoints(pts, 15), 60);
}

/* ----- registration (FR-033: minimum data, privacy notice) ----- */
function Register({ x }) {
  const enquiry = x.registration_mode === 'enquiry';
  const [f, setF] = useState({ name: '', phone: '', email: '', party: '1', notes: '', consent: false, hp: '' });
  const [errors, setErrors] = useState({});
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const ref = useScrollToError(errors, formErr);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const backToTrip = () => openTrip(x.id);
  if (done) {
    return <><ModalHead title={done.kind === 'enquiry' ? 'Enquiry sent' : 'You are registered'} /><div className="mbody"><Empty icon="check" title={tr(x, 'title')}><span>{fmtWhen(x.start_at, { year: 'numeric' })}</span><span>Your code</span><div className="codebig">{done.code}</div>
      <span>{done.kind === 'enquiry' ? 'The organiser will call you back.' : 'Show this code at the meeting point. You can check or cancel it under More → ' + t('m.track') + '.'}</span><button className="btn" onClick={() => copyText(done.code)}><Icon n="copy" />Copy code</button></Empty></div></>;
  }
  async function send() {
    setErrors({}); setFormErr(''); setBusy(true);
    try {
      const r = await api.register(x.id, { name: f.name, phone: f.phone, email: f.email, party_size: enquiry ? 1 : f.party || 1, notes: f.notes, consent: f.consent, hp: f.hp });
      rememberCode(r.code, 'trip');
      setDone(r);
      data.trips = (await api.trips({ when: 'upcoming' }).catch(() => ({ items: data.trips }))).items;
      emit();
    } catch (e) { setErrors(e.details || {}); setFormErr(e.message); setBusy(false); }
  }
  return (
    <>
      <ModalHead title={t(enquiry ? 't.enquire' : 't.register')} onClose={backToTrip} back />
      <div className="mbody"><form className="form" id="regForm" ref={ref} onSubmit={(e) => e.preventDefault()}><div className="info"><b>{tr(x, 'title')}</b><br />{fmtWhen(x.start_at, { year: 'numeric' })}</div>
        <Field k="name" label="Your name" error={errors.name}><input maxLength={80} autoComplete="name" value={f.name} onChange={set('name')} /></Field>
        <Field k="phone" label="Phone" error={errors.phone}><input type="tel" maxLength={40} autoComplete="tel" placeholder="+251 9…" value={f.phone} onChange={set('phone')} /></Field>
        <Field k="email" label="Email (optional)" error={errors.email}><input type="email" maxLength={120} autoComplete="email" value={f.email} onChange={set('email')} /></Field>
        {enquiry ? null : <label className="f" data-f="party_size"><span>Number of people</span><input type="number" min="1" max="20" value={f.party} onChange={set('party')} /></label>}
        <label className="f"><span>{enquiry ? 'Your question' : 'Anything the organiser should know? (optional)'}</span><textarea maxLength={500} value={f.notes} onChange={set('notes')} /></label>
        <label className={'check' + (errors.consent ? ' invalid' : '')} data-f="consent"><input type="checkbox" checked={f.consent} onChange={set('consent')} />I agree that the Bureau keeps these details to organise this trip and contact me about changes. They are deleted after the trip. <button type="button" className="linkbtn" onClick={() => actions.openPage('privacy')} style={{ padding: 0 }}>Privacy notice</button></label>
        <Honeypot value={f.hp} onChange={(v) => setF({ ...f, hp: v })} />
        <p className="formerr" role="alert">{formErr}</p></form></div>
      <div className="mfoot"><button className="btn" onClick={backToTrip}>Back</button><button className="btn primary" id="rgBtn" disabled={busy} onClick={send}>{t(enquiry ? 't.enquire' : 't.register')}</button></div>
    </>
  );
}
