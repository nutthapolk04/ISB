import { Navigate, Outlet } from "react-router-dom";
import { useAuth, moduleOf, type AppModule } from "@/contexts/AuthContext";

interface RequireModuleProps {
  module: AppModule;
}

export function RequireModule({ module }: RequireModuleProps) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  const activeRole = user.activeRole ?? user.role;
  if (activeRole === "admin") return <Outlet />;
  // Users without shop access (pure parent/staff) belong on /parent/dashboard.
  // Multi-role users with shopId (e.g. parent+manager) stay on the module route
  // even when activeRole=parent — capability, not mode, decides access.
  if (!user.shopId) return <Navigate to="/parent/dashboard" replace />;
  // Prefer authoritative shopModule (from backend), fall back to id-based inference.
  const userModule = user.shopModule ?? moduleOf(user.shopId);
  if (userModule !== module) return <Navigate to="/" replace />;
  return <Outlet />;
}
