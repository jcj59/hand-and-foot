/**
 * The other players on a phone: one chip each, side by side (scrolling sideways
 * past three), so the table keeps its height for the cards.
 *
 * A chip carries what a player glances at between turns: who, whether it is
 * their turn and how long they have, whether they dropped, how many cards they
 * hold and whether that is their foot, and a marker per book (gold for clean,
 * silver for dirty). Their melds in full are one tap away, in a sheet over the
 * table, sorted the same way as the player's own.
 *
 * Nothing here could leak: the server sends opponents as counts and melds, never
 * cards in hand.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ClockState, OpponentView, Reaction, RoomInfo, RoomPlayerInfo } from "@hf/shared";
import { Icon } from "../ui/icons";
import { faceOf } from "../profile/avatarStore";
import { GrabbyIcon } from "./grabby";
import { Melds } from "./Melds";
import { booksOf, type MeldOrder } from "./meldView";
import { PlayerFace } from "./PlayerFace";
import { ReactionBubble } from "./reactions";
import { useRemaining } from "./TurnClock";

export interface OpponentStripProps {
  readonly opponents: readonly OpponentView[];
  readonly room: RoomInfo;
  readonly seatToAct: number;
  readonly clock: ClockState;
  readonly order: MeldOrder;
  /** A quick reaction to show by each seat that has one up. */
  readonly reactions?: ReadonlyMap<number, Reaction>;
  /** On the felt itself, which has its own padding, rather than above it. */
  readonly onFelt?: boolean;
}

/** What a seat is doing, in the few words under its name. */
export function seatLine(
  opponent: OpponentView,
  info: RoomPlayerInfo | undefined,
  onTurn: boolean,
  remaining: string | null,
): { readonly text: string; readonly tone: "turn" | "warn" | "plain" } {
  if (info && !info.bot && !info.connected) return { text: "Reconnecting", tone: "warn" };
  if (onTurn) return { text: remaining ? `Playing · ${remaining}` : "Playing", tone: "turn" };
  return {
    text: opponent.inFoot ? `Foot · ${opponent.footCount}` : `${opponent.handCount} in hand`,
    tone: "plain",
  };
}

export const LINE_COLOR = { turn: "text-gold", warn: "text-salmon", plain: "text-ink/70" } as const;

/** One marker per book, as the chips and seat boxes show them. */
export function BookMarkers({
  books,
}: {
  readonly books: readonly ("clean" | "dirty")[];
}): React.ReactElement {
  return (
    <span aria-hidden="true" className="flex min-h-[13px] gap-[3px]">
      {books.map((kind, i) => (
        <span
          key={i}
          className={`h-[13px] w-2.5 rounded-[3px] ${
            kind === "clean" ? "bg-gold shadow-[inset_0_0_0_1px_#FFE29A]" : "bg-ink-soft"
          }`}
        />
      ))}
    </span>
  );
}

export function OpponentStrip({
  opponents,
  room,
  seatToAct,
  clock,
  order,
  reactions,
  onFelt = false,
}: OpponentStripProps): React.ReactElement {
  const [open, setOpen] = useState<number | null>(null);
  const remaining = useRemaining(clock);
  const infoOf = (seat: number): RoomPlayerInfo | undefined =>
    room.players.find((p) => p.seat === seat);
  const nameOf = (seat: number): string => infoOf(seat)?.name ?? `Seat ${seat}`;
  const shown = opponents.find((o) => o.seat === open) ?? null;
  const closeRef = useRef<HTMLButtonElement>(null);
  const showing = shown !== null;

  useEffect(() => {
    if (!showing) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showing]);

  return (
    <>
      <ul
        aria-label="Other players"
        className={`m-0 flex shrink-0 list-none gap-1.5 overflow-x-auto ${
          onFelt ? "p-0" : "px-3 pt-3.5 pb-0.5"
        }`}
      >
        {opponents.map((opponent) => {
          const info = infoOf(opponent.seat);
          const onTurn = opponent.seat === seatToAct;
          const books = booksOf(opponent.melds);
          const line = seatLine(
            opponent,
            info,
            onTurn,
            clock.deadlineAt === null ? null : remaining,
          );
          const grabby = room.grabbyPants?.seat === opponent.seat;
          return (
            <li
              key={opponent.seat}
              className="relative min-w-[108px] flex-1"
              data-anchor={`seat-${opponent.seat}`}
              data-zone="seat"
            >
              {reactions?.get(opponent.seat) && (
                <ReactionBubble
                  reaction={reactions.get(opponent.seat)!}
                  name={nameOf(opponent.seat)}
                  avatar={info && faceOf(info)}
                />
              )}
              <button
                type="button"
                aria-label={chipLabel(nameOf(opponent.seat), opponent, onTurn, books)}
                onClick={() => setOpen(opponent.seat)}
                className={`flex h-full w-full items-center gap-1.5 rounded-xl border bg-white/5 px-1.5 py-[7px] text-left ${
                  onTurn ? "border-gold ring-1 ring-gold" : "border-white/6"
                } ${line.tone === "warn" ? "opacity-55" : ""}`}
              >
                <PlayerFace player={info} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1">
                    {grabby && <GrabbyIcon className="h-3.5 w-3.5 shrink-0" />}
                    <span className="truncate text-xs font-semibold">{nameOf(opponent.seat)}</span>
                  </span>
                  <span className={`block text-[11px] leading-tight ${LINE_COLOR[line.tone]}`}>
                    {line.text}
                  </span>
                  <span className="mt-[3px] block">
                    <BookMarkers books={books} />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {shown &&
        createPortal(
          <div
            className="fixed inset-0 z-40 flex items-end bg-[rgba(6,10,12,0.5)] text-ink"
            onClick={() => setOpen(null)}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-label={`${nameOf(shown.seat)}'s melds`}
              onClick={(event) => event.stopPropagation()}
              className="flex max-h-[70%] w-full flex-col gap-3 overflow-y-auto rounded-t-3xl px-4 pt-3.5 pb-[calc(1.6rem+env(safe-area-inset-bottom,0px))]"
              style={{ background: FELT_TOP }}
            >
              <div className="flex items-center gap-2.5">
                <PlayerFace player={infoOf(shown.seat)} size={36} />
                <div className="min-w-0 flex-1">
                  <h2 className="m-0 font-display text-base font-semibold">
                    {nameOf(shown.seat)}&rsquo;s melds
                  </h2>
                  <p className="m-0 text-xs text-ink/75">
                    {shown.inFoot
                      ? `In the foot · ${shown.footCount} cards`
                      : `${shown.handCount} cards in hand · ${shown.footCount} in the foot`}
                  </p>
                </div>
                <button
                  ref={closeRef}
                  type="button"
                  aria-label="Close"
                  onClick={() => setOpen(null)}
                  className="flex size-10 items-center justify-center rounded-xl bg-black/30"
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
              {shown.melds.length === 0 ? (
                <p className="m-0 text-sm text-ink/75">Not down yet.</p>
              ) : (
                <Melds melds={shown.melds} order={order} rows />
              )}
              <p className="m-0 text-xs text-ink/70">Sorted the same way as your own melds.</p>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}

/** The felt, lit from the top: a sheet that comes up out of the table. */
const FELT_TOP = "radial-gradient(ellipse at 50% 0%, #2C6B53, #1A4535 70%, #143629)";

function chipLabel(
  name: string,
  opponent: OpponentView,
  onTurn: boolean,
  books: readonly ("clean" | "dirty")[],
): string {
  const clean = books.filter((kind) => kind === "clean").length;
  const parts = [
    name,
    opponent.inFoot
      ? `${opponent.footCount} in foot, playing from it`
      : `${opponent.handCount} in hand`,
    books.length === 0
      ? opponent.isDown
        ? "down"
        : "not down"
      : `${books.length} book${books.length === 1 ? "" : "s"}, ${clean} clean`,
  ];
  if (onTurn) parts.push("to play");
  return parts.join(", ");
}
