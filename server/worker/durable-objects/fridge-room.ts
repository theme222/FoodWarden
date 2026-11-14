import { DurableObject } from "cloudflare:workers";
import type { AppBindings } from "../types";

export class FridgeRoom extends DurableObject<AppBindings> {
  override async fetch(_request: Request): Promise<Response> {
    return new Response("WebSocket endpoint will be enabled in Part 4.", {
      status: 501,
    });
  }
}
