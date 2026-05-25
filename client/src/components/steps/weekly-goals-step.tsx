import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Target, X, Plus, Star, Lightbulb } from "lucide-react";
import { SIX_P_CATEGORIES, type WeeklyGoal, type NinetyDayGoal } from "@shared/schema";
import { getWeekStartDate, getPreviousWeekStartDate } from "@/lib/dateUtils";

const MAX_GOALS_PER_CATEGORY = 10;

interface WeeklyGoalsStepProps { date: string; onNext: () => void; }

interface DraftGoal {
  id: string;
  goalText: string;
  isTopFocus: boolean;
  carriedFromPrev?: boolean;
  suggestedFromNinetyDay?: boolean;
}

function formatPillarList(pillars: string[]): string {
  if (pillars.length === 0) return "";
  if (pillars.length === 1) return pillars[0];
  if (pillars.length === 2) return `${pillars[0]} and ${pillars[1]}`;
  return `${pillars.slice(0, -1).join(", ")}, and ${pillars[pillars.length - 1]}`;
}

export default function WeeklyGoalsStep({ date, onNext }: WeeklyGoalsStepProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const weekStartDate = getWeekStartDate(date);
  const previousWeekStartDate = getPreviousWeekStartDate(date);

  const { data: currentWeekGoals, isLoading: loadingCurrent } = useQuery<WeeklyGoal[]>({
    queryKey: ["/api/weekly-goals", weekStartDate],
  });
  const { data: previousGoals, isLoading: loadingPrev } = useQuery<WeeklyGoal[]>({
    queryKey: ["/api/weekly-goals", previousWeekStartDate],
  });
  const { data: ninetyDayGoal } = useQuery<NinetyDayGoal | null>({
    queryKey: ["/api/ninety-day-goal"],
  });

  const [draft, setDraft] = useState<Record<string, DraftGoal[]>>({});
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [newGoalText, setNewGoalText] = useState<Record<string, string>>({});

  useEffect(() => {
    if (hydrated || loadingCurrent || loadingPrev) return;
    const initial: Record<string, DraftGoal[]> = {};
    for (const cat of SIX_P_CATEGORIES) initial[cat] = [];

    for (const g of currentWeekGoals ?? []) {
      if (!initial[g.category]) initial[g.category] = [];
      initial[g.category].push({
        id: `cur-${g.id}`,
        goalText: g.goalText,
        isTopFocus: g.isTopFocus ?? false,
      });
    }
    for (const g of previousGoals ?? []) {
      if (g.completed) continue;
      if (!initial[g.category]) initial[g.category] = [];
      if (initial[g.category].length >= MAX_GOALS_PER_CATEGORY) continue;
      const exists = initial[g.category].some((x) => x.goalText.trim() === g.goalText.trim());
      if (exists) continue;
      initial[g.category].push({
        id: `prev-${g.id}`,
        goalText: g.goalText,
        isTopFocus: false,
        carriedFromPrev: true,
      });
    }

    setDraft(initial);

    // Only surface 90-day suggestions when the current week is empty
    const totalCurrent = (currentWeekGoals ?? []).length;
    if (totalCurrent === 0 && ninetyDayGoal?.successIndicators) {
      setSuggestions(ninetyDayGoal.successIndicators);
    }

    setHydrated(true);
  }, [currentWeekGoals, previousGoals, loadingCurrent, loadingPrev, hydrated, ninetyDayGoal]);

  const allGoals = useMemo(() => Object.values(draft).flat(), [draft]);
  const totalCount = allGoals.length;
  const topFocusGoal = allGoals.find((g) => g.isTopFocus);
  const emptyPillars = SIX_P_CATEGORIES.filter((cat) => (draft[cat] ?? []).length === 0);
  const filledPillarCount = SIX_P_CATEGORIES.length - emptyPillars.length;
  const showBalancePrompt = emptyPillars.length > 0 && emptyPillars.length < SIX_P_CATEGORIES.length;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const goals: { category: string; goalText: string; sortOrder: number; isTopFocus: boolean }[] = [];
      for (const cat of SIX_P_CATEGORIES) {
        (draft[cat] ?? []).forEach((g, i) => {
          if (g.goalText.trim()) goals.push({
            category: cat,
            goalText: g.goalText.trim(),
            sortOrder: i,
            isTopFocus: g.isTopFocus,
          });
        });
      }
      await apiRequest("POST", "/api/weekly-goals", { weekStartDate, goals });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/weekly-goals", weekStartDate] });
      onNext();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function acceptSuggestion(text: string, category: string) {
    if ((draft[category]?.length ?? 0) >= MAX_GOALS_PER_CATEGORY) {
      toast({
        title: "Category full",
        description: `Max ${MAX_GOALS_PER_CATEGORY} goals per category.`,
        variant: "destructive",
      });
      return;
    }
    setDraft((prev) => ({
      ...prev,
      [category]: [
        ...(prev[category] ?? []),
        { id: `sug-${Date.now()}`, goalText: text, isTopFocus: false, suggestedFromNinetyDay: true },
      ],
    }));
    setSuggestions((prev) => prev.filter((s) => s !== text));
  }

  function dismissSuggestion(text: string) {
    setSuggestions((prev) => prev.filter((s) => s !== text));
  }

  function addGoal(category: string) {
    const text = (newGoalText[category] ?? "").trim();
    if (!text) return;
    if ((draft[category]?.length ?? 0) >= MAX_GOALS_PER_CATEGORY) {
      toast({
        title: "Category full",
        description: `Max ${MAX_GOALS_PER_CATEGORY} goals per category.`,
        variant: "destructive",
      });
      return;
    }
    setDraft((prev) => ({
      ...prev,
      [category]: [...(prev[category] ?? []), { id: `new-${Date.now()}`, goalText: text, isTopFocus: false }],
    }));
    setNewGoalText((prev) => ({ ...prev, [category]: "" }));
  }

  function removeGoal(category: string, id: string) {
    setDraft((prev) => ({ ...prev, [category]: (prev[category] ?? []).filter((g) => g.id !== id) }));
  }

  function toggleTopFocus(targetCategory: string, targetId: string) {
    setDraft((prev) => {
      const wasFlagged = (prev[targetCategory] ?? []).find((g) => g.id === targetId)?.isTopFocus ?? false;
      const next: Record<string, DraftGoal[]> = {};
      for (const cat of SIX_P_CATEGORIES) {
        next[cat] = (prev[cat] ?? []).map((g) => {
          if (cat === targetCategory && g.id === targetId) {
            return { ...g, isTopFocus: !wasFlagged };
          }
          return g.isTopFocus ? { ...g, isTopFocus: false } : g;
        });
      }
      return next;
    });
  }

  if (loadingCurrent || loadingPrev) {
    return <div className="text-muted-foreground text-sm">Loading goals...</div>;
  }

  return (
    <div className="space-y-6" data-testid="weekly-goals-step">
      {ninetyDayGoal?.periodLabel && (
        <p className="text-xs text-muted-foreground italic" data-testid="text-ninety-day-context">
          Toward your {ninetyDayGoal.periodLabel} goal
        </p>
      )}

      <div className="flex items-center gap-3">
        <Target className="w-5 h-5 text-success" />
        <p className="text-muted-foreground text-sm">
          Set your Six P's goals for the week. Mark one as your top focus before you commit.
        </p>
      </div>

      {suggestions.length > 0 && (
        <div className="space-y-2 bg-info/5 border border-info/30 rounded-lg p-3" data-testid="suggestions-block">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-info" />
            <h3 className="font-serif text-sm">Suggested from your 90-day goal</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Pick which pillar each lands in, or dismiss the ones you won't tackle this week.
          </p>
          <div className="space-y-2 pt-1">
            {suggestions.map((s, i) => (
              <div key={i} className="bg-background rounded border p-2 space-y-2" data-testid={`suggestion-${i}`}>
                <p className="text-sm leading-snug">{s}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => acceptSuggestion(s, "Profit")}
                    data-testid={`button-accept-profit-${i}`}
                  >
                    + Profit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => acceptSuggestion(s, "Promise")}
                    data-testid={`button-accept-promise-${i}`}
                  >
                    + Promise
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => dismissSuggestion(s)}
                    data-testid={`button-dismiss-${i}`}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-5">
        {SIX_P_CATEGORIES.map((category) => {
          const items = draft[category] ?? [];
          const full = items.length >= MAX_GOALS_PER_CATEGORY;
          return (
            <div key={category} className="bg-card rounded-lg p-4 border space-y-3">
              <div className="flex items-baseline justify-between">
                <h3 className="font-serif text-lg">{category}</h3>
                <span className="text-xs text-muted-foreground">{items.length}/{MAX_GOALS_PER_CATEGORY}</span>
              </div>

              <div className="space-y-2">
                {items.map((g) => (
                  <div key={g.id} className="flex items-start gap-2 group">
                    <button
                      type="button"
                      onClick={() => toggleTopFocus(category, g.id)}
                      className="p-1 rounded hover-elevate mt-0.5"
                      aria-label={g.isTopFocus ? "Remove top focus" : "Mark as top focus"}
                      data-testid={`button-top-focus-${g.id}`}
                    >
                      <Star className={`w-4 h-4 ${g.isTopFocus ? "text-success fill-success" : "text-muted-foreground/40"}`} />
                    </button>
                    <div className="flex-1 text-sm leading-snug pt-1.5">
                      {g.goalText}
                      {g.carriedFromPrev && (
                        <span className="ml-2 text-xs text-muted-foreground italic">carried over</span>
                      )}
                      {g.suggestedFromNinetyDay && (
                        <span className="ml-2 text-xs text-info italic">from 90-day</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeGoal(category, g.id)}
                      className="text-muted-foreground hover:text-destructive p-1 rounded hover-elevate"
                      aria-label="Remove"
                      data-testid={`button-remove-${g.id}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {items.length === 0 && <p className="text-xs text-muted-foreground italic">No goals yet.</p>}
              </div>

              <div className="flex gap-2 pt-1">
                <Input
                  placeholder={full ? "Category full" : "Add a goal..."}
                  disabled={full}
                  value={newGoalText[category] ?? ""}
                  onChange={(e) => setNewGoalText((p) => ({ ...p, [category]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addGoal(category); } }}
                  data-testid={`input-new-goal-${category}`}
                />
                <Button
                  variant="outline"
                  size="icon"
                  disabled={full || !(newGoalText[category] ?? "").trim()}
                  onClick={() => addGoal(category)}
                  data-testid={`button-add-goal-${category}`}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {showBalancePrompt && (
        <div className="bg-info/5 border border-info/30 rounded-lg p-3" data-testid="balance-prompt">
          <p className="font-serif text-sm">A gentle balance nudge</p>
          <p className="text-xs text-muted-foreground mt-1">
            Nothing yet under <span className="text-foreground">{formatPillarList(emptyPillars)}</span>. Worth a thought before you commit — or carry on if it's deliberate.
          </p>
        </div>
      )}

      <div className="sticky bottom-0 pt-4 bg-background space-y-2">
        <p className="text-xs text-muted-foreground text-center" data-testid="text-week-summary">
          {totalCount} goal{totalCount === 1 ? "" : "s"} across {filledPillarCount} pillar{filledPillarCount === 1 ? "" : "s"}
          {topFocusGoal ? " · top focus set" : " · no top focus yet"}
        </p>
        <Button
          className="w-full"
          size="lg"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || totalCount === 0}
          data-testid="button-save-weekly-goals"
        >
          {saveMutation.isPending ? "Saving..." : "Approve my week"}
        </Button>
      </div>
    </div>
  );
}
