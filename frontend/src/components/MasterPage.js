import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "../lib/api";
import { useT } from "../lib/i18n";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Switch } from "./ui/switch";
import { Checkbox } from "./ui/checkbox";
import { Badge } from "./ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "./ui/alert-dialog";

// `options`, `placeholder`, `disabled` and `hidden` may be given as a function of the
// current form values, so one field can depend on another (e.g. site depends on company).
const resolveProp = (prop, form) => (typeof prop === "function" ? prop(form) : prop);
const isHidden = (field, form) => !!resolveProp(field.hidden, form);

const applyChange = (form, field, value) => {
  const next = { ...form, [field.key]: value };
  if (form[field.key] !== value) (field.resets || []).forEach((key) => { next[key] = ""; });
  return next;
};

export function FieldInput({ field, value, onChange, testId }) {
  const { t } = useT();
  const common = { id: field.key, "data-testid": testId };
  switch (field.type) {
    case "select":
      return (
        <Select value={value ?? ""} onValueChange={onChange} disabled={field.disabled}>
          <SelectTrigger {...common}>
            <SelectValue placeholder={field.placeholder || t("select_site")} />
          </SelectTrigger>
          <SelectContent className="bg-white">
            {(field.options || []).map((o) => (
              <SelectItem key={o.value} value={o.value} data-testid={`${testId}-opt-${o.value}`}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "switch":
      return (
        <div className="flex h-10 items-center">
          <Switch {...common} checked={!!value} onCheckedChange={onChange} />
        </div>
      );
    case "textarea":
      return <Textarea {...common} value={value ?? ""} onChange={(e) => onChange(e.target.value)} rows={3} />;
    case "multicheck":
      return (
        <div className="flex flex-wrap gap-3" data-testid={testId}>
          {field.options.map((o) => {
            const checked = (value || []).includes(o.value);
            return (
              <label key={o.value} className="flex items-center gap-2 text-sm">
                <Checkbox
                  data-testid={`${testId}-${o.value}`}
                  checked={checked}
                  onCheckedChange={(c) => {
                    const cur = value || [];
                    onChange(c ? [...cur, o.value] : cur.filter((v) => v !== o.value));
                  }}
                />
                {o.label}
              </label>
            );
          })}
        </div>
      );
    case "number":
      return <Input {...common} type="number" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />;
    default:
      return (
        <Input {...common} type={field.type || "text"} value={value ?? ""} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      );
  }
}

export function MasterPage({ titleKey, endpoint, columns, fields, canWrite = true, query, defaults = {}, testPrefix, headerExtra, hint, rowActions, reloadKey }) {
  const { t } = useT();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  const queryKey = JSON.stringify(query || {});
  const load = useCallback(() => {
    setLoading(true);
    api
      .get(endpoint, { params: query })
      .then((r) => setRows(r.data))
      .catch((e) => toast.error(errMsg(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, queryKey, reloadKey]);

  useEffect(load, [load]);

  const filtered = useMemo(() => {
    if (!q) return rows;
    const s = q.toLowerCase();
    return rows.filter((r) => JSON.stringify(r).toLowerCase().includes(s));
  }, [rows, q]);

  const openNew = () => {
    const f = { ...defaults };
    fields.forEach((fl) => {
      if (f[fl.key] === undefined) f[fl.key] = fl.default ?? (fl.type === "switch" ? true : fl.type === "multicheck" ? [] : "");
    });
    setEditing(null);
    setForm(f);
    setOpen(true);
  };

  const openEdit = (row) => {
    const f = { ...defaults };
    fields.forEach((fl) => (f[fl.key] = row[fl.key] ?? (fl.type === "multicheck" ? [] : "")));
    setEditing(row);
    setForm(f);
    setOpen(true);
  };

  const save = async () => {
    for (const fl of fields) {
      if (isHidden(fl, form)) continue;
      if (fl.required && (form[fl.key] === "" || form[fl.key] == null) && !(fl.requiredOnCreate && editing)) {
        toast.error(`${t(fl.label)} is required`);
        return;
      }
    }
    setSaving(true);
    try {
      const payload = { ...form };
      fields.forEach((fl) => {
        if (isHidden(fl, form)) delete payload[fl.key];
      });
      Object.keys(payload).forEach((k) => {
        if (payload[k] === "") payload[k] = null;
      });
      if (editing) await api.put(`${endpoint}/${editing.id}`, payload);
      else await api.post(endpoint, payload);
      toast.success(t("saved"));
      setOpen(false);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api.delete(`${endpoint}/${toDelete.id}`);
      toast.success(t("deleted"));
      setToDelete(null);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="fade-up space-y-5" data-testid={`${testPrefix}-page`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight lg:text-3xl">{t(titleKey)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{rows.length} {t("items")}{hint ? ` · ${hint}` : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {headerExtra}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input data-testid={`${testPrefix}-search`} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} className="w-48 bg-white pl-9" />
          </div>
          {canWrite && (
            <Button data-testid={`${testPrefix}-add-btn`} onClick={openNew} className="rounded-full">
              <Plus className="mr-1 h-4 w-4" /> {t("add")}
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60">
                {columns.map((c) => (
                  <TableHead key={c.key} className="text-xs font-semibold uppercase tracking-wide">{t(c.label)}</TableHead>
                ))}
                {canWrite && <TableHead className="w-36 text-right text-xs font-semibold uppercase">{t("actions")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={columns.length + 1} className="py-10 text-center text-muted-foreground">{t("loading")}</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={columns.length + 1} className="py-10 text-center text-muted-foreground" data-testid={`${testPrefix}-empty`}>{t("no_data")}</TableCell></TableRow>
              ) : (
                filtered.map((row) => (
                  <TableRow key={row.id} data-testid={`${testPrefix}-row-${row.id}`} className="hover:bg-brand-bg/60">
                    {columns.map((c) => (
                      <TableCell key={c.key} className="text-sm">
                        {c.render ? c.render(row) : c.key === "is_active" ? (
                          <Badge variant={row.is_active ? "default" : "outline"} className={row.is_active ? "bg-emerald-600" : ""}>{row.is_active ? t("active") : t("inactive")}</Badge>
                        ) : (row[c.key] ?? "—")}
                      </TableCell>
                    ))}
                    {canWrite && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {rowActions?.(row)}
                          <Button variant="ghost" size="icon" data-testid={`${testPrefix}-edit-${row.id}`} onClick={() => openEdit(row)}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="text-red-600 hover:text-red-700" data-testid={`${testPrefix}-delete-${row.id}`} onClick={() => setToDelete(row)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto bg-white sm:max-w-lg" data-testid={`${testPrefix}-dialog`}>
          <DialogHeader>
            <DialogTitle className="font-heading">{editing ? t("edit") : t("add")} · {t(titleKey)}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {fields.filter((f) => !isHidden(f, form)).map((f) => (
              <div key={f.key} className="grid gap-1.5">
                <Label htmlFor={f.key} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(f.label)}{f.required && !(f.requiredOnCreate && editing) ? " *" : ""}
                </Label>
                <FieldInput
                  field={{
                    ...f,
                    options: resolveProp(f.options, form),
                    placeholder: resolveProp(f.placeholder, form),
                    disabled: resolveProp(f.disabled, form),
                  }}
                  value={form[f.key]}
                  onChange={(v) => setForm((s) => applyChange(s, f, v))}
                  testId={`${testPrefix}-field-${f.key}`}
                />
                {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} data-testid={`${testPrefix}-cancel-btn`}>{t("cancel")}</Button>
            <Button onClick={save} disabled={saving} data-testid={`${testPrefix}-save-btn`}>{saving ? t("saving") : t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent className="bg-white" data-testid={`${testPrefix}-delete-dialog`}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirm_delete_title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("confirm_delete_desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`${testPrefix}-delete-cancel`}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-red-600 hover:bg-red-700" data-testid={`${testPrefix}-delete-confirm`}>{t("delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function useLookup(endpoint, enabled = true, reloadKey = 0) {
  const [data, setData] = useState([]);
  useEffect(() => {
    if (!enabled) return;
    api.get(endpoint).then((r) => setData(r.data)).catch(() => {});
  }, [endpoint, enabled, reloadKey]);
  return data;
}
