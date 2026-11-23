import type { OpenAPIV3_1 } from "openapi-types";
import { CATEGORIES } from "./inventory";
import { DOOR_EVENT_STATUSES } from "./door-events";

type Schema = OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject;
const ref = (name: string): Schema => ({
  $ref: `#/components/schemas/${name}`,
});
const text: Schema = { type: "string" };
const timestamp: Schema = {
  type: "integer",
  minimum: 0,
  description:
    "Unix time in seconds. Event ingestion permits at most five minutes of future clock skew; historical buffered events remain valid.",
};
const nullableNumber: Schema = { type: ["number", "null"] };
const date: Schema = {
  type: "string",
  format: "date",
  description: "Valid calendar date, YYYY-MM-DD.",
};
const object = (
  properties: Record<string, Schema>,
  required: string[] = Object.keys(properties),
): Schema => ({ type: "object", properties, required });
const array = (items: Schema): Schema => ({ type: "array", items });
const json = (schema: Schema): OpenAPIV3_1.MediaTypeObject => ({ schema });
const response = (
  description: string,
  schema?: Schema,
): OpenAPIV3_1.ResponseObject => ({
  description,
  ...(schema ? { content: { "application/json": json(schema) } } : {}),
});
const body = (schema: Schema): OpenAPIV3_1.RequestBodyObject => ({
  required: true,
  content: { "application/json": json(schema) },
});
const session: OpenAPIV3_1.SecurityRequirementObject[] = [
  { BrowserSession: [] },
  { SecureBrowserSession: [] },
];
const gateway: OpenAPIV3_1.SecurityRequirementObject[] = [
  { GatewayBearer: [] },
];
const ok = object({ ok: { type: "boolean" } });
const itemId = object({ item_id: text });
const settingsPatch = object(
  {
    name: { type: "string", minLength: 1, maxLength: 80 },
  },
  [],
);
const checkIn = object({
  name_th: { type: "string", minLength: 1, maxLength: 120 },
  name_en: { type: "string", minLength: 1, maxLength: 120 },
  category: ref("Category"),
  category_th: { type: "string", minLength: 1, maxLength: 120 },
  estimated_shelf_life_days: { type: "integer", minimum: 0, maximum: 3650 },
  estimated_expiry_date: date,
  storage_recommendation_th: { type: "string", maxLength: 300 },
  storage_recommendation_en: { type: "string", maxLength: 300 },
  image_storage_path: {
    type: "string",
    description:
      "Use the opaque path returned by the draft endpoint; it must belong to this fridge.",
  },
  confidence: { type: "number", minimum: 0, maximum: 1 },
});
const schemas: Record<string, Schema> = {
  Error: object({ error: text, message: text }),
  Category: { type: "string", enum: [...CATEGORIES] },
  TelemetrySample: object({
    node_id: { type: "string", minLength: 1, maxLength: 128 },
    timestamp_s: timestamp,
    temp_celsius: nullableNumber,
    voc_index: nullableNumber,
    light_ldr: nullableNumber,
  }),
  DoorEvent: object({
    node_id: { type: "string", minLength: 1, maxLength: 128 },
    timestamp_s: timestamp,
    status: { type: "string", enum: [...DOOR_EVENT_STATUSES] },
  }),
  InventoryItem: object({
    id: text,
    name_th: text,
    name_en: text,
    category: ref("Category"),
    category_th: text,
    estimated_expiry_date: date,
    storage_recommendation_th: text,
    storage_recommendation_en: text,
    check_in_timestamp_s: timestamp,
    image_storage_path: { type: ["string", "null"] },
    confidence: { type: "number" },
    check_in_source: { type: "string", enum: ["CAMERA", "WEB_MANUAL"] },
  }),
  Fridge: object({
    id: text,
    name: text,
    role: { type: "string", enum: ["owner", "member"] },
    last_seen_s: timestamp,
    last_telemetry: { anyOf: [ref("TelemetrySample"), { type: "null" }] },
    inventory_count: { type: "integer", minimum: 0 },
    expiring_soon_count: { type: "integer", minimum: 0, description: "Items expiring today through three calendar days ahead in Asia/Bangkok." },
  }),
  Settings: object({
    id: text,
    name: text,
    line_target_id: { type: ["string", "null"] },
    gateway_token: {
      type: "string",
      description:
        "Private credential returned only to owners. Never share or commit it.",
    },
    has_gemini_api_key: { type: "boolean" },
    members: array(
      object({
        email: { type: "string", format: "email" },
        role: { type: "string", enum: ["owner", "member"] },
        added_at_s: timestamp,
      }),
    ),
  }),
  Status: object({
    gateway_seen_s: timestamp,
    received_s: timestamp,
    nodes: array(
      object({
        node_id: text,
        last_seen_s: { type: ["integer", "null"] },
        last_known_seen_s: { type: ["integer", "null"] },
      }),
    ),
  }),
  CheckIn: checkIn,
  ManualFood: object(
    {
      item_id: {
        type: "string",
        format: "uuid",
        description: "Client-generated UUID v4 for idempotent retries.",
      },
      name: { type: "string", minLength: 1, maxLength: 100 },
      estimated_expiry_date: date,
      category: ref("Category"),
      jpeg_base64: {
        type: "string",
        description:
          "Optional base64-encoded JPEG, at most 1,500,000 bytes decoded; omit when no photo is available.",
      },
    },
    ["item_id", "name", "estimated_expiry_date", "category"],
  ),
  InventoryPatch: {
    ...object(
      {
        name_th: text,
        name_en: text,
        estimated_expiry_date: date,
        category: ref("Category"),
      },
      [],
    ),
    minProperties: 1,
  },
};

const paths: OpenAPIV3_1.PathsObject = {};
function route(
  path: string,
  method: "get" | "post" | "patch" | "put" | "delete",
  summary: string,
  tag: string,
  options: Partial<OpenAPIV3_1.OperationObject> = {},
): void {
  const parameters: OpenAPIV3_1.ParameterObject[] = [
    ...path.matchAll(/\{([^}]+)\}/g),
  ].map((match) => ({
    name: match[1]!,
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
  if (
    method === "post" &&
    [
      "/api/inventory/checkin/draft",
      "/api/inventory/checkout/draft",
      "/api/inventory/checkin",
    ].includes(path)
  ) {
    parameters.push({
      in: "header",
      name: "Idempotency-Key",
      required: true,
      description:
        "UUID v4 per logical operation. Persist and reuse for identical retries; new real items and intentional analyses need a new UUID. Reusing a key with different input returns 409. Pending/uncertain operations never automatically regenerate.",
      schema: { type: "string", format: "uuid" },
    });
  }
  const operation: OpenAPIV3_1.OperationObject = {
    summary,
    tags: [tag],
    security: session,
    operationId: `${method}_${path.replace(/[^a-zA-Z0-9]+/g, "_")}`,
    ...options,
    parameters: [...parameters, ...(options.parameters ?? [])],
    responses: {
      "200": response("Success", ok),
      default: response(
        "Request rejected or service unavailable; inspect the error code and message.",
        ref("Error"),
      ),
      ...options.responses,
    },
  };
  if (
    options.responses &&
    !("200" in options.responses) &&
    ("201" in options.responses || "101" in options.responses)
  )
    delete operation.responses?.["200"];
  paths[path] = { ...paths[path], [method]: operation };
}
const get = "get";
const post = "post";
const patch = "patch";
const put = "put";
const del = "delete";

route("/api/health", get, "Check Worker and D1 health", "System", {
  security: [],
  responses: {
    "200": response(
      "Database reachable",
      object({ ok: { const: true }, database: { const: "ok" } }),
    ),
  },
});
route(
  "/api/auth/config",
  get,
  "Read available sign-in methods",
  "Authentication",
  {
    security: [],
    responses: {
      "200": response(
        "Provider availability",
        object({
          googleEnabled: { type: "boolean" },
          devLoginEnabled: { type: "boolean" },
        }),
      ),
    },
  },
);
route(
  "/api/ui/config",
  get,
  "Read default dashboard UI version and emergency lock flag",
  "Authentication",
  {
    security: [],
    responses: {
      "200": response(
        "UI version feature flag configuration",
        object({
          defaultVersion: { type: "string", enum: ["v1", "v2"] },
          locked: { type: "boolean" },
        }),
      ),
    },
  },
);
route(
  "/api/auth/dev-login",
  post,
  "Create a local development session",
  "Authentication",
  {
    security: [],
    description:
      "Only enabled in development with DEV_AUTH_BYPASS_EMAIL configured. Returns 404 otherwise. Sets an HttpOnly session cookie.",
    responses: {
      "200": response(
        "Signed in",
        object({ ok: { type: "boolean" }, email: text }),
      ),
    },
  },
);
route("/api/fridges", get, "List your fridges", "Fridges", {
  responses: {
    "200": response(
      "Accessible fridges",
      object({ fridges: array(ref("Fridge")) }),
    ),
  },
});
route("/api/fridges", post, "Create a fridge", "Fridges", {
  requestBody: body(
    object({ name: { type: "string", minLength: 1, maxLength: 80 } }),
  ),
  responses: {
    "201": response(
      "Created; retrieve the gateway credential from owner Settings",
      object({ id: text, name: text, role: { const: "owner" } }),
    ),
  },
});
route(
  "/api/fridges/{fridgeId}",
  patch,
  "Update fridge name or LINE target",
  "Fridges",
  {
    description:
      "Owner only. Supply at least one editable field. Empty string or null clears the LINE target.",
    requestBody: body(settingsPatch),
  },
);
route(
  "/api/fridges/{fridgeId}",
  del,
  "Delete a fridge and its stored data",
  "Fridges",
  {
    description:
      "Owner only. Permanently removes inventory, photos, telemetry and memberships; closes active sockets.",
    responses: {
      "200": response(
        "Deleted",
        object({ ok: { type: "boolean" }, deleted: { type: "boolean" } }),
      ),
    },
  },
);
route(
  "/api/fridges/{fridgeId}/settings",
  get,
  "Read private fridge settings",
  "Settings",
  {
    description:
      "Owner only. Contains the gateway token; do not copy the response into shared logs.",
    responses: { "200": response("Owner settings", ref("Settings")) },
  },
);
route(
  "/api/fridges/{fridgeId}/settings",
  put,
  "Update private fridge settings",
  "Settings",
  {
    description:
      "Owner only. Supply name and/or gemini_api_key. Empty string or null clears a saved Gemini key. LINE recipients must use verified pairing and dedicated disconnect. The Gemini key is never returned.",
    requestBody: body(
      object(
        {
          name: { type: "string", minLength: 1, maxLength: 80 },
          gemini_api_key: {
            type: ["string", "null"],
            maxLength: 256,
            writeOnly: true,
          },
        },
        [],
      ),
    ),
    responses: { "200": response("Updated settings", ref("Settings")) },
  },
);
route(
  "/api/fridges/{fridgeId}/gateway-token/rotate",
  post,
  "Rotate the gateway token",
  "Settings",
  {
    description:
      "Owner only. Invalidates the old token immediately; update the physical gateway afterwards.",
    responses: {
      "200": response(
        "New private credential",
        object({ gateway_token: text }),
      ),
    },
  },
);
route(
  "/api/fridges/{fridgeId}/members",
  post,
  "Add a member or change a role",
  "Settings",
  {
    description: "Owner only. The last owner cannot be demoted.",
    requestBody: body(
      object(
        {
          email: { type: "string", format: "email" },
          role: {
            type: "string",
            enum: ["owner", "member"],
            default: "member",
          },
        },
        ["email"],
      ),
    ),
    responses: {
      "201": response(
        "Member saved",
        object({ ok: { type: "boolean" }, email: text, role: text }),
      ),
    },
  },
);
route(
  "/api/fridges/{fridgeId}/members/{email}",
  del,
  "Remove a fridge member",
  "Settings",
  {
    description:
      "Owner only. Cannot remove the last owner. Revokes the member's active fridge sockets.",
    responses: {
      "200": response(
        "Removed",
        object({ ok: { type: "boolean" }, deleted: { type: "boolean" } }),
      ),
    },
  },
);
route(
  "/api/fridges/{fridgeId}/inventory",
  get,
  "List inventory in FEFO order",
  "Inventory",
  {
    responses: {
      "200": response(
        "Inventory",
        object({ items: array(ref("InventoryItem")) }),
      ),
    },
  },
);
route(
  "/api/fridges/{fridgeId}/inventory",
  post,
  "Add food manually",
  "Inventory",
  {
    description:
      "Members and owners. Retrying the same item_id and payload is idempotent; changed data with the same ID returns 409.",
    requestBody: body(ref("ManualFood")),
    responses: {
      "200": response("Idempotent retry", itemId),
      "201": response("Created", itemId),
    },
  },
);
route(
  "/api/fridges/{fridgeId}/inventory/{itemId}",
  patch,
  "Edit an inventory item",
  "Inventory",
  {
    requestBody: body(ref("InventoryPatch")),
    responses: {
      "200": response(
        "Updated",
        object({ ok: { type: "boolean" }, item_id: text }),
      ),
    },
  },
);
route(
  "/api/fridges/{fridgeId}/inventory/{itemId}",
  del,
  "Delete an item and its photo",
  "Inventory",
  {
    responses: {
      "200": response(
        "Deleted",
        object({
          ok: { type: "boolean" },
          item_id: text,
          deleted: { type: "boolean" },
        }),
      ),
    },
  },
);
route(
  "/api/fridges/{fridgeId}/inventory/{itemId}/photo",
  get,
  "Read a private food photo",
  "Inventory",
  {
    description:
      "Members and owners only. The R2 object is streamed through this authenticated route.",
    responses: {
      "200": {
        description: "Private JPEG",
        content: {
          "image/jpeg": { schema: { type: "string", format: "binary" } },
        },
      },
    },
  },
);
route(
  "/api/fridges/{fridgeId}/telemetry",
  get,
  "Read telemetry history",
  "Monitoring",
  {
    parameters: [
      {
        in: "query",
        name: "range",
        schema: { type: "string", enum: ["1h", "24h", "7d"], default: "1h" },
        description: "Unknown values fall back to 1h.",
      },
    ],
    responses: {
      "200": response(
        "Up to 2,000 samples in chronological order",
        object({ samples: array(ref("TelemetrySample")) }),
      ),
    },
  },
);
route(
  "/api/fridges/{fridgeId}/status",
  get,
  "Read latest node status",
  "Monitoring",
  {
    responses: {
      "200": response(
        "Latest status, or null before first report",
        object({ status: { anyOf: [ref("Status"), { type: "null" }] } }),
      ),
    },
  },
);
route(
  "/api/fridges/{fridgeId}/activity",
  get,
  "Read paginated fridge activity",
  "Monitoring",
  {
    parameters: [
      { in: "query", name: "kind", schema: { type: "string", enum: ["inventory", "door", "sensor"], default: "inventory" } },
      { in: "query", name: "date", schema: { type: "string", format: "date" }, description: "Calendar date in Asia/Bangkok. Omit to browse all dates." },
      { in: "query", name: "before", schema: { type: "string" }, description: "Opaque next cursor from the previous page." },
    ],
    responses: {
      "200": response("Up to 15 activities in newest-first order", object({
        rows: {
          type: "array",
          maxItems: 15,
          items: { anyOf: [
            { allOf: [ref("DoorEvent"), object({ id: { type: "integer" } })] },
            { allOf: [ref("TelemetrySample"), object({ id: { type: "integer" } })] },
            object({
              id: { type: "integer" },
              timestamp_s: timestamp,
              action: { type: "string", enum: ["created", "updated", "deleted"] },
              name_th: text,
              name_en: text,
              source: { enum: ["CAMERA", "WEB_MANUAL", null] },
            }),
          ] },
        },
        next: { type: ["string", "null"] },
      })),
      "400": response("Invalid activity filter", ref("Error")),
    },
  },
);
route(
  "/api/fridges/{fridgeId}/door_events",
  get,
  "Read recent door events",
  "Monitoring",
  {
    parameters: [
      {
        in: "query",
        name: "limit",
        schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
    ],
    responses: {
      "200": response(
        "Door events",
        object({ events: array(ref("DoorEvent")) }),
      ),
    },
  },
);
route(
  "/api/fridges/{fridgeId}/ws",
  get,
  "Connect to live fridge events",
  "Monitoring",
  {
    description:
      "WebSocket upgrade, not a normal REST request. Use a browser WebSocket with the signed-in session. Server emits connected, telemetry, status, door_events, inventory_changed, member_revoked and fridge_deleted. Send text ping to receive pong. Closes with 4003 on revocation or 4004 on fridge deletion. OpenAPI describes only the handshake.",
    responses: {
      "101": response("Switching Protocols; WebSocket events follow"),
      "400": response("Missing WebSocket Upgrade header", ref("Error")),
    },
  },
);
const jpeg: OpenAPIV3_1.RequestBodyObject = {
  required: true,
  content: {
    "multipart/form-data": {
      schema: object({
        image: {
          type: "string",
          format: "binary",
          description: "Valid JPEG, at most 5 MB.",
        },
      }),
    },
  },
};
route(
  "/api/inventory/checkin/draft",
  post,
  "Identify an incoming food photo",
  "Gateway",
  {
    security: gateway,
    requestBody: jpeg,
    description:
      "Uses Gemini and stages a private R2 photo. Does not create an inventory row. Returns 422 for non-food or confidence below 0.60; 503 when AI is unavailable.",
    responses: {
      "200": response("Review this draft before committing", ref("CheckIn")),
      "413": response("Image or multipart body too large", ref("Error")),
      "429": response(
        "AI request quota reached; Retry-After indicates a minimum delay, not a guarantee of available daily quota.",
        ref("Error"),
      ),
      "422": response("Unidentifiable food", ref("Error")),
      "503": response("AI unavailable", ref("Error")),
    },
  },
);
route(
  "/api/inventory/checkin",
  post,
  "Commit a confirmed check-in",
  "Gateway",
  {
    security: gateway,
    requestBody: body(ref("CheckIn")),
    responses: {
      "201": response(
        "Created",
        object({ success: { type: "boolean" }, item_id: text, message: text }),
      ),
    },
  },
);
route(
  "/api/inventory/checkout/draft",
  post,
  "Match an outgoing photo to FEFO candidates",
  "Gateway",
  {
    security: gateway,
    requestBody: jpeg,
    description:
      "Read-only inventory matching with Gemini. Returns candidate_matches for confirmation before deleting anything.",
    responses: {
      "200": response(
        "Candidate matches",
        object({
          match_type: {
            type: "string",
            enum: ["EXACT_MATCH", "AMBIGUOUS_MULTIPLE", "NO_MATCH"],
          },
          candidate_matches: array(
            object({
              item_id: text,
              name_th: text,
              name_en: text,
              category: text,
              category_th: text,
              estimated_expiry_date: date,
            }),
          ),
          confidence: { type: "number" },
          reasoning: text,
        }),
      ),
      "413": response("Image or multipart body too large", ref("Error")),
      "429": response(
        "AI request quota reached; Retry-After indicates a minimum delay, not a guarantee of available daily quota.",
        ref("Error"),
      ),
      "503": response("AI unavailable", ref("Error")),
    },
  },
);
route(
  "/api/inventory/checkout",
  post,
  "Commit a confirmed check-out",
  "Gateway",
  {
    security: gateway,
    requestBody: body(itemId),
    description:
      "Permanently deletes the selected inventory item and associated photo.",
    responses: {
      "200": response(
        "Deleted",
        object({
          success: { type: "boolean" },
          item_id: text,
          status: { const: "deleted" },
          message: text,
        }),
      ),
    },
  },
);
route("/api/telemetry", post, "Upload a telemetry batch", "Gateway", {
  security: gateway,
  requestBody: body(
    object({
      samples: {
        type: "array",
        minItems: 1,
        maxItems: 10000,
        items: ref("TelemetrySample"),
      },
    }),
  ),
  description:
    "First-write-wins deduplication by (node_id, timestamp_s); duplicate or conflicting retries are ignored and do not broadcast or alert. Sensor failures use null readings. Optional ?bypass_cooldown=1 works only in development with an authenticated fridge owner session.",
  responses: {
    "200": response(
      "Ingest result",
      object({
        success: { type: "boolean" },
        ingested_count: { type: "integer" },
      }),
    ),
  },
});
route(
  "/api/status",
  post,
  "Report gateway and sensor contact times",
  "Gateway",
  {
    security: gateway,
    requestBody: body(
      object({
        nodes: {
          type: "array",
          maxItems: 200,
          items: object({
            node_id: { type: "string", minLength: 1, maxLength: 128 },
            last_seen_s: { type: ["integer", "null"], minimum: 0 },
          }),
        },
      }),
    ),
    description:
      "Requires a unique C0 entry with non-null last_seen_s. Node IDs must be unique; times cannot exceed server time by more than 300 seconds.",
    responses: {
      "200": response(
        "Update result",
        object({
          success: { type: "boolean" },
          updated_count: { type: "integer" },
        }),
      ),
    },
  },
);
route("/api/door_events", post, "Upload door safety events", "Gateway", {
  security: gateway,
  requestBody: body(
    object({
      events: {
        type: "array",
        minItems: 1,
        maxItems: 499,
        items: ref("DoorEvent"),
      },
    }),
  ),
  description:
    "First-write-wins deduplication by (node_id, timestamp_s, status); duplicate retries are ignored. May dispatch LINE alerts; optional ?bypass_cooldown=1 works only in development with an authenticated fridge owner session.",
  responses: {
    "200": response(
      "Ingest result",
      object({
        success: { type: "boolean" },
        ingested_count: { type: "integer" },
      }),
    ),
  },
});

const pairing = object({
  code: { type: "string", pattern: "^FW-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$" },
  expires_at_s: timestamp,
  friend_url: { type: ["string", "null"] },
});
route("/api/line/webhook", post, "Receive signed LINE webhook events", "LINE", {
  security: [],
  description:
    "Public transport endpoint, authenticated by HMAC-SHA256 X-Line-Signature over the unchanged raw request body. Not a browser/session endpoint. Rejects bodies above 1 MB; consumes pairing codes once and rechecks issuer permissions.",
  parameters: [
    {
      name: "x-line-signature",
      in: "header",
      required: true,
      schema: { type: "string" },
    },
  ],
  requestBody: body({
    type: "object",
    properties: { events: { type: "array", items: { type: "object" } } },
    required: ["events"],
  }),
  responses: {
    "200": response("Processed", ok),
    "403": response("Invalid webhook signature", ref("Error")),
    "413": response("Body too large", ref("Error")),
    "503": response("LINE not configured", ref("Error")),
  },
});
for (const prefix of ["/api/me/line", "/api/fridges/{fridgeId}/line"]) {
  const owner = prefix.includes("fridges")
    ? "Fridge owner only. "
    : "Current account only. ";
  route(prefix, get, "Read LINE connection status", "LINE", {
    description:
      "Returns connection status and the public add-friend URL, never recipient IDs or secrets.",
    responses: { "200": response("Connection status", { type: "object" }) },
  });
  route(prefix, del, "Disconnect LINE", "LINE", {
    description: owner + "Revokes pending codes and queued delivery attempts.",
    responses: { "200": response("Disconnected", ok) },
  });
  route(
    prefix + "/pair",
    post,
    "Create a one-time LINE connection code",
    "LINE",
    {
      description:
        owner +
        "Code expires in ten minutes. Personal codes only work in direct chat. Five issued codes per account per ten minutes.",
      responses: {
        "201": response("Pairing code", pairing),
        "429": response("Rate limited", ref("Error")),
        "503": response("LINE not configured", ref("Error")),
      },
    },
  );
  route(prefix + "/test", post, "Queue a LINE test notification", "LINE", {
    description:
      owner + "One test per minute; delivery acceptance is not guaranteed.",
    responses: {
      "202": response("Queued", object({ queued: { const: true } })),
      "409": response("Connect LINE first", ref("Error")),
      "429": response("Wait before another test", ref("Error")),
    },
  });
}
route(
  "/api/me/line",
  patch,
  "Update your private notification preferences",
  "LINE",
  {
    requestBody: body(
      object(
        {
          morning_enabled: { type: "boolean" },
          morning_time: {
            type: "string",
            pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
            description: "Asia/Bangkok, 24-hour HH:MM",
          },
          inst_obstruct: { type: "boolean" },
          inst_warm: { type: "boolean" },
          inst_spoil: { type: "boolean" },
        },
        [],
      ),
    ),
    responses: { "200": response("Saved", ok) },
  },
);
route(
  "/api/fridges/{fridgeId}/favorites",
  get,
  "Read your private favorite foods and categories",
  "Favorites",
  {
    responses: {
      "200": response("Favorites with current stock counts", {
        type: "object",
      }),
    },
  },
);
route(
  "/api/fridges/{fridgeId}/favorites/categories",
  put,
  "Set your favorite food categories",
  "Favorites",
  {
    requestBody: body(object({ categories: array(ref("Category")) })),
    responses: { "200": response("Saved", ok) },
  },
);
route(
  "/api/fridges/{fridgeId}/favorites/{itemId}",
  put,
  "Favorite an existing inventory item",
  "Favorites",
  {
    description:
      "Private to the current account. Requires membership and an item in this fridge.",
    responses: { "200": response("Saved", ok) },
  },
);
route(
  "/api/fridges/{fridgeId}/favorites/{key}",
  del,
  "Remove a favorite, including out-of-stock foods",
  "Favorites",
  { responses: { "200": response("Removed", ok) } },
);

// This local reference mirrors existing validators; it does not change runtime validation.
// Keep it aligned with handlers and the canonical interface documents.
export const openApiDocument: OpenAPIV3_1.Document = {
  openapi: "3.1.0",
  info: {
    title: "FoodWarden API",
    version: "1.0.0",
    description:
      "[กลับไปหน้าเว็บ / Back to dashboard](/fridges)\n\nเอกสาร API สำหรับนักพัฒนา / Developer API reference. Test requests execute real operations; use a development fridge.\n\nBrowser routes use your existing HttpOnly Better Auth session and fridge membership. Owner-only operations are labelled. Gateway routes require your own Bearer token; no credentials are embedded here.\n\nBetter Auth's delegated OAuth/session routes are managed by Better Auth and are outside this application reference. Sign in through the dashboard. WebSocket event payloads are not fully described by OpenAPI. This document mirrors current handlers; it is not generated from Zod validators.",
  },
  servers: [{ url: "/", description: "Current FoodWarden origin" }],
  tags: [
    "System",
    "Authentication",
    "Fridges",
    "Settings",
    "Inventory",
    "Monitoring",
    "Gateway",
    "LINE",
    "Favorites",
  ].map((name) => ({ name })),
  components: {
    securitySchemes: {
      BrowserSession: {
        type: "apiKey",
        in: "cookie",
        name: "better-auth.session_token",
        description:
          "Local HTTP session. Sign in through the dashboard; browsers attach HttpOnly cookies automatically for same-origin requests.",
      },
      SecureBrowserSession: {
        type: "apiKey",
        in: "cookie",
        name: "__Secure-better-auth.session_token",
        description:
          "HTTPS session. Sign in through the dashboard; do not paste session cookies into the client.",
      },
      GatewayBearer: {
        type: "http",
        scheme: "bearer",
        description:
          "Fridge-specific gateway token. Obtain from Settings as an owner. Never commit it.",
      },
    },
    schemas,
  },
  paths,
};
