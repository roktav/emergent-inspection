import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Download, CheckCircle2, AlertTriangle, Minus } from "lucide-react";
import { useT } from "../lib/i18n";
import { api, downloadCsv, errMsg } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { SiteSelect, useSiteScope } from "./MasterPages";

const iso = (d) => d.toISOString().slice(0, 10);
const dayLabel = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function Cell({ cell }) {
  if (!cell) return <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground"><Minus className="h-3.5 w-3.5" /></span>;
  const defect = cell.status === "defect";
  const inner = (
    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${defect ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`} title={defect ? `${cell.defects} defects` : "OK"}>
      {defect ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
    </span>
  );
  return <Link to={`/inspections/${cell.inspection_id}`} className="transition-transform hover:scale-110">{inner}</Link>;
}

export default function RecapPage() {
  const { t } = useT();
  const { sites, siteId, setSiteId, needsSitePicker } = useSiteScope();
  const [from, setFrom] = useState(iso(new Date(Date.now() - 13 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const params = { site_id: needsSitePicker ? siteId : undefined, date_from: from, date_to: to };

  useEffect(() => {
    if (needsSitePicker && !siteId) return;
    setLoading(true);
    api.get("/recap", { params }).then((r) => setData(r.data)).catch((e) => toast.error(errMsg(e))).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsSitePicker, siteId, from, to]);

  const exportCsv = (kind) => downloadCsv("/recap/export", { ...params, kind }, `recap_${kind}_${from}_${to}.csv`).catch((e) => toast.error(errMsg(e)));

  const totals = data ? data.trucks.reduce((a, tr) => ({ ins: a.ins + tr.total_inspections, def: a.def + tr.defects_found, pend: a.pend + tr.pending }), { ins: 0, def: 0, pend: 0 }) : null;

  return (
    <div className="fade-up space-y-5" data-testid="recap-page">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight lg:text-3xl">{t("recap")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("matrix")} · {t("summary")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-white p-3 shadow-sm">
        {needsSitePicker && <SiteSelect value={siteId} onChange={setSiteId} sites={sites} testId="recap-site-select" />}
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" data-testid="recap-from" />
        <span className="text-muted-foreground">—</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" data-testid="recap-to" />
        {totals && (
          <div className="ml-auto flex gap-4 text-xs text-muted-foreground" data-testid="recap-totals">
            <span><b className="text-foreground">{totals.ins}</b> {t("total_inspections").toLowerCase()}</span>
            <span><b className="text-red-700">{totals.def}</b> {t("defects_found").toLowerCase()}</span>
            <span><b className="text-amber-700">{totals.pend}</b> {t("pending").toLowerCase()}</span>
          </div>
        )}
      </div>

      <Tabs defaultValue="matrix">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList className="bg-white">
            <TabsTrigger value="matrix" data-testid="recap-tab-matrix">{t("matrix")}</TabsTrigger>
            <TabsTrigger value="summary" data-testid="recap-tab-summary">{t("summary")}</TabsTrigger>
          </TabsList>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => exportCsv("matrix")} data-testid="recap-export-matrix-btn"><Download className="mr-1 h-4 w-4" /> {t("export_matrix")}</Button>
            <Button variant="outline" size="sm" onClick={() => exportCsv("summary")} data-testid="recap-export-summary-btn"><Download className="mr-1 h-4 w-4" /> {t("export_summary")}</Button>
          </div>
        </div>

        <TabsContent value="matrix" className="mt-4">
          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="max-h-[65vh] overflow-auto">
              <table className="recap-table w-full text-sm" data-testid="recap-matrix-table">
                <thead>
                  <tr className="border-b">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">{t("unit")}</th>
                    {(data?.dates || []).map((d) => <th key={d} className="px-1.5 py-3 text-center text-[11px] font-semibold text-muted-foreground">{dayLabel(d)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={99} className="py-10 text-center text-muted-foreground">{t("loading")}</td></tr>}
                  {!loading && data?.trucks.length === 0 && <tr><td colSpan={99} className="py-10 text-center text-muted-foreground">{t("no_data")}</td></tr>}
                  {!loading && data?.trucks.map((tr) => (
                    <tr key={tr.id} className="border-b last:border-0 hover:bg-brand-bg/50" data-testid={`recap-row-${tr.hull_number}`}>
                      <td className="px-4 py-2 font-semibold">{tr.hull_number} <span className="ml-1 font-mono text-[10px] font-normal text-muted-foreground">{tr.unit_vin_number}</span></td>
                      {data.dates.map((d) => <td key={d} className="px-1.5 py-2 text-center"><Cell cell={tr.cells[d]} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-4 border-t px-4 py-3 text-xs text-muted-foreground" data-testid="recap-legend">
              <span className="font-semibold uppercase tracking-wide">{t("legend")}:</span>
              <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-green-700" /> {t("inspected_ok")}</span>
              <span className="flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5 text-red-700" /> {t("has_defects")}</span>
              <span className="flex items-center gap-1"><Minus className="h-3.5 w-3.5" /> {t("not_inspected")}</span>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="summary" className="mt-4">
          <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="overflow-x-auto">
              <Table data-testid="recap-summary-table">
                <TableHeader>
                  <TableRow className="bg-muted/60">
                    {["hull_number", "vin", "brand", "model", "drivetrain_layout", "total_inspections", "days_inspected", "defects_found", "defect_inspections", "approved", "pending", "last_inspection", "last_km_hm"].map((h) => (
                      <TableHead key={h} className="text-xs font-semibold uppercase tracking-wide">{t(h)}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.trucks.map((tr) => (
                    <TableRow key={tr.id} data-testid={`summary-row-${tr.hull_number}`}>
                      <TableCell className="font-semibold">{tr.hull_number}</TableCell>
                      <TableCell className="font-mono text-xs">{tr.unit_vin_number || "—"}</TableCell>
                      <TableCell>{tr.brand || "—"}</TableCell>
                      <TableCell>{tr.model || "—"}</TableCell>
                      <TableCell>{tr.drivetrain_layout || "—"}</TableCell>
                      <TableCell>{tr.total_inspections}</TableCell>
                      <TableCell>{tr.inspected_days} / {data.dates.length}</TableCell>
                      <TableCell><span className={tr.defects_found ? "font-semibold text-red-700" : ""}>{tr.defects_found}</span></TableCell>
                      <TableCell>{tr.defect_inspections}</TableCell>
                      <TableCell className="text-emerald-700">{tr.approved}</TableCell>
                      <TableCell className="text-amber-700">{tr.pending}</TableCell>
                      <TableCell>{tr.last_inspection || "—"}</TableCell>
                      <TableCell>{tr.last_km_hm ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
