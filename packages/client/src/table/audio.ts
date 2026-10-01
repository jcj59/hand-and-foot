/**
 * The page's one `AudioContext`, kept able to make a sound.
 *
 * Browsers only let a page start audio once the player has interacted with it,
 * and take it away again when they please: a tab sent to the background, a laptop
 * asleep, a phone locked or rung, an output device switched. A context left
 * suspended keeps accepting sounds and plays none of them. So the context here:
 *
 * - is made as soon as the browser allows — at once if the player has already
 *   used the page (the lobby's clicks count), else on their first gesture;
 * - belongs to the page, not to a table, so leaving one table for the next does
 *   not throw it away and start waiting for a tap again;
 * - is resumed whenever it might be allowed to run again: any gesture, the tab
 *   coming back, the window regaining focus, the context reporting a new state;
 * - is replaced when it is closed, or a gesture could not bring it back.
 *
 * A sound asked for while the context is not running waits for it to resume, but
 * only briefly: a burst of a whole turn's sounds on coming back would be worse
 * than missing them.
 */
import { useSyncExternalStore } from "react";

type AudioContextCtor = new () => AudioContext;

/**
 * Events that count as the player interacting. A touch only counts when it ends,
 * so both ends of a press are listened for. Listened to in the capture phase, so
 * a control that stops its click from bubbling still counts.
 */
const GESTURES = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;

/** How long a sound may wait for the context to resume and still be worth playing. */
export const LATE_MS = 300;

/** How long a gesture's resume may take before the context is given up as stuck. */
export const STUCK_MS = 1_000;

interface State {
  ctx: AudioContext | null;
  /** A gesture's resume did not bring the context back: replace it on the next. */
  stuck: boolean;
  installed: boolean;
  readonly onCreate: Set<(ctx: AudioContext) => void>;
  readonly onChange: Set<() => void>;
  readonly teardown: (() => void)[];
}

const state: State = {
  ctx: null,
  stuck: false,
  installed: false,
  onCreate: new Set(),
  onChange: new Set(),
  teardown: [],
};

function ctor(): AudioContextCtor | null {
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function changed(): void {
  for (const listener of state.onChange) listener();
}

/** Whether the page has had a gesture, so the browser will let audio start. */
function activated(): boolean {
  return (
    (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation
      ?.hasBeenActive ?? false
  );
}

function create(Ctor: AudioContextCtor): AudioContext {
  const ctx = new Ctor();
  state.ctx = ctx;
  state.stuck = false;
  // iOS also wants a sound started inside the gesture before it will play any.
  const silence = ctx.createBufferSource();
  silence.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  silence.connect(ctx.destination);
  silence.start(0);
  ctx.addEventListener?.("statechange", () => {
    if (state.ctx !== ctx) return;
    changed();
    // Safari's "interrupted" (a call, the screen locking) ends on its own terms;
    // when it does the context drops to suspended, and can be asked to run.
    if (ctx.state === "suspended" && document.visibilityState === "visible") resume(ctx);
  });
  for (const callback of state.onCreate) callback(ctx);
  changed();
  return ctx;
}

function resume(ctx: AudioContext): Promise<void> {
  if (ctx.state === "running") return Promise.resolve();
  // `statechange` reports the outcome too, but not every browser has sent it
  // reliably; asking again costs nothing.
  return ctx
    .resume()
    .catch(() => {})
    .then(changed);
}

/**
 * Get the context running if the browser will allow it. `gesture` says the call is
 * inside one, which is when a context may be made, and a stuck one replaced.
 */
export function wake(gesture: boolean): void {
  const Ctor = ctor();
  if (!Ctor) return;
  const old = state.ctx;
  if (old && (old.state === "closed" || (gesture && state.stuck))) {
    old.close().catch(() => {});
    state.ctx = null;
  }
  if (!state.ctx) {
    if (!gesture && !activated()) return;
    create(Ctor);
  }
  const ctx = state.ctx!;
  if (ctx.state === "running") return;
  void resume(ctx);
  if (gesture) {
    setTimeout(() => {
      if (state.ctx === ctx && ctx.state !== "running") state.stuck = true;
    }, STUCK_MS);
  }
}

/**
 * Listen for every chance to start or restart audio. Safe to call more than once;
 * the listeners stay for the life of the page.
 */
export function installAudio(): void {
  if (state.installed || typeof window === "undefined") return;
  state.installed = true;
  const onGesture = (): void => wake(true);
  const onReturn = (): void => {
    if (document.visibilityState === "visible") wake(false);
  };
  for (const event of GESTURES) window.addEventListener(event, onGesture, true);
  document.addEventListener("visibilitychange", onReturn);
  window.addEventListener("pageshow", onReturn);
  window.addEventListener("focus", onReturn);
  state.teardown.push(() => {
    for (const event of GESTURES) window.removeEventListener(event, onGesture, true);
    document.removeEventListener("visibilitychange", onReturn);
    window.removeEventListener("pageshow", onReturn);
    window.removeEventListener("focus", onReturn);
  });
  wake(false);
}

/** Call `callback` with each context as it is made, and with the current one now. */
export function onAudioContext(callback: (ctx: AudioContext) => void): () => void {
  state.onCreate.add(callback);
  if (state.ctx && state.ctx.state !== "closed") callback(state.ctx);
  return () => state.onCreate.delete(callback);
}

/**
 * Make a sound with the context when it is running: now if it is, else as soon as
 * it resumes — unless that takes longer than `LATE_MS`, when the moment has passed.
 */
export function withAudio(use: (ctx: AudioContext) => void): void {
  wake(false);
  const ctx = state.ctx;
  if (!ctx || ctx.state === "closed") return;
  if (ctx.state === "running") return use(ctx);
  const asked = performance.now();
  void resume(ctx).then(() => {
    if (state.ctx === ctx && ctx.state === "running" && performance.now() - asked <= LATE_MS) {
      use(ctx);
    }
  });
}

function subscribe(listener: () => void): () => void {
  state.onChange.add(listener);
  return () => state.onChange.delete(listener);
}

/**
 * Whether the page could make sound but the browser is not letting it: before the
 * first tap, or after audio was taken away. False where there is no Web Audio.
 */
export function useAudioBlocked(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => ctor() !== null && state.ctx?.state !== "running",
    () => false,
  );
}

/** Forget the context and every listener: for tests, which each want a fresh page. */
export function resetAudioForTests(): void {
  for (const undo of state.teardown.splice(0)) undo();
  state.ctx = null;
  state.stuck = false;
  state.installed = false;
  state.onCreate.clear();
  state.onChange.clear();
}
