"""
Full audit script for AURA-V3 forge pipeline.
Run: python audit.py
"""
import sys
import traceback
sys.path.insert(0, r"D:\Automation\AURA-V3")

PASS_STR = "  OK"
errors = []

def check(name, fn):
    try:
        fn()
        print(f"{name:<26}{PASS_STR}")
    except Exception as exc:
        errors.append(f"{name}: {exc}")
        print(f"{name:<26}  FAIL: {exc}")
        traceback.print_exc()

# ── 1. config ──────────────────────────────────────────────────────────────
def test_config():
    import config
    required = [
        "OUTPUT_WIDTH","OUTPUT_HEIGHT","OUTPUT_FPS",
        "TMP_AUDIO_DIR","TMP_RENDER_DIR","OUTPUT_DIR",
        "LOG_PATH","LOG_LEVEL",
        "VAULT_DIR","KINETIC_SAND_PATH","LARGE_CLIP_THRESHOLD_MB",
        "MAPBOX_TOKEN","MAP_COUNTRY_ZOOM","MAP_CITY_ZOOM",
        "UI_FONT_PATH","UI_FONT_BOLD_PATH",
        "VIDEO_CODEC","AUDIO_CODEC","CRF","PRESET",
        "TTS_VOICE","TTS_MODEL","TTS_TIMEOUT_S","TTS_SPEED","TTS_BACKOFF_SECS",
        "AUDIO_BITRATE",
        "CAPTION_WORDS_PER_GROUP","CAPTION_FONT_SIZE",
        "CAPTION_Y_POSITION","CAPTION_BORDER_W",
    ]
    missing = [k for k in required if not hasattr(config, k)]
    if missing:
        raise AssertionError(f"Missing constants: {missing}")

    legacy = ["VIDEO_SPEED","WORDS_PER_MINUTE","TARGET_DURATION_MIN",
              "TARGET_DURATION_MAX","VIDEO_BITRATE"]
    present = [k for k in legacy if hasattr(config, k)]
    if present:
        raise AssertionError(f"Legacy constants still in config: {present}")

    valid_voices = {"alloy","echo","fable","onyx","nova","shimmer"}
    if config.TTS_VOICE not in valid_voices:
        raise AssertionError(
            f"TTS_VOICE={config.TTS_VOICE!r} not valid. Valid: {valid_voices}"
        )

check("config.py", test_config)

# ── 2. models ─────────────────────────────────────────────────────────────
def test_models():
    from models import DirectorScript, TimelineBlock, BackgroundVaultParams, MapEngineParams
    # PrivateAttr fix
    t = TimelineBlock(
        Block_ID=1, Audio_Narration="test narration",
        Visual_Engine="Background_Vault",
        Visual_Parameters={"effect": "slow_zoom"},
    )
    p = t.get_params()
    assert p is not None, "get_params() returned None — PrivateAttr broken"
    assert isinstance(p, BackgroundVaultParams)
    assert p.effect == "slow_zoom"

    # Map params validation
    t2 = TimelineBlock(
        Block_ID=1, Audio_Narration="test",
        Visual_Engine="Map_Engine",
        Visual_Parameters={"location_name": "London, UK", "lat": 51.5, "lon": -0.12},
    )
    mp = t2.get_params()
    assert isinstance(mp, MapEngineParams)
    assert mp.lat == 51.5

    # Full schema
    ds = DirectorScript.model_validate({
        "Video_Metadata": {"Title": "Audit Test"},
        "Timeline": [
            {"Block_ID": 1, "Audio_Narration": "test",
             "Visual_Engine": "Background_Vault",
             "Visual_Parameters": {"effect": "ken_burns"}}
        ]
    })
    assert ds.Timeline[0].get_params().effect == "ken_burns"

check("models.py", test_models)

# ── 3. logger_setup ───────────────────────────────────────────────────────
def test_logger():
    import engine.forges.logger_setup as ls
    assert callable(ls.init)
    assert hasattr(ls, "_ColorConsoleFormatter")
    assert hasattr(ls, "_FileFormatter")

check("logger_setup.py", test_logger)

# ── 4. caption_forge ──────────────────────────────────────────────────────
def test_caption():
    import engine.forges.caption_forge as cf

    narration = "My power-tripping HOA president tried to foreclose on my house over a fine"
    groups = cf._word_groups(narration, 10.0)
    assert len(groups) > 0, "No groups generated"
    assert len(groups[0]) == 3, f"Expected (text, start, end) tuple, got: {groups[0]}"
    assert groups[0][1] == 0.0, f"First group must start at 0.0, got {groups[0][1]}"
    assert groups[-1][2] > 0.0, "Last group end must be > 0"

    # Text escaping
    raw = "it's 50% done: buy now \\ path"
    esc = cf._esc(raw)
    assert "\\'" in esc, "Single quote not escaped"
    assert "\\:" in esc, "Colon not escaped"
    assert "%%" in esc, "Percent not escaped"
    assert "\\\\" in esc, "Backslash not escaped"

    # Font resolution returns a string
    font = cf._resolve_font()
    assert isinstance(font, str)

    # Drawtext chain
    chain = cf._build_drawtext_chain(groups, "")
    assert "drawtext=" in chain
    assert "between(" in chain

    word_count = len(narration.split())
    print(f"  ({len(groups)} groups for {word_count} words, escaping OK)", end="")

check("caption_forge.py", test_caption)

# ── 5. audio_forge ────────────────────────────────────────────────────────
def test_audio():
    import engine.forges.audio_forge as af
    assert callable(af.generate)
    assert callable(af.generate_all)
    assert af._MIN_AUDIO_BYTES == 2_000
    assert callable(af._probe_duration)
    assert callable(af._apply_speed)
    assert callable(af._download_raw)

check("audio_forge.py", test_audio)

# ── 6. map_forge ──────────────────────────────────────────────────────────
def test_map():
    import engine.forges.map_forge as mf
    assert callable(mf.render)
    assert callable(mf._mapbox)
    assert callable(mf._osm_stitch)
    assert callable(mf._pillow_fallback)
    # Tile coordinate math
    x, y = mf._latlon_to_osm(51.5074, -0.1278, 10)
    assert x > 0 and y > 0, f"Bad OSM tile coords: x={x}, y={y}"

check("map_forge.py", test_map)

# ── 7. manim_forge ────────────────────────────────────────────────────────
def test_manim():
    import engine.forges.manim_forge as mnf
    assert callable(mnf.render_legal_doc)
    assert callable(mnf.render_flowchart)
    assert callable(mnf._write_sidecar)
    assert callable(mnf._legal_script)
    assert callable(mnf._flowchart_script)
    # Sidecar script uses JSON — no user text in f-string
    from pathlib import Path
    s = mnf._legal_script(Path("C:/tmp/sidecar.json"))
    assert "json.load" in s, "Legal script does not load from sidecar"
    assert "repr(" not in s, "Legacy repr() injection still present"

check("manim_forge.py", test_manim)

# ── 8. ui_forge ───────────────────────────────────────────────────────────
def test_ui():
    import engine.forges.ui_forge as uf
    assert callable(uf.render)
    assert callable(uf._sms_png)
    assert callable(uf._email_png)
    assert callable(uf._animate)

check("ui_forge.py", test_ui)

# ── 9. vault_forge ────────────────────────────────────────────────────────
def test_vault():
    import engine.forges.vault_forge as vf
    assert callable(vf.render)
    assert callable(vf._render_black)
    assert callable(vf._build_vf)
    # Verify scale is NOT 8000 (was the memory bug)
    slow = vf._vf_slow_zoom(5.0)
    assert "4000" in slow, f"scale should be 4000, found: {slow[:60]}"
    assert "8000" not in slow, "Legacy scale=8000 still present"

check("vault_forge.py", test_vault)

# ── 10. assembly ──────────────────────────────────────────────────────────
def test_assembly():
    import engine.forges.assembly as asm
    import inspect
    sig    = inspect.signature(asm.assemble)
    params = list(sig.parameters.keys())
    assert "block_segments" in params
    assert "title" in params
    assert callable(asm._normalize)
    assert callable(asm._run_ffmpeg)
    assert callable(asm._probe_duration)
    # Verify caption_forge is imported (not the old standalone approach)
    src = open(r"D:\Automation\AURA-V3\engine\forges\assembly.py", encoding="utf-8").read()
    assert "caption_forge" in src, "assembly.py must import caption_forge"
    print(f"  (signature: {params})", end="")

check("assembly.py", test_assembly)

# ── 11. forge_main ────────────────────────────────────────────────────────
def test_main():
    import forge_main
    assert callable(forge_main.run)
    assert callable(forge_main._render_visual)
    # Verify narration is passed to assemble
    src = open(r"D:\Automation\AURA-V3\forge_main.py", encoding="utf-8").read()
    assert "Audio_Narration" in src, "forge_main must pass narration to assemble"

check("forge_main.py", test_main)

# ── SUMMARY ───────────────────────────────────────────────────────────────
print()
print("=" * 55)
if errors:
    print(f"  AUDIT FAILED — {len(errors)} error(s):")
    for e in errors:
        print(f"  x  {e}")
    sys.exit(1)
else:
    print(f"  FULL AUDIT PASSED — 11/11 modules clean")
    print("=" * 55)
    sys.exit(0)
