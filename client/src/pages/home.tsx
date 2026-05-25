import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTodayStr, isMonday } from "@/lib/dateUtils";
import QuoteScreen from "@/components/quote-screen";
import MorningSession from "@/components/morning-session";
import DayView from "@/components/day-view";

type AppState = "loading" | "quote" | "morning" | "dayview";

export default function Home() {
  const [appState, setAppState] = useState<AppState>("loading");
  const today = getTodayStr();

  const { data: sessionStatus, isLoading } = useQuery<{ completed: boolean }>({
    queryKey: ["/api/morning-session", today],
  });

  useEffect(() => {
    if (!isLoading && sessionStatus !== undefined) setAppState("quote");
  }, [isLoading, sessionStatus]);

  if (appState === "loading" || isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" data-testid="loading-screen">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-success/20" />
          <p className="text-muted-foreground font-serif text-lg">Preparing your day...</p>
        </div>
      </div>
    );
  }

  if (appState === "quote") {
    return (
      <QuoteScreen
        date={today}
        onDismiss={() => setAppState(sessionStatus?.completed ? "dayview" : "morning")}
      />
    );
  }

  if (appState === "morning") {
    return <MorningSession date={today} isMonday={isMonday(today)} onComplete={() => setAppState("dayview")} />;
  }

  return <DayView date={today} />;
}
