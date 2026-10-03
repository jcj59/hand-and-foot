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
import { useEffect, useMemo, useRef, useState } from "react";
import {
  isBlackThree,
  isWild,
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
import { DiscardPile, FaceDownPile, PlayingCard } from "../cards/PlayingCard";
import { usePhone } from "../usePhone";
import { Hand } from "./Hand";
import { pulseStyle } from "./pulse";
import { Melds } from "./Melds";
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
  ReactionPicker,
  readMuteReactions,
  useReactionBubbles,
  writeMuteReactions,
} from "./reactions";
import { useMoveNews } from "./moveNews";
import { useTableSounds } from "./sounds";
import { useTurnAttention } from "./turnAttention";
import { readHints, suggestionFor, writeHints, type Suggestion } from "./hints";
import { PauseBar } from "./PauseBar";
import { RulesDialog } from "../rules/HowToPlay";
import { OpponentStrip } from "./OpponentStrip";
import { Seats } from "./Seats";
import { RoundResult } from "./RoundResult";
import { StagingPanel } from "./StagingPanel";
import { TurnClock } from "./TurnClock";
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
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const phone = usePhone();

  const turnOpen =
    controls !== null && update.hints.seatToAct === update.view.seat && result === null;
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
  const { news, drawnId } = useMoveNews(
    update.lastMove,
    update.view.seat,
    (s) => newsRoom.players.find((p) => p.seat === s)?.name ?? `Seat ${s}`,
    turnOpen,
  );
  // On a phone the player's own melds are cards, as on the desktop, unless they
  // choose chips to save room; the choice is remembered on this device.
  const [compactMelds, setCompactMelds] = useState(() => readFlag(COMPACT_MELDS_KEY));
  // The same, for the other players on a computer: shown in full unless collapsed.
  const [compactSeats, setCompactSeats] = useState(() => readFlag(COMPACT_SEATS_KEY));
  // Hints for a learner: reasons for a move that is not open, and a suggested move.
  const [hintsOn, setHintsOn] = useState(() => readHints(latestRoom.config.mode));
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  // A suggestion is for the position it was asked about: any change and it is gone.
  useEffect(() => setSuggestion(null), [update.view]);
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
  // Watching, the seat on view is someone's rather than the viewer's own — by their
  // own name, since the Grabby Pants badge already says who holds the title.
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
      else if (!outOfPlay(card)) setStaging((current) => stageCard(current, card));
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
    if (canLayOff(card, meldRanks, playContext)) {
      return `You have a meld of ${card.rank}s it could go on.`;
    }
    return null;
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

  const lastLap = view.finalLapRemaining !== null && view.wentOutSeat !== null;

  return (
    <main ref={tableRef} className="flex h-full flex-col gap-2 overflow-hidden p-2 sm:p-3">
      <header
        className={`flex shrink-0 items-center justify-between gap-2 ${phone ? "" : "flex-wrap"}`}
      >
        <div className={`flex min-w-0 flex-wrap items-baseline gap-x-3 ${phone ? "flex-1" : ""}`}>
          {/* On a phone the header is one line: the table's code is in the link,
              and the space is worth more to the cards. */}
          <h1 className={phone ? "sr-only" : "text-lg font-semibold"}>
            {heading ?? `Table ${room.roomId}`}
          </h1>
          {phone ? (
            <p className="truncate text-xs text-white/70">
              Round {view.roundNumber}/{room.config.rounds} · min{" "}
              {room.config.layDownMinimums[view.roundNumber - 1] ?? "—"}
              {view.isDown ? " · down" : " · not down"}
            </p>
          ) : (
            <p className="text-sm text-white/60">
              Round {view.roundNumber} of {room.config.rounds} · minimum{" "}
              {room.config.layDownMinimums[view.roundNumber - 1] ?? "—"}
              {view.isDown
                ? controls
                  ? " · you are down"
                  : ` · ${watched} is down`
                : " · not down"}
            </p>
          )}
          {/* The match so far, once there is one: it is what every later round is
              being played for. */}
          {view.roundNumber > 1 && (
            <p
              aria-label="Scores so far"
              className={phone ? "w-full truncate text-xs text-white/60" : "text-sm text-white/60"}
            >
              Scores:{" "}
              {view.scoresSoFar
                .map((total, seat) => {
                  // A player who has left keeps their total, marked so nobody counts it.
                  const gone = (view.departed ?? []).some((d) => d.seat === seat);
                  return `${nameOf(seat)}${gone ? " (left)" : ""} ${total}`;
                })
                .join(" · ")}
            </p>
          )}
        </div>
        {/* Once the round is over no turn is live, so there is no clock to show even
            if a deadline still arrives. */}
        <div className={`flex shrink-0 items-center ${phone ? "gap-2" : "gap-3"}`}>
          {!result && controls && (
            <div className={`flex items-center ${phone ? "gap-2" : "gap-3"}`}>
              <TurnClock clock={clock} />
              {/* Resuming is the pause bar's, beside what the pause means. */}
              {room.config.pauseEnabled && !clock.paused && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void controls.pause(true).finally(() => setBusy(false));
                  }}
                  aria-label="Pause"
                  className="rounded border border-white/25 px-3 py-1 text-sm disabled:opacity-40"
                >
                  {phone ? (
                    // Drawn, not a glyph: not every phone's font has the pause sign.
                    <svg aria-hidden="true" viewBox="0 0 10 12" className="h-3.5 w-3 fill-current">
                      <rect x="0" y="0" width="3.5" height="12" rx="0.5" />
                      <rect x="6.5" y="0" width="3.5" height="12" rx="0.5" />
                    </svg>
                  ) : (
                    "Pause"
                  )}
                </button>
              )}
            </div>
          )}
          {controls && (
            <ReactionPicker
              onSend={controls.react}
              muted={muteReactions}
              onMutedChange={(on) => {
                setMuteReactions(on);
                writeMuteReactions(on);
              }}
              sheet={phone}
            />
          )}
          {/* Sound on but not allowed yet — the browser waits for a tap after a
              reload, or took it away while the tab was away — says so: any tap
              brings it back, this one included, and without the hint silence
              looks like a broken game. */}
          <button
            type="button"
            aria-label={
              muted ? "Turn sound on" : blocked ? "Tap to let sound play" : "Turn sound off"
            }
            title={!muted && blocked ? "Tap anywhere to let sound play" : undefined}
            aria-pressed={muted}
            onClick={() => {
              // A tap that only let the browser start sound should not also mute it.
              if (muted || !blocked) setMuted(!muted);
            }}
            className={`relative rounded border px-2 py-1 text-sm ${
              !muted && blocked ? "border-amber-300/80 text-amber-200" : "border-white/25"
            }`}
          >
            <SpeakerIcon muted={muted} />
            {!muted && blocked && (
              <span
                aria-hidden="true"
                className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-300 motion-safe:animate-pulse"
              />
            )}
          </button>
          {/* Turn notifications, for a table left in a background tab. Off until
              turned on here, which is the only place permission is asked for; not
              shown where the browser has no notifications, and inert once the
              browser has been told no, since only its own settings can undo that.
              Not offered on a phone either: Chrome on Android refuses a notification
              made by a page, and iOS has them only through web push, so the button
              would promise what never comes — and the header has no room to spare. */}
          {controls && !phone && notify !== "unsupported" && (
            <button
              type="button"
              aria-label={
                notify === "on"
                  ? "Stop notifying me when it's my turn"
                  : notify === "blocked"
                    ? "Turn notifications are blocked by the browser"
                    : "Notify me when it's my turn"
              }
              title={
                notify === "blocked"
                  ? "Notifications are blocked for this site in the browser's settings"
                  : undefined
              }
              aria-pressed={notify === "on"}
              disabled={notify === "blocked"}
              onClick={toggleNotify}
              className={`rounded border px-2 py-1 text-sm disabled:opacity-40 ${
                notify === "on" ? "border-amber-300/80 text-amber-200" : "border-white/25"
              }`}
            >
              <BellIcon on={notify === "on"} />
            </button>
          )}
          {controls && (
            <button
              type="button"
              aria-pressed={hintsOn}
              aria-label={hintsOn ? "Turn hints off" : "Turn hints on"}
              onClick={() => {
                writeHints(!hintsOn);
                setHintsOn(!hintsOn);
                setSuggestion(null);
              }}
              className={`rounded border px-2 py-1 text-sm ${
                hintsOn ? "border-amber-300/80 text-amber-200" : "border-white/25"
              }`}
            >
              Hints
            </button>
          )}
          {/* This table's own rules, over the table: the clock keeps running. */}
          <button
            type="button"
            onClick={() => setRulesOpen(true)}
            aria-label="How to play"
            className="rounded border border-white/25 px-2 py-1 text-sm"
          >
            {phone ? "?" : "Rules"}
          </button>
          {/* Away from the table without giving up the seat: the main screen offers
              the way back. The clock keeps running meanwhile. */}
          <button
            type="button"
            onClick={onMainMenu}
            aria-label="Main menu"
            className="rounded border border-white/25 px-3 py-1 text-sm"
          >
            {phone ? "☰" : "Main menu"}
          </button>
        </div>
      </header>

      {/* Straight under the controls, above everything it holds still: a paused
          table is the first thing to know about it, and below the players it was
          pushed out of sight whenever their boxes were tall. */}
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

      <div className="shrink-0">
        {!phone && (
          // On a computer the other players are shown in full, with their melds;
          // collapsed, they are the phone's strip of chips, a tap from the melds.
          <div className="mb-1.5 flex items-center justify-between px-3 pt-1 text-xs text-white/60">
            <span>Players</span>
            <button
              type="button"
              aria-pressed={compactSeats}
              onClick={() => {
                setCompactSeats(!compactSeats);
                writeFlag(COMPACT_SEATS_KEY, !compactSeats);
              }}
              className="rounded border border-white/20 px-2 py-0.5 text-white/70"
            >
              {compactSeats ? "Show players" : "Collapse players"}
            </button>
          </div>
        )}
        {phone || compactSeats ? (
          <OpponentStrip
            opponents={view.opponents}
            room={room}
            config={room.config}
            seatToAct={hints.seatToAct}
            reactions={bubbles}
          />
        ) : (
          <Seats
            opponents={view.opponents}
            room={room}
            config={room.config}
            seatToAct={hints.seatToAct}
            reactions={bubbles}
          />
        )}
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
          {/* Padded so the glow around a pile that can be taken is never cut off
              by the edge of the scrolling area. */}
          {/* The middle of the table: what everyone watches, so it is big and centred. */}
          <section
            className={`relative mx-auto flex items-end justify-center rounded-[2rem] bg-black/15 ring-1 ring-white/5 ${
              phone ? "gap-8 px-5 py-3" : "gap-12 px-10 py-5"
            }`}
            aria-label="Piles"
          >
            {news && (
              <div
                role="status"
                aria-label="Latest move"
                // Fixed over the table rather than placed in it: the middle scrolls,
                // and news clipped by the edge of a scroll area is news missed.
                className="fixed top-28 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-sky-300/60 bg-felt-900/95 py-1 pr-4 pl-1 text-base whitespace-nowrap text-sky-50 shadow-lg shadow-black/40"
              >
                {news.card && <PlayingCard card={news.card} size="small" />}
                <span className={news.card ? "" : "pl-2"}>{news.text}</span>
              </div>
            )}
            <div className="flex flex-col items-center gap-1" data-anchor="stock">
              <span className="text-xs text-white/60">Stock</span>
              <FaceDownPile
                count={view.stockCount}
                label="Stock"
                size={phone ? "normal" : "large"}
                onClick={canDraw ? () => void send({ type: "draw" }) : undefined}
                actionLabel="Draw a card"
              />
              {canDraw && <PilePrompt>Draw a card</PilePrompt>}
            </div>
            <div
              className="flex flex-col items-center gap-1"
              data-anchor="discard"
              data-zone="pile"
            >
              <span className="text-xs text-white/60">Discard ({view.discard.length})</span>
              {canTake ? (
                <button
                  type="button"
                  aria-label={`Take the pile (${view.discard.length} cards)`}
                  onClick={() => void send({ type: "takePile" })}
                  style={pilePulse}
                  className="pile-prompt rounded p-1 ring-2 ring-amber-300 transition hover:bg-white/10"
                >
                  <DiscardPile cards={view.discard} size={phone ? "normal" : "large"} />
                </button>
              ) : (
                <div className="p-1">
                  <DiscardPile cards={view.discard} size={phone ? "normal" : "large"} />
                </div>
              )}
              {canTake && <PilePrompt>Pick up the pile</PilePrompt>}
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
              You have the books to go out. Shed your last card to end the round.
            </p>
          )}

          <section className="flex flex-col gap-2" aria-label={`${whose} melds`} data-zone="melds">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-medium text-white/80">{whose} melds</h2>
              {phone && view.melds.length > 0 && (
                <button
                  type="button"
                  aria-pressed={compactMelds}
                  onClick={() => {
                    setCompactMelds(!compactMelds);
                    writeFlag(COMPACT_MELDS_KEY, !compactMelds);
                  }}
                  className="rounded border border-white/20 px-2 py-0.5 text-xs text-white/70"
                >
                  {compactMelds ? "Show cards" : "Collapse"}
                </button>
              )}
            </div>
            <Melds
              melds={view.melds}
              config={room.config}
              // Clicking a meld on the table aims the next cards at it — the only way
              // to add a wild to a meld already down.
              onSelect={
                canMeld ? (rank) => setStaging((current) => focusGroup(current, rank)) : undefined
              }
              selectedRank={canMeld ? staging.focusedRank : null}
              chips={phone && compactMelds}
              provisionalIds={provisional}
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

      {/* On a phone the hand may take a little under half the screen and scrolls past
          that, so the middle of the table is never pushed off it. */}
      <footer
        className={`flex shrink-0 flex-col gap-2 border-t border-white/10 pt-2 ${
          phone ? "max-h-[48dvh] overflow-y-auto" : ""
        }`}
      >
        {!result && (
          <section className="flex flex-wrap items-center gap-2" aria-label="Your turn">
            {!controls ? (
              <span className="text-sm text-white/60">{nameOf(hints.seatToAct)} to play.</span>
            ) : myTurn ? (
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
                {building && (
                  // Right above the cards being chosen, so committing is where the
                  // player is already looking.
                  <button
                    type="button"
                    disabled={busy || !preview.ok || stagedCount(staging) === 0}
                    onClick={() =>
                      void send({ type: "playMelds", melds: toMeldPlays(staging) }, stopBuilding)
                    }
                    className="rounded bg-white px-3 py-1.5 text-sm font-medium text-felt-900 disabled:opacity-40"
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
                    className="rounded border border-sky-300/60 px-3 py-1.5 text-sm text-sky-100 disabled:opacity-40"
                  >
                    Take back melds
                  </button>
                )}
                {layOffs.length > 0 && !building && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={layOffAll}
                    className="rounded border border-emerald-300/60 px-3 py-1.5 text-sm text-emerald-100 disabled:opacity-40"
                  >
                    Add {layOffs.length} to my melds
                  </button>
                )}
                <span className="text-sm text-white/60">{guidance()}</span>
                {hintsOn && (
                  <button
                    type="button"
                    onClick={() => setSuggestion(suggestionFor(view, room.config))}
                    className="rounded border border-amber-200/50 px-3 py-1.5 text-sm text-amber-100"
                  >
                    Suggest a move
                  </button>
                )}
                {hintsOn && hints.takePileWhy && view.discard.length > 0 && (
                  <p aria-label="Why not the pile" className="w-full text-sm text-amber-100/90">
                    You can&rsquo;t take the pile: {hints.takePileWhy}.
                  </p>
                )}
                {hintsOn && suggestion && (
                  <p
                    role="status"
                    aria-label="Suggestion"
                    className="w-full text-sm text-amber-200"
                  >
                    Suggested: {suggestion.text}
                  </p>
                )}
              </>
            ) : (
              <span className="text-sm text-white/60">Waiting for {nameOf(hints.seatToAct)}.</span>
            )}
          </section>
        )}
        <div className="flex items-end gap-3">
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
              hintIds={hintsOn ? suggestion?.cardIds : undefined}
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
              <span className="text-xs text-white/60">{phone ? "Foot" : `${whose} foot`}</span>
              <FaceDownPile
                count={view.footCount}
                label={`${whose} foot`}
                size={phone ? "small" : "normal"}
              />
            </div>
          )}
        </div>
      </footer>

      {rulesOpen && <RulesDialog config={room.config} onClose={() => setRulesOpen(false)} />}
      {grabbyHeadline && <GrabbyAnnouncement headline={grabbyHeadline} />}
      {marva && <MarvaCelebration news={marva} />}

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
          seat={view.seat}
        />
      )}
    </main>
  );

  /** One line saying what the table is waiting for, in the order the rules impose. */
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

/** The word under a pile that is waiting to be clicked, pulsing with it. */
function PilePrompt({ children }: { readonly children: React.ReactNode }): React.ReactElement {
  // Fixed at first render: re-reading the clock on every render would jump the phase.
  const [style] = useState(() => pulseStyle());
  return (
    <span
      style={style}
      className="pile-prompt-label rounded bg-amber-300 px-2 py-0.5 text-xs font-semibold text-black"
    >
      {children}
    </span>
  );
}

const COMPACT_MELDS_KEY = "hf.compactMelds";
const COMPACT_SEATS_KEY = "hf.compactSeats";

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

/** A bell, filled when notifications are on and struck through when off. */
function BellIcon({ on }: { readonly on: boolean }): React.ReactElement {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 fill-none stroke-current">
      <path
        d="M4 11V7a4 4 0 0 1 8 0v4l1.5 1.5h-11zM6.5 14a1.5 1.5 0 0 0 3 0"
        className={on ? "fill-current" : undefined}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      {!on && <path d="M2.5 2.5l11 11" strokeWidth="1.3" strokeLinecap="round" />}
    </svg>
  );
}

/** A speaker, struck through when muted: drawn, as not every font has the glyph. */
function SpeakerIcon({ muted }: { readonly muted: boolean }): React.ReactElement {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 fill-none stroke-current">
      <path d="M2 6h3l4-3v10l-4-3H2z" className="fill-current" strokeWidth="0" />
      {muted ? (
        <path d="M11 6l4 4m0-4l-4 4" strokeWidth="1.5" strokeLinecap="round" />
      ) : (
        <path
          d="M11 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
