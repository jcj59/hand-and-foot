// @vitest-environment node
// Against a real server, so in Node: Node's own WebSocket and vitest's jsdom
// environment each bring an Event class, and neither accepts the other's. The table
// still needs a document to render into, so this one test makes its own jsdom and
// hands React only the DOM globals, leaving Node's Event to the socket.
/**
 * "Lay down for me", against a real server, through the real table: a player not
 * yet down takes the pile, has a lay-down staged for them, and plays it. The point
 * is the claim the button rests on: the lay-down it stages is one the server
 * accepts, settling the pile and getting the player down.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { createServer, type HandAndFootServer } from "@hf/server";
import type { Card, GameState, Rank, Suit } from "@hf/shared";
import { attachSession, useSession } from "./session";
import { connect, createRoom, joinRoom, startGame, type HfClientSocket } from "./socket";

const DOM_GLOBALS = [
  "window",
  "document",
  "navigator",
  "Node",
  "Element",
  "HTMLElement",
  "SVGElement",
  "Text",
  "DocumentFragment",
  "MutationObserver",
  "getComputedStyle",
  "sessionStorage",
  "localStorage",
  "requestAnimationFrame",
  "cancelAnimationFrame",
] as const;

/**
 * Give React and Testing Library a document, keeping Node's own Event. Left in
 * place to the end of the file (vitest runs each file on its own), since the
 * table's audio and sound hooks tear down after the last test.
 */
function installDom(): void {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  const scope = globalThis as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    Object.defineProperty(scope, key, {
      value: (dom.window as unknown as Record<string, unknown>)[key],
      configurable: true,
      writable: true,
    });
  }
  scope.IS_REACT_ACT_ENVIRONMENT = true;
}

let server: HandAndFootServer;
let url: string;
const sockets: HfClientSocket[] = [];

async function open(): Promise<HfClientSocket> {
  const socket = connect(url);
  sockets.push(socket);
  await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
  return socket;
}

const card = (rank: Rank, suit: Suit): Card => ({ id: `t-${rank}-${suit}`, rank, suit });

beforeEach(async () => {
  installDom();
  server = createServer();
  url = `http://localhost:${await server.listen(0)}`;
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await server.close();
});

describe("lay down for me", () => {
  it("stages a lay-down after taking the pile that the server accepts", async () => {
    // Loaded once the document exists, as a page loads them.
    const { cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
    const { MemoryRouter, Route, Routes } = await import("react-router-dom");
    const { Table } = await import("./routes/Table");

    const [ana, ben] = [await open(), await open()];
    const created = await createRoom(ana, "ana");
    if (!created.ok) throw new Error(created.error);
    const { roomId } = created.data;
    await joinRoom(ben, roomId, "ben");
    await startGame(ana);

    // Ana, round 1 (60 to get down), not down, in her draw: two kings and three
    // aces in hand, and a king on the pile. Taking it is allowed, and the lay-down
    // that allowed it is the kings and the aces, 75.
    const room = server.manager.get(roomId)!;
    const state = room.gameState!;
    const hand = [
      card("K", "hearts"),
      card("K", "spades"),
      card("A", "hearts"),
      card("A", "spades"),
      card("A", "diamonds"),
      card("9", "clubs"),
      card("5", "diamonds"),
    ];
    const rigged: GameState = {
      ...state,
      currentSeat: 0,
      phase: "draw",
      discard: [card("4", "hearts"), card("K", "clubs")],
      players: state.players.map((p, seat) =>
        seat === 0 ? { ...p, hand, isDown: false, melds: [], pickedUp: [] } : p,
      ),
    };
    Object.assign(room as unknown as { state: GameState }, { state: rigged });

    useSession.setState({ credentials: created.data, status: "connected" });
    const detach = attachSession(ana, useSession.getState());
    try {
      room.onChange?.();
      render(
        <MemoryRouter initialEntries={[`/room/${roomId}`]}>
          <Routes>
            <Route path="/room/:roomId" element={<Table socket={ana} />} />
          </Routes>
        </MemoryRouter>,
      );
      const page = within(document.body);

      fireEvent.click(await page.findByRole("button", { name: /take the pile/i }));
      fireEvent.click(await page.findByRole("button", { name: "Lay down for me" }));
      // Staged, not played: the server has seen nothing but the take.
      expect(room.gameState!.players[0]!.melds).toEqual([]);
      expect(page.getByLabelText(/worth 75 of 60 needed/i)).toBeTruthy();

      fireEvent.click(page.getByRole("button", { name: "Play melds" }));
      await waitFor(() => expect(room.gameState!.players[0]!.isDown).toBe(true));
      const after = room.gameState!.players[0]!;
      expect(after.pickedUp).toEqual([]);
      expect(after.melds.map((m) => [m.rank, m.cards.length])).toEqual([
        ["A", 3],
        ["K", 3],
      ]);
      expect(useSession.getState().notice).toBeNull();
      // Down, the offer is gone, and the discard is open.
      await waitFor(() =>
        expect(page.queryByRole("button", { name: "Lay down for me" })).toBeNull(),
      );
      cleanup();
    } finally {
      detach();
    }
  });
});
