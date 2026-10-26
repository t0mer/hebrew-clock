from pathlib import Path

from fastapi import APIRouter, Request, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, PlainTextResponse, Response
from fastapi.templating import Jinja2Templates

from app.core.config import settings
from app.services import clock, jewish_cal as jewish_cal_svc, holidays as holidays_svc
from app.services import seo as seo_svc

router = APIRouter()

DEFAULT_FONT = clock.DEFAULT_FONT

# Path(__file__) = app/api/v1/router.py  →  .parent×3 = app/
_TEMPLATES = Jinja2Templates(
    directory=str(Path(__file__).parent.parent.parent / "templates")
)


@router.get("/", response_class=HTMLResponse, include_in_schema=False)
async def home(
    request: Request,
    font: str = Query(default=clock.DEFAULT_FONT),
    location: str = Query(default="Tel Aviv"),
    calendar: str = Query(default="gregorian"),
) -> HTMLResponse:
    base_url = str(request.base_url).rstrip("/")
    return _TEMPLATES.TemplateResponse(
        request,
        "index.html",
        {
            "fonts": sorted(clock.VALID_FONTS),
            "default_font": font,
            "default_location": location,
            "default_calendar": calendar,
            "gtag_id": settings.gtag_id,
            "base_url": base_url,
        },
    )


@router.get("/robots.txt", response_class=PlainTextResponse, include_in_schema=False)
async def robots_txt(request: Request) -> PlainTextResponse:
    base_url = str(request.base_url).rstrip("/")
    return PlainTextResponse(seo_svc.generate_robots(base_url))


@router.get("/sitemap.xml", include_in_schema=False)
async def sitemap_xml(request: Request) -> Response:
    base_url = str(request.base_url).rstrip("/")
    return Response(
        content=seo_svc.generate_sitemap(base_url),
        media_type="application/xml",
    )


@router.get(
    "/clock",
    responses={200: {"content": {"image/png": {}}}},
    response_class=Response,
)
@router.get(
    "/clock.png",
    responses={200: {"content": {"image/png": {}}}},
    response_class=Response,
)
async def get_clock(
    request:         Request,
    font:            str = Query(default=DEFAULT_FONT),
    sleeptime:       str = Query(default="0"),
    location:        str = Query(default="Tel Aviv"),   # kept for backward compat, unused
    calendar:        str = Query(default="gregorian"),
    countdown_label: str = Query(default=""),   # override: custom event name
    countdown_days:  int = Query(default=-1),   # override: days until custom event (-1 = auto)
    public:          bool = Query(default=False),  # website version: hide birthdays/anniversary & personal trip
) -> Response:
    # Determine countdown source
    if not public and countdown_label and countdown_days >= 0:
        # ESP32 sent a custom countdown override
        c_label: str | None = countdown_label
        c_days:  int | None = countdown_days
    else:
        # Personal trip override: show ski trip until it ends (Feb 5 2027)
        import datetime as _dt
        _today = clock.get_israel_time().date()
        _trip_start = _dt.date(2027, 1, 29)
        _trip_end   = _dt.date(2027, 2, 5)
        if public:
            c_label = None
            c_days  = None
        elif _today < _trip_start:
            _days_to_trip = (_trip_start - _today).days
            c_label: str | None = "חופשת סנובורד"
            c_days:  int | None = _days_to_trip
        elif _today <= _trip_end:
            # currently on the trip — show nothing special, fall through to holidays
            c_label = None
            c_days  = None
        else:
            c_label = None
            c_days  = None

        if c_label is None:
            # Auto-fetch next Jewish holiday from Hebcal
            holiday = await holidays_svc.get_next_holiday(request.app.state.http_client)
            if holiday:
                c_label, c_days = holiday
            else:
                c_label, c_days = None, None

    # Always show Hebrew date alongside Gregorian
    today = clock.get_israel_time().date()
    jdate = await jewish_cal_svc.get_jewish_date(today, request.app.state.http_client)

    img_bytes = await run_in_threadpool(
        clock.generate_clock_image,
        font_name       = font,
        sleep_time      = sleeptime == "1",
        jewish_date     = jdate,
        countdown_label = c_label,
        countdown_days  = c_days,
        hide_personal   = public,
    )
    return Response(
        content=img_bytes,
        media_type="image/png",
        headers={"Cache-Control": "no-cache"},
    )
