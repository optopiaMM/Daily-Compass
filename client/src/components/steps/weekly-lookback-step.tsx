import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatShortDate, getPreviousWeekStartDate } from "@/lib/dateUtils";
import HydrationWeekSection from "@/components/hydration-week";
import ProgressRow from "@/components/progress-row";
import type { WeeklyLookback } from "@shared/weekly-lookback";
import { addDaysISO } from "@shared/weekly-review";

interface WeeklyLookbackStepProps { date: string; onNext: () => void; }

// Monday's look back at last week, before setting this week's goals. Read-only.
export default function WeeklyLookbackStep({ date, onNext }: WeeklyLookbackStepProps) {
  const week = getPreviousWeekStartDate(date);
  const { data, isLoading, error } = useQuery<WeeklyLookback>({ queryKey: ["/api/weekly-lookback", week] });

  const unassigned = data?.unassignedGoal;
  const showUnassignedGoal = unassigned && unassigned.total > 0;

  return (
    <div className="space-y-6" data-testid="weekly-lookback-step">
      <div className="flex items-center gap-3">
        <History className="w-5 h-5 text-success" />
        <p className="text-muted-foreground text-sm">
          Last week, {formatShortDate(week)} to {formatShortDate(addDaysISO(week, 6))}. A quick look before you plan this one.
        </p>
      </div>

      {isLoading && <p className="text-muted-foreground text-sm">Loading last week...</p>}
      {error && <p className="text-sm text-destructive">Couldn't load last week: {(error as Error).message}</p>}

      {data && (
        <>
          <HydrationWeekSection water={data.hydration} />

          <section className="space-y-3" data-testid="lookback-pillars">
            <div>
              <h2 className="font-serif text-lg">By pillar</h2>
              <p className="text-xs text-muted-foreground">Last week's weekly goals done, in each of the Six P's.</p>
            </div>
            <div className="rounded-lg border bg-card p-4 space-y-4">
              {data.pillars.map((p) => (
                <ProgressRow key={p.pillar} title={p.pillar} count={p} testId={`lookback-pillar-${p.pillar}`} />
              ))}
            </div>
          </section>

          <section className="space-y-3" data-testid="lookback-goals">
            <div>
              <h2 className="font-serif text-lg">By 90-day goal</h2>
              <p className="text-xs text-muted-foreground">
                Weekly goals and daily tasks allocated to each goal, done. A task pulled from a weekly goal counts once, with that goal.
              </p>
            </div>
            {data.goals.length === 0 && <p className="text-sm text-muted-foreground italic">No 90-day goals were active last week.</p>}
            {data.goals.length > 0 && (
              <div className="rounded-lg border bg-card p-4 space-y-4">
                {data.goals.map((g) => (
                  <ProgressRow key={g.id} title={g.goalText} count={g} testId={`lookback-goal-${g.id}`} />
                ))}
              </div>
            )}
            {showUnassignedGoal && (
              <p className="text-xs text-muted-foreground" data-testid="lookback-unassigned-goal">
                Not linked to an active goal: {unassigned.done}/{unassigned.total} done.
              </p>
            )}
          </section>
        </>
      )}

      <Button className="w-full" size="lg" onClick={onNext} data-testid="button-lookback-next">
        Continue
      </Button>
    </div>
  );
}
