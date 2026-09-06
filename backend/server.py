from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import csv
import io
import logging
import os
import uuid
from datetime import datetime, timezone, timedelta, date
from typing import Annotated, List, Literal, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field
from starlette.middleware.cors import CORSMiddleware

from auth import (check_lockout, clear_failures, create_access_token, get_current_user, hash_password,
                  record_failure, require_roles, verify_password)
from database import client, db
from seed import seed_all
from storage import APP_NAME, get_object, init_storage, put_object

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="DT Inspection API")
api_router = APIRouter(prefix="/api")

ADMIN_ROLES = ("admin", "superadmin")
ALL_ROLES = ("admin", "superadmin", "driver")


# ---------- Models ----------
def _oid_to_str(v):
    return str(v) if isinstance(v, ObjectId) else v


PyObjectId = Annotated[str, BeforeValidator(_oid_to_str)]


class BaseDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    id: Optional[PyObjectId] = Field(default=None, alias="_id")

    def to_mongo(self) -> dict:
        d = self.model_dump(by_alias=True, exclude_none=True)
        d.pop("_id", None)
        return d

    @classmethod
    def from_mongo(cls, doc: dict):
        return cls.model_validate(doc)

    def out(self) -> dict:
        return self.model_dump()


class Company(BaseDocument):
    name: str
    code: str
    address: Optional[str] = None
    is_active: bool = True


class Site(BaseDocument):
    company_id: str
    name: str
    code: str
    location: Optional[str] = None
    is_active: bool = True


class User(BaseDocument):
    email: str
    name: str
    role: Literal["superadmin", "admin", "driver"]
    company_id: Optional[str] = None
    site_id: Optional[str] = None
    is_active: bool = True


class UserIn(BaseModel):
    email: str
    name: str
    role: Literal["superadmin", "admin", "driver"] = "driver"
    company_id: Optional[str] = None
    site_id: Optional[str] = None
    password: Optional[str] = None
    is_active: bool = True


class DumpTruck(BaseDocument):
    company_id: Optional[str] = None
    site_id: Optional[str] = None
    unit_number: str
    hull_number: Optional[str] = None
    plate_number: Optional[str] = None
    truck_type: Literal["ICE", "EV"] = "ICE"
    brand: Optional[str] = None
    model: Optional[str] = None
    is_active: bool = True


class InspectionCategory(BaseDocument):
    company_id: Optional[str] = None
    site_id: Optional[str] = None
    name: str
    description: Optional[str] = None
    order: int = 0
    is_active: bool = True


class InspectionItem(BaseDocument):
    company_id: Optional[str] = None
    site_id: Optional[str] = None
    category_id: str
    order: int = 0
    name: str
    guidance: Optional[str] = None
    status_options: List[str] = ["OK", "NOT_OK", "KOROSI"]
    ev_only: bool = False
    is_active: bool = True


class ItemResult(BaseModel):
    item_id: str
    item_name: str
    category_name: Optional[str] = None
    status: str
    note: Optional[str] = None
    photos: List[str] = []


class InspectionCreate(BaseModel):
    truck_id: str
    km_hm: float
    started_at: datetime
    inspection_date: Optional[str] = None
    general_note: Optional[str] = None
    results: List[ItemResult]


class Inspection(BaseDocument):
    company_id: Optional[str] = None
    site_id: str
    truck_id: str
    truck_unit_number: str
    truck_type: str
    driver_id: str
    driver_name: str
    km_hm: float
    started_at: str
    completed_at: str
    inspection_date: str
    results: List[ItemResult]
    total_items: int
    defect_count: int
    has_defect: bool
    status: Literal["submitted", "approved", "rejected"] = "submitted"
    approved_by: Optional[str] = None
    approved_by_name: Optional[str] = None
    approved_at: Optional[str] = None
    admin_note: Optional[str] = None
    general_note: Optional[str] = None


class ApprovalIn(BaseModel):
    decision: Literal["approved", "rejected"]
    admin_note: Optional[str] = None


class LoginIn(BaseModel):
    email: str
    password: str


# ---------- Helpers ----------
def oid(id_: str) -> ObjectId:
    try:
        return ObjectId(id_)
    except Exception:
        raise HTTPException(status_code=404, detail="Not found")


async def find_or_404(coll: str, id_: str, flt: Optional[dict] = None) -> dict:
    q = {"_id": oid(id_), **(flt or {})}
    doc = await db[coll].find_one(q)
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    return doc


async def list_out(coll: str, Model, flt: dict, sort=("name", 1)) -> List[dict]:
    docs = await db[coll].find(flt).sort([sort]).to_list(2000)
    return [Model.from_mongo(d).out() for d in docs]


def scope_filter(user: dict, site_id: Optional[str] = None) -> dict:
    if user["role"] == "superadmin":
        return {"site_id": site_id} if site_id else {}
    return {"site_id": user["site_id"]}


async def enforce_scope(user: dict, data: dict) -> dict:
    if user["role"] != "superadmin":
        data["site_id"] = user["site_id"]
        data["company_id"] = user["company_id"]
        return data
    if not data.get("site_id"):
        raise HTTPException(status_code=400, detail="site_id is required")
    site = await find_or_404("sites", data["site_id"])
    data["company_id"] = site["company_id"]
    return data


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- Auth ----------
@api_router.post("/auth/login")
async def login(body: LoginIn, request: Request):
    email = body.email.lower().strip()
    identifier = f"{request.client.host if request.client else 'x'}:{email}"
    await check_lockout(identifier)
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        await record_failure(identifier)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Account is inactive")
    await clear_failures(identifier)
    token = create_access_token(str(user["_id"]), email, user["role"])
    return {"access_token": token, "token_type": "bearer", "user": User.from_mongo(user).out()}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    out = {k: v for k, v in user.items() if k != "created_at"}
    if user.get("site_id"):
        site = await db.sites.find_one({"_id": oid(user["site_id"])})
        out["site_name"] = site["name"] if site else None
    if user.get("company_id"):
        comp = await db.companies.find_one({"_id": oid(user["company_id"])})
        out["company_name"] = comp["name"] if comp else None
    return out


@api_router.post("/auth/logout")
async def logout():
    return {"ok": True}


# ---------- Companies (superadmin) ----------
@api_router.get("/companies")
async def list_companies(user: dict = Depends(require_roles(*ALL_ROLES))):
    flt = {} if user["role"] == "superadmin" else {"_id": oid(user["company_id"])}
    return await list_out("companies", Company, flt)


@api_router.post("/companies")
async def create_company(body: Company, user: dict = Depends(require_roles("superadmin"))):
    res = await db.companies.insert_one(body.to_mongo())
    return Company.from_mongo(await db.companies.find_one({"_id": res.inserted_id})).out()


@api_router.put("/companies/{id_}")
async def update_company(id_: str, body: Company, user: dict = Depends(require_roles("superadmin"))):
    await find_or_404("companies", id_)
    await db.companies.update_one({"_id": oid(id_)}, {"$set": body.to_mongo()})
    return Company.from_mongo(await db.companies.find_one({"_id": oid(id_)})).out()


@api_router.delete("/companies/{id_}")
async def delete_company(id_: str, user: dict = Depends(require_roles("superadmin"))):
    if await db.sites.count_documents({"company_id": id_}):
        raise HTTPException(status_code=400, detail="Company has sites; remove them first")
    await db.companies.delete_one({"_id": oid(id_)})
    return {"ok": True}


# ---------- Sites ----------
@api_router.get("/sites")
async def list_sites(user: dict = Depends(require_roles(*ALL_ROLES))):
    flt = {} if user["role"] == "superadmin" else {"_id": oid(user["site_id"])}
    return await list_out("sites", Site, flt)


@api_router.post("/sites")
async def create_site(body: Site, user: dict = Depends(require_roles("superadmin"))):
    await find_or_404("companies", body.company_id)
    res = await db.sites.insert_one(body.to_mongo())
    return Site.from_mongo(await db.sites.find_one({"_id": res.inserted_id})).out()


@api_router.put("/sites/{id_}")
async def update_site(id_: str, body: Site, user: dict = Depends(require_roles("superadmin"))):
    await find_or_404("sites", id_)
    await db.sites.update_one({"_id": oid(id_)}, {"$set": body.to_mongo()})
    return Site.from_mongo(await db.sites.find_one({"_id": oid(id_)})).out()


@api_router.delete("/sites/{id_}")
async def delete_site(id_: str, user: dict = Depends(require_roles("superadmin"))):
    if await db.dump_trucks.count_documents({"site_id": id_}) or await db.users.count_documents({"site_id": id_}):
        raise HTTPException(status_code=400, detail="Site has trucks or users assigned")
    await db.sites.delete_one({"_id": oid(id_)})
    return {"ok": True}


# ---------- Users ----------
@api_router.get("/users")
async def list_users(site_id: Optional[str] = None, user: dict = Depends(require_roles(*ADMIN_ROLES))):
    return await list_out("users", User, scope_filter(user, site_id))


async def _user_payload(body: UserIn, user: dict, creating: bool) -> dict:
    data = body.model_dump(exclude={"password"})
    data["email"] = data["email"].lower().strip()
    if user["role"] == "admin":
        if data["role"] != "driver":
            raise HTTPException(status_code=403, detail="Admin can only manage drivers")
        data["site_id"], data["company_id"] = user["site_id"], user["company_id"]
    elif data["role"] != "superadmin":
        if not data.get("site_id"):
            raise HTTPException(status_code=400, detail="site_id is required for admin/driver")
        site = await find_or_404("sites", data["site_id"])
        data["company_id"] = site["company_id"]
    if body.password:
        if len(body.password) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
        data["password_hash"] = hash_password(body.password)
    elif creating:
        raise HTTPException(status_code=400, detail="Password is required")
    return data


@api_router.post("/users")
async def create_user(body: UserIn, user: dict = Depends(require_roles(*ADMIN_ROLES))):
    data = await _user_payload(body, user, True)
    if await db.users.find_one({"email": data["email"]}):
        raise HTTPException(status_code=400, detail="Email already registered")
    data["created_at"] = now_iso()
    res = await db.users.insert_one(data)
    return User.from_mongo(await db.users.find_one({"_id": res.inserted_id})).out()


@api_router.put("/users/{id_}")
async def update_user(id_: str, body: UserIn, user: dict = Depends(require_roles(*ADMIN_ROLES))):
    existing = await find_or_404("users", id_, scope_filter(user))
    if user["role"] == "admin" and existing["role"] != "driver":
        raise HTTPException(status_code=403, detail="Admin can only manage drivers")
    data = await _user_payload(body, user, False)
    dup = await db.users.find_one({"email": data["email"], "_id": {"$ne": oid(id_)}})
    if dup:
        raise HTTPException(status_code=400, detail="Email already registered")
    await db.users.update_one({"_id": oid(id_)}, {"$set": data})
    return User.from_mongo(await db.users.find_one({"_id": oid(id_)})).out()


@api_router.delete("/users/{id_}")
async def delete_user(id_: str, user: dict = Depends(require_roles(*ADMIN_ROLES))):
    if id_ == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    existing = await find_or_404("users", id_, scope_filter(user))
    if user["role"] == "admin" and existing["role"] != "driver":
        raise HTTPException(status_code=403, detail="Admin can only manage drivers")
    await db.users.delete_one({"_id": oid(id_)})
    return {"ok": True}


# ---------- Generic site-scoped masters (trucks, categories, items) ----------
def register_master(path: str, coll: str, Model, sort_key: str):
    @api_router.get(f"/{path}")
    async def _list(site_id: Optional[str] = None, user: dict = Depends(require_roles(*ALL_ROLES))):
        return await list_out(coll, Model, scope_filter(user, site_id), (sort_key, 1))

    @api_router.post(f"/{path}")
    async def _create(body: Model, user: dict = Depends(require_roles(*ADMIN_ROLES))):
        data = await enforce_scope(user, body.to_mongo())
        res = await db[coll].insert_one(data)
        return Model.from_mongo(await db[coll].find_one({"_id": res.inserted_id})).out()

    @api_router.put(f"/{path}/{{id_}}")
    async def _update(id_: str, body: Model, user: dict = Depends(require_roles(*ADMIN_ROLES))):
        await find_or_404(coll, id_, scope_filter(user))
        data = await enforce_scope(user, body.to_mongo())
        await db[coll].update_one({"_id": oid(id_)}, {"$set": data})
        return Model.from_mongo(await db[coll].find_one({"_id": oid(id_)})).out()

    @api_router.delete(f"/{path}/{{id_}}")
    async def _delete(id_: str, user: dict = Depends(require_roles(*ADMIN_ROLES))):
        await find_or_404(coll, id_, scope_filter(user))
        if coll == "inspection_categories" and await db.inspection_items.count_documents({"category_id": id_}):
            raise HTTPException(status_code=400, detail="Category still has items")
        await db[coll].delete_one({"_id": oid(id_)})
        return {"ok": True}


register_master("trucks", "dump_trucks", DumpTruck, "unit_number")
register_master("categories", "inspection_categories", InspectionCategory, "order")
register_master("items", "inspection_items", InspectionItem, "order")


# ---------- Inspections ----------
@api_router.get("/inspections/checklist")
async def checklist(truck_id: str, user: dict = Depends(require_roles(*ALL_ROLES))):
    truck = await find_or_404("dump_trucks", truck_id, scope_filter(user))
    flt = {"site_id": truck["site_id"], "is_active": True}
    if truck["truck_type"] != "EV":
        flt["ev_only"] = False
    cats = await db.inspection_categories.find({"site_id": truck["site_id"], "is_active": True}).sort("order", 1).to_list(200)
    items = await db.inspection_items.find(flt).sort("order", 1).to_list(1000)
    groups = []
    for c in cats:
        cid = str(c["_id"])
        its = [InspectionItem.from_mongo(i).out() for i in items if i["category_id"] == cid]
        if its:
            groups.append({"category": InspectionCategory.from_mongo(c).out(), "items": its})
    return {"truck": DumpTruck.from_mongo(truck).out(), "groups": groups}


@api_router.post("/inspections")
async def create_inspection(body: InspectionCreate, user: dict = Depends(require_roles(*ALL_ROLES))):
    truck = await find_or_404("dump_trucks", body.truck_id, scope_filter(user))
    if not body.results:
        raise HTTPException(status_code=400, detail="No inspection results")
    completed = datetime.now(timezone.utc)
    defects = sum(1 for r in body.results if r.status != "OK")
    insp = Inspection(
        company_id=truck.get("company_id"), site_id=truck["site_id"], truck_id=body.truck_id,
        truck_unit_number=truck["unit_number"], truck_type=truck["truck_type"], driver_id=user["id"],
        driver_name=user["name"], km_hm=body.km_hm, started_at=body.started_at.astimezone(timezone.utc).isoformat(),
        completed_at=completed.isoformat(), inspection_date=body.inspection_date or completed.date().isoformat(),
        results=body.results, total_items=len(body.results), defect_count=defects, has_defect=defects > 0,
        general_note=body.general_note,
    )
    res = await db.inspections.insert_one(insp.to_mongo())
    return Inspection.from_mongo(await db.inspections.find_one({"_id": res.inserted_id})).out()


@api_router.get("/inspections")
async def list_inspections(
    site_id: Optional[str] = None, truck_id: Optional[str] = None, status: Optional[str] = None,
    date_from: Optional[str] = None, date_to: Optional[str] = None, limit: int = 200,
    user: dict = Depends(require_roles(*ALL_ROLES)),
):
    flt = scope_filter(user, site_id)
    if user["role"] == "driver":
        flt["driver_id"] = user["id"]
    if truck_id:
        flt["truck_id"] = truck_id
    if status:
        flt["status"] = status
    if date_from or date_to:
        flt["inspection_date"] = {k: v for k, v in (("$gte", date_from), ("$lte", date_to)) if v}
    docs = await db.inspections.find(flt, {"results": 0}).sort("completed_at", -1).to_list(limit)
    out = []
    for d in docs:
        d["results"] = []
        o = Inspection.from_mongo(d).out()
        o.pop("results")
        out.append(o)
    return out


@api_router.get("/inspections/{id_}")
async def get_inspection(id_: str, user: dict = Depends(require_roles(*ALL_ROLES))):
    flt = scope_filter(user)
    if user["role"] == "driver":
        flt["driver_id"] = user["id"]
    return Inspection.from_mongo(await find_or_404("inspections", id_, flt)).out()


@api_router.post("/inspections/{id_}/approval")
async def approve_inspection(id_: str, body: ApprovalIn, user: dict = Depends(require_roles(*ADMIN_ROLES))):
    await find_or_404("inspections", id_, scope_filter(user))
    await db.inspections.update_one({"_id": oid(id_)}, {"$set": {
        "status": body.decision, "approved_by": user["id"], "approved_by_name": user["name"],
        "approved_at": now_iso(), "admin_note": body.admin_note}})
    return Inspection.from_mongo(await db.inspections.find_one({"_id": oid(id_)})).out()


# ---------- Dashboard ----------
@api_router.get("/dashboard")
async def dashboard(site_id: Optional[str] = None, user: dict = Depends(require_roles(*ALL_ROLES))):
    flt = scope_filter(user, site_id)
    today = date.today().isoformat()
    insp_flt = dict(flt)
    if user["role"] == "driver":
        insp_flt["driver_id"] = user["id"]
    trucks = await db.dump_trucks.count_documents({**flt, "is_active": True})
    today_ins = await db.inspections.count_documents({**insp_flt, "inspection_date": today})
    today_def = await db.inspections.count_documents({**insp_flt, "inspection_date": today, "has_defect": True})
    pending = await db.inspections.count_documents({**insp_flt, "status": "submitted"})
    recent = await db.inspections.find(insp_flt, {"results": 0}).sort("completed_at", -1).to_list(8)
    for r in recent:
        r["id"] = str(r.pop("_id"))
    return {"trucks": trucks, "today_inspections": today_ins, "today_defects": today_def, "pending_approval": pending,
            "recent": recent}


# ---------- Recap ----------
async def build_recap(user: dict, site_id: Optional[str], date_from: str, date_to: str) -> dict:
    flt = scope_filter(user, site_id)
    if not flt:
        raise HTTPException(status_code=400, detail="site_id is required")
    d0, d1 = date.fromisoformat(date_from), date.fromisoformat(date_to)
    if d1 < d0 or (d1 - d0).days > 92:
        raise HTTPException(status_code=400, detail="Invalid date range (max 92 days)")
    dates = [(d0 + timedelta(days=i)).isoformat() for i in range((d1 - d0).days + 1)]
    trucks = await db.dump_trucks.find(flt).sort("unit_number", 1).to_list(1000)
    insps = await db.inspections.find(
        {**flt, "inspection_date": {"$gte": date_from, "$lte": date_to}},
        {"results": 0}).sort("completed_at", 1).to_list(20000)
    by_truck: dict = {}
    for i in insps:
        by_truck.setdefault(i["truck_id"], []).append(i)
    rows = []
    for t in trucks:
        tid = str(t["_id"])
        cells = {}
        for i in by_truck.get(tid, []):
            c = cells.setdefault(i["inspection_date"], {"status": "ok", "count": 0, "inspection_id": None, "defects": 0})
            c["count"] += 1
            c["defects"] += i["defect_count"]
            c["inspection_id"] = str(i["_id"])
            if i["has_defect"]:
                c["status"] = "defect"
        all_i = by_truck.get(tid, [])
        rows.append({
            "id": tid, "unit_number": t["unit_number"], "hull_number": t.get("hull_number"),
            "truck_type": t["truck_type"], "cells": cells,
            "total_inspections": len(all_i), "inspected_days": len(cells),
            "defects_found": sum(i["defect_count"] for i in all_i),
            "defect_inspections": sum(1 for i in all_i if i["has_defect"]),
            "approved": sum(1 for i in all_i if i["status"] == "approved"),
            "pending": sum(1 for i in all_i if i["status"] == "submitted"),
            "last_inspection": max((i["inspection_date"] for i in all_i), default=None),
            "last_km_hm": all_i[-1]["km_hm"] if all_i else None,
        })
    return {"dates": dates, "trucks": rows, "date_from": date_from, "date_to": date_to}


@api_router.get("/recap")
async def recap(site_id: Optional[str] = None, date_from: str = Query(...), date_to: str = Query(...),
                user: dict = Depends(require_roles(*ADMIN_ROLES))):
    return await build_recap(user, site_id, date_from, date_to)


@api_router.get("/recap/export")
async def recap_export(kind: Literal["matrix", "summary"] = "matrix", site_id: Optional[str] = None,
                       date_from: str = Query(...), date_to: str = Query(...),
                       user: dict = Depends(require_roles(*ADMIN_ROLES))):
    data = await build_recap(user, site_id, date_from, date_to)
    buf = io.StringIO()
    w = csv.writer(buf)
    if kind == "matrix":
        w.writerow(["Unit Number", "Type", *data["dates"]])
        for t in data["trucks"]:
            w.writerow([t["unit_number"], t["truck_type"],
                        *[{"ok": "OK", "defect": "DEFECT"}.get(t["cells"].get(d, {}).get("status"), "-") for d in data["dates"]]])
    else:
        w.writerow(["Unit Number", "Hull Number", "Type", "Total Inspections", "Days Inspected", "Defects Found",
                    "Inspections With Defects", "Approved", "Pending", "Last Inspection", "Last KM/HM"])
        for t in data["trucks"]:
            w.writerow([t["unit_number"], t["hull_number"] or "", t["truck_type"], t["total_inspections"],
                        t["inspected_days"], t["defects_found"], t["defect_inspections"], t["approved"], t["pending"],
                        t["last_inspection"] or "", t["last_km_hm"] or ""])
    buf.seek(0)
    fname = f"recap_{kind}_{date_from}_{date_to}.csv"
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})


# ---------- Files ----------
@api_router.post("/uploads")
async def upload(file: UploadFile = File(...), user: dict = Depends(require_roles(*ALL_ROLES))):
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")
    data = await file.read()
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 8MB)")
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "jpg"
    path = f"{APP_NAME}/uploads/{user['id']}/{uuid.uuid4()}.{ext}"
    try:
        result = put_object(path, data, file.content_type)
    except Exception as e:
        logger.error(f"Upload failed: {e}")
        raise HTTPException(status_code=502, detail="Storage upload failed")
    await db.files.insert_one({"storage_path": result["path"], "original_filename": file.filename,
                               "content_type": file.content_type, "size": result["size"], "uploaded_by": user["id"],
                               "is_deleted": False, "created_at": now_iso()})
    return {"path": result["path"], "size": result["size"]}


@api_router.get("/files/{path:path}")
async def download(path: str, user: dict = Depends(get_current_user)):
    rec = await db.files.find_one({"storage_path": path, "is_deleted": False})
    if not rec:
        raise HTTPException(status_code=404, detail="File not found")
    try:
        data, ctype = get_object(path)
    except Exception as e:
        logger.error(f"Download failed: {e}")
        raise HTTPException(status_code=502, detail="Storage download failed")
    return Response(content=data, media_type=rec.get("content_type") or ctype,
                    headers={"Cache-Control": "private, max-age=3600"})


@api_router.get("/")
async def root():
    return {"message": "DT Inspection API", "status": "ok"}


app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    await seed_all()
    try:
        init_storage()
        logger.info("Storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
