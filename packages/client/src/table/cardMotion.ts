/**
 * Plays `planMotion`'s plans on the page. See `motion.ts` for the approach.
 *
 * Cards are found by `data-motion` (the ids an element shows: one for a card, all
 * seven for a collapsed book) and places by `data-anchor` (`stock`, `discard`,
 * `seat-N`). The Web Animations API does the moving, so nothing here is a
 * dependency, and an element that cannot animate — jsdom's, or anyone's who has
 * asked their device for less motion — simply stays where the layout put it.
 */
import { useLayoutEffect, useRef, type RefObject } from "react";
import type { LastMove } from "@hf/shared";
import { planMotion, type Box, type Ghost, type Slide } from "./motion";

/** How long a card takes to slide into place. */
export const SLIDE_MS = 420;
/** How long the player's own draw is shown before it goes into the hand. */
export const REVEAL_MS = 1_400;

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

function box(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

interface Measured {
  readonly cards: Map<string, Box>;
  readonly elements: Map<string, HTMLElement>;
  readonly anchors: Map<string, Box>;
}

function measure(root: HTMLElement): Measured {
  const cards = new Map<string, Box>();
  const elements = new Map<string, HTMLElement>();
  for (const el of root.querySelectorAll<HTMLElement>("[data-motion]")) {
    const where = box(el);
    for (const id of el.dataset.motion!.split(" ")) {
      // The first place a card is shown wins; it is the one players are looking at.
      if (cards.has(id)) continue;
      cards.set(id, where);
      elements.set(id, el);
    }
  }
  const anchors = new Map<string, Box>();
  for (const el of root.querySelectorAll<HTMLElement>("[data-anchor]")) {
    anchors.set(el.dataset.anchor!, box(el));
  }
  return { cards, elements, anchors };
}

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function slide(el: HTMLElement, plan: Slide): void {
  const now = box(el);
  const dx = plan.from.x + plan.from.w / 2 - (now.x + now.w / 2);
  const dy = plan.from.y + plan.from.h / 2 - (now.y + now.h / 2);
  const scale = now.w > 0 ? plan.from.w / now.w : 1;
  const start = `translate(${dx}px, ${dy}px) scale(${scale})`;
  el.style.zIndex = "30";
  const done = (): void => {
    el.style.zIndex = "";
  };
  if (!plan.reveal) {
    el.animate([{ transform: start }, { transform: "none" }], {
      duration: SLIDE_MS,
      easing: EASE,
    }).onfinish = done;
    return;
  }
  // Lifted to the middle of the screen and shown large, the way a player looks at
  // a card they have just drawn, then put into the hand.
  const cx = window.innerWidth / 2 - (now.x + now.w / 2);
  const cy = window.innerHeight / 2 - (now.y + now.h / 2);
  const shown = `translate(${cx}px, ${cy}px) scale(2.4)`;
  el.animate(
    [
      { transform: start, offset: 0 },
      { transform: shown, offset: 0.25, easing: "ease-out" },
      { transform: shown, offset: 0.7, easing: EASE },
      { transform: "none", offset: 1 },
    ],
    { duration: REVEAL_MS },
  ).onfinish = done;
}

function ghost(plan: Ghost): void {
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = `position:fixed;left:${plan.from.x}px;top:${plan.from.y}px;width:${plan.from.w}px;height:${plan.from.h}px;z-index:40;pointer-events:none`;
  for (let i = 0; i < plan.cards; i++) {
    const back = document.createElement("div");
    back.style.cssText = `position:absolute;inset:0;transform:translate(${i * 3}px, ${i * 3}px);border-radius:6px;background:#1e3a8a;border:2px solid #93c5fd`;
    layer.appendChild(back);
  }
  document.body.appendChild(layer);
  const dx = plan.to.x + plan.to.w / 2 - (plan.from.x + plan.from.w / 2);
  const dy = plan.to.y + plan.to.h / 2 - (plan.from.y + plan.from.h / 2);
  layer.animate(
    [
      { transform: "none", opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.5)`, opacity: 0.2 },
    ],
    { duration: SLIDE_MS + 120, easing: EASE },
  ).onfinish = () => layer.remove();
}

/**
 * Animate the table under `root` whenever a new move arrives. Measures every
 * render, so the "before" is always where cards were the moment before the move.
 */
export function useCardMotion(
  root: RefObject<HTMLElement | null>,
  move: LastMove | undefined,
  mySeat: number | undefined,
): void {
  const before = useRef<Map<string, Box>>(new Map());
  const seen = useRef<number | null>(null);
  // Nothing animates on the first measurement: a move already there when the page
  // opened happened before anyone was watching.
  const primed = useRef(false);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const now = measure(el);
    const arrived = primed.current && move !== undefined && move.seq !== seen.current;
    seen.current = move?.seq ?? null;
    primed.current = true;
    // `animate` is missing where there is no real layout (jsdom), and moving
    // anything is wrong for a player who has asked for less motion.
    const canAnimate = typeof HTMLElement.prototype.animate === "function" && !reducedMotion();
    if (arrived && canAnimate && mySeat !== undefined) {
      const moved = new Set<HTMLElement>();
      for (const plan of planMotion(move, mySeat, before.current, now.cards, now.anchors)) {
        if (plan.kind === "ghost") {
          ghost(plan);
          continue;
        }
        const target = now.elements.get(plan.id);
        // A collapsed book shows several ids on one element: move it once.
        if (!target || moved.has(target)) continue;
        moved.add(target);
        slide(target, plan);
      }
    }
    before.current = now.cards;
  });
}
