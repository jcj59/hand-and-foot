import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Card, Rank, Suit } from "@hf/shared";
import { FaceDownPile, PlayingCard, STOCK_LAYERS_MAX, stockLayers } from "./PlayingCard";

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
