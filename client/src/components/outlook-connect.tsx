import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Calendar, CheckCircle2, Eye, Pencil, Plus, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface OutlookAccount {
  accountKey: string;
  accountEmail: string | null;
  accountName: string | null;
  role: "read_write" | "read_only";
  expiresAt: string | null;
}

interface OutlookStatus {
  configured: boolean;
  connected: boolean;
  accounts: OutlookAccount[];
}

export default function OutlookConnect() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const { data: status } = useQuery<OutlookStatus>({
    queryKey: ["/api/outlook/status"],
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("outlook") === "connected") {
      const acct = params.get("account");
      toast({
        title: "Outlook connected",
        description: acct ? `Added account "${acct}".` : "Account added.",
      });
      params.delete("outlook");
      params.delete("account");
      const newSearch = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (newSearch ? `?${newSearch}` : ""));
      queryClient.invalidateQueries({ queryKey: ["/api/outlook/status"] });
    }
  }, [toast, queryClient]);

  const disconnect = useMutation({
    mutationFn: async (accountKey: string) => {
      await apiRequest("POST", "/api/outlook/disconnect", { accountKey });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/outlook/status"] }),
    onError: (err: Error) => toast({ title: "Disconnect failed", description: err.message, variant: "destructive" }),
  });

  const setRole = useMutation({
    mutationFn: async (vars: { accountKey: string; role: "read_write" | "read_only" }) => {
      await apiRequest("POST", "/api/outlook/role", vars);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/outlook/status"] }),
    onError: (err: Error) => toast({ title: "Couldn't change role", description: err.message, variant: "destructive" }),
  });

  if (!status) return null;
  if (!status.configured) {
    return (
      <div className="text-[11px] text-muted-foreground italic">
        Outlook integration not configured on server
      </div>
    );
  }

  if (status.accounts.length === 0) {
    return (
      <Button asChild variant="outline" size="sm" className="h-7 text-xs gap-1.5" data-testid="button-connect-outlook">
        <a href="/api/outlook/connect">
          <Calendar className="w-3 h-3" />
          Connect Outlook
        </a>
      </Button>
    );
  }

  const writeCount = status.accounts.filter((a) => a.role === "read_write").length;

  return (
    <div className="text-[11px]" data-testid="outlook-accounts">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-success"
      >
        <CheckCircle2 className="w-3 h-3" />
        <span>
          {status.accounts.length} Outlook account{status.accounts.length === 1 ? "" : "s"}
          {writeCount === 0 ? " · no writer set" : ""}
        </span>
        <span className="text-muted-foreground">({expanded ? "hide" : "manage"})</span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5">
          {status.accounts.map((acct) => (
            <div key={acct.accountKey} className="flex items-center justify-between gap-2 bg-card border rounded p-1.5">
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{acct.accountEmail ?? acct.accountKey}</div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  {acct.role === "read_write" ? (
                    <>
                      <Pencil className="w-2.5 h-2.5 text-success" />
                      <span className="text-success">writes here</span>
                    </>
                  ) : (
                    <>
                      <Eye className="w-2.5 h-2.5" />
                      <span>read-only</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-1">
                {acct.role === "read_only" && (
                  <button
                    onClick={() => setRole.mutate({ accountKey: acct.accountKey, role: "read_write" })}
                    disabled={setRole.isPending}
                    className="text-info underline"
                    title="Make this the account events get created in"
                    data-testid={`button-promote-${acct.accountKey}`}
                  >
                    make writer
                  </button>
                )}
                <button
                  onClick={() => disconnect.mutate(acct.accountKey)}
                  disabled={disconnect.isPending}
                  className="text-muted-foreground hover:text-destructive p-0.5"
                  aria-label="Disconnect"
                  data-testid={`button-disconnect-${acct.accountKey}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
          <Button asChild variant="outline" size="sm" className="h-7 text-xs gap-1.5 w-full" data-testid="button-add-outlook">
            <a href="/api/outlook/connect">
              <Plus className="w-3 h-3" />
              Add another Outlook (read-only)
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}
