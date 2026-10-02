import { describe, it, expect, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { AVATAR_PARTS, defaultAvatar, isAvatar, type Avatar } from "@hf/shared";
import { AvatarFace } from "./Avatar";
import { AvatarEditor, randomAvatar } from "./AvatarEditor";
import { AVATAR_KEY, faceOf, loadAvatar, saveAvatar } from "./avatarStore";

const ANA: Avatar = { background: "rose", skin: "sand", eyes: "wink", mouth: "grin", top: "crown" };

afterEach(() => window.localStorage.removeItem(AVATAR_KEY));

describe("this device's picture", () => {
  it("is none until chosen, then kept, and can be forgotten", () => {
    expect(loadAvatar()).toBeNull();
    saveAvatar(ANA);
    expect(loadAvatar()).toEqual(ANA);
    saveAvatar(null);
    expect(window.localStorage.getItem(AVATAR_KEY)).toBeNull();
    expect(loadAvatar()).toBeNull();
  });

  it("is none when what is stored is damaged or not a picture", () => {
    window.localStorage.setItem(AVATAR_KEY, "{not json");
    expect(loadAvatar()).toBeNull();
    window.localStorage.setItem(AVATAR_KEY, JSON.stringify({ ...ANA, top: "halo" }));
    expect(loadAvatar()).toBeNull();
  });

  it("survives storage that refuses to be read or written", () => {
    const real = window.localStorage;
    const refusing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    Object.defineProperty(window, "localStorage", { configurable: true, value: refusing });
    try {
      expect(loadAvatar()).toBeNull();
      expect(() => saveAvatar(ANA)).not.toThrow();
      expect(() => saveAvatar(null)).not.toThrow();
    } finally {
      Object.defineProperty(window, "localStorage", { configurable: true, value: real });
    }
  });

  it("is drawn from the name for a seat that chose none", () => {
    expect(faceOf({ name: "Ben", avatar: ANA })).toEqual(ANA);
    expect(faceOf({ name: "Ben" })).toEqual(defaultAvatar("Ben"));
  });
});

describe("a face", () => {
  it("draws every part, and is an image only when it is given a name", () => {
    render(<AvatarFace avatar={ANA} label="Ana's picture" />);
    const face = screen.getByRole("img", { name: "Ana's picture" });
    expect(face.getAttribute("data-avatar")).toBe("rose sand wink grin crown");
    const { container } = render(<AvatarFace avatar={ANA} />);
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("can be drawn with any id of any part", () => {
    for (const [part, ids] of Object.entries(AVATAR_PARTS)) {
      for (const id of ids) {
        const { container, unmount } = render(<AvatarFace avatar={{ ...ANA, [part]: id }} />);
        // Something beyond the disc and the face is drawn for every part but a bare head.
        expect(container.querySelectorAll("svg *").length).toBeGreaterThan(3);
        unmount();
      }
    }
  });

  it("clips each face to its own disc", () => {
    const { container } = render(
      <>
        <AvatarFace avatar={ANA} />
        <AvatarFace avatar={ANA} />
      </>,
    );
    const ids = [...container.querySelectorAll("clipPath")].map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
  });
});

function Editing({ name, start }: { readonly name: string; readonly start: Avatar | null }) {
  const [avatar, setAvatar] = useState(start);
  return <AvatarEditor name={name} avatar={avatar} onChange={setAvatar} random={() => 0.999} />;
}

describe("choosing a picture", () => {
  const preview = () =>
    screen.getByRole("img", { name: "Your picture" }).getAttribute("data-avatar");

  it("starts from the face the name gives, and changes one part at a time", () => {
    render(<Editing name="Ana" start={null} />);
    const fromName = defaultAvatar("Ana");
    expect(preview()).toBe(Object.values(fromName).join(" "));
    fireEvent.click(screen.getByRole("button", { name: "Change picture" }));
    const eyes = screen.getByRole("group", { name: "Eyes" });
    expect(within(eyes).getAllByRole("button")).toHaveLength(AVATAR_PARTS.eyes.length);
    expect(within(eyes).getByRole("button", { name: `Eyes: ${fromName.eyes}` })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(within(eyes).getByRole("button", { name: "Eyes: stars" }));
    expect(preview()).toBe(Object.values({ ...fromName, eyes: "stars" }).join(" "));
    expect(within(eyes).getByRole("button", { name: "Eyes: stars" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shuffles, and goes back to the face from the name", () => {
    render(<Editing name="Ana" start={ANA} />);
    fireEvent.click(screen.getByRole("button", { name: "Change picture" }));
    fireEvent.click(screen.getByRole("button", { name: "Shuffle" }));
    // The last id of every part, from a random source that always says 0.999.
    expect(preview()).toBe("coral lilac lashes beard mohawk");
    fireEvent.click(screen.getByRole("button", { name: "Use the one from my name" }));
    expect(preview()).toBe(Object.values(defaultAvatar("Ana")).join(" "));
    expect(screen.queryByRole("button", { name: "Use the one from my name" })).toBeNull();
  });

  it("makes only pictures the server accepts", () => {
    for (const r of [0, 0.3, 0.6, 0.999]) expect(isAvatar(randomAvatar(() => r))).toBe(true);
  });
});
