"""Shared pytest fixtures."""

from collections.abc import Generator

import pytest

from foodwarden_camera.ui import i18n


@pytest.fixture(autouse=True)
def _reset_ui_language() -> Generator[None, None, None]:
    """UI language is process-global; every test starts (and ends) in Thai."""
    i18n.set_language("th")
    yield
    i18n.set_language("th")
