import defusedxml.ElementTree as ET
import pytest

from app.services.seo import generate_robots, generate_sitemap, SITEMAP_LOCATIONS
from app.services.clock import VALID_FONTS

BASE = "https://example.com"
_NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}


def test_robots_contains_allow():
    assert "Allow: /" in generate_robots(BASE)


def test_robots_contains_sitemap_url():
    assert f"{BASE}/sitemap.xml" in generate_robots(BASE)


def test_sitemap_is_valid_xml():
    ET.fromstring(generate_sitemap(BASE))  # raises DefusedXmlException or ParseError if invalid


def test_sitemap_root_entry():
    root = ET.fromstring(generate_sitemap(BASE))
    locs = [u.findtext("sm:loc", namespaces=_NS) for u in root.findall("sm:url", _NS)]
    assert f"{BASE}/" in locs


def test_sitemap_root_priority():
    root = ET.fromstring(generate_sitemap(BASE))
    for url in root.findall("sm:url", _NS):
        if url.findtext("sm:loc", namespaces=_NS) == f"{BASE}/":
            assert url.findtext("sm:priority", namespaces=_NS) == "1.0"
            return
    pytest.fail("root entry not found")


def test_sitemap_entry_count():
    root = ET.fromstring(generate_sitemap(BASE))
    assert len(root.findall("sm:url", _NS)) == 61


def test_sitemap_all_fonts_present():
    result = generate_sitemap(BASE)
    for font in VALID_FONTS:
        assert font in result


def test_sitemap_all_locations_present():
    result = generate_sitemap(BASE)
    for location in SITEMAP_LOCATIONS:
        assert location.replace(" ", "%20") in result


def test_sitemap_all_calendars_present():
    result = generate_sitemap(BASE)
    assert "calendar=gregorian" in result
    assert "calendar=jewish" in result


def test_sitemap_locations_url_encoded():
    result = generate_sitemap(BASE)
    assert "Tel%20Aviv" in result
    assert "Beer%20Sheva" in result
