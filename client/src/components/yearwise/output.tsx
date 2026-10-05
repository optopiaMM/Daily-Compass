import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { Check, AlertTriangle, Download, Copy, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { YearwiseSession } from "@shared/schema";
import { fmt, iso, parseISO } from "@shared/yearwise";
import {
  CSV_COLS, buildCSV, buildJSON, buildMD, plannedByWeek, readinessChecks, weeklyRows,
} from "@shared/yearwise-output";
import { useYearwise, Card, Hint } from "./fields";

// What POST /api/yearwise-sessions/:id/commit returns.
interface CommitResponse {
  session: YearwiseSession;
  weekOneStart: string;
  counts: { ninetyDayGoals: number; ifThenPlans: number; habits: number; weeklyGoals: number; lifeCheckins: number };
}

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export function Output() {
  const { answers, dates } = useYearwise();
  const { toast } = useToast();
  const id = Number(useParams<{ sessionId: string }>().sessionId);
  const { data: session } = useQuery<YearwiseSession>({
    queryKey: ["/api/yearwise-sessions", id],
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const checks = useMemo(() => readinessChecks(answers, dates), [answers, dates]);
  const rows = useMemo(() => weeklyRows(answers, dates), [answers, dates]);
  const hours = plannedByWeek(rows);
  const md = useMemo(() => buildMD(answers, dates), [answers, dates]);
  const warnings = checks.filter((c) => !c.ok).length;
  const start = iso(dates.start);

  const [result, setResult] = useState<CommitResponse | null>(null);
  const commit = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/yearwise-sessions/${id}/commit`, { answers })).json() as Promise<CommitResponse>,
    onSuccess: (r) => {
      setResult(r);
      queryClient.setQueryData(["/api/yearwise-sessions", id], r.session);
      queryClient.invalidateQueries({ queryKey: ["/api/yearwise-sessions"], exact: true });
      for (const k of ["/api/annual-target", "/api/ninety-day-goal", "/api/ninety-day-goals", "/api/weekly-goal-templates"]) {
        queryClient.invalidateQueries({ queryKey: [k] });
      }
    },
    onError: (e: Error) => toast({ title: "Couldn't commit to Daily Compass", description: e.message, variant: "destructive" }),
  });

  const committedAt = session?.committedAt ? new Date(session.committedAt) : null;
  const weekOne = result?.weekOneStart ?? (committedAt ? start : null);

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(md);
      toast({ title: "Summary copied" });
    } catch {
      toast({ title: "Copy blocked here", description: "Select the summary below and press Ctrl+C." });
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        Check the list, then commit. Committing writes your annual target, 90-day goals, if–then plans, habits, life
        check-in and first two weeks into Daily Compass. You can also download the plan.
      </p>

      {/* Readiness (§4.2) */}
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-serif text-lg font-semibold">Readiness</h2>
          <span className="text-xs text-muted-foreground">
            {warnings ? `${plural(warnings, "thing")} to look at. None of them stop you committing.` : "All clear"}
          </span>
        </div>
        <ul className="space-y-2" data-testid="readiness-list">
          {checks.map((c, i) => (
            <li key={i} className="flex gap-2 text-sm">
              {c.ok
                ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="OK" />
                : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-label="Warning" />}
              <span className={cn(!c.ok && "text-foreground")}>{c.text}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* Weekly-goal preview (§4.6) */}
      <Card>
        <div className="space-y-1">
          <h2 className="font-serif text-lg font-semibold">First two weeks · {plural(rows.length, "weekly goal")}</h2>
          <Hint>
            {hours.length
              ? hours.map((h) => `w/c ${fmt(parseISO(h.week)!)}: ${h.hours} h planned`).join(" · ")
              : "No rows yet. Add weekly goals, habits or a review day."}
          </Hint>
        </div>
        {rows.length > 0 && (
          <div className="max-h-96 overflow-auto rounded-md border">
            <table className="w-full min-w-[900px] text-left text-xs" data-testid="weekly-preview">
              <thead className="sticky top-0 bg-muted">
                <tr>{CSV_COLS.map((c) => <th key={c} className="whitespace-nowrap px-2 py-1.5 font-medium">{c}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className={cn("border-t align-top", r.source === "review" && "bg-accent/40")}>
                    {CSV_COLS.map((c) => (
                      <td key={c} className="max-w-[16rem] truncate px-2 py-1.5" title={r[c]}>{r[c]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Commit */}
      <Card accent="border-l-success">
        <div className="space-y-1">
          <h2 className="font-serif text-lg font-semibold">Commit to Daily Compass</h2>
          <Hint>
            {committedAt
              ? `Committed ${committedAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}. Committing again updates the same records; it doesn't duplicate them.`
              : "Writes everything in one go. If anything fails, nothing is written."}
          </Hint>
        </div>
        <Button onClick={() => commit.mutate()} disabled={commit.isPending || !session} data-testid="button-commit-yearwise">
          {commit.isPending ? "Committing…" : committedAt ? "Commit again" : "Commit to Daily Compass"}
        </Button>
        {result && (
          <p className="text-sm" role="status" data-testid="commit-summary">
            Written: 1 annual target, {plural(result.counts.ninetyDayGoals, "90-day goal")}, {plural(result.counts.ifThenPlans, "if–then plan")},{" "}
            {plural(result.counts.habits, "habit")}, {plural(result.counts.weeklyGoals, "weekly goal")} and {plural(result.counts.lifeCheckins, "life check-in")}.
          </p>
        )}
        {weekOne && (
          <Button asChild variant="outline">
            <Link href={`/week/${weekOne}`} data-testid="link-week-one">
              Open week 1 (w/c {fmt(parseISO(weekOne)!)}) <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        )}
      </Card>

      {/* Exports */}
      <Card>
        <h2 className="font-serif text-lg font-semibold">Download</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => download(`weekly_goals_${start}.csv`, buildCSV(answers, dates), "text/csv;charset=utf-8")}>
            <Download className="mr-1 h-4 w-4" /> Weekly goals (.csv)
          </Button>
          <Button variant="outline" onClick={() => download(`yearwise_plan_${start}.json`, buildJSON(answers, dates), "application/json")}>
            <Download className="mr-1 h-4 w-4" /> Full plan (.json)
          </Button>
          <Button variant="outline" onClick={() => download(`yearwise_plan_${start}.md`, md, "text/markdown;charset=utf-8")}>
            <Download className="mr-1 h-4 w-4" /> Summary (.md)
          </Button>
          <Button variant="outline" onClick={copySummary}>
            <Copy className="mr-1 h-4 w-4" /> Copy summary
          </Button>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="yearwise-summary">Plan summary (Markdown)</Label>
          <Textarea id="yearwise-summary" readOnly value={md} className="h-48 font-mono text-xs" />
        </div>
      </Card>

      <p className="border-l-4 border-success pl-4 font-serif text-lg italic">
        Come back to this at the 90-day mark: re-score the ten life areas, run stop / continue / start again, and set the next three goals.
      </p>
    </div>
  );
}
