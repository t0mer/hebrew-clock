import datetime
import os
import urllib.parse
from loguru import logger
import httpx


CACHE_TTL_SECONDS = 1800
FAIL_BACKOFF_SECONDS = 600

_WTTR_BASE = os.environ.get("WTTR_URL", "https://wttr.in")
_WTTR_URL = _WTTR_BASE.rstrip("/") + "/{loc}?format=j1"

_CODE_TO_ICON: dict[int, str] = {
    113: "sun", 116: "sun_cloud", 119: "cloud", 122: "cloud",
}
_RAIN_CODES  = {176,293,296,299,302,305,308,353,356,359}
_SNOW_CODES  = {179,182,185,227,230,323,326,329,332,335,338,368,371,374,377}
_STORM_CODES = {200,386,389,392,395}

_DESC_MAP = {
    "sun": "שָׁמְשִׁי", "sun_cloud": "מְעֻנָּן חֶלְקִי",
    "cloud": "מְעֻנָּן",  "cloud_rain": "גֶּשֶׁם",
    "cloud_snow": "שֶׁלֶג", "thunder": "סוּפָה",
}

# {location: {"data": dict|None, "time": datetime|None, "last_fail": datetime|None}}
_cache: dict[str, dict] = {}


def _code_to_icon(code: int) -> str:
    if code in _CODE_TO_ICON:
        return _CODE_TO_ICON[code]
    if code in _RAIN_CODES:
        return "cloud_rain"
    if code in _SNOW_CODES:
        return "cloud_snow"
    if code in _STORM_CODES:
        return "thunder"
    return "cloud"


async def get_weather(location: str, client: httpx.AsyncClient) -> dict | None:
    now = datetime.datetime.utcnow()
    entry = _cache.get(location, {})

    cached_at = entry.get("time")
    if cached_at and (now - cached_at).total_seconds() < CACHE_TTL_SECONDS:
        return entry.get("data")

    failed_at = entry.get("last_fail")
    if failed_at and (now - failed_at).total_seconds() < FAIL_BACKOFF_SECONDS:
        return entry.get("data")

    try:
        url = _WTTR_URL.format(loc=urllib.parse.quote(location))
        resp = await client.get(url, headers={"User-Agent": "curl/7.68.0"})
        resp.raise_for_status()
        cc = resp.json()["current_condition"][0]
        temp = round(float(cc["temp_C"]))
        icon = _code_to_icon(int(cc["weatherCode"]))
        result = {"temp": temp, "icon_key": icon, "desc": _DESC_MAP.get(icon, "מְעֻנָּן")}
        _cache[location] = {"data": result, "time": now, "last_fail": None}
        logger.info("weather OK [{}]: {}°C {}", location, temp, icon)
        return result
    except Exception as exc:
        logger.warning("weather error [{}]: {}", location, exc)
        _cache.setdefault(location, {})["last_fail"] = now
        return _cache[location].get("data")
