// Restaurant menus on the place page, and contributions from the public:
// customers add menu items, visitors share photos of tourist sites. Both wait for a supervisor's approval.
import { useState } from 'react';
import { MENU_SECTIONS } from '../shared/catalog.js';
import { Icon, toast, shrinkImage, fmtDate } from '../lib/util.js';
import { api } from '../lib/api.js';
import { data, actions, can, openModal } from '../lib/store.js';
import { tr } from '../lib/i18n.js';
import { ModalHead, Field, Honeypot, Empty } from './common.jsx';

const money = (m) => (m.price == null ? (m.price_note || '') : `${m.currency === 'ETB' ? 'ETB ' : m.currency + ' '}${Number(m.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}${m.price_note ? ' · ' + m.price_note : ''}`);

export function MenuBlock({ p }) {
  const items = (p.menu || []).filter((m) => m.status === undefined || m.status === 'approved');
  const sections = [...new Set(items.map((m) => m.section))];
  return (
    <div className="menu" id="menu"><h4 className="sech" style={{ margin: 0 }}>{p.type === 'hotel' ? 'Rooms & menu' : 'Menu'}</h4>
      {items.length ? sections.map((sec) => (
        <div key={sec}><h4>{sec}</h4>{items.filter((m) => m.section === sec).map((m) => (
          <div key={m.id} className={'mitem' + (m.photo ? ' withimg' : '')}>{m.photo ? <img src={m.photo} alt="" loading="lazy" /> : null}
            <b>{tr(m, 'name')}{m.tags?.length ? <span className="mtags">{m.tags.map((x) => <i key={x} className={x}>{x}</i>)}</span> : null}</b><span className="price">{money(m)}</span>
            {m.description || m.source === 'customer' ? <small>{m.description}{m.source === 'customer' ? (m.description ? ' · ' : '') + 'added by a customer' : ''}</small> : null}</div>
        ))}</div>
      )) : <p className="help">No menu yet. Know what they serve? Add a dish and its price.</p>}
      {p.menu_updated_at ? <p className="help">Prices last checked {fmtDate(p.menu_updated_at)}. Prices can change; ask before you order.</p> : null}
      <button className="btn block" onClick={() => actions.menuAdd(p.id)}><Icon n="plus" />{can('places.edit') ? 'Add a menu item' : 'Add a dish or correct a price'}</button></div>
  );
}

const back = (id) => () => (id ? reopen(id) : actions.closeModal());
function reopen(id) { actions.closeModal(); actions.openProfile(id); }

/** Photo picker that shows the chosen image (shrunk on the phone first). */
function PhotoPick({ id, onPicked, picked, label, capture, k }) {
  return (
    <label className="photopick" id={id} data-f={k}>
      {picked ? <img src={picked} alt="Chosen photo" /> : <Icon n="camera" />}
      {label}
      <input type="file" accept="image/*" capture={capture} className="vh" onChange={async (e) => {
        const f = e.target.files?.[0]; if (!f) return;
        try { onPicked(await shrinkImage(f, 1800)); } catch (x) { toast(x.message, 'bad'); }
      }} />
    </label>
  );
}

/* ---------- menu item ---------- */
function MenuAdd({ p }) {
  const staff = can('places.edit');
  const [f, setF] = useState({ name: '', price: '', section: MENU_SECTIONS[0], description: '', tags: [], who: '', contact: '', hp: '' });
  const [photo, setPhoto] = useState(null);
  const [errors, setErrors] = useState({});
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); if (errors[k]) setErrors({ ...errors, [k]: undefined }); };
  async function send() {
    const body = { name: f.name, price: f.price, section: f.section, description: f.description, tags: f.tags, hp: f.hp };
    if (photo) body.photo = photo;
    if (!body.name.trim()) { setErrors({ name: 'Enter the dish or item name.' }); setFormErr(''); return; }
    setBusy(true);
    try {
      if (staff) {
        const r = await api.addMenuItem(p.id, body);
        toast(r.item.status === 'pending' ? 'Saved. Waiting for your supervisor’s approval.' : 'Menu item added');
      } else {
        body.submitter_name = f.who; body.contact = f.contact;
        await api.suggestMenuItem(p.id, body);
        toast('Thank you. The Bureau will check it soon.');
      }
      reopen(p.id);
    } catch (e) { setErrors(e.details || {}); setFormErr(e.message); setBusy(false); }
  }
  return (
    <>
      <ModalHead title={staff ? 'Add a menu item' : 'Add to the menu'} onClose={back(p.id)} back />
      <div className="mbody"><form className="form" id="miForm" onSubmit={(e) => e.preventDefault()}>
        <div className="info"><b>{tr(p, 'name')}</b><br />{staff ? 'Your supervisor approves items added to a live place.' : 'The Bureau checks every addition before it appears.'}</div>
        <Field k="name" label="Dish or item" error={errors.name}><input maxLength={120} placeholder="Shiro tegabino" value={f.name} onChange={set('name')} /></Field>
        <div className="two">
          <Field k="price" label="Price (ETB)" error={errors.price}><input inputMode="decimal" placeholder="180" value={f.price} onChange={set('price')} /></Field>
          <label className="f"><span>Section</span><select value={f.section} onChange={set('section')}>{MENU_SECTIONS.map((x) => <option key={x}>{x}</option>)}</select></label>
        </div>
        <label className="f"><span>Description (optional)</span><input maxLength={500} placeholder="Served with injera" value={f.description} onChange={set('description')} /></label>
        <div className="f"><span>Good to know</span><div className="checks" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>{['fasting', 'vegetarian', 'spicy', 'popular'].map((x) => (
          <label key={x} className="check" style={{ minHeight: 34 }}><input type="checkbox" checked={f.tags.includes(x)} onChange={(e) => setF({ ...f, tags: e.target.checked ? [...f.tags, x] : f.tags.filter((y) => y !== x) })} />{x[0].toUpperCase() + x.slice(1)}</label>
        ))}</div></div>
        <PhotoPick id="miPick" picked={photo} onPicked={setPhoto} label={<span>Add a photo of the dish (optional)</span>} />
        {staff ? null : <div className="two"><label className="f"><span>Your name (optional)</span><input maxLength={80} autoComplete="name" value={f.who} onChange={set('who')} /></label><label className="f"><span>Phone (optional)</span><input maxLength={120} type="tel" value={f.contact} onChange={set('contact')} /></label></div>}
        <Honeypot value={f.hp} onChange={(v) => setF({ ...f, hp: v })} />
        <p className="formerr" role="alert">{formErr}</p></form></div>
      <div className="mfoot"><button className="btn" onClick={back(p.id)}>Cancel</button><button className="btn primary" disabled={busy} onClick={send}>{staff ? 'Save item' : 'Send for approval'}</button></div>
    </>
  );
}
actions.menuAdd = (id) => { const p = data.byId.get(id); if (p) openModal(() => <MenuAdd p={p} />); };

/* ---------- visitor photo ---------- */
function VisitorPhoto({ p }) {
  const [photo, setPhoto] = useState(null);
  const [f, setF] = useState({ caption: '', name: '', contact: '', consent: false, hp: '' });
  const [errors, setErrors] = useState({});
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  if (done) {
    return <><ModalHead title="Thank you!" /><div className="mbody"><Empty icon="check" title="Photo received" text="It will appear on the place page once a supervisor approves it."><button className="btn primary" onClick={back(p.id)}>Back to the place</button></Empty></div></>;
  }
  async function send() {
    if (!photo) { setErrors({}); setFormErr('Choose a photo first.'); return; }
    if (!f.consent) { setErrors({ consent: 'Please confirm.' }); setFormErr('Please confirm you took the photo and allow it to be published.'); return; }
    setBusy(true);
    try {
      await api.visitorPhoto(p.id, { photo, caption: f.caption, name: f.name, contact: f.contact, consent: true, hp: f.hp });
      setDone(true);
    } catch (e) { setErrors(e.details || {}); setFormErr(e.message); setBusy(false); }
  }
  return (
    <>
      <ModalHead title="Share your photo" onClose={back(p.id)} back />
      <div className="mbody"><form className="form" id="vpForm" onSubmit={(e) => e.preventDefault()}>
        <div className="info">Photos of <b>{tr(p, 'name')}</b> help other visitors. A supervisor checks every photo before it appears, usually within a few days.</div>
        <PhotoPick id="vpPick" k="photo" picked={photo} onPicked={setPhoto} capture="environment" label={<span><b>Take or choose a photo</b><br /><small className="help">Landscape photos of the site work best. Avoid close-ups of people.</small></span>} />
        <label className="f"><span>Caption (optional)</span><input maxLength={200} placeholder="View from the ridge in the morning" value={f.caption} onChange={set('caption')} /></label>
        <div className="two"><label className="f"><span>Your name, shown as credit (optional)</span><input maxLength={80} autoComplete="name" value={f.name} onChange={set('name')} /></label><label className="f"><span>Phone or email (optional, not shown)</span><input maxLength={120} value={f.contact} onChange={set('contact')} /></label></div>
        <label className={'check' + (errors.consent ? ' invalid' : '')} data-f="consent"><input type="checkbox" checked={f.consent} onChange={set('consent')} />I took this photo and allow the city to publish it with my name. It does not show anyone who has not agreed.</label>
        <Honeypot value={f.hp} onChange={(v) => setF({ ...f, hp: v })} />
        <p className="formerr" role="alert">{formErr}</p></form></div>
      <div className="mfoot"><button className="btn" onClick={back(p.id)}>Cancel</button><button className="btn primary" disabled={busy} onClick={send}>{busy ? 'Sending…' : <><Icon n="upload" />Send photo</>}</button></div>
    </>
  );
}
actions.visitorPhoto = (id) => { const p = data.byId.get(id); if (p) openModal(() => <VisitorPhoto p={p} />); };

actions.visitorGallery = (id, i) => {
  const p = data.byId.get(id);
  const v = (p?.photos || []).filter((x) => x.source === 'visitor')[i]; if (!v) return;
  openModal(() => <><ModalHead title={v.caption || 'Visitor photo'} onClose={back(p.id)} back /><div className="mbody"><img src={v.url} alt={v.caption || ''} style={{ width: '100%', borderRadius: 16 }} /><p className="help" style={{ marginTop: 8 }}>Photo by {v.credit || 'a visitor'}</p></div></>);
};
