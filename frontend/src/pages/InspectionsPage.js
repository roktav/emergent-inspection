import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Eye, PlusCircle } from "lucide-react";
import { toast } from "sonner";
import { useT } from "../lib/i18n";
import { api, downloadCsv, errMsg } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { ApprovalBadge } from "../components/StatusPill";
import { useLookup } from "../components/MasterPage";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { SiteSelect, useSiteScope } from "./MasterPages";

const iso = (d) => d.toISOString().slice(0, 10);
const ALL = "all";

export default function InspectionsPage() {
  const { t } = useT();
  const { user } = useAuth();
  const { isSuper, sites, siteId, setSiteId } = useSiteScope();
  const isAdmin = user?.role === "admin" || isSuper;
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState(ALL);
  const [truckId, setTruckId] = useState(ALL);
  const [driverId, setDriverId] = useState(ALL);
  const [typeId, setTypeId] = useState(ALL);
  const [from, setFrom] = useState(iso(new Date(Date.now() - 13 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const trucks = useLookup(`/trucks${isSuper && siteId ? `?site_id=${siteId}` : ""}`, !isSuper || !!siteId);
  const types = useLookup(`/inspection-types${isSuper && siteId ? `?site_id=${siteId}` : ""}`, !isSuper || !!siteId);
  const people = useLookup(`/users${isSuper && siteId ? `?site_id=${siteId}` : ""}`, isAdmin && (!isSuper || !!siteId));
  const drivers = useMemo(
    () => people.filter((p) => p.role === "driver" || p.role === "admin"),
    [people],
  );

  useEffect(() => {
    setTruckId(ALL);
    setDriverId(ALL);
    setTypeId(ALL);
  }, [siteId]);

  const params = useMemo(() => ({
    site_id: isSuper ? siteId : undefined,
    status: status === ALL ? undefined : status,
    truck_id: truckId === ALL ? undefined : truckId,
    driver_id: driverId === ALL ? undefined : driverId,
    inspection_type_id: typeId === ALL ? undefined : typeId,
    date_from: from,
    date_to: to,
  }), [isSuper, siteId, status, truckId, driverId, typeId, from, to]);

  useEffect(() => {
    if (isSuper && !siteId) return;
    setLoading(true);
    api.get("/inspections", { params }).then((r) => setRows(r.data)).finally(() => setLoading(false));
  }, [isSuper, siteId, params]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadCsv("/inspections/export", params, `inspections_${from}_${to}.csv`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fade-up space-y-5" data-testid="inspections-page">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight lg:text-3xl">{t("inspections")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{rows.length} {t("items")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="rounded-full" onClick={exportCsv} disabled={exporting || (isSuper && !siteId)} data-testid="inspections-export-btn">
            <Download className="mr-1 h-4 w-4" /> {t("export_csv")}
          </Button>
          <Button asChild className="rounded-full" data-testid="inspections-new-btn">
            <Link to="/inspections/new"><PlusCircle className="mr-1 h-4 w-4" /> {t("new_inspection")}</Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-white p-3 shadow-sm">
        {isSuper && (
          <label className="grid gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("site")}</span>
            <SiteSelect value={siteId} onChange={setSiteId} sites={sites} testId="inspections-site-select" />
          </label>
        )}
        <label className="grid gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("unit")}</span>
          <Select value={truckId} onValueChange={setTruckId}>
            <SelectTrigger className="w-52 bg-white" data-testid="inspections-unit-filter"><SelectValue placeholder={t("select_truck")} /></SelectTrigger>
            <SelectContent className="bg-white">
              <SelectItem value={ALL} data-testid="inspections-unit-filter-opt-all">{t("all")}</SelectItem>
              {trucks.map((tr) => (
                <SelectItem key={tr.id} value={tr.id} data-testid={`inspections-unit-filter-opt-${tr.hull_number}`}>
                  {tr.hull_number}{tr.brand ? ` · ${tr.brand}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("inspection_type")}</span>
          <Select value={typeId} onValueChange={setTypeId}>
            <SelectTrigger className="w-56 bg-white" data-testid="inspections-type-filter"><SelectValue placeholder={t("select_inspection_type")} /></SelectTrigger>
            <SelectContent className="bg-white">
              <SelectItem value={ALL} data-testid="inspections-type-filter-opt-all">{t("all")}</SelectItem>
              {types.map((tp) => (
                <SelectItem key={tp.id} value={tp.id} data-testid={`inspections-type-filter-opt-${tp.code || tp.id}`}>
                  {tp.code ? `${tp.code} · ${tp.name}` : tp.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("inspection_time")}</span>
          <div className="flex items-center gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40 bg-white" data-testid="inspections-from" />
            <span className="text-muted-foreground">—</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40 bg-white" data-testid="inspections-to" />
          </div>
        </label>
        {isAdmin && (
          <label className="grid gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("driver_name")}</span>
            <Select value={driverId} onValueChange={setDriverId}>
              <SelectTrigger className="w-52 bg-white" data-testid="inspections-driver-filter"><SelectValue placeholder={t("select_driver")} /></SelectTrigger>
              <SelectContent className="bg-white">
                <SelectItem value={ALL} data-testid="inspections-driver-filter-opt-all">{t("all")}</SelectItem>
                {drivers.map((d) => (
                  <SelectItem key={d.id} value={d.id} data-testid={`inspections-driver-filter-opt-${d.id}`}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )}
        <label className="grid gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("status")}</span>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40 bg-white" data-testid="inspections-status-filter"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-white">
              <SelectItem value={ALL}>{t("all")}</SelectItem>
              <SelectItem value="submitted">{t("submitted")}</SelectItem>
              <SelectItem value="approved">{t("approved")}</SelectItem>
              <SelectItem value="rejected">{t("rejected")}</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60">
                {["date", "unit", "inspection_type", "driver_name", "km_hm", "checked", "defects", "status", "approved_by", ""].map((h, i) => (
                  <TableHead key={i} className="text-xs font-semibold uppercase tracking-wide">{h ? t(h) : ""}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={10} className="py-10 text-center text-muted-foreground">{t("loading")}</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="py-10 text-center text-muted-foreground" data-testid="inspections-empty">{t("no_data")}</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id} data-testid={`inspection-row-${r.id}`} className="hover:bg-brand-bg/60">
                  <TableCell className="text-sm">{r.inspection_date}</TableCell>
                  <TableCell className="text-sm font-semibold">{r.truck_hull_number} <span className="font-mono text-xs font-normal text-muted-foreground">{r.truck_vin_number}</span></TableCell>
                  <TableCell className="text-sm" data-testid={`inspection-type-${r.id}`}>{r.inspection_type_name || "—"}</TableCell>
                  <TableCell className="text-sm">{r.driver_name}</TableCell>
                  <TableCell className="text-sm">{r.km_hm}</TableCell>
                  <TableCell className="text-sm">{r.total_items}</TableCell>
                  <TableCell className="text-sm">
                    {r.has_defect ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">{r.defect_count}</span> : <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">0</span>}
                  </TableCell>
                  <TableCell><ApprovalBadge status={r.status} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.approved_by_name || "—"}</TableCell>
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
      </div>
    </div>
  );
}
