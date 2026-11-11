/**
 * Your profile: the player card (face and name, kept on this device as they
 * change), the awards your matches have given you, the account this device is
 * signed in to, and whether the table makes sounds.
 *
 * A phone stacks it all, the account and Sounds as one settings list; a computer
 * puts the card and awards beside the account and an "At the table" card. The
 * award counts come from the match history, asked of the server once for this
 * browser's identity; until (and unless) it answers, every award reads "Not yet".
 */
import { useEffect, useState } from "react";
import { MATCHES_PATH, type MatchHistory } from "@hf/shared";
import { AccountPanel, SettingsRow } from "../profile/AccountPanel";
import { AwardGrid, SectionHeading } from "../profile/AwardGrid";
import { ProfileCard } from "../profile/ProfileCard";
import { loadAvatar, saveAvatar } from "../profile/avatarStore";
import { loadIdentity, loadName, rememberName, serverPost, type Post } from "../identity";
import { readMuted, writeMuted } from "../table/sounds";
import { PageHeader } from "../ui/PageHeader";
import { usePhone } from "../usePhone";

export function ProfilePage({ post = serverPost() }: { readonly post?: Post }) {
  const phone = usePhone();
  const [name, setName] = useState(loadName);
  const [avatar, setAvatar] = useState(loadAvatar);
  const [muted, setMuted] = useState(readMuted);
  const counts = useAwardCounts(post);

  const card = (
    <ProfileCard
      phone={phone}
      name={name}
      onName={(next) => {
        setName(next);
        rememberName(next);
      }}
      avatar={avatar}
      onAvatar={(next) => {
        setAvatar(next);
        saveAvatar(next);
      }}
    />
  );
  const sounds = (on: boolean): void => {
    setMuted(!on);
    writeMuted(!on);
  };
  const account = (
    <AccountPanel
      post={post}
      phone={phone}
      onSignedIn={setName}
      rows={
        <SettingsRow
          label="Sounds"
          value={muted ? "Off" : "On"}
          role="switch"
          checked={!muted}
          onClick={() => sounds(muted)}
        />
      }
    />
  );

  if (phone) {
    return (
      <main className="flex w-full flex-col gap-4 px-5 pt-5 pb-6">
        <PageHeader title="Profile" />
        {card}
        <AwardGrid counts={counts} phone />
        {account}
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-10 pt-8 pb-12">
      <PageHeader title="Profile" />
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-5">
          {card}
          <AwardGrid counts={counts} phone={false} />
        </div>
        <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-5">
          {account}
          <section aria-label="Settings" className="flex flex-col gap-2.5">
            <SectionHeading>At the table</SectionHeading>
            <label className="flex min-h-[60px] items-center justify-between gap-3 rounded-[18px] border border-white/6 bg-surface px-4">
              <span>
                <span className="block text-[15px] font-medium">Sounds</span>
                <span className="block text-xs text-muted">Card sounds and your-turn chime</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                aria-label="Sounds"
                checked={!muted}
                onChange={(e) => sounds(e.target.checked)}
                className="size-[22px] accent-accent"
              />
            </label>
          </section>
        </div>
      </div>
    </main>
  );
}

/**
 * How many matches gave this player each award, from their history. Null until
 * the server answers, and for a browser that has never sat down (it is not given
 * an identity just to ask).
 */
function useAwardCounts(post: Post): Readonly<Record<string, number>> | null {
  const [counts, setCounts] = useState<Readonly<Record<string, number>> | null>(null);
  useEffect(() => {
    const user = loadIdentity();
    if (!user) return;
    let live = true;
    post(MATCHES_PATH, { user })
      .then((answer) => {
        if (live && answer.ok) setCounts((answer.data as MatchHistory).stats.awards ?? {});
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [post]);
  return counts;
}
