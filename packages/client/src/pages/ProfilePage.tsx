/**
 * Your profile: the account this device is signed in to, or signing in to one.
 * The player card, awards and sounds join it with the profile's own change.
 */
import { AccountPanel } from "../profile/AccountPanel";
import { serverPost, type Post } from "../identity";
import { PageHeader } from "../ui/PageHeader";

export function ProfilePage({ post = serverPost() }: { readonly post?: Post }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-6 md:px-10 md:py-8">
      <PageHeader title="Profile" />
      <AccountPanel post={post} />
    </main>
  );
}
