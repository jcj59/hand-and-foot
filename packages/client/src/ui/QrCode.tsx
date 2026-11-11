/**
 * A QR code, drawn as SVG from the encoder's modules: dark squares on a light
 * card with the quiet zone the standard asks for, so any phone camera reads it.
 * It holds a link, and the label says what scanning it does.
 */
import { useMemo } from "react";
import qrcode from "qrcode-generator";

export interface QrCodeProps {
  readonly value: string;
  /** What it is, for a screen reader: "QR code to join table K7QM2P". */
  readonly label: string;
  /** Its side in pixels. */
  readonly size?: number;
}

/** The modules of a QR code for `value`, row by row; true is dark. Error correction M. */
export function qrModules(value: string): boolean[][] {
  const code = qrcode(0, "M");
  code.addData(value);
  code.make();
  const n = code.getModuleCount();
  return Array.from({ length: n }, (_, row) =>
    Array.from({ length: n }, (_, col) => code.isDark(row, col)),
  );
}

/** Modules of light border around the code: four, as the standard asks. */
const QUIET = 4;

export function QrCode({ value, label, size = 160 }: QrCodeProps): React.ReactElement {
  const path = useMemo(() => {
    const modules = qrModules(value);
    let d = "";
    modules.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
      }),
    );
    return { d, side: modules.length + QUIET * 2 };
  }, [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      data-qr={value}
      width={size}
      height={size}
      viewBox={`0 0 ${path.side} ${path.side}`}
      shapeRendering="crispEdges"
      className="block rounded-xl"
    >
      <rect width={path.side} height={path.side} fill="#F7F5EE" />
      <path d={path.d} fill="#0F1215" />
    </svg>
  );
}
