/**
 * The frame around the app's own pages: a sidebar on a computer, a tab bar along
 * the bottom of a phone, the page itself scrolling beside or above it.
 *
 * The table, a lesson and a replay are not in it. They are full-screen places a
 * player goes to and comes back from, and every pixel of a phone is the table's;
 * they have their own way out (a menu, Main menu, Back), so they use `BareFrame`.
 *
 * Learn is in the sidebar only: a phone has room for four tabs, and Home's
 * "Learn in 5 minutes" tile is the way in there. So on a phone Learn is a place
 * gone to rather than a tab: it has a Back button of its own and no tab bar, which
 * would have nothing to mark as the page being shown.
 */
import { useState, useSyncExternalStore } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { loadAccount, loadName, onProfileChange } from "../identity";
import { AvatarFace } from "../profile/Avatar";
import { faceOf, loadAvatar } from "../profile/avatarStore";
import { usePhone } from "../usePhone";
import { Icon, type IconName } from "./icons";

interface Destination {
  readonly to: string;
  readonly label: string;
  /** Shown in the phone's tab bar as well as the sidebar. */
  readonly tab: boolean;
  /** What stands for it in the sidebar folded to a rail. */
  readonly icon: IconName;
}

const DESTINATIONS: readonly Destination[] = [
  { to: "/", label: "Play", tab: true, icon: "playCircle" },
  { to: "/history", label: "History", tab: true, icon: "clock" },
  { to: "/learn", label: "Learn", tab: false, icon: "book" },
  { to: "/rules", label: "Rules", tab: true, icon: "rules" },
  { to: "/profile", label: "Profile", tab: true, icon: "user" },
];

/** Whether the sidebar is folded to its rail, kept per device. */
export const NAV_FOLDED_KEY = "hf.navFolded";

export function AppShell(): React.ReactElement {
  const phone = usePhone();
  const { pathname } = useLocation();
  const tabbed = !DESTINATIONS.some((d) => !d.tab && d.to === pathname);
  return phone ? (
    <div className="flex h-full min-h-0 flex-col bg-page text-ink">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
      {tabbed && <TabBar />}
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

/**
 * The computer's navigation, which folds to a rail of icons to give a page the
 * room: each destination keeps its name for a screen reader and as a tooltip, and
 * the choice is remembered on this device.
 */
function Sidebar(): React.ReactElement {
  const [folded, setFolded] = useState(readFolded);
  const fold = (on: boolean): void => {
    setFolded(on);
    try {
      window.localStorage.setItem(NAV_FOLDED_KEY, on ? "1" : "0");
    } catch {
      // Blocked storage: the choice lasts until the page is reloaded.
    }
  };
  return (
    <nav
      aria-label="Main"
      data-folded={folded ? "" : undefined}
      className={`flex shrink-0 flex-col gap-1.5 overflow-hidden border-r border-white/6 bg-nav py-6 transition-[width] duration-200 ease-out motion-reduce:transition-none ${
        folded ? "w-[72px] px-3" : "w-[240px] px-4"
      }`}
    >
      <div className={`mb-5 flex items-center ${folded ? "justify-center" : "pl-2.5"}`}>
        {!folded && (
          <p className="m-0 flex-1 truncate font-display text-[19px] font-bold">Hand &amp; Foot</p>
        )}
        <button
          type="button"
          aria-label={folded ? "Show the menu" : "Fold the menu"}
          title={folded ? "Show the menu" : "Fold the menu"}
          aria-expanded={!folded}
          onClick={() => fold(!folded)}
          className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-white/8 hover:text-ink"
        >
          <Icon name={folded ? "navUnfold" : "navFold"} size={18} />
        </button>
      </div>
      {DESTINATIONS.map((d) => (
        <NavLink
          key={d.to}
          to={d.to}
          end={d.to === "/"}
          title={folded ? d.label : undefined}
          className={({ isActive }) =>
            `flex min-h-11 items-center gap-2.5 rounded-xl text-[15px] font-medium ${
              folded ? "justify-center" : "px-3"
            } ${
              isActive ? "bg-accent/10 text-accent" : "text-nav-ink hover:bg-white/4 hover:text-ink"
            }`
          }
        >
          {({ isActive }) =>
            folded ? (
              <>
                <Icon name={d.icon} size={20} />
                <span className="sr-only">{d.label}</span>
              </>
            ) : (
              <>
                <span
                  aria-hidden="true"
                  className={`h-[18px] w-1 rounded-sm ${isActive ? "bg-accent" : "bg-transparent"}`}
                />
                {d.label}
              </>
            )
          }
        </NavLink>
      ))}
      <WhoAmI folded={folded} />
    </nav>
  );
}

function readFolded(): boolean {
  try {
    return window.localStorage.getItem(NAV_FOLDED_KEY) === "1";
  } catch {
    return false;
  }
}

/** The player this device sits down as: their face, name and username if signed in. */
function profileSnapshot(): string {
  return JSON.stringify([loadName().trim(), loadAccount(), loadAvatar()]);
}

function WhoAmI({ folded }: { readonly folded: boolean }): React.ReactElement | null {
  const [name, account, avatar] = JSON.parse(
    useSyncExternalStore(onProfileChange, profileSnapshot),
  ) as [string, string | null, ReturnType<typeof loadAvatar>];
  if (!name && !account) return null;
  const shown = name || account || "";
  return (
    <NavLink
      to="/profile"
      title={folded ? shown : undefined}
      className={`mt-auto flex items-center gap-2.5 rounded-[14px] hover:bg-raised ${
        folded ? "justify-center p-1" : "bg-surface p-3"
      }`}
    >
      <AvatarFace avatar={avatar ?? faceOf({ name: shown })} size={40} />
      <span className={folded ? "sr-only" : "min-w-0 flex-1"}>
        <span className="block truncate text-sm font-semibold">{shown}</span>
        {account && <span className="block truncate text-xs text-muted">@{account}</span>}
      </span>
    </NavLink>
  );
}
