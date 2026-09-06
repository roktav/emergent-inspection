import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, PlusCircle } from "lucide-react";
import { useT } from "../lib/i18n";
import { api } from "../lib/api";
import { ApprovalBadge } from "../components/StatusPill";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { SiteSelect, useSiteScope } from "./MasterPages";

const iso = (d) => d.toISOString().slice(0, 10);

export default function InspectionsPage() {
  const { t } = useT();
  const { isSuper, sites, siteId, setSiteId } = useSiteScope();
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState(iso(new Date(Date.now() - 13 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isSuper && !siteId) return;
    setLoading(true);
    api
      .get("/inspections", { params: { site_id: isSuper ? siteId : undefined, status: status === "all" ? undefined : status, date_from: from, date_to: to } })
      .then((r) => setRows(r.data))
      .finally(() => setLoading(false));
  }, [isSuper, siteId, status, from, to]);

  return (
    <div className="fade-up space-y-5" data-testid="inspections-page">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight lg:text-3xl">{t("inspections")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{rows.length} {t("items")}</p>
        </div>
        <Button asChild className="rounded-full" data-testid="inspections-new-btn">
          <Link to="/inspections/new"><PlusCircle className="mr-1 h-4 w-4" /> {t("new_inspection")}</Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-white p-3 shadow-sm">
        {isSuper && <SiteSelect value={siteId} onChange={setSiteId} sites={sites} testId="inspections-site-select" />}
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" data-testid="inspections-from" />
        <span className="text-muted-foreground">—</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" data-testid="inspections-to" />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40" data-testid="inspections-status-filter"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-white">
            <SelectItem value="all">{t("all")}</SelectItem>
            <SelectItem value="submitted">{t("submitted")}</SelectItem>
            <SelectItem value="approved">{t("approved")}</SelectItem>
            <SelectItem value="rejected">{t("rejected")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60">
                {["date", "unit", "driver_name", "km_hm", "checked", "defects", "status", "approved_by", ""].map((h, i) => (
                  <TableHead key={i} className="text-xs font-semibold uppercase tracking-wide">{h ? t(h) : ""}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={9} className="py-10 text-center text-muted-foreground">{t("loading")}</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="py-10 text-center text-muted-foreground" data-testid="inspections-empty">{t("no_data")}</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id} data-testid={`inspection-row-${r.id}`} className="hover:bg-brand-bg/60">
                  <TableCell className="text-sm">{r.inspection_date}</TableCell>
                  <TableCell className="text-sm font-semibold">{r.truck_unit_number} <span className="text-xs font-normal text-muted-foreground">{r.truck_type}</span></TableCell>
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
