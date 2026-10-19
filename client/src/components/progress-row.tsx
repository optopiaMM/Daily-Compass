import { Progress } from "@/components/ui/progress";
import type { Progress as ProgressCount } from "@shared/weekly-lookback";

// A title, "X/Y (Z%)", and a bar that fills green with the percentage. The track
// is neutral so 0% shows no green at all.
export default function ProgressRow({ title, count, testId }: { title: string; count: ProgressCount; testId: string }) {
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium leading-snug min-w-0">{title}</p>
        <p className="text-xs text-muted-foreground tabular-nums shrink-0" data-testid={`text-${testId}`}>
          {count.done}/{count.total} ({count.pct}%)
        </p>
      </div>
      <Progress value={count.pct} className="h-2.5 bg-muted" aria-label={`${title}: ${count.done} of ${count.total} done`} />
    </div>
  );
}
