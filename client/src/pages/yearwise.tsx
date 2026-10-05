import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { ArrowLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { YearwiseSession } from "@shared/schema";
import { type Answers, STEPS, fmt, parseISO, stepProgress } from "@shared/yearwise";

// Average of the step rings, for a quick "how far through" on each session.
function overallProgress(answers: Answers) {
  const ps = STEPS.map((s) => stepProgress(s.id, answers)).filter((p): p is number => p !== null);
  return ps.reduce((a, b) => a + b, 0) / ps.length;
}

export default function YearwisePage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: sessions, isLoading } = useQuery<YearwiseSession[]>({ queryKey: ["/api/yearwise-sessions"] });

  const start = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/yearwise-sessions", { kind: "annual" })).json() as Promise<YearwiseSession>,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["/api/yearwise-sessions"], exact: true });
      navigate(`/yearwise/${created.id}/welcome`);
    },
    onError: (e: Error) => toast({ title: "Couldn't start a review", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl space-y-8 px-4 py-8 sm:py-12">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Daily Compass
        </Link>
        <header className="space-y-3">
          <h1 className="font-serif text-3xl font-semibold">Yearwise</h1>
          <p className="text-muted-foreground">
            Look back, choose a direction, then hand it to Daily Compass. About two hours, best done in three sittings. Your answers save as you go.
          </p>
          <Button onClick={() => start.mutate()} disabled={start.isPending}>
            <Plus /> {start.isPending ? "Starting…" : "Start annual review"}
          </Button>
        </header>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Your reviews</h2>
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {sessions && sessions.length === 0 && <p className="text-sm text-muted-foreground">No reviews yet.</p>}
          <ul className="space-y-3">
            {sessions?.map((s) => {
              const pct = Math.round(overallProgress((s.answers ?? {}) as Answers) * 100);
              const startDate = parseISO(s.planStart);
              return (
                <li key={s.id}>
                  <Link
                    href={`/yearwise/${s.id}`}
                    className="flex items-center gap-4 rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
                  >
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{s.kind === "quarterly" ? "90-day review" : "Annual review"}</span>
                        <span className={s.status === "committed" ? "rounded-full bg-success/15 px-2 py-0.5 text-xs font-semibold text-success" : "rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"}>
                          {s.status === "committed" ? "Committed" : "Draft"}
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {startDate ? `Plan from ${fmt(startDate)}` : ""} · last saved {new Date(s.updatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </div>
                      <div className="flex items-center gap-2">
                        <Progress value={pct} className="h-1.5" />
                        <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{pct}%</span>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
