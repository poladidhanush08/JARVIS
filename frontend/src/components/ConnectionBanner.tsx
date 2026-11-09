import { LoaderCircle } from "lucide-react";
import type { BackendStatus } from "../hooks/useBackendReady";

/** Calm notice while the backend wakes up; renders nothing once it answers. */
export default function ConnectionBanner({ status }: { status: BackendStatus }) {
  if (status !== "waking") return null;
  return (
    <div
      role="status"
      className="mb-6 flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-body"
    >
      <LoaderCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted" />
      <div>
        <p className="font-semibold text-ink">Waking up the analysis engine…</p>
        <p className="text-label text-muted">
          The server sleeps when nobody is using it and takes up to a minute to start. This page will
          connect on its own.
        </p>
      </div>
    </div>
  );
}
