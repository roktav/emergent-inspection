# Asset Inspection

Daily dump-truck chassis inspection for site drivers: walk-around checklists, photo evidence, admin approval, and a site recap report.

**Version 1.11.0** · 23 September 2026, 11:10 WIB

Stack: **React 19** (CRA + craco) · **FastAPI** · **MongoDB 7**. Photos are stored on local disk, not a cloud object store.

## Prerequisites

- Docker Desktop (or Docker Engine + Compose v2), **or**
- Python 3.11, Node 20, Yarn 1.x, and MongoDB 7

## 1. Environment file

Create `.env` in the **repository root** (this file is gitignored). Compose reads it; copy the same values into `backend/.env` if you run the API on the host.

```bash
# Mongo — use "mongo" as the hostname inside Compose, "localhost" on the host
MONGO_URL=mongodb://mongo:27017
DB_NAME=dt_inspection

# Sign JWTs (any long random string). Rotating it logs everyone out.
JWT_SECRET=change-me-to-a-long-random-value

# Created on first backend start if the account does not exist
SUPERADMIN_EMAIL=you@example.com
SUPERADMIN_PASSWORD=choose-a-strong-password

# Browser origin(s) allowed to call the API (comma-separated).
# The Android WebView origin is https://localhost — include it for the APK.
CORS_ORIGINS=http://localhost:3000,http://localhost:8802,https://localhost

# Photo purge cron (optional locally). Generate with: openssl rand -hex 24
WEBHOOK_CRON_SECRET=change-me-too
PHOTO_RETENTION_DAYS=90

# Where uploaded photos are written (Compose overrides this to /data/uploads)
STORAGE_ROOT=./data/uploads

# Frontend → API. Used by Compose at image build time, and by `yarn start`.
# Compose maps the API to host port 8801; a host uvicorn typically uses 8000.
REACT_APP_BACKEND_URL=http://localhost:8801
```

Generate secrets with `openssl rand -hex 32`.

## 2a. Run with Docker (closest to production)

From the repository root, with `.env` in place:

```bash
mkdir -p data/uploads
docker compose up --build
```

| Service  | URL |
| -------- | --- |
| App      | http://localhost:8802 |
| API      | http://localhost:8801/api |
| Mongo    | not published; only on the Compose network |

The frontend image **bakes** `REACT_APP_BACKEND_URL` at build time. If you change it, rebuild:

```bash
docker compose up --build frontend
```

Stop without deleting data: `docker compose down`. Never add `-v` unless you intend to wipe Mongo and photos.

## 2b. Run on the host (better for day-to-day development)

**Mongo** (one-off container is enough):

```bash
docker run -d --name inspection-mongo -p 27017:27017 -v dt-inspection-mongo:/data/db mongo:7
```

Set `MONGO_URL=mongodb://localhost:27017` in `backend/.env` (and keep the other variables from step 1). Point `STORAGE_ROOT` at a directory you can write, e.g. an absolute path to `data/uploads`.

**Backend:**

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
mkdir -p ../data/uploads
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

API: http://localhost:8000/api · OpenAPI: http://localhost:8000/docs

**Frontend** — CRA reads `frontend/.env`. Create that file with:

```bash
REACT_APP_BACKEND_URL=http://localhost:8000
```

Then:

```bash
cd frontend
yarn install
yarn start
```

App: http://localhost:3000

## Android APK (drivers, mechanics, site admins)

The APK wraps the same React app with Capacitor. Company admins and superadmins keep using the website online. **First login and first Sync must be online.** After that, a driver, mechanic, or site admin can complete a walk-around and take photos without signal; photos stay on the device until Sync uploads them.

1. Point `REACT_APP_BACKEND_URL` at a host the phone can reach (not `localhost`). Include `https://localhost` in `CORS_ORIGINS`.
2. From `frontend/`:

```bash
yarn cap:sync
yarn cap:open
```

3. In Android Studio, run on a device or **Build → Build APK**. Debug override: temporarily set `server.url` in `frontend/capacitor.config.ts` to your LAN CRA URL (`http://192.168.x.x:3000`) with `cleartext: true`, then `npx cap sync android`.

Company admins and superadmins that sign in on the APK skip the outbox and behave like the website. A site admin uses the same offline queue as a driver. Their **Inspeksi Saya** list is their own submissions; **Laporan Inspeksi** still shows the whole site.

## Seeded accounts

On first start the backend creates a superadmin from `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`, plus demo users for the seeded IMIP site:

| Role   | Email | Password |
| ------ | ----- | -------- |
| Admin  | `admin@iti.demo` | `Admin@1234` |
| Driver | `driver@iti.demo` | `Driver@1234` |
| Driver | `driver2@iti.demo` | `Driver@1234` |

Demo passwords are for local use only. Do not keep them on a shared deployment.

## Tests

Migration unit tests (no running server):

```bash
cd backend
python -m pytest tests/test_migrations.py -o addopts= -o required_plugins=
```

The live HTTP suite in `tests/backend_test.py` expects an API at `REACT_APP_BACKEND_URL` (default `http://localhost:8001`) and `pytest-xdist`. Point that variable at your running backend if you use it.

## Layout

Rebuild spec: [docs/TECHNICAL_DESIGN.md](docs/TECHNICAL_DESIGN.md).

```
backend/     FastAPI app (server.py), auth, seed, additive migrations, local storage
frontend/    React SPA and Capacitor Android project (`frontend/android/`)
docs/        Technical design, Indonesian user manual, and kickoff deck
docker-compose.yml
```

Schema changes go in `backend/migrations.py` as numbered additive steps. Do not wipe Mongo collections to “migrate”.

## Documentation

- Rebuild spec: [docs/TECHNICAL_DESIGN.md](docs/TECHNICAL_DESIGN.md)
- Indonesian user manual (ITI visual identity): [docs/Panduan_Pengguna_Inspeksi_DT.pdf](docs/Panduan_Pengguna_Inspeksi_DT.pdf). Source Markdown, screenshots, and the print stylesheet live under [docs/panduan-pengguna/](docs/panduan-pengguna/). Rebuild with:

```bash
python3 docs/panduan-pengguna/build_manual.py
```

- Indonesian kickoff deck (same visual identity, 16:9): [docs/Inspeksi_DT_Pengenalan.pptx](docs/Inspeksi_DT_Pengenalan.pptx). Rebuild with:

```bash
python3 docs/panduan-pengguna/build_intro_pptx.py
```

## Changelog

Versions and timestamps follow git history. **1.11.0** is the latest (23 Sep 2026, 11:10 WIB).

### 1.11.0 — 23 Sep 2026, 11:10 WIB

- Site admins queue a walk-around offline the same way drivers and mechanics do. Company admins and superadmins stay online-only
- **Inspeksi Saya** for a site admin lists only their own submissions; the site report stays on **Laporan Inspeksi**
- On Android, **Export PDF** writes the file and opens the system share sheet. The website still downloads it

### 1.10.0 — 22 Sep 2026, 20:39 WIB

- Product name is **Asset Inspection** (Indonesian: **Inspeksi Aset**)
- Inspection detail exports an A4 PDF: checklist without a category column, photos on the item row, and a link back to that inspection
- Android photo stamps use the device location API and wait for a GPS fix before the stamp is burned in

### 1.9.0 — 22 Sep 2026, 11:21 WIB

- Capacitor Android shell (`id.co.iti.inspeksidt`) wrapping the existing SPA
- 30-day refresh tokens and `GET /sync/field` snapshot; field outbox + IndexedDB photos for offline inspections
- First login/sync online; photos stay on device until Sync; Inspeksi Saya shows Queued

### 1.8.0 — 16 Sep 2026, 12:17 WIB

- Inspection types act as a company-level exclude list over the unit’s vehicle-category item pool (empty exclude = full checklist; additive schema v5)
- New inspection loads the checklist only after unit and type are chosen; changing site, unit, or type with answers confirms then discards (KM/HM kept)
- In-app camera torch toggle on live preview when the browser reports torch support
- Rebuild spec: [docs/TECHNICAL_DESIGN.md](docs/TECHNICAL_DESIGN.md)

### 1.7.0 — 15 Sep 2026, 15:30 WIB

- Stamp GPS, place name, compass, datetime, and inspector name onto captured inspection photos
- Scope inspection types to the selected site’s company (superadmin can no longer mix company A units with company B types)
- Optional findings notes on OK checklist items (same textarea as Not OK; photos stay optional on OK)
- On-device inspection drafts, leave-form save/discard, and **Inspeksi Saya** for drivers/mechanics

### 1.6.0 — 11 Sep 2026, 12:59 WIB

Commit `787393e`.

- Scope inspection master data to the company
- Split vehicle category from the site unit list
- Add `company_admin`, `site_admin`, and `mechanic` roles
- Keep units on one site; label inspectors as Driver/Mechanic

### 1.5.0 — 9 Sep 2026, 16:38 WIB

Commits `8d7545e`, `c87cc6b`.

- Load inspection images with the Authorization header instead of putting session tokens in photo URLs
- Filter the inspection list and CSV export by unit, type, driver, and date
- Refresh the login splash so the inspector stays readable on the hero image

### 1.4.0 — 8 Sep 2026, 14:42 WIB

Commits `f067efe`, `3fc8b72`, `2fcce0e`, `707586d`, `98b4a76`.

- Require company before site when creating users (avoids colliding site names across companies)
- Replace destructive schema-version wipes with numbered, idempotent migrations
- Document Docker and host setup in this README
- Load `.env` when the Mongo client is created
- Commit `yarn.lock`; ignore local Compose override

### 1.3.0 — 7 Sep 2026, 15:37 WIB

Commits `efbdbea`, `c2648be`.

- Self-host on an Intel NUC: local-disk photo storage, Dockerfiles, Compose
- Drop Emergent cloud object storage / `EMERGENT_LLM_KEY`
- Trim backend dependencies to packages the app actually imports

### 1.2.0 — 6 Sep 2026, 19:37 WIB

Commit `84e820c`.

- New inspection form defaults every item to OK; submit is ready once unit + KM/HM are filled
- In-app camera on every item (optional on OK), client-side JPEG compression under 500 KB
- Inspection detail: defect table first, then all items
- Daily photo retention purge (default 90 days); superadmin can trigger it manually

### 1.1.0 — 6 Sep 2026, 11:45 WIB

Commit `1951ca8`.

- Inspection items, categories, and dump-truck master data revision
- Checklist built from each unit’s assigned categories (ICE/EV type flag removed)
- Hull number as the identifier on recap, lists, and CSV

### 1.0.0 — 6 Sep 2026, 11:06 WIB

Commit `29189c4`.

- MVP: company/site/user masters, walk-around inspection form, admin approve/reject, site vehicle recap, EN/ID, JWT auth
- Demo data for IMIP Morowali

### 0.1.0 — 3 Sep 2026, 20:27 WIB

Commit `bb8f8c8`. Initial commit.
