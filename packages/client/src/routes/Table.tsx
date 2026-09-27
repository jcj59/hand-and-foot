/**
 * The table.
 *
 * Everything on screen comes from the latest `ViewUpdate`: the hand and melds from
 * the filtered view, every opponent as counts, and which actions are open from the
 * server's `hints`. No rule is decided here — the client cannot judge whether the
 * pile may be taken, and a second opinion that disagreed with the reducer would be
 * the one the player sees.
 *
 * A turn is a short sequence of separate actions rather than one submission: draw or
 * take the pile, then optionally play melds, then discard. Only the melds are staged
 * locally, because the per-round minimum is checked across a whole lay-down at once
 * and a player has to be able to watch the total before committing to it.
 */
import { useState } from "react";
import type { Card, Rank } from "@hf/shared";
import { pauseTable, play } from "../actions";
import { FaceDownPile, PlayingCard } from "../cards/PlayingCard";
import { useSession } from "../session";
import type { HfClientSocket } from "../socket";
import { Hand, type HandMode } from "../table/Hand";
import { Melds } from "../table/Melds";
import { Seats } from "../table/Seats";
import { StagingPanel } from "../table/StagingPanel";
import { TurnClock } from "../table/TurnClock";
import {
  EMPTY_STAGING,
  focusGroup,
  previewLayDown,
  stageCard,
  stagedIds,
  toMeldPlays,
  unstageCard,
  type Staging,
} from "../table/staging";

export interface TableProps {
  readonly socket: HfClientSocket;
}

export function Table({ socket }: TableProps): React.ReactElement {
  const update = useSession((s) => s.update);
  const notice = useSession((s) => s.notice);
  const setNotice = useSession((s) => s.setNotice);
  const seat = useSession((s) => s.seat);
  const result = useSession((s) => s.result);
  const [staging, setStaging] = useState<Staging>(EMPTY_STAGING);
  const [discarding, setDiscarding] = useState(false);
  const [busy, setBusy] = useState(false);

  // Between the deal being ordered and the first view arriving there is nothing to
  // draw. Normal, not a fault.
  if (!update) {
    return <main className="p-6 text-white/60">Dealing&hellip;</main>;
  }

  const { view, room, hints, clock } = update;
  const myTurn = hints.seatToAct === view.seat;
  const sink = { seat, setNotice };
  // The foot is revealed only once picked up; before that the server sends a count
  // and no cards, so there is nothing to show but a back.
  const zone = view.inFoot ? (view.foot ?? []) : view.hand;
  const owed = new Set(view.pickedUp);
  const obligationOpen = view.pickedUp.length > 0;

  const preview = previewLayDown({
    staging,
    zone,
    melds: view.melds,
    config: room.config,
    roundNumber: view.roundNumber,
    isDown: view.isDown,
    inFoot: view.inFoot,
    footCount: view.footCount,
  });

  async function send(action: Parameters<typeof play>[1], after?: () => void): Promise<void> {
    setBusy(true);
    try {
      if (await play(socket, action, sink)) after?.();
    } finally {
      setBusy(false);
    }
  }

  function onCardSelect(card: Card): void {
    if (discarding) {
      // The discard ends the turn, so it goes straight off rather than being staged.
      void send({ type: "discard", cardId: card.id }, () => {
        setDiscarding(false);
        setStaging(EMPTY_STAGING);
      });
      return;
    }
    setStaging((current) =>
      stagedIds(current).has(card.id) ? unstageCard(current, card.id) : stageCard(current, card),
    );
  }

  // Melding is closed during the discard-only grace, so staging then would only build
  // something the server is certain to refuse.
  const canMeld = myTurn && hints.phase === "play" && !clock.inDiscardGrace;
  // The discard ends the play phase rather than being a phase of its own. What makes
  // it available is the play phase with the take-pile obligation settled.
  const canDiscard = myTurn && hints.phase === "play" && !obligationOpen && zone.length > 0;
  const mode: HandMode = discarding ? "discard" : canMeld ? "meld" : "idle";

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
        {/* Once the round is over no turn is live, so there is no clock to show even
            if a deadline still arrives. */}
        {!result && (
          <div className="flex items-center gap-4">
            <TurnClock clock={clock} />
            {room.config.pauseEnabled && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void pauseTable(socket, !clock.paused, sink).finally(() => setBusy(false));
                }}
                className="rounded border border-white/25 px-3 py-1 text-sm disabled:opacity-40"
              >
                {clock.paused ? "Resume" : "Pause"}
              </button>
            )}
          </div>
        )}
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
            <PlayingCard card={view.discard[view.discard.length - 1]} />
          )}
        </div>
        {!view.inFoot && <FaceDownPile count={view.footCount} label="Your foot" />}
      </section>

      <section className="flex flex-col gap-2" aria-label="Your melds">
        <h2 className="text-sm font-medium text-white/80">Your melds</h2>
        <Melds melds={view.melds} config={room.config} />
        {canMeld && view.melds.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {/* Aiming a wild at a book already on the table: with no natural of that
                rank left to open a group, focusing the rank is the only way in. */}
            {view.melds.map((meld) => (
              <button
                key={meld.rank}
                type="button"
                onClick={() => setStaging((current) => focusGroup(current, meld.rank as Rank))}
                className="rounded border border-white/25 px-2 py-0.5 text-xs text-white/70"
              >
                Add to {meld.rank}s
              </button>
            ))}
          </div>
        )}
      </section>

      {obligationOpen && myTurn && (
        <p role="status" className="rounded bg-sky-500/15 px-3 py-2 text-sm text-sky-100">
          You took the pile. Play at least one of the ringed cards before discarding.
        </p>
      )}

      {hints.canGoOut && myTurn && (
        <p role="status" className="rounded bg-emerald-500/15 px-3 py-2 text-sm text-emerald-100">
          You have the books to go out — shed your last card to end the round.
        </p>
      )}

      <StagingPanel
        staging={staging}
        preview={preview}
        zone={zone}
        isDown={view.isDown}
        busy={busy}
        onUnstage={(id) => setStaging((current) => unstageCard(current, id))}
        onFocus={(rank) => setStaging((current) => focusGroup(current, rank))}
        onCommit={() =>
          void send({ type: "playMelds", melds: toMeldPlays(staging) }, () =>
            setStaging(EMPTY_STAGING),
          )
        }
        onClear={() => setStaging(EMPTY_STAGING)}
      />

      <Hand
        cards={zone}
        mode={mode}
        stagedIds={stagedIds(staging)}
        owedIds={owed}
        onSelect={onCardSelect}
        title={view.inFoot ? "Your foot" : "Your hand"}
      />

      {notice && (
        <p role="alert" className="rounded bg-red-600/20 px-3 py-2 text-sm text-red-200">
          {notice}
        </p>
      )}

      {!result && (
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
              <button
                type="button"
                // Blocked while melds are staged: playing them is a separate action, and
                // discarding first would silently throw the staged lay-down away.
                disabled={busy || !canDiscard || staging.groups.length > 0}
                aria-pressed={discarding}
                onClick={() => setDiscarding((on) => !on)}
                className="rounded border border-white/30 px-4 py-2 font-medium disabled:opacity-40"
              >
                {discarding ? "Cancel discard" : "Discard"}
              </button>
              <span className="text-sm text-white/60">{guidance()}</span>
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
      )}
    </main>
  );

  /** One line saying what the table is waiting for, in the order the rules impose. */
  function guidance(): string {
    if (hints.phase === "draw") return "Draw, or take the pile.";
    if (staging.groups.length > 0) return "Play or take back your melds, then discard.";
    if (obligationOpen) return "Play a card from the pile before you can discard.";
    if (clock.inDiscardGrace) return "Time is up — only a discard will be accepted.";
    if (zone.length === 0) return "No cards left; your turn ends itself.";
    return discarding ? "Pick the card to discard." : "Meld if you like, then discard.";
  }
}
