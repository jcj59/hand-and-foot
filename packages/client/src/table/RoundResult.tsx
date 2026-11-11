/**
 * The end-of-round scoreboard, with the arithmetic shown.
 *
 * A total alone invites the question of where it came from, and in Hand and Foot
 * the answer is usually the books: a player can lay down fewer card points and
 * still win on two clean books. So on a computer each row shows, beside the round's
 * score and the total, the engine's own breakdown as the board draws it: how many
 * clean and dirty books, the face value of the cards melded, and how many cards were
 * left in hand. These explain the score rather than add up to it, since the go-out
 * bonus and the book bonuses are not columns of their own.
 *
 * It opens over the table, headed by how the round ended, because the end of a
 * round is the biggest thing that happens in it and a line of text among the
 * cards is easy to miss. It can be hidden to look back at the table.
 */
import { useState } from "react";
import { LEVEL_WORDS } from "../home/sheets";
import { Icon } from "../ui/icons";
import { usePhone } from "../usePhone";
import { AwardIcon, awardsOf, winnersOf } from "./awards";
import { PlayerFace } from "./PlayerFace";
import { roundRecap } from "./recap";
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
  /**
   * Deal the same table again, everyone moving at once. Offered to the host once
   * the match is over, until someone has gone on to a new game.
   */
  readonly onRematch: () => void;
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

/** A signed number the way a scoreboard writes one: "+1,245", "-140". */
function signed(n: number): string {
  const digits = Math.abs(n).toLocaleString("en-US");
  return n > 0 ? `+${digits}` : n < 0 ? `-${digits}` : "0";
}

/** "Kate", "Kate and Mom", "Kate, Mom and you". */
function listed(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Who is ready for the next round and who the table waits on, in a sentence:
 * "Kate is ready. Waiting for Mom and you. Computers never hold up the next round."
 */
export function readiness(
  people: readonly { readonly seat: number; readonly name: string }[],
  ready: readonly number[],
  mySeat: number,
  hasComputers: boolean,
): string {
  const word = (p: { readonly seat: number; readonly name: string }, start: boolean): string =>
    p.seat === mySeat ? (start ? "You" : "you") : p.name;
  const done = people.filter((p) => ready.includes(p.seat));
  const waiting = people.filter((p) => !ready.includes(p.seat));
  const parts: string[] = [];
  if (done.length > 0) {
    const plural = done.length > 1 || done[0]!.seat === mySeat;
    parts.push(`${listed(done.map((p, i) => word(p, i === 0)))} ${plural ? "are" : "is"} ready.`);
  }
  if (waiting.length > 0) parts.push(`Waiting for ${listed(waiting.map((p) => word(p, false)))}.`);
  if (hasComputers) parts.push("Computers never hold up the next round.");
  return parts.join(" ");
}

export function RoundResult({
  result,
  room,
  config,
  actions,
  seat: mySeat,
  notice,
}: RoundResultProps): React.ReactElement {
  const phone = usePhone();
  const [hidden, setHidden] = useState(false);
  const totalOf = (seat: number): number => result.totals[seat] ?? 0;
  // The round a player left the match after, if they have left it.
  const leftAfter = (seat: number): number | undefined =>
    result.departed?.find((d) => d.seat === seat)?.afterRound;
  const gone = (seat: number): boolean => leftAfter(seat) !== undefined;
  // Ranked by the match so far, which is the standing that matters between rounds,
  // among the players still in it. Anyone who has left keeps their row, below them.
  const ranked = [...result.scores].sort(
    (a, b) => Number(gone(a.seat)) - Number(gone(b.seat)) || totalOf(b.seat) - totalOf(a.seat),
  );
  const infoOf = (seat: number) => room.players.find((p) => p.seat === seat);
  const nameOf = (seat: number): string => infoOf(seat)?.name ?? `Seat ${seat}`;
  // A player who left can top the totals without having finished the match: the
  // win is among those who did.
  const contenders = result.scores.filter((r) => !gone(r.seat));
  const best = Math.max(...contenders.map((r) => totalOf(r.seat)));
  const winnerSeats = contenders.filter((r) => totalOf(r.seat) === best).map((r) => r.seat);
  const winners = winnerSeats.map(nameOf);
  const playing = room.players.filter((p) => !p.departed);
  // Who the table waits on between rounds: the people still playing. A computer
  // player is always ready.
  const waitedOn = playing.filter((p) => !p.bot);
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
  const nextMinimum = config.layDownMinimums[result.roundNumber];
  const sub = result.matchOver
    ? `Match over · ${config.rounds} round${config.rounds === 1 ? "" : "s"}`
    : `${headline}${
        nextMinimum !== undefined
          ? ` Round ${result.roundNumber + 1} needs ${nextMinimum} to get down.`
          : ""
      }`;
  const iAmReady = room.nextRoundReady.includes(mySeat);
  // The host can deal the same table again, until someone has gone on to a new game.
  const canRematch = result.matchOver && mySeat === room.hostSeat && room.playAgain.length === 0;
  const primary =
    "min-h-12 rounded-xl bg-accent px-[18px] text-[15px] font-semibold text-accent-ink disabled:opacity-60";
  const ghost =
    "min-h-12 rounded-xl border border-white/20 px-[18px] text-[15px] font-semibold text-ink hover:bg-white/5";
  // What to do next stays on screen whether or not the scores are.
  const choices = actions && (
    <>
      {canRematch && (
        <button type="button" onClick={actions.onRematch} className={primary}>
          Rematch
        </button>
      )}
      {result.matchOver ? (
        <button
          type="button"
          onClick={actions.onPlayAgain}
          className={canRematch ? ghost : primary}
        >
          Play again
        </button>
      ) : (
        <button
          type="button"
          disabled={iAmReady}
          aria-label={iAmReady ? "Waiting for the others…" : "Next round"}
          onClick={actions.onNextRound}
          className={primary}
        >
          {iAmReady ? "Waiting for the others…" : `I'm ready for round ${result.roundNumber + 1}`}
        </button>
      )}
      {!result.matchOver && room.config.pauseEnabled && (
        <button type="button" onClick={actions.onSaveForLater} className={ghost}>
          Save for later
        </button>
      )}
      <button
        type="button"
        aria-label="Back to the main screen"
        onClick={actions.onLeave}
        className={ghost}
      >
        Leave
      </button>
    </>
  );

  if (hidden) {
    return (
      <div
        role="region"
        aria-label="Round over"
        className="fixed right-3 bottom-3 left-3 z-30 flex flex-wrap items-center gap-2 rounded-2xl border border-gold/40 bg-sheet p-3 shadow-[0_20px_50px_rgba(0,0,0,0.6)] md:left-auto"
      >
        {notice && (
          <p role="alert" className="m-0 w-full text-sm text-danger-soft">
            {notice}
          </p>
        )}
        <span className="flex-1 px-1 font-display font-semibold text-gold-soft">{headline}</span>
        {choices}
        <button type="button" onClick={() => setHidden(false)} className={ghost}>
          Show the scores
        </button>
      </div>
    );
  }

  const cols = phone
    ? "grid-cols-[22px_minmax(0,1fr)_66px_70px]"
    : "grid-cols-[28px_minmax(0,1fr)_repeat(4,74px)_84px_90px]";
  const awards = awardsOf(result);

  const table = (
    <>
      <div aria-hidden="true" className={`grid ${cols} gap-2 px-3 text-[11px] text-faint`}>
        <span />
        <span>Player</span>
        {!phone && (
          <>
            <span>Clean books</span>
            <span>Dirty books</span>
            <span>Card points</span>
            <span>Cards left</span>
          </>
        )}
        <span>{phone ? "Round" : "This round"}</span>
        <span className="text-right">Total</span>
      </div>
      <ol
        aria-label={result.matchOver ? "Final scores" : "Scores"}
        className="m-0 flex list-none flex-col gap-1.5 p-0"
      >
        {ranked.map(({ seat, score, breakdown: b }, i) => {
          const info = infoOf(seat);
          const name = seat === mySeat ? "You" : nameOf(seat);
          const after = leftAfter(seat);
          // Gone before this round was dealt: there is nothing of theirs to break down.
          const sat = after === undefined || after >= result.roundNumber;
          const tag =
            after !== undefined
              ? `Left after round ${after}`
              : result.wentOutSeat === seat
                ? "Went out"
                : info?.bot
                  ? `Computer · ${LEVEL_WORDS[info.botLevel ?? "standard"]}`
                  : "";
          return (
            <li
              key={seat}
              aria-label={
                sat ? `${nameOf(seat)}: ${score}` : `${nameOf(seat)}: left after round ${after}`
              }
              className={`grid ${cols} items-center gap-2 rounded-xl border px-3 py-2.5 ${
                i === 0 && !gone(seat)
                  ? "border-gold/35 bg-[linear-gradient(90deg,rgba(242,193,78,0.16),rgba(242,193,78,0.04))]"
                  : "border-white/5 bg-white/3"
              } ${gone(seat) ? "opacity-60" : ""}`}
            >
              <span className="font-display text-sm font-bold text-muted">{i + 1}</span>
              <span className="flex min-w-0 items-center gap-2">
                <PlayerFace player={info} size={phone ? 30 : 34} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{name}</span>
                  {tag && <span className="block text-[11px] text-muted">{tag}</span>}
                </span>
              </span>
              {!phone &&
                (sat ? (
                  <>
                    <span className="text-sm font-semibold text-ink-soft">{b.cleanBooks}</span>
                    <span className="text-sm font-semibold text-ink-soft">{b.dirtyBooks}</span>
                    <span className="text-sm font-semibold text-ink-soft">{b.meldedCards}</span>
                    <span className="text-sm font-semibold text-ink-soft">{b.heldCount}</span>
                  </>
                ) : (
                  <span className="col-span-4" />
                ))}
              <span
                className={`font-display text-sm font-bold md:text-[15px] ${
                  !sat ? "text-muted" : score >= 0 ? "text-accent" : "text-salmon"
                }`}
              >
                {sat ? signed(score) : "–"}
              </span>
              <span className="text-right font-display text-base font-bold tabular-nums">
                {totalOf(seat).toLocaleString("en-US")}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );

  const extras = (
    <>
      {/* At the end of the match too: the last round is still worth a line. */}
      {
        <ul
          aria-label="Round recap"
          className="m-0 flex list-none flex-col gap-1.5 rounded-2xl bg-white/3 p-3"
        >
          {roundRecap(result, nameOf).map((line) => (
            <li key={line} className="text-[13px] leading-snug text-ink-soft">
              {line}
            </li>
          ))}
        </ul>
      }
      {result.matchOver && awards.length > 0 && (
        <section aria-label="Awards" className="flex flex-col gap-2">
          <h3 className="m-0 mt-1 text-xs font-semibold tracking-[0.08em] text-faint uppercase">
            Awards
          </h3>
          <ul
            className={`m-0 grid list-none gap-2 p-0 ${
              phone
                ? "grid-cols-[repeat(auto-fill,minmax(150px,1fr))]"
                : "grid-cols-[repeat(auto-fill,minmax(220px,1fr))]"
            }`}
          >
            {awards.map((award) => (
              <li
                key={award.id}
                className="flex items-center gap-2.5 rounded-2xl border border-white/6 bg-white/4 p-2.5"
              >
                <AwardIcon id={award.id} size={phone ? 34 : 40} />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold">{award.title}</span>
                  <span className="block text-xs text-muted">{winnersOf(award, nameOf)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!result.matchOver && waitedOn.length > 0 && (
        <p role="status" className="m-0 text-[13px] text-muted">
          {readiness(
            waitedOn,
            room.nextRoundReady,
            mySeat,
            playing.some((p) => p.bot),
          )}
        </p>
      )}
      {result.matchOver && room.playAgain.length > 0 && (
        // Who is already waiting for the next game, so a player can see whether
        // anyone is there to play with.
        <p role="status" className="m-0 text-[13px] text-gold-soft">
          Waiting in the next game: {room.playAgain.map(nameOf).join(", ")} ({room.playAgain.length}{" "}
          of {waitedOn.length})
        </p>
      )}
      {absent.map((p) => (
        <div
          key={p.seat}
          className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 px-3 py-2.5 text-sm"
        >
          <span className="flex-1 text-ink-soft">
            {p.name} is not at the table. The rest of you can carry on without them.
          </span>
          <button
            type="button"
            onClick={() => actions!.onRemovePlayer(p.seat)}
            className="min-h-10 rounded-xl border border-gold/60 px-3 text-sm font-semibold text-gold-soft"
          >
            Carry on without {p.name}
          </button>
        </div>
      ))}
      {notice && (
        <p role="alert" className="m-0 rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger-soft">
          {notice}
        </p>
      )}
      {actions && !result.matchOver && family && playing.length > MIN_PLAYERS && (
        <p className="m-0 text-xs text-quiet">
          Leaving now takes you out of the match; the others carry on without you.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {choices}
        <button type="button" onClick={() => setHidden(true)} className={ghost}>
          Look at the table
        </button>
      </div>
    </>
  );

  if (result.matchOver) {
    const champion = winnerSeats.length === 1 ? infoOf(winnerSeats[0]!) : undefined;
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center overflow-hidden bg-[rgba(6,10,12,0.7)] p-3">
        <section
          role="dialog"
          aria-label="Round result"
          className="relative flex max-h-[94%] w-full max-w-[820px] flex-col gap-3.5 overflow-y-auto rounded-[28px] border border-gold/40 bg-sheet px-[18px] py-[22px]"
        >
          <div className="flex items-center gap-3.5">
            {champion && (
              <span className="relative shrink-0 pt-2">
                <PlayerFace player={champion} size={64} />
                <span
                  aria-hidden="true"
                  className="absolute -top-1.5 left-1/2 -translate-x-1/2 text-gold"
                >
                  <Icon name="crown" size={24} />
                </span>
              </span>
            )}
            <div>
              <p className="m-0 text-[13px] font-semibold text-gold">{sub}</p>
              <h2 className="m-0 mt-0.5 font-display text-[26px] font-bold tracking-[-0.02em]">
                {headline}
              </h2>
            </div>
          </div>
          {table}
          {extras}
        </section>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-[rgba(6,10,12,0.66)]">
      <section
        role="dialog"
        aria-label="Round result"
        className="flex max-h-[92%] w-full max-w-[820px] flex-col gap-3 overflow-y-auto rounded-t-[28px] border border-white/8 bg-sheet px-[18px] pt-[18px] pb-[calc(22px+env(safe-area-inset-bottom,0px))]"
      >
        <span
          aria-hidden="true"
          className="h-[5px] w-10 shrink-0 self-center rounded bg-selected"
        />
        <div>
          <h2 className="m-0 font-display text-[26px] font-bold">
            Round {result.roundNumber} over
          </h2>
          <p className="m-0 mt-0.5 text-[13px] text-muted">{sub}</p>
        </div>
        {table}
        {extras}
      </section>
    </div>
  );
}
