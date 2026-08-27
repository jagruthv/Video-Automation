from flask import Flask, request, jsonify
import subprocess

app = Flask(__name__)

@app.route('/tts', methods=['POST'])
def run_tts():
    hook_text = request.json.get("text", "")
    print(f"📥 Received hook from n8n: {hook_text}")
    
    # Run the Cartesia script and capture the actual output
    result = subprocess.run(
        ["python", r"D:\Automation\n8n\audio_scripts\tts_fish.py", hook_text],
        capture_output=True,
        text=True
    )
    
    # Check if the script actually succeeded
    if result.returncode == 0:
        print("✅ Audio generated successfully")
        return jsonify({"status": "Audio created", "log": result.stdout})
    else:
        print("❌ Script failed!")
        print(result.stderr)
        return jsonify({"status": "Error", "log": result.stderr, "output": result.stdout}), 500

if __name__ == '__main__':
    print("🔥 Local Voice Server running on port 5000...")
    app.run(port=5000)