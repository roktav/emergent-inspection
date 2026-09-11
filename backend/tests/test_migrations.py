"""Unit tests for additive schema migrations. No live API required."""
import asyncio
import copy
import sys
from pathlib import Path
from types import SimpleNamespace

from bson import ObjectId

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from migrations import (
    LATEST_SCHEMA_VERSION,
    apply_migrations,
    plan_item_v2,
    plan_truck_v2,
)


def test_truck_v2_maps_legacy_fields():
    planned = plan_truck_v2({
        "unit_number": "DT-009",
        "vin": "VIN9",
        "category_id": "cat-a",
    })
    assert planned is not None
    sets, unsets = planned
    assert sets["hull_number"] == "DT-009"
    assert sets["unit_vin_number"] == "VIN9"
    assert sets["category_ids"] == ["cat-a"]
    assert "category_id" in unsets
    assert "unit_number" in unsets
    assert "vin" in unsets


def test_truck_v2_keeps_existing_category_ids():
    planned = plan_truck_v2({
        "hull_number": "DT-001",
        "unit_vin_number": "VIN1",
        "category_id": "cat-a",
        "category_ids": ["cat-b"],
    })
    sets, unsets = planned
    assert sets["category_ids"] == ["cat-a", "cat-b"]
    assert "category_id" in unsets
    assert "hull_number" not in sets


def test_truck_already_v2_is_noop():
    assert plan_truck_v2({
        "hull_number": "DT-001",
        "unit_vin_number": "VIN1",
        "category_ids": ["cat-a"],
    }) is None


def test_item_v2_maps_guidance():
    sets, unsets = plan_item_v2({"technical_guidance": "Retak"})
    assert sets["guidance"] == "Retak"
    assert "technical_guidance" in unsets


def test_item_already_v2_is_noop():
    assert plan_item_v2({"guidance": "Retak"}) is None


class _Cursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        self._it = iter(self._docs)
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration

    async def to_list(self, n):
        return self._docs[:n]


def _match(query, doc):
    if not query:
        return True
    if "$or" in query:
        rest = {k: v for k, v in query.items() if k != "$or"}
        if rest and not _match(rest, doc):
            return False
        return any(_match(branch, doc) for branch in query["$or"])
    for key, expected in query.items():
        actual = doc.get(key, _MISSING)
        if isinstance(expected, dict):
            if "$exists" in expected:
                exists = actual is not _MISSING
                if exists != expected["$exists"]:
                    return False
            if "$ne" in expected:
                ne = expected["$ne"]
                if actual is _MISSING:
                    pass
                elif isinstance(actual, list):
                    if ne in actual:
                        return False
                elif actual == ne:
                    return False
            if "$in" in expected:
                if actual not in expected["$in"]:
                    return False
        elif actual != expected:
            return False
    return True


_MISSING = object()


def _apply(doc, upd):
    out = copy.deepcopy(doc)
    for k, v in (upd.get("$set") or {}).items():
        out[k] = v
    for k in (upd.get("$unset") or {}):
        out.pop(k, None)
    if "$push" in upd:
        for k, v in upd["$push"].items():
            out.setdefault(k, [])
            out[k].append(v)
    return out


class MemCol:
    def __init__(self, docs=None):
        self.docs = [copy.deepcopy(d) for d in (docs or [])]
        self.delete_many_calls = 0

    async def find_one(self, q, *a, **k):
        for d in self.docs:
            if _match(q, d):
                return copy.deepcopy(d)
        return None

    async def insert_one(self, doc):
        d = copy.deepcopy(doc)
        if "_id" not in d:
            d["_id"] = ObjectId()
        self.docs.append(d)
        return SimpleNamespace(inserted_id=d["_id"])

    async def delete_one(self, q):
        for i, d in enumerate(self.docs):
            if _match(q, d):
                self.docs.pop(i)
                return
        return None

    async def update_one(self, q, upd, upsert=False):
        for i, d in enumerate(self.docs):
            if _match(q, d):
                self.docs[i] = _apply(d, upd)
                return
        if upsert:
            base = {k: v for k, v in q.items() if not str(k).startswith("$")}
            self.docs.append(_apply(base, upd))

    async def update_many(self, q, upd):
        for i, d in enumerate(self.docs):
            if _match(q, d):
                self.docs[i] = _apply(d, upd)

    async def delete_many(self, q):
        self.delete_many_calls += 1
        self.docs = [d for d in self.docs if not _match(q, d)]

    def find(self, q=None):
        q = q or {}
        return _Cursor([copy.deepcopy(d) for d in self.docs if _match(q, d)])


def test_apply_migrations_is_additive_from_v1():
    truck_id = ObjectId()
    cat_id = ObjectId()
    item_id = ObjectId()
    insp_id = ObjectId()
    type_id = ObjectId()
    site_id = ObjectId()
    company_id = "co-1"
    db = SimpleNamespace(
        meta=MemCol([{"_id": "schema", "version": 1}]),
        users=MemCol([{"_id": ObjectId(), "email": "a@x.com", "role": "admin", "site_id": str(site_id)}]),
        sites=MemCol([{"_id": site_id, "company_id": company_id, "code": "IMIP", "name": "IMIP"}]),
        dump_trucks=MemCol([{
            "_id": truck_id,
            "company_id": company_id,
            "site_id": str(site_id),
            "hull_number": "DT-001",
            "brand": "BYD",
            "model": "T8",
            "drivetrain_layout": "6x4",
            "category_id": str(cat_id),
        }]),
        inspection_items=MemCol([{
            "_id": item_id,
            "name": "Front Spring Hanger",
            "company_id": company_id,
            "site_id": str(site_id),
            "category_id": str(cat_id),
            "technical_guidance": "Retak",
        }]),
        inspection_categories=MemCol([{
            "_id": cat_id,
            "name": "Chassis Inspection",
            "company_id": company_id,
            "site_id": str(site_id),
            "item_ids": [],
        }]),
        vehicle_categories=MemCol([]),
        inspections=MemCol([{
            "_id": insp_id,
            "site_id": str(site_id),
            "truck_hull_number": "DT-001",
            "inspection_type_id": None,
        }]),
        inspection_types=MemCol([{
            "_id": type_id,
            "site_id": str(site_id),
            "company_id": company_id,
            "code": "P2H",
            "name": "Daily Inspection (P2H)",
        }]),
    )

    version = asyncio.run(apply_migrations(db))

    assert version == LATEST_SCHEMA_VERSION
    assert db.dump_trucks.delete_many_calls == 0
    assert db.inspections.delete_many_calls == 0
    assert len(db.dump_trucks.docs) == 1
    assert len(db.inspections.docs) == 1
    truck = db.dump_trucks.docs[0]
    assert "category_id" not in truck
    assert "category_ids" not in truck
    assert truck.get("vehicle_category_id")
    assert "brand" not in truck
    assert len(db.vehicle_categories.docs) == 1
    vc = db.vehicle_categories.docs[0]
    assert str(cat_id) in vc["category_ids"]
    assert db.users.docs[0]["role"] == "site_admin"
    item = db.inspection_items.docs[0]
    assert item["guidance"] == "Retak"
    assert "category_id" not in item
    assert "site_id" not in item
    assert str(item_id) in db.inspection_categories.docs[0]["item_ids"]
    assert "site_id" not in db.inspection_categories.docs[0]
    insp = db.inspections.docs[0]
    assert insp["inspection_type_id"] == str(type_id)
    assert db.meta.docs[0]["version"] == LATEST_SCHEMA_VERSION


def test_apply_migrations_skips_when_already_latest():
    db = SimpleNamespace(
        meta=MemCol([{"_id": "schema", "version": LATEST_SCHEMA_VERSION}]),
        dump_trucks=MemCol([{"_id": ObjectId(), "hull_number": "KEEP"}]),
        inspection_items=MemCol([]),
        inspection_categories=MemCol([]),
        vehicle_categories=MemCol([]),
        users=MemCol([]),
        sites=MemCol([]),
        inspections=MemCol([{"_id": ObjectId(), "site_id": "s"}]),
        inspection_types=MemCol([]),
    )
    asyncio.run(apply_migrations(db))
    assert db.dump_trucks.docs[0]["hull_number"] == "KEEP"
    assert len(db.inspections.docs) == 1
