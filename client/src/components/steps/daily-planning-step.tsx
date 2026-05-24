import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Plus, X, Star, ListChecks, ArrowRight } from "lucide-react";
import type { WeeklyGoal, DailyItem } from "@shared/schema";
import { getWeekStartDate } from "@/lib/dateUtils";

interface DailyPlanningStepProps { date: string; onComplete: () => void; }

type TempType = "main" | "priority" | "todo";

interface PoolItem {
  tempId: string;
  text: string;
  type: TempType;
  rank: number | null;
  linkedWeeklyGoalId: number | null;
}

export default function DailyPlanningStep({ date, onComplete }: DailyPlanningStepProps) {
  const { toast } = useToast();
  const weekStartDate = getWeekStartDate(date);

  const { data: weeklyGoals } = useQuery<WeeklyGoal[]>({ queryKey: ["/api/weekly-goals", weekStartDate] });
  const { data: carriedItems } = useQuery<DailyItem[]>({ queryKey: ["/api/carried-items", date] });

  const [stage, setStage] = useState<"pool" | "assign">("pool");
  const [pool, setPool] = useState<PoolItem[]>([]);
  const [pulledGoalIds, setPulledGoalIds] = useState<Set<number>>(new Set());
  const [newText, setNewText] = useState("");
  const [tierPickerFor, setTierPickerFor] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (hydrated || !carriedItems) return;
    if (carriedItems.length > 0) {
      const seeded: PoolItem[] = carriedItems.map((it, i) => ({
        tempId: `carry-${it.id}-${i}`,
        text: it.text,
        type: "todo",
        rank: null,
        linkedWeeklyGoalId: it.linkedWeeklyGoalId,
      }));
      setPool(seeded);
    }
    setHydrated(true);
  }, [carriedItems, hydrated]);

  function addFromInput() {
    const text = newText.trim();
    if (!text) return;
    setPool((p) => [...p, { tempId: `n-${Date.now()}`, text, type: "todo", rank: null, linkedWeeklyGoalId: null }]);
    setNewText("");
  }

  function pullWeeklyGoal(g: WeeklyGoal) {
    if (pulledGoalIds.has(g.id)) return;
    setPool((p) => [...p, { tempId: `wg-${g.id}`, text: g.goalText, type: "todo", rank: null, linkedWeeklyGoalId: g.id }]);
    setPulledGoalIds((s) => new Set(s).add(g.id));
  }

  function removeFromPool(tempId: string) {
    setPool((p) => p.filter((it) => it.tempId !== tempId));
    const m = tempId.match(/^wg-(\d+)$/);
    if (m) {
      setPulledGoalIds((s) => {
        const next = new Set(s);
        next.delete(Number(m[1]));
        return next;
      });
    }
  }

  function assignTier(tempId: string, type: TempType, rank: number | null) {
    setPool((p) =>
      p.map((it) => {
        if (it.tempId === tempId) return { ...it, type, rank };
        if (type === "main" && it.type === "main") return { ...it, type: "todo", rank: null };
        if (type === "priority" && it.type === "priority" && it.rank === rank) return { ...it, type: "todo", rank: null };
        return it;
      }),
    );
    setTierPickerFor(null);
  }

  function demoteToTodo(tempId: string) {
    setPool((p) => p.map((it) => (it.tempId === tempId ? { ...it, type: "todo", rank: null } : it)));
  }

  const mainGoal = pool.find((it) => it.type === "main");
  const priorities = [1, 2, 3].map((r) => pool.find((it) => it.type === "priority" && it.rank === r));
  const todos = pool.filter((it) => it.type === "todo");

  const submit = useMutation({
    mutationFn: async () => {
      const items = pool.map((it) => ({
        type: it.type,
        text: it.text,
        rank: it.rank,
        linkedWeeklyGoalId: it.linkedWeeklyGoalId,
      }));
      await apiRequest("POST", "/api/daily-plan", { date, items });
      await apiRequest("POST", "/api/morning-session/complete", { date });
    },
    onSuccess: () => onComplete(),
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (stage === "pool") {
    return (
      <div className="space-y-6" data-testid="daily-planning-pool">
        <p className="text-muted-foreground text-sm">
          Collect everything for today. Pull from this week's goals, carry-over items, or add new ones.
        </p>

        {(weeklyGoals && weeklyGoals.length > 0) && (
          <div className="bg-card rounded-lg p-4 border space-y-2">
            <h3 className="font-serif text-base">This week's goals</h3>
            <p className="text-xs text-muted-foreground">Tap to add to today's pool.</p>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {weeklyGoals.filter((g) => !g.completed).map((g) => {
                const added = pulledGoalIds.has(g.id);
                return (
                  <button
                    key={g.id}
                    onClick={() => pullWeeklyGoal(g)}
                    disabled={added}
                    className={`w-full text-left text-sm px-3 py-2 rounded border hover-elevate ${added ? "opacity-50" : ""}`}
                    data-testid={`button-pull-goal-${g.id}`}
                  >
                    <span className="text-xs text-muted-foreground uppercase tracking-wide mr-2">{g.category}</span>
                    {g.goalText}
                    {added && <span className="ml-2 text-xs italic text-muted-foreground">added</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <h3 className="font-serif text-base">Today's pool</h3>
          {pool.length === 0 && <p className="text-xs text-muted-foreground italic">Nothing yet.</p>}
          {pool.map((it) => (
            <div key={it.tempId} className="flex items-center gap-2 bg-card rounded p-2 border">
              <span className="flex-1 text-sm">{it.text}</span>
              <button onClick={() => removeFromPool(it.tempId)} className="p-1 text-muted-foreground hover:text-destructive">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Input
            placeholder="Add a to-do..."
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFromInput(); } }}
            data-testid="input-pool-add"
          />
          <Button variant="outline" size="icon" onClick={addFromInput} disabled={!newText.trim()} data-testid="button-pool-add">
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        <Button
          className="w-full"
          size="lg"
          disabled={pool.length === 0}
          onClick={() => setStage("assign")}
          data-testid="button-done-pool"
        >
          Done, now prioritise <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="daily-planning-assign">
      <p className="text-muted-foreground text-sm">Tap an item to assign it as Main Goal or a Priority. The rest stays as To-Do.</p>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Star className="w-4 h-4 text-primary" />
          <h3 className="font-serif text-base">Main Goal</h3>
        </div>
        <SlotCard
          item={mainGoal}
          onDemote={() => mainGoal && demoteToTodo(mainGoal.tempId)}
          emptyLabel="Tap a to-do below to choose your single most important thing for today."
        />
      </div>

      <div className="space-y-2">
        <h3 className="font-serif text-base">Priorities</h3>
        <div className="grid gap-2">
          {priorities.map((p, i) => (
            <SlotCard
              key={i}
              item={p}
              onDemote={() => p && demoteToTodo(p.tempId)}
              emptyLabel={`Priority ${i + 1}`}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-primary" />
          <h3 className="font-serif text-base">To-Do</h3>
        </div>
        <div className="space-y-2">
          {todos.length === 0 && <p className="text-xs text-muted-foreground italic">All assigned.</p>}
          {todos.map((it) => (
            <div key={it.tempId} className="bg-card rounded p-2 border space-y-2">
              <button
                onClick={() => setTierPickerFor(tierPickerFor === it.tempId ? null : it.tempId)}
                className="w-full text-left text-sm flex items-center justify-between gap-2"
                data-testid={`button-tier-${it.tempId}`}
              >
                <span>{it.text}</span>
                <span className="text-xs text-muted-foreground">assign</span>
              </button>
              {tierPickerFor === it.tempId && (
                <div className="grid grid-cols-2 gap-2 pt-1 border-t">
                  <Button size="sm" variant="outline" disabled={!!mainGoal} onClick={() => assignTier(it.tempId, "main", null)} data-testid={`button-assign-main-${it.tempId}`}>
                    Main Goal
                  </Button>
                  {[1, 2, 3].map((r) => (
                    <Button
                      key={r}
                      size="sm"
                      variant="outline"
                      disabled={!!priorities[r - 1]}
                      onClick={() => assignTier(it.tempId, "priority", r)}
                      data-testid={`button-assign-p${r}-${it.tempId}`}
                    >
                      Priority {r}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setStage("pool")}>Back</Button>
        <Button
          className="flex-1"
          size="lg"
          disabled={!mainGoal || submit.isPending}
          onClick={() => submit.mutate()}
          data-testid="button-confirm-plan"
        >
          {submit.isPending ? "Saving..." : "Confirm My Plan"}
        </Button>
      </div>
    </div>
  );
}

function SlotCard({ item, emptyLabel, onDemote }: { item?: PoolItem; emptyLabel: string; onDemote: () => void }) {
  if (!item) {
    return <div className="bg-card/40 rounded border border-dashed text-xs text-muted-foreground italic p-3">{emptyLabel}</div>;
  }
  return (
    <div className="bg-primary/5 rounded p-3 border border-primary/20 flex items-center gap-2">
      <span className="flex-1 text-sm">{item.text}</span>
      <button onClick={onDemote} className="text-muted-foreground hover:text-destructive p-1" aria-label="Demote">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
