"""Unit tests for CBS.md Cloud models and bilingual data structures."""

from foodwarden_camera.models.cloud_cbs import (
    CheckInCommitPayload,
    CheckInCommitResult,
    CheckInDraftResult,
    CheckOutCandidate,
    CheckOutCommitResult,
    CheckOutDraftResult,
    DoorEventSyncPayload,
    NodeStatusItem,
    StatusPayload,
    TelemetryItem,
    TelemetrySamplePayload,
    TelemetrySyncPayload,
)


def test_bilingual_checkin_models() -> None:
    draft = CheckInDraftResult(
        name_th="นมสดพาสเจอร์ไรส์",
        name_en="Pasteurized Whole Milk",
        category="Dairy",
        category_th="นมและผลิตภัณฑ์นม",
        estimated_shelf_life_days=10,
        estimated_expiry_date="2026-11-17",
        storage_recommendation_th="เก็บในช่องแช่เย็นหลัก อุณหภูมิ 0-4°C",
        storage_recommendation_en="Store on main shelf, 0-4°C",
        image_storage_path="fridges/test_fridge/items/raw/milk.jpg",
        confidence=0.95,
    )
    assert draft.name_th == "นมสดพาสเจอร์ไรส์"
    assert draft.name_en == "Pasteurized Whole Milk"
    assert draft.category_th == "นมและผลิตภัณฑ์นม"

    commit = CheckInCommitPayload(
        name_th=draft.name_th,
        name_en=draft.name_en,
        category=draft.category,
        category_th=draft.category_th,
        estimated_shelf_life_days=draft.estimated_shelf_life_days,
        expiry_date=draft.estimated_expiry_date,
        storage_recommendation_th=draft.storage_recommendation_th,
        storage_recommendation_en=draft.storage_recommendation_en,
        image_storage_path=draft.image_storage_path,
        confidence=draft.confidence,
    )
    assert commit.expiry_date == "2026-11-17"


def test_fefo_checkout_models() -> None:
    c1 = CheckOutCandidate(
        item_id="item_01",
        name_th="โยเกิร์ตรสธรรมชาติ",
        name_en="Natural Yogurt",
        category="Dairy",
        category_th="นมและผลิตภัณฑ์นม",
        expiry_date="2026-11-09",
        confidence=0.88,
    )
    c2 = CheckOutCandidate(
        item_id="item_02",
        name_th="โยเกิร์ตรสธรรมชาติ",
        name_en="Natural Yogurt",
        category="Dairy",
        category_th="นมและผลิตภัณฑ์นม",
        expiry_date="2026-11-14",
        confidence=0.85,
    )
    result = CheckOutDraftResult(candidates=[c1, c2])
    assert len(result.candidates) == 2
    # Verify FEFO ordering (earliest expiry first)
    assert result.candidates[0].expiry_date < result.candidates[1].expiry_date


def test_telemetry_sync_payload() -> None:
    items = [
        TelemetryItem(timestamp=1729930000, temperature_c=3.4, voc_index=100, light_level=30),
        TelemetryItem(timestamp=1729930060, temperature_c=3.5, voc_index=102, light_level=30),
    ]
    payload = TelemetrySyncPayload(node_id="F0", telemetry=items)
    data = payload.model_dump()
    assert data["node_id"] == "F0"
    assert len(data["telemetry"]) == 2
    cbs_data = payload.to_cbs_dict()
    assert len(cbs_data["samples"]) == 2
    assert cbs_data["samples"][0]["timestamp_s"] == 1729930000
    assert cbs_data["samples"][0]["temp_celsius"] == 3.4


def test_canonical_cbs_schemas() -> None:
    # CheckInCommitPayload syncs estimated_expiry_date and parses Server 201 response
    commit = CheckInCommitPayload(
        name_th="นมสด",
        name_en="Fresh Milk",
        category="Dairy",
        category_th="นม",
        estimated_shelf_life_days=7,
        estimated_expiry_date="2026-11-20",
        storage_recommendation_th="แช่เย็น",
        storage_recommendation_en="Refrigerate",
        image_storage_path="crops/milk.jpg",
        confidence=0.95,
    )
    assert commit.expiry_date == "2026-11-20"
    assert commit.to_cbs_dict()["estimated_expiry_date"] == "2026-11-20"

    commit_res = CheckInCommitResult.model_validate(
        {"success": True, "item_id": "item_01", "message": "Added"}
    )
    assert commit_res.item_id == "item_01"

    # CheckOutDraftResult parses CBS.md candidate_matches + estimated_expiry_date
    checkout_draft = CheckOutDraftResult.model_validate(
        {
            "match_type": "EXACT_MATCH",
            "candidate_matches": [
                {
                    "item_id": "item_01",
                    "name_th": "นมสด",
                    "name_en": "Fresh Milk",
                    "category": "Dairy",
                    "category_th": "นม",
                    "estimated_expiry_date": "2026-11-20",
                }
            ],
            "confidence": 0.91,
            "reasoning": "Matched milk carton",
        }
    )
    assert len(checkout_draft.candidates) == 1
    assert checkout_draft.candidates[0].expiry_date == "2026-11-20"

    checkout_res = CheckOutCommitResult.model_validate(
        {"success": True, "item_id": "item_01", "status": "deleted", "message": "Removed"}
    )
    assert checkout_res.status == "deleted"

    # Telemetry canonical constructor
    canon_telem = TelemetrySyncPayload(
        samples=[
            TelemetrySamplePayload(
                node_id="F0",
                timestamp_s=1792944000,
                temp_celsius=3.42,
                voc_index=115,
                light_ldr=128,
            )
        ]
    )
    assert canon_telem.to_cbs_dict() == {
        "samples": [
            {
                "node_id": "F0",
                "timestamp_s": 1792944000,
                "temp_celsius": 3.42,
                "voc_index": 115,
                "light_ldr": 128,
            }
        ]
    }

    # Door event normalization maps IR_LIGHT_MISMATCH_ERROR -> CONTRADICTION_ERROR
    mismatch = DoorEventSyncPayload(
        node_id="D0",
        event_type="IR_LIGHT_MISMATCH_ERROR",
        timestamp=1792944005,
        details={"ldr_light": 250},
    )
    assert mismatch.to_cbs_dict() == {
        "events": [{"node_id": "D0", "timestamp_s": 1792944005, "status": "CONTRADICTION_ERROR"}]
    }

    # Status heartbeat payload
    status = StatusPayload(
        nodes=[
            NodeStatusItem(node_id="C0", last_seen_s=1792944010),
            NodeStatusItem(node_id="F0", last_seen_s=None),
            NodeStatusItem(node_id="D0", last_seen_s=1792944009),
        ]
    )
    assert len(status.nodes) == 3
    assert status.nodes[1].last_seen_s is None
