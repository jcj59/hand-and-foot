/**
 * This device's picture: the avatar the player put together on the home screen,
 * kept in local storage like their name, and sent with them when they sit down.
 *
 * It is kept per device for now, as the rules choice is; it moves to the identity
 * when accounts do (roadmap item 15). A player who never chose one has none, and
 * every screen draws them from their name instead (`faceOf`), so they still look
 * the same everywhere.
 */
import { defaultAvatar, parseAvatar, type Avatar, type RoomPlayerInfo } from "@hf/shared";

export const AVATAR_KEY = "hf.avatar";

/** The picture this device chose, or null for none — or for one stored damaged. */
export function loadAvatar(): Avatar | null {
  try {
    const raw = window.localStorage.getItem(AVATAR_KEY);
    return raw === null ? null : parseAvatar(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Keep a picture, or forget it (null) and go back to the one drawn from the name. */
export function saveAvatar(avatar: Avatar | null): void {
  try {
    if (avatar === null) window.localStorage.removeItem(AVATAR_KEY);
    else window.localStorage.setItem(AVATAR_KEY, JSON.stringify(avatar));
  } catch {
    // Blocked storage: the picture lasts as long as the page.
  }
}

/** The face to draw for a seat: the one they chose, or the one their name gives them. */
export function faceOf(player: Pick<RoomPlayerInfo, "name" | "avatar">): Avatar {
  return player.avatar ?? defaultAvatar(player.name);
}
