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

const DRIVETRAINS = ["4x2", "4x4", "6x2", "6x4", "6x6", "8x4", "8x8"];

export function TrucksPage() {
  const { t } = useT();
  const { isSuper, sites, siteId, setSiteId } = useSiteScope();
  const [reload, setReload] = useState(0);
  const [assigning, setAssigning] = useState(null);
  const cats = useLookup(`/categories${isSuper && siteId ? `?site_id=${siteId}` : ""}`, !isSuper || !!siteId, reload);
  const cmap = useMemo(() => byId(cats), [cats]);
  return (
    <>
      <MasterPage
        titleKey="dump_trucks"
        endpoint="/trucks"
        testPrefix="trucks"
        reloadKey={reload}
        query={isSuper ? { site_id: siteId } : undefined}
        defaults={isSuper ? { site_id: siteId } : {}}
        headerExtra={isSuper ? <SiteSelect value={siteId} onChange={setSiteId} sites={sites} /> : null}
        rowActions={(row) => (
          <Button variant="outline" size="sm" className="h-8 rounded-full" onClick={() => setAssigning(row)} data-testid={`trucks-assign-${row.id}`}>
            <Layers className="mr-1 h-3.5 w-3.5" /> {t("manage_categories")}
          </Button>
        )}
        columns={[
          { key: "hull_number", label: "hull_number", render: (r) => <span className="font-semibold">{r.hull_number}</span> },
          { key: "unit_vin_number", label: "unit_vin_number", render: (r) => <span className="font-mono text-xs">{r.unit_vin_number}</span> },
          { key: "plate_number", label: "plate_number" },
          { key: "brand", label: "brand" }, { key: "model", label: "model" },
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
          { key: "unit_vin_number", label: "unit_vin_number", required: true },
          { key: "hull_number", label: "hull_number", required: true },
          { key: "plate_number", label: "plate_number" },
          { key: "brand", label: "brand" },
          { key: "model", label: "model" },
          { key: "drivetrain_layout", label: "drivetrain_layout", type: "select", placeholder: t("drivetrain_layout"), options: DRIVETRAINS.map((d) => ({ value: d, label: d })) },
          { key: "is_active", label: "is_active", type: "switch" },
        ]}
      />
      <AssignDialog
        open={!!assigning}
        onClose={() => setAssigning(null)}
        title={`${t("assigned_categories")} · ${assigning?.hull_number || ""}`}
        subtitle={t("walk_hint")}
        options={cats.map((c) => ({ id: c.id, label: c.name, sub: `${(c.item_ids || []).length} ${t("items")}` }))}
        initialIds={assigning?.category_ids || []}
        saveUrl={`/trucks/${assigning?.id}/categories`}
        onSaved={() => setReload((x) => x + 1)}
        testPrefix="trucks"
      />
    </>
  );
}

export function CategoriesPage() {
  const { t } = useT();
  const { isSuper, sites, siteId, setSiteId } = useSiteScope();
  const [reload, setReload] = useState(0);
  const [assigning, setAssigning] = useState(null);
  const items = useLookup(`/items${isSuper && siteId ? `?site_id=${siteId}` : ""}`, !isSuper || !!siteId, reload);
  return (
    <>
      <MasterPage
        titleKey="inspection_categories"
        endpoint="/categories"
        testPrefix="categories"
        reloadKey={reload}
        query={isSuper ? { site_id: siteId } : undefined}
        defaults={isSuper ? { site_id: siteId } : {}}
        headerExtra={isSuper ? <SiteSelect value={siteId} onChange={setSiteId} sites={sites} /> : null}
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
      query={isSuper ? { site_id: siteId } : undefined}
      defaults={isSuper ? { site_id: siteId } : {}}
      headerExtra={isSuper ? <SiteSelect value={siteId} onChange={setSiteId} sites={sites} /> : null}
      columns={[
        { key: "name", label: "name", render: (r) => (<div><p className="font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{r.guidance}</p></div>) },
        { key: "category_id", label: "category", render: (r) => cmap[r.category_id]?.name || <span className="text-xs text-muted-foreground">{t("unassigned")}</span> },
        { key: "status_options", label: "status_options", render: (r) => <div className="flex flex-wrap gap-1">{(r.status_options || []).map((s) => <StatusBadge key={s} code={s} />)}</div> },
        { key: "is_active", label: "status" },
      ]}
      fields={[
        { key: "category_id", label: "category", type: "select", placeholder: t("select_category"), options: cats.map((c) => ({ value: c.id, label: c.name })) },
        { key: "name", label: "name", required: true },
        { key: "guidance", label: "guidance", type: "textarea" },
        { key: "status_options", label: "status_options", type: "multicheck", default: ["OK", "NOT_OK", "KOROSI"], options: STATUS_CODES.map((c) => ({ value: c, label: t(c) })), hint: t("per_item_status") },
        { key: "is_active", label: "is_active", type: "switch" },
      ]}
    />
  );
}
