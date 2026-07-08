import { useTranslation } from "react-i18next";
import { formatCurrency as formatTHB } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CreditCard, KeyRound, UserCircle2, Users2 } from "lucide-react";
import { resolveAvatarUrl } from "@/lib/avatarFallback";
import type { UserDetailData } from "./userDetailTypes";

interface UserProfileHeroProps {
  user: UserDetailData;
  onBindCard: () => void;
  onChangePassword: () => void;
}

export function UserProfileHero({ user, onBindCard, onChangePassword }: UserProfileHeroProps) {
  const { t } = useTranslation();
  const initials = user.full_name.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-col sm:flex-row gap-4 items-start">
          <Avatar className="h-24 w-24 shrink-0">
            <AvatarImage src={resolveAvatarUrl(user.photo_url, user.username || user.full_name)} alt={user.full_name} />
            <AvatarFallback className="text-xl">{initials}</AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0 space-y-2">
            <div>
              <h1 className="text-2xl font-bold">{user.full_name}</h1>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {user.role && <Badge variant="outline" className="capitalize">{user.role}</Badge>}
                <Badge className={`border-0 ${user.is_active ? "bg-green-100 text-green-700 hover:bg-green-100" : "bg-red-100 text-red-600 hover:bg-red-100"}`}>
                  {user.is_active ? "Active" : "Inactive"}
                </Badge>
                {user.customer_type && (
                  <Badge className="bg-indigo-100 text-indigo-800 hover:bg-indigo-100 gap-1">
                    <UserCircle2 className="h-3 w-3" /> PS: {user.customer_type}
                  </Badge>
                )}
                {user.staff_type && (
                  <Badge className={`border ${user.staff_type === "Classified Staff" ? "bg-blue-100 text-blue-700 border-blue-300" : "bg-violet-100 text-violet-700 border-violet-300"}`}>
                    {user.staff_type === "Classified Staff" ? "Classified" : "Certified"}
                  </Badge>
                )}
                {user.has_children && (
                  <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 gap-1">
                    <Users2 className="h-3 w-3" /> {t("admin.users.hasChildren")}
                  </Badge>
                )}
              </div>
            </div>
            {user.wallet_balance !== null && user.wallet_balance !== undefined && (
              <div className="rounded-md bg-primary/5 p-4">
                <p className="text-xs text-muted-foreground">{t("admin.users.walletBalance")}</p>
                <p className={`text-3xl font-bold font-mono ${Number(user.wallet_balance) < 0 ? "text-destructive" : "text-primary"}`}>
                  {formatTHB(Number(user.wallet_balance))}
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 w-full sm:w-auto">
            <Button variant="outline" size="sm" onClick={onBindCard}>
              <CreditCard className="h-4 w-4 mr-1" />
              {user.card_uid ? t("admin.users.rebind") : t("admin.users.bindCard")}
            </Button>
            {user.card_uid && (
              <p className="text-xs text-muted-foreground font-mono text-center">{user.card_uid}</p>
            )}
            {user.role !== "parent" && user.role !== "staff" && (
              <Button variant="outline" size="sm" onClick={onChangePassword}>
                <KeyRound className="h-4 w-4 mr-1" />
                Change Password
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
