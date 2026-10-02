/**
 * The other players: what they hold, what they have down, and whether they are here.
 *
 * Counts rather than cards, because counts are all the server sends — every hidden
 * zone is reduced to a number before it leaves, which is the anti-cheat boundary.
 * There is nothing here to leak even if the component were careless. The counts
 * are drawn as card backs — a fanned hand, and the foot as a stack until it is
 * picked up — because how much someone holds is read faster than it is counted.
 *
 * Whose turn it is and who has dropped are both marked, and the second matters as
 * much as the first: a disconnected seat has its turns played for it once the
 * reconnect grace elapses, so the table should say why moves are happening.
 */
import type { OpponentView, Reaction, RoomInfo, RulesConfig } from "@hf/shared";
import { FaceDownPile, HiddenHand } from "../cards/PlayingCard";
import { GrabbyIcon } from "./grabby";
import { Melds } from "./Melds";
import { ReactionBubble } from "./reactions";
import { AvatarFace } from "../profile/Avatar";
import { faceOf } from "../profile/avatarStore";

export interface SeatsProps {
  readonly opponents: readonly OpponentView[];
  readonly room: RoomInfo;
  readonly config: RulesConfig;
  readonly seatToAct: number;
  /** A quick reaction to show by each seat that has one up. */
  readonly reactions?: ReadonlyMap<number, Reaction>;
}

export function Seats({
  opponents,
  room,
  config,
  seatToAct,
  reactions,
}: SeatsProps): React.ReactElement {
  return (
    <ul className="flex gap-3 overflow-x-auto">
      {opponents.map((opponent) => {
        const info = room.players.find((p) => p.seat === opponent.seat);
        const onTurn = opponent.seat === seatToAct;
        return (
          <li
            key={opponent.seat}
            data-anchor={`seat-${opponent.seat}`}
            data-zone="seat"
            aria-label={seatLabel(opponent, info?.name ?? `Seat ${opponent.seat}`, onTurn)}
            // Capped, so a player with a table full of melds does not push the
            // middle of the table down the screen; their melds scroll inside.
            className={`relative flex max-h-56 min-w-44 flex-col gap-2 rounded border p-2 ${
              onTurn ? "border-amber-300 bg-amber-300/10" : "border-white/10 bg-black/20"
            }`}
          >
            {reactions?.get(opponent.seat) && (
              <ReactionBubble
                reaction={reactions.get(opponent.seat)!}
                name={info?.name ?? `Seat ${opponent.seat}`}
                avatar={info && faceOf(info)}
              />
            )}
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`h-2 w-2 shrink-0 rounded-full ${
                  info?.connected ? "bg-emerald-400" : "bg-red-400"
                }`}
              />
              {info && <AvatarFace avatar={faceOf(info)} size={24} />}
              {room.grabbyPants?.seat === opponent.seat && (
                <GrabbyIcon className="h-5 w-5 shrink-0" />
              )}
              <span className="truncate text-sm font-medium">
                {info?.name ?? `Seat ${opponent.seat}`}
              </span>
              {onTurn && <span className="ml-auto text-xs text-amber-200">to play</span>}
            </div>

            <div className="flex items-end gap-3">
              {/* Once in the foot the hand is gone and the foot is what they hold,
                  so it is drawn as the hand; before that it waits as a stack. */}
              <HiddenHand
                count={opponent.inFoot ? opponent.footCount : opponent.handCount}
                label={opponent.inFoot ? "Foot, in hand" : "Hand"}
              />
              {!opponent.inFoot && (
                <FaceDownPile count={opponent.footCount} label="Foot" size="small" />
              )}
              {opponent.inFoot && <span className="text-xs text-white/60">Foot (in)</span>}
            </div>

            <div className="min-h-0 overflow-y-auto">
              <Melds melds={opponent.melds} config={config} compact />
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
