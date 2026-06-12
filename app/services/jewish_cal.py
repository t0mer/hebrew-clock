"""Fetch and cache the Jewish (Hebrew) calendar date from hebcal.com."""
import datetime
import httpx
from loguru import logger

_HEBCAL_URL = "https://www.hebcal.com/converter?gd={d}&gm={m}&gy={y}&g2h=1&cfg=json"
_CACHE_TTL_SECONDS = 86400  # date changes at most once per day

_cache: dict[str, dict] = {}

_JEWISH_MONTHS_HE: dict[str, str] = {
    "Nisan":    "בְּנִיסָן",
    "Iyyar":    "בְּאִיָּר",
    "Sivan":    "בְּסִיוָן",
    "Tamuz":    "בְּתַמּוּז",
    "Av":       "בְּאָב",
    "Elul":     "בֶּאֱלוּל",
    "Tishrei":  "בְּתִשְׁרֵי",
    "Cheshvan": "בְּחֶשְׁוָן",
    "Kislev":   "בְּכִסְלֵו",
    "Tevet":    "בְּטֵבֵת",
    "Shvat":    "בִּשְׁבָט",
    "Adar":     "בַּאֲדָר",
    "Adar I":   "בַּאֲדָר א׳",
    "Adar II":  "בַּאֲדָר ב׳",
    "Adar 1":   "בַּאֲדָר א׳",
    "Adar 2":   "בַּאֲדָר ב׳",
}

_HEBREW_DAY_NUMS = [
    "א׳",  "ב׳",  "ג׳",  "ד׳",  "ה׳",  "ו׳",  "ז׳",  "ח׳",  "ט׳",  "י׳",
    "י״א", "י״ב", "י״ג", "י״ד", "ט״ו", "ט״ז", "י״ז", "י״ח", "י״ט", "כ׳",
    "כ״א", "כ״ב", "כ״ג", "כ״ד", "כ״ה", "כ״ו", "כ״ז", "כ״ח", "כ״ט", "ל׳",
]

_H_UNITS   = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"]
_H_TENS    = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"]
_H_HUNDREDS = ["", "ק", "ר", "ש", "ת", "תק", "תר", "תש", "תת", "תתק"]


def _year_to_hebrew(year: int) -> str:
    y = year % 1000
    h, t, u = y // 100, (y % 100) // 10, y % 10
    letters = _H_HUNDREDS[h]
    tu = t * 10 + u
    if tu == 15:
        letters += "טו"
    elif tu == 16:
        letters += "טז"
    else:
        letters += _H_TENS[t] + _H_UNITS[u]
    if len(letters) > 1:
        letters = letters[:-1] + "״" + letters[-1]
    elif len(letters) == 1:
        letters += "׳"
    return letters


async def get_jewish_date(date: datetime.date, client: httpx.AsyncClient) -> str | None:
    """Return 'day month\\nyear' in Hebrew letters, e.g. 'כ״ז בְּסִיוָן\\nתשפ״ו'."""
    key = date.isoformat()
    entry = _cache.get(key, {})
    cached_at = entry.get("time")
    if cached_at and (datetime.datetime.utcnow() - cached_at).total_seconds() < _CACHE_TTL_SECONDS:
        return entry.get("data")

    try:
        url = _HEBCAL_URL.format(d=date.day, m=date.month, y=date.year)
        resp = await client.get(url)
        resp.raise_for_status()
        payload = resp.json()
        hd: int = int(payload["hd"])
        hm: str = payload["hm"]
        hy: int = int(payload["hy"])
        day_str   = _HEBREW_DAY_NUMS[hd - 1]
        month_str = _JEWISH_MONTHS_HE.get(hm, hm)
        year_str  = _year_to_hebrew(hy)
        result    = f"{day_str} {month_str}\n{year_str}"
        _cache[key] = {"data": result, "time": datetime.datetime.utcnow()}
        logger.info("hebcal OK [{}]: {} {} {} → {}", key, hd, hm, hy, result)
        return result
    except Exception as exc:
        logger.warning("hebcal error [{}]: {}", key, exc)
        return entry.get("data")
