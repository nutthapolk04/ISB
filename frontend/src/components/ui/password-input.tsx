import * as React from "react";
import { Eye, EyeOff, Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PASSWORD_RULES, passwordRuleI18nKey } from "@/lib/passwordRules";

interface PasswordInputProps
  extends Omit<React.ComponentProps<"input">, "type" | "value" | "onChange"> {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Show the eye toggle (default true). Disable on fields where revealing
   *  the value is meaningless (e.g. confirm-password — toggling it doesn't
   *  help). */
  toggle?: boolean;
  /** Render the rule checklist underneath the input. Use on create/change
   *  password flows; omit on Login or override prompts. */
  showRequirements?: boolean;
  /** Extra className applied to the wrapper (default empty). */
  wrapperClassName?: string;
}

/**
 * Drop-in replacement for `<Input type="password" />` with a built-in
 * show/hide toggle and an optional requirement checklist. Reveal state is
 * local — every field reveals independently so glancing at one doesn't
 * expose another.
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ toggle = true, showRequirements = false, wrapperClassName, className, value, onChange, ...props }, ref) => {
    const { t } = useTranslation();
    const [visible, setVisible] = React.useState(false);

    return (
      <div className={cn("space-y-2", wrapperClassName)}>
        <div className="relative">
          <Input
            ref={ref}
            type={visible ? "text" : "password"}
            value={value}
            onChange={onChange}
            // Leave room on the right for the toggle button so long values
            // never slip behind the eye icon. Callers can still pass their
            // own className (e.g. error border) — it merges instead of being
            // overwritten by the toggle padding.
            className={cn(toggle && "pr-10", className)}
            {...props}
          />
          {toggle && (
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              // Match the input's interior padding so the button lines up
              // with the placeholder text rather than the border.
              className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
              aria-label={visible ? t("password.hide", "Hide password") : t("password.show", "Show password")}
              tabIndex={-1}
            >
              {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          )}
        </div>

        {showRequirements && (
          <ul className="space-y-1 rounded-md border border-border bg-muted/30 p-3 text-xs">
            {PASSWORD_RULES.map((rule) => {
              const pass = rule.test(value);
              return (
                <li
                  key={rule.key}
                  className={cn(
                    "flex items-center gap-2 transition-colors",
                    pass ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
                  )}
                >
                  {pass ? (
                    <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  ) : (
                    <X className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  )}
                  <span>{t(passwordRuleI18nKey(rule), rule.label)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";
