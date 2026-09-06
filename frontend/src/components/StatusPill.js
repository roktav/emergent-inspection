import { useT } from "../lib/i18n";

const STYLES = {
  OK: "bg-green-100 text-green-800 border-green-300",
  NOT_OK: "bg-red-100 text-red-800 border-red-300",
  KOROSI: "bg-orange-100 text-orange-800 border-orange-300",
  KURANG: "bg-yellow-100 text-yellow-800 border-yellow-300",
  LONGGAR: "bg-slate-200 text-slate-800 border-slate-300",
};

export const statusClass = (code) => STYLES[code] || "bg-muted text-foreground border-border";

export function StatusPill({ code, selected, onClick, testId, small }) {
  const { t } = useT();
  return (
    <button
      type="button"
      data-testid={testId}
      data-selected={selected ? "true" : "false"}
      onClick={onClick}
      className={`status-pill ${statusClass(code)} ${small ? "min-h-0 px-2.5 py-0.5 text-xs" : ""} ${
        selected ? "border-2 font-semibold" : "opacity-70 hover:opacity-100"
      }`}
    >
      {t(code)}
    </button>
  );
}

export function StatusBadge({ code, testId }) {
  const { t } = useT();
  return (
    <span data-testid={testId} className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusClass(code)}`}>
      {t(code)}
    </span>
  );
}

const APPROVAL = {
  submitted: "bg-amber-100 text-amber-800 border-amber-300",
  approved: "bg-emerald-100 text-emerald-800 border-emerald-300",
  rejected: "bg-red-100 text-red-800 border-red-300",
};

export function ApprovalBadge({ status, testId }) {
  const { t } = useT();
  return (
    <span data-testid={testId} className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${APPROVAL[status] || ""}`}>
      {t(status)}
    </span>
  );
}
