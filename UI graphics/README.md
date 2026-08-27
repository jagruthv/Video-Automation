# UI Graphics & Animation Engine

This directory contains the standalone, high-precision UI Graphics and Animation engine for AURA YouTube Shorts.

---

## 📱 Features

- **iOS SMS Popups**: Realistic iMessage notification card with customizable sender, timestamp, and message body.
- **Email Notifications**: Email banner card with app title, sender name, sender email handle, and body snippet preview.
- **Dynamic Keyframe Animation**: Renders 1080×1920 9:16 portrait video clips with smooth top slide-in (0.4s), customizable hold duration, and smooth fade-out (0.35s).
- **Crisp Typography**: Native Windows Segoe UI / Arial font fallbacks for high-contrast, crystal-clear readability on mobile screens.

---

## 🚀 Quick Start

Run the demo renderer:
```bash
python demo_render.py
```

### Python Integration

```python
from pathlib import Path
from ui_engine import UIPopupConfig, generate_ui_clip

config = UIPopupConfig(
    popup_type="sms",  # or "email"
    sender_name="Sarah",
    body_text="Here is the evidence you requested.",
    timestamp="1m ago"
)

output_clip = generate_ui_clip(config, duration=2.5, output_dir=Path("output"))
```
