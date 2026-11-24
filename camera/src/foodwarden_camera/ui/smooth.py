"""Apple-style continuous corners (squircles) for the LCD widgets.

Qt stylesheets can only draw circular-arc corners, where curvature jumps
abruptly at the straight edge. The ``Smooth*`` widgets paint their own
background/border with eased corners instead. ``smooth_css`` (styles.py)
keeps the QSS box model (padding, border width) but makes it transparent and
carries the real colours in a ``/*sq ...*/`` comment, which is read here.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from functools import lru_cache

from PyQt6.QtCore import QPointF, QRectF, Qt
from PyQt6.QtGui import QBrush, QColor, QPainter, QPainterPath, QPaintEvent, QPen, QTransform
from PyQt6.QtWidgets import QFrame, QLabel, QLineEdit, QPushButton, QSpinBox, QWidget

# One corner as 10 points (3 cubic Béziers), in units of the radius, measured as
# (distance from the side edge, distance from the top edge) of a top-right corner.
# Proportions of the iOS continuous corner; it starts 1.53 r before the corner.
_CONTINUOUS: tuple[tuple[float, float], ...] = (
    (1.52866, 0.0),
    (1.08849, 0.0),
    (0.86841, 0.0),
    (0.63149, 0.07491),
    (0.37282, 0.16906),
    (0.16906, 0.37282),
    (0.07491, 0.63149),
    (0.0, 0.86841),
    (0.0, 1.08849),
    (0.0, 1.52866),
)


def _circular_corner() -> tuple[tuple[float, float], ...]:
    """A plain circular corner with the same point layout (3 arcs of 30°)."""
    k = 4 / 3 * math.tan(math.radians(30) / 4)
    points: list[tuple[float, float]] = []
    for i in range(4):
        sin, cos = math.sin(math.radians(30 * i)), math.cos(math.radians(30 * i))
        x, y = 1 - sin, 1 - cos
        if i > 0:
            points.append((x + k * cos, y - k * sin))
        points.append((x, y))
        if i < 3:
            points.append((x - k * cos, y + k * sin))
    return tuple(points)


_CIRCULAR = _circular_corner()
_SPEC_RE = re.compile(r"/\*sq ([^*]*)\*/")


@dataclass(frozen=True)
class SmoothSpec:
    """Background/border description parsed from a ``/*sq ...*/`` comment."""

    bg: str
    border: str | None
    width: float
    radius: float
    hover: str | None
    focus: str | None


@lru_cache(maxsize=256)
def parse_spec(css: str) -> SmoothSpec | None:
    """Extracts the smooth-corner spec from a stylesheet, if it has one."""
    match = _SPEC_RE.search(css)
    if match is None:
        return None
    fields = dict(part.split("=", 1) for part in match.group(1).split())
    return SmoothSpec(
        bg=fields["bg"],
        border=fields.get("border"),
        width=float(fields.get("w", "0")),
        radius=float(fields["r"]),
        hover=fields.get("hover"),
        focus=fields.get("focus"),
    )


@lru_cache(maxsize=256)
def smooth_path(x: float, y: float, w: float, h: float, radius: float) -> QPainterPath:
    """Rounded rect whose corners ease in and out of the straight edges.

    Smoothing shrinks automatically when a side is too short for the longer
    eased corner, so fully round shapes still come out as true circles.
    """
    path = QPainterPath()
    limit = min(w, h) / 2
    r = max(0.0, min(radius, limit))
    if r <= 0:
        path.addRect(x, y, max(0.0, w), max(0.0, h))
        return path

    # 1 = full continuous corner, 0 = circle (no room left for the longer easing).
    blend = max(0.0, min(1.0, (limit / r - 1) / (_CONTINUOUS[0][0] - 1)))
    corner = [
        (r * (cx + (sx - cx) * blend), r * (cy + (sy - cy) * blend))
        for (cx, cy), (sx, sy) in zip(_CIRCULAR, _CONTINUOUS, strict=True)
    ]
    # Same corner in all four positions, clockwise from the top-right.
    right, bottom = x + w, y + h
    corners = (
        [QPointF(right - u, y + v) for u, v in corner],
        [QPointF(right - v, bottom - u) for u, v in corner],
        [QPointF(x + u, bottom - v) for u, v in corner],
        [QPointF(x + v, y + u) for u, v in corner],
    )
    for i, pts in enumerate(corners):
        if i == 0:
            path.moveTo(pts[0])
        else:
            path.lineTo(pts[0])
        for j in (1, 4, 7):
            path.cubicTo(pts[j], pts[j + 1], pts[j + 2])
    path.closeSubpath()
    return path


def paint_smooth(widget: QWidget, spec: SmoothSpec) -> None:
    """Paints a widget's squircle background and border."""
    bg, border, width = spec.bg, spec.border, spec.width
    if spec.hover and widget.isEnabled() and widget.underMouse():
        bg = spec.hover
    if spec.focus and widget.hasFocus():
        border = spec.focus
        width = max(width, 2.0)
    color = QColor(bg)
    if isinstance(widget, QPushButton) and widget.isDown():
        color = color.darker(108)

    painter = QPainter(widget)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    inset = width / 2 if border else 0.0
    path = smooth_path(
        inset,
        inset,
        widget.width() - 2 * inset,
        widget.height() - 2 * inset,
        max(0.0, spec.radius - inset),
    )
    painter.setPen(QPen(QColor(border), width) if border else QPen(Qt.PenStyle.NoPen))
    painter.setBrush(color)
    painter.drawPath(path)
    painter.end()


class SmoothFrame(QFrame):
    """QFrame with continuous corners."""

    def paintEvent(self, event: QPaintEvent | None) -> None:
        spec = parse_spec(self.styleSheet())
        if spec is not None:
            paint_smooth(self, spec)
        super().paintEvent(event)


class SmoothLabel(QLabel):
    """QLabel with continuous corners; also rounds its image if ``image_radius`` is set."""

    image_radius: float = 0.0

    def paintEvent(self, event: QPaintEvent | None) -> None:
        spec = parse_spec(self.styleSheet())
        if spec is not None:
            paint_smooth(self, spec)
        pixmap = self.pixmap()
        if self.image_radius <= 0 or pixmap is None or pixmap.isNull():
            super().paintEvent(event)
            return

        # Visible part of the centred pixmap, filled as a texture so edges stay antialiased.
        size = pixmap.deviceIndependentSize()
        box = QRectF(self.contentsRect())
        left = box.center().x() - size.width() / 2
        top = box.center().y() - size.height() / 2
        shown = QRectF(left, top, size.width(), size.height()).intersected(box)
        brush = QBrush(pixmap)
        brush.setTransform(QTransform().translate(left, top))
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
        painter.fillPath(
            smooth_path(shown.x(), shown.y(), shown.width(), shown.height(), self.image_radius),
            brush,
        )
        painter.end()


class SmoothButton(QPushButton):
    """QPushButton with continuous corners."""

    def __init__(self, text: str = "", parent: QWidget | None = None) -> None:
        super().__init__(text, parent)
        self.setAttribute(Qt.WidgetAttribute.WA_Hover, True)

    def paintEvent(self, event: QPaintEvent | None) -> None:
        spec = parse_spec(self.styleSheet())
        if spec is not None:
            paint_smooth(self, spec)
        super().paintEvent(event)


class SmoothLineEdit(QLineEdit):
    """QLineEdit with continuous corners."""

    def paintEvent(self, event: QPaintEvent | None) -> None:
        spec = parse_spec(self.styleSheet())
        if spec is not None:
            paint_smooth(self, spec)
        super().paintEvent(event)


class SmoothSpinBox(QSpinBox):
    """QSpinBox with continuous corners."""

    def paintEvent(self, event: QPaintEvent | None) -> None:
        spec = parse_spec(self.styleSheet())
        if spec is not None:
            paint_smooth(self, spec)
        super().paintEvent(event)
