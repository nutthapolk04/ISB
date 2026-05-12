import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export interface StaffPickerUser {
  id: number;
  username: string;
  full_name: string | null;
  role: string;
  external_id: string | null;
  photo_url: string | null;
}

interface Props {
  value: number | null;
  onChange: (userId: number | null, user: StaffPickerUser | null) => void;
  roles?: string[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export default function UserPicker({ value, onChange, roles, placeholder, disabled, className }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<StaffPickerUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (roles && roles.length) params.set("roles", roles.join(","));
    api
      .get<StaffPickerUser[]>(`/users-admin/staff-picker${params.toString() ? `?${params}` : ""}`)
      .then((rows) => {
        if (!cancelled) setUsers(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.detail : "Failed to load staff");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [roles?.join(",")]);

  const selected = useMemo(() => users.find((u) => u.id === value) ?? null, [users, value]);

  const buttonLabel = selected
    ? selected.full_name || selected.username
    : (placeholder ?? t("requisition.selectRequester", "Search staff…"));

  return (
    <div className={className}>
      <Popover open={open} onOpenChange={setOpen} modal={true}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled || loading}
            className="w-full justify-between font-normal"
          >
            <span className={cn("truncate", !selected && "text-muted-foreground")}>{buttonLabel}</span>
            <span className="flex items-center gap-1 ml-2 shrink-0">
              {selected && (
                <X
                  className="h-4 w-4 opacity-50 hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(null, null);
                  }}
                />
              )}
              <ChevronsUpDown className="h-4 w-4 opacity-50" />
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command
            filter={(haystack, search) => {
              const u = users.find((x) => String(x.id) === haystack);
              if (!u) return 0;
              const blob = `${u.full_name ?? ""} ${u.username} ${u.role} ${u.external_id ?? ""}`.toLowerCase();
              return blob.includes(search.toLowerCase()) ? 1 : 0;
            }}
          >
            <CommandInput placeholder={t("requisition.searchStaffPlaceholder", "Type name, username, or ID…")} />
            <CommandList onWheel={(e) => e.stopPropagation()}>
              <CommandEmpty>{t("requisition.noStaffFound", "No staff matched")}</CommandEmpty>
              {users.map((u) => (
                <CommandItem
                  key={u.id}
                  value={String(u.id)}
                  onSelect={() => {
                    onChange(u.id, u);
                    setOpen(false);
                  }}
                  className="flex items-center gap-2"
                >
                  <Check
                    className={cn("h-4 w-4 shrink-0", value === u.id ? "opacity-100" : "opacity-0")}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm">{u.full_name || u.username}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {u.username}
                      {u.external_id ? ` · ${u.external_id}` : ""}
                      <span className="ml-2 uppercase">{u.role}</span>
                    </p>
                  </div>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
