import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, PlusCircle, Play, Trash2 } from "lucide-react";
import { useT } from "../lib/i18n";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { deleteDraft, listDrafts } from "../lib/inspectionDrafts";
import { useOffline } from "../lib/offline/OfflineContext";
import { ApprovalBadge } from "../components/StatusPill";
import { useLookup } from "../components/MasterPage";
import { formatRange, ListPager, PAGE_SIZE, totalFromHeader, useClientPager } from "../components/ListPager";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";

const iso = (d) => d.toISOString().slice(0, 10);
const ALL = "all";

function DraftRow({ d, truckById, typeById, t, onRemove }) {
  const truck = truckById[d.truck_id];
  const type = typeById[d.type_id];
  const resultList = Object.values(d.results || {});
  const defectCount = resultList.filter((r) => r.status && r.status !== "OK").length;
  return (
    <TableRow key={d.id} data-testid={`draft-row-${d.id}`} className="hover:bg-brand-bg/60">
      <TableCell className="text-sm">{d.saved_at ? d.saved_at.slice(0, 10) : "—"}</TableCell>
      <TableCell className="text-sm font-semibold">{truck?.hull_number || "—"}</TableCell>
      <TableCell className="text-sm">{type?.name || "—"}</TableCell>
      <TableCell className="text-sm">{d.km_hm || "—"}</TableCell>
      <TableCell className="text-sm">{resultList.length || "—"}</TableCell>
      <TableCell className="text-sm">
        {defectCount ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">{defectCount}</span> : <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">0</span>}
      </TableCell>
      <TableCell><ApprovalBadge status="draft" /></TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button asChild variant="ghost" size="sm" data-testid={`draft-continue-${d.id}`}>
            <Link to={`/inspections/new?draft=${d.id}`}><Play className="mr-1 h-4 w-4" /> {t("continue_draft")}</Link>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onRemove(d.id)} data-testid={`draft-delete-${d.id}`}>
            <Trash2 className="mr-1 h-4 w-4" /> {t("delete_draft")}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function QueuedRow({ row, truckById, typeById, t }) {
  const p = row.payload || {};
  const truck = truckById[p.truck_id];
  const type = typeById[p.inspection_type_id];
  const resultList = p.results || [];
  const defectCount = resultList.filter((r) => r.status && r.status !== "OK").length;
  const date = (p.inspection_date || row.createdAt || "").slice(0, 10) || "—";
  return (
    <TableRow data-testid={`queued-row-${row.id}`} className="hover:bg-brand-bg/60">
      <TableCell className="text-sm">{date}</TableCell>
      <TableCell className="text-sm font-semibold">{truck?.hull_number || "—"}</TableCell>
      <TableCell className="text-sm">{type?.name || "—"}</TableCell>
      <TableCell className="text-sm">{p.km_hm ?? "—"}</TableCell>
      <TableCell className="text-sm">{resultList.length || "—"}</TableCell>
      <TableCell className="text-sm">
        {defectCount ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">{defectCount}</span> : <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">0</span>}
      </TableCell>
      <TableCell>
        <ApprovalBadge status="queued" />
        {row.error && <p className="mt-1 max-w-[14rem] text-[11px] text-red-700">{row.error}</p>}
      </TableCell>
      <TableCell className="text-right text-xs text-muted-foreground">{t("pending_sync")}</TableCell>
    </TableRow>
  );
}

export default function MyInspectionsPage() {
  const { t } = useT();
  const { user } = useAuth();
  const { pending, snapshot, lastSyncedAt } = useOffline();
  const userId = user?.id || (user?._id != null ? String(user._id) : undefined);
  const [serverRows, setServerRows] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [status, setStatus] = useState(ALL);
  const [truckId, setTruckId] = useState(ALL);
  const [typeId, setTypeId] = useState(ALL);
  const [from, setFrom] = useState(iso(new Date(Date.now() - 89 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const trucksApi = useLookup("/trucks", true);
  const typesApi = useLookup("/inspection-types", true);
  const trucks = trucksApi.length ? trucksApi : (snapshot?.trucks || []);
  const types = typesApi.length ? typesApi : (snapshot?.inspection_types || []);
  const truckById = useMemo(() => Object.fromEntries(trucks.map((tr) => [tr.id, tr])), [trucks]);
  const typeById = useMemo(() => Object.fromEntries(types.map((tp) => [tp.id, tp])), [types]);

  const reloadDrafts = () => setDrafts(listDrafts(userId));

  useEffect(() => {
    reloadDrafts();
  }, [userId]);

  const params = useMemo(() => ({
    status: status === ALL || status === "draft" || status === "queued" ? undefined : status,
    truck_id: truckId === ALL ? undefined : truckId,
    inspection_type_id: typeId === ALL ? undefined : typeId,
    date_from: from,
    date_to: to,
  }), [status, truckId, typeId, from, to]);

  const paramsKey = JSON.stringify(params);
  useEffect(() => { setPage(1); }, [paramsKey, status]);

  useEffect(() => {
    if (status === "draft" || status === "queued") {
      setServerRows([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    api.get("/inspections", { params: { ...params, skip: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE } })
      .then((r) => {
        setServerRows(r.data);
        setTotal(totalFromHeader(r, r.data.length));
      })
      .finally(() => setLoading(false));
  }, [params, status, page, lastSyncedAt]);

  const filteredDrafts = drafts.filter((d) => {
    if (status !== ALL && status !== "draft") return false;
    if (truckId !== ALL && d.truck_id !== truckId) return false;
    if (typeId !== ALL && d.type_id !== typeId) return false;
    return true;
  });

  const filteredQueued = (pending || []).filter((row) => {
    if (status !== ALL && status !== "queued") return false;
    const p = row.payload || {};
    if (truckId !== ALL && p.truck_id !== truckId) return false;
    if (typeId !== ALL && p.inspection_type_id !== typeId) return false;
    return true;
  });

  const draftPager = useClientPager(filteredDrafts, { resetKey: `${status}|${truckId}|${typeId}` });
  const draftRows = status === "draft" ? draftPager.slice : filteredDrafts;

  const removeDraft = (id) => {
    deleteDraft(userId, id);
    reloadDrafts();
  };

  const headerCount = status === "draft"
    ? formatRange(t, draftPager.page, draftPager.pageSize, draftPager.total)
    : status === "queued"
      ? `${filteredQueued.length} ${t("queued")}`
      : `${formatRange(t, page, PAGE_SIZE, total)}${filteredDrafts.length ? ` · ${filteredDrafts.length} ${t("draft")}` : ""}${filteredQueued.length ? ` · ${filteredQueued.length} ${t("queued")}` : ""}`;

  const tableHeads = ["date", "unit", "inspection_type", "km_hm", "checked", "defects", "status", ""];

  return (
    <div className="fade-up space-y-5" data-testid="my-inspections-page">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight lg:text-3xl">{t("my_inspections")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{headerCount}</p>
        </div>
        <Button asChild className="rounded-full" data-testid="my-inspections-new-btn">
          <Link to="/inspections/new"><PlusCircle className="mr-1 h-4 w-4" /> {t("new_inspection")}</Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-white p-3 shadow-sm">
        <label className="grid gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("unit")}</span>
          <Select value={truckId} onValueChange={setTruckId}>
            <SelectTrigger className="w-52 bg-white" data-testid="my-inspections-unit-filter"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-white">
              <SelectItem value={ALL}>{t("all")}</SelectItem>
              {trucks.map((tr) => (
                <SelectItem key={tr.id} value={tr.id}>{tr.hull_number}{tr.brand ? ` · ${tr.brand}` : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("inspection_type")}</span>
          <Select value={typeId} onValueChange={setTypeId}>
            <SelectTrigger className="w-56 bg-white" data-testid="my-inspections-type-filter"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-white">
              <SelectItem value={ALL}>{t("all")}</SelectItem>
              {types.map((tp) => (
                <SelectItem key={tp.id} value={tp.id}>{tp.code ? `${tp.code} · ${tp.name}` : tp.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("inspection_time")}</span>
          <div className="flex items-center gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40 bg-white" data-testid="my-inspections-from" />
            <span className="text-muted-foreground">—</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40 bg-white" data-testid="my-inspections-to" />
          </div>
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("status")}</span>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40 bg-white" data-testid="my-inspections-status-filter"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-white">
              <SelectItem value={ALL}>{t("all")}</SelectItem>
              <SelectItem value="queued">{t("queued")}</SelectItem>
              <SelectItem value="draft">{t("draft")}</SelectItem>
              <SelectItem value="submitted">{t("submitted")}</SelectItem>
              <SelectItem value="approved">{t("approved")}</SelectItem>
              <SelectItem value="rejected">{t("rejected")}</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>

      {status !== "draft" && status !== "queued" && filteredDrafts.length > 0 && (
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-4 py-3 text-sm font-semibold">{t("drafts_on_device")}</div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60">
                  {tableHeads.map((h, i) => (
                    <TableHead key={i} className="text-xs font-semibold uppercase tracking-wide">{h ? t(h) : ""}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDrafts.map((d) => (
                  <DraftRow key={d.id} d={d} truckById={truckById} typeById={typeById} t={t} onRemove={removeDraft} />
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {status === ALL && filteredQueued.length > 0 && (
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm" data-testid="queued-inspections">
          <div className="border-b px-4 py-3 text-sm font-semibold">{t("queued")}</div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60">
                  {tableHeads.map((h, i) => (
                    <TableHead key={i} className="text-xs font-semibold uppercase tracking-wide">{h ? t(h) : ""}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredQueued.map((row) => (
                  <QueuedRow key={row.id} row={row} truckById={truckById} typeById={typeById} t={t} />
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60">
                {tableHeads.map((h, i) => (
                  <TableHead key={i} className="text-xs font-semibold uppercase tracking-wide">{h ? t(h) : ""}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {status === "draft" && draftRows.map((d) => (
                <DraftRow key={d.id} d={d} truckById={truckById} typeById={typeById} t={t} onRemove={removeDraft} />
              ))}
              {status === "queued" && filteredQueued.map((row) => (
                <QueuedRow key={row.id} row={row} truckById={truckById} typeById={typeById} t={t} />
              ))}
              {loading ? (
                <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">{t("loading")}</TableCell></TableRow>
              ) : (status === "draft" ? draftPager.total === 0 : status === "queued" ? filteredQueued.length === 0 : total === 0 && filteredDrafts.length === 0 && filteredQueued.length === 0) ? (
                <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground" data-testid="my-inspections-empty">{t("no_data")}</TableCell></TableRow>
              ) : null}
              {!loading && status !== "draft" && status !== "queued" && serverRows.map((r) => (
                <TableRow key={r.id} data-testid={`inspection-row-${r.id}`} className="hover:bg-brand-bg/60">
                  <TableCell className="text-sm">{r.inspection_date}</TableCell>
                  <TableCell className="text-sm font-semibold">{r.truck_hull_number} <span className="font-mono text-xs font-normal text-muted-foreground">{r.truck_vin_number}</span></TableCell>
                  <TableCell className="text-sm">{r.inspection_type_name || "—"}</TableCell>
                  <TableCell className="text-sm">{r.km_hm}</TableCell>
                  <TableCell className="text-sm">{r.total_items}</TableCell>
                  <TableCell className="text-sm">
                    {r.has_defect ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">{r.defect_count}</span> : <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">0</span>}
                  </TableCell>
                  <TableCell><ApprovalBadge status={r.status} /></TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm" data-testid={`inspection-view-${r.id}`}>
                      <Link to={`/inspections/${r.id}`}><Eye className="mr-1 h-4 w-4" /> {t("view")}</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {status === "draft" ? (
          <ListPager page={draftPager.page} pageSize={draftPager.pageSize} total={draftPager.total} onPageChange={draftPager.setPage} testId="my-inspections-drafts-pager" />
        ) : status === "queued" ? null : (
          <ListPager page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} testId="my-inspections-pager" />
        )}
      </div>
    </div>
  );
}
