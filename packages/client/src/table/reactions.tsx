/**
 * Quick reactions at the table: a fixed set of emotes and short phrases any seated
 * player can send, shown for a moment by the sender's seat on every screen. An
 * emote is the sender's own face, drawn large with an expression and a sound
 * (`emotes.ts`, `EmoteFace.tsx`); a phrase is a speech bubble.
 *
 * They are ephemeral by design — relayed by the server, never logged, never part
 * of the game — so this keeps them only as long as they are on screen. The server
 * limits how often a seat may send; the picker's own cooldown keeps anyone from
 * running into that limit by accident. Each device can mute other players'
 * reactions, which hides them and silences their sound.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../ui/icons";
import {
  PICKER_EMOTES,
  PICKER_PHRASES,
  REACTIONS,
  defaultAvatar,
  type Avatar,
  type ChatMessage,
  type Reaction,
  type ReactionId,
} from "@hf/shared";
import { AvatarFace } from "../profile/Avatar";
import { EmoteFace } from "./EmoteFace";
import { isEmote, type EmoteId } from "./emotes";

/**
 * How long a reaction stays by its sender's seat: long enough to be read by
 * someone who glanced away from the table when it arrived.
 */
export const REACTION_SHOW_MS = 5_000;
/**
 * How long an emote stays up: a big face over the seat is read at a glance, and
 * covers what is under it, so it goes sooner than a phrase. Long enough for its
 * sound (at most `EMOTE_SOUND_MS`) to finish.
 */
export const EMOTE_SHOW_MS = 3_000;

/** How long one reaction stays up: an emote less than a phrase. */
export function shownFor(id: string): number {
  return isEmote(id) ? EMOTE_SHOW_MS : REACTION_SHOW_MS;
}
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

/** A bubble's identity, so a new saying from a seat remounts it and replays its animation. */
export function sayingKey(saying: SeatSaying): string {
  return `${isChat(saying) ? "chat" : "reaction"}-${saying.seq}`;
}

/** What is up by one seat, and when it arrived, so the latest of two kinds wins. */
interface Up<T> {
  readonly item: T;
  readonly order: number;
}

/**
 * Each seat's latest arrival from `items` (numbered by `seq`, newest last) that
 * `include` lets through, kept up for as long as `lasts` says. What is already there
 * when the table opens is old news and is not shown. Calls `onArrive` for each new
 * one, for its sound; `order` comes from the shared counter, so arrivals of two
 * kinds can be told apart in time.
 */
function useBubbles<T extends { readonly seq: number; readonly seat: number }>(
  items: readonly T[],
  include: (item: T) => boolean,
  onArrive: (item: T) => void,
  counter: { current: number },
  lasts: (item: T) => number,
): ReadonlyMap<number, Up<T>> {
  const [shown, setShown] = useState<ReadonlyMap<number, Up<T>>>(new Map());
  const seen = useRef<number | null>(null);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const arrive = useRef(onArrive);
  arrive.current = onArrive;
  const allow = useRef(include);
  allow.current = include;
  const length = useRef(lasts);
  length.current = lasts;

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
        }, length.current(up.item)),
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
 * seat, until it has been up for its time (`shownFor`), whichever came last. What was
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
    (r) => shownFor(r.id),
  );
  const shownChat = useBubbles(
    chat,
    (m) => m.seat !== mySeat && !muteChat && m.seq > chatOldThrough,
    onChat,
    counter,
    () => REACTION_SHOW_MS,
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
 * Where a seat's bubble is: a computer's seat box (`box`), a phone's chip in the
 * strip of players (`chip`), or the player's own hand (`hand`).
 */
export type BubbleAt = "box" | "chip" | "hand";

/**
 * One saying by a seat: an emote drawn large as the sender's face, or a speech
 * bubble with a phrase, an old page's emoji, or a line of chat (one line, cut
 * short with an ellipsis when it would not fit the seat; the chat has it whole).
 */
export function ReactionBubble({
  reaction,
  name,
  avatar,
  at = "hand",
}: {
  readonly reaction: SeatSaying;
  readonly name: string;
  /** The sender's face: drawn small in a bubble, and is the emote itself. */
  readonly avatar?: Avatar;
  readonly at?: BubbleAt;
}): React.ReactElement | null {
  const said = isChat(reaction) ? reaction.text : null;
  const def = said === null ? REACTIONS.find((r) => r.id === (reaction as Reaction).id) : null;
  // One this page does not know (sent by a newer server) shows nothing.
  if (said === null && !def) return null;
  if (def && isEmote(def.id)) {
    return (
      <EmoteBubble
        id={def.id}
        label={def.label}
        name={name}
        avatar={avatar ?? defaultAvatar(name)}
        at={at}
      />
    );
  }
  // The phrases are their own label; an emoji (an old page's emote) is not.
  const emoji = def ? def.text !== def.label : false;
  // Inside the top of a computer's seat box rather than over its top edge: the
  // boxes sit at the top of a part of the felt that scrolls, which would cut off
  // anything above them.
  const inset = at === "box";
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

/**
 * Where the emote's point sits in the seat (a marker span placed there), and how
 * the face hangs from it: over the right of a seat box, below a phone chip, above
 * the right of the hand.
 */
const EMOTE_MARK: Record<BubbleAt, string> = {
  box: "top-1 right-1",
  chip: "bottom-0 left-1/2",
  hand: "top-0 right-4",
};
const EMOTE_HANG: Record<BubbleAt, string> = {
  box: "-translate-x-full",
  chip: "-translate-x-1/2",
  hand: "-translate-x-full -translate-y-full",
};

/**
 * An emote by its sender's seat. Too big for the seat (a phone's chip is 46px
 * tall, and the seat lists and the hand scroll, clipping anything over their
 * edge), so the face is drawn in a layer over the whole page, following a marker
 * span in the seat. The marker carries the status, so it is found with its seat.
 * While the seat is scrolled out of its list the face hides with it.
 */
function EmoteBubble({
  id,
  label,
  name,
  avatar,
  at,
}: {
  readonly id: EmoteId;
  readonly label: string;
  readonly name: string;
  readonly avatar: Avatar;
  readonly at: BubbleAt;
}): React.ReactElement {
  const mark = useRef<HTMLSpanElement>(null);
  const face = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const marker = mark.current;
    const layer = face.current;
    if (!marker || !layer) return;
    const clips: Element[] = [];
    for (let el = marker.parentElement; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.overflowX !== "visible" || style.overflowY !== "visible") clips.push(el);
    }
    let frame = 0;
    const place = (): void => {
      const r = marker.getBoundingClientRect();
      const seen = clips.every((el) => {
        const c = el.getBoundingClientRect();
        return (
          r.left >= c.left - 1 &&
          r.left <= c.right + 1 &&
          r.top >= c.top - 1 &&
          r.top <= c.bottom + 1
        );
      });
      layer.style.left = `${r.left}px`;
      layer.style.top = `${r.top}px`;
      layer.style.visibility = seen ? "" : "hidden";
      frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <>
      <span
        ref={mark}
        role="status"
        aria-label={`${name}: ${label}`}
        data-emote={id}
        className={`pointer-events-none absolute size-0 ${EMOTE_MARK[at]}`}
      />
      {createPortal(
        <div ref={face} aria-hidden className="pointer-events-none fixed top-0 left-0 z-30">
          <div className={EMOTE_HANG[at]}>
            <div
              // The fade lasts as long as the emote is shown; see `.emote-pop`.
              style={{ "--emote-ms": `${EMOTE_SHOW_MS}ms` } as CSSProperties}
              className={`emote-pop ${at === "chip" ? "size-[88px]" : "size-[88px] md:size-[120px]"} drop-shadow-[0_6px_10px_rgba(0,0,0,0.45)]`}
            >
              <EmoteFace avatar={avatar} id={id} className="size-full" />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

export interface ReactionPickerProps {
  readonly onSend: (id: ReactionId) => void;
  /** The player's own face, which every emote in the picker is drawn on. */
  readonly avatar: Avatar;
  readonly muted: boolean;
  readonly onMutedChange: (muted: boolean) => void;
  /** A bottom sheet on a phone, a menu under the button otherwise. */
  readonly sheet: boolean;
}

/**
 * The button and what it opens: the eight emotes in a grid, drawn on the
 * player's own face, the phrases beside them, and the switch to mute other
 * players'. After sending it rests for a moment.
 */
export function ReactionPicker({
  onSend,
  avatar,
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
          : `absolute top-full ${alignRight ? "right-0" : "left-0"} z-40 mt-2 flex w-[400px] flex-col gap-2.5 rounded-2xl border border-white/12 bg-raised p-3 shadow-[0_20px_50px_rgba(0,0,0,0.6)]`
      }
    >
      {sheet && (
        <div className="flex items-center justify-between gap-3">
          <p className="m-0 font-display text-base font-semibold">React</p>
          {muteBox}
        </div>
      )}
      <div className="flex items-start gap-3">
        <div role="group" aria-label="Emotes" className="grid shrink-0 grid-cols-2 gap-1.5">
          {PICKER_EMOTES.map((id) => (
            <button
              key={id}
              type="button"
              aria-label={labelOf(id)}
              title={labelOf(id)}
              onClick={() => send(id)}
              className={`flex items-center justify-center rounded-2xl hover:bg-white/10 ${
                sheet ? "size-16 bg-raised" : "size-[60px] bg-surface"
              }`}
            >
              <EmoteFace avatar={avatar} id={id} still className="size-full" />
            </button>
          ))}
        </div>
        <div role="group" aria-label="Phrases" className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
          {PICKER_PHRASES.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => send(id)}
              className={`truncate rounded-full border border-white/12 px-2 font-semibold hover:bg-white/10 ${
                sheet ? "min-h-[34px] text-[13px]" : "min-h-[30px] text-xs"
              }`}
            >
              {labelOf(id)}
            </button>
          ))}
        </div>
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
const MENU_WIDTH_PX = 400;

/** A reaction's name, as the picker shows it (a phrase's is its text). */
function labelOf(id: ReactionId): string {
  return REACTIONS.find((r) => r.id === id)!.label;
}

/** The table header's square icon buttons, as the design draws them. */
export const ICON_BUTTON =
  "flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-surface text-ink hover:bg-raised md:size-[42px]";
