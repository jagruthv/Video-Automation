"""
UI graphics / Demo Renderer CLI
===============================
Usage:
    python demo_render.py
"""

import sys
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

from pathlib import Path
from ui_engine import UIPopupConfig, generate_ui_clip

def main():
    out_dir = Path(__file__).parent / "demo_output"
    print("[UI] Rendering sample iOS SMS UI animation...")
    sms_cfg = UIPopupConfig(
        popup_type="sms",
        sender_name="Alex Mercer",
        body_text="Did you see what just happened? Check your email immediately!",
        timestamp="Just now"
    )
    sms_clip = generate_ui_clip(sms_cfg, duration=3.0, output_dir=out_dir)
    print(f"[UI] SMS Animation created: {sms_clip}")

    print("[UI] Rendering sample Email UI animation...")
    email_cfg = UIPopupConfig(
        popup_type="email",
        sender_name="Legal Department",
        sender_handle="notice@jurisdiction.gov",
        app_name="Encrypted Mail",
        body_text="Urgent Notice: Confidential settlement documents attached for review.",
        timestamp="10:42 AM"
    )
    email_clip = generate_ui_clip(email_cfg, duration=3.0, output_dir=out_dir)
    print(f"[UI] Email Animation created: {email_clip}")

if __name__ == "__main__":
    main()
