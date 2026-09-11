import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, XCircle, Clock, Gauge, User, ShieldCheck, Tag } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useT } from "../lib/i18n";
import { api, errMsg } from "../lib/api";
import { AuthImage } from "../components/AuthImage";
import { ApprovalBadge, StatusBadge } from "../components/StatusPill";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";

const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : "—");
const minutes = (a, b) => (a && b ? Math.max(1, Math.round((new Date(b) - new Date(a)) / 60000)) : null);

function Info({ icon: Icon, label, value, testId }) {
  return (
    <div className="rounded-xl bg-brand-bg p-3">
      <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><Icon className="h-3 w-3" /> {label}</p>
      <p className="mt-1 text-sm font-semibold" data-testid={testId}>{value ?? "—"}</p>
    </div>
  );
}

export default function InspectionDetailPage() {
  const { id } = useParams();
  const { t } = useT();
  const { user } = useAuth();
  const [insp, setInsp] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/inspections/${id}`).then((r) => setInsp(r.data)).catch((e) => toast.error(errMsg(e)));
  }, [id]);

  const decide = async (decision) => {
    setBusy(true);
    try {
      const { data } = await api.post(`/inspections/${id}/approval`, { decision, admin_note: note || null });
      setInsp(data);
      toast.success(t("approval_saved"));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (!insp) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  const defects = insp.results.filter((r) => r.status !== "OK");
  const canApprove = ["superadmin", "company_admin", "site_admin"].includes(user.role);

  return (
    <div className="fade-up mx-auto max-w-3xl space-y-5" data-testid="inspection-detail-page">
      <Link to="/inspections" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="detail-back-link"><ArrowLeft className="h-4 w-4" /> {t("back")}</Link>

      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-deep">{t("inspection_detail")}</p>
            <h1 className="mt-1 font-heading text-3xl font-semibold tracking-tight" data-testid="detail-unit">{insp.truck_hull_number} <span className="font-mono text-sm font-medium text-muted-foreground">{insp.truck_vin_number}</span></h1>
            <p className="text-sm text-muted-foreground">{insp.inspection_date}{insp.inspection_type_name && <> · <span className="font-semibold text-foreground" data-testid="detail-inspection-type">{insp.inspection_type_name}</span></>}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <ApprovalBadge status={insp.status} testId="detail-approval-status" />
            {insp.has_defect ? <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700" data-testid="detail-defect-count">{insp.defect_count} {t("defects")}</span> : <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700" data-testid="detail-defect-count">{t("no_defects")}</span>}
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Info icon={Gauge} label={t("km_hm")} value={insp.km_hm} testId="detail-kmhm" />
          <Info icon={Tag} label={t("inspection_type")} value={insp.inspection_type_name} testId="detail-type" />
          <Info icon={User} label={t("driver_name")} value={insp.driver_name} testId="detail-driver" />
          <Info icon={Clock} label={t("started_at")} value={fmt(insp.started_at)} testId="detail-started" />
          <Info icon={Clock} label={t("completed_at")} value={`${fmt(insp.completed_at)} · ${minutes(insp.started_at, insp.completed_at)} ${t("min")}`} testId="detail-completed" />
          <Info icon={ShieldCheck} label={t("approval_admin")} value={insp.approved_by_name || t("pending")} testId="detail-approver" />
          <Info icon={Clock} label={t("approval")} value={fmt(insp.approved_at)} testId="detail-approved-at" />
          <Info icon={CheckCircle2} label={t("checked")} value={`${insp.total_items} ${t("items")}`} />
        </div>
        {insp.general_note && <p className="mt-4 rounded-xl border-l-4 border-brand bg-brand-bg/60 p-3 text-sm"><b>{t("general_note")}:</b> {insp.general_note}</p>}
        {insp.admin_note && <p className="mt-2 rounded-xl border-l-4 border-amber-400 bg-amber-50 p-3 text-sm" data-testid="detail-admin-note"><b>{t("admin_note")}:</b> {insp.admin_note}</p>}
      </div>

      {canApprove && insp.status === "submitted" && (
        <div className="rounded-2xl border border-brand bg-white p-5 shadow-sm" data-testid="approval-card">
          <h2 className="font-heading text-base font-semibold md:text-lg">{t("approval")}</h2>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("admin_note_placeholder")} rows={2} className="mt-3" data-testid="approval-note" />
          <div className="mt-3 flex gap-2">
            <Button onClick={() => decide("approved")} disabled={busy} className="rounded-full bg-emerald-600 hover:bg-emerald-700" data-testid="approve-btn"><CheckCircle2 className="mr-1 h-4 w-4" /> {t("approve")}</Button>
            <Button onClick={() => decide("rejected")} disabled={busy} variant="outline" className="rounded-full border-red-300 text-red-700 hover:bg-red-50" data-testid="reject-btn"><XCircle className="mr-1 h-4 w-4" /> {t("reject")}</Button>
          </div>
        </div>
      )}

      {insp.photos_purged_at && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" data-testid="photos-purged-notice">{t("photos_purged")}</p>
      )}

      <ResultTable title={`${t("defect_items")} (${defects.length})`} rows={defects} emptyText={t("no_defects")} testId="defect-table" withIndex={false} />
      <ResultTable title={`${t("all_items")} (${insp.results.length})`} rows={insp.results} testId="all-items-table" withIndex />
    </div>
  );
}

function ResultTable({ title, rows, emptyText, testId, withIndex }) {
  const { t } = useT();
  return (
    <div className="rounded-2xl border bg-white shadow-sm" data-testid={testId}>
      <div className="border-b px-5 py-4">
        <h2 className="font-heading text-base font-semibold md:text-lg">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/60 text-left text-xs font-semibold uppercase tracking-wide">
              {withIndex && <th className="w-12 px-4 py-2">#</th>}
              <th className="px-4 py-2">{t("name")}</th>
              <th className="px-4 py-2">{t("status")}</th>
              <th className="px-4 py-2">{t("findings_note")}</th>
              <th className="px-4 py-2">{t("photos")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">{emptyText || t("no_data")}</td></tr>}
            {rows.map((r, i) => (
              <tr key={r.item_id + i} className="border-t align-top" data-testid={`${testId}-row-${r.item_id}`}>
                {withIndex && <td className="px-4 py-2 text-muted-foreground">{i + 1}</td>}
                <td className="px-4 py-2 font-medium">{r.item_name}{r.category_name && <span className="block text-xs font-normal text-muted-foreground">{r.category_name}</span>}</td>
                <td className="px-4 py-2"><StatusBadge code={r.status} /></td>
                <td className="px-4 py-2 text-muted-foreground">{r.note || "—"}</td>
                <td className="px-4 py-2">
                  {r.photos?.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {r.photos.map((p) => (
                        <AuthImage key={p} path={p} alt="finding" openable className="h-12 w-12 object-cover" />
                      ))}
                    </div>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
