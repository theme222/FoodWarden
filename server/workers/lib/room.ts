import type { FridgeRoomEvent } from "../durable-objects/fridge-room";
import type { AppBindings } from "../types";

export async function notifyFridgeRoom(
  env: AppBindings,
  fridgeId: string,
  event: FridgeRoomEvent,
): Promise<void> {
  try {
    const id = env.FRIDGE_ROOM.idFromName(fridgeId);
    const stub = env.FRIDGE_ROOM.get(id);
    const response = await stub.fetch("https://fridge-room/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    await response.body?.cancel();
  } catch {
    // Realtime push failures must never block or fail primary D1 persistence.
  }
}
