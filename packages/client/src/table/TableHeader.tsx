/**
 * The bar over the table: which round it is and what it takes to get down, the
 * turn clock, and the table's few controls.
 *
 * On a phone it holds the menu, the clock, React and the scores (a trophy that
 * opens them in a sheet); sound and the rules move into the menu, where there is
 * room to say what they do. On a computer the scores sit beside the table, so the
 * bar holds React, Sound, How to play and the menu.
 *
 * The menu is where a table's rarer choices live: pausing it, turn notifications,
 * and going back to the main screen, which keeps the seat (the main screen offers
 * the way back, and the clock keeps running meanwhile).
 */
import { useState } from "react";
import type { ClockState, ReactionId } from "@hf/shared";
import { Sheet } from "../ui/Sheet";
import { Icon } from "../ui/icons";
import { usePhone } from "../usePhone";
import { ICON_BUTTON, ReactionPicker } from "./reactions";
import { TurnClock } from "./TurnClock";

export type NotifyState = "on" | "off" | "blocked" | "unsupported";

export interface TableHeaderProps {
  readonly title: string;
  readonly sub: string;
  /** The turn clock, when there is one to show here (the player's own turn, or paused). */
  readonly clock: ClockState | null;
  /** Null when watching: no reactions, no pausing. */
  readonly onReact: ((id: ReactionId) => void) | null;
  readonly muteReactions: boolean;
  readonly onMuteReactions: (muted: boolean) => void;
  readonly sound: {
    readonly muted: boolean;
    readonly blocked: boolean;
    readonly onToggle: () => void;
  };
  readonly notify: NotifyState;
  readonly onToggleNotify: () => void;
  /** Offered while the table can be paused and is not. */
  readonly onPause: (() => void) | null;
  readonly busy: boolean;
  readonly onRules: () => void;
  readonly onMainMenu: () => void;
  /** The scores and latest moves, for the phone's sheet (titled by it). */
  readonly scores: (titled: boolean) => React.ReactNode;
}

export function TableHeader({
  title,
  sub,
  clock,
  onReact,
  muteReactions,
  onMuteReactions,
  sound,
  notify,
  onToggleNotify,
  onPause,
  busy,
  onRules,
  onMainMenu,
  scores,
}: TableHeaderProps): React.ReactElement {
  const phone = usePhone();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scoresOpen, setScoresOpen] = useState(false);

  const soundLabel = sound.muted
    ? "Turn sound on"
    : sound.blocked
      ? "Tap to let sound play"
      : "Turn sound off";
  const soundButton = (
    // Sound on but not allowed yet (the browser waits for a tap after a reload,
    // or took it away while the tab was away) says so: any tap brings it back,
    // this one included, and without the hint silence looks like a broken game.
    <button
      type="button"
      aria-label={soundLabel}
      title={!sound.muted && sound.blocked ? "Tap anywhere to let sound play" : undefined}
      aria-pressed={sound.muted}
      onClick={sound.onToggle}
      className={`${ICON_BUTTON} relative ${!sound.muted && sound.blocked ? "border-gold/70 text-gold" : ""}`}
    >
      <Icon name={sound.muted ? "soundOff" : "sound"} size={18} />
      {!sound.muted && sound.blocked && (
        <span
          aria-hidden="true"
          className="absolute -top-1 -right-1 size-2 rounded-full bg-gold motion-safe:animate-pulse"
        />
      )}
    </button>
  );
  const react = onReact && (
    <ReactionPicker
      onSend={onReact}
      muted={muteReactions}
      onMutedChange={onMuteReactions}
      sheet={phone}
    />
  );
  const menuButton = (
    <button
      type="button"
      aria-label="Main menu"
      aria-expanded={menuOpen}
      onClick={() => setMenuOpen(true)}
      className={ICON_BUTTON}
    >
      <Icon name="menu" size={18} />
    </button>
  );

  const item =
    "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium hover:bg-white/5 disabled:opacity-40";
  const menu = menuOpen && (
    <Sheet id="table-menu" title="Table" onClose={() => setMenuOpen(false)}>
      <div className="flex flex-col gap-1">
        {onPause && (
          <button
            type="button"
            aria-label="Pause"
            disabled={busy}
            onClick={() => {
              setMenuOpen(false);
              onPause();
            }}
            className={item}
          >
            <Icon name="pause" size={18} className="text-blue" />
            Pause the table
          </button>
        )}
        {phone && (
          <button
            type="button"
            aria-label="How to play"
            onClick={() => {
              setMenuOpen(false);
              onRules();
            }}
            className={item}
          >
            <Icon name="help" size={18} className="text-muted" />
            How to play
          </button>
        )}
        {phone && (
          <button
            type="button"
            aria-label={soundLabel}
            aria-pressed={sound.muted}
            onClick={sound.onToggle}
            className={item}
          >
            <Icon name={sound.muted ? "soundOff" : "sound"} size={18} className="text-muted" />
            {sound.muted ? "Sound is off" : "Sound is on"}
          </button>
        )}
        {/* Turn notifications, for a table left in a background tab. Off until
            turned on here, which is the only place permission is asked for; not
            shown where the browser has no notifications, and inert once the
            browser has been told no, since only its own settings can undo that.
            Not offered on a phone either: Chrome on Android refuses a notification
            made by a page, and iOS has them only through web push, so the button
            would promise what never comes. */}
        {!phone && notify !== "unsupported" && onReact && (
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
            onClick={onToggleNotify}
            className={item}
          >
            <Icon name="bell" size={18} className={notify === "on" ? "text-gold" : "text-muted"} />
            {notify === "on" ? "Notifying you when it's your turn" : "Notify me when it's my turn"}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setMenuOpen(false);
            onMainMenu();
          }}
          className={item}
        >
          <Icon name="back" size={18} className="text-muted" />
          Go to the main menu
        </button>
        {onReact && (
          <p className="m-0 px-3 text-xs text-quiet">
            Your seat is kept: the main menu offers the way back.
          </p>
        )}
      </div>
    </Sheet>
  );

  if (phone) {
    return (
      <header className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-2">
        {menuButton}
        <div className="min-w-0 flex-1">
          <h1 className="m-0 truncate font-display text-[15px] font-semibold">{title}</h1>
          <p className="m-0 text-[11px] leading-snug text-muted">{sub}</p>
        </div>
        {clock && <TurnClock clock={clock} compact />}
        {react}
        <button
          type="button"
          aria-label="Scores so far"
          aria-expanded={scoresOpen}
          onClick={() => setScoresOpen(true)}
          className={ICON_BUTTON}
        >
          <Icon name="trophy" size={18} />
        </button>
        {menu}
        {scoresOpen && (
          <Sheet id="scores" title="Scores so far" onClose={() => setScoresOpen(false)}>
            {scores(true)}
          </Sheet>
        )}
      </header>
    );
  }

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-white/6 px-6 py-3.5">
      <div className="min-w-0 flex-1">
        <h1 className="m-0 font-display text-xl font-semibold">{title}</h1>
        <p className="m-0 text-[13px] text-muted">{sub}</p>
      </div>
      {clock && <TurnClock clock={clock} />}
      {react}
      {soundButton}
      <button type="button" aria-label="How to play" onClick={onRules} className={ICON_BUTTON}>
        <Icon name="help" size={18} />
      </button>
      {menuButton}
      {menu}
    </header>
  );
}
