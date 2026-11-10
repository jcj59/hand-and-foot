/**
 * The app's buttons, in the three weights the design uses: `primary` (the green
 * one thing to press), `secondary` (a quiet outlined choice beside it) and `ghost`
 * (text-weight, for an aside). One component so the sizes, radii and focus ring
 * stay the same everywhere.
 */
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover",
  secondary: "border border-white/25 bg-black/20 text-ink hover:bg-white/5",
  ghost: "text-ink-soft hover:bg-white/5 hover:text-ink",
  danger: "border border-danger/50 text-danger-soft hover:bg-danger/10",
};

const SIZES: Record<ButtonSize, string> = {
  md: "min-h-11 rounded-xl px-4 text-sm",
  lg: "min-h-[50px] rounded-[14px] px-5 text-[15px]",
};

/** The shared classes, for a link or label that has to look like a button. */
export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  extra = "",
): string {
  return [
    "inline-flex items-center justify-center gap-2 font-display font-semibold transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    "disabled:cursor-not-allowed disabled:opacity-40",
    VARIANTS[variant],
    SIZES[size],
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...rest
}: ButtonProps): React.ReactElement {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}
