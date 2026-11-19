/**
 * Chat at the table: how much a seat may say, and how much the table remembers.
 *
 * Messages get their own budget, separate from reactions, so a player who has
 * just sent three reactions can still type, and one typing cannot spend the
 * reactions. Like the reactions' it is kept in memory only, so a wake refills it;
 * a table only sleeps after sitting idle, which a stream of messages is not.
 *
 * The table keeps the last `CHAT_KEPT` messages for whoever sits down, comes
 * back, or starts watching. Never in the room's record or its log, so never in
 * a match's record or a replay either: the action log is the reinforcement
 * learning corpus, and what players say is not part of the game.
 */
import type { ChatMessage } from "@hf/shared";
import type { Clock } from "./clock";
import { SeatLimiter } from "./reactions";

/** Messages a seat may send at once. */
export const CHAT_BURST = 5;
/** How long it takes to earn one more. */
export const CHAT_REFILL_MS = 2_000;
/** How many messages a table remembers, most recent last. */
export const CHAT_KEPT = 50;

export class ChatLimiter extends SeatLimiter {
  constructor(clock: Clock) {
    super(clock, CHAT_BURST, CHAT_REFILL_MS);
  }
}

/** The kept history with one more message, dropping the oldest past `CHAT_KEPT`. */
export function withMessage(
  history: readonly ChatMessage[],
  message: ChatMessage,
): readonly ChatMessage[] {
  return [...history, message].slice(-CHAT_KEPT);
}
