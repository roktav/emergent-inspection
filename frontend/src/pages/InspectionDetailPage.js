import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, XCircle, Clock, Gauge, User, ShieldCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useT } from "../lib/i18n";
import { api, errMsg, fileUrl } from "../lib/api";
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
  const [showAll, setShowAll] = useState(false);

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
  const shown = showAll ? insp.results : defects;
  const canApprove = user.role !== "driver";

  return (
    <div className="fade-up mx-auto max-w-3xl space-y-5" data-testid="inspection-detail-page">
      <Link to="/inspections" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="detail-back-link"><ArrowLeft className="h-4 w-4" /> {t("back")}</Link>

      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-deep">{t("inspection_detail")}</p>
            <h1 className="mt-1 font-heading text-3xl font-semibold tracking-tight" data-testid="detail-unit">{insp.truck_unit_number} <span className="text-base font-medium text-muted-foreground">{insp.truck_type}</span></h1>
            <p className="text-sm text-muted-foreground">{insp.inspection_date}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <ApprovalBadge status={insp.status} testId="detail-approval-status" />
            {insp.has_defect ? <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700" data-testid="detail-defect-count">{insp.defect_count} {t("defects")}</span> : <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700" data-testid="detail-defect-count">{t("no_defects")}</span>}
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Info icon={Gauge} label={t("km_hm")} value={insp.km_hm} testId="detail-kmhm" />
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

      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="font-heading text-base font-semibold md:text-lg">{showAll ? `${t("checked")} (${insp.results.length})` : `${t("defect_summary")} (${defects.length})`}</h2>
          <Button variant="ghost" size="sm" onClick={() => setShowAll((s) => !s)} data-testid="toggle-all-items-btn">{showAll ? t("defect_summary") : t("view_all")}</Button>
        </div>
        <ul className="divide-y">
          {shown.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted-foreground">{t("no_defects")}</li>}
          {shown.map((r, i) => (
            <li key={r.item_id + i} className="px-5 py-3" data-testid={`result-${r.item_id}`}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium">{r.item_name}</p>
                <StatusBadge code={r.status} />
              </div>
              {r.note && <p className="mt-1 text-sm text-muted-foreground">{r.note}</p>}
              {r.photos?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.photos.map((p) => (
                    <a key={p} href={fileUrl(p)} target="_blank" rel="noreferrer" className="block h-20 w-20 overflow-hidden rounded-lg border">
                      <img src={fileUrl(p)} alt="finding" className="h-full w-full object-cover" />
                    </a>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
