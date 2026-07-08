import { Navigate, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
    ShieldCheck,
    Store,
    CreditCard,
    ChefHat,
    Heart,
    UserCheck,
    GraduationCap,
    LogIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth, UserRole, moduleOf } from "@/contexts/AuthContext";
import type { LucideIcon } from "lucide-react";

interface RoleMeta {
    icon: LucideIcon;
    color: string;
    descKey: string;
}

const ROLE_META: Partial<Record<UserRole, RoleMeta>> = {
    admin: { icon: ShieldCheck, color: "text-red-500", descKey: "roles.adminDesc" },
    manager: { icon: Store, color: "text-primary", descKey: "roles.managerDesc" },
    cashier: { icon: CreditCard, color: "text-blue-500", descKey: "roles.cashierDesc" },
    kitchen: { icon: ChefHat, color: "text-orange-500", descKey: "roles.kitchenDesc" },
    parent: { icon: Heart, color: "text-pink-500", descKey: "roles.parentDesc" },
    staff: { icon: UserCheck, color: "text-teal-500", descKey: "roles.staffDesc" },
    teacher: { icon: GraduationCap, color: "text-violet-500", descKey: "roles.teacherDesc" },
};

export default function RolePicker() {
    const { user, setActiveRole } = useAuth();
    const navigate = useNavigate();
    const { t } = useTranslation();

    if (!user) return <Navigate to="/login" replace />;
    if (user.allRoles.length <= 1) return <Navigate to="/" replace />;

    const handleSelect = (role: UserRole) => {
        setActiveRole(role);
        // Dispatch to the correct home route for the selected role
        if (role === "admin") { navigate("/admin", { replace: true }); return; }
        if (role === "parent" || role === "staff") { navigate("/parent/dashboard", { replace: true }); return; }
        const mod = user.shopModule ?? moduleOf(user.shopId);
        navigate(mod === "canteen" ? "/canteen" : "/store", { replace: true });
    };

    return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
            {/* Header */}
            <div className="mb-8 text-center space-y-2">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 mb-3">
                    <span className="text-2xl font-bold text-primary">ISB</span>
                </div>
                <h1 className="text-2xl font-bold tracking-tight">{t("rolePicker.title")}</h1>
                <p className="text-muted-foreground max-w-sm">
                    {t("rolePicker.greeting", { name: user.fullName })}
                </p>
                <p className="text-sm text-muted-foreground">{t("rolePicker.subtitle")}</p>
            </div>

            {/* Role cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full max-w-2xl">
                {user.allRoles.map((role) => {
                    const meta = ROLE_META[role];
                    const Icon = meta?.icon ?? UserCheck;
                    const colorClass = meta?.color ?? "text-muted-foreground";
                    return (
                        <button
                            key={role}
                            onClick={() => handleSelect(role)}
                            className="group flex flex-col items-center gap-3 rounded-xl border border-border/80 bg-card/80 p-6 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md hover:shadow-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            <div className={`rounded-full bg-muted p-3 transition-colors group-hover:bg-primary/10 ${colorClass}`}>
                                <Icon className="h-7 w-7" />
                            </div>
                            <div className="space-y-1">
                                <p className="font-semibold">{t(`roles.${role}`, role)}</p>
                                {meta?.descKey && (
                                    <p className="text-xs text-muted-foreground leading-snug">
                                        {t(meta.descKey, "")}
                                    </p>
                                )}
                            </div>
                            <div className="mt-1 flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                                <LogIn className="h-3.5 w-3.5" />
                                {t("rolePicker.continueAs")}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
