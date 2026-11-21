/**
 * Chat at the table: what the players have said, and a line to say something.
 * Beside the table on a computer (the side panel's Chat tab), in a sheet behind the
 * header's Chat button on a phone.
 *
 * The server is the authority on what may be said (`normalizeChat`, the length
 * limit, a budget per seat), so this sends what was typed and shows the refusal
 * beside the box when there is one, keeping the text so it can be shortened or
 * sent again. Messages are rendered as text: React escapes them, and nothing in
 * them becomes a link. Watchers read along but cannot send.
 *
 * "Mute chat" is per device, like muting reactions: it hides other players'
 * messages, their bubbles and their sound, never your own.
 */
import { useLayoutEffect, useRef, useState } from "react";
import {
  CHAT_MAX_LENGTH,
  chatLength,
  defaultAvatar,
  normalizeChat,
  type ChatMessage,
  type RoomInfo,
} from "@hf/shared";
import { AvatarFace } from "../profile/Avatar";
import { PlayerFace } from "./PlayerFace";

const MUTE_CHAT_KEY = "hf.muteChat";

export function readMuteChat(): boolean {
  try {
    return window.localStorage.getItem(MUTE_CHAT_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeMuteChat(on: boolean): void {
  try {
    window.localStorage.setItem(MUTE_CHAT_KEY, on ? "1" : "0");
  } catch {
    // Blocked storage: the choice lasts until the page is reloaded.
  }
}

/** The newest message's number, or 0 for none. */
export function latestSeq(chat: readonly ChatMessage[]): number {
  return chat.at(-1)?.seq ?? 0;
}

/**
 * How many messages are waiting to be read: other players' messages newer than
 * both what was last on screen (`readThrough`) and the history the table arrived
 * with (`oldThrough`). None while muted, since they are hidden.
 */
export function unreadCount(
  chat: readonly ChatMessage[],
  {
    readThrough,
    oldThrough,
    mySeat,
    muted,
  }: {
    readonly readThrough: number;
    readonly oldThrough: number;
    readonly mySeat: number;
    readonly muted: boolean;
  },
): number {
  if (muted) return 0;
  const after = Math.max(readThrough, oldThrough);
  return chat.filter((m) => m.seq > after && m.seat !== mySeat).length;
}

/** The count on a badge: past nine it says "9+", which is all a glance needs. */
export function unreadBadge(count: number): string {
  return count > 9 ? "9+" : String(count);
}

export interface ChatPanelProps {
  readonly messages: readonly ChatMessage[];
  /** The viewer's seat; `SPECTATOR_SEAT` when watching. */
  readonly mySeat: number;
  /** For each sender's face: the seat's player, when they are still the one who spoke. */
  readonly room: RoomInfo;
  readonly muted: boolean;
  readonly onMutedChange: (muted: boolean) => void;
  /** Send a line; resolves with the refusal, or null once it went. Null when watching. */
  readonly onSend: ((text: string) => Promise<string | null>) | null;
  /** In a phone's sheet: the list is capped so the box stays in view above the keyboard. */
  readonly sheet?: boolean;
}

export function ChatPanel({
  messages,
  mySeat,
  room,
  muted,
  onMutedChange,
  onSend,
  sheet = false,
}: ChatPanelProps): React.ReactElement {
  const [text, setText] = useState("");
  const [refused, setRefused] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const shown = muted ? messages.filter((m) => m.seat === mySeat) : messages;
  const hidden = messages.length - shown.length;

  // New lines come in at the bottom: follow them, unless the player has scrolled
  // up to read something older.
  const pinned = useRef(true);
  const newest = latestSeq(shown);
  useLayoutEffect(() => {
    const el = list.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [newest]);

  const length = chatLength(text.trim());
  const canSend = onSend !== null && !sending && normalizeChat(text) !== null;

  async function send(): Promise<void> {
    if (!onSend || !canSend) return;
    setSending(true);
    const error = await onSend(text);
    setSending(false);
    if (error === null) {
      setText("");
      pinned.current = true;
    } else setRefused(error);
    input.current?.focus();
  }

  return (
    <div className={`flex min-h-0 flex-col gap-2.5 ${sheet ? "" : "h-full"}`}>
      <ol
        ref={list}
        aria-label="Messages"
        onScroll={(event) => {
          const el = event.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className={`m-0 flex list-none flex-col gap-2 overflow-y-auto p-0 ${
          sheet ? "max-h-[45dvh] min-h-24" : "min-h-0 flex-1"
        }`}
      >
        {shown.length === 0 && (
          <li className="m-auto px-2 py-6 text-center text-[13px] text-muted">
            {hidden > 0
              ? "Other players' messages are hidden on this device."
              : onSend
                ? "Nothing said yet. Say hello."
                : "Nothing said yet."}
          </li>
        )}
        {shown.map((m) => {
          const player = room.players.find((p) => p.seat === m.seat && p.name === m.name);
          const mine = m.seat === mySeat;
          return (
            <li key={m.seq} className="flex items-start gap-2">
              {player ? (
                <PlayerFace player={player} size={24} />
              ) : (
                <AvatarFace avatar={defaultAvatar(m.name)} size={24} />
              )}
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-xs font-semibold text-muted">
                  {mine ? "You" : m.name}
                </p>
                <p
                  className={`m-0 mt-0.5 inline-block max-w-full rounded-[4px_14px_14px_14px] px-2.5 py-1.5 text-sm leading-snug [overflow-wrap:anywhere] ${
                    mine ? "bg-selected text-ink" : "bg-surface text-ink"
                  }`}
                >
                  {m.text}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {muted && hidden > 0 && shown.length > 0 && (
        <p className="m-0 text-xs text-quiet">
          Other players&rsquo; messages are hidden on this device.
        </p>
      )}
      {onSend ? (
        <form
          className="flex shrink-0 flex-col gap-1.5"
          onSubmit={(event) => {
            // Enter sends: the form submits, and the page stays where it is.
            event.preventDefault();
            void send();
          }}
        >
          <div className="flex items-center gap-2">
            <input
              ref={input}
              type="text"
              aria-label="Message"
              placeholder="Say something"
              autoComplete="off"
              enterKeyHint="send"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                // A refusal is about the text it was sent with; editing that clears it.
                setRefused(null);
              }}
              aria-invalid={refused !== null}
              aria-describedby={refused ? "chat-refused" : undefined}
              className="min-h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-page px-3 text-sm text-ink outline-none placeholder:text-faint focus:border-accent/70"
            />
            <button
              type="submit"
              disabled={!canSend}
              className="inline-flex min-h-10 shrink-0 items-center rounded-xl bg-accent px-3.5 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
          </div>
          {length > CHAT_MAX_LENGTH - 20 && (
            <p
              aria-live="polite"
              className={`m-0 text-right text-[11px] tabular-nums ${
                length > CHAT_MAX_LENGTH ? "text-danger-soft" : "text-quiet"
              }`}
            >
              {length} of {CHAT_MAX_LENGTH}
            </p>
          )}
          {refused && (
            <p id="chat-refused" role="alert" className="m-0 text-xs text-danger-soft">
              {sentence(refused)}
            </p>
          )}
        </form>
      ) : (
        <p className="m-0 shrink-0 text-xs text-quiet">
          Watching: only the players at the table can chat.
        </p>
      )}
      <label className="flex shrink-0 items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={muted}
          onChange={(event) => onMutedChange(event.target.checked)}
          className="size-4 accent-accent"
        />
        Mute chat
      </label>
    </div>
  );
}

/** The server's lowercase refusal, as a sentence. */
function sentence(error: string): string {
  const text = error.charAt(0).toUpperCase() + error.slice(1);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
