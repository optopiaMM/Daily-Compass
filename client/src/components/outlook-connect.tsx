import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Calendar, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
  const { data: status } = useQuery<OutlookStatus>({
    queryKey: ["/api/outlook/status"],
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("outlook") === "connected") {
      toast({ title: "Outlook connected", description: "Account added." });
      params.delete("outlook");
      params.delete("account");
      const newSearch = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (newSearch ? `?${newSearch}` : ""));
      queryClient.invalidateQueries({ queryKey: ["/api/outlook/status"] });
    }
  }, [toast, queryClient]);

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

  const writer = status.accounts.find((a) => a.role === "read_write");
  const readOnlyCount = status.accounts.filter((a) => a.role === "read_only").length;

  return (
    <div className="flex items-center gap-1.5 text-[11px] text-success" data-testid="outlook-connected">
      <CheckCircle2 className="w-3 h-3" />
      <span>
        Outlook: {writer?.accountEmail ?? writer?.accountKey ?? "(no writer)"}
        {readOnlyCount > 0 ? ` +${readOnlyCount} read-only` : ""}
      </span>
    </div>
  );
}
