/**
 * Quick reactions at the table: a fixed set of emoji and short phrases any seated
 * player can send, shown for a moment by the sender's seat on every screen.
 *
 * They are ephemeral by design — relayed by the server, never logged, never part
 * of the game — so this keeps them only as long as they are on screen. The server
 * limits how often a seat may send; the picker's own cooldown keeps anyone from
 * running into that limit by accident. Each device can mute other players'
 * reactions, which hides them and silences their sound.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { REACTIONS, type Reaction, type ReactionId } from "@hf/shared";

/**
 * How long a reaction stays by its sender's seat: long enough to be read by
 * someone who glanced away from the table when it arrived.
 */
export const REACTION_SHOW_MS = 5_000;
/** How long the picker rests after sending, so nobody hits the server's limit by tapping. */
export const REACTION_COOLDOWN_MS = 1_500;

const MUTE_REACTIONS_KEY = "hf.muteReactions";

export function reactionText(id: ReactionId): string {
  return REACTIONS.find((r) => r.id === id)?.text ?? "";
}

export function readMuteReactions(): boolean {
  try {
    return window.localStorage.getItem(MUTE_REACTIONS_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeMuteReactions(on: boolean): void {
  try {
    window.localStorage.setItem(MUTE_REACTIONS_KEY, on ? "1" : "0");
  } catch {
    // Blocked storage: the choice lasts until the page is reloaded.
  }
}

/**
 * The reaction to show by each seat now: the latest from that seat, until it has
 * been up for `REACTION_SHOW_MS`. Reactions already in the store when the table
 * opened are old news and are not shown. Calls `onArrive` for each new one, for
 * its sound. Another player's are left out when `muted`; your own always show.
 */
export function useReactionBubbles(
  reactions: readonly Reaction[],
  mySeat: number,
  muted: boolean,
  onArrive: (reaction: Reaction) => void,
): ReadonlyMap<number, Reaction> {
  const [shown, setShown] = useState<ReadonlyMap<number, Reaction>>(new Map());
  const seen = useRef<number | null>(null);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const arrive = useRef(onArrive);
  arrive.current = onArrive;

  useEffect(() => {
    const latest = reactions.at(-1)?.seq ?? 0;
    const previous = seen.current;
    seen.current = Math.max(previous ?? 0, latest);
    if (previous === null) return;
    const fresh = reactions.filter((r) => r.seq > previous && (r.seat === mySeat || !muted));
    if (fresh.length === 0) return;
    setShown((current) => {
      const next = new Map(current);
      for (const r of fresh) next.set(r.seat, r);
      return next;
    });
    for (const r of fresh) {
      arrive.current(r);
      clearTimeout(timers.current.get(r.seat));
      timers.current.set(
        r.seat,
        setTimeout(() => {
          setShown((current) => {
            if (current.get(r.seat)?.seq !== r.seq) return current;
            const next = new Map(current);
            next.delete(r.seat);
            return next;
          });
        }, REACTION_SHOW_MS),
      );
    }
  }, [reactions, mySeat, muted]);

  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const t of all.values()) clearTimeout(t);
    };
  }, []);

  return shown;
}

/** One reaction in a speech bubble. An emoji is drawn large, a phrase as text. */
export function ReactionBubble({
  reaction,
  name,
}: {
  readonly reaction: Reaction;
  readonly name: string;
}): React.ReactElement {
  const def = REACTIONS.find((r) => r.id === reaction.id)!;
  // The phrases are their own label; an emoji is not.
  const emoji = def.text !== def.label;
  return (
    <span
      role="status"
      aria-label={`${name}: ${def.label}`}
      // The fade lasts as long as the bubble is shown; see `.reaction-pop`.
      style={{ "--reaction-ms": `${REACTION_SHOW_MS}ms` } as CSSProperties}
      className={`reaction-pop pointer-events-none absolute top-1 right-1 z-10 rounded-2xl rounded-br-sm bg-white font-semibold whitespace-nowrap text-felt-900 shadow-lg shadow-black/40 ${
        emoji ? "px-1.5 py-0.5 text-2xl leading-none" : "px-2 py-1 text-sm"
      }`}
    >
      {def.text}
    </span>
  );
}

export interface ReactionPickerProps {
  readonly onSend: (id: ReactionId) => void;
  readonly muted: boolean;
  readonly onMutedChange: (muted: boolean) => void;
  /** A bottom sheet on a phone, a menu under the button otherwise. */
  readonly sheet: boolean;
}

/**
 * The button and what it opens: every reaction, and the switch to mute other
 * players'. After sending it rests for a moment.
 */
export function ReactionPicker({
  onSend,
  muted,
  onMutedChange,
  sheet,
}: ReactionPickerProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  // Which way the menu opens: towards whichever side of the button has room.
  const [alignRight, setAlignRight] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const [resting, setResting] = useState(false);
  const rest = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(rest.current), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const send = (id: ReactionId): void => {
    onSend(id);
    setOpen(false);
    setResting(true);
    clearTimeout(rest.current);
    rest.current = setTimeout(() => setResting(false), REACTION_COOLDOWN_MS);
  };

  const panel = (
    <div
      role="group"
      aria-label="Reactions"
      onClick={(event) => event.stopPropagation()}
      className={
        sheet
          ? "flex max-h-[70dvh] w-full flex-col gap-2 overflow-y-auto rounded-t-xl border-t border-white/15 bg-felt-900 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]"
          : `absolute top-full ${alignRight ? "right-0" : "left-0"} z-40 mt-1 flex w-72 flex-col gap-2 rounded-lg border border-white/20 bg-felt-900 p-2 shadow-xl`
      }
    >
      <div className="grid grid-cols-6 gap-1">
        {REACTIONS.filter((r) => r.text !== r.label).map((r) => (
          <button
            key={r.id}
            type="button"
            aria-label={r.label}
            onClick={() => send(r.id)}
            className="rounded py-1 text-2xl hover:bg-white/10"
          >
            {r.text}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {REACTIONS.filter((r) => r.text === r.label).map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => send(r.id)}
            className="rounded-full border border-white/25 px-3 py-1 text-sm hover:bg-white/10"
          >
            {r.text}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 border-t border-white/10 pt-2 text-sm text-white/75">
        <input
          type="checkbox"
          checked={muted}
          onChange={(event) => onMutedChange(event.target.checked)}
        />
        Mute other players' reactions
      </label>
    </div>
  );

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="React"
        aria-expanded={open}
        disabled={resting}
        ref={button}
        onClick={() => {
          const left = button.current?.getBoundingClientRect().left ?? 0;
          setAlignRight(left + MENU_WIDTH_PX > window.innerWidth);
          setOpen(!open);
        }}
        className="rounded border border-white/25 px-2 py-1 text-sm disabled:opacity-40"
      >
        <SmileIcon />
      </button>
      {open &&
        (sheet
          ? createPortal(
              <div
                className="fixed inset-0 z-40 flex items-end bg-black/30 text-white"
                onClick={() => setOpen(false)}
              >
                {panel}
              </div>,
              document.body,
            )
          : panel)}
    </div>
  );
}

/** The menu's width (Tailwind's w-72), to decide which way it opens. */
const MENU_WIDTH_PX = 288;

/** A smiling face, drawn: the button is the same on every device. */
function SmileIcon(): React.ReactElement {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 fill-none stroke-current">
      <circle cx="8" cy="8" r="6.5" strokeWidth="1.5" />
      <circle cx="5.75" cy="6.5" r="0.9" className="fill-current" strokeWidth="0" />
      <circle cx="10.25" cy="6.5" r="0.9" className="fill-current" strokeWidth="0" />
      <path d="M5 9.5a3.5 3.5 0 0 0 6 0" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
