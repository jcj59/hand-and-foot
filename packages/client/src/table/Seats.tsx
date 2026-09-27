/**
 * The other players: what they hold, what they have down, and whether they are here.
 *
 * Counts rather than cards, because counts are all the server sends — every hidden
 * zone is reduced to a number before it leaves, which is the anti-cheat boundary.
 * There is nothing here to leak even if the component were careless.
 *
 * Whose turn it is and who has dropped are both marked, and the second matters as
 * much as the first: a disconnected seat has its turns played for it once the
 * reconnect grace elapses, so the table should say why moves are happening.
 */
import type { OpponentView, RoomInfo, RulesConfig } from "@hf/shared";
import { Melds } from "./Melds";

export interface SeatsProps {
  readonly opponents: readonly OpponentView[];
  readonly room: RoomInfo;
  readonly config: RulesConfig;
  readonly seatToAct: number;
}

export function Seats({ opponents, room, config, seatToAct }: SeatsProps): React.ReactElement {
  return (
    <ul className="flex flex-wrap gap-3">
      {opponents.map((opponent) => {
        const info = room.players.find((p) => p.seat === opponent.seat);
        const onTurn = opponent.seat === seatToAct;
        return (
          <li
            key={opponent.seat}
            aria-label={seatLabel(opponent, info?.name ?? `Seat ${opponent.seat}`, onTurn)}
            className={`flex min-w-44 flex-col gap-2 rounded border p-3 ${
              onTurn ? "border-amber-300 bg-amber-300/10" : "border-white/10 bg-black/20"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`h-2 w-2 shrink-0 rounded-full ${
                  info?.connected ? "bg-emerald-400" : "bg-red-400"
                }`}
              />
              <span className="truncate text-sm font-medium">
                {info?.name ?? `Seat ${opponent.seat}`}
              </span>
              {onTurn && <span className="ml-auto text-xs text-amber-200">to play</span>}
            </div>

            <dl className="flex gap-3 text-xs text-white/60">
              <div>
                <dt className="inline">Hand </dt>
                <dd className="inline font-medium text-white/80">{opponent.handCount}</dd>
              </div>
              <div>
                {/* Named for where they are in the game, not just counted: a player
                    who is into their foot has no hand left to come back from. */}
                <dt className="inline">{opponent.inFoot ? "Foot (in) " : "Foot "}</dt>
                <dd className="inline font-medium text-white/80">{opponent.footCount}</dd>
              </div>
            </dl>

            <Melds melds={opponent.melds} config={config} compact />
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
