import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { YearwiseContext, ProgressRing } from "@/components/yearwise/fields";
import { STEP_CONTENT } from "@/components/yearwise/steps";
import { useYearwiseAutosave, type SaveStatus } from "@/hooks/use-yearwise-autosave";
import type { YearwiseSession } from "@shared/schema";
import {
  type Answers, type StepId, STEPS, GROUP_TIMES, deriveDates, fmt, isStepId, migrateParents, setP, stepProgress,
} from "@shared/yearwise";

const lastStepKey = (id: number) => `yearwise:last:${id}`;

export default function YearwiseSessionPage() {
  const params = useParams<{ sessionId: string; step?: string }>();
  const [, navigate] = useLocation();
  const id = Number(params.sessionId);

  const { data: session, isLoading, error } = useQuery<YearwiseSession>({
    queryKey: ["/api/yearwise-sessions", id],
    enabled: Number.isInteger(id),
    // Local state is the source of truth once loaded; never refetch over it.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  // /yearwise/:id → resume at the last step used in this browser.
  useEffect(() => {
    if (params.step && isStepId(params.step)) return;
    let last: string | null = null;
    try { last = localStorage.getItem(lastStepKey(id)); } catch {}
    navigate(`/yearwise/${id}/${last && isStepId(last) ? last : "welcome"}`, { replace: true });
  }, [params.step, id, navigate]);

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">Loading your review…</div>;
  }
  if (error || !session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
        <p className="text-muted-foreground">That review couldn't be found.</p>
        <Button asChild variant="outline"><Link href="/yearwise">All reviews</Link></Button>
      </div>
    );
  }
  if (!params.step || !isStepId(params.step)) return null;
  return <Wizard key={session.id} session={session} step={params.step} />;
}

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: "Not saved yet",
  saving: "Saving…",
  saved: "Saved",
  error: "Couldn't save, retrying",
};

function Wizard({ session, step }: { session: YearwiseSession; step: StepId }) {
  const [, navigate] = useLocation();
  const [answers, setAnswers] = useState<Answers>(() => migrateParents((session.answers ?? {}) as Answers));
  const { status, schedule } = useYearwiseAutosave(session.id, Object.keys(answers).length ? "saved" : "idle");

  const edited = useRef(false);
  const set = useCallback((path: string, value: unknown) => {
    edited.current = true;
    setAnswers((prev) => setP(prev, path, value));
  }, []);
  useEffect(() => {
    if (edited.current) schedule(answers);
  }, [answers, schedule]);

  const dates = useMemo(() => deriveDates(answers), [answers]);
  const ctx = useMemo(() => ({ answers, dates, set }), [answers, dates, set]);

  // New step: remember it, scroll to the top, and keep the mobile nav's current item in view.
  useEffect(() => {
    try { localStorage.setItem(lastStepKey(session.id), step); } catch {}
    window.scrollTo({ top: 0 });
    if (window.matchMedia("(max-width: 767px)").matches) {
      document.querySelector('[data-nav-current="true"]')?.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }, [step, session.id]);

  const go = (s: StepId) => navigate(`/yearwise/${session.id}/${s}`);
  const idx = STEPS.findIndex((s) => s.id === step);
  const prev = STEPS[idx - 1];
  const next = STEPS[idx + 1];
  const content = STEP_CONTENT[step];
  const groups = Array.from(new Set(STEPS.map((s) => s.group)));

  return (
    <YearwiseContext.Provider value={ctx}>
      <div className="min-h-screen bg-background md:grid md:grid-cols-[270px_minmax(0,1fr)]">
        <aside className="sticky top-0 z-20 border-b bg-sidebar px-4 py-3 md:h-screen md:overflow-y-auto md:border-b-0 md:border-r md:px-5 md:py-7">
          <div className="flex items-center justify-between gap-3 md:block md:space-y-1">
            <Link href="/yearwise" className="hidden items-center gap-1 text-xs text-muted-foreground hover:text-foreground md:flex">
              <ArrowLeft className="h-3 w-3" /> All reviews
            </Link>
            <div className="flex items-baseline gap-2 md:block">
              <Link href="/yearwise" className="md:hidden" aria-label="All reviews"><ArrowLeft className="h-4 w-4" /></Link>
              <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground md:pt-3">Yearwise</div>
              <div className="font-serif text-lg font-semibold md:text-4xl">
                {dates.start.getFullYear()}<span className="px-1 text-success">→</span>{String(dates.yearEnd.getFullYear()).slice(2)}
              </div>
              <div className="hidden text-sm text-muted-foreground md:block">Plan from {fmt(dates.start)}</div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground md:pt-2" role="status" aria-live="polite">
              <i
                className={cn(
                  "inline-block h-2 w-2 rounded-full",
                  status === "saved" && "bg-success",
                  status === "saving" && "animate-pulse bg-info",
                  status === "error" && "bg-destructive",
                  status === "idle" && "bg-muted-foreground/40",
                )}
              />
              <span>{STATUS_TEXT[status]}</span>
            </div>
          </div>

          <nav aria-label="Workbook sections" className="-mx-4 mt-3 flex gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:mt-6 md:block md:space-y-5 md:overflow-visible md:px-0">
            {groups.map((g) => (
              <div key={g} className="flex shrink-0 gap-1 md:block md:space-y-0.5">
                <h3 className="hidden items-baseline justify-between px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground md:flex">
                  {g}
                  {GROUP_TIMES[g] && <em className="font-normal normal-case not-italic">{GROUP_TIMES[g]}</em>}
                </h3>
                {STEPS.filter((s) => s.group === g).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => go(s.id)}
                    aria-current={s.id === step ? "step" : undefined}
                    data-nav-current={s.id === step}
                    className={cn(
                      "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-sm transition-colors md:w-full",
                      s.id === step ? "bg-sidebar-primary font-medium text-sidebar-primary-foreground" : "hover:bg-sidebar-accent",
                    )}
                  >
                    <ProgressRing value={stepProgress(s.id, answers)} />
                    {s.nav}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <main className="px-4 py-6 sm:px-8 md:py-10">
          <section className="mx-auto max-w-3xl space-y-6">
            {!content.intro && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-success">
                  {content.eyebrow}
                  {content.time && <span className="rounded-full bg-muted px-2 py-0.5 font-medium normal-case tracking-normal text-muted-foreground">{content.time}</span>}
                </div>
                <h1 className="font-serif text-2xl font-semibold leading-tight sm:text-3xl">{content.title}</h1>
                {content.lede && <p className="text-muted-foreground">{content.lede}</p>}
              </div>
            )}
            <content.Body />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-6">
              {prev ? (
                <Button variant="outline" className="h-auto min-h-9 whitespace-normal" onClick={() => go(prev.id)}>← {prev.nav}</Button>
              ) : <span />}
              {next && (
                <Button className="ml-auto h-auto min-h-9 whitespace-normal" onClick={() => go(next.id)}>
                  {idx === 0 ? "Begin" : "Next: " + next.nav} →
                </Button>
              )}
            </div>
          </section>
        </main>
      </div>
    </YearwiseContext.Provider>
  );
}
