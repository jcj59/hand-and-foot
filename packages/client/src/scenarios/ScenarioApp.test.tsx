import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SCENARIOS } from "@hf/scenarios";
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
});
