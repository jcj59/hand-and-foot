import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { deal, heuristicPolicy, applyAction } from "@hf/engine";
import { SCENARIOS } from "@hf/scenarios";
import { EAST_COAST, type Action } from "@hf/shared";
import ScenarioApp from "./ScenarioApp";

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ScenarioApp />
    </MemoryRouter>,
  );
}

describe("the scenario viewer", () => {
  it("lists every scenario, with links to each named moment", () => {
    at("/scenarios");
    for (const s of SCENARIOS)
      expect(screen.getByRole("link", { name: s.title })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Marva: Ana gets down/ })).toHaveAttribute(
      "href",
      "/scenarios/marva#moment=getdown",
    );
    expect(screen.getByRole("link", { name: "Run all" })).toHaveAttribute("href", "/scenarios/all");
  });

  it("opens a scenario at the moment a link names, paused there", () => {
    at("/scenarios/marva#moment=getdown");
    expect(screen.getAllByRole("heading", { level: 1, name: "The Marva rule" })).toHaveLength(2);
    expect(screen.getByLabelText("Moment")).toHaveTextContent("★ Marva: Ana gets down");
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("plays a scenario opened at its beginning, watching the seat it is about", () => {
    at("/scenarios/threes");
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByLabelText("Watch")).toHaveValue("1");
  });

  it("sends an unknown scenario, or any other path, back to the list", () => {
    at("/scenarios/no-such-thing");
    expect(screen.getByRole("heading", { name: "Scenarios" })).toBeInTheDocument();
    at("/elsewhere");
    expect(screen.getAllByRole("heading", { name: "Scenarios" }).length).toBeGreaterThan(0);
  });

  it("runs them all, one after another, and can skip ahead", () => {
    at("/scenarios/all?moments=1");
    expect(screen.getByText(/^1 of \d+$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.getByText(/^2 of \d+$/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("plays a bug report's replay file, pasted, from the end where it was sent", () => {
    let state = deal(2, EAST_COAST, 5, 1, 1);
    const actions: Action[] = [];
    for (let i = 0; i < 6; i++) {
      const action = heuristicPolicy(state, state.currentSeat)!;
      const done = applyAction(state, action);
      if (!done.ok) throw new Error(done.error);
      state = done.state;
      actions.push(action);
    }
    const log = {
      config: EAST_COAST,
      setup: { seed: 5, playerCount: 2, firstSeat: 1 },
      actions,
      names: ["ana", "ben"],
    };
    at("/scenarios");
    fireEvent.click(screen.getByRole("link", { name: "Replay a bug report" }));
    const box = screen.getByRole("textbox", { name: "Replay file" });
    fireEvent.change(box, { target: { value: "{" } });
    fireEvent.click(screen.getByRole("button", { name: "Play it" }));
    expect(screen.getByRole("alert")).toHaveTextContent("that is not JSON");
    fireEvent.change(box, { target: { value: "{}" } });
    fireEvent.click(screen.getByRole("button", { name: "Play it" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/not a replay file/);
    const refused = { ...log, actions: [{ type: "discard", cardId: "nope" }] };
    fireEvent.change(box, { target: { value: JSON.stringify(refused) } });
    fireEvent.click(screen.getByRole("button", { name: "Play it" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/action 1 .* was refused/);
    fireEvent.change(box, { target: { value: JSON.stringify(log) } });
    fireEvent.click(screen.getByRole("button", { name: "Play it" }));
    expect(screen.getAllByRole("heading", { name: "Bug report replay" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });
});
