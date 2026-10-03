/**
 * Which lessons this device has finished. Per device, as the chosen picture is:
 * keeping it on the identity needs the identity to carry more than a name, which
 * waits for accounts (roadmap item 15).
 */
export const PROGRESS_KEY = "hf.tutorial";

export function loadProgress(): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function markDone(id: string): void {
  const done = new Set(loadProgress());
  done.add(id);
  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify([...done]));
  } catch {
    // Blocked storage: the lesson is done for this visit only.
  }
}
