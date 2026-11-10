/**
 * Your past games: stats and the recent matches, with Watch again. The redesign's
 * filters and result-colored cards come with its own change; this page gives the
 * history a home of its own in the meantime.
 */
import { MatchHistory } from "../profile/MatchHistory";
import { httpPost, type Post } from "../identity";
import { serverUrl } from "../socket";
import { PageHeader } from "../ui/PageHeader";

export function HistoryPage({ post = httpPost(serverUrl()) }: { readonly post?: Post }) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-5 py-6 md:px-10 md:py-8">
      <PageHeader title="History" />
      <MatchHistory post={post} empty={<p className="text-sm text-muted">No games yet.</p>} />
    </main>
  );
}
