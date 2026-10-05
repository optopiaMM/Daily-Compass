import { createContext, useContext, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type Answers, type ChipSource, type PlanDates,
  V, getP, chipItems, ifIssue, reflection, PILLARS, TRACKS,
} from "@shared/yearwise";

/* ================= context ================= */

interface YearwiseCtx {
  answers: Answers;
  dates: PlanDates;
  set: (path: string, value: unknown) => void;
}

export const YearwiseContext = createContext<YearwiseCtx | null>(null);

export function useYearwise() {
  const ctx = useContext(YearwiseContext);
  if (!ctx) throw new Error("useYearwise must be used inside YearwiseContext");
  return ctx;
}

// The raw stored value as a string (not trimmed, so typing isn't disturbed).
function useField(path: string) {
  const { answers, set } = useYearwise();
  const v = getP(answers, path);
  return { value: v == null ? "" : String(v), set: (x: unknown) => set(path, x) };
}

const fid = (p: string) => "f-" + p.replace(/\./g, "-");

/* ================= layout pieces ================= */

export function Why({ children, label = "Why" }: { children: ReactNode; label?: string }) {
  return (
    <div className="flex gap-3 rounded-md border-l-4 border-info bg-accent/60 px-4 py-3 text-sm">
      <b className="shrink-0 text-accent-foreground">{label}</b>
      <span className="text-foreground/90">{children}</span>
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
      {children}
    </div>
  );
}

export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-sm text-muted-foreground", className)}>{children}</div>;
}

export function Card({ children, accent, className }: { children: ReactNode; accent?: string; className?: string }) {
  return (
    <div className={cn("space-y-4 rounded-lg border bg-card p-4 sm:p-5", accent && "border-l-4", accent, className)}>
      {children}
    </div>
  );
}

export function Tag({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "low" | "opt" }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold",
        tone === "default" && "bg-success/15 text-success",
        tone === "low" && "bg-destructive/10 text-destructive",
        tone === "opt" && "bg-muted font-medium text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

export function Grid({ cols, children }: { cols: 2 | 3 | 4; children: ReactNode }) {
  return (
    <div
      className={cn(
        "grid gap-3",
        cols === 2 && "sm:grid-cols-2",
        cols === 3 && "sm:grid-cols-3",
        cols === 4 && "sm:grid-cols-2 lg:grid-cols-4",
      )}
    >
      {children}
    </div>
  );
}

export function StepHeading({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="flex gap-3 pt-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{n}</div>
      <div>
        <h2 className="font-semibold">{title}</h2>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

export function SubHead({ children }: { children: ReactNode }) {
  return <div className="pt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</div>;
}

/* ================= inputs ================= */

// Block-level field with a prominent label ("text"/"area" in the prototype).
export function TextField({ path, label, hint, placeholder, ariaLabel, big }: {
  path: string; label?: string; hint?: string; placeholder?: string; ariaLabel?: string; big?: boolean;
}) {
  const f = useField(path);
  return (
    <div className="space-y-1.5">
      {label && <Label htmlFor={fid(path)} className="text-base font-semibold">{label}</Label>}
      {hint && <Hint>{hint}</Hint>}
      <Input
        id={fid(path)}
        value={f.value}
        onChange={(e) => f.set(e.target.value)}
        placeholder={placeholder}
        aria-label={!label ? ariaLabel : undefined}
        className={cn(big && "h-11 text-base font-medium md:text-base")}
      />
    </div>
  );
}

export function AreaField({ path, label, hint, placeholder }: { path: string; label: string; hint?: string; placeholder?: string }) {
  const f = useField(path);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={fid(path)} className="text-base font-semibold">{label}</Label>
      {hint && <Hint>{hint}</Hint>}
      <Textarea id={fid(path)} value={f.value} onChange={(e) => f.set(e.target.value)} placeholder={placeholder} className="min-h-[88px] font-serif" />
    </div>
  );
}

// Compact labelled field ("fl" in the prototype).
export function Field({ path, label, kind = "area", placeholder }: {
  path: string; label: string; kind?: "area" | "text" | "num" | "date"; placeholder?: string;
}) {
  const f = useField(path);
  const id = fid(path);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm text-muted-foreground">{label}</Label>
      {kind === "area" ? (
        <Textarea id={id} value={f.value} onChange={(e) => f.set(e.target.value)} placeholder={placeholder} className="font-serif" />
      ) : (
        <Input
          id={id}
          type={kind === "num" ? "number" : kind === "date" ? "date" : "text"}
          min={kind === "num" ? 0 : undefined}
          step={kind === "num" ? 5 : undefined}
          inputMode={kind === "num" ? "numeric" : undefined}
          value={f.value}
          onChange={(e) => f.set(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}

const NONE = "__none";
type Opt = string | readonly [string, string];

export function SelectField({ path, label, options, blank = "Choose…" }: {
  path: string; label: string; options: readonly Opt[]; blank?: string;
}) {
  const f = useField(path);
  const id = fid(path);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm text-muted-foreground">{label}</Label>
      <Select value={f.value} onValueChange={(v) => f.set(v === NONE ? "" : v)}>
        <SelectTrigger id={id}>
          <SelectValue placeholder={blank} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE} className="text-muted-foreground">{blank}</SelectItem>
          {options.map((o) => {
            const [v, l] = typeof o === "string" ? [o, o] : o;
            return <SelectItem key={v} value={v}>{l}</SelectItem>;
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

export function PillarSelect({ path, label = "Pillar" }: { path: string; label?: string }) {
  return <SelectField path={path} label={label} options={PILLARS} />;
}

// BD track: a known track, or "Other…" with free text in `<path>Other`.
export function TrackSelect({ path }: { path: string }) {
  const { answers } = useYearwise();
  return (
    <div className="space-y-1.5">
      <SelectField path={path} label="BD track" options={[...TRACKS, ["other", "Other…"] as const]} blank="None" />
      {V(answers, path) === "other" && <OtherTrack path={path + "Other"} />}
    </div>
  );
}

function OtherTrack({ path }: { path: string }) {
  const f = useField(path);
  return <Input value={f.value} onChange={(e) => f.set(e.target.value)} placeholder="Which track?" aria-label="Other BD track" />;
}

// Numbered list of n text inputs at `<path>.0` … `<path>.n-1`.
export function NumList({ path, n, label, hint, placeholder }: { path: string; n: number; label: string; hint?: string; placeholder?: string }) {
  return (
    <div className="space-y-2">
      <div className="text-base font-semibold">{label}</div>
      {hint && <Hint>{hint}</Hint>}
      <ol className="space-y-2">
        {Array.from({ length: n }, (_, i) => (
          <li key={i} className="flex items-center gap-3">
            <span className="w-5 shrink-0 text-right text-sm font-semibold text-muted-foreground">{i + 1}</span>
            <NumListInput path={`${path}.${i}`} ariaLabel={`${label} ${i + 1}`} placeholder={i === 0 ? placeholder : undefined} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function NumListInput({ path, ariaLabel, placeholder }: { path: string; ariaLabel: string; placeholder?: string }) {
  const f = useField(path);
  return <Input id={fid(path)} value={f.value} onChange={(e) => f.set(e.target.value)} aria-label={ariaLabel} placeholder={placeholder} />;
}

/* ================= chips ================= */

// Tap-to-fill suggestions; hidden when the source is empty.
export function Chips({ src, target }: { src: ChipSource; target: string }) {
  const { answers, set } = useYearwise();
  const items = chipItems(answers, src);
  if (!items.length) return null;
  const cur = V(answers, target);
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((t, i) => (
        <button
          key={i + t}
          type="button"
          title={t}
          aria-pressed={t === cur}
          onClick={() => set(target, t)}
          className={cn(
            "max-w-full truncate rounded-full border px-3 py-1 text-sm transition-colors",
            t === cur ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-accent",
          )}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

/* ================= if–then row with live check ================= */

export function IfThenRow({ path, k }: { path: string; k: number }) {
  const { answers } = useYearwise();
  const issue = ifIssue(answers, path, k);
  const q = useField(`${path}.if${k}`);
  const r = useField(`${path}.then${k}`);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 sm:grid-cols-[auto_1fr_auto_1fr]">
        <b className="text-sm">If</b>
        <Input
          value={q.value}
          onChange={(e) => q.set(e.target.value)}
          aria-label={`If (plan ${k})`}
          placeholder={k === 1 ? "I notice I'm putting off a call" : "it's 3pm and I haven't…"}
        />
        <b className="text-sm">then</b>
        <Input
          value={r.value}
          onChange={(e) => r.set(e.target.value)}
          aria-label={`Then (plan ${k})`}
          placeholder={k === 1 ? "I dial within 5 minutes" : "I…"}
        />
      </div>
      {issue && <Note>{issue}</Note>}
    </div>
  );
}

/* ================= life area rating ================= */

export function LifeRating({ areaKey, name }: { areaKey: string; name: string }) {
  const { answers, set, dates } = useYearwise();
  const p = `life.${areaKey}`;
  const score = Number(getP(answers, p + ".score")) || 0;
  const why = useField(p + ".why");
  const plus2 = useField(p + ".plus2");
  return (
    <div className="grid gap-3 border-b py-4 last:border-b-0 sm:grid-cols-[140px_1fr]">
      <div className="font-semibold">{name}</div>
      <div className="space-y-2">
        <div role="radiogroup" aria-label={`${name} score`} className="grid grid-cols-10 gap-1">
          {Array.from({ length: 10 }, (_, i) => {
            const n = i + 1;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={n === score}
                aria-label={`${n} out of 10`}
                // Clicking the selected value again clears it.
                onClick={() => set(p + ".score", n === score ? "" : n)}
                className={cn(
                  "h-8 rounded-md border text-sm tabular-nums transition-colors",
                  n === score && "border-primary bg-primary font-semibold text-primary-foreground",
                  n < score && "border-primary/30 bg-primary/15",
                  n > score && "bg-background hover:bg-accent",
                )}
              >
                {n}
              </button>
            );
          })}
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Struggling</span>
          <span>Thriving</span>
        </div>
        <Textarea
          value={why.value}
          onChange={(e) => why.set(e.target.value)}
          placeholder="Why this number?"
          aria-label={`Why, for ${name}`}
          className="font-serif"
        />
        <Input
          value={plus2.value}
          onChange={(e) => plus2.set(e.target.value)}
          placeholder={`+2 by ${dates.endLabel} would look like…`}
          aria-label={`What +2 would look like for ${name}`}
        />
      </div>
    </div>
  );
}

/* ================= reflection panel (§4.4) ================= */

export function ReflectionPanel() {
  const { answers } = useYearwise();
  const r = reflection(answers);
  if (!r) return null;
  return (
    <Collapsible defaultOpen className="rounded-lg border bg-sidebar">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 px-4 py-3 text-left font-semibold">
        Your reflection, to check these goals against
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-4 px-4 pb-4 text-sm sm:grid-cols-2">
          {r.low.length > 0 && (
            <div>
              <h4 className="mb-1 font-semibold text-muted-foreground">Lowest scores and your +2</h4>
              <ul className="list-disc space-y-1 pl-5">
                {r.low.map((x) => (
                  <li key={x.name}><b>{x.name} {x.score}/10</b>{x.plus2 ? " · " + x.plus2 : ""}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="space-y-3">
            {r.best.length > 0 && (
              <div>
                <h4 className="mb-1 font-semibold text-muted-foreground">What matters most in your best year</h4>
                <ul className="list-disc space-y-1 pl-5">{r.best.map((t) => <li key={t}>{t}</li>)}</ul>
              </div>
            )}
            {r.highThreads && (
              <div>
                <h4 className="mb-1 font-semibold text-muted-foreground">Your best moments had in common</h4>
                <p className="whitespace-pre-line">{r.highThreads}</p>
              </div>
            )}
            {r.lowNeed && (
              <div>
                <h4 className="mb-1 font-semibold text-muted-foreground">What you needed in the lows</h4>
                <p className="whitespace-pre-line">{r.lowNeed}</p>
              </div>
            )}
            {r.starts.length > 0 && (
              <div>
                <h4 className="mb-1 font-semibold text-muted-foreground">Your starts</h4>
                <ul className="list-disc space-y-1 pl-5">{r.starts.map((t) => <li key={t}>{t}</li>)}</ul>
              </div>
            )}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ================= progress ring ================= */

export function ProgressRing({ value }: { value: number | null }) {
  if (value === null) return <span className="h-4 w-4 shrink-0" />;
  const done = value >= 0.999;
  const c = 2 * Math.PI * 6;
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 -rotate-90" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill={done ? "hsl(var(--success))" : "none"} stroke="hsl(var(--border))" strokeWidth="2.5" />
      {!done && value > 0 && (
        <circle cx="8" cy="8" r="6" fill="none" stroke="hsl(var(--success))" strokeWidth="2.5" strokeDasharray={`${value * c} ${c}`} />
      )}
      {done && <path d="M5.5 8.3l1.8 1.8 3.3-3.6" transform="rotate(90 8 8)" fill="none" stroke="hsl(var(--success-foreground))" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}
