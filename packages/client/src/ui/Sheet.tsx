/**
 * A sheet: what the design opens over a screen for a choice that needs room (New
 * table, Join with code, a card's menu). On a phone it rises from the bottom edge
 * with a grab handle; on a computer it is a centered dialog. Same content, same
 * accessible name, either way.
 *
 * Portalled to `document.body`, so a scrolling or clipped ancestor cannot cut it
 * off, and modal: Escape and a tap on the backdrop close it, and focus moves into
 * it on open and back where it was on close.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePhone } from "../usePhone";
import { Icon } from "./icons";

export interface SheetProps {
  /** The heading, and the dialog's accessible name. */
  readonly title: string;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
  /**
   * Wider dialogs on a computer (the New table sheet has a preview beside it);
   * `"xl"` wider still, for Practice's three computers to a row.
   */
  readonly wide?: boolean | "xl";
  /** Which sheet this is, whatever its current step's title (`data-sheet`). */
  readonly id?: string;
}

export function Sheet({
  title,
  onClose,
  children,
  wide = false,
  id,
}: SheetProps): React.ReactElement {
  const phone = usePhone();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // Whatever had focus as the sheet opened, read while rendering: a field inside
  // the sheet may take focus for itself (autoFocus) before any effect runs.
  const [before] = useState(() => document.activeElement as HTMLElement | null);

  useEffect(() => {
    // A field that focused itself keeps it; otherwise the sheet takes it, so
    // the keyboard starts inside.
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, [before]);

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex bg-black/60 ${phone ? "items-end" : "items-center justify-center p-6"}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        data-sheet={id}
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`flex max-h-[92dvh] w-full flex-col gap-4 overflow-y-auto border-white/8 bg-sheet text-ink outline-none ${
          phone
            ? "rounded-t-[28px] border-t px-5 pt-2.5 pb-7"
            : `rounded-3xl border p-7 shadow-2xl ${wide === "xl" ? "max-w-[960px]" : wide ? "max-w-3xl" : "max-w-md"}`
        }`}
      >
        {phone && (
          <span
            aria-hidden="true"
            className="h-[5px] w-10 shrink-0 self-center rounded bg-white/20"
          />
        )}
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 font-display text-2xl font-bold tracking-[-0.02em]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/7 text-ink hover:bg-white/12"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
