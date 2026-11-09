import { animate } from "motion";
import { useEffect, useRef, useState } from "react";

/** Animations run only in a real browser that has not asked for reduced motion. */
export function canAnimate(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Counts from the last shown value to `target` (ease-out). Without animation it jumps. */
export function useCountUp(target: number, duration = 0.8): number {
  const [value, setValue] = useState(() => (canAnimate() ? 0 : target));
  const shown = useRef(value);

  useEffect(() => {
    if (!canAnimate() || shown.current === target) {
      shown.current = target;
      setValue(target);
      return;
    }
    const controls = animate(shown.current, target, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => {
        shown.current = Math.round(v);
        setValue(shown.current);
      },
    });
    return () => controls.stop();
  }, [target, duration]);

  return value;
}
