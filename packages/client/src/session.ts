/**
 * Everything the client knows about the table it is sitting at.
 *
 * The store holds state and plain setters and knows nothing about sockets; the
 * wiring lives in `attachSession` below. Keeping them apart means the reducers
 * can be asserted without a transport and the routing can be asserted without a
 * browser, which is the same split that makes the server's `Room` testable
 * without Socket.io.
 *
 * The server is authoritative, so nothing here is applied optimistically: state
 * changes when a `ViewUpdate` says it has. The one thing the client owns is the
 * clock offset, because only it knows what its own clock reads.
 */
import { create } from "zustand";
import {
  isReactionId,
  type ChatMessage,
  type Reaction,
  type RoomInfo,
  type RoundEnded,
  type SeatCredentials,
  type ViewUpdate,
} from "@hf/shared";
import { clearCredentials, saveCredentials } from "./credentials";
import { forgetHistory } from "./historyCache";
import { noteRoom } from "./savedGames";
import { createServerClock, type ServerClock } from "./serverTime";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface SessionState {
  status: ConnectionStatus;
  /** Null until this browser has joined a seat, or after it leaves one. */
  credentials: SeatCredentials | null;
  /** Lobby-level facts. Arrives before the game starts, unlike `update`. */
  room: RoomInfo | null;
  /** The latest per-seat update. Null until the game starts. */
  update: ViewUpdate | null;
  /** Set once a round finishes, and cleared when a new one is dealt. */
  result: RoundEnded | null;
  /** The last rejection the server sent back, for the UI to surface. */
  notice: string | null;
  /**
   * Quick reactions heard at this table, most recent last and only the last few:
   * they are shown for a moment and forgotten, never part of the game.
   */
  reactions: readonly Reaction[];
  /**
   * What has been said at this table, oldest first and only the last `KEPT_CHAT`.
   * Each table's history (`chatBacklog`, sent whenever a seat is taken or taken
   * back, or watching starts) replaces it, so moving to another table brings that
   * table's history with it; it is not cleared when the seat changes, because the
   * new table's history can arrive before the request that took the seat answers.
   */
  chat: readonly ChatMessage[];
  /**
   * The newest message that came as history rather than as it was said: old news,
   * so it neither pops up by its sender's seat nor counts as unread. A message's
   * number comes from the server's clock, so a mark left by one table is older
   * than anything said later at the next.
   */
  chatHistoryThrough: number;
  readonly clock: ServerClock;

  setStatus(status: ConnectionStatus): void;
  /** Remember a seat, persisting it so a reload can reclaim it. */
  seat(credentials: SeatCredentials): void;
  /**
   * Take the seat number the server says this socket now holds, after others
   * left the lobby and the seats closed up. The token, and so the seat, is the
   * same; only its position moved.
   */
  reseat(seat: number): void;
  /** Forget the seat and everything about the table. */
  leave(): void;
  applyRoom(room: RoomInfo): void;
  applyUpdate(update: ViewUpdate): void;
  applyResult(result: RoundEnded): void;
  applyReaction(reaction: Reaction): void;
  /** One message said at the table, the player's own included. */
  applyChat(message: ChatMessage): void;
  /** What has been said so far, from the server, replacing whatever was held. */
  applyChatBacklog(messages: readonly ChatMessage[]): void;
  setNotice(notice: string | null): void;
}

/** How many reactions the store keeps: enough for every seat's latest. */
export const KEPT_REACTIONS = 16;
/** How many chat messages the store keeps: as many as the server keeps for a reload. */
export const KEPT_CHAT = 50;

/** Everything a page that has left the table forgets: what was heard and said there. */
const NO_TABLE_TALK = { reactions: [], chat: [], chatHistoryThrough: 0 } as const;

export const useSession = create<SessionState>((set, get) => ({
  status: "connecting",
  credentials: null,
  room: null,
  update: null,
  result: null,
  notice: null,
  ...NO_TABLE_TALK,
  clock: createServerClock(),

  setStatus: (status) => set({ status }),

  seat: (credentials) => {
    saveCredentials(credentials);
    // A different table: nothing held about the old one — its room, its last view,
    // above all its scoreboard — belongs at this one.
    if (get().credentials?.roomId !== credentials.roomId) {
      // The last table's match may have ended, or been left: the history is stale.
      forgetHistory();
      // Chat is the exception: see `chat`.
      set({ credentials, room: null, update: null, result: null, reactions: [] });
      return;
    }
    set({ credentials });
  },

  reseat: (seat) => {
    const credentials = get().credentials;
    if (!credentials) return;
    get().seat({ ...credentials, seat });
  },

  leave: () => {
    clearCredentials();
    // A game left, or one closed under the player, is in the history now.
    forgetHistory();
    set({
      credentials: null,
      room: null,
      update: null,
      result: null,
      notice: null,
      ...NO_TABLE_TALK,
    });
  },

  applyRoom: (room) => {
    noteRoom(room, get().credentials, get().update?.view.roundNumber ?? null);
    set({ room });
  },

  applyUpdate: (update) => {
    // Anchor before storing, so the first render of a deadline already has an
    // offset to read it through.
    get().clock.anchor(update.clock.serverNow);
    noteRoom(update.room, get().credentials, update.view.roundNumber);
    // A `ViewUpdate` carries the room too, and it is at least as fresh as any
    // standalone `room` event, so it wins.
    set({
      update,
      room: update.room,
      // A fresh deal ends the previous round's scoreboard — and a view from another
      // table ends any scoreboard at all, even at the same round number.
      result:
        update.room.roomId !== get().update?.room.roomId ||
        update.view.roundNumber !== get().update?.view.roundNumber
          ? null
          : get().result,
    });
  },

  applyResult: (result) => {
    // A finished match is in the history now; ask afresh next time it is shown.
    if (result.matchOver) forgetHistory();
    set({ result });
  },

  applyReaction: (reaction) => {
    // A reaction added after this page loaded (the server is newer) has nothing
    // here to show it with: it is left out rather than shown as nothing.
    if (!isReactionId(reaction.id)) return;
    set({ reactions: [...get().reactions, reaction].slice(-KEPT_REACTIONS) });
  },

  applyChat: (message) => {
    // The sender hears their own message too, and a message can also arrive in a
    // history: one already held is not shown twice.
    const chat = get().chat;
    if (chat.some((m) => m.seq === message.seq)) return;
    const next = [...chat, message].sort((a, b) => a.seq - b.seq).slice(-KEPT_CHAT);
    set({ chat: next });
  },

  applyChatBacklog: (messages) => {
    const latest = messages.reduce((most, m) => Math.max(most, m.seq), 0);
    set({
      chat: [...messages].sort((a, b) => a.seq - b.seq).slice(-KEPT_CHAT),
      chatHistoryThrough: Math.max(get().chatHistoryThrough, latest),
    });
  },

  setNotice: (notice) => set({ notice }),
}));

/**
 * Just the socket surface the wiring needs, so tests need no real transport.
 *
 * `off` is declared per event rather than as `(event: string, …)`: socket.io's own
 * `off` only accepts event names it knows about, so a wider signature here would
 * make the real socket fail to satisfy this interface.
 */
export interface SessionSocket {
  /** Whether the transport is up now; it may have said so before anyone listened. */
  readonly connected?: boolean;
  on(event: "connect" | "disconnect", handler: () => void): void;
  on(event: "view", handler: (update: ViewUpdate) => void): void;
  on(event: "room", handler: (info: RoomInfo) => void): void;
  on(event: "roundEnded", handler: (result: RoundEnded) => void): void;
  on(event: "seat", handler: (seat: number) => void): void;
  on(event: "reaction", handler: (reaction: Reaction) => void): void;
  on(event: "chat", handler: (message: ChatMessage) => void): void;
  on(event: "chatBacklog", handler: (messages: readonly ChatMessage[]) => void): void;
  off(event: "connect" | "disconnect", handler: () => void): void;
  off(event: "view", handler: (update: ViewUpdate) => void): void;
  off(event: "room", handler: (info: RoomInfo) => void): void;
  off(event: "roundEnded", handler: (result: RoundEnded) => void): void;
  off(event: "seat", handler: (seat: number) => void): void;
  off(event: "reaction", handler: (reaction: Reaction) => void): void;
  off(event: "chat", handler: (message: ChatMessage) => void): void;
  off(event: "chatBacklog", handler: (messages: readonly ChatMessage[]) => void): void;
}

/** The subset of the store the wiring writes to. */
export type SessionSink = Pick<
  SessionState,
  | "setStatus"
  | "applyRoom"
  | "applyUpdate"
  | "applyResult"
  | "reseat"
  | "applyReaction"
  | "applyChat"
  | "applyChatBacklog"
>;

/**
 * Route the server's broadcasts into the store.
 *
 * Returns a teardown, because React will attach this more than once — a remount
 * in development, a reconnect in production — and listeners left behind would
 * apply every update twice.
 */
export function attachSession(socket: SessionSocket, sink: SessionSink): () => void {
  const onConnect = (): void => sink.setStatus("connected");
  const onDisconnect = (): void => sink.setStatus("disconnected");
  const onView = (update: ViewUpdate): void => sink.applyUpdate(update);
  const onRoom = (info: RoomInfo): void => sink.applyRoom(info);
  const onResult = (result: RoundEnded): void => sink.applyResult(result);
  const onSeat = (seat: number): void => sink.reseat(seat);
  const onReaction = (reaction: Reaction): void => sink.applyReaction(reaction);
  const onChat = (message: ChatMessage): void => sink.applyChat(message);
  const onChatBacklog = (messages: readonly ChatMessage[]): void => sink.applyChatBacklog(messages);

  socket.on("connect", onConnect);
  socket.on("disconnect", onDisconnect);
  socket.on("view", onView);
  socket.on("room", onRoom);
  socket.on("roundEnded", onResult);
  socket.on("seat", onSeat);
  socket.on("reaction", onReaction);
  socket.on("chat", onChat);
  socket.on("chatBacklog", onChatBacklog);
  // The transport announces itself on its own schedule, which can be before the app
  // has mounted and attached this; asking catches up on what was missed.
  if (socket.connected) sink.setStatus("connected");

  return () => {
    socket.off("connect", onConnect);
    socket.off("disconnect", onDisconnect);
    socket.off("view", onView);
    socket.off("room", onRoom);
    socket.off("roundEnded", onResult);
    socket.off("seat", onSeat);
    socket.off("reaction", onReaction);
    socket.off("chat", onChat);
    socket.off("chatBacklog", onChatBacklog);
  };
}
