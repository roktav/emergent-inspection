import os
import random
from datetime import datetime, timezone, timedelta

from auth import hash_password
from database import db
from migrations import apply_migrations

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
    ("MHRDT001EV2600001", "DT-001", "BYD", "Q3 EV", "6x4", True),
    ("MHRDT002IC2600002", "DT-002", "Hino", "FM 260 JD", "6x4", False),
    ("MHRDT003EV2600003", "DT-003", "BYD", "Q3 EV", "6x4", True),
    ("MHRDT004IC2600004", "DT-004", "Mitsubishi", "Fuso FJ 2528", "6x4", False),
    ("MHRDT005IC2600005", "DT-005", "Hino", "FM 260 JD", "8x4", False),
]

INSPECTION_TYPES = [
    ("Daily Inspection (P2H)", "P2H", "Pemeriksaan harian sebelum operasi"),
    ("Weekly Inspection", "WEEKLY", "Pemeriksaan mingguan"),
    ("Pre-Delivery Inspection", "PDI", "Pemeriksaan sebelum unit diserahterimakan"),
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
    updates = {}
    if existing.get("role") != role and existing.get("role") == "admin" and role == "site_admin":
        updates["role"] = role
    if not verify_password(password, existing["password_hash"]):
        updates["password_hash"] = hash_password(password)
    if updates:
        await db.users.update_one({"_id": existing["_id"]}, {"$set": updates})
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
    await upsert_user("company.admin@iti.demo", "Company Admin", "company_admin", "Admin@1234", company_id, None)
    admin_id = await upsert_user("admin@iti.demo", "Irwan Saputra", "site_admin", "Admin@1234", company_id, site_id)
    driver_id = await upsert_user("driver@iti.demo", "Rizal Ramli", "driver", "Driver@1234", company_id, site_id)
    await upsert_user("driver2@iti.demo", "Ababil Ka'bah", "driver", "Driver@1234", company_id, site_id)
    await upsert_user("mechanic@iti.demo", "Budi Mechanic", "mechanic", "Driver@1234", company_id, site_id)

    cat_ids = {}
    for name, desc, ev_flag in (
        ("Chassis Inspection", "Pergerakan Driver Berlawanan Arah Jarum Jam (counter-clockwise walk-around)", False),
        ("EV Components", "Only in EV truck — battery, e-axle, motor and charging brackets", True),
    ):
        cat = await db.inspection_categories.find_one({"company_id": company_id, "name": name})
        if not cat:
            res = await db.inspection_categories.insert_one({
                "company_id": company_id, "name": name, "description": desc, "item_ids": [], "is_active": True})
            cid = str(res.inserted_id)
            docs = [{"company_id": company_id, "name": n, "guidance": g,
                     "status_options": o, "is_active": True} for (n, g, o, ev) in CHECKLIST if ev == ev_flag]
            ins = await db.inspection_items.insert_many(docs)
            await db.inspection_categories.update_one({"_id": res.inserted_id},
                                                      {"$set": {"item_ids": [str(i) for i in ins.inserted_ids]}})
            cat_ids[name] = cid
        else:
            cat_ids[name] = str(cat["_id"])

    type_ids = {}
    for name, code, desc in INSPECTION_TYPES:
        it = await db.inspection_types.find_one({"company_id": company_id, "name": name})
        if not it:
            res = await db.inspection_types.insert_one({
                "company_id": company_id, "name": name, "code": code, "description": desc, "is_active": True})
            type_ids[name] = str(res.inserted_id)
        else:
            type_ids[name] = str(it["_id"])
    daily_type = INSPECTION_TYPES[0][0]

    # Vehicle categories (company templates)
    vc_cache = {}
    for vin, hull, brand, model, layout, is_ev in TRUCKS:
        key = (brand, model, layout, is_ev)
        if key not in vc_cache:
            vc_name = f"{brand} · {model} · {layout}"
            existing = await db.vehicle_categories.find_one({"company_id": company_id, "name": vc_name})
            if not existing:
                cats = [cat_ids["Chassis Inspection"]] + ([cat_ids["EV Components"]] if is_ev else [])
                res = await db.vehicle_categories.insert_one({
                    "company_id": company_id, "brand": brand, "name": vc_name, "model": model,
                    "drivetrain_layout": layout, "category_ids": cats, "is_active": True,
                })
                vc_cache[key] = str(res.inserted_id)
            else:
                vc_cache[key] = str(existing["_id"])

    truck_ids = []
    for vin, hull, brand, model, layout, is_ev in TRUCKS:
        t = await db.dump_trucks.find_one({"site_id": site_id, "hull_number": hull})
        vc_id = vc_cache[(brand, model, layout, is_ev)]
        if not t:
            res = await db.dump_trucks.insert_one({
                "company_id": company_id, "site_id": site_id, "unit_vin_number": vin,
                "hull_number": hull, "plate_number": None, "vehicle_category_id": vc_id, "is_active": True,
            })
            truck_ids.append((str(res.inserted_id), hull, vin, vc_id))
        else:
            if not t.get("vehicle_category_id"):
                await db.dump_trucks.update_one({"_id": t["_id"]}, {"$set": {"vehicle_category_id": vc_id},
                    "$unset": {"brand": "", "model": "", "drivetrain_layout": "", "category_ids": ""}})
            truck_ids.append((str(t["_id"]), hull, t.get("unit_vin_number"), t.get("vehicle_category_id") or vc_id))

    if await db.inspections.count_documents({"site_id": site_id}) == 0:
        cats = {str(c["_id"]): c for c in await db.inspection_categories.find({"company_id": company_id}).to_list(50)}
        items = {str(i["_id"]): i for i in await db.inspection_items.find({"company_id": company_id}).to_list(500)}
        vcs = {str(v["_id"]): v for v in await db.vehicle_categories.find({"company_id": company_id}).to_list(50)}
        rng = random.Random(42)
        today = datetime.now(timezone.utc).date()
        for day_offset in range(1, 8):
            d = today - timedelta(days=day_offset)
            for tid, hull, vin, vc_id in truck_ids[:4]:
                if rng.random() < 0.2:
                    continue
                vc = vcs[vc_id]
                results = []
                for cid in vc.get("category_ids", []):
                    for iid in cats[cid]["item_ids"]:
                        it = items[iid]
                        status = "OK"
                        if rng.random() < 0.03:
                            status = rng.choice([o for o in it["status_options"] if o != "OK"])
                        results.append({"item_id": iid, "item_name": it["name"], "category_name": cats[cid]["name"],
                                        "status": status, "note": "Ditemukan retak halus" if status != "OK" else None, "photos": []})
                defects = sum(1 for r in results if r["status"] != "OK")
                start = datetime(d.year, d.month, d.day, 6, 30, tzinfo=timezone.utc)
                end = start + timedelta(minutes=rng.randint(18, 40))
                approved = rng.random() < 0.7
                await db.inspections.insert_one({
                    "company_id": company_id, "site_id": site_id, "truck_id": tid, "truck_hull_number": hull,
                    "truck_vin_number": vin, "inspection_type_id": type_ids[daily_type], "inspection_type_name": daily_type,
                    "driver_id": driver_id, "driver_name": "Rizal Ramli",
                    "km_hm": 12000 + day_offset * 85 + rng.randint(0, 40), "started_at": start.isoformat(),
                    "completed_at": end.isoformat(), "inspection_date": d.isoformat(), "results": results,
                    "total_items": len(results), "defect_count": defects, "has_defect": defects > 0,
                    "status": "approved" if approved else "submitted",
                    "approved_by": admin_id if approved else None,
                    "approved_by_name": "Irwan Saputra" if approved else None,
                    "approved_at": (end + timedelta(hours=2)).isoformat() if approved else None,
                    "admin_note": None, "general_note": None,
                })

    await apply_migrations(db)
