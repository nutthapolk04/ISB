import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

interface BackButtonProps {
  to?: string;
}

/**
 * Raised/elevated Back button — white background with shadow, slate text.
 * Used consistently across all parent pages.
 */
export function BackButton({ to = "/parent/dashboard" }: BackButtonProps) {
  const { t } = useTranslation();
  return (
    <Button
      asChild
      variant="outline"
      size="sm"
      className="h-10 bg-white border-slate-200 text-slate-700 shadow-md hover:shadow-lg hover:bg-slate-50 hover:text-slate-900 rounded-xl"
    >
      <Link to={to}>
        <ArrowLeft className="h-4 w-4 mr-1.5" />
        {t("parent.common.back", "Back")}
      </Link>
    </Button>
  );
}
