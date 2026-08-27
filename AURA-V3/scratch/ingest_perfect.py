import os
import sys
import json
from pathlib import Path

# Add AURA-V3 to path
sys.path.append(r"D:\Automation\AURA-V3")

from engine.db import DatabaseTracker
from engine import metadata
import hashlib

db = DatabaseTracker()

# 1. The Perfect Script
script = """My sister stole $20,000 from my wedding fund and told me to "just get over it." She didn't realize I was the one who set up her entire digital business. While she was out celebrating with my money, I was hitting "delete" on her livelihood.
See, I had given her access to a shared account for family emergencies. Instead of an emergency, she drained twenty grand. When I confronted her, she laughed. She said family doesn't sue each other, so she was keeping it for her "emergency."
She was right about one thing. I didn't sue. I just logged into the AWS server I built for her from scratch. I didn't just delete her files; I revoked her domain access, wiped her client database, and destroyed her backups. Ten years of work, gone in ten seconds.
The next morning, she called me screaming in panic. The realization hit her that the "emergency" is now her complete lack of a job.
Now, she's begging for the backups, but I told her the price is $20,000 plus interest. Am I the villain, or did she learn a lesson? Drop a PART 2 comment below if you want to know what happened next!"""

title = "My Sister Stole My Wedding Fund So I Deleted Her Entire Digital Life"
video_id = hashlib.sha256(script.encode("utf-8")).hexdigest()[:16]

yt_title = "My Sister Stole My Wedding Fund, So I Deleted Her Life 😱"
description = """My sister thought she could steal $20,000 from my wedding fund and get away with it because "family doesn't sue each other." She completely forgot that I built her entire digital business from scratch. While she was out celebrating with my money, I was logging into her AWS servers and wiping 10 years of her hard work. Now she's begging for the backups, but the price is $20,000 plus interest.

Drop a PART 2 comment below if you want to know what happened next!

seo keywords: wedding fund stolen, family betrayal, nuclear revenge, tech revenge, sister stole money, AWS server wipe, family drama, reddit stories, am i the jerk.
#shorts #youtubeshorts #storytime #redditstories #revenge #familydrama #betrayal"""
tags = ["shorts", "youtubeshorts", "storytime", "redditstories", "reddit", "aita", "nuclear revenge", "family drama", "wedding fund", "betrayal", "sister", "tech revenge"]

thumbnail_prompt = "Cinematic 1280x720 split-screen YouTube thumbnail. On the left side, a glowing red 'Bank Transfer Denied' error notification on a smartphone screen. On the right side, a blurred digital folder ominously labeled 'SISTER_FILES_DELETED' in bold red text. Photorealistic, bold lighting, high-stakes cyber revenge aesthetic."

print(f"Injecting video {video_id} into AURA-V3...")

# Insert base video
db.insert_video(video_id, title, script, "onyx")

# Set the audio_remaining_script so it skips rewriting
with db._connect() as conn:
    conn.execute(
        "UPDATE videos SET audio_remaining_script = ?, generation_status = 'pending' WHERE video_id = ?",
        (script, video_id)
    )

# Save metadata
db.save_metadata(
    video_id,
    yt_title=yt_title,
    description=description,
    tags=tags,
    thumbnail_path=""
)

print("Generating the perfect thumbnail using Pollinations...")
try:
    thumb_path = metadata.thumbnail(thumbnail_prompt, video_id)
    if thumb_path:
        db.save_metadata(
            video_id,
            yt_title=yt_title,
            description=description,
            tags=tags,
            thumbnail_path=str(thumb_path)
        )
        print(f"Thumbnail saved to {thumb_path}")
except Exception as e:
    print(f"Thumbnail failed: {e}")

print("Sending to API for rendering...")
import urllib.request
import urllib.parse

req = urllib.request.Request(
    "http://127.0.0.1:8001/api/render/single",
    data=json.dumps({"video_id": video_id}).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST"
)
try:
    with urllib.request.urlopen(req) as response:
        print("API Response:", response.read().decode())
except Exception as e:
    print("API Error:", e)

print("Video has been queued perfectly into the memory registry and is rendering!")
