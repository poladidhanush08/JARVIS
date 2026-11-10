import { useEffect, useState } from "react";

const supported = () => typeof window !== "undefined" && typeof window.matchMedia === "function";

/** Tracks a CSS media query. Returns false where matchMedia is unavailable (SSR, old test envs). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (supported() ? window.matchMedia(query).matches : false));

  useEffect(() => {
    if (!supported()) return;
    const mql = window.matchMedia(query);
    const onChange = (e: { matches: boolean }) => setMatches(e.matches);
    setMatches(mql.matches);
    // Safari before 14 only has the older addListener/removeListener API.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [query]);

  return matches;
}
