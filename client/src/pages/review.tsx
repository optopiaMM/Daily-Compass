import { Link, useLocation, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import HydrationWeekSection from "@/components/hydration-week";
import ProgressRow from "@/components/progress-row";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatDateNice, getPreviousWeekStartDate, getWeekStartDate } from "@/lib/dateUtils";
import type { WeeklyReview } from "@shared/schema";
import type { WeeklyLookback } from "@shared/weekly-lookback";

// Weekly review, done automatically: a read-only summary of last week from what was
// ticked (the same counts as Monday's look-back), then one button that marks this
// week's review goal done.
export default function ReviewPage() {
  const { weekStart } = useParams<{ weekStart: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(weekStart ?? "");
  const week = valid ? getWeekStartDate(weekStart) : "";
  const reviewedWeek = valid ? getPreviousWeekStartDate(week) : "";

  const { data, isLoading, error } = useQuery<WeeklyLookback>({ queryKey: ["/api/weekly-lookback", reviewedWeek], enabled: valid });
  // Only to see whether this week already has a review row. Saving again with an
  // empty body would clear that review's notes and scores, so it isn't re-sent.
  const { data: ctx } = useQuery<{ review: WeeklyReview | null }>({ queryKey: ["/api/weekly-review", week], enabled: valid });
  const alreadyReviewed = !!ctx?.review;

  const markReviewed = useMutation({
    mutationFn: async () => {
      if (!alreadyReviewed) await apiRequest("POST", "/api/weekly-review", { weekStartDate: week });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/weekly-goals", week] });
      queryClient.invalidateQueries({ queryKey: ["/api/weekly-review", week] });
      queryClient.invalidateQueries({ queryKey: ["/api/fresh-start"] });
      if (!alreadyReviewed) toast({ title: "Week reviewed" });
      navigate("/");
    },
    onError: (err: Error) => toast({ title: "Couldn't mark the review", description: err.message, variant: "destructive" }),
  });

  const done = data?.pillars.reduce((n, p) => n + p.done, 0) ?? 0;
  const total = data?.pillars.reduce((n, p) => n + p.total, 0) ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const unassigned = data?.unassignedGoal;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Today
        </Link>
        {!valid ? (
          <p className="text-muted-foreground">That isn't a date. Use /review/YYYY-MM-DD.</p>
        ) : (
          <>
            <header className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-success">Weekly review</p>
              <h1 className="font-serif text-2xl font-semibold">Week of {formatDateNice(reviewedWeek)}</h1>
              {data && (
                <p className="text-sm" data-testid="text-review-headline">
                  {total
                    ? `${done} of ${total} goals completed last week (${pct}%)`
                    : "No goals were set last week."}
                </p>
              )}
              {alreadyReviewed && <p className="text-xs text-muted-foreground">Already reviewed.</p>}
            </header>

            {isLoading && <p className="text-muted-foreground text-sm">Loading last week...</p>}
            {error && <p className="text-sm text-destructive">Couldn't load last week: {(error as Error).message}</p>}

            {data && (
              <>
                <section className="space-y-3" data-testid="review-pillars">
                  <h2 className="font-serif text-lg">Did we complete last week's goals</h2>
                  <div className="rounded-lg border bg-card p-4 space-y-4">
                    {data.pillars.map((p) => (
                      <ProgressRow key={p.pillar} title={p.pillar} count={p} testId={`review-pillar-${p.pillar}`} />
                    ))}
                  </div>
                </section>

                <section className="space-y-3" data-testid="review-goals">
                  <h2 className="font-serif text-lg">Progress on your 90-day goals</h2>
                  {data.goals.length === 0 && <p className="text-sm text-muted-foreground italic">No 90-day goals were active last week.</p>}
                  {data.goals.length > 0 && (
                    <div className="rounded-lg border bg-card p-4 space-y-4">
                      {data.goals.map((g) => g.total > 0
                        ? <ProgressRow key={g.id} title={g.goalText} count={g} testId={`review-goal-${g.id}`} />
                        : (
                          <div key={g.id} className="space-y-1" data-testid={`review-goal-${g.id}`}>
                            <p className="text-sm font-medium leading-snug">{g.goalText}</p>
                            <p className="text-xs text-muted-foreground">No tasks set this week</p>
                          </div>
                        ))}
                    </div>
                  )}
                  {unassigned && unassigned.total > 0 && (
                    <p className="text-xs text-muted-foreground" data-testid="review-unassigned-goal">
                      Not linked to an active goal: {unassigned.done}/{unassigned.total}
                    </p>
                  )}
                </section>

                <HydrationWeekSection water={data.hydration} />
              </>
            )}

            <div className="sticky bottom-0 bg-background pt-4 pb-2">
              <Button
                className="w-full" size="lg"
                disabled={markReviewed.isPending || !data}
                onClick={() => markReviewed.mutate()}
                data-testid="button-mark-reviewed"
              >
                {markReviewed.isPending ? "Saving..." : alreadyReviewed ? "Back to today" : "Mark as reviewed"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
