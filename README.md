# DT Inspection

Daily dump-truck chassis inspection for site drivers: walk-around checklists, photo evidence, admin approval, and a site recap report.

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

# Browser origin(s) allowed to call the API (comma-separated)
CORS_ORIGINS=http://localhost:3000,http://localhost:8802

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

```
backend/     FastAPI app (server.py), auth, seed, additive migrations, local storage
frontend/    React SPA
docker-compose.yml
```

Schema changes go in `backend/migrations.py` as numbered additive steps. Do not wipe Mongo collections to “migrate”.
