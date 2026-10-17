// Load clearly-labelled SAMPLE data for training, demos and testing (spec 11.2: synthetic data outside production).
// Usage: npm run seed-demo      (uses MONGODB_URI; point it at a separate demo database)
// Creates sample sub-city centres, places in every status, a trip, an announcement and one account per role
// (password for all: demo-pass-2026). Never run this against the production database.
import { randomUUID } from 'node:crypto';
import { openDb, insert, nextId } from '../src/db.js';
import { hashPassword } from '../src/lib/auth.js';
import { config } from '../src/config.js';
import { insertPlace, recordEvidence } from '../src/api/places.js';

export async function seedDemo(db, { log = console.log } = {}) {
  if (await db.places.count({ source: 'SAMPLE DATA' })) { log('Sample data is already loaded.'); return false; }

  const PASS = hashPassword('demo-pass-2026');
  const users = [
    ['admin@demo.et', 'Abebe Admin', 'admin', null], ['approver@demo.et', 'Hana Central Supervisor', 'approver', null], ['editor@demo.et', 'Chaltu Editor', 'editor', null],
    ['supervisor3@demo.et', 'Dawit Supervisor', 'supervisor', 3], ['supervisor5@demo.et', 'Tigist Supervisor', 'supervisor', 5],
    ['dataentry3@demo.et', 'Lensa Data Entry', 'data_entry', 3], ['dataentry5@demo.et', 'Gemechu Data Entry', 'data_entry', 5],
    ['reviewer3@demo.et', 'Kebede Reviewer', 'reviewer', 3], ['sysadmin@demo.et', 'Samuel Sysadmin', 'sysadmin', null], ['auditor@demo.et', 'Meron Auditor', 'auditor', null],
  ];
  const ids = {};
  for (const [email, name, role, sub] of users) {
    const ex = await db.users.findOne({ email });
    let id = ex?.id;
    if (!ex) { id = await nextId(db, 'users'); await insert(db, 'users', { id, email, name, role, subcity_id: sub, pass_hash: PASS }); }
    ids[email.split('@')[0]] = ids[role] = id;
  }

  // Sample centres in a ring around the capital (replace with the approved administrative data).
  const centres = [[9.035, 38.745], [9.07, 38.62], [8.92, 38.62], [9.20, 38.75], [8.87, 38.80], [9.10, 38.90], [9.00, 38.95], [8.95, 38.70], [9.15, 38.68], [9.12, 38.82], [8.90, 38.88], [9.05, 38.55], [9.18, 38.58]];
  for (const [id, [lat, lon]] of centres.entries()) await db.subcities.updateOne({ id, lat: null }, { $set: { lat, lon } });

  const kinds = [
    ['tourism', 'nature', 'Forest viewpoint'], ['tourism', 'culture', 'Cultural centre'], ['tourism', 'hotel', 'Guest house'], ['tourism', 'restaurant', 'Restaurant'],
    ['health', 'hc', 'Health centre'], ['health', 'pharmacy', 'Pharmacy'], ['finance', 'bank', 'Bank branch'], ['finance', 'atm', 'ATM'],
    ['education', 'high', 'High school'], ['government', 'subcity', 'Subcity office'], ['transport', 'bus', 'Bus terminal'], ['business', 'market', 'Market'],
  ];
  const statuses = ['published', 'published', 'published', 'published', 'verified', 'submitted', 'draft', 'needs_correction'];
  const week = ['mon', 'tue', 'wed', 'thu', 'fri'];
  const hours = { ...Object.fromEntries(week.map((d) => [d, [['08:30', '17:00']]])), sat: [], sun: [] };
  let n = 0;
  for (let sub = 1; sub <= 12; sub++) {
    const [clat, clon] = centres[sub];
    for (const [k, [sector, type, label]] of kinds.entries()) {
      if ((sub + k) % 3 === 0 && k > 3) continue;
      const lat = +(clat + Math.sin(k * 1.7 + sub) * 0.012).toFixed(6), lon = +(clon + Math.cos(k * 1.3 + sub) * 0.012).toFixed(6);
      const status = statuses[(sub * 3 + k) % statuses.length];
      const collector = sub === 5 ? ids.dataentry5 : ids.dataentry3;
      const id = await insertPlace(db, {
        name: `Sample ${label} ${String(sub).padStart(2, '0')}`, sector, type, subcity_id: sub, lat, lon, accuracy_m: 4 + ((sub + k) % 9) * 3, coord_source: 'gps',
        name_om: k % 2 ? '' : `Fakkeenya ${label} ${sub}`, description: `Sample record for training. Replace with verified information about this ${label.toLowerCase()}.`,
        phone: '+251 11 000 ' + String(1000 + n).slice(-4), hours: 'Mon–Fri 08:30–17:00', hours_json: hours,
        facilities: k % 2 ? ['parking', 'toilets'] : ['wheelchair', 'family'], verified: status === 'published' && k % 3 ? 1 : 0,
        featured: status === 'published' && sector === 'tourism' && sub % 3 === 1 ? 1 : 0, source: 'SAMPLE DATA',
      }, collector, { status });
      if (status === 'needs_correction') await db.places.updateOne({ _id: id }, { $set: { workflow_note: 'Please add the opening hours for Saturday and a photo of the entrance.' } });
      if (status === 'published' && (sub + k) % 5 === 0) await db.places.updateOne({ _id: id }, { $set: { last_reviewed_at: '2024-01-15T09:00:00.000Z' } });
      await recordEvidence(db, id, { lat, lon, accuracy_m: 6, method: 'gps', collector, notes: 'Sample reading' });
      n++;
    }
  }
  // Sample menus for restaurants, cafés and guest houses, plus customer suggestions waiting for approval.
  const MENU = {
    restaurant: [['Traditional dishes', 'Doro wat', 'ዶሮ ወጥ', 520], ['Traditional dishes', 'Kitfo', 'ክትፎ', 480], ['Fasting dishes', 'Beyaynetu', 'በያይነቱ', 260], ['Grill', 'Tibs', 'ጥብስ', 450], ['Juices & soft drinks', 'Avocado juice', '', 120]],
    cafe: [['Coffee & tea', 'Buna (coffee ceremony)', 'ቡና', 60], ['Coffee & tea', 'Macchiato', 'ማኪያቶ', 55], ['Breakfast', 'Chechebsa', 'ጨጨብሳ', 180], ['Desserts', 'Honey cake', '', 90]],
    hotel: [['Rooms', 'Standard double room', '', 2800], ['Rooms', 'Family room', '', 4200], ['Breakfast', 'Breakfast buffet', '', 450]],
  };
  for (const p of await db.places.find({ type: { $in: ['restaurant', 'cafe', 'hotel'] }, source: 'SAMPLE DATA' }, { projection: { id: 1, type: 1, status: 1 } })) {
    for (const [i, [section, name, am, price]] of MENU[p.type].entries()) {
      await insert(db, 'menu', { id: randomUUID(), place_id: p.id, section, name, name_am: am, price, sort: i, status: 'approved', source: 'staff', created_by: ids.dataentry3, tags: i === 0 ? ['popular'] : section === 'Fasting dishes' ? ['fasting', 'vegetarian'] : [] });
    }
    if (p.status === 'published' && p.type === 'restaurant') {
      await insert(db, 'menu', { id: randomUUID(), place_id: p.id, section: 'Fasting dishes', name: 'Shiro tegabino', price: 200, status: 'pending', source: 'customer', submitter_name: 'Sample customer', sort: 99 });
    }
  }

  const start = new Date(Date.now() + 9 * 864e5); start.setUTCHours(4, 30, 0, 0);
  const tripId = randomUUID();
  await insert(db, 'trips', {
    id: tripId, title: 'Sample: Ridge and forest walk', summary: 'A guided half-day walk to two viewpoints, with a coffee ceremony at the end.', description: 'Sample trip for training. Replace with the real programme.',
    category: 'nature', subcity_id: 3, start_at: start.toISOString(), end_at: new Date(start.getTime() + 5 * 3600e3).toISOString(), meeting_point: 'Sample bus terminal, main gate',
    meeting_lat: centres[3][0], meeting_lon: centres[3][1], organizer: 'Tourism Bureau', contact_phone: '+251 11 000 0000', capacity: 25, is_free: 1,
    includes: 'Guide, coffee ceremony', what_to_bring: 'Water, walking shoes, rain jacket', safety: 'Stay with the group. The guide carries a first-aid kit.',
    cancellation_policy: 'Postponed if heavy rain is forecast. Registered participants are called.', registration_mode: 'register', status: 'open', featured: 1, created_by: ids.editor,
  });
  const sights = await db.places.find({ status: 'published', sector: 'tourism', subcity_id: 3 }, { limit: 2, projection: { id: 1 } });
  for (const [i, s] of sights.entries()) await insert(db, 'stops', { id: await nextId(db, 'trip_stops'), trip_id: tripId, seq: i + 1, place_id: s.id, planned_time: ['08:30', '10:30'][i] });
  await insert(db, 'announcements', { id: randomUUID(), title: 'Sample: welcome to Discover Shaggar', body: 'This is demo data. Explore places across all 12 sub-cities, plan a visit and join upcoming trips.', tone: 'event', active: 1, created_by: ids.editor });
  await insert(db, 'suggestions', { id: randomUUID(), payload: { name: 'Sample Café Suggestion', sector: 'tourism', type: 'cafe', subcity_id: 3, description: 'Nice coffee near the bus terminal.' }, lat: centres[3][0] + 0.003, lon: centres[3][1] - 0.002, accuracy_m: 9, contact_name: 'Sample resident' });
  const first = await db.places.findOne({ status: 'published' }, { projection: { id: 1 } });
  await insert(db, 'reports', { id: randomUUID(), code: 'SR-DEMO01', issue_type: 'wrong_pin', description: 'Sample report: the pin is on the wrong side of the road.', place_id: first?.id ?? null });
  log(`Loaded ${n} sample places, 1 trip, sample menus, ${users.length} accounts (password demo-pass-2026).`);
  return true;
}

// Run from the command line.
if (process.argv[1] && process.argv[1].endsWith('seed-demo.js')) {
  if (config.production && !process.argv.includes('--force')) {
    console.error('NODE_ENV is production. Refusing to add sample data. Use a separate demo database, or add --force for a test deployment.');
    process.exit(1);
  }
  const db = await openDb();
  await seedDemo(db);
  await db.close();
}
