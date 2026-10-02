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
import { useRef, useState } from "react";
import { MIN_PLAYERS, type RoomInfo, type RoundEnded, type RulesConfig } from "@hf/shared";

export interface RoundResultProps {
  readonly result: RoundEnded;
  readonly room: RoomInfo;
  readonly config: RulesConfig;
  /** What a seated player can do next; null when the table is only being watched. */
  readonly actions: RoundResultActions | null;
  /** This viewer's seat, to know whether they have said ready already. */
  readonly seat: number;
  /** A refusal to show where the player is looking, over the table. */
  readonly notice: string | null;
}

export interface RoundResultActions {
  /** Get up from the table and go back to the main screen. */
  readonly onLeave: () => void;
  /** Go to the next game's waiting room. Offered once the match is over. */
  readonly onPlayAgain: () => void;
  /** Say ready for the next round of the match. Offered until the last round. */
  readonly onNextRound: () => void;
  /**
   * Carry on without a player who has gone. Offered to the host, between rounds of
   * a family game, for each player not at the table.
   */
  readonly onRemovePlayer: (seat: number) => void;
  /**
   * Put the match away between rounds, to be finished another day. Offered until
   * the last round, at family tables, as pausing is.
   */
  readonly onSaveForLater: () => void;
}

/** A signed number the way a scoreboard writes one. */
function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

export function RoundResult({
  result,
  room,
  config,
  actions,
  seat: mySeat,
  notice,
}: RoundResultProps): React.ReactElement {
  const { scoring } = config;
  const [hidden, setHidden] = useState(false);
  // Where the panel has been dragged to, as an offset from where it opens.
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const totalOf = (seat: number): number => result.totals[seat] ?? 0;
  // The round a player left the match after, if they have left it.
  const leftAfter = (seat: number): number | undefined =>
    result.departed?.find((d) => d.seat === seat)?.afterRound;
  const gone = (seat: number): boolean => leftAfter(seat) !== undefined;
  // Ranked by the match so far, which is the standing that matters between rounds —
  // among the players still in it. Anyone who has left keeps their row, below them.
  const ranked = [...result.scores].sort(
    (a, b) => Number(gone(a.seat)) - Number(gone(b.seat)) || totalOf(b.seat) - totalOf(a.seat),
  );
  const nameOf = (seat: number): string =>
    room.players.find((p) => p.seat === seat)?.name ?? `Seat ${seat}`;
  // A player who left can top the totals without having finished the match: the
  // win is among those who did.
  const contenders = result.scores.filter((r) => !gone(r.seat));
  const best = Math.max(...contenders.map((r) => totalOf(r.seat)));
  const winners = contenders.filter((r) => totalOf(r.seat) === best).map((r) => nameOf(r.seat));
  const playing = room.players.filter((p) => !p.departed);
  const family = config.mode === "family";
  // Who the host could carry on without: anyone still in the match but not at the
  // table, while enough would be left to deal to.
  const absent =
    actions &&
    !result.matchOver &&
    family &&
    mySeat === room.hostSeat &&
    playing.length > MIN_PLAYERS
      ? playing.filter((p) => !p.connected && p.seat !== mySeat)
      : [];
  const headline = result.matchOver
    ? winners.length === 1
      ? `${winners[0]} wins!`
      : `A tie between ${winners.join(" and ")}!`
    : result.wentOutSeat !== undefined
      ? `${nameOf(result.wentOutSeat)} went out!`
      : "The stock ran out.";
  const iAmReady = room.nextRoundReady.includes(mySeat);
  // What to do next stays on screen whether or not the scores are.
  const choices = actions && (
    <>
      {result.matchOver ? (
        <button
          type="button"
          onClick={actions.onPlayAgain}
          className="rounded bg-amber-300 px-3 py-1.5 text-sm font-medium text-black"
        >
          Play again
        </button>
      ) : (
        <button
          type="button"
          disabled={iAmReady}
          onClick={actions.onNextRound}
          className="rounded bg-amber-300 px-3 py-1.5 text-sm font-medium text-black disabled:opacity-60"
        >
          {iAmReady ? "Waiting for the others…" : "Next round"}
        </button>
      )}
      {!result.matchOver && room.config.pauseEnabled && (
        <button
          type="button"
          onClick={actions.onSaveForLater}
          className="rounded border border-sky-200/60 px-3 py-1.5 text-sm text-sky-100"
        >
          Save for later
        </button>
      )}
      <button
        type="button"
        onClick={actions.onLeave}
        className="rounded bg-white px-3 py-1.5 text-sm font-medium text-felt-900"
      >
        Back to the main screen
      </button>
    </>
  );
  if (hidden) {
    return (
      <div
        role="region"
        aria-label="Round over"
        className="fixed right-4 bottom-4 z-30 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300/60 bg-felt-900 p-2 shadow-lg"
      >
        {notice && (
          <p role="alert" className="w-full text-sm text-red-200">
            {notice}
          </p>
        )}
        <span className="px-1 text-sm font-medium text-amber-200">{headline}</span>
        {choices}
        <button
          type="button"
          onClick={() => setHidden(false)}
          className="rounded border border-white/25 px-3 py-1.5 text-sm"
        >
          Show the scores
        </button>
      </div>
    );
  }
  return (
    // No backdrop: the table stays visible and usable around the panel, which can
    // be dragged by its title bar to wherever it covers least.
    <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center p-4">
      <section
        role="dialog"
        aria-label="Round result"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        className="pointer-events-auto max-h-full w-full max-w-3xl overflow-y-auto rounded-lg border border-amber-300/60 bg-felt-900 shadow-2xl"
      >
        <div
          // The handle. Pointer capture keeps the drag going when the pointer
          // outruns the panel.
          aria-label="Drag to move the scores"
          onPointerDown={(event) => {
            drag.current = { x: event.clientX - offset.x, y: event.clientY - offset.y };
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!drag.current) return;
            setOffset({ x: event.clientX - drag.current.x, y: event.clientY - drag.current.y });
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          className="flex cursor-move touch-none items-center justify-between gap-2 rounded-t-lg bg-amber-300/15 px-4 py-2 select-none"
        >
          <p className="text-2xl font-bold text-amber-200">{headline}</p>
          <span aria-hidden="true" className="text-white/40">
            ⠿ drag
          </span>
        </div>
        <div className="p-4 pt-2">
          <h2 className="mt-1 text-sm font-medium text-white/70">
            {result.matchOver
              ? `Final scores after ${config.rounds} rounds`
              : `Round ${result.roundNumber} of ${config.rounds} over`}
          </h2>
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
                  <th className="py-1 pr-3 font-normal">This round</th>
                  <th className="py-1 font-normal">{result.matchOver ? "Final" : "Total"}</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map(({ seat, score, breakdown: b }) => {
                  const name = room.players.find((p) => p.seat === seat)?.name ?? `Seat ${seat}`;
                  const after = leftAfter(seat);
                  // Gone before this round was dealt: there is nothing of theirs to break down.
                  if (after !== undefined && after < result.roundNumber) {
                    return (
                      <tr
                        key={seat}
                        aria-label={`${name}: left after round ${after}`}
                        className="border-t border-white/10 text-white/50"
                      >
                        <th scope="row" className="py-1 pr-3 text-left font-medium">
                          {name} <span className="text-xs font-normal">(left)</span>
                        </th>
                        <td colSpan={6} className="py-1 pr-3 italic">
                          Left after round {after}
                        </td>
                        <td className="py-1">{totalOf(seat)}</td>
                      </tr>
                    );
                  }
                  return (
                    <tr
                      key={seat}
                      aria-label={`${name}: ${score}`}
                      className={`border-t border-white/10 ${after !== undefined ? "text-white/60" : ""}`}
                    >
                      <th scope="row" className="py-1 pr-3 text-left font-medium">
                        {name}
                        {after !== undefined && (
                          <span className="text-xs font-normal"> (left)</span>
                        )}
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
                      <td className="py-1 pr-3">{score}</td>
                      <td className="py-1 font-semibold">{totalOf(seat)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!result.matchOver && room.nextRoundReady.length > 0 && (
            <p role="status" className="mt-3 text-sm text-amber-100">
              Ready for round {result.roundNumber + 1}: {room.nextRoundReady.map(nameOf).join(", ")}{" "}
              ({room.nextRoundReady.length} of {playing.length})
            </p>
          )}
          {result.matchOver && room.playAgain.length > 0 && (
            // Who is already waiting for the next game, so a player can see whether
            // anyone is there to play with.
            <p role="status" className="mt-3 text-sm text-amber-100">
              Waiting in the next game: {room.playAgain.map(nameOf).join(", ")} (
              {room.playAgain.length} of {playing.length})
            </p>
          )}
          {absent.map((p) => (
            <div
              key={p.seat}
              className="mt-3 flex flex-wrap items-center gap-2 rounded border border-white/15 px-3 py-2 text-sm"
            >
              <span className="flex-1 text-white/80">
                {p.name} is not at the table. The rest of you can carry on without them.
              </span>
              <button
                type="button"
                onClick={() => actions!.onRemovePlayer(p.seat)}
                className="rounded border border-amber-200/60 px-3 py-1.5 text-amber-100"
              >
                Carry on without {p.name}
              </button>
            </div>
          ))}
          {notice && (
            <p role="alert" className="mt-3 rounded bg-red-600/20 px-3 py-2 text-sm text-red-200">
              {notice}
            </p>
          )}
          {actions && !result.matchOver && family && playing.length > MIN_PLAYERS && (
            <p className="mt-3 text-xs text-white/60">
              Leaving now takes you out of the match; the others carry on without you.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {choices}
            <button
              type="button"
              onClick={() => setHidden(true)}
              className="rounded border border-white/25 px-3 py-1.5 text-sm"
            >
              Look at the table
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
