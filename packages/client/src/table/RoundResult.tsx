/**
 * The end-of-round scoreboard, with the arithmetic shown.
 *
 * A total alone invites the question of where it came from, and in Hand and Foot
 * the answer is usually the books: a player can lay down fewer card points and
 * still win on two clean books. So each player's score is broken into the parts the
 * engine added up — books by kind at the table's bonus, the face value of what was
 * melded, the go-out bonus, and the cards left over — and the parts are the
 * engine's own, so they always sum to the total.
 */
import type { RoomInfo, RoundEnded, RulesConfig } from "@hf/shared";

export interface RoundResultProps {
  readonly result: RoundEnded;
  readonly room: RoomInfo;
  readonly config: RulesConfig;
}

/** A signed number the way a scoreboard writes one. */
function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

export function RoundResult({ result, room, config }: RoundResultProps): React.ReactElement {
  const { scoring } = config;
  const ranked = [...result.scores].sort((a, b) => b.score - a.score);
  return (
    <section
      aria-label="Round result"
      className="rounded border border-amber-300/40 bg-amber-300/10 p-3"
    >
      <h2 className="text-sm font-medium">Round over</h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-white/60">
              <th className="py-1 pr-3 font-normal">Player</th>
              <th className="py-1 pr-3 font-normal">Clean books</th>
              <th className="py-1 pr-3 font-normal">Dirty books</th>
              <th className="py-1 pr-3 font-normal">Cards melded</th>
              <th className="py-1 pr-3 font-normal">Went out</th>
              <th className="py-1 pr-3 font-normal">Cards left</th>
              <th className="py-1 font-normal">Total</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map(({ seat, score, breakdown: b }) => {
              const name = room.players.find((p) => p.seat === seat)?.name ?? `Seat ${seat}`;
              return (
                <tr
                  key={seat}
                  aria-label={`${name}: ${score}`}
                  className="border-t border-white/10"
                >
                  <th scope="row" className="py-1 pr-3 text-left font-medium">
                    {name}
                  </th>
                  <td className="py-1 pr-3">
                    {b.cleanBooks} × {scoring.cleanBookBonus} ={" "}
                    {signed(b.cleanBooks * scoring.cleanBookBonus)}
                  </td>
                  <td className="py-1 pr-3">
                    {b.dirtyBooks} × {scoring.dirtyBookBonus} ={" "}
                    {signed(b.dirtyBooks * scoring.dirtyBookBonus)}
                  </td>
                  <td className="py-1 pr-3">{signed(b.meldedCards)}</td>
                  <td className="py-1 pr-3">
                    {result.wentOutSeat === seat ? signed(b.goOutBonus) : "—"}
                  </td>
                  <td className="py-1 pr-3">
                    {b.heldCount === 0
                      ? "none"
                      : `${b.heldCount} card${b.heldCount === 1 ? "" : "s"}: ${signed(b.heldPenalty)}`}
                  </td>
                  <td className="py-1 font-semibold">{score}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
