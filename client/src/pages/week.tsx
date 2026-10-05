import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft } from "lucide-react";
import WeeklyGoalsStep from "@/components/steps/weekly-goals-step";
import { formatDateNice, getWeekStartDate } from "@/lib/dateUtils";

// The Monday weekly-goals view for any week, so a plan committed from Yearwise
// can be opened before (or after) its Monday comes round.
export default function WeekPage() {
  const { weekStart } = useParams<{ weekStart: string }>();
  const [, navigate] = useLocation();
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(weekStart ?? "");
  const monday = valid ? getWeekStartDate(weekStart) : "";

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Today
        </Link>
        {valid ? (
          <>
            <header className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-success">Weekly goals</p>
              <h1 className="font-serif text-2xl font-semibold">Week of {formatDateNice(monday)}</h1>
            </header>
            <WeeklyGoalsStep key={monday} date={monday} onNext={() => navigate("/")} />
          </>
        ) : (
          <p className="text-muted-foreground">That isn't a date. Use /week/YYYY-MM-DD.</p>
        )}
      </div>
    </div>
  );
}
