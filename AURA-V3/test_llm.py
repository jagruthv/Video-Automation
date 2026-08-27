import sys
sys.path.insert(0, r'd:\Automation\AURA-V3')
from engine.metadata import _call_groq, _call_cerebras
import urllib.error

print("Testing GROQ...")
try:
    res = _call_groq("Say hello")
    print("GROQ SUCCESS:", res[:100])
except urllib.error.HTTPError as e:
    print("GROQ 403 RAW BODY:", e.read().decode(errors='replace'))
except Exception as e:
    print("GROQ ERR:", e)

print("Testing CEREBRAS...")
try:
    res = _call_cerebras("Say hello")
    print("CEREBRAS SUCCESS:", res[:100])
except urllib.error.HTTPError as e:
    print("CEREBRAS 403 RAW BODY:", e.read().decode(errors='replace'))
except Exception as e:
    print("CEREBRAS ERR:", e)
