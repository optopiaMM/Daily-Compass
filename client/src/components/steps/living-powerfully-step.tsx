import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { Compass } from "lucide-react";
import {
  LIVING_POWERFULLY_AREAS,
  SIX_P_CATEGORIES,
  type LivingPowerfullyArea,
  type SixPCategory,
} from "@shared/schema";
import { getWeekStartDate } from "@/lib/dateUtils";

interface LivingPowerfullyStepProps { date: string; onNext: () => void; }

interface AreaEntry {
  area: LivingPowerfullyArea;
  score: number;
  actionNote: string;
  targetCategory: SixPCategory | "";
}

export default function LivingPowerfullyStep({ date, onNext }: LivingPowerfullyStepProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const weekStartDate = getWeekStartDate(date);

  const [index, setIndex] = useState(0);
  const [entries, setEntries] = useState<AreaEntry[]>(
    LIVING_POWERFULLY_AREAS.map((area) => ({ area, score: 0, actionNote: "", targetCategory: "" })),
  );

  const current = entries[index];
  const isUnscored = current.score === 0;
  const isLowScore = current.score > 0 && current.score <= 5;
  const isLast = index === LIVING_POWERFULLY_AREAS.length - 1;

  const mutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/living-powerfully", {
        weekStartDate,
        entries: entries.map((e) => ({
          date,
          area: e.area,
          score: e.score,
          actionNote: e.score <= 5 ? e.actionNote.trim() || null : null,
          targetCategory: e.score <= 5 && e.targetCategory ? e.targetCategory : null,
        })),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/weekly-goals", weekStartDate] });
      onNext();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function updateCurrent(patch: Partial<AreaEntry>) {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }

  const canAdvance = !isUnscored && (!isLowScore || (current.actionNote.trim().length > 0 && current.targetCategory !== ""));

  function next() {
    if (isLast) mutation.mutate();
    else setIndex(index + 1);
  }

  return (
    <div className="space-y-6" data-testid="living-powerfully-step">
      <div className="flex items-center gap-3">
        <Compass className="w-5 h-5 text-success" />
        <p className="text-muted-foreground text-sm">
          Score each life area. Low scores prompt a single concrete action for the week.
        </p>
      </div>

      <div className="text-xs text-muted-foreground">
        Area {index + 1} of {LIVING_POWERFULLY_AREAS.length}
      </div>

      <div className="space-y-6 bg-card rounded-lg p-5 border">
        <h2 className="font-serif text-2xl" data-testid="text-current-area">{current.area}</h2>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">How am I doing?</span>
            <span className="font-serif text-3xl tabular-nums text-muted-foreground" data-testid="text-score">
              {isUnscored ? "—" : current.score}
            </span>
          </div>
          <Slider
            min={0}
            max={10}
            step={1}
            value={[current.score]}
            onValueChange={(val) => updateCurrent({ score: val[0] })}
            data-testid="slider-score"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>not yet</span><span>10</span>
          </div>
          {isUnscored && (
            <p className="text-xs italic text-muted-foreground">Slide to score — defaults to "not yet" so you have to engage.</p>
          )}
        </div>

        {isLowScore && (
          <div className="space-y-4 pt-2 border-t">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wide">
                One concrete action this week
              </label>
              <Textarea
                value={current.actionNote}
                onChange={(e) => updateCurrent({ actionNote: e.target.value })}
                placeholder="What's one thing you'll do?"
                className="resize-none min-h-[60px] bg-background border-border/50"
                data-testid="input-action-note"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground uppercase tracking-wide">
                File under
              </label>
              <div className="grid grid-cols-2 gap-2">
                {SIX_P_CATEGORIES.map((cat) => {
                  const selected = current.targetCategory === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => updateCurrent({ targetCategory: cat })}
                      className={`text-sm px-3 py-2 rounded-md border text-left hover-elevate ${selected ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}
                      data-testid={`button-category-${cat}`}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {index > 0 && (
          <Button variant="outline" onClick={() => setIndex(index - 1)} data-testid="button-lp-back">
            Back
          </Button>
        )}
        <Button
          className="flex-1"
          size="lg"
          disabled={!canAdvance || mutation.isPending}
          onClick={next}
          data-testid="button-lp-next"
        >
          {mutation.isPending ? "Saving..." : isLast ? "Finish" : "Next area"}
        </Button>
      </div>
    </div>
  );
}
