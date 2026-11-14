import { DurableObject } from "cloudflare:workers";
import type { AppBindings } from "../types";
import type { DoorEvent } from "../lib/door-events";
import type { FridgeStatusSnapshot } from "../lib/status";
import type { TelemetrySample } from "../lib/telemetry";

export type FridgeRoomEvent =
  | { type: "connected"; fridgeId: string }
  | { type: "telemetry"; samples: TelemetrySample[]; last_seen_s: number }
  | { type: "status"; status: FridgeStatusSnapshot }
  | { type: "door_events"; events: DoorEvent[] }
  | {
      type: "inventory_changed";
      action: "created" | "updated" | "deleted";
      itemId: string;
    }
  | { type: "member_revoked"; email: string }
  | { type: "fridge_deleted" };

interface SocketAttachment {
  email: string;
  fridgeId: string;
  connectedAtS: number;
}

function memberTag(email: string): string {
  return `member:${email.trim().toLowerCase()}`;
}

export class FridgeRoom extends DurableObject<AppBindings> {
  constructor(ctx: DurableObjectState, env: AppBindings) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/broadcast") {
      const event = (await request.json()) as FridgeRoomEvent;
      this.handleRoomEvent(event);
      return Response.json({
        ok: true,
        clients: this.ctx.getWebSockets().length,
      });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const email = request.headers
        .get("x-fw-user-email")
        ?.trim()
        .toLowerCase();
      const fridgeId = request.headers.get("x-fw-fridge-id")?.trim();
      if (!email || !fridgeId) {
        return new Response("Unauthorized", { status: 401 });
      }

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      const attachment: SocketAttachment = {
        email,
        fridgeId,
        connectedAtS: Math.floor(Date.now() / 1000),
      };

      this.ctx.acceptWebSocket(server, [memberTag(email)]);
      server.serializeAttachment(attachment);
      server.send(
        JSON.stringify({
          type: "connected",
          fridgeId,
        } satisfies FridgeRoomEvent),
      );

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Not found", { status: 404 });
  }

  private handleRoomEvent(event: FridgeRoomEvent): void {
    if (event.type === "member_revoked") {
      const payload = JSON.stringify(event);
      for (const ws of this.ctx.getWebSockets(memberTag(event.email))) {
        try {
          ws.send(payload);
          ws.close(4003, "Access revoked");
        } catch {
          // Ignore sockets already closing.
        }
      }
      return;
    }

    if (event.type === "fridge_deleted") {
      const payload = JSON.stringify(event);
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.send(payload);
          ws.close(4004, "Fridge deleted");
        } catch {
          // Ignore sockets already closing.
        }
      }
      return;
    }

    const payload = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        try {
          ws.close(1011, "Send failed");
        } catch {
          // Ignore already closed socket.
        }
      }
    }
  }

  override async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof message !== "string") return;
    if (message === "ping") {
      ws.send("pong");
    }
  }

  override async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    try {
      ws.close(
        code === 1005 || code === 1006 ? 1000 : code,
        reason || "Closed",
      );
    } catch {
      // Ignore already closed socket.
    }
  }

  override async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    try {
      ws.close(1011, "WebSocket error");
    } catch {
      // Ignore already closed socket.
    }
  }
}
