import { NavLink } from "react-router-dom";
import { ListTree, Siren, Upload } from "lucide-react";

const ITEMS = [
  { to: "/", label: "Incidents", icon: Siren, end: true },
  { to: "/sources", label: "Sources", icon: Upload, end: false },
  { to: "/events", label: "Events", icon: ListTree, end: false },
];

/** 200 px with labels from md up; below md it collapses to icons, labels show on hover/focus. */
export default function Sidebar() {
  return (
    <nav
      aria-label="Main"
      className="flex w-14 shrink-0 flex-col gap-1 border-r border-line bg-surface p-2 md:w-[200px] md:p-3"
    >
      <div className="px-2 pb-3 pt-1 text-body font-bold tracking-wide">
        <span className="sr-only md:not-sr-only">J.A.R.V.I.S.</span>
        <span className="md:hidden" aria-hidden="true" title="J.A.R.V.I.S.">
          J
        </span>
      </div>
      {ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          aria-label={label}
          title={label}
          className={({ isActive }) =>
            `group relative flex items-center justify-center gap-2 rounded-md px-2 py-2 text-body transition-colors md:justify-start ${
              isActive ? "bg-accent/15 font-semibold text-accent" : "text-muted hover:bg-canvas"
            }`
          }
        >
          <Icon size={18} aria-hidden="true" />
          <span className="hidden md:inline">{label}</span>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-full top-1/2 z-10 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1 text-label font-normal text-ink shadow-sm max-md:group-hover:block max-md:group-focus-visible:block"
          >
            {label}
          </span>
        </NavLink>
      ))}
    </nav>
  );
}
