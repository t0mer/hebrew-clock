#include <GxEPD2_BW.h>
#include <WiFiManager.h>
#include <Preferences.h>
#include <PNGdec.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <time.h>
#include <Fonts/FreeSansBold18pt7b.h>
#include <Fonts/FreeSans12pt7b.h>
#include <RTClib.h>

// XIAO ESP32C3 → Waveshare 7.5" V2 wiring
#define EPD_CS   D2
#define EPD_DC   D3
#define EPD_RST  D0
#define EPD_BUSY D1

GxEPD2_BW<GxEPD2_750_T7, 16> display(
    GxEPD2_750_T7(EPD_CS, EPD_DC, EPD_RST, -1)
);

static uint8_t pngBuf[30000];
static uint8_t frameBuf[48000];

PNG         png;
Preferences prefs;
WebServer   server(80);

String   imageUrl;
uint32_t refreshInterval  = 60;
uint32_t lastRefresh      = 0;
uint8_t  refreshCount     = 0;
uint8_t  fullRefreshEvery = 10;
String   selectedFont     = "NotoSansHebrew-Bold";
String   location         = "Tel Aviv";

// Sleep schedule (ESP-side only — not sent to server as URL params)
bool     sleepEnabled = false;
String   sleepStart   = "22:00";  // HH:MM 24h
String   sleepEnd     = "06:00";

// Calendar
String calendarType = "gregorian";  // "gregorian" | "jewish"

// RTC
bool       rtcEnabled = false;
RTC_DS3231 rtc;

// ── Time helpers ──────────────────────────────────────

// Returns minutes-from-midnight parsed from "HH:MM"
static int toMinutes(const String& hhmm) {
    return hhmm.substring(0, 2).toInt() * 60 + hhmm.substring(3, 5).toInt();
}

// True when the current local time falls inside the sleep window.
// Handles overnight windows (e.g. 22:00 – 06:00).
bool isInSleepWindow() {
    if (!sleepEnabled) return false;
    struct tm ti;
    if (!getLocalTime(&ti, 0)) return false;
    int now   = ti.tm_hour * 60 + ti.tm_min;
    int start = toMinutes(sleepStart);
    int end   = toMinutes(sleepEnd);
    return (start <= end) ? (now >= start && now < end)
                          : (now >= start || now < end);
}

// Active interval in seconds: 5 min during sleep window, configured otherwise.
uint32_t activeInterval() {
    return isInSleepWindow() ? 300 : refreshInterval;
}

// ── URL helpers ───────────────────────────────────────

String urlEncode(const String& s) {
    String out;
    out.reserve(s.length() * 3);
    for (int i = 0; i < (int)s.length(); i++) {
        char c = s[i];
        if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
            out += c;
        } else {
            char buf[4];
            sprintf(buf, "%%%02X", (unsigned char)c);
            out += buf;
        }
    }
    return out;
}

String buildFetchUrl() {
    String url = imageUrl;
    // Ensure a path exists before the query string ("https://host" → "https://host/")
    int schemeEnd = url.indexOf("://");
    if (schemeEnd >= 0 && url.indexOf('/', schemeEnd + 3) < 0)
        url += "/";
    url += (url.indexOf('?') >= 0) ? "&" : "?";
    url += "font="       + urlEncode(selectedFont);
    url += "&sleeptime=" + String(isInSleepWindow() ? "1" : "0");
    url += "&location="  + urlEncode(location.length() > 0 ? location : "Tel Aviv");
    url += "&calendar="  + calendarType;
    return url;
}

// ── Web config ────────────────────────────────────────

static const char CONFIG_HTML[] PROGMEM = R"(<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ePaper Config</title>
  <style>
    body{font-family:sans-serif;max-width:500px;margin:40px auto;padding:0 16px}
    h2{margin-bottom:24px}
    label{display:block;margin-top:16px;font-size:.9em;color:#555}
    input[type=text],input[type=number],input[type=time],select{
      width:100%;padding:8px;box-sizing:border-box;
      border:1px solid #ccc;border-radius:4px;font-size:1em}
    .row{display:flex;align-items:center;margin-top:16px;gap:10px}
    .row input[type=checkbox]{width:18px;height:18px;margin:0;flex-shrink:0}
    .row span{font-size:.9em;color:#555}
    .sleep-fields{margin-top:0;padding:12px 0 0 28px;display:none}
    .sleep-fields label{margin-top:10px}
    .time-row{display:flex;gap:12px}
    .time-row > div{flex:1}
    button{margin-top:24px;width:100%;padding:10px;background:#333;color:#fff;
      border:none;border-radius:4px;font-size:1em;cursor:pointer}
    button:hover{background:#555}
    .note{font-size:.8em;color:#999;margin-top:4px}
    .saved{color:green;margin-top:12px;display:none}
    hr{margin:24px 0;border:none;border-top:1px solid #eee}
  </style>
</head>
<body>
  <h2>ePaper Configuration</h2>
  <form method="POST" action="/config">

    <label>Image URL</label>
    <input type="text" name="url" value="{{URL}}" placeholder="http://...">

    <label>Font</label>
    <select name="font">{{FONT_OPTIONS}}</select>

    <label>Location</label>
    <input type="text" name="location" value="{{LOCATION}}" placeholder="Tel Aviv">

    <label>Calendar type</label>
    <select name="calendar">
      <option value="gregorian" {{CALENDAR_GREGORIAN}}>Gregorian</option>
      <option value="jewish"    {{CALENDAR_JEWISH}}>Jewish (Hebrew)</option>
    </select>

    <hr>

    <div class="row">
      <input type="checkbox" name="sleep_en" id="sleep_en" value="1" {{SLEEP_EN_CHECKED}}
             onchange="document.getElementById('sf').style.display=this.checked?'block':'none'">
      <span>Enable sleep schedule</span>
    </div>
    <div class="sleep-fields" id="sf">
      <p class="note">During this window the refresh rate is fixed at 5 minutes and the server is told to show the sleep image.</p>
      <div class="time-row">
        <div>
          <label>Sleep start</label>
          <input type="time" name="sleep_start" value="{{SLEEP_START}}">
        </div>
        <div>
          <label>Sleep end</label>
          <input type="time" name="sleep_end" value="{{SLEEP_END}}">
        </div>
      </div>
    </div>

    <hr>

    <label>Refresh interval (seconds, outside sleep window)</label>
    <input type="number" name="interval" value="{{INTERVAL}}" min="1">

    <label>Full refresh every N partial refreshes</label>
    <input type="number" name="full_every" value="{{FULL_EVERY}}" min="0">
    <p class="note">0 = always full refresh</p>

    <hr>

    <div class="row">
      <input type="checkbox" name="rtc_en" id="rtc_en" value="1" {{RTC_EN_CHECKED}}>
      <span>Enable DS3231 RTC module</span>
    </div>
    <p class="note">Wire SDA&rarr;D4, SCL&rarr;D5. On NTP success the RTC is updated; if NTP is unavailable the system clock is restored from the RTC so the sleep schedule keeps working.</p>

    <button type="submit">Save &amp; restart</button>
  </form>
  <p class="saved" id="sv">Saved! Device is restarting...</p>
  <script>
    var cb = document.getElementById('sleep_en');
    document.getElementById('sf').style.display = cb.checked ? 'block' : 'none';
    if(location.search.includes('saved')) document.getElementById('sv').style.display='block';
  </script>
</body>
</html>)";

static const char* FONTS[] = {
    "DavidLibre-Bold", "FrankRuhlLibre-Bold", "FrankRuhlLibre",
    "Heebo-Bold", "NotoSansHebrew-Bold"
};

void handleRoot() {
    String fontOptions;
    for (const char* f : FONTS) {
        fontOptions += "<option value=\"";
        fontOptions += f;
        fontOptions += "\"";
        if (selectedFont == f) fontOptions += " selected";
        fontOptions += ">";
        fontOptions += f;
        fontOptions += "</option>";
    }
    String html = FPSTR(CONFIG_HTML);
    html.replace("{{URL}}",              imageUrl);
    html.replace("{{FONT_OPTIONS}}",     fontOptions);
    html.replace("{{LOCATION}}",           location);
    html.replace("{{CALENDAR_GREGORIAN}}", calendarType == "gregorian" ? "selected" : "");
    html.replace("{{CALENDAR_JEWISH}}",    calendarType == "jewish"    ? "selected" : "");
    html.replace("{{SLEEP_EN_CHECKED}}",   sleepEnabled ? "checked" : "");
    html.replace("{{SLEEP_START}}",      sleepStart);
    html.replace("{{SLEEP_END}}",        sleepEnd);
    html.replace("{{INTERVAL}}",         String(refreshInterval));
    html.replace("{{FULL_EVERY}}",       String(fullRefreshEvery));
    html.replace("{{RTC_EN_CHECKED}}",   rtcEnabled ? "checked" : "");
    server.send(200, "text/html; charset=utf-8", html);
}

void handleConfig() {
    if (server.hasArg("url") && server.arg("url").length() > 0)
        imageUrl = server.arg("url");
    if (server.hasArg("font"))
        selectedFont = server.arg("font");
    if (server.hasArg("location"))
        location = server.arg("location");
    if (server.hasArg("calendar") &&
        (server.arg("calendar") == "gregorian" || server.arg("calendar") == "jewish"))
        calendarType = server.arg("calendar");
    sleepEnabled = server.hasArg("sleep_en");
    rtcEnabled   = server.hasArg("rtc_en");
    if (server.hasArg("sleep_start") && server.arg("sleep_start").length() == 5)
        sleepStart = server.arg("sleep_start");
    if (server.hasArg("sleep_end") && server.arg("sleep_end").length() == 5)
        sleepEnd = server.arg("sleep_end");
    if (server.hasArg("interval") && server.arg("interval").toInt() > 0)
        refreshInterval = (uint32_t)server.arg("interval").toInt();
    if (server.hasArg("full_every"))
        fullRefreshEvery = (uint8_t)server.arg("full_every").toInt();

    prefs.begin("epaper", false);
    prefs.putString("url",         imageUrl);
    prefs.putString("font",        selectedFont);
    prefs.putString("location",    location);
    prefs.putString("calendar",    calendarType);
    prefs.putBool("sleep_en",      sleepEnabled);
    prefs.putString("sleep_start", sleepStart);
    prefs.putString("sleep_end",   sleepEnd);
    prefs.putUInt("interval",      refreshInterval);
    prefs.putUChar("full_every",   fullRefreshEvery);
    prefs.putBool("rtc_en",        rtcEnabled);
    prefs.end();

    Serial.println("Config saved — restarting");
    server.sendHeader("Location", "/?saved");
    server.send(302);
    server.client().stop();
    delay(300);
    ESP.restart();
}

// ── PNG decode callback ───────────────────────────────

int pngDrawCallback(PNGDRAW *pDraw) {
    uint16_t lineRGB[800];
    png.getLineAsRGB565(pDraw, lineRGB, PNG_RGB565_LITTLE_ENDIAN, 0xFFFFFFFF);
    int rowBase = pDraw->y * 100;
    for (int x = 0; x < 800; x++) {
        if (lineRGB[x] < 0x8000)
            frameBuf[rowBase + x / 8] &= ~(0x80 >> (x % 8));
    }
    return 1;
}

// ── Image fetch + display ─────────────────────────────

void fetchAndDisplay() {
    String url = buildFetchUrl();
    Serial.printf("Fetching: %s\n", url.c_str());

    WiFiClientSecure secureClient;
    secureClient.setInsecure();

    HTTPClient http;
    if (!http.begin(secureClient, url)) {
        Serial.println("HTTP begin failed");
        return;
    }

    int code = http.GET();
    if (code != HTTP_CODE_OK) {
        Serial.printf("HTTP error: %d\n", code);
        http.end();
        return;
    }

    int contentLen = http.getSize();
    WiFiClient *stream = http.getStreamPtr();
    int pngLen = 0;

    if (contentLen > 0 && contentLen <= (int)sizeof(pngBuf)) {
        pngLen = stream->readBytes(pngBuf, contentLen);
    } else {
        uint32_t deadline = millis() + 10000;
        while ((http.connected() || stream->available()) && pngLen < (int)sizeof(pngBuf)) {
            int avail = stream->available();
            if (avail > 0) {
                int toRead = min(avail, (int)sizeof(pngBuf) - pngLen);
                pngLen   += stream->readBytes(pngBuf + pngLen, toRead);
                deadline  = millis() + 3000;
            } else if (millis() > deadline) {
                break;
            }
            delay(1);
        }
    }
    http.end();
    Serial.printf("Downloaded %d bytes\n", pngLen);
    if (pngLen == 0) return;

    int rc = png.openRAM(pngBuf, pngLen, pngDrawCallback);
    if (rc != PNG_SUCCESS) { Serial.printf("PNG open error: %d\n", rc); return; }
    if (png.getWidth() != 800 || png.getHeight() != 480) {
        Serial.printf("Wrong dimensions: %dx%d\n", png.getWidth(), png.getHeight());
        png.close(); return;
    }

    memset(frameBuf, 0xFF, sizeof(frameBuf));
    rc = png.decode(NULL, 0);
    png.close();
    if (rc != PNG_SUCCESS) { Serial.printf("PNG decode error: %d\n", rc); return; }

    bool fullRefresh = (fullRefreshEvery == 0) || (refreshCount % fullRefreshEvery == 0);
    display.epd2.writeImage(frameBuf, 0, 0, 800, 480, false, false, false);
    display.epd2.refresh(!fullRefresh);
    display.epd2.powerOff();
    refreshCount++;
    Serial.printf("Display updated (%s refresh)\n", fullRefresh ? "full" : "partial");
}

// ── Info screens ─────────────────────────────────────

static void showTextScreen(const String& title, const String& sub, const String& detail = "") {
    int16_t x1, y1;
    uint16_t w, h;
    display.setFullWindow();
    display.firstPage();
    do {
        display.fillScreen(GxEPD_WHITE);
        display.setTextColor(GxEPD_BLACK);
        display.drawRect(8, 8, 800 - 16, 480 - 16, GxEPD_BLACK);

        display.setFont(&FreeSansBold18pt7b);
        display.getTextBounds(title.c_str(), 0, 0, &x1, &y1, &w, &h);
        display.setCursor((800 - w) / 2, 170);
        display.print(title);

        display.setFont(&FreeSans12pt7b);
        display.getTextBounds(sub.c_str(), 0, 0, &x1, &y1, &w, &h);
        display.setCursor((800 - w) / 2, 265);
        display.print(sub);

        if (detail.length()) {
            display.getTextBounds(detail.c_str(), 0, 0, &x1, &y1, &w, &h);
            display.setCursor((800 - w) / 2, 325);
            display.print(detail);
        }
    } while (display.nextPage());
}

// ── Setup ─────────────────────────────────────────────

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("Starting...");

    display.init(115200, true, 2, false);
    display.setRotation(0);
    display.setFullWindow();
    display.firstPage();
    do { display.fillScreen(GxEPD_WHITE); } while (display.nextPage());
    Serial.println("ePaper initialized");

    WiFiManagerParameter paramUrl("image_url", "Image URL", "", 256);
    WiFiManagerParameter paramMin("refresh_min", "Refresh (seconds)", "60", 5);

    WiFiManager wm;
    wm.addParameter(&paramUrl);
    wm.addParameter(&paramMin);

    wm.setSaveParamsCallback([&]() {
        prefs.begin("epaper", false);
        prefs.putString("url",    String(paramUrl.getValue()));
        prefs.putUInt("interval", (uint32_t)atoi(paramMin.getValue()));
        prefs.end();
    });

    wm.setAPCallback([](WiFiManager *wm) {
        String ssid = wm->getConfigPortalSSID();
        String ip   = WiFi.softAPIP().toString();
        Serial.printf("AP started — SSID: %s  IP: %s\n", ssid.c_str(), ip.c_str());
        showTextScreen("Wi-Fi Setup",
                       "Connect to:  " + ssid,
                       "Then open:   " + ip);
    });

    wm.resetSettings();
    if (!wm.autoConnect("EPaper-Setup")) {
        Serial.println("WiFi failed — restarting");
        ESP.restart();
    }
    Serial.print("WiFi connected, IP: ");
    Serial.println(WiFi.localIP());

    showTextScreen("Connected", WiFi.localIP().toString());
    delay(2000);

    prefs.begin("epaper", true);
    imageUrl         = prefs.getString("url",         "");
    refreshInterval  = prefs.getUInt("interval",      60);
    fullRefreshEvery = prefs.getUChar("full_every",   10);
    selectedFont     = prefs.getString("font",        "NotoSansHebrew-Bold");
    location         = prefs.getString("location",    "Tel Aviv");
    calendarType     = prefs.getString("calendar",    "gregorian");
    sleepEnabled     = prefs.getBool("sleep_en",      false);
    sleepStart       = prefs.getString("sleep_start", "22:00");
    sleepEnd         = prefs.getString("sleep_end",   "06:00");
    rtcEnabled       = prefs.getBool("rtc_en",        false);
    prefs.end();

    // Init RTC if enabled
    bool rtcAvailable = false;
    if (rtcEnabled) {
        if (rtc.begin()) {
            rtcAvailable = true;
            Serial.println("RTC found");
        } else {
            Serial.println("RTC not found — check wiring (SDA→D4, SCL→D5)");
        }
    }

    // Sync time via NTP (Israel timezone with automatic DST)
    configTzTime("IST-2IDT,M3.4.4/26,M10.5.0", "pool.ntp.org");
    Serial.print("NTP sync");
    struct tm ti;
    for (int i = 0; i < 10 && !getLocalTime(&ti, 1000); i++) Serial.print(".");
    bool ntpOk = getLocalTime(&ti, 0);
    Serial.println(ntpOk ? " OK" : " failed");

    if (rtcAvailable) {
        if (ntpOk) {
            // Keep RTC accurate by writing the fresh NTP time to it
            rtc.adjust(DateTime(time(nullptr)));
            Serial.println("RTC synced from NTP");
        } else if (!rtc.lostPower()) {
            // NTP unavailable — restore system clock from RTC
            struct timeval tv = { .tv_sec = (time_t)rtc.now().unixtime(), .tv_usec = 0 };
            settimeofday(&tv, nullptr);
            Serial.println("System time restored from RTC");
        } else {
            Serial.println("RTC lost power — time unreliable");
        }
    } else if (!ntpOk) {
        Serial.println("NTP failed and no RTC — sleep window unavailable");
    }

    Serial.printf("Font: %s  Location: %s\n", selectedFont.c_str(), location.c_str());
    Serial.printf("Sleep: %s  %s – %s\n",
                  sleepEnabled ? "on" : "off", sleepStart.c_str(), sleepEnd.c_str());
    Serial.printf("RTC: %s\n", rtcEnabled ? (rtcAvailable ? "enabled" : "enabled (not found)") : "disabled");

    server.on("/",       HTTP_GET,  handleRoot);
    server.on("/config", HTTP_POST, handleConfig);
    server.begin();
    Serial.printf("Config UI: http://%s/\n", WiFi.localIP().toString().c_str());

    if (imageUrl.length() > 0) {
        fetchAndDisplay();
    } else {
        Serial.println("No URL configured — open the config UI to set one");
    }
    lastRefresh = millis();
}

// ── Loop ──────────────────────────────────────────────

void loop() {
    server.handleClient();

    if (imageUrl.length() > 0 &&
        (millis() - lastRefresh) >= activeInterval() * 1000UL) {
        fetchAndDisplay();
        lastRefresh = millis();
    }
    delay(10);
}
