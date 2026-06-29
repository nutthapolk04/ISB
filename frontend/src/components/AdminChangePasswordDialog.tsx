import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { isPasswordValid } from "@/lib/passwordRules";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

interface AdminChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: number;
  userName: string;
}

export function AdminChangePasswordDialog({
  open,
  onOpenChange,
  userId,
  userName,
}: AdminChangePasswordDialogProps) {
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => { setNext(""); setConfirm(""); };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) reset();
    onOpenChange(isOpen);
  };

  const newValid = isPasswordValid(next);
  const matchValid = next === confirm;
  const canSubmit = newValid && matchValid && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await api.patch<void>(`/users-admin/${userId}/password`, { new_password: next });
      toast({ title: "Password changed", description: `Password for ${userName} has been updated.` });
      reset();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Failed to change password",
        description: err instanceof ApiError ? err.detail : "An error occurred.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change Password</DialogTitle>
          <DialogDescription>Set a new password for <strong>{userName}</strong>.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="acp-new">New Password</Label>
            <PasswordInput
              id="acp-new"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              autoFocus
              showRequirements
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acp-confirm">Confirm Password</Label>
            <PasswordInput
              id="acp-confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
            {confirm.length > 0 && !matchValid && (
              <p className="text-xs text-destructive">Passwords do not match</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleClose(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Change Password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
