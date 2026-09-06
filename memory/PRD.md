# DT Inspection — PRD

## Original Problem Statement
Build a daily inspection application for the Driver inspecting the Dump Trucks (DT).
- Master modules: Company, Site, Roles (Admin/Driver), Dump Trucks, Inspection Category, Inspection Module (items)
- Transaction module: DT Inspection
- Reporting module: Site Vehicle Inspection Recap
- FR1 Superadmin manages company, site, role master data; FR2 Admin manages Dump Trucks, Inspection Category, Inspection Items; FR3 All users access DT Inspection; FR4 Admin manages Site Vehicle Inspection Recap

## User Choices (gathered 2026-06)
- Auth: JWT email/password (Bearer token)
- Per item: status pill (OK / NOT_OK / KOROSI; KURANG for tire pressure, LONGGAR for lamp mounting — configurable per item) + findings note + photo upload
- Isolation: Admin & Driver belong to one Company + one Site; see only their site's data
- Recap: daily matrix (trucks × dates) + per-truck summary + CSV export
- Checklist: single category "Chassis Inspection", 37 items in counter-clockwise walk order (from Form Chassis Inspection_Fixed.xlsx); items 10–17 EV-only, hidden for ICE trucks
- Header: KM/HM, vehicle number, driver name, approval admin name, started/completed timestamps
- Language: EN + Bahasa Indonesia toggle
- UI: Inline Technology International visual identity (#98A7D5, #D6D2E9, #231915, Poppins/Roboto)
- Sheet1 employee list ignored

## Architecture
- Backend: FastAPI + Motor (MongoDB). Files: server.py (routes/models), auth.py (bcrypt+PyJWT, require_roles), storage.py (Emergent Object Storage), seed.py (idempotent seed), database.py
- Frontend: React 19 + shadcn/ui + Tailwind. lib/api.js (axios, token), lib/i18n.js (EN/ID), context/AuthContext.js, components/AppLayout.js, MasterPage.js (generic CRUD), StatusPill.js; pages: Login, Dashboard, MasterPages (Companies/Sites/Users/Trucks/Categories/Items), Inspections, InspectionForm, InspectionDetail, Recap
- Collections: users, companies, sites, dump_trucks, inspection_categories, inspection_items, inspections, files, login_attempts
- Photos: Emergent Object Storage via POST /api/uploads, served via GET /api/files/{path}?auth=

## User Personas
- Superadmin (HQ): manages companies, sites, users/roles across all sites
- Site Admin: manages trucks, checklist masters, drivers; approves inspections; views recap
- Driver: performs daily walk-around inspection on mobile

## Implemented (2026-06)
- [x] JWT auth, brute-force lockout, seeded accounts
- [x] Company/Site/User CRUD with role gating & site scoping
- [x] Dump Trucks (ICE/EV), Categories, Items (per-item status options, EV-only flag) CRUD
- [x] Checklist API filtered by truck type
- [x] Inspection form (mobile-first, progress, pills, notes, photos, timestamps) + submit
- [x] Inspection list/detail, admin approve/reject with note
- [x] Recap: daily matrix + summary + CSV export (matrix/summary)
- [x] Dashboard stats + recent inspections
- [x] EN/ID toggle, ITI branding
- [x] Tested: 28/28 backend, all frontend flows pass (test_reports/iteration_1.json)

## Backlog
- P1: Driver signature pad / mechanic sign-off; PDF export of a single inspection
- P1: Item-level defect follow-up (repair status, closed by mechanic)
- P2: Multi-site admin; per-site checklist copy/clone from another site
- P2: Push/email notification to admin on defect submission
- P2: Photo gallery/lightbox; offline draft saving
- P2: Import checklist from xlsx

## Credentials
See /app/memory/test_credentials.md
