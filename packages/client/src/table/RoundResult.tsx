/**
 * The end-of-round scoreboard, with the arithmetic shown.
 *
 * A total alone invites the question of where it came from, and in Hand and Foot
 * the answer is usually the books: a player can lay down fewer card points and
 * still win on two clean books. So each player's score is broken into the parts the
 * engine added up — books by kind at the table's bonus, the face value of what was
 * melded, the go-out bonus, and the cards left over — and the parts are the
 * engine's own, so they always sum to the total.
 *
 * It opens over the table, headed by how the round ended, because the end of a
 * round is the biggest thing that happens in it and a line of text among the
 * cards is easy to miss. It can be hidden to look back at the table.
 */
import { useState } from "react";
import type { RoomInfo, RoundEnded, RulesConfig } from "@hf/shared";

export interface RoundResultProps {
  readonly result: RoundEnded;
  readonly room: RoomInfo;
  readonly config: RulesConfig;
  /** Get up from the table and go back to the main screen. */
  readonly onLeave: () => void;
  /** Ask for another game with the same players. */
  readonly onPlayAgain: () => void;
  /** This viewer's seat, to know whether they have asked already. */
  readonly seat: number;
}

/** A signed number the way a scoreboard writes one. */
function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

export function RoundResult({
  result,
  room,
  config,
  onLeave,
  onPlayAgain,
  seat,
}: RoundResultProps): React.ReactElement {
  const { scoring } = config;
  const [hidden, setHidden] = useState(false);
  const ranked = [...result.scores].sort((a, b) => b.score - a.score);
  const nameOf = (seat: number): string =>
    room.players.find((p) => p.seat === seat)?.name ?? `Seat ${seat}`;
  const headline =
    result.wentOutSeat !== undefined
      ? `${nameOf(result.wentOutSeat)} went out!`
      : "The stock ran out.";
  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => setHidden(false)}
        className="fixed right-4 bottom-4 z-30 rounded bg-amber-300 px-4 py-2 font-medium text-black shadow-lg"
      >
        Show the scores
      </button>
    );
  }
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <section
        role="dialog"
        aria-label="Round result"
        className="max-h-full w-full max-w-3xl overflow-y-auto rounded-lg border border-amber-300/60 bg-felt-900 p-4 shadow-2xl"
      >
        <p className="text-2xl font-bold text-amber-200">{headline}</p>
        <h2 className="mt-1 text-sm font-medium text-white/70">Round over</h2>
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
        <PlayAgainTally room={room} nameOf={nameOf} />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={room.playAgain.includes(seat)}
            onClick={onPlayAgain}
            className="rounded bg-amber-300 px-3 py-1.5 text-sm font-medium text-black disabled:opacity-60"
          >
            {room.playAgain.includes(seat) ? "Waiting for the others…" : "Play again"}
          </button>
          <button
            type="button"
            onClick={onLeave}
            className="rounded bg-white px-3 py-1.5 text-sm font-medium text-felt-900"
          >
            Back to the main screen
          </button>
          <button
            type="button"
            onClick={() => setHidden(true)}
            className="rounded border border-white/25 px-3 py-1.5 text-sm"
          >
            Look at the table
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * Who has asked to play again, out of everyone still at the table, so a player
 * can see what the next game is waiting on.
 */
function PlayAgainTally({
  room,
  nameOf,
}: {
  readonly room: RoomInfo;
  readonly nameOf: (seat: number) => string;
}): React.ReactElement | null {
  if (room.playAgain.length === 0) return null;
  return (
    <p role="status" className="mt-3 text-sm text-amber-100">
      Play again: {room.playAgain.length} of {room.players.length} ready (
      {room.playAgain.map(nameOf).join(", ")})
    </p>
  );
}
