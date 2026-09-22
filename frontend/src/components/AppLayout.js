import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { RefreshCw, Building2, MapPin, Users, Truck, Layers, ListChecks, ClipboardCheck, PlusCircle,
  BarChart3, LayoutDashboard, LogOut, Menu, X, Tags, WifiOff } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useT } from "../lib/i18n";
import { useOffline } from "../lib/offline/OfflineContext";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

const NAV = [
  { section: "dashboard", items: [{ to: "/", key: "dashboard", icon: LayoutDashboard, roles: ["superadmin", "company_admin", "site_admin", "driver", "mechanic"] }] },
  {
    section: "masters",
    items: [
      { to: "/companies", key: "companies", icon: Building2, roles: ["superadmin"] },
      { to: "/sites", key: "sites", icon: MapPin, roles: ["superadmin", "company_admin"] },
      { to: "/users", key: "users", icon: Users, roles: ["superadmin", "company_admin", "site_admin"] },
      { to: "/vehicle-categories", key: "vehicle_categories", icon: Tags, roles: ["superadmin", "company_admin"] },
      { to: "/trucks", key: "vehicle_list", icon: Truck, roles: ["superadmin", "company_admin", "site_admin"] },
      { to: "/categories", key: "inspection_categories", icon: Layers, roles: ["superadmin", "company_admin"] },
      { to: "/items", key: "inspection_items", icon: ListChecks, roles: ["superadmin", "company_admin"] },
      { to: "/inspection-types", key: "inspection_types", icon: Tags, roles: ["superadmin", "company_admin"] },
    ],
  },
  {
    section: "transactions",
    items: [
      { to: "/inspections/new", key: "new_inspection", icon: PlusCircle, roles: ["superadmin", "company_admin", "site_admin", "driver", "mechanic"] },
      { to: "/inspections", key: "inspections", icon: ClipboardCheck, roles: ["superadmin", "company_admin", "site_admin"] },
      { to: "/my-inspections", key: "my_inspections", icon: ClipboardCheck, roles: ["driver", "mechanic"] },
    ],
  },
  { section: "reports", items: [{ to: "/recap", key: "recap", icon: BarChart3, roles: ["superadmin", "company_admin", "site_admin"] }] },
];

export function LangToggle() {
  const { lang, setLang } = useT();
  return (
    <div className="inline-flex rounded-full border bg-white p-0.5 text-xs font-semibold" data-testid="lang-toggle">
      {["en", "id"].map((l) => (
        <button
          key={l}
          data-testid={`lang-${l}-btn`}
          onClick={() => setLang(l)}
          className={`rounded-full px-3 py-1 uppercase transition-colors duration-200 ${
            lang === l ? "bg-brand-dark text-white" : "text-muted-foreground hover:text-brand-dark"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function SyncControl() {
  const { t } = useT();
  const { field, online, syncing, pending, lastSyncedAt, sync } = useOffline();
  if (!field) return null;
  const pendingCount = pending.filter((p) => p.status !== "error").length;
  const errCount = pending.filter((p) => p.status === "error").length;
  return (
    <div className="flex items-center gap-2" data-testid="sync-control">
      {!online && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800">
          <WifiOff className="h-3 w-3" /> {t("offline")}
        </span>
      )}
      {(pendingCount > 0 || errCount > 0) && (
        <span className="text-[11px] text-muted-foreground" data-testid="sync-pending">
          {pendingCount + errCount} {t("pending_sync")}
        </span>
      )}
      <Button
        variant="outline"
        size="sm"
        className="rounded-full"
        disabled={syncing || !online}
        onClick={() => sync()}
        data-testid="sync-now-btn"
      >
        <RefreshCw className={`mr-1 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
        {t("sync")}
      </Button>
      {lastSyncedAt && (
        <span className="hidden text-[11px] text-muted-foreground sm:inline">
          {t("last_synced")}: {new Date(lastSyncedAt).toLocaleString()}
        </span>
      )}
    </div>
  );
}

function Sidebar({ onNavigate }) {
  const { user, logout } = useAuth();
  const { t } = useT();
  const navigate = useNavigate();
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="px-5 pb-4 pt-6">
        <img src="/logo.png" alt="Inline Technology" className="h-10 w-auto" />
        <p className="mt-2 font-heading text-xs font-semibold uppercase tracking-[0.2em] text-brand-deep">{t("app_name")}</p>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {NAV.map((sec) => {
          const items = sec.items.filter((i) => i.roles.includes(user.role));
          if (!items.length) return null;
          return (
            <div key={sec.section}>
              <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t(sec.section)}</p>
              {items.map((i) => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  end={i.to === "/" || i.to === "/inspections"}
                  onClick={onNavigate}
                  data-testid={`nav-${i.key}`}
                  className={({ isActive }) => `nav-link ${isActive ? "bg-brand/25 text-brand-dark" : ""}`}
                >
                  <i.icon className="h-4 w-4" />
                  {t(i.key)}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="border-t p-4">
        <div className="mb-3">
          <p className="truncate text-sm font-semibold" data-testid="sidebar-user-name">{user.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="capitalize" data-testid="sidebar-user-role">{t(user.role)}</Badge>
            {user.site_name && <span className="text-xs text-muted-foreground">{user.site_name}</span>}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          data-testid="logout-btn"
          onClick={() => {
            logout();
            navigate("/login");
          }}
        >
          <LogOut className="mr-2 h-4 w-4" /> {t("logout")}
        </Button>
      </div>
    </div>
  );
}

export default function AppLayout() {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r lg:block">
        <Sidebar />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-brand-dark/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 shadow-2xl">
            <Sidebar onNavigate={() => setOpen(false)} />
            <button className="absolute right-3 top-4 rounded-full p-1 text-muted-foreground" onClick={() => setOpen(false)} data-testid="close-menu-btn">
              <X className="h-5 w-5" />
            </button>
          </aside>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-white/80 px-4 backdrop-blur-xl lg:px-8">
          <div className="flex items-center gap-3">
            <button className="rounded-lg p-2 hover:bg-muted lg:hidden" onClick={() => setOpen(true)} data-testid="open-menu-btn">
              <Menu className="h-5 w-5" />
            </button>
            <img src="/logo.png" alt="Inline Technology" className="h-7 lg:hidden" />
          </div>
          <div className="flex items-center gap-2">
            <SyncControl />
            <LangToggle />
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
