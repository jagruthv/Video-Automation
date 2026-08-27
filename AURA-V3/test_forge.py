"""
test_forge.py -- AURA-V3 Production Test: HOA Pig Farm Story
=============================================================
7-block Director Script with mixed engines:
  Block 1: Background_Vault  -- Intro hook (suburban neighborhood cuts)
  Block 2: UI_Popup          -- HOA violation notice (email popup)
  Block 3: Background_Vault  -- Escalation (HOA harassment montage)
  Block 4: Map_Engine        -- Neighborhood map (showing the suburban zone)
  Block 5: Background_Vault  -- Discovery moment (digging through records)
  Block 6: UI_Popup          -- Zoning law filing (SMS/document popup)
  Block 7: Background_Vault  -- Resolution + pigs (victory montage)

Run:
  $env:PYTHONIOENCODING="utf-8"; python test_forge.py
"""

from forge_main import run

DIRECTOR_SCRIPT = {
    "Video_Metadata": {
        "Title": "HOA_Pig_Farm_Revenge"
    },
    "Timeline": [
        {
            "Block_ID": 1,
            "Audio_Narration": (
                "My power-tripping HOA president tried to foreclose on my house "
                "over a five hundred dollar fine for my work truck. "
                "I run a local plumbing business and occasionally park my branded "
                "van in my own driveway overnight. Richard hated this."
            ),
            "Visual_Engine": "Background_Vault",
            "Visual_Parameters": {
                "effect": "slow_zoom"
            }
        },
        {
            "Block_ID": 2,
            "Audio_Narration": (
                "He started issuing me daily fifty dollar citations for commercial "
                "vehicle eyesores. Over six months the fines compounded to over "
                "three thousand dollars. When I still couldn't pay, he escalated "
                "to foreclosure proceedings."
            ),
            "Visual_Engine": "UI_Popup",
            "Visual_Parameters": {
                "type": "email",
                "sender": "HOA Management <richard@pinnacleHOA.com>",
                "subject": "FINAL NOTICE: Foreclosure Proceedings Initiated",
                "body": (
                    "Dear Homeowner,\n\n"
                    "Your outstanding balance of $3,247.00 in HOA violation fines "
                    "remains unpaid.\n\n"
                    "Effective immediately, foreclosure proceedings have been initiated "
                    "on your property at 142 Elmwood Drive.\n\n"
                    "You have 10 days to respond.\n\n"
                    "— Richard Caldwell\n  HOA President, Pinnacle Estates"
                )
            }
        },
        {
            "Block_ID": 3,
            "Audio_Narration": (
                "I tried to reason with him, explaining I was on emergency call. "
                "But Richard just smirked and told me to read the bylaws. "
                "That's when I decided to do exactly that — read every single "
                "legal document related to our neighborhood."
            ),
            "Visual_Engine": "Background_Vault",
            "Visual_Parameters": {
                "effect": "pan_left"
            }
        },
        {
            "Block_ID": 4,
            "Audio_Narration": (
                "I pulled the original county zoning records from 1921. "
                "Our entire neighborhood, Pinnacle Estates, sits on land that "
                "was officially zoned as Agricultural District C — "
                "a classification that was never formally changed."
            ),
            "Visual_Engine": "Map_Engine",
            "Visual_Parameters": {
                "location_name": "Naperville, Illinois, USA",
                "lat": 41.7758,
                "lon": -88.1473,
                "zoom_sequence": ["country", "city"]
            }
        },
        {
            "Block_ID": 5,
            "Audio_Narration": (
                "Under Agricultural District C zoning, residents have the explicit "
                "legal right to raise livestock for commercial purposes. "
                "The HOA bylaws cannot override a century-old county zoning ordinance. "
                "Richard had handed me the perfect weapon."
            ),
            "Visual_Engine": "Manim_Legal_Doc",
            "Visual_Parameters": {
                "title": "County Zoning Ordinance No. 1921-47C",
                "sections": [
                    "SECTION 4.A: All parcels within Agricultural District C retain",
                    "the perpetual right to engage in livestock farming activities",
                    "for residential or commercial purposes, regardless of any",
                    "private covenant, deed restriction, or HOA bylaw enacted",
                    "subsequent to the original zoning classification date."
                ],
                "highlight": "Section 4.A — Agricultural Rights Preserved"
            }
        },
        {
            "Block_ID": 6,
            "Audio_Narration": (
                "I filed for a commercial livestock permit with the county. "
                "It was approved in three days. Then I ordered twelve piglets "
                "from a local farm. I built a proper pen in my backyard, "
                "completely up to code, and opened Elmwood Premium Pork LLC."
            ),
            "Visual_Engine": "UI_Popup",
            "Visual_Parameters": {
                "type": "sms",
                "contact": "County Zoning Office",
                "messages": [
                    {"sender": "them", "text": "Your livestock permit #LP-2024-0847 has been APPROVED. Agricultural District C rights confirmed."},
                    {"sender": "me",   "text": "Thank you! First delivery of 12 Berkshire piglets scheduled for Saturday."},
                    {"sender": "them", "text": "Congratulations on your new business. No further permits required under Ordinance 1921-47C."}
                ]
            }
        },
        {
            "Block_ID": 7,
            "Audio_Narration": (
                "Richard called an emergency HOA meeting. His own lawyer confirmed "
                "the county zoning superseded HOA authority. Faced with legal fees "
                "he couldn't win, Richard resigned from the HOA board and quietly "
                "sold his house six months later. My pigs are doing great."
            ),
            "Visual_Engine": "Background_Vault",
            "Visual_Parameters": {
                "effect": "random"
            }
        }
    ]
}

if __name__ == "__main__":
    import sys
    out = run(DIRECTOR_SCRIPT)
    print(f"\nOutput: {out}")
    sys.exit(0)
