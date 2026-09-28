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
 * and a player has to be able to watch the total before committing to it. The
 * staged lay-down is also sent to the server as it changes, so that if the turn
 * clock runs out the server plays it rather than it being lost.
 *
 * Clicking a card opens a menu of what it can do right now — meld it, discard it,
 * take it back — rather than one click meaning different things by mode. A discard
 * that looks like a mistake (a wild, or a card the player could lay off on a meld
 * they already have) asks once more before it goes.
 */
import { useEffect, useState } from "react";
import { isWild, type Card, type Rank } from "@hf/shared";
import { useNavigate } from "react-router-dom";
import { askToPlayAgain, leaveTable, pauseTable, play, stageDraft } from "../actions";
import { isDeadWeight } from "../cards/handOrder";
import { FaceDownPile, PlayingCard } from "../cards/PlayingCard";
import { useSession } from "../session";
import type { HfClientSocket } from "../socket";
import { Hand } from "../table/Hand";
import { Melds } from "../table/Melds";
import { Seats } from "../table/Seats";
import { RoundResult } from "../table/RoundResult";
import { StagingPanel } from "../table/StagingPanel";
import { TurnClock } from "../table/TurnClock";
import {
  EMPTY_STAGING,
  focusGroup,
  previewLayDown,
  retainCards,
  stageCard,
  stagedCount,
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
  // The room on its own, not only as it came with the last view: who is connected,
  // and who has asked to play again, arrive as room broadcasts with no new view.
  const latestRoom = useSession((s) => s.room);
  const leave = useSession((s) => s.leave);
  const navigate = useNavigate();
  const [staging, setStaging] = useState<Staging>(EMPTY_STAGING);
  // Meld mode: clicks in the hand add to the lay-down instead of opening a menu.
  const [melding, setMelding] = useState(false);
  // The card whose menu is open, and whether its discard is awaiting a second yes.
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const turnOpen =
    update !== null && update.hints.seatToAct === update.view.seat && result === null;
  useEffect(() => {
    if (!turnOpen) {
      setChosenId(null);
      setConfirming(false);
      setStaging(EMPTY_STAGING);
      setMelding(false);
    }
  }, [turnOpen]);

  // Keep the server's copy of the lay-down current while melding is open, so a
  // clock that runs out plays it. Sent only from the play phase: the server refuses
  // a draft at any other time.
  const draftOpen = turnOpen && update.hints.phase === "play" && !update.clock.inDiscardGrace;
  useEffect(() => {
    if (draftOpen) void stageDraft(socket, toMeldPlays(staging));
  }, [draftOpen, staging, socket]);

  const liveZone = update && (update.view.inFoot ? update.view.foot : update.view.hand);
  useEffect(() => {
    if (liveZone) setStaging((current) => retainCards(current, liveZone));
  }, [liveZone]);

  // Between the deal being ordered and the first view arriving there is nothing to
  // draw. Normal, not a fault.
  if (!update) {
    return <main className="p-6 text-white/60">Dealing&hellip;</main>;
  }

  const { view, hints, clock } = update;
  const room = latestRoom ?? update.room;
  const myTurn = turnOpen;
  const sink = { seat, setNotice };
  // The foot is revealed only once picked up; before that the server sends a count
  // and no cards, so there is nothing to show but a back.
  const zone = view.inFoot ? (view.foot ?? []) : view.hand;
  const owed = new Set(view.pickedUp);
  const obligationOpen = view.pickedUp.length > 0;
  const nameOf = (s: number): string => room.players.find((p) => p.seat === s)?.name ?? `Seat ${s}`;

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

  // Melding is closed during the discard-only grace, so staging then would only build
  // something the server is certain to refuse.
  const canMeld = myTurn && hints.phase === "play" && !clock.inDiscardGrace;
  // The discard ends the play phase rather than being a phase of its own. What makes
  // it available is the play phase with the take-pile obligation settled.
  const canDiscard = myTurn && hints.phase === "play" && !obligationOpen && zone.length > 0;
  const staged = stagedIds(staging);
  const meldRanks = new Set<Rank>(view.melds.map((meld) => meld.rank));
  const building = canMeld && (melding || stagedCount(staging) > 0);

  /**
   * Cards that can go straight onto a meld already down: naturals of a melded rank,
   * never wilds — where a wild goes is a choice, and this is the button for not
   * having to make choices. In the foot one card is kept back unless the player can
   * go out, so the button cannot shed the last card by accident.
   */
  const layOffs = (() => {
    if (!canMeld || !view.isDown) return [];
    const fits = zone.filter(
      (card) =>
        !isWild(card.rank) &&
        !isDeadWeight(card) &&
        card.rank !== "3" &&
        meldRanks.has(card.rank) &&
        !staged.has(card.id),
    );
    if (view.inFoot && fits.length === zone.length && !hints.canGoOut) return fits.slice(1);
    return fits;
  })();

  function closeMenu(): void {
    setChosenId(null);
    setConfirming(false);
  }

  function stopBuilding(): void {
    setStaging(EMPTY_STAGING);
    setMelding(false);
  }

  function onCardSelect(card: Card): void {
    if (busy) return;
    // In meld mode a click adds a card to the lay-down or takes it back: the player
    // has already said they are melding, and asking again for every card would be a
    // menu per card. A red three can never join a meld, so it does nothing here.
    if (building) {
      closeMenu();
      if (staged.has(card.id)) setStaging((current) => unstageCard(current, card.id));
      else if (!isDeadWeight(card)) setStaging((current) => stageCard(current, card));
      return;
    }
    setConfirming(false);
    setChosenId((current) => (current === card.id ? null : card.id));
  }

  function meld(card: Card): void {
    setStaging((current) => stageCard(current, card));
    setMelding(true);
    closeMenu();
  }

  function discard(card: Card): void {
    // The discard ends the turn, so it goes straight off rather than being staged.
    void send({ type: "discard", cardId: card.id }, () => {
      closeMenu();
      stopBuilding();
    });
  }

  /** Why throwing this card away is probably a mistake, if it is. */
  function discardWarning(card: Card): string | null {
    if (isWild(card.rank)) return "That is a wild card.";
    if (meldRanks.has(card.rank)) return `You have a meld of ${card.rank}s it could go on.`;
    return null;
  }

  const chosen = zone.find((card) => card.id === chosenId) ?? null;
  const menu = chosen && (
    <CardMenu
      card={chosen}
      staged={staged.has(chosen.id)}
      canMeld={canMeld && !isDeadWeight(chosen)}
      // A natural of a rank already down goes straight onto that meld: one click,
      // not a lay-down to build and commit.
      layOffTo={
        canMeld && view.isDown && !isWild(chosen.rank) && meldRanks.has(chosen.rank)
          ? chosen.rank
          : null
      }
      // A wild has no rank of its own: it goes to the selected meld, named here so
      // the player sees where before it lands.
      wildTarget={isWild(chosen.rank) ? staging.focusedRank : null}
      canDiscard={canDiscard}
      // Discarding would silently throw the staged lay-down away, so the melds have
      // to be played or taken back first.
      discardBlocked={stagedCount(staging) > 0}
      warning={confirming ? discardWarning(chosen) : null}
      busy={busy}
      onMeld={() => meld(chosen)}
      onLayOff={() => {
        void send(
          { type: "playMelds", melds: [{ rank: chosen.rank, cardIds: [chosen.id] }] },
          closeMenu,
        );
      }}
      onUnstage={() => {
        setStaging((current) => unstageCard(current, chosen.id));
        closeMenu();
      }}
      onDiscard={() => {
        if (!confirming && discardWarning(chosen)) {
          setConfirming(true);
          return;
        }
        discard(chosen);
      }}
      onCancel={closeMenu}
    />
  );

  const canDraw = myTurn && hints.canDraw && !busy;
  // Whether the pile can be taken is decided by a solver over the whole state, so
  // this is the server's answer, not a guess made here.
  const canTake = myTurn && hints.canTakePile && !busy;
  const top = view.discard[view.discard.length - 1];
  const lastLap = view.finalLapRemaining !== null && view.wentOutSeat !== null;

  return (
    <main className="flex h-full flex-col gap-2 overflow-hidden p-2 sm:p-3">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-lg font-semibold">Table {room.roomId}</h1>
          <p className="text-sm text-white/60">
            Round {view.roundNumber} · minimum{" "}
            {room.config.layDownMinimums[view.roundNumber - 1] ?? "—"}
            {view.isDown ? " · you are down" : " · not down"}
          </p>
        </div>
        {/* Once the round is over no turn is live, so there is no clock to show even
            if a deadline still arrives. */}
        {!result && (
          <div className="flex items-center gap-3">
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

      <div className="shrink-0">
        <Seats
          opponents={view.opponents}
          room={room}
          config={room.config}
          seatToAct={hints.seatToAct}
        />
      </div>

      {lastLap && !result && (
        // Loud on purpose: a player who misses this plays their last turn as if the
        // round went on.
        <p
          role="status"
          className="shrink-0 rounded border border-amber-300 bg-amber-300/20 px-3 py-2 text-center font-semibold text-amber-100"
        >
          {nameOf(view.wentOutSeat!)} went out!{" "}
          {myTurn ? "This is your last turn." : "Everyone else gets one last turn."}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2 md:flex-row">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          <section className="flex flex-wrap items-end gap-6" aria-label="Piles">
            <div className="flex flex-col items-center gap-1">
              <span className="text-xs text-white/60">Stock</span>
              <FaceDownPile
                count={view.stockCount}
                label="Stock"
                onClick={canDraw ? () => void send({ type: "draw" }) : undefined}
                actionLabel="Draw a card"
              />
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="text-xs text-white/60">Discard ({view.discard.length})</span>
              {!top ? (
                <p className="text-xs text-white/40">empty</p>
              ) : canTake ? (
                <button
                  type="button"
                  aria-label={`Take the pile (${view.discard.length} cards)`}
                  onClick={() => void send({ type: "takePile" })}
                  className="rounded p-1 ring-2 ring-amber-300 transition hover:bg-white/10"
                >
                  <PlayingCard card={top} />
                </button>
              ) : (
                <div className="p-1">
                  <PlayingCard card={top} />
                </div>
              )}
            </div>
          </section>

          {obligationOpen && myTurn && (
            <p role="status" className="rounded bg-sky-500/15 px-3 py-2 text-sm text-sky-100">
              You took the pile. Play at least one of the ringed cards before discarding.
            </p>
          )}

          {hints.canGoOut && myTurn && (
            <p
              role="status"
              className="rounded bg-emerald-500/15 px-3 py-2 text-sm text-emerald-100"
            >
              You have the books to go out — shed your last card to end the round.
            </p>
          )}

          <section className="flex flex-col gap-2" aria-label="Your melds">
            <h2 className="text-sm font-medium text-white/80">Your melds</h2>
            <Melds
              melds={view.melds}
              config={room.config}
              // Clicking a meld on the table aims the next cards at it — the only way
              // to add a wild to a meld already down.
              onSelect={
                canMeld ? (rank) => setStaging((current) => focusGroup(current, rank)) : undefined
              }
              selectedRank={canMeld ? staging.focusedRank : null}
            />
          </section>
        </div>

        {building && (
          // A column beside the table rather than a section inside it, so opening it
          // moves nothing the player is looking at.
          <aside className="max-h-[45%] shrink-0 overflow-y-auto md:max-h-none md:w-80">
            <StagingPanel
              staging={staging}
              preview={preview}
              zone={zone}
              isDown={view.isDown}
              busy={busy}
              onUnstage={(id) => setStaging((current) => unstageCard(current, id))}
              onFocus={(rank) => setStaging((current) => focusGroup(current, rank))}
              onCommit={() =>
                void send({ type: "playMelds", melds: toMeldPlays(staging) }, stopBuilding)
              }
              onClear={stopBuilding}
            />
          </aside>
        )}
      </div>

      {notice && (
        <p role="alert" className="shrink-0 rounded bg-red-600/20 px-3 py-2 text-sm text-red-200">
          {notice}
        </p>
      )}

      <footer className="flex shrink-0 flex-col gap-2 border-t border-white/10 pt-2">
        {!result && (
          <section className="flex flex-wrap items-center gap-2" aria-label="Your turn">
            {myTurn ? (
              <>
                {canMeld && (
                  <button
                    type="button"
                    aria-pressed={building}
                    onClick={() => (building ? stopBuilding() : setMelding(true))}
                    className={`rounded px-3 py-1.5 text-sm font-medium ${
                      building ? "bg-amber-300 text-black" : "border border-white/30"
                    }`}
                  >
                    {building ? "Stop melding" : "Meld"}
                  </button>
                )}
                {layOffs.length > 0 && !building && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const byRank = new Map<Rank, string[]>();
                      for (const card of layOffs) {
                        byRank.set(card.rank, [...(byRank.get(card.rank) ?? []), card.id]);
                      }
                      void send({
                        type: "playMelds",
                        melds: [...byRank].map(([rank, cardIds]) => ({ rank, cardIds })),
                      });
                    }}
                    className="rounded border border-emerald-300/60 px-3 py-1.5 text-sm text-emerald-100 disabled:opacity-40"
                  >
                    Add {layOffs.length} to my melds
                  </button>
                )}
                <span className="text-sm text-white/60">{guidance()}</span>
              </>
            ) : (
              <span className="text-sm text-white/60">Waiting for {nameOf(hints.seatToAct)}.</span>
            )}
          </section>
        )}
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <Hand
              cards={zone}
              interactive={canMeld || canDiscard}
              stagedIds={staged}
              owedIds={owed}
              meldRanks={meldRanks}
              onSelect={onCardSelect}
              chosenId={chosenId}
              menu={menu}
              title={view.inFoot ? "Your foot" : "Your hand"}
            />
          </div>
          {/* The foot waits beside the hand it will replace. */}
          {!view.inFoot && (
            <div className="flex shrink-0 flex-col items-center gap-1">
              <span className="text-xs text-white/60">Your foot</span>
              <FaceDownPile count={view.footCount} label="Your foot" />
            </div>
          )}
        </div>
      </footer>

      {result && (
        <RoundResult
          result={result}
          room={room}
          config={room.config}
          // A real leave, not just forgetting the seat: the server then knows the
          // table is empty and lets it go.
          onLeave={() => void leaveTable(socket, { leave }).then(() => navigate("/"))}
          onPlayAgain={() => void askToPlayAgain(socket, sink)}
          seat={view.seat}
        />
      )}
    </main>
  );

  /** One line saying what the table is waiting for, in the order the rules impose. */
  function guidance(): string {
    if (hints.phase === "draw") return "Click the stock to draw, or the pile to take it.";
    if (building) return "Click cards to add them; click a meld to aim wilds at it.";
    if (stagedCount(staging) > 0) return "Play or take back your melds, then discard.";
    if (obligationOpen) return "Play a card from the pile before you can discard.";
    if (clock.inDiscardGrace) return "Time is up — only a discard will be accepted.";
    if (zone.length === 0) return "No cards left; your turn ends itself.";
    return "Click a card to meld or discard it.";
  }
}

interface CardMenuProps {
  readonly card: Card;
  readonly staged: boolean;
  readonly canMeld: boolean;
  /** A melded rank this natural can go straight onto, or null. */
  readonly layOffTo: Rank | null;
  readonly wildTarget: Rank | null;
  readonly canDiscard: boolean;
  readonly discardBlocked: boolean;
  /** Set once a risky discard has been asked for, to ask again. */
  readonly warning: string | null;
  readonly busy: boolean;
  readonly onMeld: () => void;
  readonly onLayOff: () => void;
  readonly onUnstage: () => void;
  readonly onDiscard: () => void;
  readonly onCancel: () => void;
}

/** What one card can do right now, offered under the card that was clicked. */
function CardMenu({
  card,
  staged,
  canMeld,
  layOffTo,
  wildTarget,
  canDiscard,
  discardBlocked,
  warning,
  busy,
  onMeld,
  onLayOff,
  onUnstage,
  onDiscard,
  onCancel,
}: CardMenuProps): React.ReactElement {
  const wild = isWild(card.rank);
  const item = "rounded px-3 py-1 text-left text-sm whitespace-nowrap disabled:opacity-40";
  if (warning) {
    return (
      <div
        role="dialog"
        aria-label="Confirm discard"
        className="flex w-56 flex-col gap-2 rounded border border-amber-300/50 bg-felt-900 p-2 shadow-lg"
      >
        <p className="text-sm text-amber-100">{warning} Discard it anyway?</p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onDiscard}
            className={`${item} bg-red-600 text-white`}
          >
            Discard anyway
          </button>
          <button type="button" onClick={onCancel} className={`${item} border border-white/25`}>
            Keep it
          </button>
        </div>
      </div>
    );
  }
  return (
    <div
      role="menu"
      aria-label="Card actions"
      className="flex flex-col rounded border border-white/20 bg-felt-900 p-1 shadow-lg"
    >
      {staged ? (
        <button
          type="button"
          role="menuitem"
          onClick={onUnstage}
          className={`${item} hover:bg-white/10`}
        >
          Take back
        </button>
      ) : layOffTo ? (
        <button
          type="button"
          role="menuitem"
          disabled={busy}
          onClick={onLayOff}
          className={`${item} hover:bg-white/10`}
        >
          Add to {layOffTo}s meld
        </button>
      ) : (
        canMeld && (
          <button
            type="button"
            role="menuitem"
            disabled={wild && wildTarget === null}
            onClick={onMeld}
            className={`${item} hover:bg-white/10`}
          >
            {wild ? (wildTarget ? `Add to ${wildTarget}s` : "Select a meld for it first") : "Meld"}
          </button>
        )
      )}
      {canDiscard && !staged && (
        <button
          type="button"
          role="menuitem"
          disabled={busy || discardBlocked}
          title={discardBlocked ? "play or take back your staged melds first" : undefined}
          onClick={onDiscard}
          className={`${item} hover:bg-white/10`}
        >
          Discard
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        onClick={onCancel}
        className={`${item} text-white/60 hover:bg-white/10`}
      >
        Cancel
      </button>
    </div>
  );
}
