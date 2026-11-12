import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Card, Rank, Suit } from "@hf/shared";
import {
  bookEdges,
  cardCorners,
  DiscardPile,
  discardLayout,
  FaceDownPile,
  PlayingCard,
  STOCK_LAYERS_MAX,
  stockLayers,
} from "./PlayingCard";

const card = (rank: Rank, suit: Suit | null): Card => ({ id: `${rank}-${suit}`, rank, suit });

describe("a card nothing can be done with", () => {
  it("renders as an image, not a control", () => {
    // An always-clickable card would tell a player an opponent's meld is theirs to
    // move, and would put every card on the table into the tab order.
    render(<PlayingCard card={card("A", "spades")} />);
    expect(screen.getByRole("img", { name: "Ace of spades" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("dims a red three, which can never be played", () => {
    render(<PlayingCard card={card("3", "hearts")} />);
    expect(screen.getByRole("img", { name: /penalty/i }).className).toMatch(/opacity-60/);
  });
});

describe("a selectable card", () => {
  it("reports the card it was given when clicked", () => {
    const chosen: Card[] = [];
    const ace = card("A", "spades");
    render(<PlayingCard card={ace} onSelect={(c) => chosen.push(c)} />);
    fireEvent.click(screen.getByRole("button", { name: "Ace of spades" }));
    expect(chosen).toEqual([ace]);
  });

  it("says whether it is currently staged", () => {
    // aria-pressed rather than colour alone: staging is a toggle, and the state has
    // to be perceivable without seeing the lift.
    const { rerender } = render(<PlayingCard card={card("A", "spades")} onSelect={() => {}} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
    rerender(<PlayingCard card={card("A", "spades")} onSelect={() => {}} selected />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("refuses the click when disabled", () => {
    const onSelect = vi.fn();
    render(<PlayingCard card={card("A", "spades")} onSelect={onSelect} disabled />);
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("carries the card id, so a test or a drag can find it", () => {
    render(<PlayingCard card={card("7", "clubs")} onSelect={() => {}} />);
    expect(screen.getByRole("button")).toHaveAttribute("data-card-id", "7-clubs");
  });

  it("draws at a smaller size on request without changing its name", () => {
    render(<PlayingCard card={card("Q", "diamonds")} size="small" />);
    expect(screen.getByRole("img", { name: "Queen of diamonds" })).toBeInTheDocument();
  });
});

describe("FaceDownPile", () => {
  it("shows a count and no card", () => {
    // Hidden zones reach the client as a number; there is nothing here to draw even
    // if the component wanted to.
    render(<FaceDownPile count={40} label="Stock" />);
    expect(screen.getByRole("img", { name: "Stock: 40" })).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
  });

  it("renders an exhausted pile as zero rather than vanishing", () => {
    render(<FaceDownPile count={0} label="Stock" />);
    expect(screen.getByRole("img", { name: "Stock: 0" })).toBeInTheDocument();
  });
});

const texts = (el: Element): (string | null)[] =>
  [...el.querySelectorAll("text")].map((t) => t.textContent);

describe("a card's face", () => {
  it("shows the corner, a big suit and the corner again when it is big enough", () => {
    render(<PlayingCard card={card("Q", "hearts")} size="normal" />);
    expect(texts(screen.getByRole("img", { name: "Queen of hearts" }))).toEqual([
      "Q",
      "♥",
      "♥",
      "Q",
      "♥",
    ]);
  });

  it("shows only the corner on a phone-sized card", () => {
    render(<PlayingCard card={card("Q", "hearts")} size="medium" />);
    expect(texts(screen.getByRole("img", { name: "Queen of hearts" }))).toEqual(["Q", "♥"]);
  });

  it("marks a wild with a gold line and a warmer face, and a joker as JK in gold", () => {
    render(
      <>
        <PlayingCard card={card("2", "clubs")} size="medium" />
        <PlayingCard card={card("JOKER", null)} size="medium" />
        <PlayingCard card={card("9", "clubs")} size="medium" />
      </>,
    );
    const two = screen.getByRole("img", { name: "Two of clubs, wild" });
    expect(two.querySelector("[stroke='#F2C14E']")).not.toBeNull();
    expect(two.querySelector("rect")!.getAttribute("fill")).toBe("url(#hf-card-wild)");
    const joker = screen.getByRole("img", { name: /Joker/ });
    expect(texts(joker)).toEqual(["JK", "★"]);
    expect(joker.querySelector("text")!.getAttribute("fill")).toBe("#B07A00");
    const nine = screen.getByRole("img", { name: "Nine of clubs" });
    expect(nine.querySelector("[stroke='#F2C14E']")).toBeNull();
  });
});

describe("a face-down pile", () => {
  it("is drawn deeper the more it holds, up to a limit", () => {
    expect(STOCK_LAYERS_MAX).toBe(5);
    expect([0, 1, 13, 14, 28, 56, 200].map(stockLayers)).toEqual([0, 1, 1, 2, 3, 5, 5]);
  });

  it("writes its count in a pill when asked, with the same number in its name", () => {
    render(<FaceDownPile count={58} label="Stock" pill="Stock" />);
    const pile = screen.getByRole("img", { name: "Stock: 58" });
    expect(pile).toHaveTextContent("Stock58");
  });
});

describe("a discard pile's drawing", () => {
  const sizes = [1, 2, 3, 8, 9, 15, 21, 40, 108];

  it("holds every card it draws, tilted corners included, so none is clipped", () => {
    // The card beneath is tilted, and its corners once reached past the box the
    // drawing was cut to, clipping its left edge on every screen.
    for (const count of sizes) {
      const { width, height, top, under, edges } = discardLayout(count);
      const corners = [top, ...(under ? [under] : []), ...edges].flatMap(cardCorners);
      const xs = corners.map(([x]) => x);
      const ys = corners.map(([, y]) => y);
      expect(Math.min(...xs)).toBeCloseTo(0, 9);
      expect(Math.min(...ys)).toBeCloseTo(0, 9);
      expect(Math.max(...xs)).toBeCloseTo(width, 9);
      expect(Math.max(...ys)).toBeCloseTo(height, 9);
    }
  });

  it("draws one card alone, and from two the one beneath to the left, lower and tilted", () => {
    const one = discardLayout(1);
    expect(one.under).toBeNull();
    expect(one.edges).toHaveLength(0);
    expect(one.top).toEqual({ x: 0.5, y: 0.5, tilt: 0 });
    expect([one.width, one.height]).toEqual([57, 81]);

    const two = discardLayout(2);
    expect(two.under).not.toBeNull();
    expect(two.top.x - two.under!.x).toBe(22);
    expect(two.under!.y - two.top.y).toBe(5);
    expect(two.under!.tilt).toBe(-9);
    expect(two.edges).toHaveLength(0);
    // Wider and taller than one card by the peek and the tilt.
    expect(two.width).toBeGreaterThan(one.width + 22);
    expect(two.height).toBeGreaterThan(one.height + 5);
  });

  it("puts the edges down and to the right, back to front, each tilted its own way", () => {
    const { top, edges } = discardLayout(30);
    expect(edges.map((e) => [e.x - top.x, e.y - top.y])).toEqual([
      [12, 12],
      [9, 9],
      [6, 6],
      [3, 3],
    ]);
    expect(edges.map((e) => e.tilt)).toEqual([3.5, -2.5, 4.5, -1.5]);
  });

  it("sizes the drawing to that box, with the top card where the box puts it", () => {
    const pile = [card("5", "spades"), card("7", "hearts"), card("9", "clubs")];
    render(<DiscardPile cards={pile} />);
    const drawing = screen.getByRole("img", { name: /^Discard pile, 3 cards/ });
    const { width, height, top } = discardLayout(3);
    const unit = parseFloat(drawing.style.width) / width;
    expect(parseFloat(drawing.style.height) / unit).toBeCloseTo(height, 6);
    const back = drawing.querySelector("svg[viewBox]")!;
    expect(back.getAttribute("viewBox")).toBe(`0 0 ${width} ${height}`);
    const face = drawing.querySelector<SVGElement>("[data-motion]")!;
    expect(parseFloat(face.style.left) / unit).toBeCloseTo(top.x, 6);
    expect(parseFloat(face.style.top) / unit).toBeCloseTo(top.y, 6);
  });
});

describe("a finished book's stack", () => {
  it("shows two edges under a book of seven, one more every three cards, up to four", () => {
    expect([7, 8, 9, 10, 12, 13, 15, 16, 30].map(bookEdges)).toEqual([2, 2, 2, 3, 3, 4, 4, 4, 4]);
  });
});
