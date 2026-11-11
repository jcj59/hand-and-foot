import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { codeFromScan } from "../roomCode";
import { QrCode, qrModules } from "../ui/QrCode";
import { CodeBoxes } from "./CodeBoxes";
import { Scanner } from "./Scanner";

describe("reading a code from a scan", () => {
  it("takes the code from the table's link, on any origin, by either path", () => {
    expect(codeFromScan("https://hand.example/room/K7QM2P")).toBe("K7QM2P");
    expect(codeFromScan("http://localhost:5173/join/k7qm2p/")).toBe("K7QM2P");
    expect(codeFromScan("  https://hand.example/room/K7Q-M2P  ")).toBe("K7QM2P");
    // A link some app has percent-encoded.
    expect(codeFromScan("https://hand.example/room/K7Q%20M2P")).toBe("K7QM2P");
  });

  it("takes a bare code too", () => {
    expect(codeFromScan("k7q m2p")).toBe("K7QM2P");
  });

  it("ignores anything else a camera might read", () => {
    expect(codeFromScan("https://hand.example/watch/K7QM2P")).toBeNull();
    expect(codeFromScan("https://hand.example/")).toBeNull();
    expect(codeFromScan("https://hand.example/room/K7QM2P/extra")).toBeNull();
    expect(codeFromScan("https://menu.example/room/NOT-A-CODE-AT-ALL")).toBeNull();
    expect(codeFromScan("WIFI:S:home;T:WPA;P:secret;;")).toBeNull();
    // 0 and O are not in the alphabet: not a code, however close.
    expect(codeFromScan("K7QM20")).toBeNull();
  });
});

describe("a QR code", () => {
  it("is the same every time for the same link, and square", () => {
    const a = qrModules("https://hand.example/room/K7QM2P");
    expect(qrModules("https://hand.example/room/K7QM2P")).toEqual(a);
    expect(a.every((row) => row.length === a.length)).toBe(true);
    // Version 2 or 3 for a link this long: 25 or 29 modules a side.
    expect([25, 29]).toContain(a.length);
  });

  it("has the three finder squares a camera locks on to", () => {
    const m = qrModules("https://hand.example/room/K7QM2P");
    const n = m.length;
    for (const [r, c] of [
      [0, 0],
      [0, n - 7],
      [n - 7, 0],
    ] as const) {
      // A dark ring seven wide around a light ring around a dark three-by-three.
      expect(m[r]![c]).toBe(true);
      expect(m[r]![c + 6]).toBe(true);
      expect(m[r + 1]![c + 1]).toBe(false);
      expect(m[r + 3]![c + 3]).toBe(true);
    }
  });

  it("differs for a different link", () => {
    expect(qrModules("https://hand.example/room/K7QM2P")).not.toEqual(
      qrModules("https://hand.example/room/ABC234"),
    );
  });

  it("is an image named for what it does", () => {
    render(
      <QrCode value="https://hand.example/room/K7QM2P" label="QR code to join table K7QM2P" />,
    );
    const img = screen.getByRole("img", { name: "QR code to join table K7QM2P" });
    expect(img.getAttribute("data-qr")).toBe("https://hand.example/room/K7QM2P");
  });
});

describe("the code boxes", () => {
  function Boxes(): React.ReactElement {
    const [code, setCode] = useState("");
    return <CodeBoxes value={code} onChange={setCode} />;
  }

  it("are one field, a character to a box, forgiving case and separators", () => {
    const { container } = render(<Boxes />);
    fireEvent.change(screen.getByLabelText("Table code"), { target: { value: "k7q-m2" } });
    const boxes = [...container.querySelectorAll("[data-code-box]")].map((b) => b.textContent);
    expect(boxes).toEqual(["K", "7", "Q", "M", "2", ""]);
    expect(screen.getByLabelText("Table code")).toHaveValue("K7QM2");
  });
});

describe("the scanner", () => {
  afterEach(() => {
    delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    vi.useRealTimers();
  });

  it("says to use the camera app where the browser cannot read QR codes", () => {
    render(<Scanner onCode={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent(/camera app/);
    expect(screen.queryByRole("button", { name: "Turn on camera" })).toBeNull();
  });

  it("reads the table's code from the camera once turned on, and lets the camera go", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const stop = vi.fn();
    const reads = [
      [{ rawValue: "https://menu.example/" }],
      [{ rawValue: "https://hand.example/room/K7QM2P" }],
    ];
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = class {
      detect = async () => reads.shift() ?? [];
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop }] }) },
    });
    HTMLMediaElement.prototype.play = async () => {};
    const onCode = vi.fn();
    const { unmount } = render(<Scanner onCode={onCode} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn on camera" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await waitFor(() => expect(onCode).toHaveBeenCalledWith("K7QM2P"));
    expect(onCode).toHaveBeenCalledTimes(1);
    unmount();
    expect(stop).toHaveBeenCalled();
  });

  it("says so when the camera is refused", async () => {
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = class {
      detect = async () => [];
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => Promise.reject(new Error("denied")) },
    });
    render(<Scanner onCode={() => {}} autoStart />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/isn't available/));
  });
});
