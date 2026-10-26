# CBS: Camera ('C') ↔ Server ('S') Interface Contract

This document defines the HTTPS communication interface between the edge processor and gateway (**Node `'C'`**, Pi-top [4] / Python) and the cloud backend (**Server `'S'`**, Firebase Cloud Functions in TypeScript).

* **Endpoints:** Gateway Node `'C'` (Pi-top [4]) ↔ Server Cloud Functions (Node `'S'`)
* **Directionality:** Bidirectional / Request-Response (`B`)
* **Transport Protocol:** HTTPS / REST (JSON & Multipart Form-Data)
* **Security:** Transport-Layer Security (TLS 1.3) with permanent Bearer API token authentication (`GATEWAY_TOKEN` provisioned in the fridge dashboard and verified against `gatewayTokenHash` in Firestore)

> [!NOTE]
> **Edge Decoupling Principle:**
> Node `'C'` does not connect directly to Gemini 3.5 Flash Lite or external third-party services. All multimodal inference, inventory reconciliation, and cloud alerts are mediated through Server `'S'` via this interface contract.

---

## 1. Secrets & Authentication

Gateway Node `'C'` authenticates itself using a unique permanent Bearer token. **Because this token uniquely identifies which refrigerator Node `'C'` belongs to**, request bodies do not include a `fridge_id`. The token serves as both the device credential and the tenant identity for all cloud interactions.

All requests from Gateway Node `'C'` to Server `'S'` must include this token in the HTTP `Authorization` header:

```http
Authorization: Bearer <GATEWAY_TOKEN>
```

* **Storage in Node `'C'`:** Defined in `.env` as `GATEWAY_TOKEN` ([`camera/.env.example`](../camera/.env.example)).
* **Validation in Server `'S'`:** Cloud Functions hash the incoming Bearer token using SHA-256 and look up the matching refrigerator document in Firestore:
  * If the header is missing: returns `401 Unauthorized` (`UNAUTHORIZED`).
  * If the token hash does not match any registered fridge: returns `403 Forbidden` (`INVALID_TOKEN`).

---

## 2. Interaction Sequences

### A. Grocery Check-In Sequence

```text
Node 'C' (Edge Gateway)                        Server 'S' (Cloud Functions)
         |                                                   |
 [User presses check-in button]                              |
 [YOLO11n crops grocery bounding box & compresses JPEG]      |
         |                                                   |
         | === 1. POST /api/inventory/checkin/draft ========>|
         |     Headers: Authorization: Bearer <TOKEN>        |
         |     Body: multipart/form-data [image (JPEG)]      |
         |                                                   |
         |                                      [Identify fridge via Bearer token]
         |                                      [Call Gemini via SBG.md]
         |                                      [Check confidence >= 0.60 & is_food]
         |                                      +- If confidence < 0.60 or non-food:
         |                                      |  Return 422 UNIDENTIFIABLE
         |                                      +- Else:
         |                                         [Upload JPEG to Firebase Storage]
         |                                         Return 200 OK (CheckInDraftResult)
         |                                         (Zero Firestore database writes)
         |                                                   |
         | <== 200 OK or 422 UNIDENTIFIABLE =================|
         |                                                   |
 [Render bilingual review card on LCD]                       |
 [Start 5s auto-confirm countdown]                           |
 +- If user presses 'X' (Cancel):                            |
 |  [Drop draft locally, no commit sent]                     |
 +- If user adjusts expiry (Up/Down) or 5s timer expires:    |
         |                                                   |
         | === 2. POST /api/inventory/checkin ==============>|
         |     Headers: Authorization: Bearer <TOKEN>        |
         |     Body: application/json [Finalized Item Data]  |
         |                                                   |
         |                                      [Persist new item to Firestore]
         |                                      Return 201 Created { item_id, success }
         |                                                   |
         | <== 201 Created ==================================|
         |                                                   |
 [Display success checkmark on LCD]                          |
```

### B. Context-Enriched Grocery Check-Out Sequence

```text
Node 'C' (Edge Gateway)                        Server 'S' (Cloud Functions)
         |                                                   |
 [User presses check-out button]                             |
 [YOLO11n crops grocery bounding box & compresses JPEG]      |
         |                                                   |
         | === 1. POST /api/inventory/checkout/draft ======>|
         |     Headers: Authorization: Bearer <TOKEN>        |
         |     Body: multipart/form-data [image (JPEG)]      |
         |                                                   |
         |                                      [Identify fridge via Bearer token]
         |                                      [Fetch active inventory from Firestore]
         |                                      [Call Gemini via SBG.md]
         |                                      +- If confidence < 0.60:
         |                                      |  Return 422 UNIDENTIFIABLE
         |                                      +- If confidence >= 0.60 but no match:
         |                                      |  Return 200 OK (NO_MATCH, candidates: [])
         |                                      +- Else:
         |                                         [Sort candidates by FEFO with item_ids]
         |                                         Return 200 OK (CheckOutDraftResult)
         |                                         (Zero database mutations)
         |                                                   |
         | <== 200 OK or 422 UNIDENTIFIABLE =================|
         |                                                   |
 [Display candidate matches with item_id]                    |
 [Start 5s auto-confirm countdown]                           |
 [User selects item or timer auto-selects FEFO default]      |
         |                                                   |
         | === 2. POST /api/inventory/checkout =============>|
         |     Headers: Authorization: Bearer <TOKEN>        |
         |     Body: application/json { item_id }            |
         |                                                   |
         |                                      [Hard-delete item from Firestore]
         |                                      [Delete item JPEG from Cloud Storage]
         |                                      Return 200 OK { item_id, status }
         |                                                   |
         | <== 200 OK =======================================|
         |                                                   |
 [Display check-out confirmation on LCD]                     |
```

---

## 3. Endpoint Specifications

### 3.1 Grocery Check-In Draft (`POST /api/inventory/checkin/draft`)

Processes a cropped food image captured by Node `'C'`, invokes cloud AI classification ([`SBG.md`](SBG.md)), and returns draft bilingual food metadata for LCD display. **This endpoint does not write to the database.**

* **Method:** `POST`
* **Path:** `/api/inventory/checkin/draft`
* **Content-Type:** `multipart/form-data`

#### Request Fields

| Field Name | Type | Format / Description |
|---|---|---|
| `image` | Binary File | Compressed JPEG (`image/jpeg`) image bytes of the cropped grocery item. |

#### Success Response Schema (`200 OK`)

Returned when the item is identified with confidence ≥ 0.60 and `is_food` is `true`. All fields are exact non-null values.

```json
{
  "type": "object",
  "properties": {
    "name_th": {
      "type": "string",
      "description": "Item name in Thai for primary LCD display (e.g. นมสดพาสเจอร์ไรส์)."
    },
    "name_en": {
      "type": "string",
      "description": "Item name in English for secondary LCD display (e.g. Pasteurized Whole Milk)."
    },
    "category": {
      "type": "string",
      "description": "Canonical category key (e.g. Dairy)."
    },
    "category_th": {
      "type": "string",
      "description": "Thai translation of the category (e.g. นมและผลิตภัณฑ์นม)."
    },
    "estimated_shelf_life_days": {
      "type": "integer",
      "description": "Estimated refrigerated shelf life in days."
    },
    "estimated_expiry_date": {
      "type": "string",
      "description": "ISO 8601 date string (YYYY-MM-DD)."
    },
    "storage_recommendation_th": {
      "type": "string",
      "description": "Exact storage recommendation in Thai."
    },
    "storage_recommendation_en": {
      "type": "string",
      "description": "Exact storage recommendation in English."
    },
    "image_storage_path": {
      "type": "string",
      "description": "Firebase Storage path to the uploaded JPEG crop (e.g. /storage/food_crops/fridge_123/crop_abc.jpg)."
    },
    "confidence": {
      "type": "number",
      "description": "AI recognition confidence (0.60 to 1.0)."
    }
  },
  "required": [
    "name_th",
    "name_en",
    "category",
    "category_th",
    "estimated_shelf_life_days",
    "estimated_expiry_date",
    "storage_recommendation_th",
    "storage_recommendation_en",
    "image_storage_path",
    "confidence"
  ]
}
```

#### Error Response Schema (`422 Unprocessable Entity` — `UNIDENTIFIABLE`)

Returned when the AI recognition confidence is strictly below 0.60 or when `is_food` is `false`:

```json
{
  "error": "UNIDENTIFIABLE",
  "message": "Item could not be reliably identified (confidence below 0.60 or non-food item)."
}
```

---

### 3.2 Grocery Check-In Commit (`POST /api/inventory/checkin`)

Persists a confirmed food item into Firestore under the authenticated refrigerator. Dispatched after the user confirms or adjusts the draft on the Gateway LCD (or after the 5-second countdown timer expires).

* **Method:** `POST`
* **Path:** `/api/inventory/checkin`
* **Content-Type:** `application/json`

#### Request Payload

```json
{
  "name_th": "นมสดพาสเจอร์ไรส์",
  "name_en": "Pasteurized Whole Milk",
  "category": "Dairy",
  "category_th": "นมและผลิตภัณฑ์นม",
  "estimated_shelf_life_days": 7,
  "estimated_expiry_date": "2026-11-02",
  "storage_recommendation_th": "เก็บในช่องแช่เย็นหลัก 2-4°C",
  "storage_recommendation_en": "Keep sealed on main shelf 2-4°C",
  "image_storage_path": "/storage/food_crops/fridge_123/crop_abc.jpg",
  "confidence": 0.94
}
```

#### Success Response Schema (`201 Created`)

```json
{
  "success": true,
  "item_id": "item_abc123xyz",
  "message": "Item successfully added to inventory."
}
```

---

### 3.3 Grocery Check-Out Draft (`POST /api/inventory/checkout/draft`)

Matches a removed food item against active refrigerator inventory using context-enriched multimodal AI ([`SBG.md`](SBG.md)). Returns candidate matches enriched with their unique `item_id`s, ordered by FEFO (earliest expiry first). **This endpoint does not modify or delete items from the database.**

* **Method:** `POST`
* **Path:** `/api/inventory/checkout/draft`
* **Content-Type:** `multipart/form-data`

#### Request Fields

| Field Name | Type | Format / Description |
|---|---|---|
| `image` | Binary File | Compressed JPEG (`image/jpeg`) image bytes of the removed grocery item. |

#### Success Response Schema (`200 OK`)

Returned when the AI successfully processes the image against inventory with confidence ≥ 0.60:

```json
{
  "type": "object",
  "properties": {
    "match_type": {
      "type": "string",
      "enum": ["EXACT_MATCH", "AMBIGUOUS_MULTIPLE", "NO_MATCH"],
      "description": "Classification result."
    },
    "candidate_matches": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "item_id": { "type": "string", "description": "Unique Firestore item identifier." },
          "name_th": { "type": "string" },
          "name_en": { "type": "string" },
          "category": { "type": "string" },
          "category_th": { "type": "string" },
          "estimated_expiry_date": { "type": "string" }
        },
        "required": ["item_id", "name_th", "name_en", "category", "category_th", "estimated_expiry_date"]
      },
      "description": "Candidate matches sorted by FEFO (earliest expiry first). Contains 1 item for EXACT_MATCH, 2+ items for AMBIGUOUS_MULTIPLE, and 0 items for NO_MATCH."
    },
    "confidence": {
      "type": "number",
      "description": "AI recognition confidence (0.60 to 1.0)."
    },
    "reasoning": {
      "type": "string",
      "description": "Explanation of how candidate matches were determined."
    }
  },
  "required": [
    "match_type",
    "candidate_matches",
    "confidence",
    "reasoning"
  ]
}
```

#### Error Response Schema (`422 Unprocessable Entity` — `UNIDENTIFIABLE`)

Returned when the AI recognition confidence is strictly below 0.60:

```json
{
  "error": "UNIDENTIFIABLE",
  "message": "Removed item could not be reliably identified (confidence below 0.60)."
}
```

---

### 3.4 Grocery Check-Out Commit (`POST /api/inventory/checkout`)

Permanently deletes a specific food item document from Firestore (`/fridges/{fridgeId}/inventory/{item_id}`) and deletes its associated cropped JPEG image (`image_storage_path`) from Firebase Cloud Storage to conserve storage space. Dispatched when the user or Gateway confirms removal of a specific `item_id`.

* **Method:** `POST`
* **Path:** `/api/inventory/checkout`
* **Content-Type:** `application/json`

#### Request Payload

```json
{
  "item_id": "item_abc123xyz"
}
```

#### Success Response Schema (`200 OK`)

```json
{
  "success": true,
  "item_id": "item_abc123xyz",
  "status": "deleted",
  "message": "Item and associated image permanently removed from inventory."
}
```

---

### 3.5 Telemetry Ingestion (`POST /api/telemetry`)

Ingests batched environmental sensor samples collected by Node `'C'` from Node `'F'` BLE GATT connections ([`FUC.md`](FUC.md)) or flushed from the local offline SQLite queue (E4 store-and-forward).

* **Method:** `POST`
* **Path:** `/api/telemetry`
* **Content-Type:** `application/json`

> [!NOTE]
> **Deduplication Policy:**
> Cloud Server `'S'` deduplicates incoming telemetry records strictly by `timestamp_s`. Microcontroller packet counters are validated and abstracted away at the Gateway edge (Node `'C'`).

#### Request Payload

```json
{
  "samples": [
    {
      "node_id": "F0",
      "timestamp_s": 1792944000,
      "temp_celsius": 3.42,
      "voc_index": 115,
      "light_ldr": 128
    }
  ]
}
```

> [!NOTE]
> If an individual hardware sensor (LM73, SGP40, or LDR) is disconnected or fails to produce a reading, its corresponding field is transmitted as `null`.

#### Response Schema (`200 OK`)

```json
{
  "success": true,
  "ingested_count": 1
}
```

---

### 3.6 Door Event Ingestion (`POST /api/door_events`)

Ingests door safety and actuation events parsed by Gateway Node `'C'`. Rather than forwarding raw microcontroller register dumps, Node `'C'` parses events locally and dispatches a clean, minimal status payload to Server `'S'`.

* **Method:** `POST`
* **Path:** `/api/door_events`
* **Content-Type:** `application/json`

#### Door Event Status Definitions
* **`CLOSING`:** Door closer accepted a `CLOSE_DOOR` command and initiated motor drive.
* **`SUCCESS`:** Door was successfully closed by the closer and confirmed shut.
* **`OBSTRUCTION_ERROR`:** Obstruction stall detected (motor current spike ≥ 1200 mA or safety limit reached) causing automatic abort and retraction.
* **`ABORTED`:** Door closing was halted and arm retracted due to vision-detected human approach or manual button trigger.
* **`TIMEOUT_ERROR`:** Door closer motion exceeded maximum allowable travel time (30s) without confirming closure.
* **`FAULT_LOCKOUT`:** Door closer entered hardware safety lockout due to an unresponsive INA219 sensor or boot homing failure.
* **`CONTRADICTION_ERROR`:** Door closer IR sensor reports the door is mechanically shut, but Node `'F'`'s internal light sensor reports elevated light for 3 consecutive readings.

#### Request Payload

```json
{
  "events": [
    {
      "node_id": "D0",
      "timestamp_s": 1792944005,
      "status": "SUCCESS"
    }
  ]
}
```

#### Response Schema (`200 OK`)

```json
{
  "success": true,
  "ingested_count": 1
}
```

---

## 4. Error Responses & Status Codes

All non-200 responses across this interface return a standardized JSON error envelope:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable explanation of the error."
}
```

### Standard Error Codes

| HTTP Status | Error Code (`error`) | Description & Cause |
|---|---|---|
| `401 Unauthorized` | `UNAUTHORIZED` | Missing `Authorization` header or missing Bearer prefix. |
| `403 Forbidden` | `INVALID_TOKEN` | The provided `GATEWAY_TOKEN` is invalid or does not match any registered refrigerator. |
| `413 Payload Too Large` | `PAYLOAD_TOO_LARGE` | The uploaded image exceeds the maximum supported size (> 5 MB). |
| `422 Unprocessable Entity` | `UNIDENTIFIABLE` | Returned by check-in or checkout when the AI vision confidence is strictly below the threshold (`< 0.60`) or when `is_food` is `false`. |
| `500 Internal Server Error` | `INTERNAL_ERROR` | An unhandled exception or cloud infrastructure failure occurred while processing the request. |

---

## 5. Subproject Interface Implementations

### A. TypeScript Models (Server `'S'`)

```typescript
export interface CheckInDraftResult {
  name_th: string;
  name_en: string;
  category: string;
  category_th: string;
  estimated_shelf_life_days: number;
  estimated_expiry_date: string; // YYYY-MM-DD
  storage_recommendation_th: string;
  storage_recommendation_en: string;
  image_storage_path: string;    // Firebase Storage path to uploaded JPEG
  confidence: number;
}

export interface CheckInCommitPayload {
  name_th: string;
  name_en: string;
  category: string;
  category_th: string;
  estimated_shelf_life_days: number;
  estimated_expiry_date: string; // YYYY-MM-DD
  storage_recommendation_th: string;
  storage_recommendation_en: string;
  image_storage_path: string;    // Firebase Storage path to uploaded JPEG
  confidence: number;
}

export interface CheckInCommitResult {
  success: boolean;
  item_id: string;
  message: string;
}

export interface CandidateItem {
  item_id: string; // Unique Firestore document ID
  name_th: string;
  name_en: string;
  category: string;
  category_th: string;
  estimated_expiry_date: string; // YYYY-MM-DD
}

export type CheckOutMatchType = 'EXACT_MATCH' | 'AMBIGUOUS_MULTIPLE' | 'NO_MATCH';

export interface CheckOutDraftResult {
  match_type: CheckOutMatchType;
  candidate_matches: CandidateItem[];
  confidence: number;
  reasoning: string;
}

export interface CheckOutCommitPayload {
  item_id: string;
}

export interface CheckOutCommitResult {
  success: boolean;
  item_id: string;
  status: 'deleted';
  message: string;
}

export interface TelemetrySamplePayload {
  node_id: string; // Sensor node instance identifier (e.g. "F0")
  timestamp_s: number; // uint64 second precision
  temp_celsius: number | null;
  voc_index: number | null;
  light_ldr: number | null;
}

export type DoorEventStatus =
  | 'CLOSING'
  | 'SUCCESS'
  | 'OBSTRUCTION_ERROR'
  | 'ABORTED'
  | 'TIMEOUT_ERROR'
  | 'FAULT_LOCKOUT'
  | 'CONTRADICTION_ERROR';

export interface DoorEventItem {
  node_id: string;     // Actuator node identifier (e.g. "D0")
  timestamp_s: number; // uint64 second precision
  status: DoorEventStatus;
}

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'INVALID_TOKEN'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNIDENTIFIABLE'
  | 'INTERNAL_ERROR';

export interface ApiErrorResponse {
  error: ApiErrorCode;
  message: string;
}
```

### B. Python Dataclasses (Node `'C'`)

```python
from dataclasses import dataclass
from typing import List, Optional

@dataclass(frozen=True)
class CheckInDraftResult:
    name_th: str
    name_en: str
    category: str
    category_th: str
    estimated_shelf_life_days: int
    estimated_expiry_date: str
    storage_recommendation_th: str
    storage_recommendation_en: str
    image_storage_path: str
    confidence: float

@dataclass(frozen=True)
class CheckInCommitPayload:
    name_th: str
    name_en: str
    category: str
    category_th: str
    estimated_shelf_life_days: int
    estimated_expiry_date: str
    storage_recommendation_th: str
    storage_recommendation_en: str
    image_storage_path: str
    confidence: float

@dataclass(frozen=True)
class CheckInCommitResult:
    success: bool
    item_id: str
    message: str

@dataclass(frozen=True)
class CandidateItem:
    item_id: str
    name_th: str
    name_en: str
    category: str
    category_th: str
    estimated_expiry_date: str

@dataclass(frozen=True)
class CheckOutDraftResult:
    match_type: str  # EXACT_MATCH, AMBIGUOUS_MULTIPLE, NO_MATCH
    candidate_matches: List[CandidateItem]
    confidence: float
    reasoning: str

@dataclass(frozen=True)
class CheckOutCommitPayload:
    item_id: str

@dataclass(frozen=True)
class CheckOutCommitResult:
    success: bool
    item_id: str
    status: str  # "deleted"
    message: str

@dataclass(frozen=True)
class TelemetrySamplePayload:
    node_id: str
    timestamp_s: int
    temp_celsius: Optional[float]  # None if sensor reading failed
    voc_index: Optional[int]       # None if sensor reading failed
    light_ldr: Optional[int]       # None if sensor reading failed

@dataclass(frozen=True)
class DoorEventItem:
    node_id: str
    timestamp_s: int
    status: str  # CLOSING, SUCCESS, OBSTRUCTION_ERROR, ABORTED, TIMEOUT_ERROR, FAULT_LOCKOUT, CONTRADICTION_ERROR

@dataclass(frozen=True)
class ApiErrorResponse:
    error: str
    message: str
```
