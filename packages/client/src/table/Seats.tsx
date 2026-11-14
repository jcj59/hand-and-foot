/**
 * The other players on a computer: a box each across the top of the felt, with
 * who they are, what they are doing ("Playing · 0:41", "Foot · 9", "Reconnecting"),
 * a marker per book, and their melds as chips ("K ×4 +★"), which Expand opens
 * into the cards themselves.
 *
 * Counts rather than cards, because counts are all the server sends: every hidden
 * zone is reduced to a number before it leaves, which is the anti-cheat boundary.
 *
 * Whose turn it is and who has dropped are both marked, and the second matters as
 * much as the first: a disconnected seat has its turns played for it once the
 * reconnect grace elapses, so the table should say why moves are happening.
 */
import { useState } from "react";
import type { ClockState, OpponentView, Reaction, RoomInfo } from "@hf/shared";
import { faceOf } from "../profile/avatarStore";
import { GRABBY_NAME, GrabbyIcon } from "./grabby";
import { Melds } from "./Melds";
import { booksOf, type MeldOrder } from "./meldView";
import { BookMarkers, LINE_COLOR, seatLine } from "./OpponentStrip";
import { PlayerFace } from "./PlayerFace";
import { ReactionBubble } from "./reactions";
import { useRemaining } from "./TurnClock";

export interface SeatsProps {
  readonly opponents: readonly OpponentView[];
  readonly room: RoomInfo;
  /** The room under its real names, to say who holds the Grabby Pants title. */
  readonly realRoom: RoomInfo;
  readonly seatToAct: number;
  readonly clock: ClockState;
  readonly order: MeldOrder;
  /** A quick reaction to show by each seat that has one up. */
  readonly reactions?: ReadonlyMap<number, Reaction>;
}

export function Seats({
  opponents,
  room,
  realRoom,
  seatToAct,
  clock,
  order,
  reactions,
}: SeatsProps): React.ReactElement {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const remaining = useRemaining(clock);
  return (
    <ul
      aria-label="Other players"
      className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2.5 p-0"
    >
      {opponents.map((opponent) => {
        const info = room.players.find((p) => p.seat === opponent.seat);
        const name = info?.name ?? `Seat ${opponent.seat}`;
        const onTurn = opponent.seat === seatToAct;
        const line = seatLine(opponent, info, onTurn, clock.deadlineAt === null ? null : remaining);
        const expanded = open.has(opponent.seat);
        const grabby = room.grabbyPants?.seat === opponent.seat;
        const realName = realRoom.players.find((p) => p.seat === opponent.seat)?.name;
        return (
          <li
            key={opponent.seat}
            data-anchor={`seat-${opponent.seat}`}
            data-zone="seat"
            aria-label={seatLabel(opponent, name, onTurn)}
            className={`relative flex max-h-64 min-w-0 flex-col gap-2.5 rounded-2xl border bg-black/26 p-3 ${
              onTurn ? "border-gold ring-1 ring-gold" : "border-transparent"
            } ${line.tone === "warn" ? "opacity-55" : ""}`}
          >
            {reactions?.get(opponent.seat) && (
              <ReactionBubble
                reaction={reactions.get(opponent.seat)!}
                name={name}
                avatar={info && faceOf(info)}
              />
            )}
            <div className="flex items-center gap-2.5">
              <PlayerFace player={info} size={40} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-sm font-semibold">
                  {grabby && <GrabbyIcon className="h-4 w-4 shrink-0" />}
                  <span className="truncate">{name}</span>
                  {grabby && name === GRABBY_NAME && realName && (
                    <span className="truncate font-normal text-ink/60">({realName})</span>
                  )}
                </span>
                <span className={`block truncate text-xs ${LINE_COLOR[line.tone]}`}>
                  {line.text}
                  {info?.bot && <span className="text-ink/50"> · computer</span>}
                </span>
                <span className="mt-1 block">
                  <BookMarkers books={booksOf(opponent.melds)} />
                </span>
              </span>
              {opponent.melds.length > 0 && (
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-label={`${expanded ? "Collapse" : "Expand"} ${name}'s melds`}
                  onClick={() => {
                    const next = new Set(open);
                    if (expanded) next.delete(opponent.seat);
                    else next.add(opponent.seat);
                    setOpen(next);
                  }}
                  className="min-h-[30px] shrink-0 rounded-lg bg-white/12 px-2 text-[11px] font-semibold hover:bg-white/18"
                >
                  {expanded ? "Collapse" : "Expand"}
                </button>
              )}
            </div>
            <div className="min-h-0 overflow-y-auto">
              {opponent.melds.length === 0 ? (
                <p className="m-0 text-xs text-ink/60">Not down yet</p>
              ) : (
                <Melds
                  melds={opponent.melds}
                  config={room.config}
                  order={order}
                  chips={!expanded}
                  compact
                />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function seatLabel(opponent: OpponentView, name: string, onTurn: boolean): string {
  const parts = [
    name,
    `${opponent.handCount} in hand`,
    `${opponent.footCount} in foot`,
    opponent.isDown ? "down" : "not down",
  ];
  if (opponent.inFoot) parts.push("playing from the foot");
  if (onTurn) parts.push("to play");
  return parts.join(", ");
}
