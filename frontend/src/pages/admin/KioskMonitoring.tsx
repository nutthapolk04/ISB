import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { useDebounce } from "@/hooks/useDebounce";
import { fmtDateTime } from "@/lib/dateFormat";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Wifi, WifiOff, HelpCircle, Search, Users as UsersIcon } from "lucide-react";

interface KioskCustodian {
  user_id: number;
  full_name: string;
  email: string;
}

interface KioskMonitoringItem {
  user_id: number;
  username: string;
  location: string;
  status: "online" | "offline" | "never_checked_in";
  last_heartbeat_at: string | null;
  offline_since: string | null;
  custodians: KioskCustodian[];
}

interface StaffPickerItem {
  id: number;
  username: string;
  full_name: string;
  role: string | null;
  external_id: string | null;
}

// Refresh cadence: fast enough that an admin watching this page sees a
// status flip without reloading, slow enough not to hammer the endpoint —
// the backend sweep itself only runs once a minute anyway.
const POLL_MS = 30_000;

function StatusBadge({ status }: { status: KioskMonitoringItem["status"] }) {
  const { t } = useTranslation();
  if (status === "online") {
    return (
      <Badge className="gap-1 border-0 bg-green-100 text-green-700 hover:bg-green-100">
        <Wifi className="h-3 w-3" /> {t("admin.kioskMonitoring.statusOnline", "Online")}
      </Badge>
    );
  }
  if (status === "offline") {
    return (
      <Badge className="gap-1 border-0 bg-red-100 text-red-700 hover:bg-red-100">
        <WifiOff className="h-3 w-3" /> {t("admin.kioskMonitoring.statusOffline", "Offline")}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <HelpCircle className="h-3 w-3" /> {t("admin.kioskMonitoring.statusNeverCheckedIn", "Never checked in")}
    </Badge>
  );
}

export default function KioskMonitoring() {
  const { t } = useTranslation();
  const [kiosks, setKiosks] = useState<KioskMonitoringItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState<KioskMonitoringItem | null>(null);
  const [candidates, setCandidates] = useState<StaffPickerItem[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  // /users-admin/staff-picker's own default role list (staff, manager,
  // cashier, kitchen, admin) misses "teacher" and other legitimate
  // staff-ish roles — pass the full set explicitly so e.g. a teacher
  // account isn't invisible to this picker.
  const CUSTODIAN_ROLES = "staff,teacher,manager,cashier,kitchen,admin,canteen_owner,refund_officer,finance";

  const load = async () => {
    try {
      const data = await api.get<KioskMonitoringItem[]>("/admin/kiosk-monitoring");
      setKiosks(data);
    } catch (e) {
      toast({
        title: t("admin.kioskMonitoring.loadError", "Failed to load kiosk status"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, []);

  const openEdit = (k: KioskMonitoringItem) => {
    setEditing(k);
    setSelectedIds(new Set(k.custodians.map((c) => c.user_id)));
    setSearch("");
  };

  // Server-side search, not client-side filtering — the picker endpoint caps
  // results at 200 rows (ordered by full_name), so fetching once with no
  // query and then filtering in the browser silently hides anyone who don't
  // fit in that first page alphabetically. Sending the typed text as `q`
  // lets the DB filter BEFORE the cap applies, so a targeted search always
  // finds a match regardless of how many staff exist. Also (re-)fires when
  // the dialog opens, since debouncedSearch starts at "" already.
  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    setCandidatesLoading(true);
    const params = new URLSearchParams({ roles: CUSTODIAN_ROLES });
    if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
    api
      .get<StaffPickerItem[]>(`/users-admin/staff-picker?${params.toString()}`)
      .then((staff) => { if (!cancelled) setCandidates(staff); })
      .catch((e) => {
        if (cancelled) return;
        toast({
          title: t("admin.kioskMonitoring.loadStaffError", "Failed to load staff list"),
          description: e instanceof ApiError ? e.detail : "Unknown error",
          variant: "destructive",
        });
      })
      .finally(() => { if (!cancelled) setCandidatesLoading(false); });
    return () => { cancelled = true; };
  }, [editing, debouncedSearch]);

  const toggleCandidate = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveCustodians = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await api.put(`/admin/kiosk-monitoring/${editing.user_id}/custodians`, {
        custodian_user_ids: Array.from(selectedIds),
      });
      toast({ title: t("admin.kioskMonitoring.saveSuccess", "Custodians updated") });
      setEditing(null);
      await load();
    } catch (e) {
      toast({
        title: t("admin.kioskMonitoring.saveError", "Failed to update custodians"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  // Search by full name / external_id only — username is deliberately
  // excluded per admin request (usernames aren't how staff recognize each
  // other; searching by them just surfaces confusing false matches).
  const filteredCandidates = candidates.filter((c) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      c.full_name.toLowerCase().includes(q) ||
      (c.external_id ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <Wifi className="h-6 w-6" /> {t("admin.kioskMonitoring.title", "Kiosk Monitoring")}
        </h1>
        <p className="page-description">
          {t(
            "admin.kioskMonitoring.description",
            "Tracks whether each kiosk is online, and who to notify if one goes offline",
          )}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("admin.kioskMonitoring.listTitle", "Kiosks")}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm">{t("admin.kioskMonitoring.loading", "Loading…")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.kioskMonitoring.colLocation", "Location")}</TableHead>
                  <TableHead>{t("admin.kioskMonitoring.colUsername", "Username")}</TableHead>
                  <TableHead>{t("admin.kioskMonitoring.colStatus", "Status")}</TableHead>
                  <TableHead>{t("admin.kioskMonitoring.colLastSeen", "Last seen")}</TableHead>
                  <TableHead>{t("admin.kioskMonitoring.colCustodians", "Custodians")}</TableHead>
                  <TableHead className="text-right">{t("admin.kioskMonitoring.colActions", "Actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {kiosks.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      {t("admin.kioskMonitoring.noResults", "No kiosk devices found.")}
                    </TableCell>
                  </TableRow>
                )}
                {kiosks.map((k) => (
                  <TableRow key={k.user_id}>
                    <TableCell className="font-medium">{k.location}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono text-xs">{k.username}</Badge>
                    </TableCell>
                    <TableCell><StatusBadge status={k.status} /></TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {k.last_heartbeat_at ? fmtDateTime(k.last_heartbeat_at) : "—"}
                    </TableCell>
                    <TableCell>
                      {k.custodians.length === 0 ? (
                        <span className="text-xs text-muted-foreground italic">
                          {t("admin.kioskMonitoring.noCustodians", "None assigned")}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {k.custodians.map((c) => (
                            <Badge key={c.user_id} variant="outline" className="font-normal">{c.full_name}</Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => openEdit(k)} className="gap-1">
                        <UsersIcon className="h-3.5 w-3.5" /> {t("admin.kioskMonitoring.editCustodians", "Assign")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {t("admin.kioskMonitoring.dialogTitle", { location: editing?.location ?? "" })}
            </DialogTitle>
            <DialogDescription>
              {t(
                "admin.kioskMonitoring.dialogDesc",
                "These staff get an email if this kiosk goes offline (and when it comes back).",
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("admin.kioskMonitoring.searchStaff", "Search staff by name or username…")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex-1 overflow-y-auto border rounded-md divide-y">
            {candidatesLoading ? (
              <p className="text-sm text-muted-foreground p-4">{t("admin.kioskMonitoring.loading", "Loading…")}</p>
            ) : filteredCandidates.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4">{t("admin.kioskMonitoring.noStaffFound", "No staff matched")}</p>
            ) : (
              filteredCandidates.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-3 p-2.5 hover:bg-muted/50 cursor-pointer"
                >
                  <Checkbox
                    checked={selectedIds.has(c.id)}
                    onCheckedChange={() => toggleCandidate(c.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm">{c.full_name || c.external_id || "—"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t("cardholders.colIsbId", "ISB ID")}: {c.external_id || "—"}{c.role ? ` · ${c.role}` : ""}
                    </p>
                  </div>
                </label>
              ))
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              {t("admin.kioskMonitoring.cancel", "Cancel")}
            </Button>
            <Button onClick={saveCustodians} disabled={saving}>
              {saving ? t("admin.kioskMonitoring.saving", "Saving…") : t("admin.kioskMonitoring.save", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
