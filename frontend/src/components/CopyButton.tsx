import { Check, Copy, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const COPIED_MS = 1500;

export default function CopyButton({ text, what = "command" }: { text: string; what?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    let next: "copied" | "failed" = "copied";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      next = "failed"; // clipboard unavailable or permission denied
    }
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), COPIED_MS);
  };
  const Icon = state === "copied" ? Check : state === "failed" ? X : Copy;
  const label = state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy";

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={state === "idle" ? `Copy ${what}: ${text}` : label}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-0.5 text-label text-muted hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
    >
      <Icon size={14} aria-hidden="true" />
      <span aria-live="polite">{label}</span>
    </button>
  );
}
