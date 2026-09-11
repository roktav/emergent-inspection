import { useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useT, STATUS_CODES } from "../lib/i18n";
import { MasterPage, useLookup } from "../components/MasterPage";
import { StatusBadge } from "../components/StatusPill";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { AssignDialog } from "../components/AssignDialog";
import { Layers, ListChecks } from "lucide-react";
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

export function CompanySelect({ value, onChange, companies, testId = "company-select" }) {
  const { t } = useT();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-56 bg-white" data-testid={testId}>
        <SelectValue placeholder={t("select_company")} />
      </SelectTrigger>
      <SelectContent className="bg-white">
        {companies.map((c) => (
          <SelectItem key={c.id} value={c.id} data-testid={`${testId}-opt-${c.id}`}>{c.code} · {c.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function useSiteScope() {
  const { user } = useAuth();
  const isSuper = user.role === "superadmin";
  const isCompanyAdmin = user.role === "company_admin";
  const sites = useLookup("/sites", true);
  const [siteId, setSiteId] = useState("");
  const filteredSites = isCompanyAdmin ? sites.filter((s) => s.company_id === user.company_id) : sites;
  const effective = (isSuper || isCompanyAdmin) ? siteId || filteredSites[0]?.id || "" : user.site_id;
  return { isSuper, isCompanyAdmin, sites: filteredSites, siteId: effective, setSiteId, needsSitePicker: isSuper || isCompanyAdmin };
}

export function useCompanyScope() {
  const { user } = useAuth();
  const isSuper = user.role === "superadmin";
  const companies = useLookup("/companies", isSuper);
  const [companyId, setCompanyId] = useState("");
  const effective = isSuper ? companyId || companies[0]?.id || "" : user.company_id;
  return { isSuper, companies, companyId: effective, setCompanyId };
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
  const { user } = useAuth();
  const isSuper = user.role === "superadmin";
  const companies = useLookup("/companies", isSuper);
  const cmap = useMemo(() => byId(companies), [companies]);
  return (
    <MasterPage
      titleKey="sites"
      endpoint="/sites"
      testPrefix="sites"
      defaults={!isSuper ? { company_id: user.company_id } : {}}
      columns={[
        ...(isSuper ? [{ key: "company_id", label: "company", render: (r) => cmap[r.company_id]?.name || "—" }] : []),
        { key: "name", label: "name" }, { key: "code", label: "code" }, { key: "location", label: "location" }, { key: "is_active", label: "status" },
      ]}
      fields={[
        ...(isSuper ? [{
          key: "company_id", label: "company", type: "select", required: true, placeholder: t("select_company"),
          options: companies.map((c) => ({ value: c.id, label: c.name })),
        }] : []),
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
  const isCompanyAdmin = user.role === "company_admin";
  const companies = useLookup("/companies", isSuper);
  const sites = useLookup("/sites");
  const cmap = useMemo(() => byId(companies), [companies]);
  const smap = useMemo(() => byId(sites), [sites]);
  const roles = isSuper
    ? ["superadmin", "company_admin", "site_admin", "driver", "mechanic"]
    : isCompanyAdmin
      ? ["site_admin", "driver", "mechanic"]
      : ["driver", "mechanic"];
  const globalRole = (vals) => vals.role === "superadmin";
  const companyOnlyRole = (vals) => vals.role === "company_admin";
  return (
    <MasterPage
      titleKey="users"
      endpoint="/users"
      testPrefix="users"
      hint={user.role === "site_admin" ? t("role_hint_site_admin") : undefined}
      columns={[
        { key: "name", label: "name" },
        { key: "email", label: "email" },
        { key: "role", label: "role", render: (r) => <Badge variant="secondary" className="capitalize">{t(r.role)}</Badge> },
        ...(isSuper ? [{ key: "company_id", label: "company", render: (r) => cmap[r.company_id]?.name || "—" }] : []),
        { key: "site_id", label: "site", render: (r) => smap[r.site_id]?.name || "—" },
        { key: "is_active", label: "status" },
      ]}
      fields={[
        { key: "name", label: "name", required: true },
        { key: "email", label: "email", type: "email", required: true },
        { key: "password", label: "password", type: "password", required: true, requiredOnCreate: true, hint: t("password_hint") },
        { key: "role", label: "role", type: "select", required: true, default: "driver", options: roles.map((r) => ({ value: r, label: t(r) })), disabled: user.role === "site_admin" },
        ...(isSuper ? [
          {
            key: "company_id", label: "company", type: "select", required: true,
            placeholder: t("select_company"),
            hidden: globalRole,
            resets: ["site_id"],
            options: companies.map((c) => ({ value: c.id, label: c.name })),
          },
          {
            key: "site_id", label: "site", type: "select", required: true,
            hidden: (vals) => globalRole(vals) || companyOnlyRole(vals),
            disabled: (vals) => !vals.company_id,
            placeholder: (vals) => (vals.company_id ? t("select_site") : t("select_company_first")),
            options: (vals) => sites.filter((s) => s.company_id === vals.company_id).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` })),
          },
        ] : isCompanyAdmin ? [
          {
            key: "site_id", label: "site", type: "select", required: true,
            placeholder: t("select_site"),
            options: sites.filter((s) => s.company_id === user.company_id).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` })),
          },
        ] : []),
        { key: "is_active", label: "is_active", type: "switch" },
      ]}
    />
  );
}

const DRIVETRAINS = ["4x2", "4x4", "6x2", "6x4", "6x6", "8x4", "8x8"];

export function VehicleCategoriesPage() {
  const { t } = useT();
  const { isSuper, companies, companyId, setCompanyId } = useCompanyScope();
  const [reload, setReload] = useState(0);
  const [assigning, setAssigning] = useState(null);
  const cats = useLookup(`/categories${isSuper && companyId ? `?company_id=${companyId}` : ""}`, !isSuper || !!companyId, reload);
  const cmap = useMemo(() => byId(cats), [cats]);
  return (
    <>
      <MasterPage
        titleKey="vehicle_categories"
        endpoint="/vehicle-categories"
        testPrefix="vehicle-categories"
        reloadKey={reload}
        query={isSuper ? { company_id: companyId } : undefined}
        defaults={isSuper ? { company_id: companyId } : {}}
        headerExtra={isSuper ? <CompanySelect value={companyId} onChange={setCompanyId} companies={companies} /> : null}
        rowActions={(row) => (
          <Button variant="outline" size="sm" className="h-8 rounded-full" onClick={() => setAssigning(row)} data-testid={`vehicle-categories-assign-${row.id}`}>
            <Layers className="mr-1 h-3.5 w-3.5" /> {t("manage_categories")}
          </Button>
        )}
        columns={[
          { key: "name", label: "name", render: (r) => <span className="font-semibold">{r.name}</span> },
          { key: "brand", label: "brand" },
          { key: "model", label: "model" },
          { key: "drivetrain_layout", label: "drivetrain_layout" },
          { key: "category_ids", label: "categories_count", render: (r) => (
            <div className="flex flex-wrap gap-1">
              {(r.category_ids || []).length === 0 && <span className="text-xs text-muted-foreground">—</span>}
              {(r.category_ids || []).map((id, i) => cmap[id] && <Badge key={id} variant="secondary">{i + 1}. {cmap[id].name}</Badge>)}
            </div>
          ) },
          { key: "is_active", label: "status" },
        ]}
        fields={[
          { key: "name", label: "name", required: true },
          { key: "brand", label: "brand" },
          { key: "model", label: "model" },
          { key: "drivetrain_layout", label: "drivetrain_layout", type: "select", placeholder: t("drivetrain_layout"), options: DRIVETRAINS.map((d) => ({ value: d, label: d })) },
          { key: "is_active", label: "is_active", type: "switch" },
        ]}
      />
      <AssignDialog
        open={!!assigning}
        onClose={() => setAssigning(null)}
        title={`${t("assigned_categories")} · ${assigning?.name || ""}`}
        subtitle={t("walk_hint")}
        options={cats.map((c) => ({ id: c.id, label: c.name, sub: `${(c.item_ids || []).length} ${t("items")}` }))}
        initialIds={assigning?.category_ids || []}
        saveUrl={`/vehicle-categories/${assigning?.id}/inspection-categories`}
        onSaved={() => setReload((x) => x + 1)}
        testPrefix="vehicle-categories"
      />
    </>
  );
}

export function TrucksPage() {
  const { t } = useT();
  const { user } = useAuth();
  const { isSuper, sites, siteId, setSiteId, needsSitePicker } = useSiteScope();
  const companyId = isSuper
    ? (sites.find((s) => s.id === siteId)?.company_id)
    : user.company_id;
  const vcats = useLookup(
    `/vehicle-categories${isSuper && companyId ? `?company_id=${companyId}` : ""}`,
    !!companyId || !isSuper,
  );
  const vmap = useMemo(() => byId(vcats), [vcats]);
  const smap = useMemo(() => byId(sites), [sites]);
  const siteField = needsSitePicker ? [{
    key: "site_id", label: "site", type: "select", required: true,
    placeholder: t("select_site"),
    options: sites.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` })),
  }] : [];
  return (
    <MasterPage
      titleKey="vehicle_list"
      endpoint="/trucks"
      testPrefix="trucks"
      query={needsSitePicker ? { site_id: siteId } : undefined}
      defaults={needsSitePicker ? { site_id: siteId } : {}}
      headerExtra={needsSitePicker ? <SiteSelect value={siteId} onChange={setSiteId} sites={sites} /> : null}
      columns={[
        { key: "hull_number", label: "hull_number", render: (r) => <span className="font-semibold">{r.hull_number}</span> },
        { key: "unit_vin_number", label: "unit_vin_number", render: (r) => <span className="font-mono text-xs">{r.unit_vin_number}</span> },
        { key: "plate_number", label: "plate_number" },
        ...(needsSitePicker ? [{ key: "site_id", label: "site", render: (r) => smap[r.site_id]?.name || "—" }] : []),
        { key: "vehicle_category_id", label: "vehicle_category", render: (r) => vmap[r.vehicle_category_id]?.name || r.vehicle_category_name || "—" },
        { key: "brand", label: "brand" },
        { key: "model", label: "model" },
        { key: "is_active", label: "status" },
      ]}
      fields={[
        ...siteField,
        { key: "unit_vin_number", label: "unit_vin_number", required: true },
        { key: "hull_number", label: "hull_number", required: true },
        { key: "plate_number", label: "plate_number" },
        {
          key: "vehicle_category_id", label: "vehicle_category", type: "select", required: true,
          placeholder: t("select_vehicle_category"),
          options: vcats.map((c) => ({ value: c.id, label: c.name })),
        },
        { key: "is_active", label: "is_active", type: "switch" },
      ]}
    />
  );
}

export function CategoriesPage() {
  const { t } = useT();
  const { isSuper, companies, companyId, setCompanyId } = useCompanyScope();
  const [reload, setReload] = useState(0);
  const [assigning, setAssigning] = useState(null);
  const items = useLookup(`/items${isSuper && companyId ? `?company_id=${companyId}` : ""}`, !isSuper || !!companyId, reload);
  return (
    <>
      <MasterPage
        titleKey="inspection_categories"
        endpoint="/categories"
        testPrefix="categories"
        reloadKey={reload}
        query={isSuper ? { company_id: companyId } : undefined}
        defaults={isSuper ? { company_id: companyId } : {}}
        headerExtra={isSuper ? <CompanySelect value={companyId} onChange={setCompanyId} companies={companies} /> : null}
        rowActions={(row) => (
          <Button variant="outline" size="sm" className="h-8 rounded-full" onClick={() => setAssigning(row)} data-testid={`categories-assign-${row.id}`}>
            <ListChecks className="mr-1 h-3.5 w-3.5" /> {t("manage_items")}
          </Button>
        )}
        columns={[
          { key: "name", label: "name", render: (r) => <span className="font-semibold">{r.name}</span> },
          { key: "description", label: "description" },
          { key: "item_ids", label: "items_count", render: (r) => <Badge variant="secondary">{(r.item_ids || []).length} {t("items")}</Badge> },
          { key: "is_active", label: "status" },
        ]}
        fields={[
          { key: "name", label: "name", required: true },
          { key: "description", label: "description", type: "textarea" },
          { key: "is_active", label: "is_active", type: "switch" },
        ]}
      />
      <AssignDialog
        open={!!assigning}
        onClose={() => setAssigning(null)}
        title={`${t("assigned_items")} · ${assigning?.name || ""}`}
        subtitle={t("walk_hint")}
        options={items.map((i) => ({ id: i.id, label: i.name, sub: i.guidance }))}
        initialIds={assigning?.item_ids || []}
        saveUrl={`/categories/${assigning?.id}/items`}
        onSaved={() => setReload((x) => x + 1)}
        testPrefix="categories"
      />
    </>
  );
}

export function InspectionTypesPage() {
  const { isSuper, companies, companyId, setCompanyId } = useCompanyScope();
  return (
    <MasterPage
      titleKey="inspection_types"
      endpoint="/inspection-types"
      testPrefix="inspection-types"
      query={isSuper ? { company_id: companyId } : undefined}
      defaults={isSuper ? { company_id: companyId } : {}}
      headerExtra={isSuper ? <CompanySelect value={companyId} onChange={setCompanyId} companies={companies} /> : null}
      columns={[
        { key: "name", label: "name", render: (r) => <span className="font-semibold">{r.name}</span> },
        { key: "code", label: "code", render: (r) => r.code ? <Badge variant="secondary" className="font-mono">{r.code}</Badge> : "—" },
        { key: "description", label: "description" },
        { key: "is_active", label: "status" },
      ]}
      fields={[
        { key: "name", label: "name", required: true },
        { key: "code", label: "code" },
        { key: "description", label: "description", type: "textarea" },
        { key: "is_active", label: "is_active", type: "switch" },
      ]}
    />
  );
}

export function ItemsPage() {
  const { t } = useT();
  const { isSuper, companies, companyId, setCompanyId } = useCompanyScope();
  return (
    <MasterPage
      titleKey="inspection_items"
      endpoint="/items"
      testPrefix="items"
      query={isSuper ? { company_id: companyId } : undefined}
      defaults={isSuper ? { company_id: companyId } : {}}
      headerExtra={isSuper ? <CompanySelect value={companyId} onChange={setCompanyId} companies={companies} /> : null}
      columns={[
        { key: "name", label: "name", render: (r) => (<div><p className="font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{r.guidance}</p></div>) },
        { key: "status_options", label: "status_options", render: (r) => <div className="flex flex-wrap gap-1">{(r.status_options || []).map((s) => <StatusBadge key={s} code={s} />)}</div> },
        { key: "is_active", label: "status" },
      ]}
      fields={[
        { key: "name", label: "name", required: true },
        { key: "guidance", label: "guidance", type: "textarea" },
        { key: "status_options", label: "status_options", type: "multicheck", default: ["OK", "NOT_OK", "KOROSI"], options: STATUS_CODES.map((c) => ({ value: c, label: t(c) })), hint: t("per_item_status") },
        { key: "is_active", label: "is_active", type: "switch" },
      ]}
    />
  );
}
