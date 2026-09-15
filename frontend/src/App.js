import { Navigate, Outlet, RouterProvider, createBrowserRouter } from "react-router-dom";
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
import MyInspectionsPage from "./pages/MyInspectionsPage";
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

const router = createBrowserRouter([
  { path: "/login", element: <PublicOnly><LoginPage /></PublicOnly> },
  {
    element: <Protected />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: "/", element: <DashboardPage /> },
          { path: "/inspections", element: <InspectionsPage /> },
          { path: "/inspections/new", element: <InspectionFormPage /> },
          { path: "/inspections/:id", element: <InspectionDetailPage /> },
          { path: "/my-inspections", element: <MyInspectionsPage /> },
          {
            element: <Protected roles={SUPER} />,
            children: [{ path: "/companies", element: <CompaniesPage /> }],
          },
          {
            element: <Protected roles={COMPANY_ADMINS} />,
            children: [
              { path: "/sites", element: <SitesPage /> },
              { path: "/vehicle-categories", element: <VehicleCategoriesPage /> },
              { path: "/categories", element: <CategoriesPage /> },
              { path: "/items", element: <ItemsPage /> },
              { path: "/inspection-types", element: <InspectionTypesPage /> },
            ],
          },
          {
            element: <Protected roles={SITE_ADMINS} />,
            children: [
              { path: "/users", element: <UsersPage /> },
              { path: "/trucks", element: <TrucksPage /> },
              { path: "/recap", element: <RecapPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

export default function App() {
  return (
    <LangProvider>
      <AuthProvider>
        <RouterProvider router={router} />
        <Toaster position="top-right" richColors toastOptions={{ style: { fontFamily: "Roboto, sans-serif" } }} />
      </AuthProvider>
    </LangProvider>
  );
}
