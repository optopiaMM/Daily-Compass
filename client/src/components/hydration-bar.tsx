import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Droplet, Settings2, Undo2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { DAYS_IN_WEEK, WATER_PRESETS_ML, isReached, progressPct, type HydrationDay, type HydrationWeek } from "@shared/hydration";
import { mondayOf } from "@shared/weekly-review";

// Mutations share this key so a refetch only runs once the last rapid tap settles;
// otherwise an early refetch could briefly pull the bar back.
const MUTATION_KEY = ["hydration"];

export default function HydrationBar({ date }: { date: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const queryKey = ["/api/hydration", date];
  const { data: day } = useQuery<HydrationDay>({ queryKey });
  // Same endpoint (and shared weeklySummary) as the weekly review's water section.
  const { data: week } = useQuery<HydrationWeek>({ queryKey: ["/api/hydration/week", mondayOf(date)] });

  const [editingTarget, setEditingTarget] = useState(false);
  const [targetInput, setTargetInput] = useState("");

  // Applies a change to the cached day straight away and returns the old value to
  // roll back to.
  const optimistic = async (change: (d: HydrationDay) => HydrationDay) => {
    await queryClient.cancelQueries({ queryKey });
    const previous = queryClient.getQueryData<HydrationDay>(queryKey);
    if (previous) {
      const next = change(previous);
      queryClient.setQueryData<HydrationDay>(queryKey, { ...next, reached: isReached(next.totalMl, next.targetMl) });
    }
    return { previous };
  };
  const rollback = (ctx: { previous?: HydrationDay } | undefined) => {
    if (ctx?.previous) queryClient.setQueryData(queryKey, ctx.previous);
  };
  const settle = () => {
    if (queryClient.isMutating({ mutationKey: MUTATION_KEY }) !== 1) return;
    queryClient.invalidateQueries({ queryKey: ["/api/hydration"] });
    queryClient.invalidateQueries({ queryKey: ["/api/hydration/week"] });
  };

  const log = useMutation({
    mutationKey: MUTATION_KEY,
    mutationFn: async (amountMl: number) => (await apiRequest("POST", "/api/hydration/log", { date, amountMl })).json() as Promise<HydrationDay>,
    onMutate: (amountMl) =>
      optimistic((d) => ({ ...d, totalMl: d.totalMl + amountMl, logCount: d.logCount + 1, lastLogMl: amountMl })),
    onSuccess: (result, _amount, ctx) => {
      if (result.reached && ctx?.previous && !ctx.previous.reached) {
        toast({ title: "Water target reached", description: `${result.totalMl} / ${result.targetMl} ml` });
      }
    },
    onError: (err: Error, _amount, ctx) => {
      rollback(ctx);
      toast({ title: "Couldn't log water", description: err.message, variant: "destructive" });
    },
    onSettled: settle,
  });

  const undo = useMutation({
    mutationKey: MUTATION_KEY,
    mutationFn: async () => apiRequest("POST", "/api/hydration/undo", { date }),
    // The amount before the last one isn't known here, so lastLogMl is cleared
    // until the refetch fills it back in.
    onMutate: () =>
      optimistic((d) => ({ ...d, totalMl: Math.max(0, d.totalMl - (d.lastLogMl ?? 0)), logCount: Math.max(0, d.logCount - 1), lastLogMl: null })),
    onError: (err: Error, _v, ctx) => {
      rollback(ctx);
      toast({ title: "Couldn't undo", description: err.message, variant: "destructive" });
    },
    onSettled: settle,
  });

  const saveTarget = useMutation({
    mutationKey: MUTATION_KEY,
    mutationFn: async (targetMl: number) => apiRequest("PUT", "/api/hydration/target", { targetMl }),
    onMutate: (targetMl) => optimistic((d) => ({ ...d, targetMl })),
    onSuccess: (_res, targetMl) => {
      setEditingTarget(false);
      toast({ title: "Water target updated", description: `${targetMl} ml a day` });
    },
    onError: (err: Error, _v, ctx) => {
      rollback(ctx);
      toast({ title: "Couldn't save target", description: err.message, variant: "destructive" });
    },
    onSettled: settle,
  });

  if (!day) return null;

  const reached = day.reached;
  const parsedTarget = Number(targetInput);
  const targetValid = Number.isInteger(parsedTarget) && parsedTarget >= 250 && parsedTarget <= 10000;

  return (
    <div className="bg-card border rounded-lg p-3 space-y-2" data-testid="hydration-bar">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Droplet className={cn("w-4 h-4 shrink-0", reached ? "text-success" : "text-info")} />
          <span className="text-sm tabular-nums" data-testid="text-hydration-total">
            <span className={cn("font-medium", reached && "text-success")}>{day.totalMl}</span>
            <span className="text-muted-foreground"> / {day.targetMl} ml</span>
          </span>
          {reached && <Check className="w-4 h-4 text-success shrink-0" aria-label="Target reached" data-testid="icon-hydration-reached" />}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {week && (
            <span
              className="text-xs text-muted-foreground tabular-nums"
              title={`Average ${week.averageMl} ml a day this week`}
              data-testid="text-hydration-week"
            >
              This week: {week.daysHit}/{DAYS_IN_WEEK}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Change daily water target"
            onClick={() => { setTargetInput(String(day.targetMl)); setEditingTarget(!editingTarget); }}
            data-testid="button-hydration-settings"
          >
            <Settings2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <Progress
        value={progressPct(day.totalMl, day.targetMl)}
        className={cn("h-2", !reached && "bg-info/20 [&>div]:bg-info")}
        aria-label="Water progress"
        data-testid="progress-hydration"
      />

      <div className="flex items-center gap-2">
        {WATER_PRESETS_ML.map((ml) => (
          <Button key={ml} variant="outline" size="sm" className="h-7 text-xs" onClick={() => log.mutate(ml)} data-testid={`button-water-${ml}`}>
            +{ml}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1 ml-auto text-muted-foreground"
          disabled={day.logCount === 0 || day.lastLogMl == null}
          onClick={() => undo.mutate()}
          data-testid="button-water-undo"
        >
          <Undo2 className="w-3 h-3" />
          Undo{day.lastLogMl != null ? ` ${day.lastLogMl}` : ""}
        </Button>
      </div>

      {editingTarget && (
        <form
          className="flex items-center gap-2 pt-1"
          onSubmit={(e) => { e.preventDefault(); if (targetValid) saveTarget.mutate(parsedTarget); }}
          data-testid="form-hydration-target"
        >
          <label htmlFor="water-target" className="text-xs text-muted-foreground whitespace-nowrap">Daily target (ml)</label>
          <Input
            id="water-target"
            type="number"
            inputMode="numeric"
            min={250}
            max={10000}
            step={50}
            className="h-8"
            value={targetInput}
            onChange={(e) => setTargetInput(e.target.value)}
            data-testid="input-hydration-target"
          />
          <Button type="submit" size="sm" className="h-8" disabled={!targetValid || saveTarget.isPending} data-testid="button-save-hydration-target">
            Save
          </Button>
        </form>
      )}
    </div>
  );
}
