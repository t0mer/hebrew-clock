# הוראות פריסה — ספירה לאחור לחגים יהודיים

## מה השתנה
- **הוסרה** תצוגת מזג האוויר מהשעון
- **נוספה** ספירה לאחור לחג היהודי הקרוב (אוטומטית מ-Hebcal)
- **נוספה** אפשרות ספירה לאחור מותאמת אישית דרך הדשבורד
- **Hebrew nikud** מלא על שמות החגים

---

## שלב 1: העלאת קוד ESP32 (Arduino IDE)

1. פתח Arduino IDE
2. File → Open → בחר: `ClaudeProjects/hebrew-clock/sketch/hebclk/hebclk.ino`
3. לחץ Upload (←)
4. לאחר סיום: פתח Serial Monitor (115200 baud) לאימות

**שינויים בקוד ESP32:**
- `daysUntil(isoDate)` — חישוב ימים עד תאריך
- `buildFetchUrl()` — שולח `countdown_label` ו-`countdown_days` לשרת (אם יש אירוע מותאם)
- דשבורד ב-`/` — קטע "Custom Countdown" חדש
- שמירה ב-Preferences — שם האירוע ותאריך נשמרים על Flash

---

## שלב 2: פריסת שרת Python

### אפשרות א — Push לגיטהאב (מומלץ)

**עם GitHub CLI (לאחר `setup-github-login.command`):**
```bash
# הרץ את הסקריפט הזה מ-Terminal:
open ~/ClaudeProjects/hebrew-clock/push-to-github.command
```

**ידנית:**
```bash
# נניח שיש לך clone של https://github.com/imyossihakmon-ai/hebrew-clock
cd /path/to/your/hebrew-clock-fork
git checkout -b feature/holiday-countdown
cp ~/ClaudeProjects/hebrew-clock/app/services/clock.py    app/services/clock.py
cp ~/ClaudeProjects/hebrew-clock/app/services/holidays.py app/services/holidays.py
cp ~/ClaudeProjects/hebrew-clock/app/api/v1/router.py     app/api/v1/router.py
cp ~/ClaudeProjects/hebrew-clock/sketch/hebclk/hebclk.ino sketch/hebclk.ino
git add -A
git commit -m "Replace weather with Jewish holiday countdown + custom event dashboard"
git push origin feature/holiday-countdown
# פתח PR → TheHakmon/hebrew-clock
```

**לאחר ה-PR:** Render יפרוס אוטומטית עם merge.

### אפשרות ב — Push ישיר ל-Render (ללא PR)
אם יש לך גישה ישירה ל-Render:
1. עלה ל-render.com → השירות שלך
2. Manual Deploy מ-branch קיים, או
3. Push 3 קבצים ישירות ל-main:
   - `app/services/clock.py`
   - `app/services/holidays.py`
   - `app/api/v1/router.py`

---

## שלב 3: מיזוג PR #2 (תיקון DHCP)

כניסה לגיטהאב כ-TheHakmon:
https://github.com/TheHakmon/hebrew-clock/pull/2

לחץ "Merge pull request"

---

## שימוש בדשבורד

1. פתח דפדפן → `http://<IP_של_ESP32>/` (ה-IP מופיע ב-Serial Monitor)
2. גלול ל"Custom Countdown (optional)"
3. הכנס שם אירוע (עברית עובד!) ותאריך
4. Submit
5. לאחר שהתאריך עובר — השעון חוזר אוטומטית לחג הקרוב

---

## חגים עם ניקוד (בשרת)

| Hebcal | תצוגה |
|--------|--------|
| Rosh Hashana | רֹאשׁ הַשָּׁנָה |
| Yom Kippur | יוֹם כִּיפּוּר |
| Sukkot | סֻכּוֹת |
| Shmini Atzeret | שְׁמִינִי עֲצֶרֶת |
| Simchat Torah | שִׂמְחַת תּוֹרָה |
| Chanukah | חֲנֻכָּה |
| Tu BiShvat | טוּ בִּשְׁבָט |
| Purim | פּוּרִים |
| Pesach | פֶּסַח |
| Yom HaShoah | יוֹם הַשּׁוֹאָה |
| Yom HaZikaron | יוֹם הַזִּכָּרוֹן |
| Yom HaAtzma'ut | יוֹם הָעַצְמָאוּת |
| Lag BaOmer | לַ"ג בָּעֹמֶר |
| Shavuot | שָׁבוּעוֹת |
| Tisha B'Av | תִּשְׁעָה בְּאָב |

---

## קבצים שהשתנו

```
ClaudeProjects/hebrew-clock/
├── app/
│   ├── api/v1/router.py          ← שונה (ספירה לאחור במקום מזג אוויר)
│   └── services/
│       ├── clock.py              ← שונה (תצוגת ספירה לאחור)
│       └── holidays.py           ← חדש! (שירות Hebcal)
├── sketch/
│   └── hebclk/
│       └── hebclk.ino            ← שונה (דשבורד + daysUntil)
├── push-to-github.command        ← סקריפט push (לחץ פעמיים)
└── DEPLOY_INSTRUCTIONS.md       ← הקובץ הזה
```
