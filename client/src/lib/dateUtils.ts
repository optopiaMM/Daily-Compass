export function getTodayStr(): string {
  return new Date().toISOString().split("T")[0];
}

export function isMonday(dateStr?: string): boolean {
  const d = dateStr ? new Date(dateStr + "T12:00:00") : new Date();
  return d.getDay() === 1;
}

export function getWeekStartDate(dateStr?: string): string {
  const d = dateStr ? new Date(dateStr + "T12:00:00") : new Date();
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d.toISOString().split("T")[0];
}

export function getPreviousWeekStartDate(dateStr?: string): string {
  const weekStart = getWeekStartDate(dateStr);
  const d = new Date(weekStart + "T12:00:00");
  d.setDate(d.getDate() - 7);
  return d.toISOString().split("T")[0];
}

export function formatDateNice(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function getDayOfWeek(dateStr?: string): string {
  const d = dateStr ? new Date(dateStr + "T12:00:00") : new Date();
  return d.toLocaleDateString("en-GB", { weekday: "long" });
}

export function getRemainingDaysOfWeek(dateStr: string): { label: string; date: string }[] {
  const d = new Date(dateStr + "T12:00:00");
  const results: { label: string; date: string }[] = [];
  const current = new Date(d);
  current.setDate(current.getDate() + 1);
  const weekEnd = new Date(d);
  const dayOfWeek = d.getDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  weekEnd.setDate(d.getDate() + daysUntilSunday);
  while (current <= weekEnd) {
    results.push({
      label: current.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" }),
      date: current.toISOString().split("T")[0],
    });
    current.setDate(current.getDate() + 1);
  }
  return results;
}

export function getNextMonday(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const dayOfWeek = d.getDay();
  const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  d.setDate(d.getDate() + daysUntilMonday);
  return d.toISOString().split("T")[0];
}

export function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
