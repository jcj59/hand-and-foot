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
 * that looks like a mistake (a wild, a rank another player has down and could take
 * the pile with, or a card the player could lay off on a meld they already have) is
 * warned about in the menu itself, whose button then reads "Discard anyway".
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  isBlackThree,
  isWild,
  SPECTATOR_SEAT,
  type Action,
  type Card,
  type MeldPlay,
  type Rank,
  type Reaction,
  type ReactionId,
  type RoomInfo,
  type RoundEnded,
  type ViewUpdate,
} from "@hf/shared";
import { canLayOff, isUnplayable, type PlayContext } from "../cards/handOrder";
import { faceOf } from "../profile/avatarStore";
import { CountPill, DiscardPile, FaceDownPile } from "../cards/PlayingCard";
import { usePhone } from "../usePhone";
import { Hand } from "./Hand";
import { pulseStyle } from "./pulse";
import { CardMenu } from "./CardMenu";
import { discardWarning } from "./discardWarning";
import { MeldsPanel } from "./MeldsPanel";
import type { MeldOrder } from "./meldView";
import { moveLine, withMove } from "./moveLine";
import { ScoresPanel } from "./ScoresPanel";
import { TableHeader } from "./TableHeader";
import { useCardMotion } from "./cardMotion";
import {
  GRABBY_NAME,
  GrabbyAnnouncement,
  GrabbyIcon,
  useGrabbyAnnouncement,
  useUnlockSpeech,
  withGrabbyName,
} from "./grabby";
import { MarvaCelebration, useMarvaCelebration } from "./marva";
import {
  ReactionBubble,
  readMuteReactions,
  useReactionBubbles,
  writeMuteReactions,
} from "./reactions";
import { useMoveNews } from "./moveNews";
import { useTableSounds } from "./sounds";
import { useTurnAttention } from "./turnAttention";
import { PauseBar } from "./PauseBar";
import { RulesDialog } from "../rules/HowToPlay";
import { AwardsCelebration, useAwardsCelebration } from "./awards";
import { OpponentStrip } from "./OpponentStrip";
import { Seats } from "./Seats";
import { RoundResult } from "./RoundResult";
import { StagingPanel } from "./StagingPanel";
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
} from "./staging";

/**
 * What a seated player can do at the table. Absent when the table is only being
 * watched — a replay, or the scenario player — in which case nothing on it can be
 * clicked and it shows the watched seat's view as that seat would see it.
 */
const NO_REACTIONS: readonly Reaction[] = [];

export interface TableControls {
  /** Submit a move; resolves whether it was accepted. */
  play(action: Action): Promise<boolean>;
  /** The lay-down being built, mirrored to the server for a timeout to play. */
  stageDraft(melds: readonly MeldPlay[]): void;
  pause(paused: boolean): Promise<unknown>;
  saveForLater(): Promise<unknown>;
  /** Send a quick reaction to everyone at the table. */
  react(id: ReactionId): void;
  leave(): void;
  playAgain(): void;
  /** Deal the same table again at once, as the host, once the match is over. */
  rematch(): void;
  nextRound(): void;
  /** Carry on without a player who has gone, between rounds. The host's to offer. */
  removePlayer(seat: number): void;
}

export interface TableViewProps {
  readonly update: ViewUpdate;
  /** The room as last heard, which can be fresher than the one inside `update`. */
  readonly room: RoomInfo;
  readonly result: RoundEnded | null;
  readonly notice: string | null;
  /** Null when watching: no moves, no clock, and the seat named instead of "your". */
  readonly controls: TableControls | null;
  readonly onMainMenu: () => void;
  /**
   * This update was reached by a jump rather than a move being played — a seek in
   * a replay — so it says nothing: no sounds and no announcements. Card movement
   * and move news already need a `lastMove`, which a jump does not carry.
   */
  readonly quiet?: boolean;
  /** Replaces "Table <code>" at the top. */
  readonly heading?: string;
  /** Quick reactions heard at the table, most recent last. */
  readonly reactions?: readonly Reaction[];
}

/**
 * The table itself, for whoever drives it: the seated player's live view, or a
 * replay. It renders one `ViewUpdate` and asks `controls` to act; it knows nothing
 * about sockets or where updates come from.
 */
export function TableView({
  update,
  room: latestRoom,
  result,
  notice,
  controls,
  onMainMenu,
  quiet = false,
  heading,
  reactions = NO_REACTIONS,
}: TableViewProps): React.ReactElement {
  const [staging, setStaging] = useState<Staging>(EMPTY_STAGING);
  // Meld mode: clicks in the hand add to the lay-down instead of opening a menu.
  const [melding, setMelding] = useState(false);
  // The card whose menu is open, and whether its discard is awaiting a second yes.
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const phone = usePhone();

  const turnOpen =
    controls !== null && update.hints.seatToAct === update.view.seat && result === null;
  useEffect(() => {
    if (!turnOpen) {
      setChosenId(null);
      setStaging(EMPTY_STAGING);
      setMelding(false);
    }
  }, [turnOpen]);

  // Keep the server's copy of the lay-down current while melding is open, so a
  // clock that runs out plays it. Sent only from the play phase: the server refuses
  // a draft at any other time.
  const draftOpen = turnOpen && update.hints.phase === "play" && !update.clock.inDiscardGrace;
  useEffect(() => {
    if (draftOpen) controls?.stageDraft(toMeldPlays(staging));
  }, [draftOpen, staging, controls]);

  // The discard pile's glow starts when it becomes takeable, so its phase is set
  // then, to agree with the stock's and the labels'. Worked out before the early
  // return below, as a hook has to be.
  const takeable = turnOpen && update.hints.canTakePile && !busy;
  const pilePulse = useMemo(() => (takeable ? pulseStyle() : undefined), [takeable]);

  // Other players' discards and pickups announced, and this player's draw marked.
  // Real names, for saying who took the Grabby Pants title from whom.
  const realRoom = latestRoom;
  // Everywhere else at the table, the title holder is Grabby Pants.
  const newsRoom = withGrabbyName(realRoom);
  const { drawnId } = useMoveNews(
    update.lastMove,
    update.view.seat,
    (s) => newsRoom.players.find((p) => p.seat === s)?.name ?? `Seat ${s}`,
    turnOpen,
  );
  // On a phone the player's own melds are cards, as on the desktop, unless they
  // choose chips to save room; the choice is remembered on this device.
  const [compactMelds, setCompactMelds] = useState(() => readFlag(COMPACT_MELDS_KEY));
  // The last few moves, for the side panel and the phone's scores sheet: kept
  // from the moves this page has seen, each once.
  const [moves, setMoves] = useState<readonly { readonly seq: number; readonly text: string }[]>(
    [],
  );
  const lastMove = update.lastMove;
  const lastLine = lastMove
    ? moveLine(
        lastMove,
        newsRoom.players.find((p) => p.seat === lastMove.seat)?.name ?? `Seat ${lastMove.seat}`,
        lastMove.seat === update.view.seat && controls !== null,
      )
    : null;
  const lastSeq = lastMove?.seq ?? null;
  useEffect(() => {
    if (lastSeq !== null && lastLine !== null)
      setMoves((list) => withMove(list, lastSeq, lastLine));
  }, [lastSeq, lastLine]);
  // How melds are sorted, the player's own and everyone else's alike.
  const [meldOrder, setMeldOrder] = useState<MeldOrder>(() =>
    readChoice<MeldOrder>(MELD_ORDER_KEY, ["rank", "newest"], "rank"),
  );
  const [rulesOpen, setRulesOpen] = useState(false);

  // One card sound for every move, a chime when it is this player's turn, and
  // a phrase when a round or the match ends.
  const moment = {
    moveSeq: update.lastMove?.seq ?? null,
    moveKind: update.lastMove?.kind ?? null,
    myTurn: turnOpen,
    result,
  };
  const { muted, setMuted, blocked, playSound } = useTableSounds(moment, quiet);
  // The tab flashes, and optionally a notification goes up, for the turn the chime
  // marks — the same flag, so the two can never disagree about whose turn it is.
  const { notify, toggleNotify } = useTurnAttention(
    moment.myTurn,
    heading ?? `Table ${latestRoom.roomId}`,
    muted,
  );
  const grabbyHeadline = useGrabbyAnnouncement(realRoom, muted, quiet);
  const [muteReactions, setMuteReactions] = useState(readMuteReactions);
  const bubbles = useReactionBubbles(reactions, update.view.seat, muteReactions, (r) => {
    if (r.seat !== update.view.seat) playSound("reaction");
  });
  // Real names: the celebration is about the player, not their title.
  const marva = useMarvaCelebration(
    update.lastMove,
    (s) => realRoom.players.find((p) => p.seat === s)?.name ?? `Seat ${s}`,
    muted,
    quiet,
    () => playSound("airhorn"),
  );
  useUnlockSpeech();

  // Cards slide from where they were to where the latest move put them.
  const tableRef = useRef<HTMLElement>(null);
  useCardMotion(tableRef, update.lastMove, update.view.seat);

  const liveZone = update.view.inFoot ? update.view.foot : update.view.hand;
  useEffect(() => {
    if (liveZone) setStaging((current) => retainCards(current, liveZone));
  }, [liveZone]);

  const { view, hints, clock } = update;
  const room = withGrabbyName(latestRoom);
  const grabby = room.grabbyPants?.seat === view.seat;
  const myTurn = turnOpen;
  // The foot is revealed only once picked up; before that the server sends a count
  // and no cards, so there is nothing to show but a back.
  const zone = view.inFoot ? (view.foot ?? []) : view.hand;
  const owed = new Set(view.pickedUp);
  const obligationOpen = view.pickedUp.length > 0;
  const nameOf = (s: number): string => room.players.find((p) => p.seat === s)?.name ?? `Seat ${s}`;
  const awardsShown = useAwardsCelebration(result, quiet);
  // Watching, the seat on view is someone's rather than the viewer's own — by their
  // own name, since the Grabby Pants badge already says who holds the title.
  // Watching the table without a seat: nobody's hand is ours to show.
  const spectating = view.seat === SPECTATOR_SEAT;
  const me = realRoom.players.find((p) => p.seat === view.seat);
  const watched = me?.name ?? `Seat ${view.seat}`;
  const whose = controls ? "Your" : `${watched}'s`;

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

  async function send(action: Action, after?: () => void): Promise<void> {
    if (!controls) return;
    setBusy(true);
    try {
      if (await controls.play(action)) after?.();
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
  // Played this turn, and so still the player's to take back until they discard.
  const provisional = new Set(myTurn ? view.playedThisTurn : []);
  const meldRanks = new Set<Rank>(view.melds.map((meld) => meld.rank));
  const playContext: PlayContext = {
    inFoot: view.inFoot,
    blackThreesHeld: zone.filter(isBlackThree).length,
    wildsHeld: zone.filter((card) => isWild(card.rank)).length,
    hasBlackThreeMeld: meldRanks.has("3"),
  };
  const outOfPlay = (card: Card): boolean => isUnplayable(card, playContext);
  const building = canMeld && (melding || stagedCount(staging) > 0);

  /**
   * Cards that can go straight onto a meld already down: naturals of a melded rank,
   * never wilds — where a wild goes is a choice, and this is the button for not
   * having to make choices.
   */
  const layOffs = (() => {
    if (!canMeld || !view.isDown) return [];
    const fits = zone.filter(
      (card) => canLayOff(card, meldRanks, playContext) && !staged.has(card.id),
    );
    return fits;
  })();

  /**
   * Take back this turn's melds, and put the same cards straight back into the
   * lay-down being built, grouped as they were played — so moving a wild is two
   * taps and a replay, not rebuilding the lay-down from nothing.
   */
  function takeBack(): void {
    let restaged = EMPTY_STAGING;
    for (const meld of view.melds) {
      const played = meld.cards.filter((card) => provisional.has(card.id));
      if (played.length === 0) continue;
      restaged = focusGroup(restaged, meld.rank);
      for (const card of played) restaged = stageCard(restaged, card);
    }
    void send({ type: "takeBack" }, () => {
      closeMenu();
      setStaging(restaged);
      setMelding(true);
    });
  }

  function layOffAll(): void {
    const byRank = new Map<Rank, string[]>();
    for (const card of layOffs) byRank.set(card.rank, [...(byRank.get(card.rank) ?? []), card.id]);
    void send({
      type: "playMelds",
      melds: [...byRank].map(([rank, cardIds]) => ({ rank, cardIds })),
    });
  }

  function closeMenu(): void {
    setChosenId(null);
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
      else if (!outOfPlay(card)) setStaging((current) => stageCard(current, card));
      return;
    }
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
  function warningFor(card: Card): string | null {
    return discardWarning(card, {
      canLayOff: canLayOff(card, meldRanks, playContext),
      others: view.opponents
        .filter((o) => o.isDown)
        .map((o) => ({ name: nameOf(o.seat), ranks: new Set(o.melds.map((m) => m.rank)) })),
    });
  }

  const chosen = zone.find((card) => card.id === chosenId) ?? null;
  const menu = chosen && (
    <CardMenu
      card={chosen}
      staged={staged.has(chosen.id)}
      canMeld={canMeld && !outOfPlay(chosen)}
      // A natural of a rank already down goes straight onto that meld: one click,
      // not a lay-down to build and commit.
      layOffTo={
        canMeld && view.isDown && canLayOff(chosen, meldRanks, playContext) ? chosen.rank : null
      }
      // A wild has no rank of its own: it goes to the selected meld, named here so
      // the player sees where before it lands.
      wildTarget={isWild(chosen.rank) ? staging.focusedRank : null}
      canDiscard={canDiscard}
      // Discarding would silently throw the staged lay-down away, so the melds have
      // to be played or taken back first.
      discardBlocked={stagedCount(staging) > 0}
      warning={warningFor(chosen)}
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
      onDiscard={() => discard(chosen)}
      onCancel={closeMenu}
    />
  );

  const canDraw = myTurn && hints.canDraw && !busy;
  // Whether the pile can be taken is decided by a solver over the whole state, so
  // this is the server's answer, not a guess made here.
  const canTake = myTurn && hints.canTakePile && !busy;

  const lastLap = view.finalLapRemaining !== null && view.wentOutSeat !== null;

  const minimum = room.config.layDownMinimums[view.roundNumber - 1];
  const getDown = minimum === undefined ? "No minimum this round" : `${minimum} to get down`;
  const roundWords = `Round ${view.roundNumber} of ${room.config.rounds}`;
  const status = spectating
    ? "watching"
    : !view.isDown
      ? controls
        ? "you are not down yet"
        : `${watched} is not down yet`
      : null;
  const watchers = room.watching !== undefined ? `${room.watching} watching` : null;
  const title = heading ?? roundWords;
  const sub = [heading ? roundWords : null, getDown, status, watchers]
    .filter((part): part is string => part !== null)
    .join(" · ");

  const scores = (titled: boolean): React.ReactElement => (
    <ScoresPanel
      titled={titled}
      room={room}
      totals={view.scoresSoFar}
      mySeat={controls ? view.seat : SPECTATOR_SEAT}
      departed={view.departed ?? []}
      moves={moves}
    />
  );

  const header = (
    <TableHeader
      title={title}
      sub={sub}
      // The header's clock is the player's own; another player's runs on their seat.
      clock={!result && controls && (myTurn || clock.paused) ? clock : null}
      onReact={controls ? controls.react : null}
      muteReactions={muteReactions}
      onMuteReactions={(on) => {
        setMuteReactions(on);
        writeMuteReactions(on);
      }}
      sound={{
        muted,
        blocked,
        // A tap that only let the browser start sound should not also mute it.
        onToggle: () => {
          if (muted || !blocked) setMuted(!muted);
        },
      }}
      notify={notify}
      onToggleNotify={toggleNotify}
      onPause={
        controls && !result && room.config.pauseEnabled && !clock.paused
          ? () => {
              setBusy(true);
              void controls.pause(true).finally(() => setBusy(false));
            }
          : null
      }
      busy={busy}
      onRules={() => setRulesOpen(true)}
      onMainMenu={onMainMenu}
      scores={scores}
    />
  );

  const latest = update.lastMove && (
    <p
      aria-label="Latest move"
      className="m-0 self-center rounded-full bg-black/28 px-3 py-1.5 text-xs text-[#E6EBEF] md:px-3.5 md:text-[13px]"
    >
      {lastLine}
    </p>
  );

  const piles = (
    <section
      aria-label="Piles"
      className={`flex items-end justify-center ${phone ? "gap-[26px]" : "gap-14"}`}
    >
      <div className="flex flex-col items-center gap-1" data-anchor="stock">
        <FaceDownPile
          count={view.stockCount}
          label="Stock"
          pill="Stock"
          size={phone ? "normal" : "large"}
          onClick={canDraw ? () => void send({ type: "draw" }) : undefined}
          actionLabel="Draw a card"
        />
      </div>
      <div className="flex flex-col items-center gap-1" data-anchor="discard" data-zone="pile">
        {canTake ? (
          <button
            type="button"
            aria-label={`Take the pile (${view.discard.length} cards)`}
            onClick={() => void send({ type: "takePile" })}
            style={pilePulse}
            className="pile-prompt rounded-xl p-1 transition hover:bg-white/5"
          >
            <DiscardPile cards={view.discard} size={phone ? "normal" : "large"} />
          </button>
        ) : (
          <div className="p-1">
            <DiscardPile cards={view.discard} size={phone ? "normal" : "large"} />
          </div>
        )}
        <CountPill label="Pile" count={view.discard.length} />
      </div>
    </section>
  );

  const staging_ = building && (
    <StagingPanel
      staging={staging}
      preview={preview}
      zone={zone}
      isDown={view.isDown}
      onUnstage={(id) => setStaging((current) => unstageCard(current, id))}
      onFocus={(rank) => setStaging((current) => focusGroup(current, rank))}
    />
  );

  const meldsPanel = !spectating && (
    <MeldsPanel
      title={`${whose} melds`}
      melds={view.melds}
      config={room.config}
      order={meldOrder}
      onOrder={(order) => {
        setMeldOrder(order);
        writeChoice(MELD_ORDER_KEY, order);
      }}
      collapsed={compactMelds}
      onCollapsed={(on) => {
        setCompactMelds(on);
        writeFlag(COMPACT_MELDS_KEY, on);
      }}
      empty={
        view.isDown || minimum === undefined
          ? "Nothing down yet."
          : `Nothing down yet. ${controls ? "You need" : `${watched} needs`} ${minimum} to get down this round.`
      }
      inFoot={view.inFoot}
      // Clicking a meld on the table aims the next cards at it: the only way to
      // add a wild to a meld already down.
      onSelect={canMeld ? (rank) => setStaging((current) => focusGroup(current, rank)) : undefined}
      selectedRank={canMeld ? staging.focusedRank : null}
      provisionalIds={provisional}
    />
  );

  const banners = (
    <>
      {lastLap && !result && (
        // Loud on purpose: a player who misses this plays their last turn as if the
        // round went on.
        <p
          role="status"
          className={`${BANNER} border-gold/50 bg-gold/12 font-semibold text-[#F7E3B0]`}
        >
          {nameOf(view.wentOutSeat!)} went out!{" "}
          {myTurn ? "This is your last turn." : "Everyone else gets one last turn."}
        </p>
      )}
      {obligationOpen && myTurn && (
        <p role="status" className={`${BANNER} border-blue/50 bg-blue/14 text-[#D6E5F7]`}>
          You took the pile. Play at least one of the ringed cards before discarding.
        </p>
      )}
      {hints.canGoOut && myTurn && (
        <p role="status" className={`${BANNER} border-accent/45 bg-accent/12 text-[#C9F5DF]`}>
          You have the books to go out. Shed your last card to end the round.
        </p>
      )}
    </>
  );

  const actionBar = !result && (
    <section className="flex flex-wrap items-center gap-1.5 md:gap-2" aria-label="Your turn">
      {phone && <span className="flex-[1_1_100%] text-[13px] text-nav-ink">{guidanceLine()}</span>}
      {myTurn && (
        <>
          {canMeld && (
            <button
              type="button"
              aria-pressed={building}
              onClick={() => (building ? stopBuilding() : setMelding(true))}
              className={
                building
                  ? `${ACTION} bg-gold text-[#2A1E00]`
                  : `${ACTION} border border-white/20 text-ink hover:bg-white/5`
              }
            >
              {building ? "Stop melding" : "Meld"}
            </button>
          )}
          {building && (
            // Right above the cards being chosen, so committing is where the
            // player is already looking.
            <button
              type="button"
              disabled={busy || !preview.ok || stagedCount(staging) === 0}
              onClick={() =>
                void send({ type: "playMelds", melds: toMeldPlays(staging) }, stopBuilding)
              }
              className={`${ACTION} bg-accent text-accent-ink`}
            >
              Play melds
            </button>
          )}
          {provisional.size > 0 && (
            // Nothing played this turn is final until the discard: this puts
            // it all back in the builder, to change and play again.
            <button
              type="button"
              disabled={busy}
              onClick={takeBack}
              className={`${ACTION} border border-blue/60 bg-blue/8 text-[#CFE0F5]`}
            >
              Take back melds
            </button>
          )}
          {layOffs.length > 0 && !building && (
            <button
              type="button"
              disabled={busy}
              onClick={layOffAll}
              className={`${ACTION} border border-accent/60 bg-accent/8 text-[#BDF5DA]`}
            >
              Add {layOffs.length} to my melds
            </button>
          )}
        </>
      )}
      {!phone && <span className="text-sm text-nav-ink">{guidanceLine()}</span>}
    </section>
  );

  const hand = spectating ? (
    <p className="m-0 text-sm text-muted">
      Watching. Every player&rsquo;s cards stay hidden; only what is on the table is shown.
    </p>
  ) : (
    <div className={`flex items-end ${phone ? "gap-2.5" : "gap-6"}`}>
      <div className="relative min-w-0 flex-1">
        {bubbles.get(view.seat) && (
          <ReactionBubble
            reaction={bubbles.get(view.seat)!}
            name={watched}
            avatar={me && faceOf(me)}
          />
        )}
        <Hand
          cards={zone}
          interactive={canMeld || canDiscard}
          stagedIds={staged}
          owedIds={owed}
          meldRanks={meldRanks}
          playContext={playContext}
          onSelect={onCardSelect}
          chosenId={chosenId}
          menu={menu}
          onDismiss={closeMenu}
          title={`${whose} ${view.inFoot ? "foot" : "hand"}${grabby ? ` (${GRABBY_NAME})` : ""}`}
          badge={grabby && <GrabbyIcon className="h-5 w-5" />}
          rows={phone}
          newId={drawnId}
        />
      </div>
      {/* The foot waits beside the hand it will replace. */}
      {!view.inFoot && (
        <div className="flex shrink-0 flex-col items-center gap-1">
          <span className="text-[11px] text-muted md:text-xs">
            {phone ? "Foot" : `${whose} foot`}
          </span>
          <FaceDownPile
            count={view.footCount}
            label={`${whose} foot`}
            size={phone ? "small" : "normal"}
          />
        </div>
      )}
    </div>
  );

  const pause = (
    <PauseBar
      room={room}
      nameOf={nameOf}
      busy={busy}
      onResume={() => {
        setBusy(true);
        void controls?.pause(false).finally(() => setBusy(false));
      }}
      onSaveForLater={() => {
        setBusy(true);
        void controls?.saveForLater().finally(() => setBusy(false));
      }}
    />
  );

  const alert = notice && (
    <p
      role="alert"
      className="m-0 shrink-0 rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger-soft"
    >
      {notice}
    </p>
  );

  return (
    <main ref={tableRef} className="flex h-full flex-col overflow-hidden bg-page text-ink">
      {header}
      {pause}
      {phone ? (
        <>
          <OpponentStrip
            opponents={view.opponents}
            room={room}
            // Once the round is over nobody is playing, whatever seat the update names.
            seatToAct={result ? -1 : hints.seatToAct}
            clock={clock}
            order={meldOrder}
            reactions={bubbles}
          />
          <section
            aria-label="Table"
            className="mx-3 mt-2 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto rounded-[22px] px-2.5 pt-3.5 pb-2.5"
            style={{ background: FELT }}
          >
            {banners}
            {piles}
            {latest}
            {staging_}
            {meldsPanel}
          </section>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 gap-5 px-6 py-4">
          <section
            aria-label="Table"
            className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto rounded-[26px] p-[26px]"
            style={{
              background: FELT_CENTER,
              boxShadow: "inset 0 0 0 10px #3A2A1C, inset 0 0 0 12px #5A4330",
            }}
          >
            <Seats
              opponents={view.opponents}
              room={room}
              realRoom={realRoom}
              // Once the round is over nobody is playing, whatever seat the update names.
              seatToAct={result ? -1 : hints.seatToAct}
              clock={clock}
              order={meldOrder}
              reactions={bubbles}
            />
            {banners}
            <div className="flex flex-col items-center gap-2.5 py-1.5">
              {piles}
              {latest}
            </div>
            {staging_}
            {meldsPanel}
          </section>
          <aside aria-label="Scores and moves" className="w-[260px] shrink-0 overflow-y-auto">
            {scores(false)}
          </aside>
        </div>
      )}

      <footer
        className={`mt-2 flex shrink-0 flex-col border-t border-white/7 bg-nav ${
          phone
            ? "max-h-[46dvh] gap-2 overflow-y-auto px-3 pt-2.5 pb-[calc(1.1rem+env(safe-area-inset-bottom,0px))]"
            : "gap-2.5 px-6 pt-3.5 pb-5"
        }`}
      >
        {alert}
        {actionBar}
        {hand}
      </footer>

      {rulesOpen && <RulesDialog config={room.config} onClose={() => setRulesOpen(false)} />}
      {grabbyHeadline && <GrabbyAnnouncement headline={grabbyHeadline} />}
      {marva && <MarvaCelebration news={marva} />}
      {awardsShown && <AwardsCelebration shown={awardsShown} nameOf={nameOf} />}

      {result && (
        <RoundResult
          result={result}
          room={room}
          config={room.config}
          actions={
            controls && {
              onLeave: controls.leave,
              onPlayAgain: controls.playAgain,
              onRematch: controls.rematch,
              onNextRound: controls.nextRound,
              onRemovePlayer: controls.removePlayer,
              onSaveForLater: () => void controls.saveForLater(),
            }
          }
          notice={notice}
          seat={controls ? view.seat : SPECTATOR_SEAT}
        />
      )}
    </main>
  );

  /** One line saying what the table is waiting for, in the order the rules impose. */
  function guidanceLine(): string {
    if (!controls) return `${nameOf(hints.seatToAct)} to play.`;
    if (!myTurn) {
      if (clock.paused) return "The table is paused.";
      return `Waiting for ${nameOf(hints.seatToAct)}.`;
    }
    return guidance();
  }

  function guidance(): string {
    const click = phone ? "Tap" : "Click";
    if (hints.phase === "draw") return `${click} the stock to draw, or the pile to take it.`;
    if (building) return `${click} cards to add them, or a meld to aim wilds at it.`;
    if (stagedCount(staging) > 0) return "Play or take back your melds, then discard.";
    if (obligationOpen) return "Play a card from the pile before you can discard.";
    if (clock.inDiscardGrace) return "Time is up. Only a discard will be accepted.";
    if (zone.length === 0) return "No cards left; your turn ends itself.";
    return `${click} a card to meld or discard it.`;
  }
}

const COMPACT_MELDS_KEY = "hf.compactMelds";
const MELD_ORDER_KEY = "hf.meldOrder";

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    window.localStorage.setItem(key, on ? "1" : "0");
  } catch {
    // Blocked storage: the choice lasts until the page is reloaded.
  }
}

/** A choice kept on this device, such as how melds are sorted. */
function readChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeChoice(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Blocked storage: the choice lasts until the page is reloaded.
  }
}

/** The felt, lit from above the piles, as the design paints it. */
const FELT = "radial-gradient(ellipse at 50% 30%, #2C6B53, #1A4535 70%, #143629)";
const FELT_CENTER = "radial-gradient(ellipse at 50% 35%, #2C6B53, #1A4535 70%, #143629)";

/** A message on the felt: the last lap, a debt to the pile, the books to go out. */
const BANNER = "m-0 rounded-2xl border px-3 py-2.5 text-center text-[13px] leading-snug";

/** The buttons by the hand, as the design sizes them. */
const ACTION =
  "inline-flex min-h-10 items-center justify-center rounded-xl px-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 md:min-h-12 md:px-[18px] md:text-[15px]";
