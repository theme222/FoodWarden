"""UI language (Thai default / English) for the Pi-top LCD.

Usage:
    t("idle.checkin")                     -> text in the current language
    t("days.left", n=3)                   -> "อีก 3 วัน" / "3 days left"
    pick(name_th, name_en)                -> chooses between data that already
                                             exists in both languages
    bind_text(label, "settings.title")    -> sets the text now and again on every
                                             language switch (static labels)

``set_language`` switches the language and re-applies every bound widget.
Dynamic texts (countdowns, telemetry, results) are produced with ``t()`` each
time they are rendered, so they follow the language automatically.
"""

from __future__ import annotations

import logging
import weakref
from collections.abc import Callable
from typing import Any, Literal, Protocol, cast

logger = logging.getLogger(__name__)

Lang = Literal["th", "en"]
SUPPORTED_LANGUAGES: tuple[Lang, ...] = ("th", "en")
DEFAULT_LANGUAGE: Lang = "th"

# key -> (Thai, English)
STRINGS: dict[str, tuple[str, str]] = {
    # --- Shared ---------------------------------------------------------------
    "common.cancel": ("ยกเลิก", "Cancel"),
    "common.next": ("ถัดไป", "Next"),
    "common.done": ("เสร็จ", "Done"),
    "common.preparing_image": ("เตรียมภาพ...", "Preparing image..."),
    "common.no_image": ("ไม่มีภาพ", "No image"),
    "common.loading_ai": ("กำลังรอ AI... (Loading)", "Waiting for AI... (Loading)"),
    "common.expires_on": ("หมดอายุ {date}", "Expires {date}"),
    "countdown.save": ("บันทึกอัตโนมัติใน {n} วิ", "Auto-save in {n}s"),
    "countdown.cancel": ("ยกเลิกอัตโนมัติใน {n} วิ", "Auto-cancel in {n}s"),
    "days.overdue": ("เลยมา {n} วัน", "{n} days overdue"),
    "days.today": ("หมดวันนี้", "Expires today"),
    "days.left": ("อีก {n} วัน", "{n} days left"),
    "days.min_suffix": (" (ต่ำสุด)", " (minimum)"),
    # --- Idle -----------------------------------------------------------------
    "idle.checkin": ("นำเข้าอาหาร (Check-In)", "Check-In Food"),
    "idle.checkout": ("นำออกอาหาร (Check-Out)", "Check-Out Food"),
    "idle.settings": ("ตั้งค่า", "Settings"),
    "idle.waiting_camera": ("รอสัญญาณกล้อง...", "Waiting for camera..."),
    "idle.temp": ("อุณหภูมิ", "Temperature"),
    "idle.voc": ("อากาศ (VOC)", "Air (VOC)"),
    "idle.door": ("ประตู", "Door"),
    "idle.motion": ("ตรวจจับการเคลื่อนไหว", "Motion detection"),
    "idle.person": ("ตรวจจับคน", "Person detection"),
    "idle.waiting_data": ("รอข้อมูล", "Waiting"),
    "idle.waiting_signal": ("รอสัญญาณ", "Waiting for signal"),
    "idle.temp_ok": ("ปกติ", "Normal"),
    "idle.temp_warm": ("อุ่น", "Warm"),
    "idle.temp_hot": ("ร้อน!", "Hot!"),
    "idle.voc_clean": ("สะอาด", "Clean"),
    "idle.voc_smell": ("มีกลิ่น", "Odour"),
    "idle.voc_strong": ("กลิ่นแรง", "Strong"),
    "idle.door_closed": ("ปิดสนิท", "Closed"),
    "idle.door_open": ("เปิดอยู่", "Open"),
    "idle.sensor_off": (" (ปิดใช้งาน)", " (disabled)"),
    "idle.motion_seen": ("พบการเคลื่อนไหว", "Motion detected"),
    "idle.still_s": ("นิ่ง {s} วินาที", "Still for {s}s"),
    "idle.still_ms": ("นิ่ง {m} นาที {s} วินาที", "Still for {m}m {s}s"),
    "idle.still_pill": ("นิ่ง {s}s", "Still {s}s"),
    "idle.person_seen": ("พบคน {n} คน ({pct}%)", "{n} person(s) ({pct}%)"),
    "idle.no_person": ("ไม่พบคน", "No one"),
    "node.wait": ("รอเชื่อมต่อ", "waiting"),
    "node.lost": ("หลุด ({t})", "lost ({t})"),
    "node.slow": ("ช้า ({t})", "slow ({t})"),
    "node.stale": ("ขาด ({t})", "stale ({t})"),
    "sleep.hint": (
        "พักหน้าจอ — โบกมือหรือแตะเพื่อปลุก",
        "Display sleeping — wave or tap to wake",
    ),
    # --- Check-In ---------------------------------------------------------------
    "checkin.title": ("นำเข้าอาหาร", "Check-In Food"),
    "checkin.analyzing": ("กำลังวิเคราะห์...", "Analyzing..."),
    "checkin.checking_gemini": ("กำลังตรวจสอบกับ Gemini AI", "Checking with Gemini AI"),
    "checkin.category": ("หมวดหมู่: {v}", "Category: {v}"),
    "checkin.storage": ("วิธีเก็บ: {v}", "Storage: {v}"),
    "checkin.loading": ("กำลังโหลด...", "loading..."),
    "checkin.confidence": ("มั่นใจ {pct}%", "{pct}% sure"),
    "checkin.expiry_title": ("วันหมดอายุ  (วัน / เดือน / ปี)", "Expiry date  (day / month / year)"),
    "checkin.adjust_date": ("ปรับวันที่", "Adjust date"),
    # --- Check-Out --------------------------------------------------------------
    "checkout.title": ("นำออกอาหาร", "Check-Out Food"),
    "checkout.choose": ("เลือกรายการที่จะนำออก", "Choose the item to remove"),
    "checkout.searching": ("กำลังค้นหาในตู้เย็น...", "Searching the fridge..."),
    "checkout.analyzing": ("กำลังวิเคราะห์สินค้า...\nกด X เพื่อยกเลิก", "Analyzing...\nPress X to cancel"),
    "checkout.not_found": (
        "ไม่พบรายการนี้ในตู้เย็น\nกด X เพื่อกลับ",
        "Item not found in fridge\nPress X to go back",
    ),
    "checkout.not_found_short": ("ไม่พบรายการ", "Not found"),
    "checkout.remove": ("นำออก", "Remove"),
    "checkout.select": ("เลือกรายการ", "Select item"),
    "checkout.fefo": ("หมดก่อน", "Use first"),
    # --- Confirm ----------------------------------------------------------------
    "confirm.title_in": ("ยืนยันนำเข้า", "Confirm check-in"),
    "confirm.title_out": ("ยืนยันนำออก", "Confirm check-out"),
    "confirm.question_in": ("ต้องการนำรายการนี้เข้าตู้เย็นใช่ไหม?", "Add this item to the fridge?"),
    "confirm.question_out": ("ต้องการนำรายการนี้ออกใช่ไหม?", "Remove this item from the fridge?"),
    "confirm.ok_in": ("ยืนยันนำเข้า", "Confirm check-in"),
    "confirm.ok_out": ("ยืนยันนำออก", "Confirm removal"),
    "confirm.back": ("กลับไปแก้ไข", "Go back"),
    # --- Result -----------------------------------------------------------------
    "result.any_button": ("กดปุ่มใดก็ได้เพื่อกลับหน้าหลัก", "Press any button to return home"),
    "result.saving": ("กำลังบันทึก...", "Saving..."),
    "result.waiting_server": ("รอการตอบกลับจากระบบ", "Waiting for the server"),
    "result.in_done": ("นำเข้าแล้ว", "Checked in"),
    "result.out_done": ("นำออกแล้ว", "Checked out"),
    "result.in_done_msg": ("บันทึกเข้าตู้เย็นเรียบร้อย", "Saved to the fridge"),
    "result.in_done_msg_exp": (
        "บันทึกเข้าตู้เย็นแล้ว · หมดอายุ {date}",
        "Saved to the fridge · expires {date}",
    ),
    "result.out_done_msg": ("ลบออกจากรายการในตู้เย็นแล้ว", "Removed from the fridge list"),
    "result.queued": ("บันทึกไว้ในเครื่องแล้ว", "Saved on this device"),
    "result.queued_msg": (
        "ตอนนี้ออฟไลน์ ระบบจะส่งข้อมูลให้อัตโนมัติเมื่อกลับมาออนไลน์",
        "Offline now — it will sync automatically when back online",
    ),
    "result.out_skipped": ("ไม่ได้นำออก", "Not removed"),
    "result.in_skipped": ("ไม่ได้นำเข้า", "Not added"),
    "result.out_skipped_msg": (
        "หมดเวลา — ไม่ได้บันทึกการนำรายการนี้ออก รายการยังอยู่ในตู้เย็น",
        "Timed out — removal not saved, the item is still in the fridge",
    ),
    "result.in_skipped_msg": ("หมดเวลา — ไม่ได้บันทึกรายการนี้", "Timed out — item not saved"),
    "result.failed": ("บันทึกไม่สำเร็จ", "Could not save"),
    "result.failed_msg": ("กรุณาลองใหม่อีกครั้ง", "Please try again"),
    "result.fail.offline": (
        "ไม่มีอินเทอร์เน็ต กรุณาลองใหม่เมื่อออนไลน์",
        "No internet — please try again when online",
    ),
    "result.fail.auth": ("Token ไม่ถูกต้อง กรุณาตรวจสอบหน้าตั้งค่า", "Invalid token — check Settings"),
    "result.fail.rate_limited": (
        "ระบบ AI ไม่ว่าง กรุณารอสักครู่แล้วลองใหม่",
        "AI is busy — wait a moment and retry",
    ),
    "result.fail.rejected": ("ระบบปฏิเสธข้อมูล กรุณาลองใหม่", "Rejected by server — please retry"),
    "result.fail.unidentifiable": (
        "ระบบไม่รู้จักรายการนี้ กรุณาลองใหม่",
        "Item not recognised — please retry",
    ),
    # Banner fallbacks (user already left the result card)
    "banner.in_done": ("นำเข้าแล้ว: {name}", "Checked in: {name}"),
    "banner.out_done": ("นำออกแล้ว: {name}", "Checked out: {name}"),
    "banner.in_queued": ("บันทึกนำเข้าไว้ในเครื่อง: {name}", "Check-in saved offline: {name}"),
    "banner.out_queued": ("บันทึกนำออกไว้ในเครื่อง: {name}", "Check-out saved offline: {name}"),
    "banner.queued_sub": ("จะส่งข้อมูลเมื่อออนไลน์", "Will sync when online"),
    "banner.in_failed": ("นำเข้าไม่สำเร็จ: {name}", "Check-in failed: {name}"),
    "banner.out_failed": ("นำออกไม่สำเร็จ: {name}", "Check-out failed: {name}"),
    "banner.retry": ("กรุณาลองใหม่", "Please retry"),
    # --- Settings ---------------------------------------------------------------
    "settings.title": ("ตั้งค่าระบบ", "Settings"),
    "settings.language": ("ภาษา", "Language"),
    "settings.minimize": ("ย่อหน้าต่าง", "Minimize"),
    "settings.fullscreen": ("เต็มจอ / หน้าต่าง", "Fullscreen / Window"),
    "settings.quit": ("ปิดโปรแกรม", "Quit"),
    "settings.token": ("Gateway Token (รหัสเชื่อมต่อเซิร์ฟเวอร์)", "Gateway Token (server key)"),
    "settings.show": ("แสดง", "Show"),
    "settings.hide": ("ซ่อน", "Hide"),
    "settings.paste": ("วาง", "Paste"),
    "settings.clear": ("ล้าง", "Clear"),
    "settings.seconds_suffix": (" วินาที", " s"),
    "settings.disabled": ("ปิดใช้งาน", "Disabled"),
    "settings.autocomplete": ("นับถอยหลังเริ่มต้น (นำเข้า/นำออก)", "Initial countdown (check-in/out)"),
    "settings.sleep": ("พักหน้าจอเมื่อไม่มีคนหลัง", "Sleep display after no one for"),
    "settings.pir": ("ขาเซ็นเซอร์ตรวจจับการเคลื่อนไหว", "Motion sensor pin"),
    "settings.door": ("ปิดประตูอัตโนมัติเมื่อเปิดค้าง", "Auto-close door when left open"),
    "settings.back": ("‹  ย้อนกลับ", "‹  Back"),
    "settings.hint": ("ใช้เมาส์หรือแตะหน้าจอ", "Use mouse or touch"),
    "settings.save": ("บันทึก", "Save"),
}

_language: Lang = DEFAULT_LANGUAGE


class _TextWidget(Protocol):
    def setText(self, text: str | None) -> None: ...


# (weak widget ref, key, format kwargs, optional setter override)
_bindings: list[
    tuple[weakref.ref[Any], str, dict[str, Any], Callable[[Any, str], None] | None]
] = []


def normalize_language(value: str | None) -> Lang:
    """Maps any stored value to a supported language (falls back to Thai)."""
    lowered = (value or "").strip().lower()
    if lowered == "en":
        return "en"
    if lowered == "th":
        return "th"
    return DEFAULT_LANGUAGE


def get_language() -> Lang:
    return _language


def set_language(lang: str) -> Lang:
    """Switches the UI language and re-applies all bound static texts."""
    global _language
    _language = normalize_language(lang)
    retranslate_bound()
    return _language


def t(key: str, **kwargs: Any) -> str:
    """Translated string for ``key`` in the current language."""
    pair = STRINGS.get(key)
    if pair is None:
        logger.warning("Missing i18n key: %s", key)
        return key
    text = pair[0] if _language == "th" else pair[1]
    return text.format(**kwargs) if kwargs else text


def t_pair(key: str, **kwargs: Any) -> tuple[str, str]:
    """(Thai, English) for ``key`` regardless of the current language (bilingual banners)."""
    th, en = STRINGS.get(key, (key, key))
    if kwargs:
        return th.format(**kwargs), en.format(**kwargs)
    return th, en


def pick(th: str, en: str) -> str:
    """Chooses between two existing translations (e.g. item names from the AI)."""
    if _language == "en" and en:
        return en
    return th or en


def bind_text(
    widget: Any,
    key: str,
    setter: Callable[[Any, str], None] | None = None,
    **kwargs: Any,
) -> Any:
    """Sets ``widget``'s text from ``key`` now and on every later language switch."""
    _bindings.append((weakref.ref(widget), key, kwargs, setter))
    _apply(widget, key, kwargs, setter)
    return widget


def _apply(
    widget: Any, key: str, kwargs: dict[str, Any], setter: Callable[[Any, str], None] | None
) -> None:
    text = t(key, **kwargs)
    if setter is not None:
        setter(widget, text)
    else:
        cast(_TextWidget, widget).setText(text)


def retranslate_bound() -> None:
    """Re-applies all bound texts, dropping widgets that no longer exist."""
    alive: list[
        tuple[weakref.ref[Any], str, dict[str, Any], Callable[[Any, str], None] | None]
    ] = []
    for ref, key, kwargs, setter in _bindings:
        widget = ref()
        if widget is None:
            continue
        try:
            _apply(widget, key, kwargs, setter)
        except RuntimeError:  # underlying C++ object already deleted
            continue
        alive.append((ref, key, kwargs, setter))
    _bindings[:] = alive
