import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { RotateCcw, CalendarDays, CalendarPlus, Trash2 } from "lucide-react";
import type { DailyItem } from "@shared/schema";
import { formatShortDate, getRemainingDaysOfWeek, getNextMonday } from "@/lib/dateUtils";

interface PreviousDayReviewStepProps { date: string; onNext: () => void; }

type Action = "carry" | "delay_day" | "delay_next_week" | "discard";

interface Decision { itemId: number; action: Action; scheduledDate?: string; }

export default function PreviousDayReviewStep({ date, onNext }: PreviousDayReviewStepProps) {
  const { toast } = useToast();

  const { data, isLoading } = useQuery<{ items: DailyItem[]; fromDate: string }>({
    queryKey: ["/api/previous-day-items", date],
  });

  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [pickerForItem, setPickerForItem] = useState<number | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      const payload = Object.values(decisions).filter((d) => d.action !== "discard");
      await apiRequest("POST", "/api/previous-day-review", { date, decisions: payload });
    },
    onSuccess: () => onNext(),
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (!isLoading && data && data.items.length === 0) onNext();
  }, [isLoading, data, onNext]);

  if (isLoading) return <div className="text-muted-foreground text-sm">Loading...</div>;
  if (!data || data.items.length === 0) return null;

  const items = data.items;
  const allDecided = items.every((it) => decisions[it.id]);
  const remainingDays = getRemainingDaysOfWeek(date);
  const nextMonday = getNextMonday(date);

  function setDecision(itemId: number, action: Action, scheduledDate?: string) {
    setDecisions((prev) => ({ ...prev, [itemId]: { itemId, action, scheduledDate } }));
    setPickerForItem(null);
  }

  return (
    <div className="space-y-6" data-testid="previous-day-review-step">
      <div>
        <p className="text-muted-foreground text-sm">
          Unfinished items from {data.fromDate ? formatShortDate(data.fromDate) : "previously"}. Decide what to do with each.
        </p>
      </div>

      <div className="space-y-3">
        {items.map((item) => {
          const decision = decisions[item.id];
          return (
            <div key={item.id} className="bg-card rounded-lg p-3 border space-y-2">
              <div className="text-sm">{item.text}</div>
              {item.type !== "todo" && (
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{item.type}</div>
              )}

              {decision ? (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground italic">
                    {decision.action === "carry" && "Include today"}
                    {decision.action === "delay_day" && `Scheduled for ${formatShortDate(decision.scheduledDate!)}`}
                    {decision.action === "delay_next_week" && `Scheduled for ${formatShortDate(decision.scheduledDate!)}`}
                    {decision.action === "discard" && "Discarded"}
                  </span>
                  <button
                    onClick={() => setDecisions((p) => { const { [item.id]: _, ...rest } = p; return rest; })}
                    className="underline text-xs text-muted-foreground"
                  >
                    change
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" onClick={() => setDecision(item.id, "carry")} data-testid={`button-carry-${item.id}`}>
                    <RotateCcw className="w-3 h-3 mr-1" /> Include today
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPickerForItem(pickerForItem === item.id ? null : item.id)} data-testid={`button-later-${item.id}`}>
                    <CalendarDays className="w-3 h-3 mr-1" /> Later this week
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setDecision(item.id, "delay_next_week", nextMonday)} data-testid={`button-next-week-${item.id}`}>
                    <CalendarPlus className="w-3 h-3 mr-1" /> Next week
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setDecision(item.id, "discard")} data-testid={`button-discard-${item.id}`}>
                    <Trash2 className="w-3 h-3 mr-1" /> Discard
                  </Button>
                </div>
              )}

              {pickerForItem === item.id && !decision && (
                <div className="border rounded-md p-2 mt-2 space-y-1 bg-background">
                  {remainingDays.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No remaining days this week.</p>
                  ) : (
                    remainingDays.map((d) => (
                      <button
                        key={d.date}
                        onClick={() => setDecision(item.id, "delay_day", d.date)}
                        className="w-full text-left text-sm px-2 py-1 rounded hover-elevate"
                        data-testid={`button-pick-day-${item.id}-${d.date}`}
                      >
                        {d.label}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Button
        className="w-full"
        size="lg"
        onClick={() => submit.mutate()}
        disabled={!allDecided || submit.isPending}
        data-testid="button-confirm-review"
      >
        {submit.isPending ? "Saving..." : "Continue"}
      </Button>
    </div>
  );
}
