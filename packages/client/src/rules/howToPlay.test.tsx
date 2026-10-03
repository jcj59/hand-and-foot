import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EAST_COAST, WEST_COAST, type RulesConfig } from "@hf/shared";
import { howToPlay } from "./howToPlay";
import { HowToPlayPage, RulesDialog } from "./HowToPlay";

const text = (config: RulesConfig, id: string): string =>
  howToPlay(config)
    .find((s) => s.id === id)!
    .paragraphs.join(" ");

describe("how to play, from a table's own rules", () => {
  it("covers everything a new player needs, in order", () => {
    expect(howToPlay(EAST_COAST).map((s) => s.title)).toEqual([
      "The aim",
      "The deal",
      "A turn",
      "Melds and books",
      "Wild cards",
      "Threes",
      "Taking the pile",
      "Getting down",
      "The Marva rule",
      "The foot",
      "Going out",
      "Scoring",
    ]);
  });

  it("states the round minimums the table plays, round by round", () => {
    expect(text(EAST_COAST, "getting-down")).toContain(
      "60 in round 1, 90 in round 2, 120 in round 3 and 150 in round 4.",
    );
    const custom = { ...EAST_COAST, rounds: 3, layDownMinimums: [50, 75] };
    expect(text(custom, "getting-down")).toContain(
      "50 in round 1 and 75 in round 2, and nothing after.",
    );
    expect(text({ ...EAST_COAST, layDownMinimums: [] }, "getting-down")).toContain(
      "can be worth any number of points",
    );
    expect(text(custom, "objective")).toContain("over 3 rounds");
  });

  it("states the wild ratio the preset plays", () => {
    expect(text(EAST_COAST, "wilds")).toContain("more natural cards than wilds");
    expect(text(WEST_COAST, "wilds")).toContain("as many wilds as naturals, but never more");
  });

  it("says whether the table plays the Marva rule", () => {
    expect(text(EAST_COAST, "marva")).toContain("This table plays the Marva rule");
    expect(text({ ...EAST_COAST, marvaRule: false }, "marva")).toContain(
      "does not play the Marva rule",
    );
  });

  it("states the deal, the decks and the opening of the pile from the rules", () => {
    expect(text(EAST_COAST, "deal")).toContain(
      "a hand of 14 cards and, face down beside it, a foot of 14",
    );
    expect(text(EAST_COAST, "deal")).toContain(
      "plus 1 extra deck, jokers included. One card is turned up",
    );
    const plain = { ...EAST_COAST, extraDecks: 0, initialDiscardFlip: false, handSize: 11 };
    expect(text(plain, "deal")).toContain(
      "one deck for each player, jokers included. The rest are the stock; the discard pile starts empty.",
    );
    expect(text(plain, "deal")).toContain("a hand of 11 cards");
  });

  it("says what an empty stock does at this table", () => {
    expect(text(EAST_COAST, "turn")).toContain("shuffled into a new stock");
    expect(text({ ...EAST_COAST, stockExhaustion: "end" }, "turn")).toContain(
      "When the stock runs out, the round ends.",
    );
  });

  it("states the books going out takes", () => {
    expect(text(EAST_COAST, "going-out")).toContain("at least 1 clean book and 2 dirty books down");
    expect(text({ ...EAST_COAST, goOutCleanBooks: 2, goOutDirtyBooks: 0 }, "going-out")).toContain(
      "at least 2 clean books down",
    );
    expect(text({ ...EAST_COAST, goOutCleanBooks: 0, goOutDirtyBooks: 0 }, "going-out")).toContain(
      "any books at all, or none",
    );
  });

  it("states every card's value and bonus from the scoring rules", () => {
    const scoring = text(EAST_COAST, "scoring");
    expect(scoring).toContain(
      "jokers 50, twos 20, aces 15, tens to kings 10, fours to nines 5, black threes 5",
    );
    expect(scoring).toContain(
      "Each clean book adds 500 and each dirty one 300. Going out adds 100.",
    );
    expect(scoring).toContain("a red three left is -500");
    expect(text(EAST_COAST, "threes")).toContain("costs 500 points");
    const custom = { ...EAST_COAST, scoring: { ...EAST_COAST.scoring, joker: 60, redThree: -300 } };
    expect(text(custom, "scoring")).toContain("jokers 60");
    expect(text(custom, "threes")).toContain("costs 300 points");
  });
});

describe("the rules page and dialog", () => {
  it("is a page from the main menu, for either preset", () => {
    render(
      <MemoryRouter initialEntries={["/rules"]}>
        <Routes>
          <Route path="/rules" element={<HowToPlayPage />} />
          <Route path="/" element={<p>main screen</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "How to play" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Wild cards" })).toHaveTextContent(
      "more natural cards",
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Rules" }), {
      target: { value: "west-coast" },
    });
    expect(screen.getByRole("region", { name: "Wild cards" })).toHaveTextContent("as many wilds");
    fireEvent.click(screen.getByRole("button", { name: "Main menu" }));
    expect(screen.getByText("main screen")).toBeInTheDocument();
  });

  it("opens over the table for that table's rules, and closes", () => {
    let closed = 0;
    render(<RulesDialog config={{ ...EAST_COAST, marvaRule: false }} onClose={() => closed++} />);
    const dialog = screen.getByRole("dialog", { name: "How to play" });
    expect(within(dialog).getByRole("region", { name: "The Marva rule" })).toHaveTextContent(
      "does not play",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(closed).toBe(2);
  });
});
