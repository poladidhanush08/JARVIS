export function confidenceLabel(c: number): "High" | "Medium" | "Low" {
  if (c >= 75) return "High";
  if (c >= 50) return "Medium";
  return "Low";
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const secs = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs} s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function tPlus(iso: string, startIso: string): string {
  const secs = Math.max(0, Math.round((new Date(iso).getTime() - new Date(startIso).getTime()) / 1000));
  return `T+${secs}s`;
}
