/**
 * Says so when the socket is not up.
 *
 * Worth its own strip rather than being folded into an error toast: the server
 * plays a disconnected player's turns once the reconnect grace elapses, so a
 * player who cannot see that they have dropped is losing turns without being told
 * why. Silent while connected, so the table is uncluttered in the normal case.
 */
import { useSession } from "./session";

export function ConnectionBanner(): React.ReactElement | null {
  const status = useSession((s) => s.status);
  if (status === "connected") return null;

  const connecting = status === "connecting";
  return (
    <div
      role="status"
      className={`px-4 py-2 text-center text-sm font-medium ${
        connecting ? "bg-amber-500/90 text-black" : "bg-red-600 text-white"
      }`}
    >
      {connecting
        ? "Connecting to the table…"
        : "Disconnected, reconnecting now. Your turns may be played for you."}
    </div>
  );
}
