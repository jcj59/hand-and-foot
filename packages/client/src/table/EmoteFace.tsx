/**
 * An emote drawn: the sender's own face (`profile/Avatar.tsx`'s parts) with the
 * emote's expression over it, from the model in `emotes.ts`. Plain SVG; the
 * motion is CSS (`.emote-*` in `index.css`), so reduced motion stops it there,
 * and every piece rests where the still picture wants it, which is what a still
 * face (the picker, reduced motion) shows.
 *
 * The face is drawn in the avatar's 40-unit box, in a 64-unit view around it, so
 * arms, steam, a thumb and confetti have room outside the tile. What sits on the
 * face (tears, sweat, sunglasses) is drawn in the avatar's face box (`FACE`).
 */
import { useId, type CSSProperties } from "react";
import type { Avatar } from "@hf/shared";
import {
  BEARD,
  Bust,
  Eyes,
  FACE,
  HAIR,
  HEAD,
  Head,
  MOUSTACHE,
  SKIN,
  TILE_RADIUS,
  Tile,
  TileLight,
  Top,
  TopBehind,
  inkOn,
} from "../profile/Avatar";
import { emoteLook, type EmoteEyes, type EmoteId, type EmoteMouth } from "./emotes";

const TEAR = "#60a5fa";
const MOUTH_INSIDE = "#7f1d1d";
const TONGUE = "#f472b6";

function ExpressionEyes({ eyes, ink }: { readonly eyes: EmoteEyes; readonly ink: string }) {
  const line = {
    stroke: ink,
    strokeWidth: 1.4,
    fill: "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (eyes) {
    case "own":
      return null;
    case "squeezed":
      return (
        <>
          <path d="M13.4 19.2 l3.4 1.9 l-3.4 1.9" {...line} />
          <path d="M26.6 19.2 l-3.4 1.9 l3.4 1.9" {...line} />
        </>
      );
    case "sobbing":
      return (
        <>
          <path d="M13.2 20.6 q2.3 1.8 4.6 0" {...line} />
          <path d="M22.2 20.6 q2.3 1.8 4.6 0" {...line} />
          {/* Brows raised in the middle: misery. */}
          <path d="M12.6 17.4 L17.8 15.8 M27.4 17.4 L22.2 15.8" {...line} strokeWidth={1.2} />
        </>
      );
    case "glare":
      return (
        <>
          <circle cx={15.5} cy={21.6} r={1.5} fill={ink} />
          <circle cx={24.5} cy={21.6} r={1.5} fill={ink} />
          {/* Brows down hard towards the nose. */}
          <path d="M12.2 16.8 L18.2 19.2 M27.8 16.8 L21.8 19.2" {...line} strokeWidth={1.8} />
        </>
      );
    case "wide":
      return (
        <>
          {[15.2, 24.8].map((x) => (
            <g key={x}>
              <circle cx={x} cy={21} r={3.5} fill="#fff" stroke={ink} strokeWidth={0.7} />
              <circle cx={x} cy={21} r={1.1} fill="#1f2937" />
            </g>
          ))}
          <path
            d="M12 15.6 q3.2 -2.2 6.4 0 M21.6 15.6 q3.2 -2.2 6.4 0"
            {...line}
            strokeWidth={1.1}
          />
        </>
      );
    case "happy":
      return (
        <>
          <path d="M13.2 21.8 q2.3 -2.6 4.6 0" {...line} />
          <path d="M22.2 21.8 q2.3 -2.6 4.6 0" {...line} />
        </>
      );
    case "wince":
      return (
        <>
          <path d="M13.6 19.4 l3.2 1.7 l-3.2 1.7" {...line} />
          <circle cx={24.5} cy={21.2} r={1.5} fill={ink} />
          <path d="M22 17.2 q2.6 -1.4 5.2 0.4" {...line} strokeWidth={1.1} />
        </>
      );
  }
}

function ExpressionMouth({ mouth, ink }: { readonly mouth: EmoteMouth; readonly ink: string }) {
  switch (mouth) {
    case "laugh":
      return (
        <g>
          <path
            d="M13.6 25.8 h12.8 q-0.6 7 -6.4 7 q-5.8 0 -6.4 -7 z"
            fill={MOUTH_INSIDE}
            stroke={ink}
            strokeWidth={0.8}
            strokeLinejoin="round"
          />
          <path d="M14 26.2 h12 l-0.2 1.6 h-11.6 z" fill="#fff" />
          <ellipse cx={20} cy={31} rx={3.4} ry={1.5} fill={TONGUE} />
        </g>
      );
    case "wail":
      return (
        <path
          d="M14.6 31.6 q0.6 -6 5.4 -6 q4.8 0 5.4 6 q-5.4 -2 -10.8 0 z"
          fill={MOUTH_INSIDE}
          stroke={ink}
          strokeWidth={0.8}
          strokeLinejoin="round"
        />
      );
    case "snarl":
      return (
        <g stroke={ink} strokeWidth={0.8}>
          <rect x={14.6} y={26.4} width={10.8} height={4.2} rx={1.4} fill="#fff" />
          <path d="M14.6 28.5 h10.8 M18.2 26.4 v4.2 M21.8 26.4 v4.2" fill="none" />
        </g>
      );
    case "grin":
      return (
        <path
          d="M14.4 26 h11.2 q-0.6 5.6 -5.6 5.6 q-5 0 -5.6 -5.6 z"
          fill="#fff"
          stroke={ink}
          strokeWidth={0.9}
          strokeLinejoin="round"
        />
      );
    case "gape":
      return (
        // The jaw drops: `.emote-jaw` stretches it down from its top.
        <ellipse
          className="emote-jaw"
          cx={20}
          cy={29.8}
          rx={2.8}
          ry={3.8}
          fill={MOUTH_INSIDE}
          stroke={ink}
          strokeWidth={0.7}
        />
      );
    case "cheer":
      return (
        <g>
          <path
            d="M15 26.2 h10 q0 6 -5 6 q-5 0 -5 -6 z"
            fill={MOUTH_INSIDE}
            stroke={ink}
            strokeWidth={0.8}
            strokeLinejoin="round"
          />
          <ellipse cx={20} cy={30.4} rx={2.6} ry={1.3} fill={TONGUE} />
        </g>
      );
    case "grimace":
      return (
        <g stroke={ink} strokeWidth={0.8}>
          <path d="M13.8 26.8 q6.2 -1.4 12.4 0 v3.4 q-6.2 1.4 -12.4 0 z" fill="#fff" />
          <path d="M13.8 28.5 q6.2 -0.6 12.4 0 M17 26.2 v4.6 M20 26 v5 M23 26.2 v4.6" fill="none" />
        </g>
      );
    case "smirk":
      return (
        <path
          d="M16 28.4 q4.4 1.6 8.4 -2"
          stroke={ink}
          strokeWidth={1.3}
          fill="none"
          strokeLinecap="round"
        />
      );
  }
}

/** Confetti around a cheer: where each piece rests, its color, turn and delay. */
const CONFETTI: readonly (readonly [number, number, string, number, number])[] = [
  [-6, -6, "#facc15", 20, 0],
  [2, -11, "#f43f5e", -30, 120],
  [11, -8, "#38bdf8", 45, 60],
  [20, -12, "#a3e635", 10, 200],
  [29, -7, "#f97316", -50, 30],
  [38, -10, "#e879f9", 30, 160],
  [46, -4, "#facc15", -15, 90],
  [-9, 6, "#38bdf8", 60, 240],
  [49, 7, "#f43f5e", -40, 180],
  [-4, 18, "#a3e635", 25, 300],
  [45, 20, "#e879f9", -25, 260],
  [6, -2, "#f97316", 70, 340],
  [34, -1, "#facc15", -65, 380],
  [16, -6, "#e879f9", 35, 420],
];

/**
 * The emote `id` on `avatar`'s face, filling its box. `still` draws it without
 * motion: the picker's pictures. (Reduced motion stills it in CSS.)
 */
export function EmoteFace({
  avatar,
  id,
  still = false,
  className = "",
}: {
  readonly avatar: Avatar;
  readonly id: EmoteId;
  readonly still?: boolean;
  readonly className?: string;
}): React.ReactElement {
  const look = emoteLook(avatar, id, still);
  const ink = inkOn(avatar.skin);
  const skin = SKIN[avatar.skin];
  const uid = useId();
  const tile = `${uid}tile`;
  const head = `${uid}head`;
  const light = `${uid}light`;
  const has = (extra: (typeof look.extras)[number]) => look.extras.includes(extra);
  // Each moving part is named only when it moves; still, it rests in place.
  const moving = (name: string) => (look.motion ? name : "");
  return (
    <svg
      viewBox="-12 -14 64 64"
      className={`overflow-visible ${className}`}
      aria-hidden
      data-emote={id}
      data-still={look.motion ? undefined : ""}
      data-avatar={Object.values(avatar).join(" ")}
    >
      <defs>
        <clipPath id={tile}>
          <rect width={40} height={40} rx={TILE_RADIUS} />
        </clipPath>
        <clipPath id={head}>
          <path d={HEAD} />
        </clipPath>
        <TileLight id={light} />
      </defs>
      <g className={look.motion ? `emote-motion emote-${look.motion}` : undefined}>
        {has("arms-up") && (
          <g className={moving("emote-arms")} stroke={ink} strokeWidth={0.8}>
            {/* Behind the disc, thrown up either side of the head. */}
            <path d="M6 34 L-4 4" stroke={skin} strokeWidth={5} strokeLinecap="round" fill="none" />
            <path
              d="M34 34 L44 4"
              stroke={skin}
              strokeWidth={5}
              strokeLinecap="round"
              fill="none"
            />
            <circle cx={-4.6} cy={2.4} r={3.6} fill={skin} />
            <circle cx={44.6} cy={2.4} r={3.6} fill={skin} />
          </g>
        )}
        <g clipPath={`url(#${tile})`}>
          <Tile background={avatar.background} light={light} />
          <g transform={FACE}>
            <TopBehind top={avatar.top} />
          </g>
          <Bust skin={avatar.skin} background={avatar.background} />
          <g transform={FACE}>
            <Head skin={avatar.skin} />
            {has("flush") && (
              <g clipPath={`url(#${head})`}>
                <rect
                  className={moving("emote-flush")}
                  x={7}
                  y={10}
                  width={26}
                  height={26}
                  fill="#dc2626"
                  opacity={0.5}
                />
              </g>
            )}
            <Top top={avatar.top} />
            {look.eyes === "own" ? (
              <Eyes eyes={avatar.eyes} ink={ink} />
            ) : look.shades ? (
              <Eyes eyes="shades" ink={ink} />
            ) : (
              <ExpressionEyes eyes={look.eyes} ink={ink} />
            )}
            {look.glasses && look.eyes !== "own" && (
              <g fill="none" stroke={ink} strokeWidth={0.9}>
                <circle cx={15.5} cy={21} r={3.6} />
                <circle cx={24.5} cy={21} r={3.6} />
                <path d="M19.1 21 h1.8" />
              </g>
            )}
            {look.facialHair && (
              <path d={look.facialHair === "beard" ? BEARD : MOUSTACHE} fill={HAIR} />
            )}
            <ExpressionMouth mouth={look.mouth} ink={ink} />
            {has("tear-streams") &&
              [14.6, 25.4].map((x) => (
                <path
                  key={x}
                  className={moving("emote-stream")}
                  d={`M${x} 22.6 q${x < 20 ? -1.6 : 1.6} 6 ${x < 20 ? -2.2 : 2.2} 14`}
                  stroke={TEAR}
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  fill="none"
                  opacity={0.9}
                />
              ))}
          </g>
        </g>
        <g transform={FACE}>
          {has("joy-tears") &&
            [
              [9.6, 19.6, -1],
              [30.4, 19.6, 1],
            ].map(([x, y, side]) => (
              <path
                key={x}
                className={moving(side! < 0 ? "emote-joy-left" : "emote-joy-right")}
                d={`M${x} ${y} q${side! * 3.2} 2.4 ${side! * 1.8} 4.6 q${side! * -1.6} 1.2 ${side! * -2.4} -0.6 q${side! * -0.4} -1.8 ${side! * 0.6} -4 z`}
                fill={TEAR}
                stroke="#1d4ed8"
                strokeWidth={0.4}
              />
            ))}
          {has("sweat") && (
            <path
              className={moving("emote-sweat")}
              d="M31.4 10.4 q2.6 3.6 2.6 5.4 a2.6 2.6 0 0 1 -5.2 0 q0 -1.8 2.6 -5.4 z"
              fill="#93c5fd"
              stroke="#1d4ed8"
              strokeWidth={0.5}
            />
          )}
          {has("steam") &&
            [
              [2, 6],
              [38, 6],
            ].map(([x, y]) => (
              <g key={x} className={moving("emote-steam")} fill="#e5e7eb" opacity={0.9}>
                <circle cx={x} cy={y} r={3} />
                <circle cx={x! + (x! < 20 ? -2.6 : 2.6)} cy={y! - 2.6} r={2.4} />
                <circle cx={x! + (x! < 20 ? 0.6 : -0.6)} cy={y! - 4.6} r={2} />
              </g>
            ))}
          {has("sunglasses") && (
            <g className={moving("emote-drop")}>
              <rect x={10.6} y={18.2} width={8.4} height={5.4} rx={2} fill="#0f172a" />
              <rect x={21} y={18.2} width={8.4} height={5.4} rx={2} fill="#0f172a" />
              <path d="M8 19.4 h3 M19 19.6 h2 M29 19.4 h3" stroke="#0f172a" strokeWidth={1.2} />
              <path
                d="M12.4 19.6 l2.4 0 M22.8 19.6 l2.4 0"
                stroke="#fff"
                strokeWidth={0.8}
                strokeLinecap="round"
                opacity={0.8}
              />
            </g>
          )}
        </g>
        {has("thumb") && (
          <g className={moving("emote-thumb")} stroke={ink} strokeWidth={0.8}>
            {/* A fist with its thumb up, at the lower right of the face. */}
            <rect x={31} y={41} width={8} height={5} rx={1} fill="#2563eb" />
            <rect x={30} y={32} width={10} height={10} rx={3} fill={skin} />
            <rect x={30.8} y={22.6} width={4.2} height={11} rx={2.1} fill={skin} />
            <path d="M35 35.6 h4.4 M35 38.6 h4.4" fill="none" />
          </g>
        )}
      </g>
      {has("confetti") &&
        CONFETTI.map(([x, y, color, turn, delay]) => (
          <rect
            key={`${x}-${y}`}
            className={moving("emote-confetti")}
            x={x - 1.4}
            y={y - 0.8}
            width={2.8}
            height={1.6}
            rx={0.4}
            fill={color}
            transform={`rotate(${turn} ${x} ${y})`}
            style={{ "--delay": `${delay}ms` } as CSSProperties}
          />
        ))}
    </svg>
  );
}
