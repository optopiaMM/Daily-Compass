import { cn } from "@/lib/utils";
import { DAYS_IN_WEEK, type HydrationWeek } from "@shared/hydration";

// A week of water: days on target, the daily average and a Mon–Sun strip. Shown in
// the weekly review and the Monday look-back.
export default function HydrationWeekSection({ water }: { water: HydrationWeek }) {
  return (
    <section className="space-y-3" data-testid="review-hydration">
      <div>
        <h2 className="font-serif text-lg">Water</h2>
        <p className="text-xs text-muted-foreground">Against your current target of {water.targetMl} ml a day.</p>
      </div>
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-medium leading-snug" data-testid="text-review-hydration-hit">
            {water.daysHit} of {DAYS_IN_WEEK} days hit target
          </p>
          <p className="text-sm text-muted-foreground tabular-nums" data-testid="text-review-hydration-average">
            {water.averageMl} ml a day on average
          </p>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {water.days.map((d) => (
            <div
              key={d.date}
              className={cn(
                "rounded border py-1 text-center text-[10px] tabular-nums",
                d.hit ? "bg-success text-success-foreground border-success" : "bg-background text-muted-foreground",
              )}
              title={`${d.totalMl} ml`}
              data-testid={`review-hydration-day-${d.date}`}
            >
              <span className="block font-medium">{new Date(d.date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short" })}</span>
              {d.totalMl}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
