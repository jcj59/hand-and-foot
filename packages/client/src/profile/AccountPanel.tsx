/**
 * Being the same player on every device: sign in with a username and password, or
 * give this device's profile one so the others can.
 *
 * Folded away on the home screen, like the rest of the profile — most people play
 * on one device and never open it. Signed in, it offers changing the password
 * (which signs every other device out, the one thing to do about a lost phone) and
 * signing this device out. There is no reset for a forgotten password, so the
 * place a password is chosen says so, and asks for it twice.
 *
 * The transfer code is still here, folded inside, for a profile that has no
 * username: it moves the whole profile without choosing anything.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import {
  MAX_PASSWORD_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  transferCode,
  type Ack,
  type UserCredentials,
} from "@hf/shared";
import {
  adoptTransferCode,
  changePassword,
  claimAccount,
  loadAccount,
  loadName,
  prepareIdentity,
  signIn,
  signOut,
  type Post,
} from "../identity";

export function AccountPanel({
  post,
  onSignedIn,
}: {
  readonly post: Post;
  /** Told the profile's name when this device signs in, to offer it for sitting down. */
  readonly onSignedIn?: (name: string) => void;
}): React.ReactElement {
  const [account, setAccount] = useState<string | null>(() => loadAccount());
  const [status, setStatus] = useState<string | null>(null);
  // Shown only once the server knows it: a code for an identity never registered
  // would be refused on the other device.
  const [identity, setIdentity] = useState<UserCredentials | null>(null);
  const [asked, setAsked] = useState(false);

  const open = (): void => {
    if (asked) return;
    setAsked(true);
    void prepareIdentity(post, loadName()).then((ready) => {
      // Registering also says whether this device is still signed in.
      setAccount(loadAccount());
      // A profile taken on while this was in flight is the one to show; keep it.
      if (ready) setIdentity((current) => current ?? ready);
      else setStatus("Could not reach the server to set up your profile. Try again later.");
    });
  };

  const signedIn = (username: string, credentials: UserCredentials | null): void => {
    setAccount(username);
    setIdentity(credentials);
  };

  return (
    <details
      className="rounded border border-white/10 bg-black/15 p-3 text-sm"
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) open();
      }}
    >
      <summary className="cursor-pointer text-white/70">
        {account ? `Signed in as ${account}` : "Sign in, or use your profile on another device"}
      </summary>
      <div className="mt-3 flex flex-col gap-4">
        {account ? (
          <SignedIn
            post={post}
            account={account}
            onStatus={setStatus}
            onSignedOut={() => {
              setAccount(null);
              setIdentity(null);
              setAsked(false);
            }}
          />
        ) : (
          <SignedOut
            post={post}
            identity={identity}
            onStatus={setStatus}
            onSignedIn={signedIn}
            onName={(name) => onSignedIn?.(name)}
            onAdopted={setIdentity}
          />
        )}
        {status && (
          <p role="status" className="text-white/80">
            {status}
          </p>
        )}
      </div>
    </details>
  );
}

function SignedIn({
  post,
  account,
  onStatus,
  onSignedOut,
}: {
  readonly post: Post;
  readonly account: string;
  readonly onStatus: (status: string) => void;
  readonly onSignedOut: () => void;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <p className="text-white/70">
        Sign in as <span className="font-medium text-white">{account}</span> on your other devices
        to be the same player there.
      </p>
      <details>
        <summary className="cursor-pointer text-white/70">Change password</summary>
        <div className="mt-2">
          <PasswordForm
            label="Change password"
            intro="Changing it signs out every other device, so a lost phone stops being you."
            current
            submit="Change password"
            onSubmit={async ({ password, newPassword }) => {
              const answer = await changePassword(post, password, newPassword);
              onStatus(
                answer.ok
                  ? "Password changed. Every other device has been signed out."
                  : capitalize(answer.error),
              );
              return answer.ok;
            }}
          />
        </div>
      </details>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void signOut(post).then(() => {
            onSignedOut();
            onStatus("Signed out. This device will start a new profile when you next play.");
          });
        }}
        className="self-start rounded border border-white/30 px-3 py-1 disabled:opacity-40"
      >
        Sign out on this device
      </button>
    </>
  );
}

function SignedOut({
  post,
  identity,
  onStatus,
  onSignedIn,
  onName,
  onAdopted,
}: {
  readonly post: Post;
  readonly identity: UserCredentials | null;
  readonly onStatus: (status: string) => void;
  readonly onSignedIn: (username: string, credentials: UserCredentials | null) => void;
  readonly onName: (name: string) => void;
  readonly onAdopted: (credentials: UserCredentials) => void;
}): React.ReactElement {
  return (
    <>
      <SignInForm
        onSubmit={async (username, password) => {
          const answer = await signIn(post, username, password);
          if (!answer.ok) {
            onStatus(capitalize(answer.error));
            return false;
          }
          onSignedIn(answer.data.username, {
            userId: answer.data.userId,
            secret: answer.data.secret,
          });
          if (answer.data.name) onName(answer.data.name);
          onStatus(`Signed in as ${answer.data.username}. This device now plays as that profile.`);
          return true;
        }}
      />
      <hr className="border-white/10" />
      <PasswordForm
        label="Choose a username"
        heading="New here? Choose a username"
        intro="Give this device's profile a username and password, then sign in with them on your
          other devices. There is no way to reset a forgotten password, so choose one you will
          remember."
        username
        submit="Save username"
        onSubmit={async ({ username, newPassword }) => {
          const answer = await claimAccount(post, username, newPassword);
          if (!answer.ok) {
            onStatus(capitalize(answer.error));
            return false;
          }
          onSignedIn(answer.data, identity);
          onStatus(`This profile is now ${answer.data}. Sign in with it on your other devices.`);
          return true;
        }}
      />
      <details>
        <summary className="cursor-pointer text-white/70">Or move it with a code</summary>
        <TransferCode
          post={post}
          identity={identity}
          onStatus={onStatus}
          onAdopted={(credentials, username) => {
            if (username) onSignedIn(username, credentials);
            else onAdopted(credentials);
          }}
        />
      </details>
    </>
  );
}

function SignInForm({
  onSubmit,
}: {
  readonly onSubmit: (username: string, password: string) => Promise<boolean>;
}): React.ReactElement {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setBusy(true);
    void onSubmit(username.trim(), password).then((done) => {
      setBusy(false);
      if (done) setPassword("");
    });
  };
  return (
    <form aria-label="Sign in" className="flex flex-col gap-2" onSubmit={submit}>
      <h3 className="font-medium text-white">Sign in</h3>
      <span className="text-white/70">
        Have a username already? Sign in to play as that profile here. Games played on this device
        before signing in stay with its old profile.
      </span>
      <Field label="Username">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={MAX_USERNAME_LENGTH + 4}
          className={INPUT}
        />
      </Field>
      <Field label="Password">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          maxLength={MAX_PASSWORD_LENGTH}
          className={INPUT}
        />
      </Field>
      <button
        type="submit"
        disabled={busy || username.trim() === "" || password === ""}
        className={BUTTON}
      >
        Sign in
      </button>
    </form>
  );
}

/**
 * A new password, typed twice, with the current one or a username beside it:
 * choosing a username and changing the password are the same form.
 */
function PasswordForm({
  label,
  heading,
  intro,
  current = false,
  username: withUsername = false,
  submit,
  onSubmit,
}: {
  readonly label: string;
  /** Shown above the form; none when a fold around it already says what it is. */
  readonly heading?: string;
  readonly intro: string;
  readonly current?: boolean;
  readonly username?: boolean;
  readonly submit: string;
  readonly onSubmit: (values: {
    username: string;
    password: string;
    newPassword: string;
  }) => Promise<boolean>;
}): React.ReactElement {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const short = newPassword !== "" && newPassword.length < MIN_PASSWORD_LENGTH;
  const mismatch = again !== "" && again !== newPassword;
  const ready =
    newPassword.length >= MIN_PASSWORD_LENGTH &&
    again === newPassword &&
    (!current || password !== "") &&
    (!withUsername || username.trim() !== "");

  const send = (event: FormEvent): void => {
    event.preventDefault();
    setBusy(true);
    void onSubmit({ username: username.trim(), password, newPassword }).then((done) => {
      setBusy(false);
      if (!done) return;
      setPassword("");
      setNewPassword("");
      setAgain("");
    });
  };

  return (
    <form aria-label={label} className="flex flex-col gap-2" onSubmit={send}>
      {heading && <h3 className="font-medium text-white">{heading}</h3>}
      <span className="text-white/70">{intro}</span>
      {withUsername && (
        <Field label="Username">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={MAX_USERNAME_LENGTH}
            className={INPUT}
          />
        </Field>
      )}
      {current && (
        <Field label="Current password">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            maxLength={MAX_PASSWORD_LENGTH}
            className={INPUT}
          />
        </Field>
      )}
      <Field label={current ? "New password" : "Password"}>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          maxLength={MAX_PASSWORD_LENGTH}
          className={INPUT}
        />
      </Field>
      <Field label={current ? "New password again" : "Password again"}>
        <input
          type="password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          autoComplete="new-password"
          maxLength={MAX_PASSWORD_LENGTH}
          className={INPUT}
        />
      </Field>
      {(short || mismatch) && (
        <p className="text-amber-200">
          {short
            ? `A password needs at least ${MIN_PASSWORD_LENGTH} characters.`
            : "The two passwords are not the same."}
        </p>
      )}
      <button type="submit" disabled={busy || !ready} className={BUTTON}>
        {submit}
      </button>
    </form>
  );
}

function TransferCode({
  post,
  identity,
  onStatus,
  onAdopted,
}: {
  readonly post: Post;
  readonly identity: UserCredentials | null;
  readonly onStatus: (status: string) => void;
  readonly onAdopted: (credentials: UserCredentials, username: string | null) => void;
}): React.ReactElement {
  const [pasted, setPasted] = useState("");
  return (
    <div className="mt-2 flex flex-col gap-3">
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
          void adoptTransferCode(post, pasted).then((result: Ack<UserCredentials>) => {
            if (!result.ok) return onStatus(result.error);
            setPasted("");
            onAdopted(result.data, loadAccount());
            onStatus("This device now uses that profile.");
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
    </div>
  );
}

function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): React.ReactElement {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-white/70">{label}</span>
      {children}
    </label>
  );
}

const INPUT = "rounded border border-white/20 bg-black/30 px-2 py-1 text-white";
const BUTTON = "self-start rounded border border-white/30 px-3 py-1 disabled:opacity-40";

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
