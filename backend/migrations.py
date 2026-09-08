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


# (version, name, coroutine). Versions already stored in meta are skipped.
MIGRATIONS = [
    (2, "assignment-fields", migrate_002_assignment_fields),
    (3, "backfill-inspection-types", migrate_003_backfill_inspection_types),
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
