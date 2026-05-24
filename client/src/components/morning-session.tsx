import { useState } from "react";
import GratitudeStep from "@/components/steps/gratitude-step";
import LivingPowerfullyStep from "@/components/steps/living-powerfully-step";
import WeeklyGoalsStep from "@/components/steps/weekly-goals-step";
import PreviousDayReviewStep from "@/components/steps/previous-day-review-step";
import DailyPlanningStep from "@/components/steps/daily-planning-step";
import { Progress } from "@/components/ui/progress";

interface MorningSessionProps { date: string; isMonday: boolean; onComplete: () => void; }

type MondayStep = "gratitude" | "livingPowerfully" | "weeklyGoals" | "previousDayReview" | "dailyPlanning";
type RegularStep = "gratitude" | "previousDayReview" | "dailyPlanning";

export default function MorningSession({ date, isMonday, onComplete }: MorningSessionProps) {
  const mondaySteps: MondayStep[] = ["gratitude", "livingPowerfully", "weeklyGoals", "previousDayReview", "dailyPlanning"];
  const regularSteps: RegularStep[] = ["gratitude", "previousDayReview", "dailyPlanning"];
  const steps = isMonday ? mondaySteps : regularSteps;
  const [stepIndex, setStepIndex] = useState(0);
  const currentStep = steps[stepIndex];

  const stepLabels: Record<string, string> = {
    gratitude: "Gratitude", livingPowerfully: "Living Powerfully",
    weeklyGoals: "Weekly Goals", previousDayReview: "Previous Day Review", dailyPlanning: "Daily Planning",
  };

  function nextStep() {
    if (stepIndex < steps.length - 1) setStepIndex(stepIndex + 1);
    else onComplete();
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b px-4 py-3">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs text-muted-foreground uppercase tracking-widest">Morning Session</p>
            <p className="text-xs text-muted-foreground">{stepIndex + 1} of {steps.length}</p>
          </div>
          <Progress value={((stepIndex + 1) / steps.length) * 100} className="h-1" data-testid="progress-morning-session" />
          <p className="mt-2 font-serif text-lg text-foreground" data-testid="text-step-label">{stepLabels[currentStep]}</p>
        </div>
      </div>
      <div className="flex-1 px-4 py-6">
        <div className="max-w-lg mx-auto">
          {currentStep === "gratitude" && <GratitudeStep date={date} onNext={nextStep} />}
          {currentStep === "livingPowerfully" && <LivingPowerfullyStep date={date} onNext={nextStep} />}
          {currentStep === "weeklyGoals" && <WeeklyGoalsStep date={date} onNext={nextStep} />}
          {currentStep === "previousDayReview" && <PreviousDayReviewStep date={date} onNext={nextStep} />}
          {currentStep === "dailyPlanning" && <DailyPlanningStep date={date} onComplete={onComplete} />}
        </div>
      </div>
    </div>
  );
}
