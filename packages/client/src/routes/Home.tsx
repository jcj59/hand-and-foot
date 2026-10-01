/**
 * Getting to a table: pick a name, then open one or join one.
 *
 * Both paths live on one screen because they are the same decision, and because
 * arriving from a shared link is the common case — the code is already known, so
 * the only thing missing is a name. When that happens the join half is filled in
 * and focused, and the create half stays available for someone who followed a link
 * to a table that has since gone.
 */
import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  MAX_NAME_LENGTH,
  ROOM_CODE_LENGTH,
  transferCode,
  type GameMode,
  type RulesPreset,
  type UserCredentials,
} from "@hf/shared";
import { createTable, joinTable } from "../actions";
import { loadCredentials } from "../credentials";
import { isPossibleRoomCode, normalizeRoomCode } from "../roomCode";
import { useSession } from "../session";
import { serverUrl, type HfClientSocket } from "../socket";
import {
  adoptTransferCode,
  httpPost,
  loadName,
  prepareIdentity,
  rememberName,
  type Post,
} from "../identity";

export interface HomeProps {
  readonly socket: HfClientSocket;
  /** How identities reach the server; the page's own origin unless a test answers it. */
  readonly post?: Post;
}

export function Home({ socket, post = httpPost(serverUrl()) }: HomeProps): React.ReactElement {
  const navigate = useNavigate();
  const { roomId: fromLink } = useParams<{ roomId?: string }>();
  const seat = useSession((s) => s.seat);
  const setNotice = useSession((s) => s.setNotice);
  const notice = useSession((s) => s.notice);
  // A seat this tab still holds — the player came to the main screen from a table
  // without leaving it — and the way back to it.
  // A seat held in this tab, or one saved by an earlier visit that has not been
  // reclaimed: reloading the home screen leaves it unclaimed until Rejoin.
  const held = useSession((s) => s.credentials) ?? loadCredentials();

  // The name this player went by last time, ready to use again or change.
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState(fromLink ? normalizeRoomCode(fromLink) : "");
  const [preset, setPreset] = useState<RulesPreset>("east-coast");
  const [mode, setMode] = useState<GameMode>("family");
  // One flag for both buttons: a request is in flight and neither should be sent
  // twice, which double-seats the sender at their own table.
  const [busy, setBusy] = useState(false);

  const named = name.trim() !== "";
  const sink = { seat, setNotice };

  async function submit(event: FormEvent, join: boolean): Promise<void> {
    event.preventDefault();
    if (busy || !named) return;
    setBusy(true);
    try {
      rememberName(name);
      // Who is sitting down, for attributing games later. Without an answer in
      // time the player sits down anyway, as nobody in particular.
      const user = await prepareIdentity(post, name.trim());
      const roomId = join
        ? await joinTable(socket, code, name, sink, user)
        : await createTable(socket, name, { preset, mode }, sink, user);
      if (roomId) navigate(`/room/${roomId}`);
    } finally {
      // Cleared even on refusal, so a wrong code can be corrected and retried.
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 p-6">
      {held && (
        <section
          aria-label="Your table"
          className="flex items-center justify-between gap-3 rounded border border-amber-300/50 bg-amber-300/10 p-3"
        >
          <p className="text-sm">You still have a seat at table {held.roomId}.</p>
          <button
            type="button"
            onClick={() => navigate(`/room/${held.roomId}`)}
            className="rounded bg-amber-300 px-3 py-1.5 text-sm font-medium text-black"
          >
            Rejoin
          </button>
        </section>
      )}
      <header>
        <h1 className="text-3xl font-semibold">Hand and Foot</h1>
        <p className="mt-1 text-sm text-white/60">
          {fromLink ? "You were invited to a table." : "Open a table, or join one with a code."}
        </p>
      </header>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-white/80">Your name</span>
        <input
          className="rounded border border-white/20 bg-black/20 px-3 py-2 text-white placeholder:text-white/30"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Ana"
          // First either way, and from a shared link it is the only thing missing.
          autoFocus
          maxLength={MAX_NAME_LENGTH}
        />
      </label>

      {notice && (
        <p role="alert" className="rounded bg-red-600/20 px-3 py-2 text-sm text-red-200">
          {notice}
        </p>
      )}

      <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e, true)}>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-white/80">Table code</span>
          <input
            className="rounded border border-white/20 bg-black/20 px-3 py-2 font-mono tracking-widest text-white uppercase placeholder:text-white/30"
            value={code}
            onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
            placeholder="ABC234"
            // The browser truncates to this before normalizing ever sees it, so it
            // leaves room for the separators people type: "ABC-234", "a b c 2 3 4".
            maxLength={ROOM_CODE_LENGTH * 2}
          />
        </label>
        <button
          type="submit"
          // Disabled rather than validated on submit, so an impossible code never
          // costs a round trip; the server still has the final say on whether the
          // table exists.
          disabled={busy || !named || !isPossibleRoomCode(code)}
          className="rounded bg-white px-4 py-2 font-medium text-felt-900 disabled:opacity-40"
        >
          Join table
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs text-white/40">
        <span className="h-px flex-1 bg-white/15" />
        or
        <span className="h-px flex-1 bg-white/15" />
      </div>

      <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e, false)}>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-white/80">House rules</legend>
          <label className="flex items-center justify-between text-sm">
            <span className="text-white/70">Variant</span>
            <select
              className="rounded border border-white/20 bg-black/30 px-2 py-1"
              value={preset}
              onChange={(e) => setPreset(e.target.value as RulesPreset)}
            >
              <option value="east-coast">East Coast</option>
              <option value="west-coast">West Coast</option>
            </select>
          </label>
          <label className="flex items-center justify-between text-sm">
            <span className="text-white/70">Mode</span>
            <select
              className="rounded border border-white/20 bg-black/30 px-2 py-1"
              value={mode}
              onChange={(e) => setMode(e.target.value as GameMode)}
            >
              <option value="family">Family</option>
              <option value="competitive">Competitive</option>
            </select>
          </label>
        </fieldset>
        <button
          type="submit"
          disabled={busy || !named}
          className="rounded border border-white/30 px-4 py-2 font-medium disabled:opacity-40"
        >
          Open a new table
        </button>
      </form>

      <IdentityPanel post={post} />
    </main>
  );
}

/**
 * Moving this player's identity to another device: the code to copy here, and
 * the place to paste one from elsewhere. Folded away — most people never need it.
 */
function IdentityPanel({ post }: { readonly post: Post }): React.ReactElement {
  // Shown only once the server knows it: a code for an identity never registered
  // would be refused on the other device.
  const [identity, setIdentity] = useState<UserCredentials | null>(null);
  const [pasted, setPasted] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);

  const open = (): void => {
    if (asked) return;
    setAsked(true);
    void prepareIdentity(post, loadName()).then((ready) => {
      // A code adopted while this was in flight is the profile now; keep it.
      if (ready) setIdentity((current) => current ?? ready);
      else setStatus("Could not reach the server to set up your profile. Try again later.");
    });
  };

  return (
    <details
      className="rounded border border-white/10 bg-black/15 p-3 text-sm"
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) open();
      }}
    >
      <summary className="cursor-pointer text-white/70">Use your profile on another device</summary>
      <div className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-white/70">
            This device&rsquo;s code. Paste it on the other device to be the same player there. Keep
            it to yourself: it is your profile.
          </span>
          <input
            readOnly
            value={identity ? transferCode(identity) : "…"}
            onFocus={(e) => e.target.select()}
            aria-label="Your transfer code"
            className="rounded border border-white/20 bg-black/30 px-2 py-1 font-mono text-xs"
          />
        </label>
        <form
          className="flex flex-col gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            void adoptTransferCode(post, pasted).then((result) => {
              if (!result.ok) return setStatus(result.error);
              setIdentity(result.data);
              setPasted("");
              setStatus("This device now uses that profile.");
            });
          }}
        >
          <span className="text-white/70">Or use a code from another device</span>
          <div className="flex gap-2">
            <input
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              aria-label="Code from another device"
              placeholder="hf1.…"
              className="min-w-0 flex-1 rounded border border-white/20 bg-black/30 px-2 py-1 font-mono text-xs"
            />
            <button
              type="submit"
              disabled={pasted.trim() === ""}
              className="rounded border border-white/30 px-3 py-1 disabled:opacity-40"
            >
              Use it
            </button>
          </div>
        </form>
        {status && (
          <p role="status" className="text-white/80">
            {status}
          </p>
        )}
      </div>
    </details>
  );
}
