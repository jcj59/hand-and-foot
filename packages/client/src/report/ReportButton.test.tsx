/**
 * The corner "Report a bug" button away from a table, and how a table offers its
 * details to it. At a live table it is tested in `ReportSheet.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { EAST_COAST, type RoomInfo, type RoundEnded } from "@hf/shared";
import { RoundResult, type RoundResultActions } from "../table/RoundResult";
import { PHONE_QUERY } from "../usePhone";
import type { TableReport } from "./context";
import { REPORT_LIFT_VAR, ReportButton } from "./ReportButton";
import { PAGE_DISCLOSURE } from "./ReportSheet";
import { currentTableReport, useTableReportSource } from "./reportSource";

/** Stands in for a table on screen, offering its details while mounted. */
function FakeTable({ read }: { readonly read: () => TableReport }): null {
  useTableReportSource(read);
  return null;
}

const table = { roundOver: false } as unknown as TableReport;

afterEach(cleanup);

describe("the corner Report a bug button", () => {
  it("opens the report away from a table, without a table's details", () => {
    render(<ReportButton />);
    fireEvent.click(screen.getByRole("button", { name: "Report a bug" }));
    const sheet = screen.getByRole("dialog", { name: "Report a bug" });
    expect(within(sheet).getByText(PAGE_DISCLOSURE)).toBeInTheDocument();
  });

  it("forgets the table once it is gone, and keeps the newest one on screen", () => {
    const first = render(<FakeTable read={() => table} />);
    expect(currentTableReport()).toBe(table);
    const second = { roundOver: true } as unknown as TableReport;
    const other = render(<FakeTable read={() => second} />);
    expect(currentTableReport()).toBe(second);
    // The older one leaving does not take the newer one's place away.
    first.unmount();
    expect(currentTableReport()).toBe(second);
    other.unmount();
    expect(currentTableReport()).toBeNull();
  });
});

describe("lifting the corner button above what sits along the bottom edge", () => {
  const room: RoomInfo = {
    roomId: "ABC234",
    players: ["Ana", "Ben", "Cy"].map((name, seat) => ({ seat, name, connected: true })),
    hostSeat: 0,
    playAgain: [],
    nextRoundReady: [],
    started: true,
    config: EAST_COAST,
  };
  const result: RoundEnded = {
    scores: [0, 1, 2].map((seat) => ({
      seat,
      score: 0,
      breakdown: {
        cleanBooks: 0,
        dirtyBooks: 0,
        bookBonus: 0,
        meldedCards: 0,
        goOutBonus: 0,
        heldCount: 0,
        heldPenalty: 0,
        redThreesHeld: 0,
      },
    })),
    roundNumber: 1,
    totals: [0, 0, 0],
    matchOver: false,
  };
  const actions: RoundResultActions = {
    onLeave: () => {},
    onPlayAgain: () => {},
    onRematch: () => {},
    onNextRound: () => {},
    onRemovePlayer: () => {},
    onSaveForLater: () => {},
  };
  const board = (): React.ReactElement => (
    <RoundResult
      result={result}
      room={room}
      config={EAST_COAST}
      actions={actions}
      seat={0}
      notice={null}
    />
  );
  const lift = (): string => document.documentElement.style.getPropertyValue(REPORT_LIFT_VAR);

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as { matchMedia?: unknown }).matchMedia;
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  });

  it("clears the round-over bar on a phone and follows its size, but not the nearly full-screen sheet", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query === PHONE_QUERY,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
    const observed: { readonly target: Element; readonly by: object; readonly fire: () => void }[] =
      [];
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      constructor(private readonly callback: () => void) {}
      observe(target: Element): void {
        observed.push({ target, by: this, fire: () => this.callback() });
      }
      disconnect(): void {
        for (let i = observed.length - 1; i >= 0; i--) {
          if (observed[i]!.by === this) observed.splice(i, 1);
        }
      }
    };
    const heights = new Map<string, number>([
      ["Round result", 400],
      ["Round over", 80],
    ]);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return heights.get(this.getAttribute("aria-label") ?? "") ?? 0;
    });

    render(<ReportButton />);
    expect(lift()).toBe("");
    // The sheet is nearly the whole screen: lifted by it, the button would sit over
    // the table's header, so it stays in the corner and the sheet leaves room.
    const sheet = render(board());
    expect(within(sheet.container).getByRole("dialog", { name: "Round result" })).toBeVisible();
    expect(lift()).toBe("");

    // With the scores put away, the bar along the bottom lifts it.
    fireEvent.click(within(sheet.container).getByRole("button", { name: "Look at the table" }));
    const region = within(sheet.container).getByRole("region", { name: "Round over" });
    expect(lift()).toBe("80px");

    // The bar grows without the window changing size.
    heights.set("Round over", 130);
    act(() => observed.filter((o) => o.target === region).forEach((o) => o.fire()));
    expect(lift()).toBe("130px");

    sheet.unmount();
    expect(lift()).toBe("");
  });
});
