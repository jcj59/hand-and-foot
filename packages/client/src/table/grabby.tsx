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
import { faceOf } from "../profile/avatarStore";
import { Celebration } from "./Celebration";

/** The holder's name at the table, while they hold the title: until someone else takes it, or the round ends. */
export const GRABBY_NAME = "Grabby Pants";

/** The room with the title holder renamed, for everything that shows names. */
export function withGrabbyName(room: RoomInfo): RoomInfo {
  const holder = room.grabbyPants?.seat;
  if (holder === undefined) return room;
  return {
    ...room,
    // Renamed but not re-faced: a face drawn from the name keeps the real name's.
    players: room.players.map((p) =>
      p.seat === holder ? { ...p, name: GRABBY_NAME, avatar: faceOf(p) } : p,
    ),
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

/** How long to wait for the device's voices to load before using its default. */
export const VOICES_WAIT_MS = 1_000;

/**
 * A lower voice where the device offers one by name. "Female" contains "male", so
 * it is ruled out first and "male" only counts as a word of its own.
 */
export function pickDeepVoice(
  voices: readonly SpeechSynthesisVoice[],
): SpeechSynthesisVoice | undefined {
  return voices.find(
    (v) =>
      !/female/i.test(v.name) &&
      /\bmale\b|daniel|fred|alex|david|aaron|arthur|george/i.test(v.name),
  );
}

/**
 * Say a line deep and slow, with whatever voice the device has, then call `after`
 * — once, whether the line finished, could not be said, or the device never says
 * when it is done. Chrome lists no voices until `voiceschanged` fires, so an empty
 * list waits for that once before settling for the default voice.
 */
export function sayDeep(text: string, after?: () => void): void {
  let finished = false;
  const done = (): void => {
    if (finished) return;
    finished = true;
    after?.();
  };
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
    done();
    return;
  }
  const speak = (): void => {
    const line = new SpeechSynthesisUtterance(text);
    line.pitch = 0.1;
    line.rate = 0.75;
    const deep = pickDeepVoice(synth.getVoices());
    if (deep) line.voice = deep;
    line.onend = done;
    line.onerror = done;
    synth.cancel();
    synth.speak(line);
    // Some browsers never report the end of a line; don't let that swallow `after`.
    setTimeout(done, SPEECH_GIVE_UP_MS);
  };
  if (synth.getVoices().length > 0 || typeof synth.addEventListener !== "function") {
    speak();
    return;
  }
  let started = false;
  const once = (): void => {
    if (started) return;
    started = true;
    clearTimeout(fallback);
    synth.removeEventListener("voiceschanged", once);
    speak();
  };
  const fallback = setTimeout(once, VOICES_WAIT_MS);
  synth.addEventListener("voiceschanged", once);
}

/** How long a spoken line may take before whatever follows it goes ahead anyway. */
export const SPEECH_GIVE_UP_MS = 3_000;

export function sayGrabbyPants(): void {
  sayDeep("Grabby Pants");
}

/**
 * Announce a new holder when one appears. Returns the headline to show, or null.
 * Nothing is announced for the holder the page opened with: that is old news —
 * nor for one reached `quiet`ly, as a replay seeking past the moment does.
 */
export function useGrabbyAnnouncement(
  room: RoomInfo | undefined,
  muted: boolean,
  quiet = false,
): string | null {
  const [headline, setHeadline] = useState<string | null>(null);
  const seen = useRef<string | null | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const key = room?.grabbyPants ? `${room.grabbyPants.seat}:${room.grabbyPants.from ?? ""}` : null;

  useEffect(() => {
    if (!room) return;
    const previous = seen.current;
    seen.current = key;
    if (previous === undefined || key === null || key === previous || quiet) return;
    // The same holder going further keeps the key; only a new holder is news.
    if (previous?.split(":")[0] === key.split(":")[0]) return;
    setHeadline(grabbyHeadline(room));
    if (!muted) sayGrabbyPants();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHeadline(null), GRABBY_MS);
  }, [key, room, muted, quiet]);

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
    <Celebration label="Grabby Pants" ms={GRABBY_MS}>
      <GrabbyIcon className="h-28 w-28" />
      <p className="text-2xl font-extrabold tracking-wide text-amber-200 sm:text-3xl">{headline}</p>
    </Celebration>
  );
}

/**
 * A hand grabbing the seat of a pair of jeans. Drawn, because no emoji is quite
 * this.
 */
export function GrabbyIcon({ className }: { readonly className?: string }): React.ReactElement {
  // The hand is drawn twice — outlines under, fills over — so the fingers and the
  // palm read as one silhouette with no seams where they join.
  const hand = (
    <>
      {/* Forearm, coming in from the lower right. */}
      <path d="M45 34l5-5 14 9v10z" />
      {/* Palm. */}
      <ellipse cx="44" cy="30" rx="7.5" ry="8" />
      {/* Five fingers, spread open: thumb, index, middle, ring and little finger. */}
      <rect
        x="-2.2"
        y="-8"
        width="4.4"
        height="10"
        rx="2.2"
        transform="translate(37.5 32) rotate(-68)"
      />
      <rect
        x="-2.2"
        y="-10"
        width="4.4"
        height="12"
        rx="2.2"
        transform="translate(39.5 25) rotate(-24)"
      />
      <rect
        x="-2.2"
        y="-11"
        width="4.4"
        height="13"
        rx="2.2"
        transform="translate(43.5 23.5) rotate(-4)"
      />
      <rect
        x="-2.2"
        y="-10"
        width="4.4"
        height="12"
        rx="2.2"
        transform="translate(47.5 24) rotate(14)"
      />
      <rect
        x="-2"
        y="-8"
        width="4"
        height="10"
        rx="2"
        transform="translate(50.5 26.5) rotate(34)"
      />
    </>
  );
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      {/* Straight-leg jeans, from behind: waistband, seat, and two legs that go
          straight down. */}
      <path d="M13 8h38v52H33.5V36h-3v24H13z" fill="#2f5da8" />
      <path d="M13 8h38v5H13z" fill="#244a86" />
      <path d="M32 13v23" stroke="#1b3866" strokeWidth="1.5" />
      <rect x="29" y="8" width="6" height="5" rx="1" fill="#244a86" stroke="#1b3866" />
      {/* Back pockets, with their stitching. */}
      <path
        d="M16 17h12v10l-6 3-6-3z"
        fill="#28518f"
        stroke="#e8b84a"
        strokeWidth="0.8"
        strokeDasharray="1.5 1"
      />
      <path
        d="M36 17h12v10l-6 3-6-3z"
        fill="#28518f"
        stroke="#e8b84a"
        strokeWidth="0.8"
        strokeDasharray="1.5 1"
      />
      {/* An open hand, all five fingers spread, planted on the seat. */}
      <g
        fill="#c98d62"
        stroke="#c98d62"
        strokeWidth="2.4"
        strokeLinejoin="round"
        transform="translate(0 7)"
      >
        {hand}
      </g>
      <g fill="#f2c29b" transform="translate(0 7)">
        {hand}
      </g>
      {/* Motion marks: a grab, not a rest. */}
      <path
        d="M7 5l3 3M3 12l4 1M57 12l3-3M60 18l3-1"
        stroke="#fcd34d"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
