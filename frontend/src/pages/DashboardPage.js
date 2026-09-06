import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Truck, ClipboardCheck, AlertTriangle, Clock, ArrowRight, PlusCircle } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useT } from "../lib/i18n";
import { api } from "../lib/api";
import { ApprovalBadge } from "../components/StatusPill";
import { Button } from "../components/ui/button";

function Stat({ icon: Icon, label, value, tone, testId }) {
  return (
    <div className={`rounded-2xl border bg-white p-5 shadow-sm ${tone}`} data-testid={testId}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-brand-deep" />
      </div>
      <p className="mt-3 font-heading text-3xl font-semibold tracking-tight">{value ?? "—"}</p>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { t } = useT();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/dashboard").then((r) => setData(r.data)).catch(() => setData({}));
  }, []);

  return (
    <div className="fade-up space-y-8" data-testid="dashboard-page">
      <div className="brand-panel relative overflow-hidden rounded-3xl p-6 text-brand-dark lg:p-10">
        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-heading text-xs font-semibold uppercase tracking-[0.25em] text-brand-dark/70">{t("welcome")}</p>
            <h1 className="mt-2 font-heading text-3xl font-semibold tracking-tight lg:text-4xl" data-testid="dashboard-welcome">{user.name}</h1>
            <p className="mt-2 max-w-lg text-sm text-brand-dark/80">{user.site_name ? `${user.company_name} · ${user.site_name}` : t("tagline")}</p>
          </div>
          <Button asChild size="lg" className="rounded-full bg-brand-dark text-white hover:bg-brand-dark/90" data-testid="dashboard-start-inspection-btn">
            <Link to="/inspections/new"><PlusCircle className="mr-2 h-5 w-5" /> {t("start_inspection")}</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={Truck} label={t("total_trucks")} value={data?.trucks} testId="stat-trucks" />
        <Stat icon={ClipboardCheck} label={t("today_inspections")} value={data?.today_inspections} testId="stat-today" />
        <Stat icon={AlertTriangle} label={t("defects_today")} value={data?.today_defects} tone={data?.today_defects ? "border-red-200" : ""} testId="stat-defects" />
        <Stat icon={Clock} label={t("pending_approval")} value={data?.pending_approval} testId="stat-pending" />
      </div>

      <section className="rounded-2xl border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="font-heading text-base font-semibold md:text-lg">{t("recent_inspections")}</h2>
          <Link to="/inspections" className="flex items-center gap-1 text-sm font-medium text-brand-deep hover:underline" data-testid="dashboard-view-all-link">
            {t("view_all")} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <ul className="divide-y">
          {(data?.recent || []).length === 0 && <li className="px-5 py-8 text-center text-sm text-muted-foreground">{t("no_data")}</li>}
          {(data?.recent || []).map((i) => (
            <li key={i.id}>
              <Link to={`/inspections/${i.id}`} className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-brand-bg/60" data-testid={`recent-inspection-${i.id}`}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{i.truck_hull_number} <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">{i.truck_vin_number}</span></p>
                  <p className="truncate text-xs text-muted-foreground">{i.inspection_date} · {i.driver_name} · {i.km_hm} KM/HM</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {i.has_defect ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">{i.defect_count} {t("defects")}</span> : <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">OK</span>}
                  <ApprovalBadge status={i.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
