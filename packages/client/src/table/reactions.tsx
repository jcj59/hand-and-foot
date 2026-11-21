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
import { Icon } from "../ui/icons";
import {
  REACTIONS,
  type Avatar,
  type ChatMessage,
  type Reaction,
  type ReactionId,
} from "@hf/shared";
import { AvatarFace } from "../profile/Avatar";

/**
 * How long a reaction stays by its sender's seat: long enough to be read by
 * someone who glanced away from the table when it arrived.
 */
export const REACTION_SHOW_MS = 5_000;
/** How long the picker rests after sending, so nobody hits the server's limit by tapping. */
export const REACTION_COOLDOWN_MS = 1_500;

const MUTE_REACTIONS_KEY = "hf.muteReactions";

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

/** What a seat's bubble says: a quick reaction, or a line of chat. */
export type SeatSaying = Reaction | ChatMessage;

/** Whether a bubble's saying is a line of chat rather than a quick reaction. */
export function isChat(saying: SeatSaying): saying is ChatMessage {
  return "text" in saying;
}

/** What is up by one seat, and when it arrived, so the latest of two kinds wins. */
interface Up<T> {
  readonly item: T;
  readonly order: number;
}

/**
 * Each seat's latest arrival from `items` (numbered by `seq`, newest last) that
 * `include` lets through, kept up for `REACTION_SHOW_MS`. What is already there
 * when the table opens is old news and is not shown. Calls `onArrive` for each new
 * one, for its sound; `order` comes from the shared counter, so arrivals of two
 * kinds can be told apart in time.
 */
function useBubbles<T extends { readonly seq: number; readonly seat: number }>(
  items: readonly T[],
  include: (item: T) => boolean,
  onArrive: (item: T) => void,
  counter: { current: number },
): ReadonlyMap<number, Up<T>> {
  const [shown, setShown] = useState<ReadonlyMap<number, Up<T>>>(new Map());
  const seen = useRef<number | null>(null);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const arrive = useRef(onArrive);
  arrive.current = onArrive;
  const allow = useRef(include);
  allow.current = include;

  useEffect(() => {
    const latest = items.at(-1)?.seq ?? 0;
    const previous = seen.current;
    seen.current = Math.max(previous ?? 0, latest);
    if (previous === null) return;
    const fresh = items.filter((r) => r.seq > previous && allow.current(r));
    if (fresh.length === 0) return;
    const ups = fresh.map((item) => ({ item, order: ++counter.current }));
    setShown((current) => {
      const next = new Map(current);
      for (const up of ups) next.set(up.item.seat, up);
      return next;
    });
    for (const up of ups) {
      const seat = up.item.seat;
      arrive.current(up.item);
      clearTimeout(timers.current.get(seat));
      timers.current.set(
        seat,
        setTimeout(() => {
          setShown((current) => {
            if (current.get(seat) !== up) return current;
            const next = new Map(current);
            next.delete(seat);
            return next;
          });
        }, REACTION_SHOW_MS),
      );
    }
    // `include` is read through its ref: it changes with what it closes over
    // (a mute switched), which must not replay anything.
  }, [items, counter]);

  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const t of all.values()) clearTimeout(t);
    };
  }, []);

  return shown;
}

/**
 * What to show by each seat now: the latest reaction or line of chat from that
 * seat, until it has been up for `REACTION_SHOW_MS`, whichever came last. What was
 * heard before the table opened is not replayed, and nor is chat that came as the
 * table's history (`chatOldThrough`). Your own reactions show by your hand, your
 * own chat does not (it is in the chat, where you just typed it). Another player's
 * reactions are left out when `muteReactions`, their chat when `muteChat`; each
 * new one shown calls its arrival callback, for its sound.
 */
export function useSeatBubbles({
  reactions,
  chat,
  chatOldThrough,
  mySeat,
  muteReactions,
  muteChat,
  onReaction,
  onChat,
}: {
  readonly reactions: readonly Reaction[];
  readonly chat: readonly ChatMessage[];
  readonly chatOldThrough: number;
  readonly mySeat: number;
  readonly muteReactions: boolean;
  readonly muteChat: boolean;
  readonly onReaction: (reaction: Reaction) => void;
  readonly onChat: (message: ChatMessage) => void;
}): ReadonlyMap<number, SeatSaying> {
  const counter = useRef(0);
  const shownReactions = useBubbles(
    reactions,
    (r) => r.seat === mySeat || !muteReactions,
    onReaction,
    counter,
  );
  const shownChat = useBubbles(
    chat,
    (m) => m.seat !== mySeat && !muteChat && m.seq > chatOldThrough,
    onChat,
    counter,
  );
  const merged = new Map<number, SeatSaying>();
  const seats = new Set([...shownReactions.keys(), ...shownChat.keys()]);
  for (const seat of seats) {
    const reaction = shownReactions.get(seat);
    const said = shownChat.get(seat);
    const latest = !said || (reaction && reaction.order > said.order) ? reaction : said;
    if (latest) merged.set(seat, latest.item);
  }
  return merged;
}

/**
 * One saying in a speech bubble: a reaction's emoji drawn large or its phrase as
 * text, or a line of chat, on one line like a phrase and cut short with an
 * ellipsis when it would not fit the seat (the chat has it whole). One line keeps
 * it inside the seat's box, which clips anything above it.
 */
export function ReactionBubble({
  reaction,
  name,
  avatar,
  inset = false,
}: {
  readonly reaction: SeatSaying;
  readonly name: string;
  /** The sender's face, drawn small at the start of the bubble so it reads as theirs. */
  readonly avatar?: Avatar;
  /**
   * Inside the top of its box rather than over its top edge: a computer's seat
   * boxes sit at the top of a part of the felt that scrolls, which would cut off
   * anything above them.
   */
  readonly inset?: boolean;
}): React.ReactElement | null {
  const said = isChat(reaction) ? reaction.text : null;
  const def = said === null ? REACTIONS.find((r) => r.id === (reaction as Reaction).id) : null;
  // One this page does not know (sent by a newer server) shows nothing.
  if (said === null && !def) return null;
  // The phrases are their own label; an emoji is not.
  const emoji = def ? def.text !== def.label : false;
  return (
    <span
      role="status"
      aria-label={`${name}: ${said ?? def!.label}`}
      data-chat={said === null ? undefined : ""}
      // The fade lasts as long as the bubble is shown; see `.reaction-pop`.
      style={{ "--reaction-ms": `${REACTION_SHOW_MS}ms` } as CSSProperties}
      className={`reaction-pop pointer-events-none absolute ${inset ? "top-1.5 right-1.5" : "-top-3.5 right-1"} z-10 inline-flex items-center gap-1 rounded-[12px_12px_12px_3px] bg-card font-semibold text-suit-black shadow-[0_4px_10px_rgba(0,0,0,0.35)] ${
        said !== null
          ? "max-w-[min(15rem,calc(100%-0.5rem))] py-1 pr-2 pl-1 text-xs whitespace-nowrap"
          : emoji
            ? "py-0.5 pr-1.5 pl-1 text-xl leading-none whitespace-nowrap"
            : "py-1 pr-2 pl-1 text-xs whitespace-nowrap"
      }`}
    >
      {avatar && <AvatarFace avatar={avatar} size={emoji ? 22 : 18} />}
      {said !== null ? (
        // Text, never markup: React escapes it, and nothing in it becomes a link.
        <span className="min-w-0 truncate">{said}</span>
      ) : (
        def!.text
      )}
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

  const muteBox = (
    <label className="flex items-center gap-2 text-xs text-muted">
      <input
        type="checkbox"
        checked={muted}
        onChange={(event) => onMutedChange(event.target.checked)}
        className="size-4 accent-accent"
      />
      Mute other players' reactions
    </label>
  );

  const panel = (
    <div
      role="group"
      aria-label="Reactions"
      onClick={(event) => event.stopPropagation()}
      className={
        sheet
          ? "flex max-h-[70dvh] w-full flex-col gap-3 overflow-y-auto rounded-t-3xl border-t border-white/8 bg-surface px-4 pt-3.5 pb-[calc(1.6rem+env(safe-area-inset-bottom,0px))]"
          : `absolute top-full ${alignRight ? "right-0" : "left-0"} z-40 mt-2 flex w-[340px] flex-col gap-2.5 rounded-2xl border border-white/12 bg-raised p-3 shadow-[0_20px_50px_rgba(0,0,0,0.6)]`
      }
    >
      {sheet && (
        <div className="flex items-center justify-between gap-3">
          <p className="m-0 font-display text-base font-semibold">React</p>
          {muteBox}
        </div>
      )}
      <div className={`grid grid-cols-6 ${sheet ? "gap-1.5" : "gap-1"}`}>
        {REACTIONS.filter((r) => r.text !== r.label).map((r) => (
          <button
            key={r.id}
            type="button"
            aria-label={r.label}
            onClick={() => send(r.id)}
            className={`rounded-xl hover:bg-white/10 ${
              sheet ? "min-h-12 bg-raised text-2xl" : "min-h-11 bg-surface text-[22px]"
            }`}
          >
            {r.text}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {REACTIONS.filter((r) => r.text === r.label).map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => send(r.id)}
            className={`rounded-full border border-white/12 font-semibold hover:bg-white/10 ${
              sheet ? "min-h-10 px-3.5 text-[13px]" : "min-h-[34px] px-3 text-xs"
            }`}
          >
            {r.text}
          </button>
        ))}
      </div>
      {!sheet && muteBox}
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
        className={`${ICON_BUTTON} disabled:opacity-40`}
      >
        <Icon name="smile" size={18} />
      </button>
      {open &&
        (sheet
          ? createPortal(
              <div
                className="fixed inset-0 z-40 flex items-end bg-[rgba(6,10,12,0.45)] text-ink"
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

/** The menu's width, to decide which way it opens. */
const MENU_WIDTH_PX = 340;

/** The table header's square icon buttons, as the design draws them. */
export const ICON_BUTTON =
  "flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-surface text-ink hover:bg-raised md:size-[42px]";
