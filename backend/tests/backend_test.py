"""
Backend tests for DT Inspection API.
Covers: auth, RBAC, masters (companies/sites/users/trucks/categories/items),
inspections (checklist, create, approval), recap, CSV export, upload/download, dashboard.
"""
import io
import os
import struct
import zlib
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or "http://localhost:8001"
API = f"{BASE_URL}/api"

SUPER = {"email": "oktavio.rei@gmail.com", "password": "Admin@1234"}
ADMIN = {"email": "admin@iti.demo", "password": "Admin@1234"}
DRIVER = {"email": "driver@iti.demo", "password": "Driver@1234"}


# ---------- Helpers ----------
def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    return r.json()


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _tiny_png_bytes():
    # 1x1 red pixel valid PNG
    sig = b"\x89PNG\r\n\x1a\n"
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    raw = b"\x00\xff\x00\x00"
    idat = chunk(b"IDAT", zlib.compress(raw))
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
def driver_ctx():
    d = _login(DRIVER)
    return {"token": d["access_token"], "user": d["user"]}


@pytest.fixture(scope="module")
def site_id(admin_ctx):
    return admin_ctx["user"]["site_id"]


# ---------- Auth ----------
class TestAuth:
    def test_login_super(self):
        d = _login(SUPER)
        assert d["user"]["role"] == "superadmin"
        assert d["access_token"]

    def test_login_admin_driver(self):
        assert _login(ADMIN)["user"]["role"] == "admin"
        assert _login(DRIVER)["user"]["role"] == "driver"

    def test_login_wrong_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN["email"], "password": "wrong-pw"})
        assert r.status_code in (401, 429)

    def test_me_unauth(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_me_authed(self, admin_ctx):
        r = requests.get(f"{API}/auth/me", headers=_auth(admin_ctx["token"]))
        assert r.status_code == 200
        assert r.json()["role"] == "admin"
        assert r.json().get("site_name")


# ---------- Companies/Sites RBAC ----------
class TestCompaniesSites:
    def test_admin_cannot_create_company(self, admin_ctx):
        r = requests.post(f"{API}/companies", json={"name": "TEST_X", "code": "TX"}, headers=_auth(admin_ctx["token"]))
        assert r.status_code == 403

    def test_super_company_crud(self, super_ctx):
        tok = super_ctx["token"]
        # create
        r = requests.post(f"{API}/companies", json={"name": "TEST_Co", "code": "TEST_CO_X"}, headers=_auth(tok))
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        # update
        r = requests.put(f"{API}/companies/{cid}", json={"name": "TEST_Co2", "code": "TEST_CO_X"}, headers=_auth(tok))
        assert r.status_code == 200 and r.json()["name"] == "TEST_Co2"
        # delete
        r = requests.delete(f"{API}/companies/{cid}", headers=_auth(tok))
        assert r.status_code == 200

    def test_super_site_crud(self, super_ctx):
        tok = super_ctx["token"]
        r = requests.post(f"{API}/companies", json={"name": "TEST_CoS", "code": "TEST_COS"}, headers=_auth(tok))
        cid = r.json()["id"]
        r = requests.post(f"{API}/sites", json={"company_id": cid, "name": "TEST_Site", "code": "TSITE"}, headers=_auth(tok))
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        r = requests.put(f"{API}/sites/{sid}", json={"company_id": cid, "name": "TEST_Site2", "code": "TSITE"}, headers=_auth(tok))
        assert r.status_code == 200 and r.json()["name"] == "TEST_Site2"
        assert requests.delete(f"{API}/sites/{sid}", headers=_auth(tok)).status_code == 200
        assert requests.delete(f"{API}/companies/{cid}", headers=_auth(tok)).status_code == 200


# ---------- Users ----------
class TestUsers:
    def test_admin_cannot_create_admin(self, admin_ctx):
        r = requests.post(f"{API}/users", json={
            "email": "TEST_newadmin@example.com", "name": "TEST", "role": "admin", "password": "pass123"
        }, headers=_auth(admin_ctx["token"]))
        assert r.status_code == 403

    def test_admin_creates_driver(self, admin_ctx):
        tok = admin_ctx["token"]
        email = f"TEST_drv_{datetime.now().timestamp():.0f}@example.com"
        r = requests.post(f"{API}/users", json={
            "email": email, "name": "TEST Driver", "role": "driver", "password": "pass123"
        }, headers=_auth(tok))
        assert r.status_code == 200, r.text
        uid = r.json()["id"]
        # duplicate
        r2 = requests.post(f"{API}/users", json={
            "email": email, "name": "TEST Driver 2", "role": "driver", "password": "pass123"
        }, headers=_auth(tok))
        assert r2.status_code == 400
        # cleanup
        requests.delete(f"{API}/users/{uid}", headers=_auth(tok))

    def test_super_requires_site_id_non_super(self, super_ctx):
        r = requests.post(f"{API}/users", json={
            "email": "TEST_super_missing_site@example.com", "name": "x", "role": "driver", "password": "pass123"
        }, headers=_auth(super_ctx["token"]))
        assert r.status_code == 400


# ---------- Masters (trucks/categories/items) ----------
class TestMasters:
    def test_driver_get_ok_write_403(self, driver_ctx):
        tok = driver_ctx["token"]
        assert requests.get(f"{API}/trucks", headers=_auth(tok)).status_code == 200
        r = requests.post(f"{API}/trucks", json={"unit_number": "TEST-X", "truck_type": "ICE"}, headers=_auth(tok))
        assert r.status_code == 403

    def test_admin_truck_crud(self, admin_ctx):
        tok = admin_ctx["token"]
        r = requests.post(f"{API}/trucks", json={"unit_number": "TEST_TRK1", "truck_type": "ICE"}, headers=_auth(tok))
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        r = requests.put(f"{API}/trucks/{tid}", json={"unit_number": "TEST_TRK1B", "truck_type": "EV"}, headers=_auth(tok))
        assert r.status_code == 200 and r.json()["truck_type"] == "EV"
        assert requests.delete(f"{API}/trucks/{tid}", headers=_auth(tok)).status_code == 200


# ---------- Checklist ----------
class TestChecklist:
    def _find_truck(self, ctx, ttype):
        r = requests.get(f"{API}/trucks", headers=_auth(ctx["token"]))
        for t in r.json():
            if t["truck_type"] == ttype:
                return t
        return None

    def test_ice_29_items(self, admin_ctx):
        truck = self._find_truck(admin_ctx, "ICE")
        assert truck, "no ICE truck seeded"
        r = requests.get(f"{API}/inspections/checklist?truck_id={truck['id']}", headers=_auth(admin_ctx["token"]))
        assert r.status_code == 200
        data = r.json()
        total = sum(len(g["items"]) for g in data["groups"])
        assert total == 29, f"expected 29 items for ICE, got {total}"
        # grouped and ordered
        assert data["groups"][0]["category"]["name"] == "Chassis Inspection"
        orders = [i["order"] for g in data["groups"] for i in g["items"]]
        assert orders == sorted(orders)

    def test_ev_37_items(self, admin_ctx):
        truck = self._find_truck(admin_ctx, "EV")
        if not truck:
            pytest.skip("No EV truck seeded")
        r = requests.get(f"{API}/inspections/checklist?truck_id={truck['id']}", headers=_auth(admin_ctx["token"]))
        assert r.status_code == 200
        total = sum(len(g["items"]) for g in r.json()["groups"])
        assert total == 37, f"expected 37 items for EV, got {total}"


# ---------- Inspection lifecycle ----------
class TestInspection:
    inspection_id = None

    def test_driver_create_inspection(self, driver_ctx, admin_ctx):
        # find ICE truck via admin
        r = requests.get(f"{API}/trucks", headers=_auth(admin_ctx["token"]))
        truck = next(t for t in r.json() if t["truck_type"] == "ICE")
        # get checklist as driver
        r = requests.get(f"{API}/inspections/checklist?truck_id={truck['id']}", headers=_auth(driver_ctx["token"]))
        items = [i for g in r.json()["groups"] for i in g["items"]]
        results = []
        for idx, it in enumerate(items):
            status = "NOT_OK" if idx == 0 else "OK"
            results.append({"item_id": it["id"], "item_name": it["name"], "status": status,
                            "note": "TEST defect" if status != "OK" else None, "photos": []})
        payload = {
            "truck_id": truck["id"], "km_hm": 12345.6,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "inspection_date": datetime.now(timezone.utc).date().isoformat(),
            "results": results,
        }
        r = requests.post(f"{API}/inspections", json=payload, headers=_auth(driver_ctx["token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "submitted"
        assert d["defect_count"] == 1 and d["has_defect"] is True
        assert d["completed_at"] and d["driver_name"]
        TestInspection.inspection_id = d["id"]

    def test_driver_lists_own(self, driver_ctx):
        r = requests.get(f"{API}/inspections", headers=_auth(driver_ctx["token"]))
        assert r.status_code == 200
        assert all(i["driver_id"] for i in r.json())

    def test_super_requires_site_or_ok(self, super_ctx):
        r = requests.get(f"{API}/inspections", headers=_auth(super_ctx["token"]))
        assert r.status_code == 200

    def test_driver_cannot_approve(self, driver_ctx):
        iid = TestInspection.inspection_id
        r = requests.post(f"{API}/inspections/{iid}/approval",
                          json={"decision": "approved"}, headers=_auth(driver_ctx["token"]))
        assert r.status_code == 403

    def test_admin_approves(self, admin_ctx):
        iid = TestInspection.inspection_id
        r = requests.post(f"{API}/inspections/{iid}/approval",
                          json={"decision": "approved", "admin_note": "TEST ok"},
                          headers=_auth(admin_ctx["token"]))
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "approved"
        assert d["approved_by_name"] and d["approved_at"]


# ---------- Recap & Export ----------
class TestRecap:
    def _dates(self):
        d1 = datetime.now(timezone.utc).date()
        d0 = d1 - timedelta(days=6)
        return d0.isoformat(), d1.isoformat()

    def test_driver_recap_403(self, driver_ctx):
        d0, d1 = self._dates()
        r = requests.get(f"{API}/recap?date_from={d0}&date_to={d1}", headers=_auth(driver_ctx["token"]))
        assert r.status_code == 403

    def test_super_recap_missing_site_400(self, super_ctx):
        d0, d1 = self._dates()
        r = requests.get(f"{API}/recap?date_from={d0}&date_to={d1}", headers=_auth(super_ctx["token"]))
        assert r.status_code == 400

    def test_admin_recap(self, admin_ctx):
        d0, d1 = self._dates()
        r = requests.get(f"{API}/recap?date_from={d0}&date_to={d1}", headers=_auth(admin_ctx["token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["dates"] and d["trucks"]
        t = d["trucks"][0]
        for k in ("total_inspections", "defects_found", "approved", "pending", "last_inspection"):
            assert k in t

    def test_export_matrix_csv(self, admin_ctx):
        d0, d1 = self._dates()
        r = requests.get(f"{API}/recap/export?kind=matrix&date_from={d0}&date_to={d1}", headers=_auth(admin_ctx["token"]))
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        lines = r.text.strip().splitlines()
        assert lines[0].startswith("Unit Number,Type")
        assert len(lines) > 1

    def test_export_summary_csv(self, admin_ctx):
        d0, d1 = self._dates()
        r = requests.get(f"{API}/recap/export?kind=summary&date_from={d0}&date_to={d1}", headers=_auth(admin_ctx["token"]))
        assert r.status_code == 200
        lines = r.text.strip().splitlines()
        assert "Unit Number" in lines[0] and "Total Inspections" in lines[0]
        assert len(lines) > 1


# ---------- Files ----------
class TestFiles:
    def test_upload_and_download(self, driver_ctx):
        png = _tiny_png_bytes()
        files = {"file": ("t.png", png, "image/png")}
        r = requests.post(f"{API}/uploads", files=files, headers=_auth(driver_ctx["token"]))
        assert r.status_code == 200, r.text
        path = r.json()["path"]
        # Bearer download
        r2 = requests.get(f"{API}/files/{path}", headers=_auth(driver_ctx["token"]))
        assert r2.status_code == 200
        assert r2.headers.get("content-type", "").startswith("image/")
        # query auth download
        r3 = requests.get(f"{API}/files/{path}", params={"auth": driver_ctx["token"]})
        assert r3.status_code == 200

    def test_upload_non_image_400(self, driver_ctx):
        files = {"file": ("t.txt", b"hello", "text/plain")}
        r = requests.post(f"{API}/uploads", files=files, headers=_auth(driver_ctx["token"]))
        assert r.status_code == 400


# ---------- Dashboard ----------
class TestDashboard:
    def test_admin_dashboard(self, admin_ctx):
        r = requests.get(f"{API}/dashboard", headers=_auth(admin_ctx["token"]))
        assert r.status_code == 200
        d = r.json()
        for k in ("trucks", "today_inspections", "today_defects", "pending_approval", "recent"):
            assert k in d
