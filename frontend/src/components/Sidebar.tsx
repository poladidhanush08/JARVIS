import { NavLink } from "react-router-dom";
import { ListTree, Siren, Upload } from "lucide-react";

const ITEMS = [
  { to: "/", label: "Incidents", icon: Siren, end: true },
  { to: "/sources", label: "Sources", icon: Upload, end: false },
  { to: "/events", label: "Events", icon: ListTree, end: false },
];

export default function Sidebar() {
  return (
    <nav aria-label="Main" className="flex w-[200px] shrink-0 flex-col gap-1 border-r border-line bg-surface p-3">
      <div className="px-2 pb-3 pt-1 text-[15px] font-bold tracking-wide">J.A.R.V.I.S.</div>
      {ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex items-center gap-2 rounded-md px-2 py-2 text-[15px] transition-colors ${
              isActive ? "bg-accent/15 font-semibold text-accent" : "text-muted hover:bg-canvas"
            }`
          }
        >
          <Icon size={18} aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
