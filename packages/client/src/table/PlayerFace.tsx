/**
 * Whoever sits in a seat, as a face: a person's avatar, or a computer's two eyes
 * on its level's color, as the waiting room draws them, so a computer reads as one
 * at a glance on every screen of the table.
 */
import type { RoomPlayerInfo } from "@hf/shared";
import { BotFace } from "../home/sheets";
import { AvatarFace } from "../profile/Avatar";
import { faceOf } from "../profile/avatarStore";

export function PlayerFace({
  player,
  size,
}: {
  readonly player: Pick<RoomPlayerInfo, "name" | "avatar" | "bot" | "botLevel"> | undefined;
  readonly size: number;
}): React.ReactElement {
  if (!player)
    return (
      <span className="shrink-0 rounded-full bg-raised" style={{ width: size, height: size }} />
    );
  if (player.bot) return <BotFace level={player.botLevel ?? "standard"} size={size} />;
  return <AvatarFace avatar={faceOf(player)} size={size} />;
}
