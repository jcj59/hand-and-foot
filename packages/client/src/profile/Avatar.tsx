/**
 * An avatar drawn: a face on a coloured disc, put together from its parts. Plain
 * SVG with no assets, so it scales from a chip to the editor's preview, and every
 * part is a few shapes.
 */
import { useId } from "react";
import type { Avatar } from "@hf/shared";

const BACKGROUND: Record<Avatar["background"], string> = {
  teal: "#14b8a6",
  sky: "#38bdf8",
  violet: "#8b5cf6",
  rose: "#f43f5e",
  amber: "#f59e0b",
  lime: "#84cc16",
  slate: "#64748b",
  coral: "#f97316",
};

const SKIN: Record<Avatar["skin"], string> = {
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
function inkOn(skin: Avatar["skin"]): string {
  return skin === "cocoa" || skin === "umber" ? "#f1e4d8" : "#1f2937";
}

const HAIR = "#3b2314";

function Eyes({ eyes, ink }: { readonly eyes: Avatar["eyes"]; readonly ink: string }) {
  const at = [15.5, 24.5];
  switch (eyes) {
    case "dots":
      return at.map((x) => <circle key={x} cx={x} cy={21} r={1.6} fill={ink} />);
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
          <path
            d="M14.5 27.2 q2.6 -2.6 5.5 -0.8 q2.9 -1.8 5.5 0.8 q-2.8 0.6 -5.5 -0.4 q-2.7 1 -5.5 0.4 z"
            fill={HAIR}
          />
        </>
      );
    case "beard":
      return (
        <>
          <path
            d="M8.6 24 q0.6 10 11.4 10.2 q10.8 -0.2 11.4 -10.2 q-2.6 3.4 -5.6 3.6 q-3 -1.8 -5.8 -1.8 q-2.8 0 -5.8 1.8 q-3 -0.2 -5.6 -3.6 z"
            fill={HAIR}
          />
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
const HAIR_CAP = "M7.8 22 a12.2 12.2 0 0 1 24.4 0 q-4.6 -5.6 -12.2 -5.2 q-7.6 -0.4 -12.2 5.2 z";

/** What sits behind the face: only long hair falls behind it. */
function TopBehind({ top }: { readonly top: Avatar["top"] }) {
  if (top !== "long") return null;
  return <path d="M7 22 q0 -13 13 -13 q13 0 13 13 v12 h-26 z" fill={HAIR} />;
}

function Top({ top }: { readonly top: Avatar["top"] }) {
  switch (top) {
    case "none":
      return null;
    case "short":
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
  // Each face clips to its own disc: ids are page-wide, and there are many faces.
  const disc = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={`shrink-0 ${className}`}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      data-avatar={Object.values(avatar).join(" ")}
    >
      <clipPath id={disc}>
        <circle cx={20} cy={20} r={20} />
      </clipPath>
      <g clipPath={`url(#${disc})`}>
        <circle cx={20} cy={20} r={20} fill={BACKGROUND[avatar.background]} />
        <TopBehind top={avatar.top} />
        <circle cx={20} cy={22.4} r={12.2} fill={SKIN[avatar.skin]} />
        <Top top={avatar.top} />
        <Eyes eyes={avatar.eyes} ink={ink} />
        <Mouth mouth={avatar.mouth} ink={ink} />
      </g>
    </svg>
  );
}
