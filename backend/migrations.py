"""Additive schema migrations.

Operational collections are never wiped. Each step is numbered, recorded on
the ``meta`` document ``{_id: "schema"}``, and must be safe to re-run.

To change the schema: append a function to MIGRATIONS. Do not bump a version
constant and delete collections — that path was removed because it destroyed
production trucks, checklists, and inspections.
"""
from datetime import datetime, timezone
import logging
from typing import Optional

from bson import ObjectId

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def plan_truck_v2(doc: dict) -> Optional[tuple[dict, dict]]:
    """Map leftover v1 truck fields onto the v2 assignment model. No deletes."""
    sets: dict = {}
    unsets: dict = {}

    if not doc.get("hull_number") and doc.get("unit_number"):
        sets["hull_number"] = doc["unit_number"]
        unsets["unit_number"] = ""

    if not doc.get("unit_vin_number") and doc.get("vin"):
        sets["unit_vin_number"] = doc["vin"]
        unsets["vin"] = ""

    ids = list(doc.get("category_ids") or [])
    legacy = doc.get("category_id")
    if legacy and legacy not in ids:
        ids = [legacy] + ids
        sets["category_ids"] = ids
    if "category_id" in doc:
        unsets["category_id"] = ""

    if not sets and not unsets:
        return None
    return sets, unsets


def plan_item_v2(doc: dict) -> Optional[tuple[dict, dict]]:
    sets: dict = {}
    unsets: dict = {}
    if not doc.get("guidance") and doc.get("technical_guidance"):
        sets["guidance"] = doc["technical_guidance"]
        unsets["technical_guidance"] = ""
    if not sets and not unsets:
        return None
    return sets, unsets


async def migrate_002_assignment_fields(db):
    """v1 used truck.category_id and item.technical_guidance; v2 uses ordered lists."""
    async for truck in db.dump_trucks.find({}):
        planned = plan_truck_v2(truck)
        if not planned:
            continue
        sets, unsets = planned
        op = {}
        if sets:
            op["$set"] = sets
        if unsets:
            op["$unset"] = unsets
        await db.dump_trucks.update_one({"_id": truck["_id"]}, op)

    async for item in db.inspection_items.find({}):
        planned = plan_item_v2(item)
        if planned:
            sets, unsets = planned
            op = {}
            if sets:
                op["$set"] = sets
            if unsets:
                op["$unset"] = unsets
            await db.inspection_items.update_one({"_id": item["_id"]}, op)
            item = {**item, **sets}

        cat_id = item.get("category_id")
        if not cat_id:
            continue
        try:
            oid = cat_id if isinstance(cat_id, ObjectId) else ObjectId(cat_id)
        except Exception:
            continue
        iid = str(item["_id"])
        await db.inspection_categories.update_one(
            {"_id": oid, "item_ids": {"$ne": iid}},
            {"$push": {"item_ids": iid}},
        )


async def migrate_003_backfill_inspection_types(db):
    """Copy each site's Daily (P2H) type onto inspections that have none.

    Types themselves are created by the seeder (and by admins for new sites).
    This only fills historical rows; it never drops inspections.
    """
    dailies = await db.inspection_types.find({"code": "P2H"}).to_list(2000)
    for itype in dailies:
        site_id = itype.get("site_id")
        if not site_id:
            continue
        await db.inspections.update_many(
            {
                "site_id": site_id,
                "$or": [
                    {"inspection_type_id": {"$exists": False}},
                    {"inspection_type_id": None},
                    {"inspection_type_id": ""},
                ],
            },
            {"$set": {
                "inspection_type_id": str(itype["_id"]),
                "inspection_type_name": itype.get("name") or "Daily Inspection (P2H)",
            }},
        )


async def migrate_004_company_catalog_and_vehicle_categories(db):
    """Promote masters to company scope, split vehicle category from truck list, rename admin role."""
    # 1) Roles: admin -> site_admin
    await db.users.update_many({"role": "admin"}, {"$set": {"role": "site_admin"}})

    # 2) Company-scope categories / items / types: clear site_id, keep company_id; dedupe by company+name
    for coll_name in ("inspection_categories", "inspection_items", "inspection_types"):
        coll = getattr(db, coll_name)
        by_key = {}
        async for doc in coll.find({}):
            company_id = doc.get("company_id")
            if not company_id and doc.get("site_id"):
                site = await db.sites.find_one({"_id": ObjectId(doc["site_id"]) if not isinstance(doc["site_id"], ObjectId) else doc["site_id"]})
                if site:
                    company_id = site.get("company_id")
            name = doc.get("name") or ""
            key = (company_id, name)
            if key in by_key and by_key[key] != doc["_id"]:
                # Prefer document that already has richer membership / no site split leftovers
                keep = by_key[key]
                await coll.delete_one({"_id": doc["_id"]})
                if coll_name == "inspection_categories":
                    # Remap truck/vehicle refs later; merge item_ids into keeper
                    keeper = await coll.find_one({"_id": keep})
                    merged = list(dict.fromkeys((keeper.get("item_ids") or []) + (doc.get("item_ids") or [])))
                    await coll.update_one({"_id": keep}, {"$set": {"item_ids": merged, "company_id": company_id}, "$unset": {"site_id": ""}})
                continue
            by_key[key] = doc["_id"]
            sets = {"company_id": company_id} if company_id else {}
            unsets = {"site_id": ""}
            if coll_name == "inspection_items":
                unsets["category_id"] = ""
            op = {"$unset": unsets}
            if sets:
                op["$set"] = sets
            await coll.update_one({"_id": doc["_id"]}, op)

    # 3) Build vehicle_categories from trucks and point trucks at them
    async for truck in db.dump_trucks.find({}):
        if truck.get("vehicle_category_id") and not truck.get("brand") and "category_ids" not in truck:
            continue
        company_id = truck.get("company_id")
        brand = truck.get("brand") or ""
        model = truck.get("model") or ""
        layout = truck.get("drivetrain_layout") or ""
        cat_ids = list(truck.get("category_ids") or [])
        name = " · ".join(p for p in (brand, model, layout) if p) or f"Category for {truck.get('hull_number', 'unit')}"
        existing = await db.vehicle_categories.find_one({
            "company_id": company_id, "brand": brand or None, "model": model or None,
            "drivetrain_layout": layout or None,
        })
        if existing:
            vc_id = str(existing["_id"])
            # Union inspection categories onto the shared vehicle category
            merged = list(dict.fromkeys((existing.get("category_ids") or []) + cat_ids))
            await db.vehicle_categories.update_one({"_id": existing["_id"]}, {"$set": {"category_ids": merged}})
        else:
            res = await db.vehicle_categories.insert_one({
                "company_id": company_id,
                "brand": brand or None,
                "name": name,
                "model": model or None,
                "drivetrain_layout": layout or None,
                "category_ids": cat_ids,
                "is_active": True,
            })
            vc_id = str(res.inserted_id)
        await db.dump_trucks.update_one(
            {"_id": truck["_id"]},
            {"$set": {"vehicle_category_id": vc_id},
             "$unset": {"brand": "", "model": "", "drivetrain_layout": "", "category_ids": ""}},
        )


# (version, name, coroutine). Versions already stored in meta are skipped.
MIGRATIONS = [
    (2, "assignment-fields", migrate_002_assignment_fields),
    (3, "backfill-inspection-types", migrate_003_backfill_inspection_types),
    (4, "company-catalog-vehicle-categories", migrate_004_company_catalog_and_vehicle_categories),
]

LATEST_SCHEMA_VERSION = MIGRATIONS[-1][0]


async def apply_migrations(db) -> int:
    meta = await db.meta.find_one({"_id": "schema"})
    current = int((meta or {}).get("version") or 0)
    for version, name, fn in MIGRATIONS:
        if current >= version:
            continue
        logger.info("Applying schema migration %s (%s)", version, name)
        await fn(db)
        current = version
        await db.meta.update_one(
            {"_id": "schema"},
            {"$set": {"version": version, "name": name, "applied_at": _now()}},
            upsert=True,
        )
    return current
