"""Dark-mode UI Stylesheet and layout metrics for 5-inch 800x480 LCD."""

MAIN_WINDOW_WIDTH = 800
MAIN_WINDOW_HEIGHT = 480

DARK_STYLESHEET = """
QWidget {
    background-color: #121212;
    color: #FFFFFF;
    font-family: 'Segoe UI', 'Noto Sans Thai', 'Tahoma', sans-serif;
}

QFrame.card {
    background-color: #1E1E1E;
    border-radius: 8px;
    border: 1px solid #2D2D2D;
}

QFrame.card-highlight {
    background-color: #242A38;
    border-radius: 8px;
    border: 2px solid #3B82F6;
}

QLabel.title-th {
    font-size: 20px;
    font-weight: bold;
    color: #FFFFFF;
}

QLabel.title-en {
    font-size: 13px;
    color: #9CA3AF;
}

QLabel.prompt-th {
    font-size: 18px;
    font-weight: 600;
    color: #E5E7EB;
}

QLabel.prompt-en {
    font-size: 13px;
    color: #9CA3AF;
}

QLabel.item-name-th {
    font-size: 24px;
    font-weight: bold;
    color: #10B981;
}

QLabel.item-name-en {
    font-size: 16px;
    color: #D1D5DB;
}

QLabel.countdown-text {
    font-size: 16px;
    font-weight: bold;
    color: #F59E0B;
}

QLabel.pill-button-o {
    background-color: #059669;
    color: white;
    font-weight: bold;
    font-size: 14px;
    border-radius: 6px;
    padding: 6px 14px;
}

QLabel.pill-button-x {
    background-color: #DC2626;
    color: white;
    font-weight: bold;
    font-size: 14px;
    border-radius: 6px;
    padding: 6px 14px;
}

QLabel.pill-button-nav {
    background-color: #2563EB;
    color: white;
    font-weight: bold;
    font-size: 14px;
    border-radius: 6px;
    padding: 6px 14px;
}

QLabel.status-pill-ok {
    background-color: #064E3B;
    color: #34D399;
    font-size: 12px;
    font-weight: 600;
    border-radius: 4px;
    padding: 3px 8px;
}

QLabel.status-pill-warn {
    background-color: #78350F;
    color: #FBBF24;
    font-size: 12px;
    font-weight: 600;
    border-radius: 4px;
    padding: 3px 8px;
}

QListWidget {
    background-color: #1A1A1A;
    border: 1px solid #333333;
    border-radius: 6px;
    outline: 0;
}

QListWidget::item {
    padding: 10px;
    border-bottom: 1px solid #262626;
    border-radius: 4px;
}

QListWidget::item:selected {
    background-color: #1E3A8A;
    border: 2px solid #3B82F6;
    color: #FFFFFF;
}
"""
