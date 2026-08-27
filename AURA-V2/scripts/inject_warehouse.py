import sqlite3
import json

db = sqlite3.connect(r'D:\Automation\AURA-V2\tmp\database.sqlite')

blueprint = {
    "_missionId": "81c90467543e0503",
    "title": "My Sister Stole My Wedding Fund So I Deleted Her Entire Digital Life",
    "hook": "My sister stole $20,000 from my wedding fund and told me to \"just get over it.\" She didn't realize I was the one who set up her entire digital business. While she was out celebrating with my money, I was hitting \"delete\" on her livelihood.",
    "story": "See, I had given her access to a shared account for family emergencies. Instead of an emergency, she drained twenty grand. When I confronted her, she laughed. She said family doesn't sue each other, so she was keeping it for her \"emergency.\"\nShe was right about one thing. I didn't sue. I just logged into the AWS server I built for her from scratch. I didn't just delete her files; I revoked her domain access, wiped her client database, and destroyed her backups. Ten years of work, gone in ten seconds.\nThe next morning, she called me screaming in panic. The realization hit her that the \"emergency\" is now her complete lack of a job.",
    "callToAction": "Now, she's begging for the backups, but I told her the price is $20,000 plus interest. Am I the villain, or did she learn a lesson? Drop a PART 2 comment below if you want to know what happened next!",
    "fullScript": "My sister stole $20,000 from my wedding fund and told me to \"just get over it.\" She didn't realize I was the one who set up her entire digital business. While she was out celebrating with my money, I was hitting \"delete\" on her livelihood.\nSee, I had given her access to a shared account for family emergencies. Instead of an emergency, she drained twenty grand. When I confronted her, she laughed. She said family doesn't sue each other, so she was keeping it for her \"emergency.\"\nShe was right about one thing. I didn't sue. I just logged into the AWS server I built for her from scratch. I didn't just delete her files; I revoked her domain access, wiped her client database, and destroyed her backups. Ten years of work, gone in ten seconds.\nThe next morning, she called me screaming in panic. The realization hit her that the \"emergency\" is now her complete lack of a job.\nNow, she's begging for the backups, but I told her the price is $20,000 plus interest. Am I the villain, or did she learn a lesson? Drop a PART 2 comment below if you want to know what happened next!",
    "youtubeTitle": "My Sister Stole My Wedding Fund, So I Deleted Her Life 😱",
    "description": "My sister thought she could steal $20,000 from my wedding fund and get away with it because \"family doesn't sue each other.\" She completely forgot that I built her entire digital business from scratch. While she was out celebrating with my money, I was logging into her AWS servers and wiping 10 years of her hard work. Now she's begging for the backups, but the price is $20,000 plus interest.\n\nDrop a PART 2 comment below if you want to know what happened next!\n\nseo keywords: wedding fund stolen, family betrayal, nuclear revenge, tech revenge, sister stole money, AWS server wipe, family drama, reddit stories, am i the jerk.\n#shorts #youtubeshorts #storytime #redditstories #revenge #familydrama #betrayal",
    "tags": ["shorts", "youtubeshorts", "storytime", "redditstories", "reddit", "aita", "nuclear revenge", "family drama", "wedding fund", "betrayal", "sister", "tech revenge"],
    "thumbnailPrompt": "Cinematic 1280x720 split-screen YouTube thumbnail. On the left side, a glowing red 'Bank Transfer Denied' error notification on a smartphone screen. On the right side, a blurred digital folder ominously labeled 'SISTER_FILES_DELETED' in bold red text. Photorealistic, bold lighting, high-stakes cyber revenge aesthetic."
}

db.execute('''
    INSERT OR REPLACE INTO warehouse_blueprints 
    (id, title, topic, template, bg_mode, blueprint_json, stage, status) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
''', (
    "81c90467543e0503",
    blueprint["title"],
    "Nuclear revenge against a family member who stole a wedding fund",
    "STANDARD",
    "pinterest",
    json.dumps(blueprint),
    "scripted",
    "warehoused"
))

db.commit()
print("Successfully injected directly into SQLite database.")
