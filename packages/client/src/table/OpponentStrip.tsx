/**
 * The other players on a phone: one chip each, in a row that scrolls sideways,
 * so six opponents take no more height than one.
 *
 * A chip carries what a player glances at between turns — who, whether they are
 * here, how many cards they hold and whether that is their foot, and how many
 * books they have and of which kind. Their melds in full are one tap away, in a
 * sheet over the table; laid out inline they would push the player's own cards
 * off the screen.
 *
 * As with `Seats`, there is nothing here that could leak: the server sends
 * opponents as counts and melds, never cards in hand.
 */
import { useEffect, useRef, useState } from "react";
import type { OpponentView, Reaction, RoomInfo, RulesConfig } from "@hf/shared";
import { classifyBook } from "@hf/engine";
import { GrabbyIcon } from "./grabby";
import { Melds } from "./Melds";
import { ReactionBubble } from "./reactions";

export interface OpponentStripProps {
  readonly opponents: readonly OpponentView[];
  readonly room: RoomInfo;
  readonly config: RulesConfig;
  readonly seatToAct: number;
  /** A quick reaction to show by each seat that has one up. */
  readonly reactions?: ReadonlyMap<number, Reaction>;
}

export function OpponentStrip({
  opponents,
  room,
  config,
  seatToAct,
  reactions,
}: OpponentStripProps): React.ReactElement {
  const [open, setOpen] = useState<number | null>(null);
  const nameOf = (seat: number): string =>
    room.players.find((p) => p.seat === seat)?.name ?? `Seat ${seat}`;
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
      <ul aria-label="Other players" className="-mx-2 flex gap-2 overflow-x-auto px-2 pb-1">
        {opponents.map((opponent) => {
          const connected = room.players.find((p) => p.seat === opponent.seat)?.connected;
          const onTurn = opponent.seat === seatToAct;
          const books = opponent.melds.map(classifyBook).filter((kind) => kind !== "incomplete");
          const clean = books.filter((kind) => kind === "clean").length;
          const held = opponent.inFoot ? opponent.footCount : opponent.handCount;
          return (
            <li
              key={opponent.seat}
              className="relative shrink-0"
              data-anchor={`seat-${opponent.seat}`}
              data-zone="seat"
            >
              {reactions?.get(opponent.seat) && (
                <ReactionBubble
                  reaction={reactions.get(opponent.seat)!}
                  name={nameOf(opponent.seat)}
                />
              )}
              <button
                type="button"
                aria-label={chipLabel(nameOf(opponent.seat), opponent, onTurn, clean, books.length)}
                onClick={() => setOpen(opponent.seat)}
                className={`flex max-w-44 min-w-28 flex-col gap-0.5 rounded border px-2 py-1 text-left ${
                  onTurn ? "border-amber-300 bg-amber-300/15" : "border-white/15 bg-black/25"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      connected ? "bg-emerald-400" : "bg-red-400"
                    }`}
                  />
                  {room.grabbyPants?.seat === opponent.seat && (
                    <GrabbyIcon className="h-4 w-4 shrink-0" />
                  )}
                  <span className="truncate text-sm font-medium">{nameOf(opponent.seat)}</span>
                </span>
                <span className="flex items-center gap-1.5 text-xs text-white/70">
                  <span>
                    {held} card{held === 1 ? "" : "s"}
                  </span>
                  {opponent.inFoot && (
                    <span className="rounded bg-sky-400/25 px-1 text-[10px] font-semibold text-sky-100">
                      FOOT
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1 text-xs text-white/60">
                  {books.length === 0 ? (
                    opponent.isDown ? (
                      "down"
                    ) : (
                      "not down"
                    )
                  ) : (
                    <>
                      {books.map((kind, i) => (
                        <span
                          key={i}
                          aria-hidden="true"
                          className={`h-2.5 w-2 rounded-sm border ${
                            kind === "clean"
                              ? "border-red-300 bg-red-500"
                              : "border-white/50 bg-neutral-900"
                          }`}
                        />
                      ))}
                      <span className="ml-0.5">
                        {books.length} book{books.length === 1 ? "" : "s"}
                      </span>
                    </>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {shown && (
        <div
          className="fixed inset-0 z-40 flex items-end bg-black/50"
          onClick={() => setOpen(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${nameOf(shown.seat)}'s melds`}
            onClick={(event) => event.stopPropagation()}
            className="max-h-[70%] w-full overflow-y-auto rounded-t-xl border-t border-white/15 bg-felt-900 p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">{nameOf(shown.seat)}</h2>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(null)}
                className="rounded border border-white/25 px-3 py-1 text-sm"
              >
                Close
              </button>
            </div>
            <p className="mb-3 text-sm text-white/70">
              {shown.inFoot
                ? `Playing from the foot, ${shown.footCount} cards left.`
                : `${shown.handCount} cards in hand, ${shown.footCount} in the foot.`}
            </p>
            <Melds melds={shown.melds} config={config} compact />
          </div>
        </div>
      )}
    </>
  );
}

function chipLabel(
  name: string,
  opponent: OpponentView,
  onTurn: boolean,
  clean: number,
  books: number,
): string {
  const parts = [
    name,
    opponent.inFoot
      ? `${opponent.footCount} in foot, playing from it`
      : `${opponent.handCount} in hand`,
    books === 0
      ? opponent.isDown
        ? "down"
        : "not down"
      : `${books} book${books === 1 ? "" : "s"}, ${clean} clean`,
  ];
  if (onTurn) parts.push("to play");
  return parts.join(", ");
}
