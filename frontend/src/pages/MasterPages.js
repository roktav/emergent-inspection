import { useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useT, STATUS_CODES } from "../lib/i18n";
import { MasterPage, useLookup } from "../components/MasterPage";
import { StatusBadge } from "../components/StatusPill";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

const byId = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));

export function SiteSelect({ value, onChange, sites, testId = "site-select" }) {
  const { t } = useT();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-56 bg-white" data-testid={testId}>
        <SelectValue placeholder={t("select_site")} />
      </SelectTrigger>
      <SelectContent className="bg-white">
        {sites.map((s) => (
          <SelectItem key={s.id} value={s.id} data-testid={`${testId}-opt-${s.id}`}>{s.code} · {s.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function useSiteScope() {
  const { user } = useAuth();
  const isSuper = user.role === "superadmin";
  const sites = useLookup("/sites");
  const [siteId, setSiteId] = useState("");
  const effective = isSuper ? siteId || sites[0]?.id || "" : user.site_id;
  return { isSuper, sites, siteId: effective, setSiteId };
}

export function CompaniesPage() {
  return (
    <MasterPage
      titleKey="companies"
      endpoint="/companies"
      testPrefix="companies"
      columns={[{ key: "name", label: "name" }, { key: "code", label: "code" }, { key: "address", label: "address" }, { key: "is_active", label: "status" }]}
      fields={[
        { key: "name", label: "name", required: true },
        { key: "code", label: "code", required: true },
        { key: "address", label: "address" },
        { key: "is_active", label: "is_active", type: "switch" },
      ]}
    />
  );
}

export function SitesPage() {
  const { t } = useT();
  const companies = useLookup("/companies");
  const cmap = useMemo(() => byId(companies), [companies]);
  return (
    <MasterPage
      titleKey="sites"
      endpoint="/sites"
      testPrefix="sites"
      columns={[
        { key: "company_id", label: "company", render: (r) => cmap[r.company_id]?.name || "—" },
        { key: "name", label: "name" }, { key: "code", label: "code" }, { key: "location", label: "location" }, { key: "is_active", label: "status" },
      ]}
      fields={[
        { key: "company_id", label: "company", type: "select", required: true, placeholder: t("select_company"), options: companies.map((c) => ({ value: c.id, label: c.name })) },
        { key: "name", label: "name", required: true },
        { key: "code", label: "code", required: true },
        { key: "location", label: "location" },
        { key: "is_active", label: "is_active", type: "switch" },
      ]}
    />
  );
}

export function UsersPage() {
  const { t } = useT();
  const { user } = useAuth();
  const isSuper = user.role === "superadmin";
  const sites = useLookup("/sites");
  const smap = useMemo(() => byId(sites), [sites]);
  const roles = isSuper ? ["superadmin", "admin", "driver"] : ["driver"];
  return (
    <MasterPage
      titleKey="users"
      endpoint="/users"
      testPrefix="users"
      hint={!isSuper ? t("role_hint_admin") : undefined}
      columns={[
        { key: "name", label: "name" },
        { key: "email", label: "email" },
        { key: "role", label: "role", render: (r) => <Badge variant="secondary" className="capitalize">{t(r.role)}</Badge> },
        { key: "site_id", label: "site", render: (r) => smap[r.site_id]?.name || "—" },
        { key: "is_active", label: "status" },
      ]}
      fields={[
        { key: "name", label: "name", required: true },
        { key: "email", label: "email", type: "email", required: true },
        { key: "password", label: "password", type: "password", required: true, requiredOnCreate: true, hint: t("password_hint") },
        { key: "role", label: "role", type: "select", required: true, default: "driver", options: roles.map((r) => ({ value: r, label: t(r) })), disabled: !isSuper },
        ...(isSuper ? [{ key: "site_id", label: "site", type: "select", options: sites.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` })) }] : []),
        { key: "is_active", label: "is_active", type: "switch" },
      ]}
    />
  );
}

export function TrucksPage() {
  const { t } = useT();
  const { isSuper, sites, siteId, setSiteId } = useSiteScope();
  return (
    <MasterPage
      titleKey="dump_trucks"
      endpoint="/trucks"
      testPrefix="trucks"
      query={isSuper ? { site_id: siteId } : undefined}
      defaults={isSuper ? { site_id: siteId } : {}}
      headerExtra={isSuper ? <SiteSelect value={siteId} onChange={setSiteId} sites={sites} /> : null}
      columns={[
        { key: "unit_number", label: "unit_number", render: (r) => <span className="font-semibold">{r.unit_number}</span> },
        { key: "hull_number", label: "hull_number" },
        { key: "truck_type", label: "truck_type", render: (r) => <Badge className={r.truck_type === "EV" ? "bg-cyan-600" : "bg-slate-600"}>{r.truck_type}</Badge> },
        { key: "brand", label: "brand" }, { key: "model", label: "model" }, { key: "plate_number", label: "plate_number" }, { key: "is_active", label: "status" },
      ]}
      fields={[
        { key: "unit_number", label: "unit_number", required: true },
        { key: "hull_number", label: "hull_number" },
        { key: "plate_number", label: "plate_number" },
        { key: "truck_type", label: "truck_type", type: "select", required: true, default: "ICE", options: [{ value: "ICE", label: t("ice") }, { value: "EV", label: t("ev") }] },
        { key: "brand", label: "brand" },
        { key: "model", label: "model" },
        { key: "is_active", label: "is_active", type: "switch" },
      ]}
    />
  );
}

export function CategoriesPage() {
  const { isSuper, sites, siteId, setSiteId } = useSiteScope();
  return (
    <MasterPage
      titleKey="inspection_categories"
      endpoint="/categories"
      testPrefix="categories"
      query={isSuper ? { site_id: siteId } : undefined}
      defaults={isSuper ? { site_id: siteId } : {}}
      headerExtra={isSuper ? <SiteSelect value={siteId} onChange={setSiteId} sites={sites} /> : null}
      columns={[{ key: "order", label: "order" }, { key: "name", label: "name" }, { key: "description", label: "description" }, { key: "is_active", label: "status" }]}
      fields={[
        { key: "order", label: "order", type: "number", default: 1 },
        { key: "name", label: "name", required: true },
        { key: "description", label: "description", type: "textarea" },
        { key: "is_active", label: "is_active", type: "switch" },
      ]}
    />
  );
}

export function ItemsPage() {
  const { t } = useT();
  const { isSuper, sites, siteId, setSiteId } = useSiteScope();
  const cats = useLookup(`/categories${isSuper && siteId ? `?site_id=${siteId}` : ""}`, !isSuper || !!siteId);
  const cmap = useMemo(() => byId(cats), [cats]);
  return (
    <MasterPage
      titleKey="inspection_items"
      endpoint="/items"
      testPrefix="items"
      hint={t("walk_hint")}
      query={isSuper ? { site_id: siteId } : undefined}
      defaults={isSuper ? { site_id: siteId } : {}}
      headerExtra={isSuper ? <SiteSelect value={siteId} onChange={setSiteId} sites={sites} /> : null}
      columns={[
        { key: "order", label: "order" },
        { key: "name", label: "name", render: (r) => (<div><p className="font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{r.guidance}</p></div>) },
        { key: "category_id", label: "category", render: (r) => cmap[r.category_id]?.name || "—" },
        { key: "status_options", label: "status_options", render: (r) => <div className="flex flex-wrap gap-1">{(r.status_options || []).map((s) => <StatusBadge key={s} code={s} />)}</div> },
        { key: "ev_only", label: "truck_type", render: (r) => <Badge className={r.ev_only ? "bg-cyan-600" : "bg-slate-500"}>{r.ev_only ? t("ev_only") : t("all_types")}</Badge> },
        { key: "is_active", label: "status" },
      ]}
      fields={[
        { key: "category_id", label: "category", type: "select", required: true, placeholder: t("select_category"), options: cats.map((c) => ({ value: c.id, label: c.name })) },
        { key: "order", label: "order", type: "number", default: 1 },
        { key: "name", label: "name", required: true },
        { key: "guidance", label: "guidance", type: "textarea" },
        { key: "status_options", label: "status_options", type: "multicheck", default: ["OK", "NOT_OK", "KOROSI"], options: STATUS_CODES.map((c) => ({ value: c, label: t(c) })), hint: t("per_item_status") },
        { key: "ev_only", label: "ev_only", type: "switch", default: false },
        { key: "is_active", label: "is_active", type: "switch" },
      ]}
    />
  );
}
