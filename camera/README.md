# Node 'C': Camera Logger & Edge Gateway (`camera/`)

**Node `'C'`** is the local edge processor and communication gateway for the **FoodWarden** system. It provides one of the two primary user-facing interfaces in the ecosystem, running a full-screen **PyQt6** application on the fridge-mounted 5-inch LCD (`800×480`) controlled by the 4 physical Pi-top buttons (`Up`, `Down`, `O`, `X`). All on-screen instructions, prompts, and food items are displayed **by default in Thai with an English translation**.

Running on a **Pi-top [4] (Raspberry Pi 4)** in **Python 3.11**, Node `'C'` captures food items via a 720p USB webcam, runs local **YOLO11 Nano (`yolo11n.pt`)** object detection for grocery cropping and real-time human presence detection, receives and decrypts `AES-128-GCM` BLE GATT telemetry from Node `'F'`, hosts the local **Mosquitto MQTT over TLS** broker (`port 8883`), and synchronizes data with the Firebase backend (Server `'S'`).

---

## 1. Documentation & File Index

### Local Subproject Files
* **[`ARCHITECTURE.md`](ARCHITECTURE.md):** Hardware components, Pi-top [4] button/display connections, OS environment (Bookworm 64-bit), and Python 3.11 software stack.
* **[`GOAL.md`](GOAL.md):** Incremental checklist of required features, use cases, edge-case handlers, and tests.
* **[`pyproject.toml`](pyproject.toml) & [`.python-version`](.python-version):** `uv` project configuration pinned to Python `3.11`.
* **[`.env.example`](.env.example):** Symlink to the root environment variable template ([`../.env.example`](../.env.example)).
* **[`src/foodwarden_camera/__init__.py`](src/foodwarden_camera/__init__.py):** Application package entrypoint.

### System & Interface References
* **Root Documentation:** [`SUMMARY.md`](../SUMMARY.md) | [`AGENTS.md`](../AGENTS.md) | [`RUBRIC.md`](../RUBRIC.md)
* **Communication Contracts ([`interface/`](../interface/README.md)):**
  * [`FUC.md`](../interface/FUC.md) — Fridge (`'F'`) ↔ Camera (`'C'`) BLE GATT Telemetry & Time Sync (`AES-128-GCM`)
  * [`CBD.md`](../interface/CBD.md) — Camera (`'C'`) ↔ Door (`'D'`) MQTTS Actuation & Safety
  * [`CBS.md`](../interface/CBS.md) — Camera (`'C'`) ↔ Server (`'S'`) HTTPS Cloud Sync

---

## 2. Development & Execution Commands (`uv`)

> [!IMPORTANT]
> Use **Python 3.11** (enforced via `.python-version`) on **Raspberry Pi OS Bookworm (64-bit)** with `uv`. Override `pillow>=10.0.0` in `[tool.uv]` to ensure modern compatibility.

### Setup & Dependencies
```bash
# 1. Copy environment template and populate credentials
cp .env.example .env

# 2. Sync virtual environment and install dependencies (Python 3.11)
uv sync
```

### Run Application
```bash
# Run the main gateway application
uv run foodwarden-camera
```

### Format & Lint (`ruff`)
```bash
# Format code
uv run ruff format .

# Run linter checks
uv run ruff check .
```

### Typecheck (`mypy`)
```bash
# Run strict static type checking
uv run mypy src
```

### Test (`pytest`)
```bash
# Run unit and integration test suite
uv run pytest
```
