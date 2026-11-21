import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useState } from "react";
import { PHONE_QUERY } from "../usePhone";
import { AppShell, BareFrame } from "./AppShell";
import { Segmented } from "./Segmented";
import { Sheet } from "./Sheet";
import { NAME_KEY, ACCOUNT_KEY, rememberName } from "../identity";
import { saveAvatar } from "../profile/avatarStore";
import { defaultAvatar } from "@hf/shared";

function asPhone(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query === PHONE_QUERY,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia;
  window.localStorage.clear();
});

function app(at: string): void {
  render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<p>home page</p>} />
          <Route path="/history" element={<p>history page</p>} />
          <Route path="/learn" element={<p>learn page</p>} />
          <Route path="/rules" element={<p>rules page</p>} />
          <Route path="/profile" element={<p>profile page</p>} />
        </Route>
        <Route element={<BareFrame />}>
          <Route path="/room/:id" element={<p>table</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("the app shell", () => {
  it("has a sidebar on a computer with every page, the current one marked", () => {
    app("/history");
    const nav = screen.getByRole("navigation", { name: "Main" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "Play",
      "History",
      "Learn",
      "Rules",
      "Profile",
    ]);
    expect(within(nav).getByRole("link", { name: "History" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Play" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByText("history page")).toBeTruthy();
  });

  it("moves between pages from the navigation", () => {
    app("/");
    fireEvent.click(screen.getByRole("link", { name: "Rules" }));
    expect(screen.getByText("rules page")).toBeTruthy();
  });

  it("has a tab bar of four on a phone, without Learn", () => {
    asPhone();
    app("/");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual(["Play", "History", "Rules", "Profile"]);
  });

  it("leaves the tab bar off Learn on a phone, where it is a place gone to, not a tab", () => {
    asPhone();
    app("/learn");
    expect(screen.getByText("learn page")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
  });

  it("names the player in the sidebar, with their username once signed in", () => {
    window.localStorage.setItem(NAME_KEY, "Jack");
    window.localStorage.setItem(ACCOUNT_KEY, "jack");
    app("/");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByText("Jack")).toBeTruthy();
    expect(within(nav).getByText("@jack")).toBeTruthy();
  });

  it("follows a change of name, picture or username without leaving the page", () => {
    window.localStorage.setItem(NAME_KEY, "Jack");
    app("/profile");
    const nav = screen.getByRole("navigation", { name: "Main" });
    act(() => rememberName("Jackie"));
    expect(within(nav).getByText("Jackie")).toBeTruthy();
    const picture = defaultAvatar("someone else");
    act(() => saveAvatar(picture));
    expect(nav.querySelector("[data-avatar]")?.getAttribute("data-avatar")).toBe(
      Object.values(picture).join(" "),
    );
    act(() => {
      window.localStorage.setItem(ACCOUNT_KEY, "jackie");
      window.dispatchEvent(new StorageEvent("storage", { key: ACCOUNT_KEY }));
    });
    expect(within(nav).getByText("@jackie")).toBeTruthy();
  });

  it("folds the sidebar to a rail of icons that still names every page, and unfolds it", () => {
    window.localStorage.setItem(NAME_KEY, "Jack");
    app("/history");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav.className).toMatch(/w-\[240px\]/);
    const fold = within(nav).getByRole("button", { name: "Fold the menu" });
    expect(fold).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(fold);
    expect(nav.className).toMatch(/w-\[72px\]/);
    expect(nav).toHaveAttribute("data-folded");
    expect(window.localStorage.getItem("hf.navFolded")).toBe("1");
    expect(within(nav).queryByText("Hand & Foot")).toBeNull();
    // Each page is an icon now, named for a screen reader and by a tooltip.
    const links = within(nav).getAllByRole("link");
    expect(links.slice(0, 5).map((l) => l.textContent)).toEqual([
      "Play",
      "History",
      "Learn",
      "Rules",
      "Profile",
    ]);
    for (const link of links.slice(0, 5)) {
      expect(link.querySelector("svg")).not.toBeNull();
      expect(link.getAttribute("title")).toBe(link.textContent);
    }
    expect(within(nav).getByRole("link", { name: "History" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // The player is their face, their name kept for a screen reader.
    expect(within(nav).getByRole("link", { name: "Jack" })).toHaveAttribute("title", "Jack");
    fireEvent.click(within(nav).getByRole("link", { name: "Rules" }));
    expect(screen.getByText("rules page")).toBeTruthy();

    const unfold = within(nav).getByRole("button", { name: "Show the menu" });
    expect(unfold).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(unfold);
    expect(nav.className).toMatch(/w-\[240px\]/);
    expect(within(nav).getByText("Hand & Foot")).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Rules" }).getAttribute("title")).toBeNull();
    expect(window.localStorage.getItem("hf.navFolded")).toBe("0");
  });

  it("remembers the folded sidebar on this device", () => {
    window.localStorage.setItem("hf.navFolded", "1");
    app("/");
    expect(screen.getByRole("button", { name: "Show the menu" })).toBeInTheDocument();
  });

  it("folds the sidebar when the browser blocks storage, for as long as the page is open", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      app("/");
      fireEvent.click(screen.getByRole("button", { name: "Fold the menu" }));
      expect(screen.getByRole("button", { name: "Show the menu" })).toBeInTheDocument();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it("has nothing to fold on a phone, where the pages are tabs", () => {
    asPhone();
    window.localStorage.setItem("hf.navFolded", "1");
    app("/");
    expect(screen.queryByRole("button", { name: /the menu/ })).toBeNull();
    expect(
      within(screen.getByRole("navigation", { name: "Main" }))
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual(["Play", "History", "Rules", "Profile"]);
  });

  it("leaves the table full screen, with no navigation", () => {
    app("/room/ABC234");
    expect(screen.getByText("table")).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});

describe("Segmented", () => {
  function Picker(): React.ReactElement {
    const [value, setValue] = useState<"east" | "west">("east");
    return (
      <>
        <Segmented
          label="Variant"
          value={value}
          onChange={setValue}
          options={[
            { value: "east", label: "East Coast", detail: "1 wild per 2" },
            { value: "west", label: "West Coast" },
          ]}
        />
        <p>chose {value}</p>
      </>
    );
  }

  it("is one named choice whose options can be picked", () => {
    render(<Picker />);
    const group = screen.getByRole("group", { name: "Variant" });
    const east = within(group).getByRole("radio", { name: /East Coast/ });
    const west = within(group).getByRole("radio", { name: "West Coast" });
    expect((east as HTMLInputElement).checked).toBe(true);
    fireEvent.click(west);
    expect((west as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("chose west")).toBeTruthy();
  });
});

describe("Sheet", () => {
  it("is a named modal dialog that closes from its button, Escape and the backdrop", () => {
    const onClose = vi.fn();
    render(
      <Sheet title="New table" onClose={onClose}>
        <p>inside</p>
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "New table" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(within(dialog).getByRole("heading", { name: "New table" })).toBeTruthy();
    expect(document.activeElement).toBe(dialog);

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(dialog.parentElement!);
    // A press inside the sheet is not a press on the backdrop.
    fireEvent.mouseDown(screen.getByText("inside"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("has a grab handle as a bottom sheet on a phone", () => {
    asPhone();
    render(
      <Sheet title="Join a table" onClose={() => {}}>
        <p>inside</p>
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "Join a table" });
    expect(dialog.className).toContain("rounded-t-");
  });
});
