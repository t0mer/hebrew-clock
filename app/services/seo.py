import urllib.parse

from app.services.clock import VALID_FONTS

SITEMAP_LOCATIONS = [
    "Tel Aviv", "Jerusalem", "Haifa", "Beer Sheva", "Eilat", "Netanya"
]

_CALENDARS = ["gregorian", "jewish"]

_SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9"


def generate_robots(base_url: str) -> str:
    return (
        "User-agent: *\n"
        "Allow: /\n"
        f"Sitemap: {base_url}/sitemap.xml\n"
    )


def generate_sitemap(base_url: str) -> str:
    entries = [_url_entry(f"{base_url}/", "1.0")]
    for font in sorted(VALID_FONTS):
        for location in SITEMAP_LOCATIONS:
            for calendar in _CALENDARS:
                enc_font = urllib.parse.quote(font, safe="")
                enc_loc = urllib.parse.quote(location, safe="")
                path = f"/?font={enc_font}&location={enc_loc}&calendar={calendar}"
                entries.append(_url_entry(f"{base_url}{path}", "0.8"))
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<urlset xmlns="{_SITEMAP_NS}">\n'
        + "".join(entries)
        + "</urlset>\n"
    )


def _url_entry(loc: str, priority: str) -> str:
    # Escape & to &amp; for valid XML
    escaped_loc = loc.replace("&", "&amp;")
    return (
        "  <url>\n"
        f"    <loc>{escaped_loc}</loc>\n"
        "    <changefreq>daily</changefreq>\n"
        f"    <priority>{priority}</priority>\n"
        "  </url>\n"
    )
