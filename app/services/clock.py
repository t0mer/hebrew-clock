"""Synchronous image-generation service. Runs in a thread-pool worker."""
import datetime
import io
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from loguru import logger

from app.core.config import settings

VALID_FONTS = {
    "DavidLibre-Bold", "FrankRuhlLibre-Bold", "FrankRuhlLibre",
    "Heebo-Bold", "NotoSansHebrew-Bold",
}
DEFAULT_FONT = "NotoSansHebrew-Bold"

# ── Hebrew time tables ────────────────────────────────

HOURS = [
    "אַחַת", "שְׁתַּיִם", "שָׁלוֹשׁ", "אַרְבַּע", "חָמֵשׁ", "שֵׁשׁ",
    "שֶׁבַע", "שְׁמוֹנֶה", "תֵּשַׁע", "עֶשֶׂר", "אַחַת עֶשְׂרֵה", "שְׁתֵּים עֶשְׂרֵה"
]
MINUTE_PREFIX = [
    "", "וְדַקָּה אַחַת", "וּשְׁתֵּי דַקּוֹת", "וְשָׁלוֹשׁ דַקּוֹת",
    "וְאַרְבַּע דַקּוֹת", "וְחָמֵשׁ דַקּוֹת", "וְשֵׁשׁ דַקּוֹת", "וְשֶׁבַע דַקּוֹת",
    "וּשְׁמוֹנֶה דַקּוֹת", "וְתֵשַׁע דַקּוֹת", "וְעֶשֶׂר דַקּוֹת",
    "וְאַחַת עֶשְׂרֵה דַּקּוֹת", "וּשְׁתֵּים עֶשְׂרֵה דַּקּוֹת",
    "וּשְׁלוֹשׁ עֶשְׂרֵה דַּקּוֹת", "וְאַרְבַּע עֶשְׂרֵה דַּקּוֹת",
    "וָרֶבַע", "וְשֵׁשׁ עֶשְׂרֵה דַּקּוֹת", "וּשְׁבַע עֶשְׂרֵה דַּקּוֹת",
    "וּשְׁמוֹנֶה עֶשְׂרֵה דַּקּוֹת", "וּתְשַׁע עֶשְׂרֵה דַּקּוֹת",
    "וְעֶשְׂרִים דַקּוֹת", "וְעֶשְׂרִים וְאַחַת", "וְעֶשְׂרִים וּשְׁתַּיִם",
    "וְעֶשְׂרִים וְשָׁלוֹשׁ", "וְעֶשְׂרִים וְאַרְבַּע", "וְעֶשְׂרִים וְחָמֵשׁ",
    "וְעֶשְׂרִים וְשֵׁשׁ", "וְעֶשְׂרִים וְשֶׁבַע", "וְעֶשְׂרִים וּשְׁמוֹנֶה",
    "וְעֶשְׂרִים וְתֵשַׁע", "וּשְׁלוֹשִׁים", "וּשְׁלוֹשִׁים וְאַחַת",
    "וּשְׁלוֹשִׁים וּשְׁתַּיִם", "וּשְׁלוֹשִׁים וְשָׁלוֹשׁ", "וּשְׁלוֹשִׁים וְאַרְבַּע",
    "וּשְׁלוֹשִׁים וְחָמֵשׁ", "וּשְׁלוֹשִׁים וְשֵׁשׁ", "וּשְׁלוֹשִׁים וְשֶׁבַע",
    "וּשְׁלוֹשִׁים וּשְׁמוֹנֶה", "וּשְׁלוֹשִׁים וְתֵשַׁע", "וְאַרְבָּעִים",
    "וְאַרְבָּעִים וְאַחַת", "וְאַרְבָּעִים וּשְׁתַּיִם", "וְאַרְבָּעִים וְשָׁלוֹשׁ",
    "וְאַרְבָּעִים וְאַרְבַּע", "וְאַרְבָּעִים וְחָמֵשׁ", "וְאַרְבָּעִים וְשֵׁשׁ",
    "וְאַרְבָּעִים וְשֶׁבַע", "וְאַרְבָּעִים וּשְׁמוֹנֶה", "וְאַרְבָּעִים וְתֵשַׁע",
    "וַחֲמִשִּׁים", "וַחֲמִשִּׁים וְאַחַת", "וַחֲמִשִּׁים וּשְׁתַּיִם",
    "וַחֲמִשִּׁים וְשָׁלוֹשׁ", "וַחֲמִשִּׁים וְאַרְבַּע", "וַחֲמִשִּׁים וְחָמֵשׁ",
    "וַחֲמִשִּׁים וְשֵׁשׁ", "וַחֲמִשִּׁים וְשֶׁבַע", "וַחֲמִשִּׁים וּשְׁמוֹנֶה",
    "וַחֲמִשִּׁים וְתֵשַׁע",
]

PERIOD_WORDS = {
    "בַּבֹּקֶר", "בַּצָּהֳרַיִם", "אַחַר הַצָּהֳרַיִם",
    "בָּעֶרֶב", "בַּלַּיְלָה", "לִפְנוֹת בֹּקֶר",
}

MONTHS_HE = [
    "בְּיָנוּאָר", "בְּפֶבְּרוּאָר", "בְּמָרְץ", "בְּאַפְּרִיל",
    "בְּמַאי", "בְּיוּנִי", "בְּיוּלִי", "בְּאוֹגוּסְט",
    "בְּסֶפְּטֶמְבֶּר", "בְּאוֹקְטוֹבֶּר", "בְּנוֹבֶמְבֶּר", "בְּדֶצֶמְבֶּר",
]
DAYS_HE = [
    "יוֹם שֵׁנִי", "יוֹם שְׁלִישִׁי", "יוֹם רְבִיעִי",
    "יוֹם חֲמִישִׁי", "יוֹם שִׁישִּׁי", "שַׁבָּת", "יוֹם רִאשׁוֹן",
]

# ── Helpers ───────────────────────────────────────────

def get_israel_time() -> datetime.datetime:
    from zoneinfo import ZoneInfo
    local = datetime.datetime.now(ZoneInfo("Asia/Jerusalem")).replace(tzinfo=None)
    return local + datetime.timedelta(seconds=settings.display_lag)


def get_font(size: int, font_name: str = DEFAULT_FONT) -> ImageFont.FreeTypeFont:
    name = font_name if font_name in VALID_FONTS else DEFAULT_FONT
    path = settings.font_dir / f"{name}.ttf"
    if path.exists():
        try:
            return ImageFont.truetype(str(path), size)
        except Exception:
            pass
    for fallback in ("NotoSansHebrew-Bold", "FrankRuhlLibre"):
        fb = settings.font_dir / f"{fallback}.ttf"
        if fb.exists():
            try:
                return ImageFont.truetype(str(fb), size)
            except Exception:
                pass
    return ImageFont.load_default()


def _png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.convert("1", dither=Image.Dither.NONE).save(buf, format="PNG", optimize=True)
    buf.seek(0)
    return buf.read()


def _get_time_period(h: int) -> str:
    if 6  <= h < 12: return "בַּבֹּקֶר"
    if 12 <= h < 16: return "בַּצָּהֳרַיִם"
    if 16 <= h < 18: return "אַחַר הַצָּהֳרַיִם"
    if 18 <= h < 21: return "בָּעֶרֶב"
    if 21 <= h < 24: return "בַּלַּיְלָה"
    if 0  <= h < 3:  return "בַּלַּיְלָה"
    return "לִפְנוֹת בֹּקֶר"


def _get_time_lines(h24: int, m: int) -> list[str]:
    h12 = h24 % 12 or 12
    period = _get_time_period(h24)
    mp = MINUTE_PREFIX[m]
    hp = HOURS[h12 - 1]
    if len(hp + mp) > 25:
        return [hp, mp, period]
    return [hp + " " + mp, period]

# ── Drawing ───────────────────────────────────────────

def _draw_weather_icon(draw: ImageDraw.Draw, cx: int, cy: int,
                       icon_key: str, size: int = 38) -> None:
    s = size

    def cloud(ox: int = 0, oy: int = 0, scale: float = 1.0) -> None:
        w, h = int(s * 1.4 * scale), int(s * 0.7 * scale)
        pts = []
        for a in range(180, 361, 8):
            pts.append((ox + cx + int(w / 2 * math.cos(math.radians(a))),
                        oy + cy + int(h / 2 * math.sin(math.radians(a)))))
        for centre, rx, dy in [
            (int(w * 0.25),  int(h * 0.6  * scale), int(h * 0.2)),
            (0,              int(h * 0.75 * scale), int(h * 0.3)),
            (-int(w * 0.25), int(h * 0.55 * scale), int(h * 0.1)),
        ]:
            for a in range(0, 181, 8):
                pts.append((ox + cx + centre + int(rx * math.cos(math.radians(a))),
                            oy + cy - dy     + int(rx * math.sin(math.radians(a)))))
        draw.polygon(pts, fill=255, outline=0)

    if icon_key == "sun":
        r = s // 2
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255, outline=0, width=3)
        for a in range(0, 360, 45):
            rad = math.radians(a)
            draw.line([cx + (r + 4)  * math.cos(rad), cy + (r + 4)  * math.sin(rad),
                       cx + (r + 13) * math.cos(rad), cy + (r + 13) * math.sin(rad)],
                      fill=0, width=3)
    elif icon_key == "sun_cloud":
        sr = s // 3
        scx, scy = cx - s // 3, cy - s // 4
        draw.ellipse([scx - sr, scy - sr, scx + sr, scy + sr], fill=255, outline=0, width=2)
        for a in range(0, 360, 60):
            rad = math.radians(a)
            draw.line([scx + (sr + 3) * math.cos(rad), scy + (sr + 3) * math.sin(rad),
                       scx + (sr + 9) * math.cos(rad), scy + (sr + 9) * math.sin(rad)],
                      fill=0, width=2)
        cloud(s // 5, s // 5, 0.85)
    elif icon_key == "cloud":
        cloud()
    elif icon_key == "cloud_rain":
        cloud(0, -s // 5, 0.9)
        for ox in (-s // 3, -s // 8, s // 8, s // 3):
            draw.line([cx + ox, cy + s // 4, cx + ox - 4, cy + s // 2 + 4], fill=0, width=2)
    elif icon_key == "cloud_snow":
        cloud(0, -s // 5, 0.9)
        for ox in (-s // 3, -s // 8, s // 8, s // 3):
            x, y = cx + ox, cy + s // 3
            for a in (0, 60, 120):
                rad = math.radians(a)
                draw.line([x - 6 * math.cos(rad), y - 6 * math.sin(rad),
                           x + 6 * math.cos(rad), y + 6 * math.sin(rad)],
                          fill=0, width=2)
    elif icon_key == "thunder":
        cloud(0, -s // 4, 0.9)
        pts = [(cx + 4, cy + s // 6), (cx - 6, cy + s // 2),
               (cx + 2, cy + s // 2), (cx - 8, cy + s)]
        draw.line(pts, fill=0, width=3)


def _draw_analog_clock(draw: ImageDraw.Draw, cx: int, cy: int, r: int,
                       h24: int, m: int, font_name: str) -> None:
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=0, width=3)
    for i in range(12):
        angle = math.radians(i * 30 - 90)
        if i % 3 == 0:
            draw.line([cx + (r - 4)  * math.cos(angle), cy + (r - 4)  * math.sin(angle),
                       cx + (r - 12) * math.cos(angle), cy + (r - 12) * math.sin(angle)],
                      fill=0, width=3)
        else:
            draw.line([cx + (r - 4) * math.cos(angle), cy + (r - 4) * math.sin(angle),
                       cx + (r - 9) * math.cos(angle), cy + (r - 9) * math.sin(angle)],
                      fill=0, width=2)
    num_font = get_font(max(12, r // 4), font_name)
    for num, deg in ((12, -90), (3, 0), (6, 90), (9, 180)):
        angle = math.radians(deg)
        draw.text((cx + (r - 18) * math.cos(angle), cy + (r - 18) * math.sin(angle)),
                  str(num), font=num_font, fill=0, anchor="mm")
    h12 = h24 % 12
    hour_angle = math.radians((h12 + m / 60) * 30 - 90)
    draw.line([cx, cy, cx + (r * 0.55) * math.cos(hour_angle),
               cy + (r * 0.55) * math.sin(hour_angle)], fill=0, width=4)
    min_angle = math.radians(m * 6 - 90)
    draw.line([cx, cy, cx + (r * 0.75) * math.cos(min_angle),
               cy + (r * 0.75) * math.sin(min_angle)], fill=0, width=2)
    draw.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=0)

# ── Image generators ──────────────────────────────────

def _generate_night_image(font_name: str) -> bytes:
    W, H = 800, 480
    img = Image.new("L", (W, H), color=0)
    draw = ImageDraw.Draw(img)

    rng = random.Random(42)
    for _ in range(60):
        x = rng.randint(20, W - 20)
        y = rng.randint(20, H - 20)
        size = rng.choice([1, 1, 2, 2, 3])
        draw.ellipse([x - size, y - size, x + size, y + size], fill=255)

    mx, my, mr = 100, 90, 55
    draw.ellipse([mx - mr, my - mr, mx + mr, my + mr], fill=255)
    draw.ellipse([mx - mr + 16, my - mr - 12, mx + mr + 16, my - mr - 12 + mr * 2], fill=0)

    sleeping_path = settings.font_dir / "sleeping.png"
    if sleeping_path.exists():
        try:
            sleeping = Image.open(sleeping_path).convert("L")
            mask = sleeping.point(lambda p: 255 if p < 128 else 0)
            white_lines = Image.new("L", sleeping.size, 255)
            black_bg   = Image.new("L", sleeping.size, 0)
            result = Image.composite(white_lines, black_bg, mask)
            sw, sh = 380, 280
            result = result.resize((sw, sh), Image.LANCZOS)
            mask_r = mask.resize((sw, sh), Image.LANCZOS)
            img.paste(result, (W - sw - 20, (H - sh) // 2), mask=mask_r)
        except Exception as exc:
            logger.warning("sleeping image error: {}", exc)

    text_cx = (W - 380 - 40) // 2
    draw.text((text_cx, H // 2 - 30), "זְמַן לִישׁוֹן",
              font=get_font(72, font_name), fill=255, anchor="mm")
    draw.text((text_cx, H // 2 + 55), "לַיְלָה טוֹב",
              font=get_font(44, font_name), fill=180, anchor="mm")
    return _png_bytes(img)


def _generate_quiet_image(font_name: str) -> bytes:
    W, H = 800, 480
    img = Image.new("L", (W, H), color=255)
    draw = ImageDraw.Draw(img)
    PAD1, PAD2 = 8, 16
    draw.rectangle([PAD1, PAD1, W - PAD1, H - PAD1], outline=0, width=3)
    draw.rectangle([PAD2, PAD2, W - PAD2, H - PAD2], outline=0, width=1)
    draw.text((W // 2, H // 2 - 50), "לֹא לְהָעִיר אַף אֶחָד!",
              font=get_font(72, font_name), fill=0, anchor="mm")
    draw.text((W // 2 - 60, H // 2 + 30), "z", font=get_font(72, font_name), fill=0, anchor="mm")
    draw.text((W // 2,      H // 2 + 20), "z", font=get_font(55, font_name), fill=0, anchor="mm")
    draw.text((W // 2 + 50, H // 2 + 10), "z", font=get_font(38, font_name), fill=0, anchor="mm")
    return _png_bytes(img)



# ── Special dates ─────────────────────────────────────

SPECIAL_DATES = {
    (23, 1): ("מזל טוב סהר", 2017),
    (23, 6): ("מזל טוב ארד", 2022),
    (25, 11): ("מַזָּל טוֹב רוֹנִית", "HEART", "אַתְּ מֻשְׁלֶמֶת!"),
    (1, 12): ("יוֹם נִישׂוּאִין שָׂמֵחַ", "HEART"),
}

def _get_special_event(dt: datetime.datetime):
    """Return (line1, line2) or (line1, line2, line3) if today is a special date, else None."""
    key = (dt.day, dt.month)
    if key in SPECIAL_DATES:
        entry = SPECIAL_DATES[key]
        if len(entry) == 3:
            return entry  # (line1, line2, line3)
        name_line, second = entry
        if isinstance(second, int):
            age = dt.year - second
            return (name_line, f"יום הולדת ה-{age}!")
        else:
            return (name_line, second)
    return None


def _generate_special_image(font_name: str, line1: str, line2: str, line3: str | None = None) -> bytes:
    W, H = 800, 480
    img  = Image.new("L", (W, H), color=255)
    draw = ImageDraw.Draw(img)
    PAD1, PAD2 = 8, 16
    draw.rectangle([PAD1, PAD1, W - PAD1, H - PAD1], outline=0, width=3)
    draw.rectangle([PAD2, PAD2, W - PAD2, H - PAD2], outline=0, width=1)

    def fit(text: str, start: int) -> ImageFont.FreeTypeFont:
        f = get_font(start, font_name)
        while True:
            bbox = draw.textbbox((0, 0), text, font=f)
            if (bbox[2] - bbox[0]) < (W - 40):
                return f
            cur = getattr(f, "size", start)
            if cur <= 30:
                return f
            f = get_font(cur - 4, font_name)

    import math as _math
    def _draw_heart(cx, cy, size):
        pts = []
        for i in range(360):
            t = _math.radians(i)
            x = 16 * _math.sin(t)**3
            y = -(13 * _math.cos(t) - 5 * _math.cos(2*t) - 2 * _math.cos(3*t) - _math.cos(4*t))
            pts.append((cx + x * size / 16, cy + y * size / 16))
        draw.polygon(pts, fill=0)

    f1 = fit(line1, 160)
    if line3 is not None:
        # 3-part layout: line1 top, HEART middle, line3 bottom
        draw.text((W // 2, H // 2 - 130), line1, font=f1, fill=0, anchor="mm")
        _draw_heart(W // 2, H // 2 + 10, 55)
        f3 = fit(line3, 80)
        draw.text((W // 2, H // 2 + 140), line3, font=f3, fill=0, anchor="mm")
    else:
        draw.text((W // 2, H // 2 - 90), line1, font=f1, fill=0, anchor="mm")
        if line2 == "HEART":
            _draw_heart(W // 2, H // 2 + 90, 70)
        else:
            f2 = fit(line2, 100)
            draw.text((W // 2, H // 2 + 80), line2, font=f2, fill=0, anchor="mm")
    return _png_bytes(img)


def generate_clock_image(
    font_name:       str        = DEFAULT_FONT,
    sleep_time:      bool       = False,
    jewish_date:     str | None = None,
    countdown_label: str | None = None,
    countdown_days:  int | None = None,
    hide_personal:   bool       = False,
) -> bytes:
    fn = font_name if font_name in VALID_FONTS else DEFAULT_FONT

    if sleep_time:
        return _generate_night_image(fn)

    now  = get_israel_time()
    h24, m = now.hour, now.minute

    special = None if hide_personal else _get_special_event(now)
    if special:
        return _generate_special_image(fn, special[0], special[1], special[2] if len(special) == 3 else None)

    W, H = 800, 480
    img  = Image.new("L", (W, H), color=255)
    draw = ImageDraw.Draw(img)

    PAD1, PAD2 = 8, 16
    draw.rectangle([PAD1, PAD1, W - PAD1, H - PAD1], outline=0, width=3)
    draw.rectangle([PAD2, PAD2, W - PAD2, H - PAD2], outline=0, width=1)

    lines       = _get_time_lines(h24, m)
    time_lines  = [l for l in lines if l not in PERIOD_WORDS]
    period_line = next((l for l in lines if l in PERIOD_WORDS), "")

    font_large  = get_font(100, fn)
    font_medium = get_font(58,  fn)
    font_small  = get_font(34,  fn)

    clock_cx, clock_cy, clock_r = W // 2, PAD2 + 75, 68
    _draw_analog_clock(draw, clock_cx, clock_cy, clock_r, h24, m, fn)

    text_start_y = clock_cy + clock_r + 15
    text_area_h  = H - 110 - text_start_y
    n            = len(time_lines)
    line_h       = 95
    total_h      = n * line_h
    ty           = max(clock_cy + clock_r + 40,
                       text_start_y + (text_area_h - total_h) // 2 + 10)

    for i, line in enumerate(time_lines):
        f = font_large
        while True:
            bbox = draw.textbbox((0, 0), line, font=f)
            if (bbox[2] - bbox[0]) < (W - 60):
                break
            current_size = getattr(f, "size", 100)
            if current_size <= 40:
                break
            f = get_font(current_size - 6, fn)
        draw.text((W // 2, ty + i * line_h), line, font=f, fill=0, anchor="mm")

    sep_y = H - 120
    draw.line([(PAD2 + 8, sep_y), (W - PAD2 - 8, sep_y)], fill=0, width=1)
    bar_cy    = sep_y + (H - 15 - sep_y) // 2
    bar_left  = PAD2 + 8
    bar_right = W - PAD2 - 8
    bar_width = bar_right - bar_left
    div_x     = bar_left + bar_width // 3
    div_x2    = bar_left + 2 * bar_width // 3
    draw.line([(div_x,  sep_y), (div_x,  H - 15)], fill=0, width=1)
    draw.line([(div_x2, sep_y), (div_x2, H - 15)], fill=0, width=1)

    day_name  = DAYS_HE[now.weekday()]
    if jewish_date and "\n" in jewish_date:
        date_str, year_str = jewish_date.split("\n", 1)
    else:
        date_str = None
        year_str = None
    left_cx = (bar_left + div_x) // 2
    cell_w  = div_x - bar_left - 10

    def _fit_font(text: str, start: int, minimum: int = 18) -> ImageFont.FreeTypeFont:
        f = get_font(start, fn)
        while True:
            bbox = draw.textbbox((0, 0), text, font=f)
            if (bbox[2] - bbox[0]) <= cell_w:
                return f
            cur = getattr(f, "size", start)
            if cur <= minimum:
                return f
            f = get_font(cur - 2, fn)

    # ── Left cell: Gregorian date + Hebrew date ──
    greg_str  = f"{now.day} {MONTHS_HE[now.month - 1]} {now.year}"
    greg_font = _fit_font(greg_str, 34)
    if year_str and date_str:
        heb_full  = date_str + " " + year_str
        heb_font  = _fit_font(heb_full, 28)
        draw.text((left_cx, bar_cy - 18), greg_str, font=greg_font, fill=0, anchor="mm")
        draw.text((left_cx, bar_cy + 18), heb_full,  font=heb_font,  fill=0, anchor="mm")
    else:
        draw.text((left_cx, bar_cy), greg_str, font=greg_font, fill=0, anchor="mm")

    # ── Middle cell: day name + time period ──
    mid_x = (div_x + div_x2) // 2
    if period_line:
        combined      = day_name + " " + period_line
        combined_font = _fit_font(combined, 36)
        draw.text((mid_x, bar_cy), combined, font=combined_font, fill=0, anchor="mm")

    # ── Right cell: countdown to next holiday (or custom event) ──
    if countdown_label is not None and countdown_days is not None:
        right_start = div_x2
        right_end   = W - PAD2 - 8
        right_cx    = (right_start + right_end) // 2
        right_cell_w = right_end - right_start - 10

        def _fit_right(text: str, start: int, minimum: int = 16) -> ImageFont.FreeTypeFont:
            f = get_font(start, fn)
            while True:
                bbox = draw.textbbox((0, 0), text, font=f)
                if (bbox[2] - bbox[0]) <= right_cell_w:
                    return f
                cur = getattr(f, "size", start)
                if cur <= minimum:
                    return f
                f = get_font(cur - 2, fn)

        if countdown_days == 0:
            days_str = "הַיּוֹם!"
        elif countdown_days == 1:
            days_str = "מָחָר"
        elif countdown_days == 2:
            days_str = "עוֹד יוֹמַיִם"
        else:
            days_str = f"עוֹד {countdown_days} יָמִים"

        # Use Latin font for labels that contain non-Hebrew chars (e.g. "Snowboarding ✈")
        _has_latin = any(c.isascii() and c.isalpha() for c in countdown_label)
        if _has_latin:
            _latin_font_path = settings.font_dir / "OpenSans-VariableFont_wdth,wght.ttf"
            _latin_available = _latin_font_path.exists()
            def _fit_latin(text: str, start: int, minimum: int = 14) -> ImageFont.FreeTypeFont:
                try:
                    f = ImageFont.truetype(str(_latin_font_path), start)
                except OSError:
                    return _fit_right(text, start)  # fallback to Hebrew font
                while True:
                    bbox = draw.textbbox((0, 0), text, font=f)
                    if (bbox[2] - bbox[0]) <= right_cell_w:
                        return f
                    cur = f.size if hasattr(f, 'size') else start
                    if cur <= minimum:
                        return f
                    try:
                        f = ImageFont.truetype(str(_latin_font_path), cur - 2)
                    except OSError:
                        return _fit_right(text, cur - 2)
            label_font = _fit_latin(countdown_label, 28)
        else:
            label_font = _fit_right(countdown_label, 34)
        days_font  = _fit_right(days_str, 30)
        draw.text((right_cx, bar_cy - 18), countdown_label, font=label_font, fill=0, anchor="mm")
        draw.text((right_cx, bar_cy + 18), days_str,        font=days_font,  fill=0, anchor="mm")

    return _png_bytes(img)


def log_available_fonts() -> None:
    found = [f for f in VALID_FONTS
             if (settings.font_dir / f"{f}.ttf").exists()]
    if found:
        logger.info("available fonts: {}", ", ".join(sorted(found)))
    else:
        logger.warning("no Hebrew font files found in {}", settings.font_dir)
