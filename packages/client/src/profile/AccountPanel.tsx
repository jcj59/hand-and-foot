/**
 * Being the same player on every device: sign in with a username and password, or
 * give this device's profile one so the others can. It is the Account part of the
 * Profile page.
 *
 * On a computer it is a card: the username (or "Not signed in") with Change
 * password (or Sign in) beside it, then Add a device and Sign out of this browser.
 * On a phone it is rows ("Signed in as", "Other devices") in Profile's settings
 * list, each opening a sheet. Changing the password signs every other device out,
 * the one thing to do about a lost phone. There is no reset for a forgotten
 * password, so the place a password is chosen says so, and asks for it twice.
 *
 * The transfer code is still here, under Add a device, for a profile that has no
 * username: it moves the whole profile without choosing anything.
 *
 * The profile is registered with the server when the page opens on a device that
 * already has one (which also says whether it is still signed in), or else when a
 * sheet is first opened, so a device that never played is not given a profile
 * just for looking.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
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
  loadIdentity,
  loadName,
  prepareIdentity,
  signIn,
  signOut,
  type Post,
} from "../identity";
import { Button, buttonClass } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { SectionHeading } from "./AwardGrid";

type SheetName = "account" | "signIn" | "password" | "devices";

const SHEET_TITLE: Record<SheetName, string> = {
  account: "Your account",
  signIn: "Sign in",
  password: "Change password",
  devices: "Other devices",
};

export function AccountPanel({
  post,
  phone = false,
  rows,
  onSignedIn,
}: {
  readonly post: Post;
  readonly phone?: boolean;
  /** On a phone, more rows for the same list (Sounds), under the account's own. */
  readonly rows?: ReactNode;
  /** Told the profile's name when this device signs in, to show it on the card. */
  readonly onSignedIn?: (name: string) => void;
}): React.ReactElement {
  const [account, setAccount] = useState<string | null>(() => loadAccount());
  const [status, setStatus] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  // Shown only once the server knows it: a code for an identity never registered
  // would be refused on the other device.
  const [identity, setIdentity] = useState<UserCredentials | null>(null);
  const [asked, setAsked] = useState(false);

  const prepare = (): void => {
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

  // A device that has a profile checks it as the page opens: one signed out
  // elsewhere should not go on saying it is signed in.
  useEffect(() => {
    if (loadIdentity()) prepare();
    // Once, as the page opens: `prepare` itself guards against asking twice.
  }, []);

  const show = (name: SheetName): void => {
    prepare();
    setStatus(null);
    setSheet(name);
  };

  const signedIn = (username: string, credentials: UserCredentials | null): void => {
    setAccount(username);
    setIdentity(credentials);
  };

  const [leaving, setLeaving] = useState(false);
  const leave = (): void => {
    setLeaving(true);
    void signOut(post).then(() => {
      setLeaving(false);
      setAccount(null);
      setIdentity(null);
      setAsked(false);
      setSheet(null);
      setStatus("Signed out. This device will start a new profile when you next play.");
    });
  };

  const statusLine = status && (
    <p role="status" className="m-0 text-sm text-ink-soft">
      {status}
    </p>
  );

  const signOutButton = (
    <button
      type="button"
      disabled={leaving}
      onClick={leave}
      className={buttonClass("ghost", "md", "text-salmon! font-medium")}
    >
      Sign out of this browser
    </button>
  );

  const body = (name: SheetName): ReactNode => {
    switch (name) {
      case "account":
        return (
          <>
            <p className="m-0 text-muted">
              <span className="font-semibold text-ink">@{account}</span> is the same player on every
              device you sign in on.
            </p>
            <div className="flex flex-wrap gap-2.5">
              <Button variant="secondary" onClick={() => setSheet("password")}>
                Change password
              </Button>
              {signOutButton}
            </div>
          </>
        );
      case "signIn":
        return (
          <SignedOut
            post={post}
            identity={identity}
            onStatus={setStatus}
            onSignedIn={(username, credentials) => {
              signedIn(username, credentials);
              setSheet(null);
            }}
            onName={(n) => onSignedIn?.(n)}
          />
        );
      case "password":
        return (
          <PasswordForm
            label="Change password"
            intro="Changing it signs out every other device, so a lost phone stops being you."
            current
            submit="Change password"
            onSubmit={async ({ password, newPassword }) => {
              const answer = await changePassword(post, password, newPassword);
              setStatus(
                answer.ok
                  ? "Password changed. Every other device has been signed out."
                  : capitalize(answer.error),
              );
              return answer.ok;
            }}
          />
        );
      case "devices":
        return account ? (
          <>
            <p className="m-0 text-muted">
              To add a device, open Profile on it and sign in as{" "}
              <span className="font-semibold text-ink">@{account}</span>.
            </p>
            <p className="m-0 text-muted">
              Lost one? Changing your password signs out every other device.
            </p>
            <Button variant="secondary" className="self-start" onClick={() => setSheet("password")}>
              Change password
            </Button>
          </>
        ) : (
          <TransferCode
            post={post}
            identity={identity}
            onStatus={setStatus}
            onAdopted={(credentials, username) => {
              if (username) signedIn(username, credentials);
              else setIdentity(credentials);
            }}
          />
        );
    }
  };

  const open = sheet && (
    <Sheet title={SHEET_TITLE[sheet]} id={`account-${sheet}`} onClose={() => setSheet(null)}>
      <div className="flex flex-col gap-4 text-sm">
        {body(sheet)}
        {statusLine}
      </div>
    </Sheet>
  );

  if (phone) {
    return (
      <section aria-label="Account" className="flex flex-col gap-2">
        <SectionHeading>Account &amp; settings</SectionHeading>
        <div className="rounded-2xl border border-white/6 bg-surface">
          <SettingsRow
            label={account ? "Signed in as" : "Account"}
            value={account ? `@${account}` : "Sign in"}
            onClick={() => show(account ? "account" : "signIn")}
            first
          />
          <SettingsRow
            label="Other devices"
            value={account ? "Add or sign out" : "Add a device"}
            onClick={() => show("devices")}
          />
          {rows}
        </div>
        {!sheet && statusLine}
        {open}
      </section>
    );
  }

  return (
    <section aria-label="Account" className="flex flex-col gap-2.5">
      <SectionHeading>Account</SectionHeading>
      <div className="flex flex-col gap-3.5 rounded-[18px] border border-white/6 bg-surface p-[18px]">
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block font-semibold">{account ? `@${account}` : "Not signed in"}</span>
            <span className="block text-[13px] text-muted">
              {account
                ? "The same player on every device you sign in on"
                : "Sign in to be the same player on every device"}
            </span>
          </span>
          <Button
            variant="secondary"
            className="shrink-0"
            onClick={() => show(account ? "password" : "signIn")}
          >
            {account ? "Change password" : "Sign in"}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2.5 border-t border-white/6 pt-3.5">
          <button
            type="button"
            onClick={() => show("devices")}
            className={buttonClass("ghost", "md", "bg-accent/10! text-accent! hover:bg-accent/15!")}
          >
            Add a device
          </button>
          {account && signOutButton}
        </div>
        {!sheet && statusLine}
      </div>
      {open}
    </section>
  );
}

/** One row of the phone's settings list: what it is, and what it is set to. */
export function SettingsRow({
  label,
  value,
  onClick,
  first = false,
  role,
  checked,
}: {
  readonly label: string;
  readonly value: string;
  readonly onClick: () => void;
  readonly first?: boolean;
  /** `"switch"` for a row that turns something on and off rather than opening a sheet. */
  readonly role?: "switch";
  readonly checked?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role ? checked : undefined}
      aria-label={role ? label : undefined}
      onClick={onClick}
      className={`flex min-h-[52px] w-full items-center justify-between px-3.5 text-left text-[15px] font-medium hover:bg-white/3 ${
        first ? "" : "border-t border-white/5"
      }`}
    >
      <span>{label}</span>
      <span className="text-sm text-muted">
        {value}
        {!role && <span aria-hidden="true"> ›</span>}
      </span>
    </button>
  );
}

function SignedOut({
  post,
  identity,
  onStatus,
  onSignedIn,
  onName,
}: {
  readonly post: Post;
  readonly identity: UserCredentials | null;
  readonly onStatus: (status: string) => void;
  readonly onSignedIn: (username: string, credentials: UserCredentials | null) => void;
  readonly onName: (name: string) => void;
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
      <hr className="m-0 border-white/10" />
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
      <span className="text-muted">
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
      {heading && <h3 className="m-0 font-display text-base font-semibold text-ink">{heading}</h3>}
      <span className="text-muted">{intro}</span>
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
        <p className="m-0 text-gold">
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
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-muted">
          This device&rsquo;s code. Paste it on the other device to be the same player there. Keep
          it to yourself: it is your profile.
        </span>
        <input
          readOnly
          value={identity ? transferCode(identity) : "…"}
          onFocus={(e) => e.target.select()}
          aria-label="Your transfer code"
          className={`${INPUT} font-mono text-xs`}
        />
      </label>
      <form
        className="flex flex-col gap-1.5"
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
        <span className="text-muted">Or use a code from another device</span>
        <div className="flex gap-2">
          <input
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            aria-label="Code from another device"
            placeholder="hf1.…"
            className={`${INPUT} min-w-0 flex-1 font-mono text-xs`}
          />
          <button
            type="submit"
            disabled={pasted.trim() === ""}
            className={buttonClass("secondary")}
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
    <label className="flex flex-col gap-1.5">
      <span className="text-muted">{label}</span>
      {children}
    </label>
  );
}

const INPUT =
  "min-h-11 rounded-xl border border-white/16 bg-black/25 px-3 text-ink placeholder:text-faint";
const BUTTON = buttonClass("primary", "md", "self-start");

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
