# SUL: Server ('S') ↔ LINE ('L') Interface Contract

This document defines the HTTPS Messaging API and Webhook interface between the cloud backend (**Server `'S'`**, Cloudflare Workers in TypeScript) and the **LINE Messaging API (`'L'`)**.

- **Endpoints:** Server `'S'` (Cloudflare Workers) ↔ LINE Platform (`https://api.line.me`)
- **Directionality:** Unidirectional Push Alerts (`U`, `'S' → 'L'`) with Signed Webhook Pairing & Lifecycle Receipts (`'L' → 'S'`)
- **Transport Protocol:** HTTPS / REST (`application/json`)
- **Security:**
  - Outbound Push / Reply calls authenticate with Bearer Channel Access Token (`LINE_CHANNEL_ACCESS_TOKEN`) and include a deterministic `X-Line-Retry-Key` (UUID v4) for retry safety.
  - Inbound Webhook calls (`POST /api/line/webhook`) are authenticated via HMAC-SHA256 signature verification (`X-Line-Signature` header) computed over the raw UTF-8 request bytes (bounded to 1 MB) using `LINE_CHANNEL_SECRET`.

> [!NOTE]
> **Direct Server Mediation & Per-Tenant Disambiguation:**
> Neither Node `'C'`, Node `'F'`, nor Node `'D'` communicates with LINE directly. All safety, environmental, and expiry notifications are evaluated and deduplicated in Server `'S'` (Cloudflare D1), persisted into durable outboxes (`line_outbox` and `user_line_outbox`), and tagged with the specific refrigerator name and ID (plus user account identity for personal LINE alerts).

---

## 1. Secrets & Configuration

| Secret / Variable           | Location                               | Purpose                                                                                                                                    |
| --------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `LINE_CHANNEL_ACCESS_TOKEN` | Cloudflare Worker secret / `.dev.vars` | Bearer token for `POST /v2/bot/message/push` and `POST /v2/bot/message/reply`                                                              |
| `LINE_CHANNEL_SECRET`       | Cloudflare Worker secret / `.dev.vars` | HMAC-SHA256 shared secret validating `X-Line-Signature` on `POST /api/line/webhook`                                                        |
| `LINE_BOT_BASIC_ID`         | Worker env / `.dev.vars` (optional)    | Public bot handle starting with `@` (e.g. `@foodwarden`) used to generate Add-Friend URLs and QR codes (`https://line.me/R/ti/p/<handle>`) |

> [!IMPORTANT]
> **Zero Secret Leakage Rule:** Never commit `LINE_CHANNEL_ACCESS_TOKEN` or `LINE_CHANNEL_SECRET` to Git, expose them in API responses, or embed them in client-side dashboard bundles.

---

## 2. Interaction Sequences

### A. One-Use Pairing Code Redemption (`POST /api/line/webhook`)

```text
User / Group Chat                 LINE Platform ('L')                Server 'S' (Cloudflare Worker)
        |                                  |                                        |
 [Generate 10-min code on Dashboard: FW-XXXX-XXXX]                                  |
        |                                  | <== Dashboard calls POST .../line/pair |
        |                                  |     Stores SHA-256(code) in D1         |
        |                                  |                                        |
 [Send "FW-XXXX-XXXX" in chat]            |                                        |
        | === Message Event ==============>|                                        |
        |                                  | === POST /api/line/webhook ===========>|
        |                                  |     Header: X-Line-Signature (HMAC)    |
        |                                  |     Body: raw JSON (<= 1 MB)           |
        |                                  |                                        |
        |                                  |                       [Verify X-Line-Signature]
        |                                  |                       [Consume SHA-256(code) atomically]
        |                                  |                       [Recheck active session & owner role]
        |                                  |                       +- scope='user': reject group/room
        |                                  |                       +- scope='fridge': bind fridges.line_target_id
        |                                  |                                        |
        |                                  | <== POST /v2/bot/message/reply ========|
        |                                  |     Reply with fridge/user identity    |
        | <== Confirmation message ========|                                        |
```

### B. Outbound Safety & Spoilage Push Alerts (`'S' → 'L'`)

```text
Node 'C' Gateway                  Server 'S' (Worker + D1 Outbox)        LINE Platform ('L')
        |                                      |                                   |
        | === POST /api/door_events or =======>|                                   |
        |     POST /api/telemetry              |                                   |
        |     (optional ?bypass_cooldown=1)    |                                   |
        |                                      |                                   |
        |                         [Check event dedup + alert_cooldowns]            |
        |                         [Enqueue row in line_outbox / user_line_outbox]  |
        |                         [with stable UUID v4 retry_key]                  |
        |                                      |                                   |
        |                                      | === POST /v2/bot/message/push ===>|
        |                                      |     Authorization: Bearer <TOKEN> |
        |                                      |     X-Line-Retry-Key: <UUID v4>   |
        |                                      |     Body: { to, messages }        |
        |                                      |                                   |
        |                                      | <== 200 OK or retryable 5xx/429 ==|
        |                                      | [If transient failure: Cron '* * * * *' retries]
        |                                      | [After 23h or 4xx reject: mark failed = 1]
```

### C. Daily Expiry Digest & Per-User Morning Summary

```text
Cloudflare Cron Triggers                    Server 'S' (D1 Queries & Outboxes)        LINE ('L')
        |                                                   |                              |
        | === 0 1 * * * (08:00 Asia/Bangkok) ==============>|                              |
        |                                      [Scan active inventory <= 2 days to expiry] |
        |                                      [Acquire daily_expiry_digest cooldown (20h)]|
        |                                      [Queue family push per paired fridge]       |
        |                                                   | === Message push ----------->|
        |                                                   |                              |
        | === * * * * * (Every 1 minute) ==================>|                              |
        |                                      [Match user_line_profiles morning_time]     |
        |                                      [Aggregate FEFO alerts + favorites + 24h D0]|
        |                                      [Dispatch outboxes using X-Line-Retry-Key]  |
        |                                                   | === Message push ----------->|
```

---

## 3. Endpoint & Payload Specifications

### 3.1 Outbound Push Message (`POST /v2/bot/message/push`)

Dispatched by Server `'S'` to deliver real-time fridge alerts, connection tests, and scheduled expiry/morning digests.

- **Method:** `POST`
- **URL:** `https://api.line.me/v2/bot/message/push`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer <LINE_CHANNEL_ACCESS_TOKEN>`
  - `X-Line-Retry-Key: <UUID v4>` (retained across retries in `line_outbox` / `user_line_outbox` for up to 23 hours)

#### Request Payload

```json
{
  "to": "C1234567890abcdef1234567890abcdef",
  "messages": [
    {
      "type": "text",
      "text": "🌡️ 🏠 [Kitchen Fridge · รหัสตู้: f_123] High fridge temperature detected (10.5°C > 8.0°C)."
    }
  ]
}
```

> [!NOTE]
> LINE allows up to 5 message objects per `push` or `reply` call; FoodWarden slices `messages` to at most 5 text items and truncates oversized digests cleanly under LINE's 5,000-character message limit.

---

### 3.2 Inbound Webhook (`POST /api/line/webhook`)

Receives signed events from the LINE Platform for pairing code redemption and `unfollow` / `leave` lifecycle unlinking.

- **Method:** `POST`
- **Path:** `/api/line/webhook`
- **Maximum Raw Body Size:** `1,048,576` bytes (1 MB; larger bodies rejected with `413 Payload Too Large`)
- **Required Header:** `X-Line-Signature` — base64-encoded HMAC-SHA256 (`^[A-Za-z0-9+/]{43}=$`) verified against raw request bytes using `LINE_CHANNEL_SECRET` before JSON parsing (`401 Unauthorized` if invalid)

#### Supported Webhook Events

| Event Type         | Source Types Accepted                                                                  | Behavior on Server `'S'`                                                                                                                                                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message` (`text`) | `group` / `room` / `user` (for `scope = 'fridge'`), `user` only (for `scope = 'user'`) | Matches pairing code regex `^FW-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$` (case-insensitive, normalized uppercase), verifies SHA-256 hash, session validity, and owner role, atomically links recipient, broadcasts `line_settings_changed` over `FridgeRoom`, and replies via `POST /v2/bot/message/reply` |
| `unfollow`         | `user`                                                                                 | Clears personal LINE binding and matching `fridges.line_target_id` entries if lifecycle timestamp is newer than link timestamp (`line_target_resets` guard)                                                                                                                                             |
| `leave`            | `group` / `room`                                                                       | Unlinks `fridges.line_target_id` for that chat if `webhookEventId` has not been processed and event timestamp postdates pairing                                                                                                                                                                         |

#### Pairing Rate Limits & Protection

- Issuing codes via Dashboard REST (`POST /api/me/line/pair` or `POST /api/fridges/:fridgeId/line/pair`) is capped at **5 codes per user per 600 seconds**, valid for **600 seconds**, one-use only, and automatically revokes earlier active codes for the same scope.
- Webhook pairing redemption attempts in `line_webhook_attempts` (`receipt_kind = 'pairing'`) are rate-limited to **10 attempts per source hash per 600s** and **200 total pairing attempts per 600s** separately from `unfollow`/`leave` lifecycle deduplication.

---

### 3.3 Alert Types, Thresholds, Cooldowns & Disambiguation

| Alert Identifier (`alert_type`) | Trigger Condition                                                                 | Scope             | Cooldown Window                      | Target & Disambiguation Prefix                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------- | ----------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `door_obstruction`              | Door status `OBSTRUCTION_ERROR`                                                   | Fridge & User     | `300s` (5 min)                       | Includes `[fridgeName · รหัสตู้: fridgeId]` and `node_id`                                                     |
| `door_timeout`                  | Door status `TIMEOUT_ERROR`                                                       | Fridge & User     | `300s` (5 min)                       | Includes `[fridgeName · รหัสตู้: fridgeId]` and `node_id`                                                     |
| `door_fault_lockout`            | Door status `FAULT_LOCKOUT`                                                       | Fridge & User     | `300s` (5 min)                       | Includes `[fridgeName · รหัสตู้: fridgeId]` and `node_id`                                                     |
| `door_contradiction`            | Door status `CONTRADICTION_ERROR`                                                 | Fridge & User     | `300s` (5 min)                       | Includes `[fridgeName · รหัสตู้: fridgeId]` and `node_id`                                                     |
| `temp_high`                     | `temp_celsius > 8.0`                                                              | Fridge & User     | `1800s` (30 min)                     | Includes `[fridgeName · รหัสตู้: fridgeId]`, temperature °C, and sensor `node_id`                             |
| `voc_high`                      | `voc_index >= 250`                                                                | Fridge & User     | `1800s` (30 min)                     | Includes `[fridgeName · รหัสตู้: fridgeId]`, VOC index, and sensor `node_id`                                  |
| `daily_expiry_digest`           | Cron `0 1 * * *`: active items expiring within `<= 2` days (`Asia/Bangkok`)       | Fridge            | `72,000s` (20 h)                     | Includes `[fridgeName · รหัสตู้: fridgeId]` and FEFO item list                                                |
| `morning_digest`                | Cron `* * * * *`: user `morning_time` (`HH:MM` Bangkok) within 1h catch-up window | Personal (`user`) | Once per local date (`bangkok_date`) | Includes user `name`/`email`, per-fridge `[name] (รหัสตู้: id)`, FEFO items, favorites, and 24h door closures |

> [!TIP]
> For testing and simulation via `/api/telemetry?bypass_cooldown=1` or `/api/door_events?bypass_cooldown=1`, Server `'S'` clears cooldown/deduplication rows in `alert_cooldowns`, `user_alert_cooldowns`, `line_alert_events`, and `user_line_events` strictly scoped to the authenticated `fridge_id`.

---

## 4. Subproject Schema Definitions (TypeScript — Server `'S'`)

Mirrored locally in [`../server/workers/lib/line.ts`](../server/workers/lib/line.ts), [`../server/workers/lib/line-pairing.ts`](../server/workers/lib/line-pairing.ts), and [`../server/workers/lib/personal-notifications.ts`](../server/workers/lib/personal-notifications.ts):

```typescript
export interface LineTextMessage {
  type: "text";
  text: string;
}

export interface LinePushRequest {
  to: string; // LINE userId, groupId, or roomId
  messages: LineTextMessage[]; // 1 to 5 messages
}

export interface LineWebhookSource {
  type?: "user" | "group" | "room";
  userId?: string;
  groupId?: string;
  roomId?: string;
}

export interface LineWebhookEvent {
  type?: "message" | "unfollow" | "leave" | string;
  webhookEventId?: string;
  replyToken?: string;
  timestamp?: number; // millisecond epoch from LINE Platform
  message?: {
    type?: string;
    text?: string;
    id?: string;
  };
  source?: LineWebhookSource;
}

export interface LineWebhookBody {
  destination?: string;
  events?: LineWebhookEvent[];
}

export interface LinePairingCodeResponse {
  code: string; // e.g. "FW-924X-AAWA"
  expires_at_s: number;
  friend_url: string | null;
}

export interface LineConnectionStatus {
  configured: boolean;
  linked: boolean;
  friend_url: string | null;
}
```
