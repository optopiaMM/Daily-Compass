import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Heart, Sparkles } from "lucide-react";

interface GratitudeStepProps { date: string; onNext: () => void; }
interface GratitudeFields { general1: string; general2: string; general3: string; lizzie: string; george: string; ben: string; }

export default function GratitudeStep({ date, onNext }: GratitudeStepProps) {
  const { toast } = useToast();
  const [fields, setFields] = useState<GratitudeFields>({ general1: "", general2: "", general3: "", lizzie: "", george: "", ben: "" });

  const mutation = useMutation({
    mutationFn: async (data: GratitudeFields) => { await apiRequest("POST", "/api/gratitude", { ...data, date }); },
    onSuccess: () => { onNext(); },
    onError: (error: Error) => { toast({ title: "Error", description: error.message, variant: "destructive" }); },
  });

  const allFilled = Object.values(fields).every((v) => v.trim().length > 0);
  function updateField(key: keyof GratitudeFields, value: string) { setFields((prev) => ({ ...prev, [key]: value })); }

  return (
    <div className="space-y-6" data-testid="gratitude-step">
      <div className="flex items-center gap-3 mb-2">
        <Sparkles className="w-5 h-5 text-primary" />
        <p className="text-muted-foreground text-sm">Take a moment to reflect on what you're grateful for today.</p>
      </div>
      <div className="space-y-4">
        <p className="font-serif text-base text-foreground/80">I am grateful for...</p>
        {([1, 2, 3] as const).map((num) => (
          <div key={num} className="space-y-1">
            <label className="text-xs text-muted-foreground uppercase tracking-wide">{num}.</label>
            <Textarea placeholder="Something you're grateful for..." value={fields[`general${num}` as keyof GratitudeFields]}
              onChange={(e) => updateField(`general${num}` as keyof GratitudeFields, e.target.value)}
              className="resize-none min-h-[60px] bg-card border-border/50" data-testid={`input-general-${num}`} />
          </div>
        ))}
      </div>
      <div className="pt-2 space-y-4">
        <div className="flex items-center gap-2">
          <Heart className="w-4 h-4 text-primary/60" />
          <p className="font-serif text-base text-foreground/80">People I'm grateful for...</p>
        </div>
        {[{ key: "lizzie" as const, label: "Lizzie" }, { key: "george" as const, label: "George" }, { key: "ben" as const, label: "Ben" }].map(({ key, label }) => (
          <div key={key} className="space-y-1">
            <label className="text-xs text-muted-foreground uppercase tracking-wide">Something I'm grateful for about {label}</label>
            <Textarea placeholder={`What are you grateful for about ${label}?`} value={fields[key]}
              onChange={(e) => updateField(key, e.target.value)}
              className="resize-none min-h-[60px] bg-card border-border/50" data-testid={`input-${key}`} />
          </div>
        ))}
      </div>
      <div className="pt-4">
        <Button onClick={() => mutation.mutate(fields)} disabled={!allFilled || mutation.isPending} className="w-full" size="lg" data-testid="button-gratitude-continue">
          {mutation.isPending ? "Saving..." : "Continue"}
        </Button>
      </div>
    </div>
  );
}
