"""
engine/forges/map_forge.py — AURA-V3 Map Forge
================================================
Downloads high-resolution map tiles for a target location and renders
a smooth digital zoom animation (country-level → city-level) timed to
the block's audio duration.

Tile source priority:
  1. Mapbox Static Images API  (dark-v11 style, requires MAPBOX_TOKEN)
  2. Custom OSM 3×3 tile stitcher  (free, proper User-Agent to avoid 403)
  3. Pillow gradient placeholder  (zero-dependency failsafe)

Animation:
  - First half  : country tile zooms IN  (starts wide, tightens)
  - Second half : city tile zooms OUT    (starts close, pulls back slightly)
  - Both segments are concatenated into one seamless MP4.

Fixes applied:
  - scale=4000:-1 (was 8000) to avoid excessive RAM usage on small tiles.
  - All subprocess calls have explicit timeout values.
  - Each stage is logged so failures are immediately pinpointed.
"""

import logging
import math
import subprocess
import urllib.request
from pathlib import Path

import config
from models import MapEngineParams

logger = logging.getLogger("aura.forge.map")

W   = config.OUTPUT_WIDTH    # 1080
H   = config.OUTPUT_HEIGHT   # 1920
FPS = config.OUTPUT_FPS      # 30


# ─────────────────────────────────────────────
# TILE DOWNLOADER: MAPBOX
# ─────────────────────────────────────────────

def _mapbox(lat: float, lon: float, zoom: int, out: Path) -> bool:
    """
    Download a Mapbox dark-v11 static tile (1280×1280).
    Returns True on success, False if MAPBOX_TOKEN is missing or request fails.
    """
    token = config.MAPBOX_TOKEN
    if not token:
        return False  # silently skip, OSM/CartoDB handles it

    url = (
        f"https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/"
        f"{lon},{lat},{zoom},0/1280x1280"
        f"?access_token={token}&logo=false"
    )
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "AURA-V3/2.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
        if len(data) < 5_000:
            raise ValueError(f"Response only {len(data)} bytes — invalid token or quota hit?")
        out.write_bytes(data)
        logger.info(f"[MAP] Mapbox tile OK ({len(data)//1024} KB) → {out.name}")
        return True
    except Exception as exc:
        logger.warning(f"[MAP] Mapbox failed: {exc}")
        return False


# ─────────────────────────────────────────────
# TILE DOWNLOADER: OSM STITCHER
# ─────────────────────────────────────────────

def _latlon_to_osm(lat: float, lon: float, zoom: int) -> tuple[int, int]:
    """Convert WGS84 lat/lon + zoom level to OSM tile x/y."""
    n    = 2.0 ** zoom
    tx   = int((lon + 180.0) / 360.0 * n)
    ty   = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return tx, ty


def _osm_stitch(lat: float, lon: float, zoom: int, out: Path, radius: int = 1) -> bool:
    """
    Download a CartoDB Dark Matter tile grid and stitch into one PNG.
    Uses CartoCD dark_all tiles — free, no API key, dark style (Mapbox alternative).
    Falls back to standard OSM if CartoDB fails.
    Returns True on success.
    """
    try:
        from PIL import Image
        import itertools, random

        cx, cy = _latlon_to_osm(lat, lon, zoom)
        size   = 2 * radius + 1
        canvas = Image.new("RGB", (256 * size, 256 * size))

        # CartoDB Dark Matter — free, no key, dark professional look
        carto_servers = ["a", "b", "c", "d"]
        hdrs = {"User-Agent": "AURA-V3-MapForge/2.0 (educational/non-commercial)"}

        for dx, dy in itertools.product(range(-radius, radius + 1), repeat=2):
            srv = random.choice(carto_servers)
            tile_url = (
                f"https://{srv}.basemaps.cartocdn.com/dark_all/"
                f"{zoom}/{cx+dx}/{cy+dy}.png"
            )
            req = urllib.request.Request(tile_url, headers=hdrs)
            try:
                with urllib.request.urlopen(req, timeout=12) as r:
                    from PIL import Image as _Img
                    tile = _Img.open(r).convert("RGB")
            except Exception:
                # Fallback single tile: standard OSM
                osm_url = f"https://tile.openstreetmap.org/{zoom}/{cx+dx}/{cy+dy}.png"
                req2 = urllib.request.Request(osm_url, headers=hdrs)
                with urllib.request.urlopen(req2, timeout=12) as r:
                    tile = Image.open(r).convert("RGB")
            canvas.paste(tile, ((dx + radius) * 256, (dy + radius) * 256))

        canvas.save(str(out))
        logger.info(f"[MAP] CartoDB dark tile OK ({size}x{size} grid, zoom={zoom}) -> {out.name}")
        return True

    except Exception as exc:
        logger.warning(f"[MAP] CartoDB/OSM stitch failed: {exc}")
        return False


# ─────────────────────────────────────────────
# PILLOW FALLBACK
# ─────────────────────────────────────────────

def _pillow_fallback(lat: float, lon: float, name: str, out: Path) -> None:
    """
    Render a styled dark-gradient map placeholder with location name and
    lat/lon coordinates. Used when both Mapbox and OSM fail.
    """
    from PIL import Image, ImageDraw

    img  = Image.new("RGB", (W, H))
    draw = ImageDraw.Draw(img)

    # Dark teal → near-black vertical gradient
    for y in range(H):
        t = y / H
        r = int(5  + 8  * t)
        g = int(55 - 35 * t)
        b = int(75 - 45 * t)
        draw.line([(0, y), (W, y)], fill=(r, g, b))

    # Subtle grid lines
    for gx in range(0, W, W // 8):
        draw.line([(gx, 0), (gx, H)], fill=(255, 255, 255, 10), width=1)
    for gy in range(0, H, H // 14):
        draw.line([(0, gy), (W, gy)], fill=(255, 255, 255, 10), width=1)

    # Location label (uses Pillow default if custom font missing)
    try:
        from PIL import ImageFont
        f_big = ImageFont.truetype(str(config.UI_FONT_BOLD_PATH), 60)
        f_sml = ImageFont.truetype(str(config.UI_FONT_PATH), 34)
    except Exception:
        from PIL import ImageFont
        f_big = f_sml = ImageFont.load_default()

    draw.text((W // 2, H // 2 - 55), name.upper(),
              fill=(255, 255, 255), font=f_big, anchor="mm")
    draw.text((W // 2, H // 2 + 18), f"{lat:.4f}°N   {lon:.4f}°E",
              fill=(80, 230, 180), font=f_sml, anchor="mm")

    img.save(str(out))
    logger.warning(f"[MAP] Pillow fallback rendered → {out.name}")


# ─────────────────────────────────────────────
# ZOOM ANIMATION HELPER
# ─────────────────────────────────────────────

def _zoom_clip(img: Path, duration: float, direction: str, out: Path) -> None:
    """
    Create a zoompan animation from a still image.

    direction='in'   → starts wide (1.0x) and zooms to 1.4x
    direction='out'  → starts close (1.4x) and pulls back to 1.0x

    FIX: scale=4000:-1 instead of 8000 — still enough for smooth zoompan
    without blowing RAM on a 1280px input tile.
    """
    frames = int(duration * FPS)

    if direction == "in":
        z_expr = "min(zoom+0.0008,1.4)"
        x_expr = "iw/2-(iw/zoom/2)"
        y_expr = "ih/2-(ih/zoom/2)"
    else:  # "out"
        z_expr = "if(lte(zoom,1.0),1.4,max(1.0,zoom-0.0010))"
        x_expr = "iw/2-(iw/zoom/2)"
        y_expr = "ih/2-(ih/zoom/2)"

    vf = (
        f"scale=4000:-1,"
        f"zoompan="
        f"z='{z_expr}':"
        f"x='{x_expr}':"
        f"y='{y_expr}':"
        f"d={frames}:s={W}x{H}:fps={FPS},"
        f"format=yuv420p"
    )

    subprocess.run([
        "ffmpeg", "-y", "-v", "error",
        "-loop", "1",
        "-t",    str(duration),
        "-i",    str(img),
        "-vf",   vf,
        "-c:v",    config.VIDEO_CODEC,
        "-preset", config.PRESET,
        "-crf",    str(config.CRF),
        "-r",      str(FPS),
        str(out),
    ], check=True, timeout=120)


# ─────────────────────────────────────────────
# PUBLIC API
# ─────────────────────────────────────────────

def render(params: MapEngineParams, block_id: int, duration: float) -> Path:
    """
    Render a country→city zoom animation clip.

    Returns:
        Path to a silent MP4, `duration` seconds long, 1080×1920 30fps.
    """
    out_mp4 = config.TMP_RENDER_DIR / f"block_{block_id:03d}_map.mp4"
    if out_mp4.exists():
        logger.debug(f"[MAP] Block {block_id}: cache hit")
        return out_mp4

    c_zoom = params.country_zoom or config.MAP_COUNTRY_ZOOM    # default 4
    k_zoom = params.city_zoom    or config.MAP_CITY_ZOOM       # default 12

    country_png = config.TMP_RENDER_DIR / f"block_{block_id:03d}_country.png"
    city_png    = config.TMP_RENDER_DIR / f"block_{block_id:03d}_city.png"

    # ── Fetch country tile ─────────────────────────────────────────────────
    logger.info(f"[MAP] Block {block_id}: fetching country tile (zoom={c_zoom})...")
    if not _mapbox(params.lat, params.lon, c_zoom, country_png):
        if not _osm_stitch(params.lat, params.lon, c_zoom, country_png, radius=2):
            _pillow_fallback(params.lat, params.lon, params.location_name, country_png)

    # ── Fetch city tile ────────────────────────────────────────────────────
    logger.info(f"[MAP] Block {block_id}: fetching city tile (zoom={k_zoom})...")
    if not _mapbox(params.lat, params.lon, k_zoom, city_png):
        if not _osm_stitch(params.lat, params.lon, k_zoom, city_png, radius=1):
            _pillow_fallback(params.lat, params.lon, params.location_name, city_png)

    # ── Animate: country zoom-in + city zoom-out ───────────────────────────
    half1 = max(1.0, round(duration / 2, 3))
    half2 = max(1.0, round(duration - half1, 3))

    seg1 = config.TMP_RENDER_DIR / f"block_{block_id:03d}_map_s1.mp4"
    seg2 = config.TMP_RENDER_DIR / f"block_{block_id:03d}_map_s2.mp4"

    logger.info(f"[MAP] Block {block_id}: animating country segment ({half1}s)...")
    _zoom_clip(country_png, half1, "in",  seg1)

    logger.info(f"[MAP] Block {block_id}: animating city segment ({half2}s)...")
    _zoom_clip(city_png,    half2, "out", seg2)

    # ── Concat ─────────────────────────────────────────────────────────────
    concat_txt = config.TMP_RENDER_DIR / f"block_{block_id:03d}_map_concat.txt"
    concat_txt.write_text(
        f"file '{seg1.as_posix()}'\nfile '{seg2.as_posix()}'\n",
        encoding="utf-8",
    )
    subprocess.run([
        "ffmpeg", "-y", "-v", "error",
        "-f", "concat", "-safe", "0",
        "-i", str(concat_txt),
        "-c:v",    config.VIDEO_CODEC,
        "-preset", config.PRESET,
        "-crf",    str(config.CRF),
        "-r",      str(FPS),
        "-pix_fmt", "yuv420p",
        str(out_mp4),
    ], check=True, timeout=60)

    logger.info(f"[MAP] Block {block_id}: done → {out_mp4.name} ({duration:.2f}s)")
    return out_mp4
