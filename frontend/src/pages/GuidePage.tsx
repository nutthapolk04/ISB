import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth, type UserRole } from "@/contexts/AuthContext";
import {
  ShieldCheck,
  Users,
  UtensilsCrossed,
  Store,
  BarChart3,
  ChevronRight,
  Wallet,
  FileText,
  Settings,
  CreditCard,
  Search,
  ShoppingCart,
  RotateCcw,
  TrendingUp,
  Package,
  ArrowLeftRight,
  BookOpen,
  Building2,
  UserSearch,
  Layers,
  Upload,
  History as HistoryIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Step {
  titleKey: string;
  descKey: string;
  icon: React.ElementType;
}

interface RoleGuide {
  id: string;
  labelKey: string;
  descKey: string;
  icon: React.ElementType;
  color: string;
  steps: Step[];
}

const roleGuides: RoleGuide[] = [
  {
    id: "admin",
    labelKey: "guide.roles.admin",
    descKey: "guide.roles.adminDesc",
    icon: ShieldCheck,
    color: "text-violet-600",
    steps: [
      {
        titleKey: "guide.admin.step1.title",
        descKey: "guide.admin.step1.desc",
        icon: Users,
      },
      {
        titleKey: "guide.admin.step2.title",
        descKey: "guide.admin.step2.desc",
        icon: CreditCard,
      },
      {
        titleKey: "guide.admin.step3.title",
        descKey: "guide.admin.step3.desc",
        icon: Wallet,
      },
      {
        titleKey: "guide.admin.step4.title",
        descKey: "guide.admin.step4.desc",
        icon: ArrowLeftRight,
      },
      {
        titleKey: "guide.admin.step5.title",
        descKey: "guide.admin.step5.desc",
        icon: BarChart3,
      },
      {
        titleKey: "guide.admin.step6.title",
        descKey: "guide.admin.step6.desc",
        icon: Settings,
      },
      {
        titleKey: "guide.admin.step7.title",
        descKey: "guide.admin.step7.desc",
        icon: Users,
      },
      {
        titleKey: "guide.admin.step8.title",
        descKey: "guide.admin.step8.desc",
        icon: Building2,
      },
      {
        titleKey: "guide.admin.step9.title",
        descKey: "guide.admin.step9.desc",
        icon: Layers,
      },
      {
        titleKey: "guide.admin.step10.title",
        descKey: "guide.admin.step10.desc",
        icon: Upload,
      },
      {
        titleKey: "guide.admin.step11.title",
        descKey: "guide.admin.step11.desc",
        icon: HistoryIcon,
      },
    ],
  },
  {
    id: "parent",
    labelKey: "guide.roles.parent",
    descKey: "guide.roles.parentDesc",
    icon: Users,
    color: "text-sky-600",
    steps: [
      {
        titleKey: "guide.parent.step1.title",
        descKey: "guide.parent.step1.desc",
        icon: Search,
      },
      {
        titleKey: "guide.parent.step2.title",
        descKey: "guide.parent.step2.desc",
        icon: Wallet,
      },
      {
        titleKey: "guide.parent.step3.title",
        descKey: "guide.parent.step3.desc",
        icon: FileText,
      },
      {
        titleKey: "guide.parent.step4.title",
        descKey: "guide.parent.step4.desc",
        icon: CreditCard,
      },
    ],
  },
  {
    id: "canteen",
    labelKey: "guide.roles.canteen",
    descKey: "guide.roles.canteenDesc",
    icon: UtensilsCrossed,
    color: "text-orange-600",
    steps: [
      {
        titleKey: "guide.canteen.step1.title",
        descKey: "guide.canteen.step1.desc",
        icon: ShoppingCart,
      },
      {
        titleKey: "guide.canteen.step2.title",
        descKey: "guide.canteen.step2.desc",
        icon: CreditCard,
      },
      {
        titleKey: "guide.canteen.step3.title",
        descKey: "guide.canteen.step3.desc",
        icon: FileText,
      },
      {
        titleKey: "guide.canteen.step4.title",
        descKey: "guide.canteen.step4.desc",
        icon: BarChart3,
      },
      {
        titleKey: "guide.canteen.step5.title",
        descKey: "guide.canteen.step5.desc",
        icon: UserSearch,
      },
      {
        titleKey: "guide.canteen.step6.title",
        descKey: "guide.canteen.step6.desc",
        icon: Building2,
      },
    ],
  },
  {
    id: "store",
    labelKey: "guide.roles.store",
    descKey: "guide.roles.storeDesc",
    icon: Store,
    color: "text-emerald-600",
    steps: [
      {
        titleKey: "guide.store.step1.title",
        descKey: "guide.store.step1.desc",
        icon: ShoppingCart,
      },
      {
        titleKey: "guide.store.step2.title",
        descKey: "guide.store.step2.desc",
        icon: CreditCard,
      },
      {
        titleKey: "guide.store.step3.title",
        descKey: "guide.store.step3.desc",
        icon: RotateCcw,
      },
      {
        titleKey: "guide.store.step4.title",
        descKey: "guide.store.step4.desc",
        icon: Package,
      },
      {
        titleKey: "guide.store.step5.title",
        descKey: "guide.store.step5.desc",
        icon: FileText,
      },
    ],
  },
  {
    id: "manager",
    labelKey: "guide.roles.manager",
    descKey: "guide.roles.managerDesc",
    icon: BarChart3,
    color: "text-rose-600",
    steps: [
      {
        titleKey: "guide.manager.step1.title",
        descKey: "guide.manager.step1.desc",
        icon: TrendingUp,
      },
      {
        titleKey: "guide.manager.step2.title",
        descKey: "guide.manager.step2.desc",
        icon: Package,
      },
      {
        titleKey: "guide.manager.step3.title",
        descKey: "guide.manager.step3.desc",
        icon: Users,
      },
      {
        titleKey: "guide.manager.step4.title",
        descKey: "guide.manager.step4.desc",
        icon: BarChart3,
      },
      {
        titleKey: "guide.manager.step5.title",
        descKey: "guide.manager.step5.desc",
        icon: Settings,
      },
      {
        titleKey: "guide.manager.step6.title",
        descKey: "guide.manager.step6.desc",
        icon: Upload,
      },
    ],
  },
];

export default function GuidePage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  // Filter the role guides to only the role the signed-in user actually
  // plays. Admin sees every role (so support staff who need to coach a
  // cashier can still flip through their guide). Everyone else sees just
  // their own role's steps — no point in a cashier reading admin docs and
  // wondering where the menu items are.
  //
  // Effective role = the user's activeRole (multi-role users pick it on the
  // Role Picker) and falls back to their primary user.role.
  const effectiveRole = (user?.activeRole ?? user?.role ?? "cashier") as UserRole;
  // cashier has no dedicated guide — map to canteen or store based on shop module
  const guideRole = useMemo(() => {
    // cashier / kitchen → map to their shop module's guide
    if (effectiveRole === "cashier" || effectiveRole === "kitchen") {
      const mod = user?.shopModule ?? (user?.shopId?.startsWith("canteen") ? "canteen" : "store");
      return mod === "canteen" ? "canteen" : "store";
    }
    // staff with a shop assignment → same mapping as cashier
    if (effectiveRole === "staff" && (user?.shopModule || user?.shopId)) {
      const mod = user?.shopModule ?? (user?.shopId?.startsWith("canteen") ? "canteen" : "store");
      return mod === "canteen" ? "canteen" : "store";
    }
    // staff without shop (e.g. teacher) → no dedicated guide, fallback shows all
    return effectiveRole;
  }, [effectiveRole, user]);

  const visibleGuides = useMemo(() => {
    if (guideRole === "admin") return roleGuides;
    const matched = roleGuides.filter((g) => g.id === guideRole);
    // Fallback: unknown role → show all guides rather than silently defaulting to admin
    return matched.length > 0 ? matched : roleGuides;
  }, [guideRole]);

  // Initial selection — first visible guide. If the user only sees one
  // role, the sidebar collapses to that single tab (still useful as a
  // visual anchor showing which role's docs they're reading).
  const [activeRole, setActiveRole] = useState<string>(
    visibleGuides[0]?.id ?? roleGuides[0].id,
  );

  const activeGuide =
    visibleGuides.find((r) => r.id === activeRole) ?? visibleGuides[0] ?? roleGuides[0];

  return (
    <div className="flex flex-col min-h-full">
      {/* Page header */}
      <div className="page-header border-b rounded-none">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <BookOpen className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="page-title text-xl">
              {t("guide.title")}
            </h1>
            <p className="page-description">{t("guide.subtitle")}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — role tabs */}
        <aside className="w-64 shrink-0 border-r bg-muted/30 p-4 space-y-1 overflow-y-auto">
          <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("guide.selectRole")}
          </p>
          {visibleGuides.map((role) => {
            const Icon = role.icon;
            const isActive = role.id === activeRole;
            return (
              <button
                key={role.id}
                onClick={() => setActiveRole(role.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                  isActive
                    ? "bg-background shadow-sm text-foreground font-medium"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                )}
              >
                <Icon
                  className={cn("h-4 w-4 shrink-0", isActive ? role.color : "")}
                />
                <span className="flex-1 truncate">{t(role.labelKey)}</span>
                {isActive && (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
              </button>
            );
          })}
        </aside>

        {/* Content — steps */}
        <main className="flex-1 overflow-y-auto p-6">
          {/* Role header */}
          <div className="mb-6 flex items-start gap-4">
            <div
              className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
                "bg-muted"
              )}
            >
              <activeGuide.icon
                className={cn("h-6 w-6", activeGuide.color)}
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">
                  {t(activeGuide.labelKey)}
                </h2>
                <Badge variant="secondary" className="text-xs">
                  {t("guide.stepsCount", { count: activeGuide.steps.length })}
                </Badge>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t(activeGuide.descKey)}
              </p>
            </div>
          </div>

          {/* Steps */}
          <div className="space-y-4">
            {activeGuide.steps.map((step, index) => {
              const StepIcon = step.icon;
              return (
                <Card
                  key={index}
                  className="border border-border/60 shadow-none transition-shadow hover:shadow-sm"
                >
                  <CardHeader className="pb-2 pt-4">
                    <CardTitle className="flex items-center gap-3 text-base font-medium">
                      {/* Step number badge */}
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                          "bg-primary text-primary-foreground"
                        )}
                      >
                        {index + 1}
                      </span>
                      {/* Step icon */}
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                          "bg-muted"
                        )}
                      >
                        <StepIcon className={cn("h-4 w-4", activeGuide.color)} />
                      </span>
                      {t(step.titleKey)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4 pt-0">
                    <p className="text-sm text-muted-foreground leading-relaxed pl-[3.5rem]">
                      {t(step.descKey)}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Footer note */}
          <p className="mt-8 text-xs text-muted-foreground text-center">
            {t("guide.footer")}
          </p>
        </main>
      </div>
    </div>
  );
}
