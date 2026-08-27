import sqlite3
import json

db = sqlite3.connect('D:/Automation/AURA-V3/data/aura_v3.db')
c = db.cursor()
c.execute("DELETE FROM videos WHERE video_id='59b0e9c138b8b5a6'")

data = json.load(open('D:/Automation/AURA-V3/data/payload_pending.json', encoding='utf-8'))
item = next(i for i in data if i.get('ID') == 18)

c.execute(
    'INSERT OR REPLACE INTO videos (video_id, title, script_text, voice, mode, generation_status) VALUES (?, ?, ?, ?, ?, ?)',
    ('04f3d5f7134b965b', item.get('Source_Video')[:100], item['Remixed_Audio_Script'], 'nova', 'standard', 'pending')
)
db.commit()
print('Done!')
