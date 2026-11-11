import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EAST_COAST, WEST_COAST, type RulesConfig } from "@hf/shared";
import { generalRules, howToPlay, type RulesSection } from "./howToPlay";
import { PHONE_QUERY } from "../usePhone";
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

  it("states the wild ratio the table plays, and that a finished book takes no wild", () => {
    expect(text(EAST_COAST, "wilds")).toContain(
      "A meld must have more naturals than wilds. Three naturals carry at most two wilds.",
    );
    expect(text(EAST_COAST, "wilds")).not.toContain("as many wilds");
    expect(text(WEST_COAST, "wilds")).toContain(
      "A meld may have as many wilds as naturals, but never more.",
    );
    expect(text(WEST_COAST, "wilds")).not.toContain("more naturals than wilds");
    for (const config of [EAST_COAST, WEST_COAST]) {
      expect(text(config, "wilds")).toContain("once it is a book no wild can be added to it");
      expect(text(config, "melds")).toContain("you can add more naturals to it, but never a wild");
      expect(howToPlay(config).some((s) => s.coasts)).toBe(false);
    }
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

describe("the rules away from a table", () => {
  const general = (id: string): RulesSection => generalRules().find((s) => s.id === id)!;

  it("has the same sections as a table's, in the same order", () => {
    expect(generalRules().map((s) => s.id)).toEqual(howToPlay(EAST_COAST).map((s) => s.id));
  });

  it("gives the wild ratio for each coast, and only in the call-out", () => {
    const wilds = general("wilds");
    expect(wilds.coasts).toEqual([
      {
        name: "East Coast",
        text: "A meld must have more naturals than wilds. Three naturals carry at most two wilds.",
      },
      { name: "West Coast", text: "A meld may have as many wilds as naturals, but never more." },
    ]);
    const words = wilds.paragraphs.join(" ");
    expect(words).toBe(
      "Twos and jokers are wild and can stand in for any rank in a meld. A meld can never be made of wilds alone. A wild can help a meld become a book, but once it is a book no wild can be added to it.",
    );
    expect(generalRules().filter((s) => s.coasts)).toHaveLength(1);
  });

  it("states every other rule as the presets play it, not as one table's", () => {
    for (const s of generalRules()) {
      if (s.id === "wilds" || s.id === "marva") {
        continue;
      }
      expect(s.paragraphs).toEqual(howToPlay(EAST_COAST).find((t) => t.id === s.id)!.paragraphs);
      expect(s.paragraphs).toEqual(howToPlay(WEST_COAST).find((t) => t.id === s.id)!.paragraphs);
    }
    expect(general("marva").paragraphs.join(" ")).toBe(
      "Tables play the Marva rule unless the host turns it off: a first lay-down that empties your hand gets you down whatever it is worth, minimum or not.",
    );
  });
});

describe("the rules page and dialog", () => {
  it("is the app's rules page: contents, sections with lessons, both coasts", () => {
    render(
      <MemoryRouter initialEntries={["/rules"]}>
        <Routes>
          <Route path="/rules" element={<HowToPlayPage />} />
          <Route path="/learn/:lessonId" element={<p>lesson page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "How to play" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    const contents = screen.getByRole("navigation", { name: "Contents" });
    const links = within(contents).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(generalRules().map((s) => s.title));
    expect(links[0]).toHaveAttribute("aria-current", "location");
    expect(links[0]).toHaveAttribute("href", "#rules-objective");
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    try {
      fireEvent.click(within(contents).getByRole("link", { name: "Scoring" }));
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
    expect(scrolled).toEqual(["rules-scoring"]);
    expect(within(contents).getByRole("link", { name: "Scoring" })).toHaveAttribute(
      "aria-current",
      "location",
    );
    expect(links[0]).not.toHaveAttribute("aria-current");

    const wilds = screen.getByRole("region", { name: "Wild cards" });
    expect(wilds).toHaveTextContent("The one rule East Coast and West Coast play differently");
    expect(wilds).toHaveTextContent("more naturals than wilds");
    expect(wilds).toHaveTextContent("as many wilds as naturals");
    expect(screen.getByRole("region", { name: "The aim" })).not.toHaveTextContent("Try it");
    fireEvent.click(within(wilds).getByRole("link", { name: "Try it: Lesson 5" }));
    expect(screen.getByText("lesson page")).toBeInTheDocument();
  });

  it("is titled Rules on a phone, with the contents as tiles", () => {
    window.matchMedia = ((query: string) => ({
      matches: query === PHONE_QUERY,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      render(
        <MemoryRouter>
          <HowToPlayPage />
        </MemoryRouter>,
      );
      expect(screen.getByRole("heading", { level: 1, name: "Rules" })).toBeInTheDocument();
      expect(
        within(screen.getByRole("navigation", { name: "Contents" })).getAllByRole("link"),
      ).toHaveLength(12);
      expect(screen.getByRole("region", { name: "Wild cards" })).toHaveTextContent(
        "East Coast and West Coast differ here",
      );
      expect(screen.getByRole("link", { name: "Try it: Lesson 1" })).toHaveAttribute(
        "href",
        "/learn/turn",
      );
    } finally {
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });

  it("opens over the table for that table's rules, and closes", () => {
    let closed = 0;
    render(<RulesDialog config={{ ...EAST_COAST, marvaRule: false }} onClose={() => closed++} />);
    const dialog = screen.getByRole("dialog", { name: "How to play" });
    expect(within(dialog).getByRole("region", { name: "The Marva rule" })).toHaveTextContent(
      "This table does not play",
    );
    expect(within(dialog).getByRole("region", { name: "Wild cards" })).not.toHaveTextContent(
      "West Coast",
    );
    expect(within(dialog).queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(closed).toBe(2);
  });
});
