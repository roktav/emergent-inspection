import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "../lib/api";
import { useT } from "../lib/i18n";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

export function AssignDialog({ open, onClose, title, subtitle, options, initialIds, saveUrl, onSaved, testPrefix }) {
  const { t } = useT();
  const [ids, setIds] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setIds(initialIds || []);
  }, [open, initialIds]);

  const byId = Object.fromEntries(options.map((o) => [o.id, o]));
  const assigned = ids.filter((id) => byId[id]);
  const available = options.filter((o) => !ids.includes(o.id));

  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= assigned.length) return;
    const next = [...assigned];
    [next[i], next[j]] = [next[j], next[i]];
    setIds(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put(saveUrl, { ids: assigned });
      toast.success(t("saved"));
      onSaved?.(data);
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto bg-white sm:max-w-3xl" data-testid={`${testPrefix}-assign-dialog`}>
        <DialogHeader>
          <DialogTitle className="font-heading">{title}</DialogTitle>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border">
            <p className="border-b bg-muted/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide">{t("assigned")} · {assigned.length}</p>
            <ul className="max-h-[50vh] divide-y overflow-y-auto" data-testid={`${testPrefix}-assigned-list`}>
              {assigned.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">{t("no_assigned")}</li>}
              {assigned.map((id, i) => (
                <li key={id} className="flex items-center gap-2 px-3 py-2" data-testid={`${testPrefix}-assigned-${id}`}>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/30 font-heading text-xs font-semibold">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{byId[id].label}</p>
                    {byId[id].sub && <p className="truncate text-xs text-muted-foreground">{byId[id].sub}</p>}
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(i, -1)} disabled={i === 0} title={t("move_up")} data-testid={`${testPrefix}-up-${id}`}><ArrowUp className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(i, 1)} disabled={i === assigned.length - 1} title={t("move_down")} data-testid={`${testPrefix}-down-${id}`}><ArrowDown className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600" onClick={() => setIds(assigned.filter((x) => x !== id))} title={t("unassign")} data-testid={`${testPrefix}-unassign-${id}`}><X className="h-3.5 w-3.5" /></Button>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border">
            <p className="border-b bg-muted/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide">{t("available")} · {available.length}</p>
            <ul className="max-h-[50vh] divide-y overflow-y-auto" data-testid={`${testPrefix}-available-list`}>
              {available.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">{t("no_available")}</li>}
              {available.map((o) => (
                <li key={o.id} className="flex items-center gap-2 px-3 py-2" data-testid={`${testPrefix}-available-${o.id}`}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{o.label}</p>
                    {o.sub && <p className="truncate text-xs text-muted-foreground">{o.sub}</p>}
                  </div>
                  <Button variant="outline" size="sm" className="h-7 rounded-full" onClick={() => setIds([...assigned, o.id])} data-testid={`${testPrefix}-assign-${o.id}`}><Plus className="mr-1 h-3.5 w-3.5" /> {t("assign")}</Button>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid={`${testPrefix}-assign-cancel`}>{t("cancel")}</Button>
          <Button onClick={save} disabled={saving} data-testid={`${testPrefix}-assign-save`}>{saving ? t("saving") : t("save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
