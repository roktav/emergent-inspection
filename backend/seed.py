import os
import random
from datetime import datetime, timezone, timedelta

from auth import hash_password
from database import db

TIRE = "Periksa kelurusan, retakan, jumlah 10 baut dan deformasi"
STD = "Retak, bengkok, atau korosi berat"
DEF_OPTS = ["OK", "NOT_OK", "KOROSI"]

# (name, guidance, status_options, ev_only)
CHECKLIST = [
    ("Ban Kanan (Posisi 2)", TIRE, DEF_OPTS, False),
    ("Front Spring Hanger", STD, DEF_OPTS, False),
    ("Steering Bracket", STD, DEF_OPTS, False),
    ("Body Front Mounting", STD, DEF_OPTS, False),
    ("Engine Cross Member", STD, DEF_OPTS, False),
    ("Ban Kiri (Posisi 1)", TIRE, DEF_OPTS, False),
    ("Cab Mounting Rubber & Bracket", "Sobek, keras, kendor, atau retak bracket", DEF_OPTS, False),
    ("Cab Tipping Lock Mechanism", "Kunci berfungsi dan bracket tidak retak", DEF_OPTS, False),
    ("Front & Rear Cab Support Bracket", "Korosi, retak, deformasi", DEF_OPTS, False),
    ("Battery Box Bracket", STD, DEF_OPTS, True),
    ("Battery Pack Mounting Bracket", STD, DEF_OPTS, True),
    ("Battery Tray Weld", STD, DEF_OPTS, True),
    ("HV Cable Clamp Mounting", STD, DEF_OPTS, True),
    ("E-axle Mounting Bracket", STD, DEF_OPTS, True),
    ("Motor Mounting Bracket", STD, DEF_OPTS, True),
    ("DC-DC Converter Support", STD, DEF_OPTS, True),
    ("Charging Port Bracket", STD, DEF_OPTS, True),
    ("Frame Rail L/H", STD, DEF_OPTS, False),
    ("Transmission Cross Member", STD, DEF_OPTS, False),
    ("Ban Kiri (Posisi 3)", TIRE, DEF_OPTS, False),
    ("Sub-Frame Penguat Bak Dump", STD, DEF_OPTS, False),
    ("Titik Engsel Bak (Hinge Pin & Bracket)", "Aus, retak, atau kehilangan pelumas", DEF_OPTS, False),
    ("Dudukan Silinder Hidrolik (Cylinder Bracket)", "Retak las, bengkok, atau deformasi", DEF_OPTS, False),
    ("Safety Prop / Locking Bar Bak", "Berfungsi, tidak bengkok/patah", DEF_OPTS, False),
    ("Baut Body Mounting (Dump Body ke Frame)", "Khusus perhatikan tanda geser horizontal", DEF_OPTS, False),
    ("Hydraulic Tank Bracket", STD, DEF_OPTS, False),
    ("Ban Kiri (Posisi 5 & 6)", TIRE, DEF_OPTS, False),
    ("Ban Kiri (Posisi 9 & 10)", TIRE, DEF_OPTS, False),
    ("Body Rear Mounting", STD, DEF_OPTS, False),
    ("Tailgate Locking Mechanism Bracket", "Retak, aus, atau kehilangan komponen", DEF_OPTS, False),
    ("Ban Kanan (Posisi 11 & 12)", TIRE, DEF_OPTS, False),
    ("Ban Kanan (Posisi 7 & 8)", TIRE, DEF_OPTS, False),
    ("Ban Kanan (Posisi 4)", TIRE, DEF_OPTS, False),
    ("Frame Rail R/H", STD, DEF_OPTS, False),
    ("Cross Member Weld Area", STD, DEF_OPTS, False),
    ("Ban Pressure", "Tekanan depan 150 psi, belakang 170 psi", ["OK", "NOT_OK", "KURANG"], False),
    ("Mounting Lamp", "Baut baut lampu", ["OK", "NOT_OK", "LONGGAR"], False),
]

TRUCKS = [
    ("DT-001", "L-001", "EV", "BYD", "Q3 EV"),
    ("DT-002", "L-002", "ICE", "Hino", "FM 260 JD"),
    ("DT-003", "L-003", "EV", "BYD", "Q3 EV"),
    ("DT-004", "L-004", "ICE", "Mitsubishi", "Fuso FJ 2528"),
    ("DT-005", "L-005", "ICE", "Hino", "FM 260 JD"),
]


async def upsert_user(email, name, role, password, company_id=None, site_id=None):
    email = email.lower()
    existing = await db.users.find_one({"email": email})
    if existing is None:
        res = await db.users.insert_one({
            "email": email, "name": name, "role": role, "password_hash": hash_password(password),
            "company_id": company_id, "site_id": site_id, "is_active": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        return str(res.inserted_id)
    from auth import verify_password
    if not verify_password(password, existing["password_hash"]):
        await db.users.update_one({"_id": existing["_id"]}, {"$set": {"password_hash": hash_password(password)}})
    return str(existing["_id"])


async def seed_all():
    await db.users.create_index("email", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.inspections.create_index([("site_id", 1), ("inspection_date", 1)])
    await db.files.create_index("storage_path")

    company = await db.companies.find_one({"code": "ITI"})
    if not company:
        res = await db.companies.insert_one({"name": "PT Inline Technology International", "code": "ITI",
                                             "address": "Jakarta, Indonesia", "is_active": True})
        company_id = str(res.inserted_id)
    else:
        company_id = str(company["_id"])

    site = await db.sites.find_one({"code": "IMIP"})
    if not site:
        res = await db.sites.insert_one({"company_id": company_id, "name": "IMIP Morowali", "code": "IMIP",
                                         "location": "Morowali, Sulawesi Tengah", "is_active": True})
        site_id = str(res.inserted_id)
    else:
        site_id = str(site["_id"])
    if not await db.sites.find_one({"code": "IWIP"}):
        await db.sites.insert_one({"company_id": company_id, "name": "IWIP Weda Bay", "code": "IWIP",
                                   "location": "Halmahera Tengah, Maluku Utara", "is_active": True})

    await upsert_user(os.environ["SUPERADMIN_EMAIL"], "Super Admin", "superadmin", os.environ["SUPERADMIN_PASSWORD"])
    admin_id = await upsert_user("admin@iti.demo", "Irwan Saputra", "admin", "Admin@1234", company_id, site_id)
    driver_id = await upsert_user("driver@iti.demo", "Rizal Ramli", "driver", "Driver@1234", company_id, site_id)
    await upsert_user("driver2@iti.demo", "Ababil Ka'bah", "driver", "Driver@1234", company_id, site_id)

    truck_ids = []
    for unit, hull, ttype, brand, model in TRUCKS:
        t = await db.dump_trucks.find_one({"site_id": site_id, "unit_number": unit})
        if not t:
            res = await db.dump_trucks.insert_one({"company_id": company_id, "site_id": site_id, "unit_number": unit,
                                                   "hull_number": hull, "plate_number": None, "truck_type": ttype,
                                                   "brand": brand, "model": model, "is_active": True})
            truck_ids.append((str(res.inserted_id), unit, ttype))
        else:
            truck_ids.append((str(t["_id"]), unit, ttype))

    cat = await db.inspection_categories.find_one({"site_id": site_id, "name": "Chassis Inspection"})
    if not cat:
        res = await db.inspection_categories.insert_one({
            "company_id": company_id, "site_id": site_id, "name": "Chassis Inspection",
            "description": "Pergerakan Driver Berlawanan Arah Jarum Jam (counter-clockwise walk-around)",
            "order": 1, "is_active": True})
        cat_id = str(res.inserted_id)
        docs = [{"company_id": company_id, "site_id": site_id, "category_id": cat_id, "order": i + 1,
                 "name": n, "guidance": g, "status_options": o, "ev_only": ev, "is_active": True}
                for i, (n, g, o, ev) in enumerate(CHECKLIST)]
        await db.inspection_items.insert_many(docs)
    else:
        cat_id = str(cat["_id"])

    if await db.inspections.count_documents({"site_id": site_id}) == 0:
        items = await db.inspection_items.find({"site_id": site_id}).sort("order", 1).to_list(200)
        rng = random.Random(42)
        today = datetime.now(timezone.utc).date()
        for day_offset in range(1, 8):
            d = today - timedelta(days=day_offset)
            for tid, unit, ttype in truck_ids[:4]:
                if rng.random() < 0.2:
                    continue
                applicable = [it for it in items if ttype == "EV" or not it.get("ev_only")]
                results = []
                for it in applicable:
                    status = "OK"
                    if rng.random() < 0.05:
                        status = rng.choice([o for o in it["status_options"] if o != "OK"])
                    results.append({"item_id": str(it["_id"]), "item_name": it["name"], "category_name": "Chassis Inspection",
                                    "status": status, "note": "Ditemukan retak halus" if status != "OK" else None, "photos": []})
                defects = sum(1 for r in results if r["status"] != "OK")
                start = datetime(d.year, d.month, d.day, 6, 30, tzinfo=timezone.utc)
                end = start + timedelta(minutes=rng.randint(18, 40))
                approved = rng.random() < 0.7
                await db.inspections.insert_one({
                    "company_id": company_id, "site_id": site_id, "truck_id": tid, "truck_unit_number": unit,
                    "truck_type": ttype, "driver_id": driver_id, "driver_name": "Rizal Ramli",
                    "km_hm": 12000 + day_offset * 85 + rng.randint(0, 40), "started_at": start.isoformat(),
                    "completed_at": end.isoformat(), "inspection_date": d.isoformat(), "results": results,
                    "total_items": len(results), "defect_count": defects, "has_defect": defects > 0,
                    "status": "approved" if approved else "submitted",
                    "approved_by": admin_id if approved else None,
                    "approved_by_name": "Irwan Saputra" if approved else None,
                    "approved_at": (end + timedelta(hours=2)).isoformat() if approved else None,
                    "admin_note": None, "general_note": None,
                })
