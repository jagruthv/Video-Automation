import os
import requests
import urllib.parse
from dotenv import load_dotenv

# --- 1. LOAD SECRETS ---
load_dotenv()
API_KEY = os.getenv("POLLINATIONS_BYOP_KEY") 

# --- 2. THE CASTING ROSTER ---
# Mixing ElevenLabs heavy hitters and the top OpenAI wildcard
TOP_VOICES = [
    {"engine": "elevenlabs", "voice": "adam"},
    {"engine": "elevenlabs", "voice": "george"},
    {"engine": "elevenlabs", "voice": "antoni"},
    {"engine": "elevenlabs", "voice": "rachel"},
    {"engine": "elevenlabs", "voice": "bella"},
    {"engine": "openai", "voice": "onyx"} 
]

TEXT = "The factory is online. I swapped the architecture to a premium cinematic voice, and now viewer retention is absolutely unstoppable."
OUTPUT_FOLDER = r"D:\Automation\n8n\bin"

def run_audition(engine, voice, text):
    if not os.path.exists(OUTPUT_FOLDER): 
        os.makedirs(OUTPUT_FOLDER)
        
    print(f"🎙️ Auditioning: {voice.upper()} (Engine: {engine})...")
    
    encoded_text = urllib.parse.quote(text)
    url = f"https://gen.pollinations.ai/audio/{encoded_text}?model={engine}&voice={voice}"
    
    headers = {}
    if API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"
    
    try:
        response = requests.get(url, headers=headers)
        
        if response.status_code == 200:
            output_file = os.path.join(OUTPUT_FOLDER, f"audition_{voice}.mp3")
            with open(output_file, "wb") as f:
                f.write(response.content)
            print(f"   ✅ SUCCESS: Saved to audition_{voice}.mp3\n")
        else:
            print(f"   ❌ API ERROR ({response.status_code})")
            print(f"   Response: {response.text[:150]}...\n") 
    except Exception as e:
        print(f"   ❌ SYSTEM ERROR: {str(e)}\n")

if __name__ == "__main__":
    if not API_KEY:
        print("⚠️ WARNING: BYOP Key not found in .env. Running on public pool...\n")
        
    print("🚀 STARTING THE AURA CASTING CALL...\n")
    for candidate in TOP_VOICES:
        run_audition(candidate["engine"], candidate["voice"], TEXT)
    
    print("🎬 Auditions complete. Check your bin folder to compare the Auras.")