/**
 * The table.
 *
 * Everything on screen comes from the latest `ViewUpdate`: the hand and melds from
 * the filtered view, every opponent as counts, and which actions are open from the
 * server's `hints`. Nothing is derived from the rules here — the client cannot
 * decide whether the pile may be taken, and a second opinion that disagreed with
 * the reducer would be the one the player sees.
 *
 * Melding, discarding and the take-pile obligation land in M3d; this renders the
 * table and wires the two draw-phase actions, which is enough to begin a turn.
 */
import { useState } from "react";
import { isWild } from "@hf/shared";
import { play } from "../actions";
import { PlayingCard, FaceDownPile } from "../cards/PlayingCard";
import { sortForDisplay } from "../cards/handOrder";
import { useSession } from "../session";
import type { HfClientSocket } from "../socket";
import { Melds } from "../table/Melds";
import { Seats } from "../table/Seats";
import { TurnClock } from "../table/TurnClock";

export interface TableProps {
  readonly socket: HfClientSocket;
}

export function Table({ socket }: TableProps): React.ReactElement {
  const update = useSession((s) => s.update);
  const notice = useSession((s) => s.notice);
  const setNotice = useSession((s) => s.setNotice);
  const seat = useSession((s) => s.seat);
  const result = useSession((s) => s.result);
  const [busy, setBusy] = useState(false);

  // Between the deal being ordered and the first view arriving there is nothing to
  // draw. Normal, not a fault.
  if (!update) {
    return <main className="p-6 text-white/60">Dealing&hellip;</main>;
  }

  const { view, room, hints, clock } = update;
  const myTurn = hints.seatToAct === view.seat;
  const sink = { seat, setNotice };

  async function send(action: Parameters<typeof play>[1]): Promise<void> {
    setBusy(true);
    try {
      await play(socket, action, sink);
    } finally {
      setBusy(false);
    }
  }

  // The foot is revealed only once picked up; before that the server sends a count
  // and no cards, so there is nothing to show but a back.
  const active = view.inFoot ? (view.foot ?? []) : view.hand;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Table {room.roomId}</h1>
          <p className="text-sm text-white/60">
            Round {view.roundNumber} · minimum{" "}
            {room.config.layDownMinimums[view.roundNumber - 1] ?? "—"}
            {view.isDown ? " · you are down" : " · not down"}
          </p>
        </div>
        <TurnClock clock={clock} />
      </header>

      {result && (
        <section
          aria-label="Round result"
          className="rounded border border-amber-300/40 bg-amber-300/10 p-3"
        >
          <h2 className="text-sm font-medium">Round over</h2>
          <ul className="mt-1 flex flex-wrap gap-3 text-sm">
            {result.scores.map((score) => (
              <li key={score.seat}>
                {room.players.find((p) => p.seat === score.seat)?.name ?? `Seat ${score.seat}`}:{" "}
                <span className="font-medium">{score.score}</span>
                {result.wentOutSeat === score.seat && (
                  <span className="text-amber-200"> · went out</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Seats
        opponents={view.opponents}
        room={room}
        config={room.config}
        seatToAct={hints.seatToAct}
      />

      <section className="flex flex-wrap items-end gap-6" aria-label="Piles">
        <FaceDownPile count={view.stockCount} label="Stock" />
        <div className="flex flex-col items-center gap-1">
          <span className="text-xs text-white/60">Discard ({view.discard.length})</span>
          {view.discard.length === 0 ? (
            <p className="text-xs text-white/40">empty</p>
          ) : (
            // Only the top card is actionable and only the top card is worth drawing;
            // the pile beneath it is a count.
            <PlayingCard card={view.discard[view.discard.length - 1]} />
          )}
        </div>
        {!view.inFoot && <FaceDownPile count={view.footCount} label="Your foot" />}
      </section>

      <section className="flex flex-col gap-2" aria-label="Your melds">
        <h2 className="text-sm font-medium text-white/80">Your melds</h2>
        <Melds melds={view.melds} config={room.config} />
      </section>

      <section className="flex flex-col gap-2" aria-label="Your hand">
        <h2 className="text-sm font-medium text-white/80">
          {view.inFoot ? "Your foot" : "Your hand"} ({active.length})
          {countWilds(active) > 0 && (
            <span className="ml-2 font-normal text-white/50">{countWilds(active)} wild</span>
          )}
        </h2>
        {active.length === 0 ? (
          <p className="text-sm text-white/50">
            No cards. You still take a turn: draw, and play from the pile if it fits.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {sortForDisplay(active).map((card) => (
              <PlayingCard key={card.id} card={card} />
            ))}
          </div>
        )}
      </section>

      {notice && (
        <p role="alert" className="rounded bg-red-600/20 px-3 py-2 text-sm text-red-200">
          {notice}
        </p>
      )}

      <section className="flex flex-wrap items-center gap-3" aria-label="Your turn">
        {myTurn ? (
          <>
            <button
              type="button"
              disabled={busy || !hints.canDraw}
              onClick={() => void send({ type: "draw" })}
              className="rounded bg-white px-4 py-2 font-medium text-felt-900 disabled:opacity-40"
            >
              Draw
            </button>
            <button
              type="button"
              // Whether the pile can be taken is decided by a solver over the whole
              // state, so this is the server's answer, not a guess made here.
              disabled={busy || !hints.canTakePile}
              onClick={() => void send({ type: "takePile" })}
              className="rounded border border-white/30 px-4 py-2 font-medium disabled:opacity-40"
            >
              Take the pile
            </button>
            <span className="text-sm text-white/60">
              {hints.phase === "draw" ? "Draw, or take the pile." : "Melding lands in M3d."}
            </span>
          </>
        ) : (
          <span className="text-sm text-white/60">
            Waiting for{" "}
            {room.players.find((p) => p.seat === hints.seatToAct)?.name ??
              `seat ${hints.seatToAct}`}
            .
          </span>
        )}
      </section>
    </main>
  );
}

/** Wilds are a resource to plan around, so the count is worth stating. */
function countWilds(cards: readonly { readonly rank: Parameters<typeof isWild>[0] }[]): number {
  return cards.filter((card) => isWild(card.rank)).length;
}
