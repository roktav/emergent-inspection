import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import "@/App.css";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { LangProvider } from "./lib/i18n";
import AppLayout from "./components/AppLayout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import InspectionsPage from "./pages/InspectionsPage";
import InspectionFormPage from "./pages/InspectionFormPage";
import InspectionDetailPage from "./pages/InspectionDetailPage";
import RecapPage from "./pages/RecapPage";
import {
  CategoriesPage, CompaniesPage, InspectionTypesPage, ItemsPage, SitesPage,
  TrucksPage, UsersPage, VehicleCategoriesPage,
} from "./pages/MasterPages";

function Protected({ roles }) {
  const { user } = useAuth();
  if (user === null) return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <Outlet />;
}

function PublicOnly({ children }) {
  const { user } = useAuth();
  if (user) return <Navigate to="/" replace />;
  return children;
}

const SUPER = ["superadmin"];
const COMPANY_ADMINS = ["superadmin", "company_admin"];
const SITE_ADMINS = ["superadmin", "company_admin", "site_admin"];

export default function App() {
  return (
    <LangProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
            <Route element={<Protected />}>
              <Route element={<AppLayout />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/inspections" element={<InspectionsPage />} />
                <Route path="/inspections/new" element={<InspectionFormPage />} />
                <Route path="/inspections/:id" element={<InspectionDetailPage />} />
                <Route element={<Protected roles={SUPER} />}>
                  <Route path="/companies" element={<CompaniesPage />} />
                </Route>
                <Route element={<Protected roles={COMPANY_ADMINS} />}>
                  <Route path="/sites" element={<SitesPage />} />
                  <Route path="/vehicle-categories" element={<VehicleCategoriesPage />} />
                  <Route path="/categories" element={<CategoriesPage />} />
                  <Route path="/items" element={<ItemsPage />} />
                  <Route path="/inspection-types" element={<InspectionTypesPage />} />
                </Route>
                <Route element={<Protected roles={SITE_ADMINS} />}>
                  <Route path="/users" element={<UsersPage />} />
                  <Route path="/trucks" element={<TrucksPage />} />
                  <Route path="/recap" element={<RecapPage />} />
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" richColors toastOptions={{ style: { fontFamily: "Roboto, sans-serif" } }} />
      </AuthProvider>
    </LangProvider>
  );
}
