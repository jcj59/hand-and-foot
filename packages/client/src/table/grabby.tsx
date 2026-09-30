/**
 * Grabby Pants, as the table shows it: the holder is renamed and marked, and the
 * moment they earn the title — or someone takes it from them — is announced on
 * every screen, with a deep voice saying so.
 *
 * Who holds it is the server's call (`RoomInfo.grabbyPants`, worked out from the
 * action log), so every screen agrees and a reload keeps it. The announcement is
 * a change seen here: the holder differing from the one this page last saw.
 */
import { useEffect, useRef, useState } from "react";
import type { RoomInfo } from "@hf/shared";

/** The holder's name at the table, for the rest of the match. */
export const GRABBY_NAME = "Grabby Pants";

/** The room with the title holder renamed, for everything that shows names. */
export function withGrabbyName(room: RoomInfo): RoomInfo {
  const holder = room.grabbyPants?.seat;
  if (holder === undefined) return room;
  return {
    ...room,
    players: room.players.map((p) => (p.seat === holder ? { ...p, name: GRABBY_NAME } : p)),
  };
}

/** What to announce when the title changes hands, in the players' real names. */
export function grabbyHeadline(room: RoomInfo): string | null {
  const title = room.grabbyPants;
  if (!title) return null;
  const name = (seat: number): string =>
    room.players.find((p) => p.seat === seat)?.name ?? `Seat ${seat}`;
  return title.from === undefined
    ? `${name(title.seat)} is Grabby Pants`
    : `${name(title.seat)} takes Grabby Pants from ${name(title.from)}`;
}

/** How long the announcement stays up. */
export const GRABBY_MS = 4_000;

/** Say it, deep and slow, with whatever voice the device has. */
export function sayGrabbyPants(): void {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") return;
  const line = new SpeechSynthesisUtterance("Grabby Pants");
  line.pitch = 0.1;
  line.rate = 0.75;
  // A lower voice where the device offers one by name.
  const voices = synth.getVoices();
  const deep = voices.find((v) => /male|daniel|fred|alex|david|aaron|arthur|george/i.test(v.name));
  if (deep) line.voice = deep;
  synth.cancel();
  synth.speak(line);
}

/**
 * Announce a new holder when one appears. Returns the headline to show, or null.
 * Nothing is announced for the holder the page opened with: that is old news.
 */
export function useGrabbyAnnouncement(room: RoomInfo | undefined, muted: boolean): string | null {
  const [headline, setHeadline] = useState<string | null>(null);
  const seen = useRef<string | null | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const key = room?.grabbyPants ? `${room.grabbyPants.seat}:${room.grabbyPants.from ?? ""}` : null;

  useEffect(() => {
    if (!room) return;
    const previous = seen.current;
    seen.current = key;
    if (previous === undefined || key === null || key === previous) return;
    // The same holder going further keeps the key; only a new holder is news.
    if (previous?.split(":")[0] === key.split(":")[0]) return;
    setHeadline(grabbyHeadline(room));
    if (!muted) sayGrabbyPants();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHeadline(null), GRABBY_MS);
  }, [key, room, muted]);

  useEffect(() => () => clearTimeout(timer.current), []);
  return headline;
}

/**
 * Speech on iOS only starts inside a tap, like audio. Speak nothing on the first
 * tap so the real line is allowed later.
 */
export function useUnlockSpeech(): void {
  useEffect(() => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") return;
    const unlock = (): void => {
      synth.speak(new SpeechSynthesisUtterance(""));
      window.removeEventListener("pointerup", unlock);
      window.removeEventListener("touchend", unlock);
    };
    window.addEventListener("pointerup", unlock);
    window.addEventListener("touchend", unlock);
    return () => {
      window.removeEventListener("pointerup", unlock);
      window.removeEventListener("touchend", unlock);
    };
  }, []);
}

/** The big announcement, over the table. */
export function GrabbyAnnouncement({
  headline,
}: {
  readonly headline: string;
}): React.ReactElement {
  return (
    <div
      role="status"
      aria-label="Grabby Pants"
      className="grabby-pop pointer-events-none fixed inset-x-0 top-1/4 z-50 mx-auto flex w-fit max-w-[90vw] flex-col items-center gap-2 rounded-3xl border-2 border-amber-300 bg-felt-900/95 px-8 py-5 text-center shadow-2xl shadow-black/60"
    >
      <GrabbyIcon className="h-28 w-28" />
      <p className="text-2xl font-extrabold tracking-wide text-amber-200 sm:text-3xl">{headline}</p>
    </div>
  );
}

/**
 * A hand grabbing the seat of a pair of jeans. Drawn, because no emoji is quite
 * this.
 */
export function GrabbyIcon({ className }: { readonly className?: string }): React.ReactElement {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      {/* Jeans, from behind: waistband, seat, and the two legs. */}
      <path d="M14 10h36l3 20-6 30H37l-5-22-5 22H17l-6-30z" fill="#2f5da8" />
      <path d="M14 10h36v5H14z" fill="#244a86" />
      <path d="M32 15v21" stroke="#1b3866" strokeWidth="1.5" />
      <rect x="29" y="10" width="6" height="5" rx="1" fill="#244a86" stroke="#1b3866" />
      {/* Back pockets, with their stitching. */}
      <path
        d="M17 19h11l-1 9-4.5 2.5L18 28z"
        fill="#28518f"
        stroke="#e8b84a"
        strokeWidth="0.8"
        strokeDasharray="1.5 1"
      />
      <path
        d="M36 19h11l-1 9-4.5 2.5L37 28z"
        fill="#28518f"
        stroke="#e8b84a"
        strokeWidth="0.8"
        strokeDasharray="1.5 1"
      />
      {/* The hand, coming in from the right and grabbing a handful. */}
      <path
        d="M63 30c-4-2-9-2-13 0l-6 2c-2 1-3 3-2 5 1 1 2 1 3 1-1 1-1 3 0 4 1 1 2 1 3 0 0 2 1 3 3 3 1 0 2-1 2-2 1 1 3 1 4 0 3-2 5-4 6-7z"
        fill="#f2c29b"
        stroke="#c98d62"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path
        d="M45 38c1 0 2-1 3-1M48 42c1 0 2-1 3-1M52 44c1 0 2-1 2-1"
        stroke="#c98d62"
        strokeWidth="0.9"
        fill="none"
        strokeLinecap="round"
      />
      {/* Motion marks: a grab, not a rest. */}
      <path
        d="M8 6l3 3M4 12l4 1M56 20l3-3"
        stroke="#fcd34d"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
