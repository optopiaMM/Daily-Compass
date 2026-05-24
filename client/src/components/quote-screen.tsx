import { useQuery } from "@tanstack/react-query";
import type { DailyQuote } from "@shared/schema";
import { getLocalQuoteForDate } from "@/lib/quotes";
import { Quote } from "lucide-react";

interface QuoteScreenProps { date: string; onDismiss: () => void; }

export default function QuoteScreen({ date, onDismiss }: QuoteScreenProps) {
  const { data: quote } = useQuery<DailyQuote>({ queryKey: ["/api/quote", date] });
  const fallback = getLocalQuoteForDate(date);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-8 cursor-pointer select-none" onClick={onDismiss} data-testid="quote-screen">
      <div className="max-w-lg w-full flex flex-col items-center text-center gap-8">
        <Quote className="w-10 h-10 text-primary/40" />
        <blockquote className="font-serif text-2xl md:text-3xl leading-relaxed text-foreground/90 italic" data-testid="text-quote">
          {quote?.quoteText || fallback.text}
        </blockquote>
        <p className="text-muted-foreground text-sm tracking-widest uppercase" data-testid="text-quote-author">
          {quote?.author || fallback.author}
        </p>
        <div className="mt-12 flex flex-col items-center gap-2">
          <div className="w-8 h-0.5 bg-primary/30 rounded-full" />
          <p className="text-muted-foreground/60 text-xs">Tap anywhere to continue</p>
        </div>
      </div>
    </div>
  );
}
