"""Fetch the next major Jewish holiday from hebcal.com with nikud."""
import datetime
import httpx
from loguru import logger
from app.services import clock as _clock

_CACHE_TTL = 3600 * 6  # refresh every 6 hours
_BACKOFF_TTL = 600      # 10 min backoff after Hebcal failure

# Nikud mapping — longer/more-specific keys MUST come before their prefix
HOLIDAYS_NIKUD: dict[str, str] = {
    "Rosh Hashana II":    "רֹאשׁ הַשָּׁנָה ב׳",
    "Rosh Hashana":       "רֹאשׁ הַשָּׁנָה",
    "Yom Kippur":         "יוֹם כִּיפּוּר",
    "Sukkot II":          "סֻכּוֹת ב׳",
    "Sukkot":             "סֻכּוֹת",
    "Shmini Atzeret":     "שְׁמִינִי עֲצֶרֶת",
    "Simchat Torah":      "שִׂמְחַת תּוֹרָה",
    "Chanukah":           "חֲנֻכָּה",
    "Tu BiShvat":         "ט\"וּ בִּשְׁבָט",
    "Purim":              "פּוּרִים",
    "Shushan Purim":      "שׁוּשַׁן פּוּרִים",
    "Pesach Sheni":       "פֶּסַח שֵׁנִי",
    "Pesach II":          "פֶּסַח ב׳",
    "Pesach":             "פֶּסַח",
    "Lag BaOmer":         "לַ\"ג בָּעֹמֶר",
    "Shavuot II":         "שָׁבוּעוֹת ב׳",
    "Shavuot":            "שָׁבוּעוֹת",
    "Tish'a B'Av":        "תִּשְׁעָה בְּאָב",
    "Yom HaShoah":        "יוֹם הַשּׁוֹאָה",
    "Yom HaZikaron":      "יוֹם הַזִּכָּרוֹן",
    "Yom HaAtzma'ut":     "יוֹם הָעַצְמָאוּת",   # Hebcal spelling
    "Yom HaAtzmaut":      "יוֹם הָעַצְמָאוּת",
    "Yom Yerushalayim":   "יוֹם יְרוּשָׁלַיִם",
    "Rosh Chodesh":       "רֹאשׁ חֹדֶשׁ",
}

def days_text(n: int) -> str:
    if n == 0:
        return "הַיּוֹם!"
    if n == 1:
        return "מָחָר"
    if n == 2:
        return "עוֹד יוֹמַיִם"
    return f"עוֹד {n} יָמִים"


_cache: dict[str, object] = {}


def _nikud_for(title: str) -> str | None:
    """Exact match first, then longest-prefix match — avoids masking second-day holidays."""
    # 1. Exact match
    if title in HOLIDAYS_NIKUD:
        return HOLIDAYS_NIKUD[title]
    # 2. Chanukah variations like "Chanukah: 1 Candle"
    if "Chanukah" in title:
        return HOLIDAYS_NIKUD["Chanukah"]
    # 3. Prefix match (longest key wins)
    best_key, best_nikud = "", None
    for key, nikud in HOLIDAYS_NIKUD.items():
        if (title.startswith(key + ":") or title.startswith(key + " ")) and len(key) > len(best_key):
            best_key, best_nikud = key, nikud
    return best_nikud


async def get_next_holiday(client: httpx.AsyncClient) -> tuple[str, int] | None:
    """
    Return (holiday_name_with_nikud, days_until) for the next major holiday,
    or None if unavailable.
    """
    # Use Israel date to match the clock display
    today = _clock.get_israel_time().date()

    # Check cache (stores holiday date, not raw day count, so it stays accurate past midnight)
    entry = _cache.get("next")
    if entry and isinstance(entry, dict):
        cached_at = entry.get("time")
        cached_date = entry.get("holiday_date")
        if cached_at and (datetime.datetime.utcnow() - cached_at).total_seconds() < _CACHE_TTL:
            if cached_date and cached_date >= today:
                n_days = (cached_date - today).days
                return (entry["nikud"], n_days)
            # cached holiday has passed — fall through to re-fetch

    # Backoff: don't hammer Hebcal after a failure
    backoff = _cache.get("backoff")
    if backoff and (datetime.datetime.utcnow() - backoff).total_seconds() < _BACKOFF_TTL:
        # Return stale data if any, else None
        if entry and isinstance(entry, dict) and entry.get("holiday_date"):
            n_days = (entry["holiday_date"] - today).days
            if n_days >= 0:
                return (entry["nikud"], n_days)
        return None

    all_items: list[dict] = []

    try:
        # Single range request: today → +200 days (avoids month-skip bug and reduces round-trips)
        end_date = today + datetime.timedelta(days=200)
        url = (
            "https://www.hebcal.com/hebcal"
            f"?v=1&cfg=json&maj=on&min=on&mod=on&nx=off&ss=off&mf=off&c=off"
            f"&geo=IL&i=on"
            f"&start={today.isoformat()}&end={end_date.isoformat()}"
        )
        resp = await client.get(url, timeout=8)
        resp.raise_for_status()
        all_items = resp.json().get("items", [])

        all_items.sort(key=lambda x: x.get("date", ""))

        for item in all_items:
            if item.get("category") != "holiday":
                continue
            title = item.get("title", "")
            date_str = item.get("date", "")[:10]
            if not date_str:
                continue
            try:
                holiday_date = datetime.date.fromisoformat(date_str)
            except ValueError:
                continue
            if holiday_date < today:
                continue

            nikud = _nikud_for(title)
            if nikud is None:
                continue

            n_days = (holiday_date - today).days
            _cache["next"] = {
                "nikud": nikud,
                "holiday_date": holiday_date,
                "time": datetime.datetime.utcnow(),
            }
            _cache.pop("backoff", None)
            logger.info("next holiday: {} in {} days ({})", nikud, n_days, date_str)
            return (nikud, n_days)

        logger.warning("no upcoming holiday found in next 200 days")
        return None

    except Exception as exc:
        logger.warning("holiday fetch error: {}", exc)
        _cache["backoff"] = datetime.datetime.utcnow()
        # Return stale cache recomputed against today if available
        if entry and isinstance(entry, dict) and entry.get("holiday_date"):
            hd = entry["holiday_date"]
            if hd >= today:
                return (entry["nikud"], (hd - today).days)
        return None
