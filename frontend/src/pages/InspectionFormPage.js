import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Camera, X, Gauge, Clock, CheckCircle2, AlertTriangle } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useT } from "../lib/i18n";
import { api, errMsg } from "../lib/api";
import { AuthImage } from "../components/AuthImage";
import { StatusPill } from "../components/StatusPill";
import { CameraCapture } from "../components/CameraCapture";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { SiteSelect, useSiteScope } from "./MasterPages";

const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function PhotoUploader({ photos, onChange, testId }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const upload = async (blob) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", blob, "photo.jpg");
      const { data } = await api.post("/uploads", fd, { headers: { "Content-Type": "multipart/form-data" } });
      onChange([...photos, data.path]);
    } catch (err) {
      toast.error(errMsg(err));
      throw err;
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {photos.map((p) => (
        <div key={p} className="relative h-16 w-16 overflow-hidden rounded-lg border">
          <AuthImage path={p} alt="finding" className="h-full w-full object-cover" />
          <button type="button" onClick={() => onChange(photos.filter((x) => x !== p))} className="absolute right-0.5 top-0.5 rounded-full bg-white/90 p-0.5" data-testid={`${testId}-remove`}>
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => setOpen(true)} disabled={busy} data-testid={`${testId}-add`}
        className="flex h-16 min-w-[64px] items-center justify-center gap-1 rounded-lg border-2 border-dashed border-brand px-2 text-xs font-medium text-brand-deep transition-colors hover:bg-brand-bg">
        <Camera className="h-4 w-4" /> {busy ? t("uploading") : t("take_photo")}
      </button>
      <CameraCapture open={open} onClose={() => setOpen(false)} onCapture={upload} testId={testId} />
    </div>
  );
}

function ItemCard({ item, index, result, onChange }) {
  const { t } = useT();
  const set = (patch) => onChange({ ...result, ...patch });
  const isDefect = result.status && result.status !== "OK";
  return (
    <div className={`rounded-2xl border bg-white p-4 shadow-sm transition-colors ${result.status ? (isDefect ? "border-red-300" : "border-green-300") : ""}`} data-testid={`item-card-${item.id}`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-heading text-sm font-semibold ${result.status ? (isDefect ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700") : "bg-muted text-muted-foreground"}`}>{index}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold leading-tight">{item.name}</p>
          </div>
          {item.guidance && <p className="mt-0.5 text-xs text-muted-foreground">{item.guidance}</p>}
        </div>
      </div>
      <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${item.status_options.length}, minmax(0, 1fr))` }}>
        {item.status_options.map((code) => (
          <StatusPill key={code} code={code} selected={result.status === code} onClick={() => set({ status: code })} testId={`item-${item.id}-status-${code}`} />
        ))}
      </div>
      <div className={`mt-3 space-y-3 rounded-xl p-3 ${isDefect ? "bg-red-50/60" : "bg-brand-bg/50"}`}>
        {isDefect && (
          <Textarea value={result.note || ""} onChange={(e) => set({ note: e.target.value })} placeholder={t("findings_placeholder")} rows={2} className="bg-white" data-testid={`item-${item.id}-note`} />
        )}
        {!isDefect && <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("photo_optional")}</p>}
        <PhotoUploader photos={result.photos || []} onChange={(photos) => set({ photos })} testId={`item-${item.id}-photo`} />
      </div>
    </div>
  );
}

export default function InspectionFormPage() {
  const { t } = useT();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { sites, siteId, setSiteId, needsSitePicker } = useSiteScope();
  const [trucks, setTrucks] = useState([]);
  const [types, setTypes] = useState([]);
  const [truckId, setTruckId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [checklist, setChecklist] = useState(null);
  const [kmHm, setKmHm] = useState("");
  const [results, setResults] = useState({});
  const [generalNote, setGeneralNote] = useState("");
  const [startedAt] = useState(() => new Date());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (needsSitePicker && !siteId) return;
    api.get("/trucks", { params: needsSitePicker ? { site_id: siteId } : {} }).then((r) => setTrucks(r.data.filter((x) => x.is_active)));
    api.get("/inspection-types").then((r) => setTypes(r.data.filter((x) => x.is_active)));
    setTruckId("");
    setTypeId("");
    setChecklist(null);
  }, [needsSitePicker, siteId]);

  useEffect(() => {
    if (!truckId) return;
    setResults({});
    api.get("/inspections/checklist", { params: { truck_id: truckId } }).then((r) => {
      setChecklist(r.data);
      const defaults = {};
      r.data.groups.forEach((g) => g.items.forEach((i) => (defaults[i.id] = { status: "OK", photos: [] })));
      setResults(defaults);
    }).catch((e) => toast.error(errMsg(e)));
  }, [truckId]);

  const items = useMemo(() => (checklist?.groups || []).flatMap((g) => g.items.map((i) => ({ ...i, category_name: g.category.name }))), [checklist]);
  const done = items.filter((i) => results[i.id]?.status).length;
  const defects = items.filter((i) => results[i.id]?.status && results[i.id].status !== "OK").length;
  const ready = truckId && typeId && kmHm !== "" && items.length > 0 && done === items.length;

  const submit = async () => {
    if (!ready) {
      toast.error(t("fill_required"));
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post("/inspections", {
        truck_id: truckId,
        inspection_type_id: typeId,
        km_hm: Number(kmHm),
        started_at: startedAt.toISOString(),
        inspection_date: localDate(),
        general_note: generalNote || null,
        results: items.map((i) => ({ item_id: i.id, item_name: i.name, category_name: i.category_name, status: results[i.id].status, note: results[i.id].note || null, photos: results[i.id].photos || [] })),
      });
      toast.success(t("inspection_saved"));
      navigate(`/inspections/${data.id}`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSubmitting(false);
    }
  };

  const truck = checklist?.truck;
  return (
    <div className="mx-auto max-w-2xl pb-28" data-testid="inspection-form-page">
      <h1 className="font-heading text-2xl font-semibold tracking-tight lg:text-3xl">{t("new_inspection")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("start_inspection_desc")}</p>

      <div className="mt-5 space-y-3 rounded-2xl border bg-white p-4 shadow-sm">
        {needsSitePicker && <SiteSelect value={siteId} onChange={setSiteId} sites={sites} testId="form-site-select" />}
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("vehicle_list")}</label>
            <Select value={truckId} onValueChange={setTruckId}>
              <SelectTrigger className="h-11" data-testid="form-truck-select"><SelectValue placeholder={t("select_truck")} /></SelectTrigger>
              <SelectContent className="bg-white">
                {trucks.map((tr) => (
                  <SelectItem key={tr.id} value={tr.id} data-testid={`form-truck-opt-${tr.hull_number}`}>{tr.hull_number} · {tr.brand || ""} {tr.model || ""}{tr.plate_number ? ` · ${tr.plate_number}` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("inspection_type")}</label>
            <Select value={typeId} onValueChange={setTypeId}>
              <SelectTrigger className="h-11" data-testid="form-type-select"><SelectValue placeholder={t("select_inspection_type")} /></SelectTrigger>
              <SelectContent className="bg-white">
                {types.map((ty) => (
                  <SelectItem key={ty.id} value={ty.id} data-testid={`form-type-opt-${ty.id}`}>{ty.code ? `${ty.code} · ` : ""}{ty.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("km_hm")}</label>
            <div className="relative">
              <Gauge className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
              <Input type="number" inputMode="decimal" value={kmHm} onChange={(e) => setKmHm(e.target.value)} className="h-11 pl-10" placeholder="0" data-testid="form-kmhm-input" />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {t("started_at")}: <b className="text-foreground" data-testid="form-started-at">{startedAt.toLocaleString()}</b></span>
          <span>{t("driver_name")}: <b className="text-foreground">{user.name}</b></span>
          {truck && <span>{t("vin")}: <b className="font-mono text-foreground">{truck.unit_vin_number}</b></span>}
          {truck?.drivetrain_layout && <span>{t("drivetrain_layout")}: <b className="text-foreground">{truck.drivetrain_layout}</b></span>}
        </div>
      </div>

      {truckId && checklist && items.length === 0 && (
        <div className="mt-5 rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground" data-testid="form-no-checklist">{t("no_categories_hint")}</div>
      )}

      {items.length > 0 && (
        <>
          <div className="sticky top-14 z-10 -mx-4 mt-5 border-y bg-white/85 px-4 py-3 backdrop-blur-xl lg:mx-0 lg:rounded-xl lg:border">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-xs text-muted-foreground">{t("default_ok_hint")}</span>
              <span className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${defects ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`} data-testid="form-progress-text">
                {defects ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />} {defects}/{items.length} {t("items_flagged")}
              </span>
            </div>
          </div>

          {checklist.groups.map((g) => (
            <section key={g.category.id} className="mt-5">
              <h2 className="font-heading text-base font-semibold md:text-lg">{g.category.name}</h2>
              {g.category.description && <p className="mb-3 text-xs text-muted-foreground">{g.category.description}</p>}
              <div className="space-y-3">
                {g.items.map((item) => (
                  <ItemCard key={item.id} item={item} index={items.findIndex((x) => x.id === item.id) + 1} result={results[item.id] || {}} onChange={(r) => setResults((s) => ({ ...s, [item.id]: r }))} />
                ))}
              </div>
            </section>
          ))}

          <div className="mt-5 rounded-2xl border bg-white p-4 shadow-sm">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("general_note")}</label>
            <Textarea value={generalNote} onChange={(e) => setGeneralNote(e.target.value)} placeholder={t("general_note_placeholder")} rows={2} data-testid="form-general-note" />
          </div>
        </>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-white/90 p-3 backdrop-blur-xl lg:left-64">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground"><b className={defects ? "text-red-700" : "text-foreground"}>{defects}</b> {t("defects")} · {items.length} {t("items")}</p>
          <Button size="lg" className="h-12 rounded-full px-8" disabled={!ready || submitting} onClick={submit} data-testid="form-submit-btn">
            <CheckCircle2 className="mr-2 h-5 w-5" /> {submitting ? t("submitting") : t("submit_inspection")}
          </Button>
        </div>
      </div>
    </div>
  );
}
