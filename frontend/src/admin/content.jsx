// Content: pages, home-screen announcements, the category catalog and sub-city details.
import { useState } from 'react';
import { SECTORS, ICON_CHOICES, subcityCode, SUBCITY_IDS } from '../shared/catalog.js';
import { parseCoords, formatLatLon, normalizeBoundary } from '../shared/coords.js';
import {
  A, api, toast, can, go, nav, subLabel, PageHead, Loading, Empty, Fld, Sel, Check, val, setVal, useFormErrors, LangFields,
  openDialog, closeDialog, Dlg, confirmDlg, relTime, fmtDateTime, loadCatalog, loadSubcities, BusyButton, useAsync, Notice, NavLink, Icon, readTextFile,
} from './core.jsx';

const toLocal = (iso) => (iso ? new Date(new Date(iso).getTime() + 3 * 3600e3).toISOString().slice(0, 16) : '');
const remap = (details, fn) => Object.fromEntries(Object.entries(details || {}).map(([k, v]) => [fn(k), v]));

/* ---------- pages ---------- */
export function PagesView({ id }) {
  if (id) return <PageEditor key={id} slug={id} />;
  const q = useAsync(() => api.pages(true).then((r) => r.items), []);
  const head = <PageHead title="Pages" sub="About, privacy notice, help, contact and any other information page shown in the app’s More tab." right={<button className="btn primary" onClick={() => go('pages', '_new')}><Icon n="plus" />New page</button>} />;
  if (q.error) return <>{head}<Notice error={q.error} /></>;
  if (!q.data) return <>{head}<Loading n={4} /></>;
  return (
    <>{head}<div className="tbl-wrap"><table className="tbl"><thead><tr><th>Page</th><th>Address</th><th>Translations</th><th>Status</th><th>Updated</th></tr></thead><tbody>
      {q.data.map((p) => (
        <tr key={p.slug}><td><NavLink className="rowlink" to={'pages/' + p.slug}>{p.title}</NavLink></td><td className="mono muted">/{p.slug}</td>
          <td><span className="flags">{p.title_om && p.body_om ? <span className="flag ok">OM</span> : <span className="flag">OM missing</span>}{p.title_am && p.body_am ? <span className="flag ok">AM</span> : <span className="flag">AM missing</span>}</span></td>
          <td>{p.published ? <span className="pill st-published">Published</span> : <span className="pill st-draft">Hidden</span>}{p.in_menu ? null : <span className="sub">not in menu</span>}</td><td className="muted">{relTime(p.updated_at)}</td></tr>
      ))}</tbody></table></div></>
  );
}

function PageEditor({ slug }) {
  const isNew = slug === '_new';
  const q = useAsync(() => (isNew ? Promise.resolve({ published: 1, in_menu: 1, sort: 50 }) : api.page(slug)), [slug]);
  const f = useFormErrors();
  if (q.error) return <Notice error={q.error} />;
  if (!q.data) return <Loading n={6} />;
  const p = q.data;
  const save = async () => {
    const s = isNew ? val('pg-slug') : slug;
    const b = { published: val('pg-published'), in_menu: val('pg-in_menu'), sort: Number(val('pg-sort')) };
    for (const k of ['title', 'title_om', 'title_am', 'body', 'body_om', 'body_am']) b[k] = val('pg-' + k);
    try { await api.savePage(s, b); toast('Page saved'); go('pages', s, { replace: true }); if (!isNew) q.reload(); }
    catch (e) { f.setErrors(remap(e.details, (k) => (k === 'slug' ? 'slug' : 'pg-' + k)), e.message); }
  };
  return (
    <>
      <button className="crumb" onClick={() => nav('pages')}><Icon n="back" />All pages</button>
      <PageHead title={isNew ? 'New page' : p.title} sub={isNew ? null : `Shown in the app at More → ${p.title}`} />
      <div className="split"><div className="card" id="pgform" ref={f.ref}><div className="sect">
        {isNew ? <Fld k="slug" label="Web address" errors={f.errors} help="Lowercase letters, numbers and dashes."><input id="pg-slug" placeholder="visitor-guide" maxLength={40} /></Fld> : null}
        <LangFields prefix="pg-" rec={p} fields={[['title', 'Title', 'input', { maxLength: 120 }], ['body', 'Text', 'area', { rows: 16 }]]} errors={f.errors} />
        <p className="help">Plain text. Blank lines start new paragraphs; lines starting with • or - become bullet points.</p><p className="formerr">{f.msg}</p></div></div>
        <aside><div className="card wfbox"><h3>Publish</h3><Check id="pg-published" label="Published" on={!!p.published} /><Check id="pg-in_menu" label="Show in the More menu" on={!!p.in_menu} />
          <Fld k="sort" label="Menu order" errors={f.errors}><input id="pg-sort" type="number" defaultValue={p.sort} /></Fld>
          <BusyButton className="btn primary" onClick={save}><Icon n="check" />Save page</BusyButton>
          {!isNew && !['about', 'privacy', 'help', 'contact'].includes(slug) ? <button className="btn danger sm" onClick={async () => {
            if ((await confirmDlg('Delete page', 'Delete this page for good?', { okLabel: 'Delete', danger: true })) === null) return;
            try { await api.deletePage(slug); toast('Page deleted'); go('pages'); } catch (e) { toast(e.message, 'bad'); }
          }}><Icon n="trash" />Delete page</button> : null}</div></aside></div>
    </>
  );
}

/* ---------- announcements ---------- */
const TONES = [['info', 'Information'], ['event', 'Event'], ['warn', 'Warning or closure'], ['success', 'Good news']];
const LINKS = [['none', 'No link'], ['place', 'A place'], ['trip', 'A trip or event'], ['page', 'A page'], ['url', 'A web address']];
export function AnnouncementsView() {
  const q = useAsync(() => api.announcements(true).then((r) => r.items), []);
  const edit = (a) => openDialog(() => <AnnDialog a={a || { tone: 'info', link_kind: 'none', active: 1, sort: 0 }} done={q.reload} />);
  const head = <PageHead title="Announcements" sub="Banners on the app’s Home screen: festivals, closures, new attractions. Set start and end dates so they appear and disappear on time." right={<button className="btn primary" onClick={() => edit(null)}><Icon n="plus" />New announcement</button>} />;
  if (q.error) return <>{head}<Notice error={q.error} /></>;
  if (!q.data) return <>{head}<Loading n={3} /></>;
  const now = new Date().toISOString();
  const state = (a) => (!a.active ? ['Off', 'draft'] : a.starts_at && a.starts_at > now ? ['Scheduled', 'scheduled'] : a.ends_at && a.ends_at < now ? ['Ended', 'archived'] : ['Showing now', 'published']);
  return (
    <>{head}{q.data.length ? <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Announcement</th><th>Shown</th><th>State</th><th></th></tr></thead><tbody>
      {q.data.map((a) => (
        <tr key={a.id}><td><b>{a.title}</b><span className="sub">{a.body.slice(0, 100)}</span></td><td className="muted">{a.starts_at ? fmtDateTime(a.starts_at) : 'Now'} → {a.ends_at ? fmtDateTime(a.ends_at) : 'until switched off'}</td>
          <td><span className={'pill st-' + state(a)[1]}>{state(a)[0]}</span></td><td><div className="acts"><button className="btn sm" onClick={() => edit(a)}>Edit</button><button className="iconbtn sm" aria-label="Delete" onClick={async () => {
            if ((await confirmDlg('Delete announcement', 'Delete this announcement?', { okLabel: 'Delete', danger: true })) === null) return;
            try { await api.deleteAnnouncement(a.id); q.reload(); } catch (e) { toast(e.message, 'bad'); }
          }}><Icon n="trash" /></button></div></td></tr>
      ))}</tbody></table></div> : <div className="card"><Empty title="No announcements" text="Add one to show a banner on the Home screen." icon="megaphone" /></div>}</>
  );
}
function AnnDialog({ a, done }) {
  const f = useFormErrors();
  const save = async () => {
    const b = { tone: val('an-tone'), sort: Number(val('an-sort')) || 0, starts_at: val('an-starts_at'), ends_at: val('an-ends_at'), link_kind: val('an-link_kind'), link_value: val('an-link_value'), active: val('an-active') };
    for (const k of ['title', 'title_om', 'title_am', 'body', 'body_om', 'body_am']) b[k] = val('an-' + k);
    try { await (a.id ? api.updateAnnouncement(a.id, b) : api.createAnnouncement(b)); closeDialog(); toast('Announcement saved'); done(); }
    catch (e) { f.setErrors(remap(e.details, (k) => (k.startsWith('title') || k.startsWith('body') ? 'an-' + k : k)), e.message); }
  };
  const E = f.errors;
  return (
    <Dlg title={a.id ? 'Edit announcement' : 'New announcement'} wide foot={<><button className="btn" onClick={closeDialog}>Cancel</button><BusyButton className="btn primary" onClick={save}>Save</BusyButton></>}>
      <div className="sect" id="anform" ref={f.ref}>
        <LangFields prefix="an-" rec={a} fields={[['title', 'Title', 'input', { maxLength: 120 }], ['body', 'Text', 'area', { rows: 3, maxLength: 600 }]]} errors={E} />
        <div className="fgrid"><Fld k="tone" label="Style" errors={E}><Sel id="an-tone" opts={TONES} cur={a.tone} /></Fld><Fld k="sort" label="Order" errors={E}><input id="an-sort" type="number" defaultValue={a.sort} /></Fld>
          <Fld k="starts_at" label="Show from (Ethiopia time)" errors={E}><input id="an-starts_at" type="datetime-local" defaultValue={toLocal(a.starts_at)} /></Fld><Fld k="ends_at" label="Show until" errors={E}><input id="an-ends_at" type="datetime-local" defaultValue={toLocal(a.ends_at)} /></Fld>
          <Fld k="link_kind" label="Tapping it opens" errors={E}><Sel id="an-link_kind" opts={LINKS} cur={a.link_kind} /></Fld>
          <Fld k="link_value" label="Link target" errors={E} help="For a place or trip, paste its ID from the address bar of its admin page."><input id="an-link_value" defaultValue={a.link_value} placeholder="Place or trip ID, page address, or https://…" /></Fld></div>
        <Check id="an-active" label="Switched on" on={a.active !== 0 && a.active !== false} /><p className="formerr">{f.msg}</p></div>
    </Dlg>
  );
}

/* ---------- categories ---------- */
export function CategoriesView() {
  const q = useAsync(async () => { const c = await api.catalog(); await loadCatalog(); return c; }, []);
  const cat = q.data;
  const sector = (s) => openDialog(() => <SectorDialog s={s || { color: '#9FB3C8', icon: 'pin', review_months: 12, sort: cat.sectors.length, active: 1 }} done={q.reload} />);
  const type = (x) => openDialog(() => <TypeDialog cat={cat} x={x || { sector: cat.sectors[0]?.key, sort: 50, active: 1, attraction: 0 }} done={q.reload} />);
  const head = <PageHead title="Categories" sub="Category groups (with colour, icon and review interval) and the categories inside them. Retire a category instead of deleting it once places use it."
    right={<><button className="btn" onClick={() => cat && sector(null)}><Icon n="plus" />New group</button><button className="btn primary" onClick={() => cat && type(null)}><Icon n="plus" />New category</button></>} />;
  if (q.error) return <>{head}<Notice error={q.error} /></>;
  if (!cat) return <>{head}<Loading n={4} /></>;
  return (
    <>{head}{cat.sectors.map((s) => {
      const types = cat.types.filter((x) => x.sector === s.key);
      return (
        <div key={s.key} className="card" style={s.active ? undefined : { opacity: 0.6 }}><h3><span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="sbadge" style={{ '--c': s.color, width: 34, height: 34, borderRadius: 11 }}><Icon n={s.icon} /></span>{s.label}
          <span className="help">{s.label_om || '—'} · {s.label_am || '—'} · review every {s.review_months} months{s.active ? '' : ' · retired'}</span></span><button className="btn sm" onClick={() => sector(s)}>Edit group</button></h3>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Category</th><th>Afaan Oromoo</th><th>Amharic</th><th>Tourism attraction</th><th className="num">Places</th><th></th></tr></thead><tbody>
            {types.length ? types.map((x) => (
              <tr key={x.key} style={x.active ? undefined : { opacity: 0.55 }}><td><b>{x.label}</b><span className="sub mono">{x.key}{x.active ? '' : ' · retired'}</span></td><td>{x.label_om || <span className="flag">missing</span>}</td><td>{x.label_am || <span className="flag">missing</span>}</td>
                <td>{x.attraction ? 'Yes' : ''}{x.has_menu ? <> <span className="flag ok">Menu</span></> : null}</td><td className="num">{x.places ?? ''}</td><td><div className="acts"><button className="btn sm" onClick={() => type(x)}>Edit</button></div></td></tr>
            )) : <tr><td colSpan={6} className="muted">No categories yet.</td></tr>}
          </tbody></table></div></div>
      );
    })}</>
  );
}
function SectorDialog({ s, done }) {
  const f = useFormErrors();
  const E = f.errors;
  const save = async () => {
    const b = {}; for (const k of ['label', 'label_om', 'label_am', 'color', 'icon', 'review_months', 'sort']) b[k] = val('cs-' + k);
    b.review_months = Number(b.review_months); b.sort = Number(b.sort);
    if (document.getElementById('cs-active')) b.active = val('cs-active');
    try { await (s.key ? api.updateSector(s.key, b) : api.addSector(b)); closeDialog(); toast('Saved'); done(); } catch (e) { f.setErrors(e.details, e.message); }
  };
  return (
    <Dlg title={s.key ? 'Edit category group' : 'New category group'} wide foot={<><button className="btn" onClick={closeDialog}>Cancel</button><BusyButton className="btn primary" onClick={save}>Save</BusyButton></>}>
      <div className="sect" id="csform" ref={f.ref}><div className="fgrid3">
        <Fld k="label" label="Name (English)" errors={E}><input id="cs-label" defaultValue={s.label} /></Fld><Fld k="label_om" label="Afaan Oromoo" errors={E}><input id="cs-label_om" defaultValue={s.label_om} /></Fld><Fld k="label_am" label="Amharic" errors={E}><input id="cs-label_am" defaultValue={s.label_am} /></Fld>
        <Fld k="color" label="Colour" errors={E}><input id="cs-color" type="color" defaultValue={s.color} /></Fld><Fld k="icon" label="Icon" errors={E}><Sel id="cs-icon" opts={ICON_CHOICES.map((i) => [i, i])} cur={s.icon} /></Fld>
        <Fld k="review_months" label="Review every (months)" errors={E} help="Hospitals and key offices: 3–6. Ordinary services: 6–12."><input id="cs-review_months" type="number" min="1" max="36" defaultValue={s.review_months} /></Fld>
        <Fld k="sort" label="Order" errors={E}><input id="cs-sort" type="number" defaultValue={s.sort} /></Fld></div>
        {s.key ? <Check id="cs-active" label="In use (untick to retire)" on={!!s.active} /> : null}<p className="formerr">{f.msg}</p></div>
    </Dlg>
  );
}
function TypeDialog({ cat, x, done }) {
  const f = useFormErrors();
  const E = f.errors;
  const save = async () => {
    const b = { label: val('ct-label'), label_om: val('ct-label_om'), label_am: val('ct-label_am'), sort: Number(val('ct-sort')) || 0, attraction: val('ct-attraction'), has_menu: val('ct-has_menu') };
    if (document.getElementById('ct-active')) b.active = val('ct-active');
    try { await (x.key ? api.updateType(x.sector, x.key, b) : api.addType({ ...b, sector: val('ct-sector') })); closeDialog(); toast('Saved'); done(); } catch (e) { f.setErrors(e.details, e.message); }
  };
  return (
    <Dlg title={x.key ? 'Edit category' : 'New category'} wide foot={<>
      {x.key && !x.places ? <BusyButton className="btn danger" style={{ marginRight: 'auto' }} onClick={async () => { await api.deleteType(x.sector, x.key); closeDialog(); toast('Deleted'); done(); }}>Delete</BusyButton> : null}
      <button className="btn" onClick={closeDialog}>Cancel</button><BusyButton className="btn primary" onClick={save}>Save</BusyButton></>}>
      <div className="sect" id="ctform" ref={f.ref}><div className="fgrid3">
        {x.key ? <div className="f"><span>Group</span><b>{SECTORS[x.sector]?.label || x.sector}</b></div> : <Fld k="sector" label="Group" errors={E}><Sel id="ct-sector" opts={cat.sectors.map((s) => [s.key, s.label])} cur={x.sector} /></Fld>}
        <Fld k="label" label="Name (English)" errors={E}><input id="ct-label" defaultValue={x.label} /></Fld><Fld k="sort" label="Order" errors={E}><input id="ct-sort" type="number" defaultValue={x.sort} /></Fld>
        <Fld k="label_om" label="Afaan Oromoo" errors={E}><input id="ct-label_om" defaultValue={x.label_om} /></Fld><Fld k="label_am" label="Amharic" errors={E}><input id="ct-label_am" defaultValue={x.label_am} /></Fld></div>
        <Check id="ct-attraction" label="Tourism attraction (shown in Discover and trip planning)" on={!!x.attraction} />
        <Check id="ct-has_menu" label="Has a menu (restaurants, cafés, hotels): staff and customers can add dishes and prices" on={!!x.has_menu} />
        {x.key ? <Check id="ct-active" label="In use (untick to retire)" on={!!x.active} /> : null}<p className="formerr">{f.msg}</p></div>
    </Dlg>
  );
}

/* ---------- sub-cities ---------- */
export function AreasView() {
  const q = useAsync(async () => { await loadSubcities(); return can('reports.view') ? await api.dashboard() : {}; }, []);
  const head = <PageHead title="Sub-cities" sub="The 12 sub-cities and the Mayor’s Office. Load official names, codes and boundaries from the approved administrative source." />;
  if (q.error) return <>{head}<Notice error={q.error} /></>;
  if (!q.data) return <>{head}<Loading n={6} /></>;
  const cov = Object.fromEntries((q.data.coverage || []).map((c) => [c.id, c]));
  return (
    <>{head}<div className="tbl-wrap"><table className="tbl"><thead><tr><th>Code</th><th>Name</th><th>Focal person</th><th>Centre</th><th>Boundary</th><th className="num">Published</th><th className="num">In review</th><th className="num">Overdue</th><th></th></tr></thead><tbody>
      {SUBCITY_IDS.map((id) => {
        const s = A.subcities.get(id) || {}; const c = cov[id] || {};
        return (
          <tr key={id}><td className="mono">{s.official_code || subcityCode(id)}</td><td><b>{s.name}</b><span className="sub">{s.alt_names || ''}{s.phone ? ' · ' + s.phone : ''}</span></td>
            <td className="muted">{s.focal_person || '—'}</td><td className="mono muted">{s.lat != null ? formatLatLon(s.lat, s.lon) : <span className="flag">not set</span>}</td><td>{s.boundary ? <span className="flag ok">Loaded</span> : <span className="flag">None</span>}{c.boundary ? <span className="sub">{c.boundary} outside</span> : null}</td>
            <td className="num">{c.published ?? '—'}</td><td className="num">{c.awaiting ?? '—'}</td><td className="num">{c.overdue ?? '—'}</td>
            <td><div className="acts">{can('areas.manage') ? <button className="btn sm" onClick={() => openDialog(() => <AreaDialog id={id} done={q.reload} />)}>Edit</button> : null}</div></td></tr>
        );
      })}</tbody></table></div></>
  );
}
function AreaDialog({ id, done }) {
  const s = A.subcities.get(id) || {};
  const f = useFormErrors();
  const E = f.errors;
  const save = async () => {
    const b = {}; for (const k of ['name', 'official_code', 'phone', 'alt_names', 'focal_person', 'coords', 'summary', 'summary_om', 'summary_am', 'boundary']) b[k] = val('ar-' + k);
    if (b.coords) { const p = parseCoords(b.coords); if (!p || p.error) { f.setErrors({ coords: p?.error || 'Invalid' }, 'Check the centre point.'); return; } }
    try { await api.saveSubcity(id, b); closeDialog(); toast('Sub-city saved'); done(); }
    catch (e) { f.setErrors(remap(e.details, (k) => (k.startsWith('summary') ? 'ar-' + k : k)), e.message); }
  };
  return (
    <Dlg title={'Edit ' + (s.name || subLabel(id))} wide foot={<><button className="btn" onClick={closeDialog}>Cancel</button><BusyButton className="btn primary" onClick={save}>Save</BusyButton></>}>
      <div className="sect" id="arform" ref={f.ref}><div className="fgrid3">
        <Fld k="name" label="Official name" errors={E}><input id="ar-name" defaultValue={s.name} /></Fld><Fld k="official_code" label="Official code" errors={E}><input id="ar-official_code" defaultValue={s.official_code} /></Fld><Fld k="phone" label="Main phone" errors={E}><input id="ar-phone" defaultValue={s.phone} /></Fld>
        <Fld k="alt_names" label="Other names" errors={E}><input id="ar-alt_names" defaultValue={s.alt_names} /></Fld><Fld k="focal_person" label="Focal person" errors={E}><input id="ar-focal_person" defaultValue={s.focal_person} /></Fld>
        <Fld k="coords" label="Centre point" errors={E} help="Used to assign places when no boundary is loaded."><input id="ar-coords" className="mono" placeholder="9.01, 38.74" defaultValue={s.lat != null ? formatLatLon(s.lat, s.lon) : ''} /></Fld></div>
        <LangFields prefix="ar-" rec={s} fields={[['summary', 'Summary shown on the sub-city page', 'area', { rows: 3 }]]} errors={E} />
        <Fld k="boundary" label="Boundary (GeoJSON Polygon or MultiPolygon, longitude-latitude)" errors={E} help="From the City Administration’s approved source. Places outside it are flagged for review.">
          <textarea id="ar-boundary" rows={5} className="mono" defaultValue={s.boundary ? JSON.stringify(s.boundary) : ''} placeholder='{"type":"Polygon","coordinates":[[[38.70,9.00],[38.75,9.00],[38.75,9.05],[38.70,9.00]]]}' /></Fld>
        <label className="btn sm" style={{ justifySelf: 'start' }}><Icon n="upload" />Load .geojson file<input type="file" accept=".geojson,.json,application/geo+json,application/json" className="vh" onChange={async (e) => {
          const fl = e.target.files?.[0]; if (!fl) return;
          try { const b = normalizeBoundary(await readTextFile(fl)); if (b.error) toast(b.error, 'bad'); else { setVal('ar-boundary', JSON.stringify(b.geometry)); toast('Boundary loaded. Save to apply.'); } } catch (x) { toast(x.message, 'bad'); }
        }} /></label>
        <p className="formerr">{f.msg}</p></div>
    </Dlg>
  );
}
