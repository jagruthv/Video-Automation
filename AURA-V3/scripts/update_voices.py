import sqlite3

db = sqlite3.connect(r'D:\Automation\AURA-V3\data\aura_v3.db')

# Update all 'adam' voices to 'nova' EXCEPT the Wedding Fund video (onyx A/B test)
r1 = db.execute("UPDATE videos SET voice = 'nova' WHERE voice = 'adam' AND video_id != '81c90467543e0503'")
# Ensure Wedding Fund stays onyx
r2 = db.execute("UPDATE videos SET voice = 'onyx' WHERE video_id = '81c90467543e0503'")
db.commit()

print(f'Updated to nova: {r1.rowcount} videos')
print(f'Wedding Fund onyx: {r2.rowcount}')

rows = db.execute("SELECT video_id, voice, substr(title,1,50) FROM videos").fetchall()
for r in rows:
    print(r)
