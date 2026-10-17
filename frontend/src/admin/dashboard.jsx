// Dashboard: coverage by sub-city, workflow pipeline, data-quality flags, trips, public input and recent activity.
import { SECTORS, STATUSES, STATUS_LABELS, subcityCode, TRIP_STATUS_LABELS } from '../shared/catalog.js';
import { A, api, can, go, nav, subLabel, Kpi, PageHead, Loading, relTime, fmtDateTime, openDialog, closeDialog, Dlg, useAsync, Notice, NavButton, Icon } from './core.jsx';
import { AuditLine } from './people.jsx';

const QUALITY = [
  ['overdue', 'Overdue for periodic review', 'bad'], ['due_soon', 'Review due within the warning period', 'warn'],
  ['low_accuracy', 'Low or unknown GPS accuracy', 'warn'], ['no_photo', 'No photo', 'warn'],
  ['missing_translation', 'Missing Afaan Oromoo or Amharic', 'warn'], ['unverified', 'Published but not verified on site', 'warn'],
  ['boundary', 'Outside the assigned sub-city boundary', 'bad'],
];
const pct = (a, b) => (a / b * 100).toFixed(1) + '%';

function QualityDialog({ k, q }) {
  const label = QUALITY.find((x) => x[0] === k)[1];
  return (
    <Dlg title={label} wide foot={<><button className="btn" onClick={closeDialog}>Close</button><button className="btn primary" onClick={() => { closeDialog(); A.placeFilter = { flag: k }; go('places'); }}>Open in Places</button></>}>
      {q.items.length ? <>
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Place</th><th>Sub-city</th><th>Status</th>{k === 'low_accuracy' ? <th className="num">Accuracy</th> : null}{q.items[0]?.due ? <th>Review due</th> : null}</tr></thead><tbody>
          {q.items.map((p) => <tr key={p.id}><td><NavButton to={'places/' + p.id} className="rowlink">{p.name}</NavButton></td><td className="muted">{subcityCode(p.subcity_id)}</td><td><span className={'pill st-' + p.status}>{STATUS_LABELS[p.status]}</span></td>
            {k === 'low_accuracy' ? <td className="num">{p.accuracy_m != null ? '±' + Math.round(p.accuracy_m) + ' m' : 'unknown'}</td> : null}{p.due ? <td className="muted">{new Date(p.due).toLocaleDateString()}</td> : null}</tr>)}
        </tbody></table></div>
        {q.count > q.items.length ? <p className="help" style={{ marginTop: 8 }}>Showing {q.items.length} of {q.count}. Use the Places filters for the full list.</p> : null}
      </> : <p className="help">Nothing to fix here.</p>}
    </Dlg>
  );
}

export function DashboardView() {
  const r = useAsync(() => api.dashboard(), []);
  if (r.loading && !r.data) return <><PageHead title="Dashboard" sub="Coverage, quality and workload across Shaggar City." /><Loading n={6} /></>;
  if (r.error) return <><PageHead title="Dashboard" /><Notice error={r.error} /></>;
  const d = r.data;
  const t = d.totals, my = d.my;
  const tasks = [
    can('places.review') && my.to_verify ? [`${my.to_verify} record${my.to_verify === 1 ? '' : 's'} waiting for verification`, 'queue'] : null,
    can('places.publish') && my.to_publish ? [`${my.to_publish} verified record${my.to_publish === 1 ? '' : 's'} ready to publish`, 'queue'] : null,
    my.returned ? [`${my.returned} of your records returned for correction`, 'queue'] : null,
    my.drafts ? [`${my.drafts} draft${my.drafts === 1 ? '' : 's'} not yet submitted`, 'queue'] : null,
    can('moderation.manage') && d.moderation.suggestions ? [`${d.moderation.suggestions} public suggestion${d.moderation.suggestions === 1 ? '' : 's'} to review`, 'suggestions'] : null,
    can('contributions.manage') && (d.moderation.photos + d.moderation.menu_items) ? [`${d.moderation.photos} visitor photos and ${d.moderation.menu_items} menu items to approve`, 'contributions'] : null,
    can('moderation.manage') && d.moderation.reports ? [`${d.moderation.reports} open problem report${d.moderation.reports === 1 ? '' : 's'}`, 'reports'] : null,
  ].filter(Boolean);
  const maxCov = Math.max(1, ...d.coverage.map((c) => c.total));
  const sectors = Object.entries(d.by_sector).sort((a, b) => b[1] - a[1]);
  const maxSec = Math.max(1, ...sectors.map((s) => s[1]));
  const h = new Date().getHours();
  return (
    <>
      <PageHead title={`Good ${h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'}, ${A.me.name.split(' ')[0]}`}
        sub={d.scope !== null ? `Showing ${subLabel(d.scope)} only.` : 'Coverage, quality and workload across Shaggar City.'}
        right={can('places.create') ? <button className="btn primary" onClick={() => nav('places/new')}><Icon n="plus" />Add place</button> : null} />
      <div className="kpis">
        <Kpi label="Places" value={t.places} icon="pin" tone="hot" hint={`${t.published} published`} onClick={() => nav('places')} />
        <Kpi label="Sub-cities covered" value={`${t.subcities_covered}/12`} icon="grid" tone={t.subcities_covered === 12 ? 'ok' : 'warn'} hint="with at least one published place" />
        <Kpi label="Verified on site" value={t.verified_pct + '%'} icon="shield" tone={t.verified_pct >= 95 ? 'ok' : 'warn'} hint="of published · target 95%" />
        <Kpi label="Complete records" value={t.complete_pct + '%'} icon="check" tone={t.complete_pct >= 90 ? 'ok' : 'warn'} hint="photo, description and review date · target 90%" />
        <Kpi label="Awaiting review" value={t.awaiting} icon="inbox" tone={t.awaiting ? 'warn' : ''} hint={`${t.returned} returned for correction`} onClick={() => nav('queue')} />
        <Kpi label="Upcoming trips" value={d.trips.upcoming} icon="calendar" hint={`${d.trips.registrations} people registered`} onClick={can('trips.manage') ? () => nav('trips') : undefined} />
      </div>
      {tasks.length ? <div className="card"><h3>Needs your attention</h3><div className="qlist">{tasks.map(([l, v]) => <button key={l} onClick={() => nav(v)}><span>{l}</span><Icon n="chev" /></button>)}</div></div> : null}
      {d.teams?.length ? <div className="card"><h3>Sub-city teams <span className="help">who approves each sub-city's data</span></h3>
        <div className="hier"><span className="step"><Icon n="edit" />Data entry adds and submits</span><span className="arrow">→</span><span className="step"><Icon n="check" />Sub-city supervisor approves</span><span className="arrow">→</span><span className="step"><Icon n="shield" />Central supervisor / Administrator: oversight, central records, sub-cities without a supervisor</span></div>
        <div className="teamgrid">{d.teams.map((tm) => (
          <div key={tm.id} className="team"><div className="tn"><b>{subLabel(tm.id)}</b><span className={'mono ' + (tm.waiting ? 'warn' : 'muted')} title="Waiting for approval">{tm.waiting} waiting</span></div>
            {tm.supervisors.length ? <span className="sup"><Icon n="user" /> {tm.supervisors.map((u) => u.name).join(', ')}</span> : <span className="central">No supervisor: central supervisors approve</span>}
            <span className="help">{tm.data_entry} data entry · {tm.contributions} photos/menu items to check{tm.oldest ? ' · oldest ' + relTime(tm.oldest) : ''}</span></div>
        ))}</div>
        {can('users.manage') || can('team.manage') ? <button className="btn sm" style={{ marginTop: 12 }} onClick={() => nav('users')}>Manage staff and teams</button> : null}</div> : null}
      <div className="grid2">
        <div className="card"><h3>Coverage by sub-city <span className="help">published / in review / drafts</span></h3>
          {d.coverage.map((c) => (
            <div key={c.id} className="hbar"><span title={subLabel(c.id)}>{subLabel(c.id)}</span>
              <span className="track" style={{ width: Math.max(4, c.total / maxCov * 100).toFixed(1) + '%' }}>{c.total ? <><i style={{ '--c': 'var(--ok)', width: pct(c.published, c.total) }} /><i style={{ '--c': 'var(--warn)', width: pct(c.awaiting, c.total) }} /><i style={{ '--c': 'var(--faint)', width: pct(c.total - c.published - c.awaiting, c.total) }} /></> : null}</span>
              <span className="v">{c.total}</span></div>
          ))}
          <div className="legend"><span><i style={{ '--c': 'var(--ok)' }} />Published</span><span><i style={{ '--c': 'var(--warn)' }} />In review</span><span><i style={{ '--c': 'var(--faint)' }} />Draft, returned or archived</span></div>
        </div>
        <div className="card"><h3>Data quality <span className="help">tap to see the records</span></h3><div className="qlist">
          {QUALITY.map(([k, l, tone]) => <button key={k} onClick={() => openDialog(() => <QualityDialog k={k} q={d.quality[k]} />)}><span>{l}</span><span className={'n ' + (d.quality[k].count ? tone : 'ok')}>{d.quality[k].count}</span></button>)}
        </div></div>
      </div>
      <div className="grid2">
        <div className="card"><h3>Publishing pipeline</h3><div className="pipe" style={{ gridTemplateColumns: `repeat(${STATUSES.length},1fr)` }}>{STATUSES.map((s) => <div key={s} className={'st-' + s}><b>{d.by_status[s] || 0}</b><span>{STATUS_LABELS[s]}</span></div>)}</div>
          <h3 style={{ marginTop: 20 }}>By category</h3>{sectors.length ? sectors.map(([k, n]) => <div key={k} className="hbar"><span>{SECTORS[k]?.label || k}</span><span className="track"><i style={{ '--c': SECTORS[k]?.color || '#888', width: (n / maxSec * 100).toFixed(1) + '%' }} /></span><span className="v">{n}</span></div>) : <p className="help">No places yet.</p>}
        </div>
        <div className="card"><h3>Upcoming trips & events</h3>
          {d.trips.next.length ? <div className="feed">{d.trips.next.map((x) => (
            <div key={x.id}><span>{can('trips.manage') ? <NavButton to={'trips/' + x.id} style={{ padding: 0 }}>{x.title}</NavButton> : x.title} <span className={'pill st-' + x.status}>{TRIP_STATUS_LABELS[x.status]}</span><span className="sub">{x.capacity ? `${x.registered}/${x.capacity} registered` : `${x.registered} registered`}</span></span><time>{fmtDateTime(x.start_at)}</time></div>
          ))}</div> : <p className="help">No upcoming trips.</p>}
          <div className="kpis" style={{ margin: '16px 0 0', gridTemplateColumns: 'repeat(3,1fr)' }}><Kpi label="Drafts" value={d.trips.drafts} /><Kpi label="Cancelled (90 d)" value={d.trips.cancelled} tone={d.trips.cancelled ? 'warn' : ''} /><Kpi label="Reports solved (30 d)" value={d.moderation.reports_resolved_30d} tone="ok" /></div>
        </div>
      </div>
      <div className="grid2">
        {can('audit.view') ? <div className="card"><h3>Recent activity <button className="linkbtn" onClick={() => nav('activity')}>Full log</button></h3><div className="feed">{d.recent.length ? d.recent.map((a) => <div key={a.id}><span><AuditLine a={a} /></span><time>{relTime(a.created_at)}</time></div>) : <p className="help">Nothing yet.</p>}</div></div> : null}
        <div className="card"><h3>People & system</h3><div className="kpis" style={{ margin: 0, gridTemplateColumns: 'repeat(3,1fr)' }}>
          <Kpi label="Active staff" value={d.people.active_staff} /><Kpi label="Sign-ins (7 d)" value={d.people.logins_7d} /><Kpi label="Failed sign-ins (7 d)" value={d.people.failed_logins_7d} tone={d.people.failed_logins_7d > 10 ? 'bad' : ''} /></div>
          {d.system ? <div className="feed" style={{ marginTop: 12 }}><div><span>Database</span><span className="mono">{(d.system.db_bytes / 1048576).toFixed(1)} MB</span></div><div><span>Photos</span><span className="mono">{d.system.uploads} · {(d.system.upload_bytes / 1048576).toFixed(1)} MB</span></div>
            <div><span>Last backup</span><span className={'mono ' + (d.system.last_backup && Date.now() - new Date(d.system.last_backup) < 2 * 864e5 ? '' : 'bad')}>{d.system.last_backup ? relTime(d.system.last_backup) : 'never'}</span></div><div><span>Uptime</span><span className="mono">{Math.floor(d.system.uptime_s / 3600)} h</span></div></div> : null}
        </div>
      </div>
    </>
  );
}
