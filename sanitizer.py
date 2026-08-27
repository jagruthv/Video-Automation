import os
import shutil
import hashlib

# 1. THE REAL PATHS
# Based on your map: n8n > asmr-qa-vault > public > raw video
BASE_DIR = r"D:\Automation\n8n\asmr-qa-vault\public"
RAW_DIR = os.path.join(BASE_DIR, "raw_videos")
ACCEPTED_DIR = os.path.join(BASE_DIR, "accepted_vault")
TRASH_DIR = os.path.join(BASE_DIR, "trash_bin")

# Create folders if they don't exist
for folder in [ACCEPTED_DIR, TRASH_DIR]:
    if not os.path.exists(folder):
        os.makedirs(folder)

def get_file_hash(path):
    """Checks the actual data inside the file to find 100% matches."""
    hasher = hashlib.md5()
    with open(path, 'rb') as f:
        buf = f.read(65536)
        hasher.update(buf)
    return hasher.hexdigest()

def sanitize():
    if not os.path.exists(RAW_DIR):
        print(f"❌ ERROR: Path not found: {RAW_DIR}")
        return

    files = [f for f in os.listdir(RAW_DIR) if f.endswith('.mp4')]
    seen_hashes = {} 

    print(f"🧐 Scanning {len(files)} videos in 'raw video'...")

    for filename in files:
        full_path = os.path.join(RAW_DIR, filename)
        
        # RULE 1: TRASH 0-BYTE OR BROKEN FILES
        file_size = os.path.getsize(full_path)
        if file_size < 1000: # Less than 1KB
            shutil.move(full_path, os.path.join(TRASH_DIR, filename))
            continue

        # RULE 2: HASH CHECK (Finds exact duplicates even with different names)
        f_hash = get_file_hash(full_path)

        if f_hash in seen_hashes:
            print(f"🗑️ Found exact duplicate (bits match): {filename}")
            shutil.move(full_path, os.path.join(TRASH_DIR, filename))
        else:
            seen_hashes[f_hash] = filename
            # Move unique files to accepted for the Next.js app to use
            shutil.copy(full_path, os.path.join(ACCEPTED_DIR, filename))

    print(f"\n✅ Clean-up complete.")
    print(f"📂 Unique videos moved to: {ACCEPTED_DIR}")
    print(f"📂 Duplicates moved to: {TRASH_DIR}")

if __name__ == "__main__":
    sanitize()