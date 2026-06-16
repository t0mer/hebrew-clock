import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.clock import VALID_FONTS, DEFAULT_FONT


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_home_returns_200(client):
    resp = client.get("/")
    assert resp.status_code == 200


def test_home_content_type_html(client):
    resp = client.get("/")
    assert "text/html" in resp.headers["content-type"]


def test_home_contains_all_fonts(client):
    resp = client.get("/")
    for font in VALID_FONTS:
        assert font in resp.text


def test_home_default_font_selected(client):
    resp = client.get("/")
    assert f'value="{DEFAULT_FONT}" selected' in resp.text


def test_home_contains_preview_img(client):
    resp = client.get("/")
    assert 'id="preview"' in resp.text


def test_home_contains_url_bar(client):
    resp = client.get("/")
    assert 'id="clock-url"' in resp.text


def test_clock_png_still_works(client):
    resp = client.get("/clock.png")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"


def test_clock_path_still_works(client):
    resp = client.get("/clock")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"


def test_tailwind_css_served(client):
    resp = client.get("/static/tailwind.min.css")
    assert resp.status_code == 200
    assert "text/css" in resp.headers.get("content-type", "")
