# Network, server and dashboard

[Network sequence](../diagrams/network.mmd) · [Cloud diagram](../diagrams/cloud.mmd)

| Link | Traffic | What a failure means |
| --- | --- | --- |
| F0 ↔ C0 | Direct BLE GATT clock sync and AES-128-GCM sensor packets | Recent sensor readings can go stale while the gateway remains available. |
| D0 ↔ C0 | LAN through home router, MQTT over TLS 8883 and a validated broker certificate | The gateway can lose sight of the closer while continuing to receive fridge readings. The motor has local cutoffs. |
| C0 → Firebase API | HTTPS and gateway Bearer token for telemetry and status | Queue-based telemetry can retry. Child contact cannot be inferred if the gateway has stopped reporting. |
| Dashboard ↔ Firebase Auth | Google account, verified email and Firebase ID token | Signing in without fridge membership exposes no fridge data. |
| Dashboard ↔ Firestore / Functions | Member-scoped live inventory, minute buckets and device report. The API handles fridge listing, writes and private photos. | The UI shows loading, no reading, no item, no photo or an error where appropriate. |
| Firebase ↔ Gemini | Planned Gemini 3.5 Flash Lite check-in metadata, image crops and active inventory candidates | Camera recognition and automatic multi-pack processing are separate pipeline work. |
| Firebase → LINE | Planned HTTPS push notifications for expiry and safety events | Issue #3 tracks registration and monthly quota policy. |

## Data kept by the server

- The parent fridge document holds membership and the latest cached telemetry, with gateway secrets under `private/config`. The fridge-list endpoint returns only the fridge ID, name and latest telemetry.
- Minute documents preserve timestamped samples. The UI uses up to 61 buckets for the previous hour. It displays one sensor at a time to avoid stitching different sensors together.
- The device report keeps `received_s` separate from each node's observed `last_seen_s`. The former is when Firebase accepted a heartbeat. The latter is the time observed by the gateway.
- Every food item has its own Firestore document. The dashboard groups rows by name and exact expiry. Detail links retain each row's original photo and date. Camera and web items use the same fridge-scoped JPEG path convention.
- The web form prepares a JPEG of up to 1.5 MB for the inventory endpoint. Photo paths are private. A signed-in member receives image bytes through the API instead of a public sharing URL.

[Server architecture](../ARCHITECTURE.md) · [Heartbeat PR #5](https://github.com/theme222/FoodWarden/pull/5) · [Inventory issue #2](https://github.com/theme222/FoodWarden/issues/2) · [LINE issue #3](https://github.com/theme222/FoodWarden/issues/3)
