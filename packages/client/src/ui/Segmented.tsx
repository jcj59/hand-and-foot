/**
 * A segmented control: two to four mutually exclusive choices side by side, each
 * with an optional second line, as the New table sheet picks a variant and a mode.
 *
 * It is a radio group underneath, so a screen reader announces it as one choice
 * and the arrow keys move between options.
 */
import { useId } from "react";

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly detail?: string;
}

export interface SegmentedProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: readonly SegmentedOption<T>[];
  readonly onChange: (value: T) => void;
  /** Hide the visible legend (it stays the group's accessible name). */
  readonly hideLabel?: boolean;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  hideLabel = false,
}: SegmentedProps<T>): React.ReactElement {
  const name = useId();
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend
        className={
          hideLabel
            ? "sr-only"
            : "mb-2 text-xs font-semibold tracking-[0.06em] text-quiet uppercase"
        }
      >
        {label}
      </legend>
      <div
        className="grid gap-1 rounded-[14px] bg-page p-1"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option) => {
          const on = option.value === value;
          return (
            <label
              key={option.value}
              className={`flex min-h-[52px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[10px] px-2 text-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                on
                  ? "bg-selected text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                  : "text-quiet hover:text-ink-soft"
              }`}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={on}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              <span className="font-display text-[15px] font-semibold">{option.label}</span>
              {option.detail && <span className="text-[11px] opacity-75">{option.detail}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
