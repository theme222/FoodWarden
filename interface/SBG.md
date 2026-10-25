# SBG: Server ('S') ↔ Gemini ('G') Interface Contract

This document defines the multimodal AI interface between the cloud backend (**Server `'S'`**, Firebase Cloud Functions in TypeScript) and the cloud vision intelligence (**Entity `'G'`**, Gemini 3.5 Flash Lite via `@google/genai`).

* **Endpoints:** Server Cloud Functions (**Node `'S'`**) ↔ Gemini 3.5 Flash Lite (**Entity `'G'`**)
* **Directionality:** Bidirectional (`B`)
* **Transport Protocol:** HTTPS via Google Gen AI SDK (`@google/genai`)
* **Security:** Transport-layer TLS 1.3 with per-fridge API Key authentication (`geminiApiKey` stored in Firestore `/fridges/{fridgeId}`)

> [!NOTE]
> **Edge Decoupling Principle:**
> Gateway `'C'` (Pi-top [4]) never contacts Gemini directly. Instead, Gateway `'C'` uploads cropped grocery images to Server `'S'` ([`CBS.md`](CBS.md)). Server `'S'` enriches prompts with real-time Firestore inventory context before invoking Gemini, guaranteeing centralized credential management, prompt consistency, and multi-tenant isolation.

---

## 1. Interaction Sequences

### A. Grocery Check-In Sequence (`CHECK_IN`)

```text
Gateway 'C' (Pi-top [4])      Server 'S' (Firebase Cloud Functions)        Entity 'G' (Gemini 3.5 Flash Lite)
      |                                      |                                             |
      | === 1. POST /api/inventory/checkin =>|                                             |
      |    [Cropped image + fridgeId]        |                                             |
      |                                      | === 2. Build Check-In Prompt =============> |
      |                                      |        [Image bytes + Date context]         |
      |                                      |                                             |
      |                                      |                               [Vision Classification]
      |                                      |                               [Shelf-Life Estimation]
      |                                      |                                             |
      |                                      | <== 3. Structured JSON Response =========== |
      |                                      |        {name, category, expiry_date, ...}   |
      |                                      |                                             |
      |                                      | [Persist new item to Firestore]             |
      | <== 4. Return Check-In Confirmation =|                                             |
      |    [Display on 5" LCD for review]    |                                             |
```

### B. Context-Enriched Grocery Check-Out Sequence (`CHECK_OUT`)

```text
Gateway 'C' (Pi-top [4])      Server 'S' (Firebase Cloud Functions)        Entity 'G' (Gemini 3.5 Flash Lite)
      |                                      |                                             |
      | === 1. POST /api/inventory/checkout=>|                                             |
      |    [Cropped image + fridgeId]        |                                             |
      |                                      | [Fetch active inventory from Firestore]     |
      |                                      | === 2. Build Context-Enriched Prompt =====> |
      |                                      |        [Image bytes + Candidate Items list] |
      |                                      |                                             |
      |                                      |                               [Visual Matching vs Context]
      |                                      |                               [FEFO Candidate Ranking]
      |                                      |                                             |
      |                                      | <== 3. Structured JSON Response =========== |
      |                                      |        {match_type, matched_item_id, ...}   |
      |                                      |                                             |
      |                                      | [Update item: consumed = true in Firestore] |
      | <== 4. Return Check-Out Resolution ==|                                             |
      |    [Show confirmation / FEFO list]   |                                             |
```

---

## 2. Model Configuration & Parameters

All inference calls to Entity `'G'` use the official Google Gen AI SDK (`@google/genai`) with low temperature and strict JSON schema enforcement to ensure deterministic output.

| Parameter | Recommended Value | Description |
|---|---|---|
| **Model ID** | `gemini-3.5-flash-lite` | High-speed, cost-effective multimodal vision-language model. |
| **Fallback Model** | `gemini-2.5-flash-lite` | Backup model if primary endpoint undergoes maintenance. |
| **Temperature** | `0.1` | Low sampling temperature to maximize deterministic factual classification. |
| **Top-P** | `0.95` | Nucleus sampling threshold. |
| **Response MIME Type** | `application/json` | Enforces structured JSON output without markdown wrapper backticks. |
| **Response Schema** | OpenAPI 3.0 JSON Schema | Strict schema applied directly via SDK `responseSchema` configuration. |

---

## 3. Operation 1: Grocery Check-In (`CHECK_IN`)

### A. Context & Prompt Architecture

When classifying an item placed into the fridge, Server `'S'` supplies:
1. **The Cropped Grocery Image:** High-resolution JPEG or PNG bytes captured by Gateway `'C'`.
2. **Current Date Context:** The current date (`YYYY-MM-DD`) and Unix timestamp (`timestamp_s`) so the model can calculate absolute expiration dates based on standard refrigeration shelf life.

#### System Prompt Template

```text
You are an expert grocery inventory classification engine for a smart refrigerator system.
Analyze the provided image of a grocery/food item.

Current Reference Date: {{CURRENT_DATE}} (Unix Epoch: {{CURRENT_TIMESTAMP_S}} seconds)

Your task:
1. Determine if the image contains a food or beverage item (is_food).
2. Identify the specific item name in both Thai (name_th) and English (name_en), e.g. name_th="นมสดพาสเจอร์ไรส์", name_en="Pasteurized Whole Milk".
3. Classify the item into one of the canonical categories: Dairy, Produce, Meat, Seafood, Beverage, Condiments, Leftovers, Bakery, Snacks, Other.
4. Estimate standard refrigerated shelf life in days (estimated_shelf_life_days).
5. Calculate the estimated expiration date (estimated_expiry_date in YYYY-MM-DD format) by adding estimated_shelf_life_days to Current Reference Date.
6. Provide a confidence score between 0.0 and 1.0.
7. Return brief storage recommendations in both Thai (storage_recommendation_th) and English (storage_recommendation_en), e.g. storage_recommendation_th="เก็บในช่องแช่เย็นหลัก", storage_recommendation_en="Keep sealed on main shelf".
```

### B. Standard Food Categories & Bilingual Translation Mapping

Canonical categories are stored in English across the database and interfaces. Client applications map these keys to standard Thai equivalents:

| Canonical Key (`category`) | Thai Translation (`category_th`) | Scope / Typical Examples |
|---|---|---|
| `Dairy` | นมและผลิตภัณฑ์นม | Milk, cheese, yogurt, butter, cream. |
| `Produce` | ผักและผลไม้ | Fresh fruits, vegetables, herbs, salad greens. |
| `Meat` | เนื้อสัตว์ | Poultry, beef, pork, bacon, sausages. |
| `Seafood` | อาหารทะเล | Fish, shrimp, squid, shellfish. |
| `Beverage` | เครื่องดื่ม | Juices, soda, bottled water, tea, beer. |
| `Condiments` | เครื่องปรุงและซอส | Sauces, salad dressings, chili paste, ketchup, jams. |
| `Leftovers` | อาหารปรุงสุก / ของเหลือ | Cooked meals, prepped food in containers. |
| `Bakery` | เบเกอรี่และขนมปัง | Bread, pastries, tortillas, baked goods. |
| `Snacks` | ขนมขบเคี้ยว | Packaged snacks, nuts, chips. |
| `Other` | อื่นๆ | Any edible item not fitting the above categories. |

### C. Structured Output JSON Schema

```json
{
  "type": "object",
  "properties": {
    "is_food": {
      "type": "boolean",
      "description": "True if the image contains a valid food or beverage item; false if non-food, blurry, or unrecognized."
    },
    "name_th": {
      "type": "string",
      "description": "Concise human-readable name of the food item in Thai (e.g. นมสดพาสเจอร์ไรส์)."
    },
    "name_en": {
      "type": "string",
      "description": "Concise human-readable name of the food item in English (e.g. Pasteurized Whole Milk)."
    },
    "category": {
      "type": "string",
      "enum": [
        "Dairy",
        "Produce",
        "Meat",
        "Seafood",
        "Beverage",
        "Condiments",
        "Leftovers",
        "Bakery",
        "Snacks",
        "Other"
      ],
      "description": "Primary canonical food classification category."
    },
    "estimated_shelf_life_days": {
      "type": "integer",
      "description": "Estimated refrigerated shelf life in days from the reference date."
    },
    "estimated_expiry_date": {
      "type": "string",
      "description": "ISO 8601 date string (YYYY-MM-DD) indicating the estimated expiration date."
    },
    "confidence": {
      "type": "number",
      "description": "Confidence score of the visual recognition between 0.0 and 1.0."
    },
    "storage_recommendation_th": {
      "type": "string",
      "description": "Brief recommendation for optimal storage location or packaging inside the fridge in Thai."
    },
    "storage_recommendation_en": {
      "type": "string",
      "description": "Brief recommendation for optimal storage location or packaging inside the fridge in English."
    }
  },
  "required": [
    "is_food",
    "name_th",
    "name_en",
    "category",
    "estimated_shelf_life_days",
    "estimated_expiry_date",
    "confidence"
  ]
}
```

### D. TypeScript Interfaces (Server `'S'`)

```typescript
export type FoodCategory =
  | 'Dairy'
  | 'Produce'
  | 'Meat'
  | 'Seafood'
  | 'Beverage'
  | 'Condiments'
  | 'Leftovers'
  | 'Bakery'
  | 'Snacks'
  | 'Other';

export interface CheckInResponsePayload {
  is_food: boolean;
  name_th: string;
  name_en: string;
  category: FoodCategory;
  estimated_shelf_life_days: number;
  estimated_expiry_date: string; // YYYY-MM-DD
  confidence: number;            // 0.0 to 1.0
  storage_recommendation_th?: string;
  storage_recommendation_en?: string;
}
}
```

---

## 4. Operation 2: Grocery Check-Out (`CHECK_OUT`)

### A. Context-Enriched Prompt Architecture

When an item is removed, visual classification alone can be ambiguous (e.g., distinguishing between two cartons of milk purchased on different dates). Server `'S'` queries active (non-consumed) inventory from Firestore `/fridges/{fridgeId}/inventory` and injects candidate items directly into the prompt:

#### System Prompt Template

```text
You are an expert grocery inventory checkout engine for a smart refrigerator system.
A user has removed a food item from the refrigerator. Match the removed item in the provided image against the active inventory candidate items listed below.

Current Active Refrigerator Inventory Candidates:
{{CANDIDATE_ITEMS_JSON}}

Candidate items format:
[
  {
    "item_id": "string",
    "name_th": "string",
    "name_en": "string",
    "category": "string",
    "check_in_date": "YYYY-MM-DD",
    "estimated_expiry_date": "YYYY-MM-DD"
  }
]

Your task:
1. Visually identify the item presented in the image.
2. Search the Candidate Items list for matching items.
3. Determine match resolution:
   - EXACT_MATCH: Exactly one candidate item clearly corresponds to the image.
   - AMBIGUOUS_MULTIPLE: Multiple candidate items could match (e.g., multiple milks). Sort candidate_matches by FEFO (First Expired, First Out) with the earliest estimated_expiry_date first.
   - NO_MATCH: No candidate items in inventory match the presented item (flag for manual check-out).
4. Return the matched item ID (matched_item_id) if EXACT_MATCH, or candidate IDs if AMBIGUOUS_MULTIPLE.
5. Provide identified names in both Thai (identified_name_th) and English (identified_name_en), confidence score (0.0 to 1.0), and brief reasoning string.
```

### B. Structured Output JSON Schema

```json
{
  "type": "object",
  "properties": {
    "match_type": {
      "type": "string",
      "enum": [
        "EXACT_MATCH",
        "AMBIGUOUS_MULTIPLE",
        "NO_MATCH"
      ],
      "description": "Resolution of inventory match."
    },
    "matched_item_id": {
      "type": ["string", "null"],
      "description": "Firestore item_id of the matching candidate item if match_type is EXACT_MATCH, otherwise null."
    },
    "candidate_matches": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Array of candidate item_ids matching the image, ordered by FEFO (earliest expiry date first)."
    },
    "identified_name_th": {
      "type": "string",
      "description": "Visual identification of the item in the image in Thai (e.g. นมสดพาสเจอร์ไรส์)."
    },
    "identified_name_en": {
      "type": "string",
      "description": "Visual identification of the item in the image in English (e.g. Pasteurized Whole Milk)."
    },
    "confidence": {
      "type": "number",
      "description": "Confidence score of the match between 0.0 and 1.0."
    },
    "reasoning": {
      "type": "string",
      "description": "Brief explanation of how the visual item was matched to the inventory candidate(s)."
    }
  },
  "required": [
    "match_type",
    "candidate_matches",
    "identified_name_th",
    "identified_name_en",
    "confidence",
    "reasoning"
  ]
}
```

### C. TypeScript Interfaces (Server `'S'`)

```typescript
export type CheckOutMatchType = 'EXACT_MATCH' | 'AMBIGUOUS_MULTIPLE' | 'NO_MATCH';

export interface InventoryCandidate {
  item_id: string;
  name_th: string;
  name_en: string;
  category: string;
  check_in_date: string;         // YYYY-MM-DD
  estimated_expiry_date: string; // YYYY-MM-DD
}

export interface CheckOutResponsePayload {
  match_type: CheckOutMatchType;
  matched_item_id: string | null;
  candidate_matches: string[];   // Array of item_ids sorted by FEFO
  identified_name_th: string;
  identified_name_en: string;
  confidence: number;            // 0.0 to 1.0
  reasoning: string;
}
```

---

## 5. Operational Invariants & Error Handling

1. **Strict JSON Schema Enforcement:** All calls to Entity `'G'` must set `responseMimeType: "application/json"` and pass the OpenAPI schema via SDK `responseSchema`. Freeform markdown blocks (e.g. ` ```json `) are rejected.
2. **Non-Food Item Guard (`is_food: false`):** If an object detected by Gateway `'C'` is not a valid grocery item (e.g. human hand, empty plate, dish towel), Gemini returns `is_food: false`. Server `'S'` rejects the check-in transaction without creating a Firestore document and prompts Gateway `'C'` to discard the frame.
3. **Low Confidence Threshold (`confidence < 0.60`):** When confidence is below 0.60, Server `'S'` returns an error to Gateway `'C'` prompting the user to retake the photo.
4. **FEFO Disambiguation Invariant:** In the case of `AMBIGUOUS_MULTIPLE` check-out matches (e.g., user removes milk and the fridge contains two milks), Server `'S'` defaults to selecting the item with the earliest expiration date (**First Expired, First Out**), while sending candidate alternatives to Gateway `'C'` for optional button override.
5. **Rate Limiting & Transient Retries:** Server `'S'` implements exponential backoff (initial retry at 1s, doubling up to 3 attempts) for HTTP `429` (Quota Exceeded) or `503` (Model Overloaded) responses from the Gemini API.
