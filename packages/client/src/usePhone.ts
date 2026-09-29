/**
 * Whether the window is phone-sized, for the parts of the table whose markup —
 * not just whose spacing — differs on a phone: opponents as a strip of chips,
 * melds as chips, the hand as one squeezed fan.
 *
 * Read from `matchMedia` rather than guessed from the user agent, so a narrow
 * desktop window gets the phone layout too, and it follows a rotation. Where
 * there is no `matchMedia` (jsdom), it is the desktop layout.
 */
import { useEffect, useState } from "react";

/** Below Tailwind's `md`, where the desktop table starts to fit. */
export const PHONE_QUERY = "(max-width: 767px)";

function matches(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(PHONE_QUERY).matches;
}

export function usePhone(): boolean {
  const [phone, setPhone] = useState(matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(PHONE_QUERY);
    const onChange = (): void => setPhone(query.matches);
    query.addEventListener("change", onChange);
    onChange();
    return () => query.removeEventListener("change", onChange);
  }, []);
  return phone;
}
