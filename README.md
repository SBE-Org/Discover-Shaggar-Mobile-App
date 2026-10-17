# Discover Shaggar

City-wide discovery, tourism, services directory and trip platform for Shaggar City, built to the
*Discover Shaggar Software Requirements Specification v1.0* (10 October 2026).

Version 3 splits the project into two folders so each half can be hosted on its own:

| Folder | What it is | Built with | Host |
|---|---|---|---|
| `backend/` | The API: places, trips, menus, moderation, accounts, photos, backups | Node.js 20+, plain `node:http`, **MongoDB** (official driver, the only dependency) | **Render** (free web service) + **MongoDB Atlas** (free M0 cluster) |
| `frontend/` | The public mobile app (PWA, `/`), its staff Admin tab (`/#admin`) and the admin web portal (`/admin`) | **React 19 + Vite**, Leaflet maps | **Vercel** |

The screens, wording, styles and features are the same as version 2.1; only the technology underneath changed.

```
discover-shaggar/
├── render.yaml            Render blueprint for the backend
├── backend/
│   ├── src/index.js       HTTP server, routing, security headers, /uploads (photos are stored in MongoDB)
│   ├── src/db.js          collections, defaults, indexes, settings and catalog cache, audit log
│   ├── src/store/         MongoDB adapter (and an in-memory one used by tests and MONGODB_URI=memory)
│   ├── src/api/           places, suggestions, content, auth, data (import/export, dashboard, backups), trips, contributions
│   ├── src/lib/           auth/sessions/MFA, validation, photos, backups, CSV, rate limiting
│   ├── scripts/           create-admin, seed-demo, backup, restore, import-sqlite (move your 2.x data)
│   └── tests/             API tests (npm test)
└── frontend/
    ├── index.html         public app page          → src/main.jsx  → src/app/*
    ├── admin/index.html   admin portal page        → src/admin/main.jsx → src/admin/*
    ├── src/lib/           API client, shared state store, translations, artwork, branding, icons
    ├── src/shared/        catalog and coordinate helpers (same code as the backend)
    ├── src/styles/        app.css and admin.css (unchanged from 2.1)
    ├── public/            icons, service worker (sw.js), import template
    ├── vite.config.js     two-page build; in development forwards /api and /uploads to the backend
    └── vercel.json        forwards /api, /uploads and the manifest to Render; /admin/* to the portal
```

---

## 1. Run it on your computer

You need **Node.js 20.10 or newer** and a MongoDB database: either a free **MongoDB Atlas** cluster (see 7.1) or MongoDB installed locally. To try it with no database at all, use `MONGODB_URI=memory` (everything is lost when you stop the server).

**Terminal 1, the API** (http://localhost:8080):

```bash
cd backend
npm install
cp .env.example .env          # then put your MongoDB connection string in MONGODB_URI
npm run create-admin          # email, name and password of the first administrator
npm run dev                   # restarts when you change a file
npm test                      # API tests (in memory; TEST_MONGODB_URI=... runs them against a real database)
```

**Terminal 2, the app and portal** (http://localhost:5173):

```bash
cd frontend
npm install
npm run dev                   # app: http://localhost:5173   portal: http://localhost:5173/admin
```

Vite forwards `/api`, `/uploads` and `/manifest.webmanifest` to the API on port 8080 (set `BACKEND_URL` to use another address). It also listens on your Wi-Fi address, so you can open `http://<your-computer-ip>:5173` on a phone on the same network. Phone GPS and "Install app" need HTTPS, so test those on the deployed Vercel address.

**Try it with sample data** (never on the production database):

```bash
cd backend
SEED_DEMO=1 MONGODB_URI=memory npm start      # or: npm run seed-demo  (into the database in .env)
```

This loads 112 clearly-labelled *Sample* places across all 12 sub-cities in every workflow status, sample menus, a trip, an announcement, a suggestion, a report and these accounts, all with the password `demo-pass-2026`:

| Account | Role |
|---|---|
| `admin@demo.et` | Administrator |
| `approver@demo.et` | Central supervisor (city-wide) |
| `supervisor3@demo.et`, `supervisor5@demo.et` | Sub-city supervisor of 03 / 05 |
| `dataentry3@demo.et`, `dataentry5@demo.et` | Data entry in 03 / 05 |
| `editor@demo.et`, `reviewer3@demo.et`, `sysadmin@demo.et`, `auditor@demo.et` | Other built-in roles |

You can also build the frontend (`npm run build` in `frontend/`) and the API serves it from `frontend/dist` at http://localhost:8080, which is handy for a single-server setup.

### First steps for the Bureau
1. **Portal → Sub-cities.** Enter the official name, code, focal person and centre of each of the 12 sub-cities, and paste or upload the approved boundary (GeoJSON). Places are then assigned to the right sub-city automatically and anything outside its boundary is flagged.
2. **Portal → Categories.** Rename, translate, recolour, add or retire categories and set how often each group must be re-checked.
3. **Portal → Staff & teams.** Create an account for each person with the smallest role they need, and limit sub-city staff to their sub-city.
4. **Portal → Pages.** Replace the starter About, Privacy notice, Help and Contact texts, in English, Afaan Oromoo and Amharic.
5. **Settings.** Decide whether two-step sign-in is required for publishers and administrators (recommended), and confirm the GPS accuracy limits and data-retention periods.

---
## 2. Roles, hierarchy and permissions

The main chain is **Administrator → Central supervisor → Sub-city supervisor → Data entry**:

- **Data entry** staff enter places, GPS locations, photos and menus and tap *Submit*. They cannot publish anything.
- Their **sub-city supervisor** sees it in the review queue (portal and mobile Admin → Tasks) and taps **Approve** (checks and publishes in one step) or **Return** with a note. Supervisors also approve visitor photos and menu items for their sub-city, and add and manage the data-entry staff of their own sub-city. This spreads the work across the 12 sub-cities instead of loading the central team.
- **Central supervisors** approve city-wide: records from central editors, and any sub-city that has no supervisor yet (the dashboard shows these).
- **Administrators** manage everyone, roles, settings, branding and backups.

Every role has a **level**. Nobody manages an account at or above their own level, nobody hands out a role at or above their own level, and a record must be approved by someone at the author's level or higher (a sub-city supervisor cannot approve a central editor's work). Nobody approves their own work. All of this is checked **on the server**.

| Role (built in) | Level | Can do |
|---|---|---|
| Administrator | 100 | Everything |
| System administrator | 90 | Accounts, roles, settings, backups, activity log (no editorial work) |
| Central supervisor | 70 | Approve and publish city-wide, trips, content, visitor contributions, team management |
| Central content editor | 60 | City-wide content, categories, trips, pages; approved by a central supervisor |
| Sub-city supervisor | 50 | Approve data entry, visitor photos and menu items in their sub-city; manage their data-entry staff |
| Sub-city reviewer | 40 | Check and return records in their sub-city (cannot publish) |
| Data entry / Field data collector | 20 | Add places, GPS, photos and menus; submit for approval |
| Auditor | 10 | Read-only dashboards and activity log |

Administrators can change levels and permissions in **Portal → Roles & permissions** and create new roles. Give each person their sub-city in **Staff & teams**.

**Account security:** scrypt passwords; temporary passwords unlock nothing until changed; lockout after 8 wrong passwords; optional or required **two-step sign-in**; administrators and supervisors can reset passwords, unlock, and sign a person out everywhere for accounts below them.

## 2b. Menus, visitor photos and branding

- **Menus.** Restaurants, cafés and hotels (any category with *Has a menu* ticked in Categories) show a menu with sections, prices in ETB, tags (fasting, vegetarian, spicy, popular…) and dish photos. Staff edit it in the portal place editor. **Customers** can add a dish or correct a price from the app; it waits in **Visitor photos & menus** until a supervisor approves (optionally after editing it). Data-entry changes to a live menu also wait for approval.
- **Visitor photos.** Visitors can take or upload a photo of any tourism place, with their name as credit and a consent tick. It stays hidden until the sub-city supervisor (or a central supervisor/administrator) approves it; rejected photos are deleted. Hidden camera data (GPS position, device) is removed from every uploaded JPEG.
- **Logo & branding.** *Portal → Logo & branding*: upload the logo (PNG, at least 512 × 512 works best), a home picture, the app name, tagline and main colour. They update the app, the portal, the browser tab and the install icon/name on phones. Default: Shaggar red, black and white with the built-in logo and an illustrated city scene.
- Both public features can be switched off in *Settings → Visitor contributions*.

## 3. Publishing workflow (spec 10.2, Appendix B)

Supervisors use **Approve** (Submitted → Published in one step). Where a separate reviewer checks first, the longer path below applies.

```
Draft ──submit──▶ Submitted ──verify──▶ Verified ──publish──▶ Published ──▶ periodic review
  ▲                   │                    │                     │
  └──── Needs correction ◀──return (note)──┘          unpublish / archive / restore
                      └──reject (note)──▶ Rejected
```

- **Nobody verifies or publishes a record they created or submitted.** (A setting allows it for very small teams.)
- Returning or rejecting requires a note, which the contributor sees.
- Only *Published* and *visible* records appear in the public app.
- Moving a place's pin clears *Verified on site* until it is checked again.
- Each category group has a review interval (health and key offices 6 months, ordinary services 12). Overdue places are flagged on the dashboard and in the review queue, and the app can show *“may be out of date”*.
- **Every change is recorded with who, when, from where and the previous values.** Authorised staff can restore an earlier version from the place history or the activity log.

### GPS capture (spec 6)
The app asks for location only when the collector taps *Use my GPS*, keeps reading until the accuracy target is reached (±10 m by default), and shows live accuracy. Above the limit (±20 m by default) the collector must retry, move the pin on the satellite map, or explain why. The original GPS reading, any manual adjustment, the method, accuracy, collector and time are all kept as **location evidence**, separately from the approved point. Paste also works: decimal numbers, degrees-minutes-seconds, Google Maps, OpenStreetMap and `geo:` links; swapped latitude/longitude are detected.

**Duplicate detection** warns when a new place has a similar name or the same category within 150 m of an existing one.

---

## 4. What the public app does

- **Home:** search, category shortcuts, announcements, featured places, upcoming trips, things to see, plan a visit, sub-city shortcuts, recently viewed.
- **Map:** coloured pins, street and satellite layers, sub-city boundaries, filters, *Near me* sorting by distance, list/map, route for trips and plans.
- **Place page:** photos with captions and credits (only photos with confirmed rights are shown), translated name and description, *Open now* from structured hours, contacts, facilities, accessibility, visitor guidance and safety, condition (temporarily closed, moved…), coordinates, directions, save, share link, report a problem, last verified date and source.
- **Areas:** every sub-city has its own page with summary, upcoming trips, places by category and important contacts.
- **Trips & events:** upcoming and past, status (open, full, postponed, cancelled…), meeting point with directions, ordered stops on the map, what to bring, safety, cancellation policy, public updates, gallery and recap. **Registration or enquiry** asks only for name, phone, optional email and party size with consent; capacity is enforced and the trip switches to *Full* automatically; participants get a code to check or cancel.
- **Saved:** bookmarked places and recently viewed, kept on the phone and available offline.
- **More:** language (English, Afaan Oromoo, አማርኛ), suggest a place, report a problem, track a report or registration code, About / Privacy / Help / Contact pages, staff sign-in.
- **Suggestions and reports** never change official records directly; they go to the moderation inbox. Reports get a code (for example `SR-7KD2QF`) the sender can track.

---

## 5. Admin web portal sections

| Section | What it is for |
|---|---|
| Dashboard | Coverage per sub-city, % verified and complete against the spec targets, workflow pipeline, data-quality flags (overdue, low accuracy, no photo, missing translation, outside boundary), upcoming trips and registrations, moderation, sign-ins and failed sign-ins, system health |
| Places | Every record with filters, quality flags and **bulk actions**; full editor with translations, map pin, structured hours, facilities, photos with rights and cover choice, source, review interval, workflow buttons, location evidence and change history with restore |
| Review queue | Waiting for verification, ready to publish, returned, drafts, due for periodic review |
| Sub-cities | Official names and codes, focal person, centre, boundary GeoJSON, summary in 3 languages, coverage numbers |
| Categories | Category groups (colour, icon, review interval) and categories, in 3 languages, retire instead of delete |
| Suggestions | New places and corrections; side-by-side comparison for corrections with per-field accept |
| Problem reports | Status, assignee and a resolution note the sender can see |
| Trips & events | Editor with translations, Ethiopia-time dates, meeting point, ordered stops linked to places, practical details, registration settings, cover and gallery; status changes with public messages; registrations list and CSV |
| Announcements | Home-screen banners with style, schedule and link to a place, trip, page or website |
| Pages | Information pages in 3 languages, publish and menu order |
| Staff accounts | Create, role, sub-city scope, two-step status, lock, reset password, sessions, deactivate |
| Roles & permissions | Permission matrix per role, custom roles |
| Activity log | Filter by person, record, action, dates or IP; security-only view; change details; restore; CSV export |
| Import & export | CSV import with dry-run preview; CSV export of the directory |
| Settings | Workflow, GPS accuracy, review warnings, two-step requirement, session length, data retention, public contact details |
| System & backups | Uptime, database and photo sizes, integrity check, back up now, download backups |
| My account | Password, two-step sign-in set-up, my permissions |

---

## 6. Languages (spec 9.3)

Places, trips, pages, announcements, categories and sub-city summaries store **English, Afaan Oromoo and Amharic** separately. The app falls back to English and says so when a translation is missing; the portal marks missing translations with a dot and the dashboard counts them. The app's main interface (navigation, home, place, trip and More screens) is available in all three languages. **The Afaan Oromoo and Amharic interface wording is a first draft and must be checked by native speakers before launch** (`frontend/src/lib/i18n.js`).

---

## 7. Put it online (free): MongoDB Atlas + Render + Vercel

Put the whole `discover-shaggar` folder in one GitHub repository (both folders side by side). Then:

### 7.1 Database: MongoDB Atlas (free M0)
1. Create an account at mongodb.com/atlas and a **free M0 cluster** (choose a region near Render's, e.g. Frankfurt or Oregon).
2. **Database Access:** add a database user with a password.
3. **Network Access:** add `0.0.0.0/0` (Render's free services have no fixed IP address).
4. **Connect → Drivers:** copy the connection string and add the database name before the `?`:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/discover-shaggar?retryWrites=true&w=majority`

The API creates its collections and indexes itself on first start.

### 7.2 API: Render
1. On render.com choose **New → Blueprint**, pick the repository; `render.yaml` sets up a free Node web service from the `backend` folder (or create a **Web Service** by hand: root directory `backend`, build `npm install --omit=dev`, start `npm start`, health check `/api/health`).
2. Set the environment variables: `MONGODB_URI` (from 7.1), `ADMIN_EMAIL` and `ADMIN_PASSWORD` for the first administrator (remove the password after the first start), and optionally `SEED_DEMO=1` for a test deployment with the sample data.
3. Deploy, then open `https://<your-service>.onrender.com/api/health`; it should answer `{"ok":true,…,"database":"mongodb"}`.

Free Render services go to sleep after about 15 minutes without traffic; the first request after that takes 30–60 seconds. Photos and backups are stored in MongoDB, not on Render's disk, so nothing is lost when the service restarts or redeploys.

### 7.3 App and portal: Vercel
1. In `frontend/vercel.json`, replace the three `https://YOUR-BACKEND.onrender.com` addresses with your Render address. Commit.
2. On vercel.com choose **Add New → Project**, pick the repository and set **Root Directory** to `frontend`. Vercel detects Vite (`npm run build`, output `dist`). Deploy.
3. Open `https://<your-app>.vercel.app` for the public app and `https://<your-app>.vercel.app/admin` for the portal.

Vercel forwards `/api`, `/uploads` and the manifest to Render, so the browser only ever talks to your Vercel address. Sign-in cookies therefore stay first-party (they work on iPhone Safari too) and no CORS setup is needed. If you ever host the frontend somewhere without rewrites, set `CORS_ORIGINS` on the API to the frontend's address.

### Moving your 2.x data
Copy your old `data/shaggar.db` and `data/uploads/` next to the backend and run:

```bash
cd backend
MONGODB_URI="mongodb+srv://…" npm run import-sqlite -- ../old/data/shaggar.db ../old/data/uploads --yes
```

Everything comes across: places, photos, menus, evidence, trips, registrations, accounts (passwords and two-step sign-in keep working), roles, settings, branding, pages, the activity log.

### Backups
The API makes a backup every day (a compressed copy of every collection, photos included) and keeps the last `BACKUPS_KEPT` (5) inside MongoDB. **Portal → System & backups** shows them and lets you download one or make one now. Download a copy regularly and keep it somewhere else. To restore: `npm run restore -- shaggar-2026-10-17-03-00-00.json.gz --yes` in `backend/`. Command-line backup to a file: `npm run backup`.

### Install on phones
Open the Vercel address in Chrome (Android) or Safari (iPhone) and choose **Install app** / **Add to Home Screen**. The service worker keeps the app usable with a weak connection and keeps viewed map areas offline.

---

## 8. Configuration

**Backend** (`backend/.env` locally, Environment on Render; see `backend/.env.example`):

| Variable | Meaning |
|---|---|
| `MONGODB_URI` | MongoDB connection string (`memory` = no database, testing only) |
| `MONGODB_DB` | Database name if it is not in the connection string |
| `PORT` | Port (Render sets this) |
| `NODE_ENV` | `production` on Render |
| `IP_SALT` | Long random value for hashing visitor IPs |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Create the first administrator on start if there is none |
| `SEED_DEMO` | `1` loads the sample data on start |
| `AUTO_BACKUP`, `BACKUPS_KEPT` | Daily backup on/off (`0` = off) and how many to keep |
| `SESSION_DAYS`, `MAX_PHOTO_BYTES` | Sign-in length and largest photo |
| `CORS_ORIGINS` | Only when the frontend calls the API on another domain without rewrites |
| `TILE_STREET`, `TILE_SAT`, `TILE_*_ATTR` | Map tile servers and attribution |

**Frontend:** `BACKEND_URL` for `npm run dev` only (default `http://localhost:8080`). In production the Render address lives in `vercel.json`.

---
## 9. API

JSON over HTTPS. Every route is available as `/api/...` and `/api/v1/...` (spec 20.2). Writes must be `Content-Type: application/json` (CSRF protection). Staff authenticate with an HttpOnly session cookie. Validation errors return `400` with `{error, details: {field: message}}`.

**Public**

| Method & path | Purpose |
|---|---|
| `GET /api/config` | Tiles, city bounds, category catalog, public settings, signed-in user with permissions |
| `GET /api/subcities` | The 12 sub-cities and Mayor's Office, with boundaries and published counts |
| `GET /api/catalog` | Category groups and categories |
| `GET /api/places?sector=&type=&subcity=&q=&near=lat,lon&radius=&featured=1&facility=&condition=` | Published places |
| `GET /api/places/nearby?lat=&lon=&radius_m=` | Nearby search, nearest first |
| `GET /api/places/{id}` | Place detail with photos |
| `POST /api/suggestions` | Suggest a new place or a correction (`place_id`) |
| `POST /api/reports` · `GET /api/reports/track/{code}` | Report a problem · check its status |
| `GET /api/places/{id}/menu` · `POST /api/places/{id}/menu/suggest` | Menu · customer adds a dish (approved first) |
| `POST /api/places/{id}/visitor-photos` | Visitor shares a photo (consent required, approved first) |
| `GET /api/trips?when=upcoming\|past&subcity=&category=` · `GET /api/trips/{id}` | Trips and events |
| `POST /api/trips/{id}/registrations` | Register or enquire (consent required) |
| `POST /api/registrations/lookup` | Check or cancel a registration with code + phone |
| `GET /api/pages`, `GET /api/pages/{slug}`, `GET /api/announcements` | Content |

**Staff** (permission in brackets)

| Method & path | Purpose |
|---|---|
| `POST /api/auth/login`, `/login/mfa`, `/logout`, `GET /api/auth/me`, `POST /api/auth/password`, `/mfa/setup`, `/mfa/enable`, `/mfa/disable` | Sessions and two-step sign-in |
| `GET /api/places?scope=all&status=&mine=1` (places.view) | All records in scope |
| `POST /api/places` (places.create) · `PATCH /api/places/{id}` (places.edit) | Create (`submit`, `gps_original`, `accuracy_note`, `confirm_duplicate`) · update |
| `POST /api/places/{id}/workflow` `{action, note}` | `submit`, `approve`, `verify`, `return`, `publish`, `unpublish`, `reject`, `archive`, `restore` |
| `POST /api/places/{id}/advance` · `/reviewed` · `POST /api/places/bulk` | Next step · periodic review done · bulk actions |
| `GET /api/places/{id}/history` · `GET /api/places/duplicates` | History · duplicate check |
| `POST /api/places/{id}/photos`, `PATCH/DELETE /api/photos/{id}` | Photos, captions, credit, rights, cover |
| `DELETE /api/places/{id}` (places.delete) | Permanent delete |
| `GET /api/suggestions`, `POST .../{id}/accept`, `.../reject` (moderation.manage) | Moderation |
| `GET /api/reports`, `PATCH /api/reports/{id}` (moderation.manage) | Reports |
| `POST/PATCH /api/trips`, `/status`, `/updates`, `/photos`, `DELETE` (trips.manage) | Trips |
| `GET /api/trips/{id}/registrations[.csv]`, `PATCH /api/registrations/{id}` (trips.registrations) | Registrations |
| `PUT/DELETE /api/pages/{slug}`, `POST/PATCH/DELETE /api/announcements` (content.manage) | Content |
| `POST/PATCH /api/catalog/sectors`, `/types` (catalog.manage) · `PUT /api/subcities/{id}` (areas.manage) | Catalog and sub-cities |
| `GET /api/dashboard`, `/api/stats` (reports.view) | Dashboards, including sub-city teams and their workload |
| `POST /api/places/{id}/menu`, `PATCH/DELETE /api/menu/{id}` (places.edit) | Staff menu editing |
| `GET /api/contributions`, `POST /api/contributions/{photo\|menu}/{id}/{approve\|reject}` (contributions.manage) | Approve visitor photos and menu items |
| `POST/DELETE /api/branding/{logo\|hero}` (settings.manage) | Upload or reset the logo and home picture |
| `GET/POST/PATCH /api/users`, `/api/roles`, `/api/permissions` (users.manage or team.manage, roles.manage) | Accounts, roles and levels |
| `GET /api/audit`, `/api/audit.csv`, `POST /api/audit/{id}/revert` (audit.view; restore needs places.review + places.edit) | Activity log |
| `GET/PUT /api/settings` (settings.manage) · `/api/system`, `/system/backup`, `/system/backups/{name}`, `/system/check` (system.backup) | Settings, health, backups |
| `POST /api/import`, `GET /api/export.csv` (places.import, places.export) | CSV |

---

## 10. Specification coverage and open decisions

**Implemented:** FR-001–006 (discovery, search incl. alternate and local-language names and category names, list/map, distance, empty states, directions and share links) · FR-010–016 (place record, detail, 3 languages, photo metadata, duplicate detection, condition, verified vs community) · FR-020–024 (12 sub-cities, pages, coverage statistics, boundary assignment and flags) · FR-030–036 (trips, stops, states, registration, gallery and recap, public updates, automatic past section) · FR-040–042 (suggestions, reports with codes, moderation) · FR-050–054 (workflow, audit with restore, dashboards, role-limited CSV export, review reminders) · section 6 location capture and evidence · section 8 data model · section 10 portal · section 12 security and privacy controls (server-side RBAC and scoping, MFA, lockout, rate limits, upload checks, retention, consent).

**Built differently from the spec's suggestions, on purpose:**
- **Stack.** The spec suggests Flutter/React Native with PostgreSQL/PostGIS. This build is a Node.js API on MongoDB (backend, hosted on Render) and a React installable mobile web app plus admin portal (frontend, hosted on Vercel). It works offline and can be wrapped for the Play Store. MongoDB comfortably handles tens of thousands of places; 2dsphere indexes can be added later for heavy spatial queries.
- **Notifications (FR-035).** Status changes post a public update on the trip page and tell staff how many registrants to contact; the registration CSV has their phone numbers. Automatic SMS, email and push need a provider contract and are not connected.
- **Photos.** The server checks the file type by content, removes camera metadata from JPEGs and stores them under a random name; phones resize photos before upload. Virus scanning is not included (spec 12.1 says "where feasible").

**Decisions the Bureau still needs to make (spec 21.2):** official sub-city names, codes and boundaries; who approves publication; map provider for heavy traffic (set the `TILE_*` variables); hosting and backup location; registration data retention period; native-speaker review of Afaan Oromoo and Amharic wording.

