import { scoreTrend, type ScorePoint } from "@shared/weekly-review";
import { formatShortDate } from "@/lib/dateUtils";

// A 1–10 weekly score trend: a small line with the latest score beside it.
export default function Sparkline({ history, className = "" }: { history: ScorePoint[]; className?: string }) {
  const { points, latest } = scoreTrend(history);
  const W = 72, H = 22, pad = 3;
  const x = (i: number) => (points.length === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (points.length - 1));
  const y = (s: number) => H - pad - ((s - 1) * (H - 2 * pad)) / 9;
  const title = points.length
    ? points.map((p) => `${formatShortDate(p.weekStartDate)}: ${p.score}`).join("\n")
    : "No scores yet";

  return (
    <span className={`inline-flex items-center gap-2 ${className}`} title={title} data-testid="sparkline">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className="text-success">
        <line x1={pad} x2={W - pad} y1={y(5.5)} y2={y(5.5)} className="stroke-muted-foreground/20" strokeDasharray="2 2" />
        {points.length > 1 && (
          <polyline
            fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round"
            points={points.map((p, i) => `${x(i)},${y(p.score)}`).join(" ")}
          />
        )}
        {points.length > 0 && <circle cx={x(points.length - 1)} cy={y(points[points.length - 1].score)} r={2.5} fill="currentColor" />}
      </svg>
      <span className="font-serif text-base tabular-nums w-10 text-right">
        {latest != null ? <>{latest}<span className="text-xs text-muted-foreground">/10</span></> : <span className="text-xs text-muted-foreground">—</span>}
      </span>
    </span>
  );
}
