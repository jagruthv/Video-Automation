import urllib.request, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

try:
    with urllib.request.urlopen('http://localhost:3001/api/library?limit=10', timeout=5) as r:
        data = json.loads(r.read())
    items = data.get('videos', data.get('items', []))
    print(f'V2 server ONLINE. Items in memory: {len(items)}')
    for v in items[-4:]:
        title  = str(v.get('title', ''))[:60]
        script = str(v.get('script_text', v.get('script', '')))[:120]
        print(f'\n  title:  {title}')
        if script:
            print(f'  script: {script}')
except Exception as e:
    print(f'V2 server offline: {e}')
