/**
 * The table code as six boxes, one character in each, as the host's screen shows
 * it. Underneath it is one ordinary text field, laid over the boxes and drawn
 * invisibly: typing, deleting, pasting "ABC-234" and a phone's autofill all work
 * as they do in any field, and a screen reader meets one field called "Table
 * code" rather than six fragments. The boxes only show what it holds.
 */
import { useState } from "react";
import { ROOM_CODE_LENGTH } from "@hf/shared";
import { normalizeRoomCode } from "../roomCode";

export interface CodeBoxesProps {
  readonly value: string;
  readonly onChange: (code: string) => void;
  readonly autoFocus?: boolean;
}

export function CodeBoxes({
  value,
  onChange,
  autoFocus = false,
}: CodeBoxesProps): React.ReactElement {
  const [focused, setFocused] = useState(autoFocus);
  const shown = value.slice(0, ROOM_CODE_LENGTH);
  // The box the next character goes into; the last one once all six are in.
  const at = Math.min(shown.length, ROOM_CODE_LENGTH - 1);
  return (
    <label className="relative block">
      <input
        // Named here rather than by the label's text, which also holds what the
        // boxes show.
        aria-label="Table code"
        value={value}
        onChange={(e) => onChange(normalizeRoomCode(e.target.value))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // The browser truncates to this before normalizing ever sees it, so it
        // leaves room for the separators people type: "ABC-234", "a b c 2 3 4".
        maxLength={ROOM_CODE_LENGTH * 2}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0"
      />
      <span aria-hidden="true" className="grid grid-cols-6 gap-2">
        {Array.from({ length: ROOM_CODE_LENGTH }, (_, i) => (
          <span
            key={i}
            data-code-box=""
            className={`flex aspect-[0.9] max-h-16 items-center justify-center rounded-[14px] border bg-raised font-mono text-[28px] font-bold text-ink md:text-[32px] ${
              focused && i === at
                ? "border-accent shadow-[0_0_0_3px_rgba(74,222,155,0.25)]"
                : "border-white/12"
            }`}
          >
            {shown[i] ?? ""}
          </span>
        ))}
      </span>
    </label>
  );
}
