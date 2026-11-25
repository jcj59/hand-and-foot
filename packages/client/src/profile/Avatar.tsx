/**
 * An avatar drawn: a head and shoulders on a colored tile, put together from its
 * parts. Plain SVG with no assets, so it scales from a chip to the editor's
 * preview, and every part is a few shapes.
 *
 * The face parts (eyes, mouth, tops) are drawn in the 40-unit box they were first
 * drawn in, around a head centered at (20, 22.4); `FACE` shrinks that box a little
 * so the shoulders fit under the chin on the same tile.
 */
import { useId } from "react";
import type { Avatar } from "@hf/shared";

/** Each background's color: also the player card's swatches. */
export const BACKGROUND_COLORS: Record<Avatar["background"], string> = {
  teal: "#2fa58f",
  sky: "#4a94d6",
  violet: "#8566d6",
  rose: "#dc5470",
  amber: "#e3a33b",
  lime: "#7fb043",
  slate: "#5b6b80",
  coral: "#e4714f",
};

/** A color mixed `amount` of the way towards the app's page charcoal. */
function toward(hex: string, amount: number): string {
  const page = [0x0f, 0x12, 0x15];
  const mixed = [1, 3, 5].map((at, i) => {
    const c = parseInt(hex.slice(at, at + 2), 16);
    return Math.round(c + (page[i]! - c) * amount);
  });
  return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** The tile's corner radius, out of 40: a rounded square, not a disc. */
export const TILE_RADIUS = 11;

/** The face parts' box, shrunk about the head's middle to leave room for shoulders. */
export const FACE = "translate(2 0) scale(0.9)";

/** The head's outline in the face box: rounded cheeks narrowing to a soft jaw. */
export const HEAD =
  "M20 10.2 C27.6 10.2 32.2 14.8 32.2 21.6 C32.2 25.4 31.4 28.4 29.4 30.8 C27.2 33.4 23.8 34.8 20 34.8 C16.2 34.8 12.8 33.4 10.6 30.8 C8.6 28.4 7.8 25.4 7.8 21.6 C7.8 14.8 12.4 10.2 20 10.2 Z";

/** The tile: the background with light falling from the top. */
export function Tile({
  background,
  light,
}: {
  readonly background: Avatar["background"];
  /** The id of a `TileLight` gradient. */
  readonly light: string;
}) {
  return (
    <>
      <rect width={40} height={40} fill={BACKGROUND_COLORS[background]} />
      <rect width={40} height={40} fill={`url(#${light})`} />
    </>
  );
}

/** The light over a tile, defined once per face (ids are page-wide). */
export function TileLight({ id }: { readonly id: string }) {
  return (
    <linearGradient id={id} x1={0} y1={0} x2={0} y2={1}>
      <stop offset={0} stopColor="#fff" stopOpacity={0.2} />
      <stop offset={0.6} stopColor="#fff" stopOpacity={0} />
      <stop offset={1} stopColor="#000" stopOpacity={0.12} />
    </linearGradient>
  );
}

/** Neck and shoulders, in the tile's own box: a top a shade under the background. */
export function Bust({
  skin,
  background,
}: {
  readonly skin: Avatar["skin"];
  readonly background: Avatar["background"];
}) {
  return (
    <>
      <rect x={16.2} y={25} width={7.6} height={12} rx={2.4} fill={SKIN[skin]} />
      {/* The chin's shadow on the neck. */}
      <rect x={16.2} y={27} width={7.6} height={5.4} fill="#000" opacity={0.16} />
      <path
        d="M1.5 41 C1.5 35.4 6.6 32.8 13.2 32.2 Q20 37.4 26.8 32.2 C33.4 32.8 38.5 35.4 38.5 41 Z"
        fill={toward(BACKGROUND_COLORS[background], 0.42)}
      />
    </>
  );
}

/** Ears and head, in the face box. */
export function Head({ skin }: { readonly skin: Avatar["skin"] }) {
  const fill = SKIN[skin];
  return (
    <>
      {[7.9, 32.1].map((x) => (
        <g key={x}>
          <ellipse cx={x} cy={23} rx={2.2} ry={2.9} fill={fill} />
          <ellipse cx={x} cy={23} rx={1} ry={1.6} fill="#000" opacity={0.12} />
        </g>
      ))}
      <path d={HEAD} fill={fill} />
    </>
  );
}

/** Each skin's color. */
export const SKIN: Record<Avatar["skin"], string> = {
  porcelain: "#fde7d9",
  peach: "#f6c7a1",
  sand: "#e0ac69",
  olive: "#c68642",
  umber: "#8d5524",
  cocoa: "#5c3a21",
  mint: "#a7f3d0",
  lilac: "#d8b4fe",
};

/** Lines drawn on the face: dark, except on the darkest skins, where they would vanish. */
export function inkOn(skin: Avatar["skin"]): string {
  return skin === "cocoa" || skin === "umber" ? "#f1e4d8" : "#1f2937";
}

export const HAIR = "#3b2314";

export function Eyes({ eyes, ink }: { readonly eyes: Avatar["eyes"]; readonly ink: string }) {
  const at = [15.5, 24.5];
  switch (eyes) {
    case "dots":
      return at.map((x) => <ellipse key={x} cx={x} cy={21} rx={1.5} ry={1.85} fill={ink} />);
    case "round":
      return at.map((x) => (
        <g key={x}>
          <circle cx={x} cy={21} r={2.8} fill="#fff" stroke={ink} strokeWidth={0.6} />
          <circle cx={x + 0.4} cy={21.3} r={1.3} fill="#1f2937" />
        </g>
      ));
    case "sleepy":
      return at.map((x) => (
        <path
          key={x}
          d={`M${x - 2.4} 21 q2.4 1.8 4.8 0`}
          stroke={ink}
          strokeWidth={1.2}
          fill="none"
          strokeLinecap="round"
        />
      ));
    case "wink":
      return (
        <>
          <circle cx={15.5} cy={21} r={1.6} fill={ink} />
          <path
            d="M22.1 21.4 q2.4 -2 4.8 0"
            stroke={ink}
            strokeWidth={1.2}
            fill="none"
            strokeLinecap="round"
          />
        </>
      );
    case "glasses":
      return (
        <>
          {at.map((x) => (
            <g key={x}>
              <circle cx={x} cy={21} r={3.3} fill="#ffffff55" stroke={ink} strokeWidth={0.9} />
              <circle cx={x} cy={21} r={1.2} fill={ink} />
            </g>
          ))}
          <path d="M18.8 21 h2.4" stroke={ink} strokeWidth={0.9} />
        </>
      );
    case "shades":
      return (
        <>
          {at.map((x) => (
            <rect key={x} x={x - 3.4} y={18.8} width={6.8} height={4.2} rx={1.6} fill="#111827" />
          ))}
          <path d="M18.6 20 h2.8" stroke="#111827" strokeWidth={1} />
        </>
      );
    case "stars":
      return at.map((x) => (
        <path
          key={x}
          d={`M${x} 18.2 L${x + 0.9} 20.1 L${x + 2.9} 21 L${x + 0.9} 21.9 L${x} 23.8 L${x - 0.9} 21.9 L${x - 2.9} 21 L${x - 0.9} 20.1 Z`}
          fill="#facc15"
          stroke={ink}
          strokeWidth={0.5}
        />
      ));
    case "lashes":
      return at.map((x) => (
        <g key={x} stroke={ink} strokeWidth={0.8} strokeLinecap="round">
          <circle cx={x} cy={21.2} r={1.6} fill={ink} stroke="none" />
          <path d={`M${x - 1.8} 19.4 l-0.9 -1.1 M${x} 19 v-1.4 M${x + 1.8} 19.4 l0.9 -1.1`} />
        </g>
      ));
  }
}

/** The moustache's hair, which an emote's face keeps under its own mouth. */
export const MOUSTACHE =
  "M14.5 27.2 q2.6 -2.6 5.5 -0.8 q2.9 -1.8 5.5 0.8 q-2.8 0.6 -5.5 -0.4 q-2.7 1 -5.5 0.4 z";
/** The beard's hair, likewise. */
export const BEARD =
  "M8.6 24 q0.6 10 11.4 10.2 q10.8 -0.2 11.4 -10.2 q-2.6 3.4 -5.6 3.6 q-3 -1.8 -5.8 -1.8 q-2.8 0 -5.8 1.8 q-3 -0.2 -5.6 -3.6 z";

function Mouth({ mouth, ink }: { readonly mouth: Avatar["mouth"]; readonly ink: string }) {
  const line = { stroke: ink, strokeWidth: 1.2, fill: "none", strokeLinecap: "round" as const };
  switch (mouth) {
    case "smile":
      return <path d="M16 27 q4 3.5 8 0" {...line} />;
    case "grin":
      return (
        <path
          d="M15 26.5 h10 q-0.6 4.8 -5 4.8 q-4.4 0 -5 -4.8 z"
          fill="#fff"
          stroke={ink}
          strokeWidth={0.9}
        />
      );
    case "flat":
      return <path d="M16.5 28 h7" {...line} />;
    case "open":
      return (
        <ellipse cx={20} cy={28.4} rx={2.4} ry={2} fill="#7f1d1d" stroke={ink} strokeWidth={0.6} />
      );
    case "tongue":
      return (
        <>
          <path d="M18 29.2 q2 3 4 0 z" fill="#f472b6" />
          <path d="M15.8 27 q4.2 3.6 8.4 0" {...line} />
        </>
      );
    case "smirk":
      return <path d="M16.5 28.2 q4 1.4 7.5 -1.6" {...line} />;
    case "moustache":
      return (
        <>
          <path d="M17.5 29 q2.5 1.6 5 0" {...line} />
          <path d={MOUSTACHE} fill={HAIR} />
        </>
      );
    case "beard":
      return (
        <>
          <path d={BEARD} fill={HAIR} />
          <path
            d="M17.6 29 q2.4 1.4 4.8 0"
            stroke="#fde7d9"
            strokeWidth={1.1}
            fill="none"
            strokeLinecap="round"
          />
        </>
      );
  }
}

/** A cap of hair over the top of the head, which several tops start from. */
const HAIR_CAP = "M7.2 22.4 a12.8 12.8 0 0 1 25.6 0 q-4.8 -5.8 -12.8 -5.4 q-8 -0.4 -12.8 5.4 z";

/** Short hair: the cap, swept to one side from a parting. */
const SWEPT =
  "M7.6 22.6 C6.8 13.6 12.4 9 20.2 9 C28 9 33.4 13.6 32.4 22.6 C31.4 19 29.6 16.6 27 15.6 C23.4 18.4 16.4 18.8 12 17 C10 18.4 8.6 20.2 7.6 22.6 Z";

/** What sits behind the face: only long hair falls behind it, onto the shoulders. */
export function TopBehind({ top }: { readonly top: Avatar["top"] }) {
  if (top !== "long") return null;
  return (
    <path
      d="M6.4 23 q0 -14 13.6 -14 q13.6 0 13.6 14 v12 q0 3.6 -3.6 3.6 h-20 q-3.6 0 -3.6 -3.6 z"
      fill={HAIR}
    />
  );
}

export function Top({ top }: { readonly top: Avatar["top"] }) {
  switch (top) {
    case "none":
      return null;
    case "short":
      return <path d={SWEPT} fill={HAIR} />;
    case "long":
      return <path d={HAIR_CAP} fill={HAIR} />;
    case "bun":
      return (
        <>
          <circle cx={20} cy={8.4} r={3.8} fill={HAIR} />
          <path d={HAIR_CAP} fill={HAIR} />
        </>
      );
    case "curly":
      return (
        <g fill={HAIR}>
          {[
            [9.6, 17.6],
            [12.4, 13.2],
            [16.6, 10.8],
            [21.4, 10.4],
            [25.8, 12.4],
            [29, 16.4],
            [30.6, 20.4],
            [9, 21],
          ].map(([cx, cy]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={3.4} />
          ))}
        </g>
      );
    case "cap":
      return (
        <>
          <path d="M8.4 18.6 a11.6 10 0 0 1 23.2 0 z" fill="#1d4ed8" />
          <path d="M20 18.6 h14 q0.6 1.8 -1 2 h-13 z" fill="#1e3a8a" />
        </>
      );
    case "beanie":
      return (
        <>
          <path d="M8.2 18.4 a11.8 11 0 0 1 23.6 0 z" fill="#dc2626" />
          <rect x={7.6} y={16.4} width={24.8} height={3.6} rx={1.4} fill="#b91c1c" />
          <circle cx={20} cy={6.6} r={2.4} fill="#fecaca" />
        </>
      );
    case "crown":
      return (
        <path
          d="M11.6 15.6 l-1 -7.4 l4.6 3.6 l4.8 -6 l4.8 6 l4.6 -3.6 l-1 7.4 z"
          fill="#facc15"
          stroke="#a16207"
          strokeWidth={0.7}
        />
      );
    case "bow":
      return (
        <>
          <path d={HAIR_CAP} fill={HAIR} />
          <path d="M25 11 l-4.4 -3 v6 z M25 11 l4.4 -3 v6 z" fill="#ec4899" />
          <circle cx={25} cy={11} r={1.2} fill="#be185d" />
        </>
      );
    case "mohawk":
      return <path d="M17.4 18 q-1 -7 2.6 -13 q3.6 6 2.6 13 z" fill="#db2777" />;
  }
}

/**
 * A face, `size` pixels across. With `label` it is an image of its own (the
 * editor's preview); without, it is decoration beside the name it belongs to.
 */
export function AvatarFace({
  avatar,
  size = 24,
  label,
  className = "",
}: {
  readonly avatar: Avatar;
  readonly size?: number;
  readonly label?: string;
  readonly className?: string;
}): React.ReactElement {
  const ink = inkOn(avatar.skin);
  // Each face has its own clips and light: ids are page-wide, and there are many faces.
  const id = useId();
  const tile = `${id}tile`;
  const light = `${id}light`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={`shrink-0 ${className}`}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      data-avatar={Object.values(avatar).join(" ")}
    >
      <defs>
        <clipPath id={tile}>
          <rect width={40} height={40} rx={TILE_RADIUS} />
        </clipPath>
        <TileLight id={light} />
      </defs>
      <g clipPath={`url(#${tile})`}>
        <Tile background={avatar.background} light={light} />
        <g transform={FACE}>
          <TopBehind top={avatar.top} />
        </g>
        <Bust skin={avatar.skin} background={avatar.background} />
        <g transform={FACE}>
          <Head skin={avatar.skin} />
          <Top top={avatar.top} />
          <Eyes eyes={avatar.eyes} ink={ink} />
          <Mouth mouth={avatar.mouth} ink={ink} />
        </g>
      </g>
    </svg>
  );
}
