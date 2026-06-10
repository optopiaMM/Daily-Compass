import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Calendar, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface OutlookStatus {
  configured: boolean;
  connected: boolean;
  accountEmail: string | null;
  accountName: string | null;
  expiresAt: string | null;
}

export default function OutlookConnect() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: status } = useQuery<OutlookStatus>({
    queryKey: ["/api/outlook/status"],
  });

  // Surface the success message after the OAuth bounce-back.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("outlook") === "connected") {
      toast({ title: "Outlook connected", description: "Calendar access is active." });
      // Strip the param so the toast doesn't fire again
      params.delete("outlook");
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

  if (status.connected) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-success" data-testid="outlook-connected">
        <CheckCircle2 className="w-3 h-3" />
        <span>Outlook: {status.accountEmail ?? status.accountName ?? "connected"}</span>
      </div>
    );
  }

  return (
    <Button
      asChild
      variant="outline"
      size="sm"
      className="h-7 text-xs gap-1.5"
      data-testid="button-connect-outlook"
    >
      <a href="/api/outlook/connect">
        <Calendar className="w-3 h-3" />
        Connect Outlook
      </a>
    </Button>
  );
}
