/**
 * The page's facts for a bug report, read from the browser as the report sheet
 * opens: the device, the route, the profile, the recent logs, the session store
 * and the browser's `hf.*` storage. Everything here is read defensively: a
 * browser that hides a fact, or throws reading it, leaves it out rather than
 * keeping the report from being sent.
 *
 * Secrets are read too, but only so they can be searched for and removed
 * (`PageFacts.secrets`): the identity's secret and every seat token this
 * browser holds.
 */
import { loadAccount, loadIdentity, loadName } from "../identity";
import { loadAvatar } from "../profile/avatarStore";
import { loadSavedGames } from "../savedGames";
import { useSession } from "../session";
import { audioState } from "../table/audio";
import type { PageFacts } from "./context";
import { recentErrors } from "./errors";
import { recentRecords } from "./recorder";

/** The build this page came from: the git short sha, set by Vite at build time. */
export const BUILD_ID: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "unknown";

/** Storage keys of this game; nothing else on the origin is read. */
const OWN_KEY = /^hf\./;

function attempt<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** Every `hf.*` key of one of the browser's stores, its value read as JSON where it is JSON. */
export function storageDump(storage: Storage | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!storage) return out;
  const keys =
    attempt(() => Array.from({ length: storage.length }, (_, i) => storage.key(i))) ?? [];
  for (const key of keys.sort()) {
    if (key === null || !OWN_KEY.test(key)) continue;
    const raw = attempt(() => storage.getItem(key));
    if (raw === null || raw === undefined) continue;
    out[key] = attempt(() => JSON.parse(raw) as unknown) ?? raw;
  }
  return out;
}

function media(query: string): boolean | undefined {
  return attempt(() =>
    typeof window.matchMedia === "function" ? window.matchMedia(query).matches : undefined,
  );
}

/** The device and browser: what could make a bug happen on one and not another. */
function deviceFacts(): Record<string, unknown> {
  const nav = window.navigator as Navigator & {
    connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean };
    userAgentData?: { platform?: string; mobile?: boolean };
  };
  const connection = nav.connection;
  const navigation = attempt(() => performance.getEntriesByType("navigation")[0]?.toJSON());
  return {
    orientation: attempt(() => window.screen.orientation?.type),
    screen: attempt(() => ({ width: window.screen.width, height: window.screen.height })),
    reducedMotion: media("(prefers-reduced-motion: reduce)"),
    colorScheme: media("(prefers-color-scheme: dark)") ? "dark" : "light",
    pointer: media("(pointer: coarse)") ? "coarse" : "fine",
    language: nav.language,
    languages: attempt(() => [...nav.languages]),
    timeZone: attempt(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
    timeZoneOffsetMinutes: new Date().getTimezoneOffset(),
    platform: nav.userAgentData?.platform ?? nav.platform,
    mobile: nav.userAgentData?.mobile,
    touchPoints: nav.maxTouchPoints,
    online: nav.onLine,
    connection: connection
      ? {
          effectiveType: connection.effectiveType,
          downlink: connection.downlink,
          rtt: connection.rtt,
          saveData: connection.saveData,
        }
      : undefined,
    visibility: document.visibilityState,
    focused: attempt(() => document.hasFocus()),
    audio: attempt(audioState),
    performance: {
      sinceLoadMs: Math.round(performance.now()),
      timeOrigin: performance.timeOrigin,
      navigation,
    },
  };
}

/** The session store as data: its functions left out, and its clock as its offset. */
function sessionSnapshot(): Record<string, unknown> {
  const state = useSession.getState() as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (typeof value === "function" || key === "clock") continue;
    out[key] = value;
  }
  const clock = useSession.getState().clock;
  out.clock = { anchored: clock.anchored, offsetMs: clock.offsetMs };
  return out;
}

/** Every secret this browser holds, for `scrubSecrets` to search for. */
function knownSecrets(): string[] {
  const secrets: string[] = [];
  const identity = attempt(loadIdentity);
  if (identity) secrets.push(identity.secret);
  const seat = useSession.getState().credentials;
  if (seat) secrets.push(seat.token);
  for (const game of attempt(() => loadSavedGames()) ?? []) secrets.push(game.token);
  secrets.push(...recentRecords().secrets);
  return secrets;
}

export function pageFacts(phone: boolean): PageFacts {
  const clock = useSession.getState().clock;
  const records = recentRecords();
  return {
    build: BUILD_ID,
    at: Date.now(),
    serverOffsetMs: clock.anchored ? clock.offsetMs : null,
    route: {
      path: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
      state: attempt(() => window.history.state as unknown) ?? null,
    },
    device: deviceFacts(),
    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: Math.round((window.devicePixelRatio || 1) * 100) / 100,
    phone,
    userAgent: window.navigator.userAgent,
    userId: attempt(loadIdentity)?.userId ?? null,
    username: attempt(loadAccount) ?? null,
    name: attempt(loadName) ?? "",
    avatar: attempt(loadAvatar) ?? null,
    errors: recentErrors(),
    frames: records.frames,
    console: records.console,
    notices: records.notices,
    session: sessionSnapshot(),
    storage: {
      local: storageDump(attempt(() => window.localStorage)),
      session: storageDump(attempt(() => window.sessionStorage)),
    },
    secrets: knownSecrets(),
  };
}
