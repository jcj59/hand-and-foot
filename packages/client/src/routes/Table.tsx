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
import { pauseTable, play, stageDraft } from "../actions";
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
  const [staging, setStaging] = useState<Staging>(EMPTY_STAGING);
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

  const { view, room, hints, clock } = update;
  const myTurn = turnOpen;
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

  // Melding is closed during the discard-only grace, so staging then would only build
  // something the server is certain to refuse.
  const canMeld = myTurn && hints.phase === "play" && !clock.inDiscardGrace;
  // The discard ends the play phase rather than being a phase of its own. What makes
  // it available is the play phase with the take-pile obligation settled.
  const canDiscard = myTurn && hints.phase === "play" && !obligationOpen && zone.length > 0;
  const staged = stagedIds(staging);
  const meldRanks = new Set<Rank>(view.melds.map((meld) => meld.rank));

  function closeMenu(): void {
    setChosenId(null);
    setConfirming(false);
  }

  function onCardSelect(card: Card): void {
    if (busy) return;
    // Once a lay-down is being built, a click adds a card to it or takes it back:
    // the player has already said they are melding, and asking again for every
    // card would be a menu per card. A red three can never join a meld, so it does
    // nothing here.
    if (canMeld && stagedCount(staging) > 0) {
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
    closeMenu();
  }

  function discard(card: Card): void {
    // The discard ends the turn, so it goes straight off rather than being staged.
    void send({ type: "discard", cardId: card.id }, () => {
      closeMenu();
      setStaging(EMPTY_STAGING);
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

      {result && <RoundResult result={result} room={room} config={room.config} />}

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
        <Melds
          melds={view.melds}
          config={room.config}
          // Clicking a meld on the table aims the next cards at it — the only way to
          // add a wild to a meld already down.
          onSelect={
            canMeld ? (rank) => setStaging((current) => focusGroup(current, rank)) : undefined
          }
          selectedRank={canMeld ? staging.focusedRank : null}
        />
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
        interactive={canMeld || canDiscard}
        stagedIds={staged}
        owedIds={owed}
        meldRanks={meldRanks}
        onSelect={onCardSelect}
        chosenId={chosenId}
        menu={menu}
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
  readonly wildTarget: Rank | null;
  readonly canDiscard: boolean;
  readonly discardBlocked: boolean;
  /** Set once a risky discard has been asked for, to ask again. */
  readonly warning: string | null;
  readonly busy: boolean;
  readonly onMeld: () => void;
  readonly onUnstage: () => void;
  readonly onDiscard: () => void;
  readonly onCancel: () => void;
}

/** What one card can do right now, offered under the card that was clicked. */
function CardMenu({
  card,
  staged,
  canMeld,
  wildTarget,
  canDiscard,
  discardBlocked,
  warning,
  busy,
  onMeld,
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
