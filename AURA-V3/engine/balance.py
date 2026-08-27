"""
BYOP Balance Probe
Sends a minimal 1-word TTS request to verify Pollinations BYOP credits
are available BEFORE attempting full script generation.
Result is cached per-process so we only probe once per server run.
"""

import logging
import urllib.error
import urllib.parse
import urllib.request
from config import POLLINATIONS_BYOP_KEY, TTS_MODEL, TTS_TIMEOUT_S

logger = logging.getLogger("aura.balance")

_cache: dict[str, bool] = {}   # {"byop": True/False} — per-process cache


def byop_has_credits(force_recheck: bool = False) -> bool:
    """
    Returns True if BYOP key appears to have credits.
    Returns False if 403 is returned (balance depleted or key invalid).
    Returns True (optimistic) if BYOP key is not configured — let the
    real request decide.

    force_recheck=True clears the cache (use after top-up).
    """
    if not POLLINATIONS_BYOP_KEY:
        logger.info("[BALANCE] No BYOP key configured — skipping probe, using free tier.")
        return False

    if not force_recheck and "byop" in _cache:
        result = _cache["byop"]
        if result:
            logger.info("[BALANCE] Checking balance... balance > 0.04 pollen, check done.")
        else:
            logger.info("[BALANCE] Checking balance... balance < 0.04 pollen. Skipping and storing state to warehouse.")
        return result

    # Hit the explicit Pollinations Account Balance endpoint
    url = "https://enter.pollinations.ai/api/account/balance"
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {POLLINATIONS_BYOP_KEY}",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    try:
        import json
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
            bal = data.get("balance", 0.0)

        logger.info(f"[BALANCE] Checking balance... current pollen: {bal}")
        
        if bal > 0.04:
            _cache["byop"] = True
            logger.info("[BALANCE] balance > 0.04 pollen, check done.")
            return True
        else:
            _cache["byop"] = False
            logger.info("[BALANCE] balance <= 0.04 pollen. Skipping and storing state to warehouse.")
            return False

    except urllib.error.HTTPError as e:
        if e.code == 401 or e.code == 403:
            _cache["byop"] = False
            logger.info("[BALANCE] Invalid or depleted key. balance < 0.04 pollen. Skipping...")
            return False
        logger.warning(f"[BALANCE] Balance API HTTP {e.code} — assuming OK, proceeding.")
        _cache["byop"] = True
        return True

    except Exception as ex:
        logger.warning(f"[BALANCE] Balance API failed ({type(ex).__name__}) — assuming OK.")
        _cache["byop"] = True
        return True


def invalidate_cache():
    """Call this after a successful top-up so next probe re-checks."""
    _cache.clear()
    logger.info("[BALANCE] Cache cleared — next call will re-probe.")
