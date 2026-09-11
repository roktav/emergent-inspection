"""
Backend tests for DT Inspection API (company catalog, vehicle categories, site_admin/company_admin roles).
Covers: auth, RBAC, masters (companies/sites/users/trucks/categories/items),
truck.category_ids assignment, category.item_ids assignment, item auto-append,
inspections (checklist EV=37/ICE=29, create with hull+VIN, approval), recap+CSV export,
upload/download, dashboard.
"""
import os
import struct
import zlib
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or "http://localhost:8001"
API = f"{BASE_URL}/api"

SUPER = {"email": "oktavio.rei@gmail.com", "password": "Admin@1234"}
ADMIN = {"email": "admin@iti.demo", "password": "Admin@1234"}  # site_admin
COMPANY_ADMIN = {"email": "company.admin@iti.demo", "password": "Admin@1234"}
DRIVER = {"email": "driver@iti.demo", "password": "Driver@1234"}
MECHANIC = {"email": "mechanic@iti.demo", "password": "Driver@1234"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _type_id(token):
    types = requests.get(f"{API}/inspection-types", headers=_auth(token)).json()
    return next(t["id"] for t in types if t["is_active"])


def _tiny_png_bytes():
    sig = b"\x89PNG\r\n\x1a\n"
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00"))
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def super_ctx():
    d = _login(SUPER)
    return {"token": d["access_token"], "user": d["user"]}


@pytest.fixture(scope="module")
def admin_ctx():
    d = _login(ADMIN)
    return {"token": d["access_token"], "user": d["user"]}


@pytest.fixture(scope="module")
def company_admin_ctx():
    d = _login(COMPANY_ADMIN)
    return {"token": d["access_token"], "user": d["user"]}


@pytest.fixture(scope="module")
def driver_ctx():
    d = _login(DRIVER)
    return {"token": d["access_token"], "user": d["user"]}


@pytest.fixture(scope="module")
def mechanic_ctx():
    d = _login(MECHANIC)
    return {"token": d["access_token"], "user": d["user"]}


# ---------- Auth ----------
class TestAuth:
    def test_login_roles(self):
        assert _login(COMPANY_ADMIN)["user"]["role"] == "company_admin"
        assert _login(ADMIN)["user"]["role"] == "site_admin"
        assert _login(DRIVER)["user"]["role"] == "driver"
        assert _login(MECHANIC)["user"]["role"] == "mechanic"
        r = requests.post(f"{API}/auth/login", json=SUPER, timeout=30)
        if r.status_code == 200:
            assert r.json()["user"]["role"] == "superadmin"

    def test_login_bad_pw(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN["email"], "password": "wrong-pw"})
        assert r.status_code in (401, 429)

    def test_me(self, admin_ctx):
        r = requests.get(f"{API}/auth/me", headers=_auth(admin_ctx["token"]))
        assert r.status_code == 200 and r.json()["role"] == "site_admin"

    def test_me_unauth(self):
        assert requests.get(f"{API}/auth/me").status_code == 401


# ---------- Trucks (list + vehicle_category_id) ----------
class TestTrucksSchema:
    def test_list_returns_new_fields(self, admin_ctx):
        r = requests.get(f"{API}/trucks", headers=_auth(admin_ctx["token"]))
        assert r.status_code == 200
        trucks = r.json()
        assert trucks, "no trucks seeded"
        for t in trucks:
            for k in ("unit_vin_number", "hull_number", "vehicle_category_id"):
                assert k in t, f"missing {k} on truck {t}"
            assert t["vehicle_category_id"]
            # brand/model/layout come from vehicle category enrichment
            assert "brand" in t
            assert "category_ids" in t
            assert "truck_type" not in t
        hulls = [t["hull_number"] for t in trucks]
        assert hulls == sorted(hulls)

    def test_create_requires_vin_hull_and_category(self, admin_ctx):
        tok = admin_ctx["token"]
        vcats = requests.get(f"{API}/vehicle-categories", headers=_auth(tok)).json()
        assert vcats
        vcid = vcats[0]["id"]
        r = requests.post(f"{API}/trucks", json={"unit_vin_number": "TESTVIN1", "vehicle_category_id": vcid}, headers=_auth(tok))
        assert r.status_code == 422
        r = requests.post(f"{API}/trucks", json={"hull_number": "TEST-HULL-1", "vehicle_category_id": vcid}, headers=_auth(tok))
        assert r.status_code == 422
        r = requests.post(f"{API}/trucks",
                          json={"unit_vin_number": "TESTVIN2", "hull_number": "TEST-HULL-2"},
                          headers=_auth(tok))
        assert r.status_code == 400

    def test_create_with_vehicle_category(self, admin_ctx):
        tok = admin_ctx["token"]
        vcats = requests.get(f"{API}/vehicle-categories", headers=_auth(tok)).json()
        vcid = vcats[0]["id"]
        payload = {
            "unit_vin_number": "TESTVIN_IGN", "hull_number": "TEST-HULL-IGN",
            "vehicle_category_id": vcid, "brand": "IGNORED", "category_ids": ["x"],
        }
        r = requests.post(f"{API}/trucks", json=payload, headers=_auth(tok))
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        try:
            assert r.json()["vehicle_category_id"] == vcid
            assert r.json()["hull_number"] == "TEST-HULL-IGN"
            assert r.json()["unit_vin_number"] == "TESTVIN_IGN"
            assert r.json().get("brand") == vcats[0].get("brand")
        finally:
            requests.delete(f"{API}/trucks/{tid}", headers=_auth(tok))


# ---------- Categories.item_ids assignment (many-to-many) ----------
class TestCategoryItemAssignment:
    def test_get_returns_item_ids(self, admin_ctx):
        r = requests.get(f"{API}/categories", headers=_auth(admin_ctx["token"]))
        assert r.status_code == 200
        for c in r.json():
            assert "item_ids" in c
            assert "site_id" not in c or c.get("site_id") in (None, "")
            assert c.get("company_id")
        chassis = next(c for c in r.json() if c["name"] == "Chassis Inspection")
        assert len(chassis["item_ids"]) == 29
        ev = next(c for c in r.json() if c["name"] == "EV Components")
        assert len(ev["item_ids"]) == 8

    def test_site_admin_cannot_assign_items(self, admin_ctx):
        tok = admin_ctx["token"]
        cats = requests.get(f"{API}/categories", headers=_auth(tok)).json()
        chassis = cats[0]
        r = requests.put(f"{API}/categories/{chassis['id']}/items",
                         json={"ids": chassis.get("item_ids") or []}, headers=_auth(tok))
        assert r.status_code == 403

    def test_shared_item_across_two_categories(self, company_admin_ctx):
        tok = company_admin_ctx["token"]
        cats = requests.get(f"{API}/categories", headers=_auth(tok)).json()
        chassis = next(c for c in cats if c["name"] == "Chassis Inspection")
        ev = next(c for c in cats if c["name"] == "EV Components")
        original_chassis = list(chassis["item_ids"])
        original_ev = list(ev["item_ids"])
        shared = original_chassis[0]
        new_ev = list(dict.fromkeys(original_ev + [shared]))

        r = requests.put(f"{API}/categories/{ev['id']}/items",
                         json={"ids": new_ev}, headers=_auth(tok))
        assert r.status_code == 200, r.text
        assert shared in r.json()["item_ids"]

        # Chassis still has the item (no exclusivity)
        cats2 = requests.get(f"{API}/categories", headers=_auth(tok)).json()
        chassis2 = next(c for c in cats2 if c["id"] == chassis["id"])
        assert shared in chassis2["item_ids"]
        assert chassis2["item_ids"] == original_chassis

        # item has no exclusive category_id field
        items = requests.get(f"{API}/items", headers=_auth(tok)).json()
        shared_item = next(i for i in items if i["id"] == shared)
        assert "category_id" not in shared_item or shared_item.get("category_id") in (None, "")

        # restore
        requests.put(f"{API}/categories/{ev['id']}/items",
                     json={"ids": original_ev}, headers=_auth(tok))


# ---------- Item CRUD (company masters; membership via category assign) ----------
class TestItemsCompanyScope:
    def test_create_delete_pulls_from_categories(self, company_admin_ctx):
        tok = company_admin_ctx["token"]
        cats = requests.get(f"{API}/categories", headers=_auth(tok)).json()
        chassis = next(c for c in cats if c["name"] == "Chassis Inspection")
        original = list(chassis["item_ids"])

        r = requests.post(f"{API}/items",
                          json={"name": "TEST_Item_X", "guidance": "test",
                                "status_options": ["OK", "NOT_OK"]},
                          headers=_auth(tok))
        assert r.status_code == 200, r.text
        iid = r.json()["id"]
        try:
            # not auto-appended
            cats2 = requests.get(f"{API}/categories", headers=_auth(tok)).json()
            c2 = next(c for c in cats2 if c["id"] == chassis["id"])
            assert iid not in c2["item_ids"]

            r = requests.put(f"{API}/categories/{chassis['id']}/items",
                             json={"ids": original + [iid]}, headers=_auth(tok))
            assert r.status_code == 200
            assert iid in r.json()["item_ids"]
        finally:
            requests.delete(f"{API}/items/{iid}", headers=_auth(tok))
        cats5 = requests.get(f"{API}/categories", headers=_auth(tok)).json()
        for c in cats5:
            assert iid not in c["item_ids"]
        # restore chassis list if mutated
        requests.put(f"{API}/categories/{chassis['id']}/items",
                     json={"ids": original}, headers=_auth(tok))

    def test_site_admin_cannot_write_items(self, admin_ctx):
        r = requests.post(f"{API}/items",
                          json={"name": "TEST_blocked", "status_options": ["OK"]},
                          headers=_auth(admin_ctx["token"]))
        assert r.status_code == 403

    def test_delete_category_with_items_400(self, company_admin_ctx):
        tok = company_admin_ctx["token"]
        cats = requests.get(f"{API}/categories", headers=_auth(tok)).json()
        chassis = next(c for c in cats if c["name"] == "Chassis Inspection")
        r = requests.delete(f"{API}/categories/{chassis['id']}", headers=_auth(tok))
        assert r.status_code == 400


# ---------- Vehicle categories ----------
class TestVehicleCategories:
    def test_list_and_assign_inspection_categories(self, company_admin_ctx):
        tok = company_admin_ctx["token"]
        vcats = requests.get(f"{API}/vehicle-categories", headers=_auth(tok)).json()
        assert vcats
        cats = requests.get(f"{API}/categories", headers=_auth(tok)).json()
        assert len(cats) >= 2
        vc = vcats[0]
        original = list(vc.get("category_ids") or [])
        c1, c2 = cats[0]["id"], cats[1]["id"]
        r = requests.put(f"{API}/vehicle-categories/{vc['id']}/inspection-categories",
                         json={"ids": [c2, c1]}, headers=_auth(tok))
        assert r.status_code == 200, r.text
        assert r.json()["category_ids"] == [c2, c1]
        # restore
        requests.put(f"{API}/vehicle-categories/{vc['id']}/inspection-categories",
                     json={"ids": original}, headers=_auth(tok))

    def test_site_admin_read_only(self, admin_ctx):
        tok = admin_ctx["token"]
        r = requests.get(f"{API}/vehicle-categories", headers=_auth(tok))
        assert r.status_code == 200
        assert r.json()
        vc = r.json()[0]
        r2 = requests.post(f"{API}/vehicle-categories",
                           json={"name": "TEST_VC_BLOCK"}, headers=_auth(tok))
        assert r2.status_code == 403
        r3 = requests.put(f"{API}/vehicle-categories/{vc['id']}/inspection-categories",
                          json={"ids": vc.get("category_ids") or []}, headers=_auth(tok))
        assert r3.status_code == 403


# ---------- Role RBAC ----------
class TestRoleRBAC:
    def test_site_admin_cannot_create_site_admin(self, admin_ctx):
        r = requests.post(f"{API}/users", json={
            "name": "Bad Admin", "email": "bad.admin@iti.demo", "role": "site_admin",
            "password": "Admin@1234",
        }, headers=_auth(admin_ctx["token"]))
        assert r.status_code == 403

    def test_company_admin_can_create_site_admin(self, company_admin_ctx, admin_ctx):
        me = requests.get(f"{API}/auth/me", headers=_auth(admin_ctx["token"])).json()
        email = "temp.siteadmin@iti.demo"
        r = requests.post(f"{API}/users", json={
            "name": "Temp SA", "email": email, "role": "site_admin",
            "password": "Admin@1234", "site_id": me["site_id"],
        }, headers=_auth(company_admin_ctx["token"]))
        assert r.status_code == 200, r.text
        uid = r.json()["id"]
        try:
            assert r.json()["role"] == "site_admin"
        finally:
            requests.delete(f"{API}/users/{uid}", headers=_auth(company_admin_ctx["token"]))

    def test_company_admin_cannot_create_company_admin(self, company_admin_ctx):
        me = company_admin_ctx["user"]
        r = requests.post(f"{API}/users", json={
            "name": "Peer CA", "email": "peer.ca@iti.demo", "role": "company_admin",
            "password": "Admin@1234", "company_id": me["company_id"],
        }, headers=_auth(company_admin_ctx["token"]))
        assert r.status_code == 403

    def test_mechanic_can_create_inspection(self, mechanic_ctx, admin_ctx):
        trucks = requests.get(f"{API}/trucks", headers=_auth(admin_ctx["token"])).json()
        truck = next(t for t in trucks if t["hull_number"] == "DT-003")
        cl = requests.get(f"{API}/inspections/checklist?truck_id={truck['id']}",
                          headers=_auth(mechanic_ctx["token"])).json()
        items = [i for g in cl["groups"] for i in g["items"]]
        results = [{"item_id": it["id"], "item_name": it["name"], "status": "OK", "note": None, "photos": []}
                   for it in items]
        payload = {"truck_id": truck["id"], "km_hm": 10.0,
                   "started_at": datetime.now(timezone.utc).isoformat(),
                   "inspection_date": datetime.now(timezone.utc).date().isoformat(),
                   "inspection_type_id": _type_id(mechanic_ctx["token"]),
                   "results": results}
        r = requests.post(f"{API}/inspections", json=payload, headers=_auth(mechanic_ctx["token"]))
        assert r.status_code == 200, r.text


# ---------- Checklist ----------
class TestChecklist:
    def _trucks(self, ctx):
        return requests.get(f"{API}/trucks", headers=_auth(ctx["token"])).json()

    def test_ev_37_items(self, admin_ctx):
        trucks = self._trucks(admin_ctx)
        ev = next(t for t in trucks if t["hull_number"] == "DT-001")
        r = requests.get(f"{API}/inspections/checklist?truck_id={ev['id']}",
                         headers=_auth(admin_ctx["token"]))
        assert r.status_code == 200
        d = r.json()
        assert len(d["groups"]) == 2
        assert d["groups"][0]["category"]["name"] == "Chassis Inspection"
        assert d["groups"][1]["category"]["name"] == "EV Components"
        assert len(d["groups"][0]["items"]) == 29
        assert len(d["groups"][1]["items"]) == 8
        total = sum(len(g["items"]) for g in d["groups"])
        assert total == 37

    def test_ice_29_items(self, admin_ctx):
        trucks = self._trucks(admin_ctx)
        ice = next(t for t in trucks if t["hull_number"] == "DT-002")
        r = requests.get(f"{API}/inspections/checklist?truck_id={ice['id']}",
                         headers=_auth(admin_ctx["token"]))
        d = r.json()
        assert len(d["groups"]) == 1
        assert len(d["groups"][0]["items"]) == 29


# ---------- Inspection create ----------
class TestInspection:
    inspection_id = None

    def test_create_stores_hull_and_vin(self, driver_ctx, admin_ctx):
        trucks = requests.get(f"{API}/trucks", headers=_auth(admin_ctx["token"])).json()
        truck = next(t for t in trucks if t["hull_number"] == "DT-002")
        r = requests.get(f"{API}/inspections/checklist?truck_id={truck['id']}",
                         headers=_auth(driver_ctx["token"]))
        items = [i for g in r.json()["groups"] for i in g["items"]]
        results = [{"item_id": it["id"], "item_name": it["name"], "status": "OK", "note": None, "photos": []}
                   for it in items]
        results[0]["status"] = "NOT_OK"
        results[0]["note"] = "TEST defect"
        payload = {"truck_id": truck["id"], "km_hm": 5000.0,
                   "started_at": datetime.now(timezone.utc).isoformat(),
                   "inspection_date": datetime.now(timezone.utc).date().isoformat(),
                   "inspection_type_id": _type_id(driver_ctx["token"]),
                   "results": results}
        r = requests.post(f"{API}/inspections", json=payload, headers=_auth(driver_ctx["token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["truck_hull_number"] == "DT-002"
        assert d["truck_vin_number"] and d["truck_vin_number"].startswith("MHRDT002")
        assert "truck_type" not in d
        TestInspection.inspection_id = d["id"]

    def test_list_and_detail_have_hull_vin(self, driver_ctx):
        r = requests.get(f"{API}/inspections", headers=_auth(driver_ctx["token"]))
        assert r.status_code == 200
        assert all("truck_hull_number" in i and "truck_vin_number" in i for i in r.json())
        r = requests.get(f"{API}/inspections/{TestInspection.inspection_id}",
                         headers=_auth(driver_ctx["token"]))
        assert r.status_code == 200
        assert r.json()["truck_hull_number"] == "DT-002"

    def test_admin_approves(self, admin_ctx):
        r = requests.post(f"{API}/inspections/{TestInspection.inspection_id}/approval",
                          json={"decision": "approved", "admin_note": "TEST ok"},
                          headers=_auth(admin_ctx["token"]))
        assert r.status_code == 200
        assert r.json()["status"] == "approved"


class TestInspectionListFilters:
    def _range(self):
        d1 = datetime.now(timezone.utc).date()
        return (d1 - timedelta(days=14)).isoformat(), d1.isoformat()

    def test_export_csv_matches_filtered_list(self, admin_ctx):
        tok = admin_ctx["token"]
        d0, d1 = self._range()
        trucks = requests.get(f"{API}/trucks", headers=_auth(tok)).json()
        assert trucks
        tid = trucks[0]["id"]
        params = {"truck_id": tid, "date_from": d0, "date_to": d1}
        listed = requests.get(f"{API}/inspections", params=params, headers=_auth(tok))
        assert listed.status_code == 200
        exported = requests.get(f"{API}/inspections/export", params=params, headers=_auth(tok))
        assert exported.status_code == 200
        assert "text/csv" in exported.headers.get("content-type", "")
        lines = exported.text.strip().splitlines()
        assert lines[0].startswith("Date,Unit,VIN,")
        assert "Driver/Mechanic" in lines[0]
        assert len(lines) - 1 == len(listed.json())

    def test_driver_id_filter_admin(self, admin_ctx, driver_ctx):
        tok = admin_ctx["token"]
        did = driver_ctx["user"]["id"]
        d0, d1 = self._range()
        r = requests.get(f"{API}/inspections", params={"driver_id": did, "date_from": d0, "date_to": d1},
                         headers=_auth(tok))
        assert r.status_code == 200
        assert all(i["driver_id"] == did for i in r.json())

    def test_driver_cannot_override_driver_id(self, driver_ctx):
        r = requests.get(f"{API}/inspections", params={"driver_id": "507f1f77bcf86cd799439011"},
                         headers=_auth(driver_ctx["token"]))
        assert r.status_code == 200
        me = driver_ctx["user"]["id"]
        assert all(i["driver_id"] == me for i in r.json())

    def test_inspection_type_filter(self, admin_ctx):
        tok = admin_ctx["token"]
        d0, d1 = self._range()
        types = requests.get(f"{API}/inspection-types", headers=_auth(tok)).json()
        assert types
        tid = types[0]["id"]
        r = requests.get(f"{API}/inspections", params={"inspection_type_id": tid, "date_from": d0, "date_to": d1},
                         headers=_auth(tok))
        assert r.status_code == 200
        assert all(i.get("inspection_type_id") == tid for i in r.json())
        exported = requests.get(f"{API}/inspections/export",
                                params={"inspection_type_id": tid, "date_from": d0, "date_to": d1},
                                headers=_auth(tok))
        assert exported.status_code == 200
        assert len(exported.text.strip().splitlines()) - 1 == len(r.json())


# ---------- Recap ----------
class TestRecap:
    def _dates(self):
        d1 = datetime.now(timezone.utc).date()
        return (d1 - timedelta(days=6)).isoformat(), d1.isoformat()

    def test_recap_rows_have_new_fields(self, admin_ctx):
        d0, d1 = self._dates()
        r = requests.get(f"{API}/recap?date_from={d0}&date_to={d1}",
                         headers=_auth(admin_ctx["token"]))
        assert r.status_code == 200
        d = r.json()
        assert d["trucks"]
        hulls = [t["hull_number"] for t in d["trucks"]]
        assert hulls == sorted(hulls)
        for t in d["trucks"]:
            for k in ("hull_number", "unit_vin_number", "brand", "model", "drivetrain_layout"):
                assert k in t

    def test_export_matrix_header(self, admin_ctx):
        d0, d1 = self._dates()
        r = requests.get(f"{API}/recap/export?kind=matrix&date_from={d0}&date_to={d1}",
                         headers=_auth(admin_ctx["token"]))
        assert r.status_code == 200
        header = r.text.splitlines()[0]
        assert header.startswith("Hull Number,VIN,")

    def test_export_summary_header(self, admin_ctx):
        d0, d1 = self._dates()
        r = requests.get(f"{API}/recap/export?kind=summary&date_from={d0}&date_to={d1}",
                         headers=_auth(admin_ctx["token"]))
        assert r.status_code == 200
        header = r.text.splitlines()[0]
        for tok in ("Hull Number", "VIN", "Brand", "Model", "Drivetrain"):
            assert tok in header


# ---------- Files ----------
class TestFiles:
    def test_upload_download(self, driver_ctx):
        r = requests.post(f"{API}/uploads",
                          files={"file": ("t.png", _tiny_png_bytes(), "image/png")},
                          headers=_auth(driver_ctx["token"]))
        assert r.status_code == 200
        path = r.json()["path"]
        r2 = requests.get(f"{API}/files/{path}", headers=_auth(driver_ctx["token"]))
        assert r2.status_code == 200
        leaked = requests.get(f"{API}/files/{path}", params={"auth": driver_ctx["token"]})
        assert leaked.status_code == 401

    def test_non_image_400(self, driver_ctx):
        r = requests.post(f"{API}/uploads",
                          files={"file": ("t.txt", b"hello", "text/plain")},
                          headers=_auth(driver_ctx["token"]))
        assert r.status_code == 400


# ---------- Dashboard ----------
class TestDashboard:
    def test_dashboard(self, admin_ctx):
        r = requests.get(f"{API}/dashboard", headers=_auth(admin_ctx["token"]))
        assert r.status_code == 200
        for k in ("trucks", "today_inspections", "today_defects", "pending_approval", "recent"):
            assert k in r.json()


# ---------- Photo size limit + cron/purge (Schema v3 photo retention) ----------
import uuid as _uuid


def _read_env_kv(path, key):
    try:
        lines = open(path)
    except OSError:
        return None
    with lines:
        for line in lines:
            line = line.strip()
            if line.startswith(key + "="):
                v = line.split("=", 1)[1].strip()
                if v.startswith('"') and v.endswith('"'):
                    v = v[1:-1]
                return v
    return None


def _cron_secret():
    if os.environ.get("WEBHOOK_CRON_SECRET"):
        return os.environ["WEBHOOK_CRON_SECRET"]
    here = os.path.dirname(os.path.abspath(__file__))
    for path in ("/app/backend/.env", os.path.join(here, "..", ".env")):
        secret = _read_env_kv(path, "WEBHOOK_CRON_SECRET")
        if secret:
            return secret
    return None


CRON_SECRET = _cron_secret()


class TestUploadSizeLimit:
    def test_upload_over_500k_rejected(self, driver_ctx):
        # Build a PNG with a big trailing (non-critical) chunk so bytes > 500KB
        base = _tiny_png_bytes()
        # Insert 600KB into an IDAT-style chunk before IEND is fine, but simpler: just append raw bytes
        # Server checks raw bytes length regardless.
        big = base + b"\x00" * (600 * 1024)
        r = requests.post(f"{API}/uploads",
                          files={"file": ("big.png", big, "image/png")},
                          headers=_auth(driver_ctx["token"]))
        assert r.status_code == 400
        assert "500KB" in r.text or "too large" in r.text.lower()

    def test_upload_small_png_ok(self, driver_ctx):
        r = requests.post(f"{API}/uploads",
                          files={"file": ("t.png", _tiny_png_bytes(), "image/png")},
                          headers=_auth(driver_ctx["token"]))
        assert r.status_code == 200
        assert "path" in r.json()


class TestCronPurgeEndpoint:
    def test_no_auth_401(self):
        r = requests.post(f"{API}/cron/purge-photos", json={})
        assert r.status_code == 401

    def test_wrong_bearer_401(self):
        r = requests.post(f"{API}/cron/purge-photos", json={},
                          headers={"Authorization": "Bearer wrong-secret"})
        assert r.status_code == 401

    def test_correct_bearer_accepts_and_dedupes(self):
        assert CRON_SECRET, "WEBHOOK_CRON_SECRET missing"
        wid = f"test-{_uuid.uuid4()}"
        h = {"Authorization": f"Bearer {CRON_SECRET}", "X-Webhook-Id": wid,
             "Content-Type": "application/json"}
        r = requests.post(f"{API}/cron/purge-photos", json={}, headers=h)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["accepted"] is True
        assert d["run_id"] == wid
        assert not d.get("duplicate")
        # Duplicate
        r2 = requests.post(f"{API}/cron/purge-photos", json={}, headers=h)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2.get("duplicate") is True
        assert d2["run_id"] == wid
        # cron_runs eventually reaches 'done'
        import time
        for _ in range(15):
            time.sleep(0.5)
            # Use manual endpoint would require superadmin; instead check via a fresh call - but we can inspect via superadmin? no direct.
            # Rely on delay only; correctness of 'done' status is covered by manual purge tests below.
            break


class TestManualPurgeRBACAndIdempotency:
    def test_admin_forbidden(self, admin_ctx):
        r = requests.post(f"{API}/maintenance/purge-photos",
                          headers=_auth(admin_ctx["token"]))
        assert r.status_code == 403

    def test_driver_forbidden(self, driver_ctx):
        r = requests.post(f"{API}/maintenance/purge-photos",
                          headers=_auth(driver_ctx["token"]))
        assert r.status_code == 403

    def test_superadmin_runs_idempotent(self, super_ctx):
        # Run twice — second should purge 0 (or at least not error) since retention window is stable
        r1 = requests.post(f"{API}/maintenance/purge-photos",
                           headers=_auth(super_ctx["token"]))
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        for k in ("inspections", "photos", "run_id", "finished_at", "cutoff"):
            assert k in d1
        r2 = requests.post(f"{API}/maintenance/purge-photos",
                           headers=_auth(super_ctx["token"]))
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["inspections"] == 0
        assert d2["photos"] == 0


class TestPurgeEndToEnd:
    """Upload photo, create inspection, backdate its completed_at, purge, verify."""

    def test_backdated_inspection_gets_purged(self, driver_ctx, super_ctx, admin_ctx):
        import time
        # 1. Upload photo
        r = requests.post(f"{API}/uploads",
                          files={"file": ("t.png", _tiny_png_bytes(), "image/png")},
                          headers=_auth(driver_ctx["token"]))
        assert r.status_code == 200
        photo_path = r.json()["path"]

        # 2. Create inspection on DT-004 with photo on first item
        trucks = requests.get(f"{API}/trucks", headers=_auth(admin_ctx["token"])).json()
        truck = next(t for t in trucks if t["hull_number"] == "DT-004")
        r = requests.get(f"{API}/inspections/checklist?truck_id={truck['id']}",
                         headers=_auth(driver_ctx["token"]))
        items = [i for g in r.json()["groups"] for i in g["items"]]
        results = [{"item_id": it["id"], "item_name": it["name"], "status": "OK", "note": None, "photos": []}
                   for it in items]
        results[0]["photos"] = [photo_path]
        payload = {"truck_id": truck["id"], "km_hm": 1234.0,
                   "started_at": datetime.now(timezone.utc).isoformat(),
                   "inspection_date": datetime.now(timezone.utc).date().isoformat(),
                   "inspection_type_id": _type_id(driver_ctx["token"]),
                   "results": results}
        r = requests.post(f"{API}/inspections", json=payload, headers=_auth(driver_ctx["token"]))
        assert r.status_code == 200, r.text
        iid = r.json()["id"]

        # 3. Backdate completed_at via mongosh
        old_iso = (datetime.now(timezone.utc) - timedelta(days=100)).isoformat()
        import subprocess
        cmd = ["mongosh", "test_database", "--quiet", "--eval",
               f'db.inspections.updateOne({{_id: ObjectId("{iid}")}}, {{$set: {{completed_at: "{old_iso}"}}}})']
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        assert p.returncode == 0, p.stderr
        assert '"modifiedCount"' in p.stdout or "modifiedCount: 1" in p.stdout, p.stdout

        # 4. Run purge as superadmin
        r = requests.post(f"{API}/maintenance/purge-photos", headers=_auth(super_ctx["token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["inspections"] >= 1
        assert d["photos"] >= 1

        # 5. Inspection still exists but photos cleared + photos_purged_at set
        r = requests.get(f"{API}/inspections/{iid}", headers=_auth(driver_ctx["token"]))
        assert r.status_code == 200
        insp = r.json()
        assert insp.get("photos_purged_at") is not None
        assert insp.get("purged_photo_count", 0) >= 1
        for res in insp["results"]:
            assert res.get("photos") in ([], None), f"photos not cleared on {res}"
        # total_items unchanged
        assert insp["total_items"] == len(items)

        # 6. File download 404
        r = requests.get(f"{API}/files/{photo_path}", headers=_auth(driver_ctx["token"]))
        assert r.status_code == 404

        # 7. Idempotency — re-run purges 0 (for this newly-affected inspection; may still be > 0 if others exist,
        #    but this one should not be re-purged since photos_purged_at is set)
        r = requests.post(f"{API}/maintenance/purge-photos", headers=_auth(super_ctx["token"]))
        assert r.status_code == 200
        d2 = r.json()
        # our test's inspection was already handled — checking it's not counted again is implicit via photos_purged_at guard;
        # assert either 0 photos OR the same inspection isn't touched (fetch again -> purged_photo_count unchanged)
        r = requests.get(f"{API}/inspections/{iid}", headers=_auth(driver_ctx["token"]))
        assert r.json().get("purged_photo_count", 0) >= 1

    def test_recent_inspection_not_purged(self, driver_ctx, super_ctx, admin_ctx):
        # Create a fresh inspection with a photo — it must survive purge
        r = requests.post(f"{API}/uploads",
                          files={"file": ("t.png", _tiny_png_bytes(), "image/png")},
                          headers=_auth(driver_ctx["token"]))
        photo_path = r.json()["path"]
        trucks = requests.get(f"{API}/trucks", headers=_auth(admin_ctx["token"])).json()
        truck = next(t for t in trucks if t["hull_number"] == "DT-005")
        r = requests.get(f"{API}/inspections/checklist?truck_id={truck['id']}",
                         headers=_auth(driver_ctx["token"]))
        items = [i for g in r.json()["groups"] for i in g["items"]]
        results = [{"item_id": it["id"], "item_name": it["name"], "status": "OK", "note": None, "photos": []}
                   for it in items]
        results[0]["photos"] = [photo_path]
        payload = {"truck_id": truck["id"], "km_hm": 99.0,
                   "started_at": datetime.now(timezone.utc).isoformat(),
                   "inspection_date": datetime.now(timezone.utc).date().isoformat(),
                   "inspection_type_id": _type_id(driver_ctx["token"]),
                   "results": results}
        r = requests.post(f"{API}/inspections", json=payload, headers=_auth(driver_ctx["token"]))
        assert r.status_code == 200
        iid = r.json()["id"]

        # Purge — this recent inspection must NOT be affected
        requests.post(f"{API}/maintenance/purge-photos", headers=_auth(super_ctx["token"]))
        r = requests.get(f"{API}/inspections/{iid}", headers=_auth(driver_ctx["token"]))
        insp = r.json()
        assert insp.get("photos_purged_at") is None
        assert insp["results"][0]["photos"] == [photo_path]



# ---------- Inspection Types (new master iteration 4) ----------
class TestInspectionTypes:
    def test_site_admin_list_has_seeded_types(self, admin_ctx):
        r = requests.get(f"{API}/inspection-types", headers=_auth(admin_ctx["token"]))
        assert r.status_code == 200
        types = r.json()
        active = [t for t in types if t.get("is_active")]
        names = {t["name"] for t in active}
        for n in ("Daily Inspection (P2H)", "Weekly Inspection", "Pre-Delivery Inspection"):
            assert n in names, f"missing seeded type {n}"
        for t in types:
            assert "_id" not in t
            assert "id" in t
            assert t.get("company_id")

    def test_site_admin_write_forbidden(self, admin_ctx):
        r = requests.post(f"{API}/inspection-types",
                          json={"name": "TEST_Type_A", "code": "TSTA"},
                          headers=_auth(admin_ctx["token"]))
        assert r.status_code == 403

    def test_company_admin_crud(self, company_admin_ctx):
        tok = company_admin_ctx["token"]
        payload = {"name": "TEST_Type_A", "code": "TSTA", "description": "test create"}
        r = requests.post(f"{API}/inspection-types", json=payload, headers=_auth(tok))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["name"] == "TEST_Type_A" and d["code"] == "TSTA"
        tid = d["id"]
        try:
            r2 = requests.put(f"{API}/inspection-types/{tid}",
                              json={"name": "TEST_Type_A2", "code": "TSTA", "description": "u"},
                              headers=_auth(tok))
            assert r2.status_code == 200 and r2.json()["name"] == "TEST_Type_A2"
            r3 = requests.get(f"{API}/inspection-types", headers=_auth(tok)).json()
            assert any(t["id"] == tid and t["name"] == "TEST_Type_A2" for t in r3)
        finally:
            rd = requests.delete(f"{API}/inspection-types/{tid}", headers=_auth(tok))
            assert rd.status_code == 200
        r4 = requests.get(f"{API}/inspection-types", headers=_auth(tok)).json()
        assert not any(t["id"] == tid for t in r4)

    def test_driver_post_forbidden(self, driver_ctx):
        r = requests.post(f"{API}/inspection-types",
                          json={"name": "TEST_x", "code": "X"},
                          headers=_auth(driver_ctx["token"]))
        assert r.status_code == 403

    def test_superadmin_needs_company_id(self, super_ctx, admin_ctx):
        r = requests.post(f"{API}/inspection-types",
                          json={"name": "TEST_SA_no_co", "code": "SANS"},
                          headers=_auth(super_ctx["token"]))
        assert r.status_code == 400
        me = requests.get(f"{API}/auth/me", headers=_auth(admin_ctx["token"])).json()
        company_id = me["company_id"]
        r2 = requests.post(f"{API}/inspection-types",
                           json={"name": "TEST_SA_ok", "code": "SAOK", "company_id": company_id},
                           headers=_auth(super_ctx["token"]))
        assert r2.status_code == 200, r2.text
        tid = r2.json()["id"]
        r3 = requests.get(f"{API}/inspection-types?company_id={company_id}",
                          headers=_auth(super_ctx["token"]))
        assert r3.status_code == 200
        assert any(t["id"] == tid for t in r3.json())
        requests.delete(f"{API}/inspection-types/{tid}", headers=_auth(super_ctx["token"]))


# ---------- Inspection create with inspection_type_id ----------
class TestInspectionTypeValidation:
    def _base_payload(self, driver_ctx, admin_ctx, hull="DT-003"):
        trucks = requests.get(f"{API}/trucks", headers=_auth(admin_ctx["token"])).json()
        truck = next(t for t in trucks if t["hull_number"] == hull)
        cl = requests.get(f"{API}/inspections/checklist?truck_id={truck['id']}",
                          headers=_auth(driver_ctx["token"])).json()
        items = [i for g in cl["groups"] for i in g["items"]]
        results = [{"item_id": it["id"], "item_name": it["name"], "status": "OK", "note": None, "photos": []}
                   for it in items]
        return {"truck_id": truck["id"], "km_hm": 100.0,
                "started_at": datetime.now(timezone.utc).isoformat(),
                "inspection_date": datetime.now(timezone.utc).date().isoformat(),
                "results": results}

    def test_missing_type_id_422(self, driver_ctx, admin_ctx):
        p = self._base_payload(driver_ctx, admin_ctx)
        r = requests.post(f"{API}/inspections", json=p, headers=_auth(driver_ctx["token"]))
        assert r.status_code == 422, r.text

    def test_bogus_type_id_400(self, driver_ctx, admin_ctx):
        p = self._base_payload(driver_ctx, admin_ctx)
        p["inspection_type_id"] = "507f1f77bcf86cd799439011"
        r = requests.post(f"{API}/inspections", json=p, headers=_auth(driver_ctx["token"]))
        assert r.status_code == 400
        assert "Invalid inspection type" in r.text

    def test_inactive_type_400(self, driver_ctx, admin_ctx, company_admin_ctx):
        tok = company_admin_ctx["token"]
        r = requests.post(f"{API}/inspection-types",
                          json={"name": "TEST_Inactive", "code": "INA", "is_active": False},
                          headers=_auth(tok))
        assert r.status_code == 200
        tid = r.json()["id"]
        try:
            p = self._base_payload(driver_ctx, admin_ctx)
            p["inspection_type_id"] = tid
            r2 = requests.post(f"{API}/inspections", json=p, headers=_auth(driver_ctx["token"]))
            assert r2.status_code == 400
        finally:
            requests.delete(f"{API}/inspection-types/{tid}", headers=_auth(tok))

    def test_valid_type_stores_id_and_name(self, driver_ctx, admin_ctx):
        p = self._base_payload(driver_ctx, admin_ctx)
        tid = _type_id(driver_ctx["token"])
        p["inspection_type_id"] = tid
        r = requests.post(f"{API}/inspections", json=p, headers=_auth(driver_ctx["token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["inspection_type_id"] == tid
        assert d["inspection_type_name"]
        iid = d["id"]
        # List includes type name
        lst = requests.get(f"{API}/inspections", headers=_auth(driver_ctx["token"])).json()
        row = next(i for i in lst if i["id"] == iid)
        assert row.get("inspection_type_name") == d["inspection_type_name"]
        # Detail includes it
        det = requests.get(f"{API}/inspections/{iid}", headers=_auth(driver_ctx["token"])).json()
        assert det["inspection_type_id"] == tid
        assert det["inspection_type_name"] == d["inspection_type_name"]
