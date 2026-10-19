import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Tag } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SIX_P_CATEGORIES, type DailyItem, type DailyItemTags, type NinetyDayGoal } from "@shared/schema";

// Optional look-back tags on a daily task: a Six P's pillar and a 90-day goal.
// Only the goals active this week are offered (GET /api/ninety-day-goals/trends/:date).

export type ActiveGoal = Pick<NinetyDayGoal, "id" | "goalText">;
export const NO_TAGS: DailyItemTags = { pillar: null, ninetyDayGoalId: null };

const NONE = "__none";

export const hasTags = (t: { pillar: string | null; ninetyDayGoalId: number | null }) => t.pillar != null || t.ninetyDayGoalId != null;

// "Profit · Gain more interesting…", or "" with no tags.
export function tagLabel(t: { pillar: string | null; ninetyDayGoalId: number | null }, goals: ActiveGoal[] | undefined) {
  const goal = t.ninetyDayGoalId == null ? null : goals?.find((g) => g.id === t.ninetyDayGoalId)?.goalText ?? "Other goal";
  const short = goal && goal.length > 28 ? goal.slice(0, 27) + "…" : goal;
  return [t.pillar, short].filter(Boolean).join(" · ");
}

export function TaskTagFields({ value, goals, onChange }: {
  value: { pillar: string | null; ninetyDayGoalId: number | null };
  goals: ActiveGoal[] | undefined;
  onChange: (tags: DailyItemTags) => void;
}) {
  const goalValue = value.ninetyDayGoalId == null ? NONE : String(value.ninetyDayGoalId);
  const inactive = value.ninetyDayGoalId != null && !goals?.some((g) => g.id === value.ninetyDayGoalId);
  return (
    <div className="grid grid-cols-2 gap-2" data-testid="task-tag-fields">
      <Select
        value={value.pillar ?? NONE}
        onValueChange={(v) => onChange({ pillar: v === NONE ? null : (v as DailyItemTags["pillar"]), ninetyDayGoalId: value.ninetyDayGoalId })}
      >
        <SelectTrigger aria-label="Pillar" className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE} className="text-muted-foreground">No pillar</SelectItem>
          {SIX_P_CATEGORIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select
        value={goalValue}
        onValueChange={(v) => onChange({ pillar: value.pillar as DailyItemTags["pillar"], ninetyDayGoalId: v === NONE ? null : Number(v) })}
      >
        <SelectTrigger aria-label="90-day goal" className="h-8 text-xs">
          <span className="truncate">{tagLabel({ pillar: null, ninetyDayGoalId: value.ninetyDayGoalId }, goals) || "No goal"}</span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE} className="text-muted-foreground">No goal</SelectItem>
          {inactive && <SelectItem value={goalValue} disabled>Other goal (not active)</SelectItem>}
          {goals?.map((g) => <SelectItem key={g.id} value={String(g.id)}>{g.goalText}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

// The small "Tag" button beside a task input; highlighted once tags are picked.
export function TagToggle({ open, tagged, onClick }: { open: boolean; tagged: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={open ? "Hide tags" : "Tag this task"}
      aria-expanded={open}
      className={cn("shrink-0 rounded-md border px-2 hover-elevate", tagged ? "text-success border-success/40" : "text-muted-foreground")}
      data-testid="button-tag-toggle"
    >
      <Tag className="w-4 h-4" />
    </button>
  );
}

// Under a task in the day view: its tags (or "Tag"), opening the picker to set,
// change or clear them. Each change saves straight away.
export function TaskTagControl({ item, goals, date }: { item: DailyItem; goals: ActiveGoal[] | undefined; date: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  // Held here while the picker is open, so picking a pillar then a goal in quick
  // succession doesn't send the second change with the first one's stale value.
  const [tags, setTags] = useState<DailyItemTags>(NO_TAGS);
  const save = useMutation({
    mutationFn: async (next: DailyItemTags) => apiRequest("PATCH", `/api/daily-items/${item.id}/tags`, next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-items", date] });
      queryClient.invalidateQueries({ queryKey: ["/api/weekly-lookback"] }); // goal progress on the home card
    },
    onError: (err: Error) => toast({ title: "Couldn't save the tags", description: err.message, variant: "destructive" }),
  });
  const label = tagLabel(open ? tags : item, goals);
  function toggleOpen() {
    if (!open) setTags({ pillar: item.pillar as DailyItemTags["pillar"], ninetyDayGoalId: item.ninetyDayGoalId });
    setOpen(!open);
  }
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={toggleOpen}
        className="ml-7 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        aria-expanded={open}
        data-testid={`button-tags-${item.id}`}
      >
        <Tag className="w-3 h-3" />
        {label || "Tag"}
      </button>
      {open && (
        <div className="ml-7">
          <TaskTagFields value={tags} goals={goals} onChange={(next) => { setTags(next); save.mutate(next); }} />
        </div>
      )}
    </div>
  );
}
