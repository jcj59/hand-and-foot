/**
 * The frame around the app's own pages: a sidebar on a computer, a tab bar along
 * the bottom of a phone, the page itself scrolling beside or above it.
 *
 * The table, a lesson and a replay are not in it. They are full-screen places a
 * player goes to and comes back from, and every pixel of a phone is the table's;
 * they have their own way out (a menu, Main menu, Back), so they use `BareFrame`.
 *
 * Learn is in the sidebar only: a phone has room for four tabs, and Home's
 * "Learn in 5 minutes" tile is the way in there.
 */
import { useSyncExternalStore } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { loadAccount, loadName, onProfileChange } from "../identity";
import { AvatarFace } from "../profile/Avatar";
import { faceOf, loadAvatar } from "../profile/avatarStore";
import { usePhone } from "../usePhone";

interface Destination {
  readonly to: string;
  readonly label: string;
  /** Shown in the phone's tab bar as well as the sidebar. */
  readonly tab: boolean;
}

export const DESTINATIONS: readonly Destination[] = [
  { to: "/", label: "Play", tab: true },
  { to: "/history", label: "History", tab: true },
  { to: "/learn", label: "Learn", tab: false },
  { to: "/rules", label: "Rules", tab: true },
  { to: "/profile", label: "Profile", tab: true },
];

export function AppShell(): React.ReactElement {
  const phone = usePhone();
  return phone ? (
    <div className="flex h-full min-h-0 flex-col bg-page text-ink">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
      <TabBar />
    </div>
  ) : (
    <div className="flex h-full min-h-0 bg-page text-ink">
      <Sidebar />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}

/** Full screen, on the table's felt, with no navigation: a table, a lesson, a replay. */
export function BareFrame(): React.ReactElement {
  return (
    <div className="h-full min-h-0 overflow-y-auto bg-felt-900 text-white">
      <Outlet />
    </div>
  );
}

function TabBar(): React.ReactElement {
  return (
    <nav
      aria-label="Main"
      className="grid shrink-0 grid-cols-4 border-t border-white/7 bg-nav px-2 pt-2 pb-[max(env(safe-area-inset-bottom),10px)]"
    >
      {DESTINATIONS.filter((d) => d.tab).map((d) => (
        <NavLink
          key={d.to}
          to={d.to}
          end={d.to === "/"}
          className={({ isActive }) =>
            `flex min-h-[52px] flex-col items-center justify-center gap-1.5 text-xs font-medium ${
              isActive ? "text-accent" : "text-muted hover:text-ink-soft"
            }`
          }
        >
          {({ isActive }) => (
            <>
              <span
                aria-hidden="true"
                className={`h-1 w-5 rounded-sm ${isActive ? "bg-accent" : "bg-transparent"}`}
              />
              {d.label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function Sidebar(): React.ReactElement {
  return (
    <nav
      aria-label="Main"
      className="flex w-[240px] shrink-0 flex-col gap-1.5 border-r border-white/6 bg-nav px-4 py-6"
    >
      <p className="mx-2.5 mb-5 font-display text-[19px] font-bold">Hand &amp; Foot</p>
      {DESTINATIONS.map((d) => (
        <NavLink
          key={d.to}
          to={d.to}
          end={d.to === "/"}
          className={({ isActive }) =>
            `flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-[15px] font-medium ${
              isActive ? "bg-accent/10 text-accent" : "text-nav-ink hover:bg-white/4 hover:text-ink"
            }`
          }
        >
          {({ isActive }) => (
            <>
              <span
                aria-hidden="true"
                className={`h-[18px] w-1 rounded-sm ${isActive ? "bg-accent" : "bg-transparent"}`}
              />
              {d.label}
            </>
          )}
        </NavLink>
      ))}
      <WhoAmI />
    </nav>
  );
}

/** The player this device sits down as: their face, name and username if signed in. */
function profileSnapshot(): string {
  return JSON.stringify([loadName().trim(), loadAccount(), loadAvatar()]);
}

function WhoAmI(): React.ReactElement | null {
  const [name, account, avatar] = JSON.parse(
    useSyncExternalStore(onProfileChange, profileSnapshot),
  ) as [string, string | null, ReturnType<typeof loadAvatar>];
  if (!name && !account) return null;
  const shown = name || account || "";
  return (
    <NavLink
      to="/profile"
      className="mt-auto flex items-center gap-2.5 rounded-[14px] bg-surface p-3 hover:bg-raised"
    >
      <AvatarFace avatar={avatar ?? faceOf({ name: shown })} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{shown}</span>
        {account && <span className="block truncate text-xs text-muted">@{account}</span>}
      </span>
    </NavLink>
  );
}
