"""Unit tests for CBS.md Cloud models and bilingual data structures."""

from foodwarden_camera.models.cloud_cbs import (
    CheckInCommitPayload,
    CheckInDraftResult,
    CheckOutCandidate,
    CheckOutDraftResult,
    TelemetryItem,
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
