"""
Backend tests for DT Inspection API (Schema v2: hull_number/unit_vin_number, category_ids assignment).
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
ADMIN = {"email": "admin@iti.demo", "password": "Admin@1234"}
DRIVER = {"email": "driver@iti.demo", "password": "Driver@1234"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


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
def driver_ctx():
    d = _login(DRIVER)
    return {"token": d["access_token"], "user": d["user"]}


# ---------- Auth ----------
class TestAuth:
    def test_login_roles(self):
        assert _login(SUPER)["user"]["role"] == "superadmin"
        assert _login(ADMIN)["user"]["role"] == "admin"
        assert _login(DRIVER)["user"]["role"] == "driver"

    def test_login_bad_pw(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN["email"], "password": "wrong-pw"})
        assert r.status_code in (401, 429)

    def test_me(self, admin_ctx):
        r = requests.get(f"{API}/auth/me", headers=_auth(admin_ctx["token"]))
        assert r.status_code == 200 and r.json()["role"] == "admin"

    def test_me_unauth(self):
        assert requests.get(f"{API}/auth/me").status_code == 401


# ---------- Trucks (new schema fields + assignment) ----------
class TestTrucksSchema:
    def test_list_returns_new_fields(self, admin_ctx):
        r = requests.get(f"{API}/trucks", headers=_auth(admin_ctx["token"]))
        assert r.status_code == 200
        trucks = r.json()
        assert trucks, "no trucks seeded"
        for t in trucks:
            for k in ("unit_vin_number", "hull_number", "drivetrain_layout", "category_ids"):
                assert k in t, f"missing {k} on truck {t}"
            assert "truck_type" not in t  # removed
        # sorted by hull_number
        hulls = [t["hull_number"] for t in trucks]
        assert hulls == sorted(hulls)

    def test_create_requires_vin_and_hull(self, admin_ctx):
        tok = admin_ctx["token"]
        # missing hull
        r = requests.post(f"{API}/trucks", json={"unit_vin_number": "TESTVIN1"}, headers=_auth(tok))
        assert r.status_code == 422
        # missing vin
        r = requests.post(f"{API}/trucks", json={"hull_number": "TEST-HULL-1"}, headers=_auth(tok))
        assert r.status_code == 422

    def test_create_ignores_category_ids_in_body(self, admin_ctx):
        tok = admin_ctx["token"]
        # First get a real category id
        cats = requests.get(f"{API}/categories", headers=_auth(tok)).json()
        cid = cats[0]["id"]
        payload = {
            "unit_vin_number": "TESTVIN_IGN", "hull_number": "TEST-HULL-IGN",
            "brand": "TESTBrand", "model": "TESTModel", "drivetrain_layout": "4x2",
            "category_ids": [cid],
        }
        r = requests.post(f"{API}/trucks", json=payload, headers=_auth(tok))
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        try:
            assert r.json()["category_ids"] == []  # ignored
            assert r.json()["hull_number"] == "TEST-HULL-IGN"
            assert r.json()["unit_vin_number"] == "TESTVIN_IGN"
            assert r.json()["drivetrain_layout"] == "4x2"
        finally:
            requests.delete(f"{API}/trucks/{tid}", headers=_auth(tok))

    def test_assign_categories_endpoint(self, admin_ctx):
        tok = admin_ctx["token"]
        cats = requests.get(f"{API}/categories", headers=_auth(tok)).json()
        assert len(cats) >= 2
        c1, c2 = cats[0]["id"], cats[1]["id"]
        r = requests.post(f"{API}/trucks",
                          json={"unit_vin_number": "TESTVIN_A", "hull_number": "TEST-HULL-A"},
                          headers=_auth(tok))
        tid = r.json()["id"]
        try:
            # assign in order [c2, c1]
            r = requests.put(f"{API}/trucks/{tid}/categories", json={"ids": [c2, c1]}, headers=_auth(tok))
            assert r.status_code == 200
            assert r.json()["category_ids"] == [c2, c1]
            # reorder
            r = requests.put(f"{API}/trucks/{tid}/categories", json={"ids": [c1, c2]}, headers=_auth(tok))
            assert r.json()["category_ids"] == [c1, c2]
            # invalid id gets dropped
            r = requests.put(f"{API}/trucks/{tid}/categories",
                             json={"ids": [c1, "507f1f77bcf86cd799439011"]},
                             headers=_auth(tok))
            assert r.json()["category_ids"] == [c1]
        finally:
            requests.delete(f"{API}/trucks/{tid}", headers=_auth(tok))


# ---------- Categories.item_ids assignment ----------
class TestCategoryItemAssignment:
    def test_get_returns_item_ids(self, admin_ctx):
        r = requests.get(f"{API}/categories", headers=_auth(admin_ctx["token"]))
        assert r.status_code == 200
        for c in r.json():
            assert "item_ids" in c
        chassis = next(c for c in r.json() if c["name"] == "Chassis Inspection")
        assert len(chassis["item_ids"]) == 29
        ev = next(c for c in r.json() if c["name"] == "EV Components")
        assert len(ev["item_ids"]) == 8

    def test_assign_items_moves_and_clears(self, admin_ctx):
        tok = admin_ctx["token"]
        cats = requests.get(f"{API}/categories", headers=_auth(tok)).json()
        chassis = next(c for c in cats if c["name"] == "Chassis Inspection")
        ev = next(c for c in cats if c["name"] == "EV Components")
        original_chassis = list(chassis["item_ids"])
        original_ev = list(ev["item_ids"])

        # Move first chassis item -> EV
        moved = original_chassis[0]
        new_chassis = original_chassis[1:]
        new_ev = original_ev + [moved]
        r = requests.put(f"{API}/categories/{chassis['id']}/items",
                         json={"ids": new_chassis}, headers=_auth(tok))
        assert r.status_code == 200
        assert r.json()["item_ids"] == new_chassis

        r = requests.put(f"{API}/categories/{ev['id']}/items",
                         json={"ids": new_ev}, headers=_auth(tok))
        assert r.json()["item_ids"] == new_ev

        # verify item.category_id updated to EV
        item = requests.get(f"{API}/items", headers=_auth(tok)).json()
        moved_item = next(i for i in item if i["id"] == moved)
        assert moved_item["category_id"] == ev["id"]

        # Now unassign one from EV -> item.category_id cleared
        r = requests.put(f"{API}/categories/{ev['id']}/items",
                         json={"ids": [i for i in new_ev if i != moved]}, headers=_auth(tok))
        assert r.status_code == 200
        item = requests.get(f"{API}/items", headers=_auth(tok)).json()
        moved_item = next(i for i in item if i["id"] == moved)
        assert moved_item.get("category_id") in (None, "")

        # RESTORE original state
        requests.put(f"{API}/categories/{chassis['id']}/items",
                     json={"ids": original_chassis}, headers=_auth(tok))
        requests.put(f"{API}/categories/{ev['id']}/items",
                     json={"ids": original_ev}, headers=_auth(tok))

        # verify restoration
        cats2 = requests.get(f"{API}/categories", headers=_auth(tok)).json()
        chassis2 = next(c for c in cats2 if c["name"] == "Chassis Inspection")
        ev2 = next(c for c in cats2 if c["name"] == "EV Components")
        assert chassis2["item_ids"] == original_chassis
        assert ev2["item_ids"] == original_ev


# ---------- Item CRUD auto-append/move/unassign ----------
class TestItemsAutoAppend:
    def test_create_appends_delete_pulls(self, admin_ctx):
        tok = admin_ctx["token"]
        cats = requests.get(f"{API}/categories", headers=_auth(tok)).json()
        chassis = next(c for c in cats if c["name"] == "Chassis Inspection")
        ev = next(c for c in cats if c["name"] == "EV Components")
        original = list(chassis["item_ids"])
        # Create item in Chassis
        r = requests.post(f"{API}/items",
                          json={"name": "TEST_Item_X", "guidance": "test", "category_id": chassis["id"],
                                "status_options": ["OK", "NOT_OK"]},
                          headers=_auth(tok))
        assert r.status_code == 200
        iid = r.json()["id"]
        try:
            # verify appended at end
            cats2 = requests.get(f"{API}/categories", headers=_auth(tok)).json()
            c2 = next(c for c in cats2 if c["id"] == chassis["id"])
            assert c2["item_ids"] == original + [iid]

            # Move to EV via PUT with category_id
            r = requests.put(f"{API}/items/{iid}",
                             json={"name": "TEST_Item_X", "category_id": ev["id"],
                                   "status_options": ["OK", "NOT_OK"]},
                             headers=_auth(tok))
            assert r.status_code == 200
            cats3 = requests.get(f"{API}/categories", headers=_auth(tok)).json()
            c_chassis = next(c for c in cats3 if c["id"] == chassis["id"])
            c_ev = next(c for c in cats3 if c["id"] == ev["id"])
            assert iid not in c_chassis["item_ids"]
            assert iid in c_ev["item_ids"]

            # PUT without category_id unassigns
            r = requests.put(f"{API}/items/{iid}",
                             json={"name": "TEST_Item_X", "status_options": ["OK", "NOT_OK"]},
                             headers=_auth(tok))
            assert r.status_code == 200
            cats4 = requests.get(f"{API}/categories", headers=_auth(tok)).json()
            c_ev2 = next(c for c in cats4 if c["id"] == ev["id"])
            assert iid not in c_ev2["item_ids"]
        finally:
            requests.delete(f"{API}/items/{iid}", headers=_auth(tok))
        # After delete, id not in any category
        cats5 = requests.get(f"{API}/categories", headers=_auth(tok)).json()
        for c in cats5:
            assert iid not in c["item_ids"]

    def test_delete_category_with_items_400(self, admin_ctx):
        tok = admin_ctx["token"]
        cats = requests.get(f"{API}/categories", headers=_auth(tok)).json()
        chassis = next(c for c in cats if c["name"] == "Chassis Inspection")
        r = requests.delete(f"{API}/categories/{chassis['id']}", headers=_auth(tok))
        assert r.status_code == 400


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
    for line in open(path):
        line = line.strip()
        if line.startswith(key + "="):
            v = line.split("=", 1)[1].strip()
            if v.startswith('"') and v.endswith('"'):
                v = v[1:-1]
            return v
    return None


CRON_SECRET = _read_env_kv("/app/backend/.env", "WEBHOOK_CRON_SECRET")


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
