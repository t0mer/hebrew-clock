import { describe, expect, it } from "vitest";
import { getIsraelTime, getMode, getTimeLines, normalizeFont, splitPeriod } from "../src/core";

describe("getIsraelTime", () => {
  it("uses UTC+3 in summer months and UTC+2 in winter", () => {
    expect(getIsraelTime(new Date("2026-07-01T10:00:00Z")).hour).toBe(13);
    expect(getIsraelTime(new Date("2026-12-01T10:00:00Z")).hour).toBe(12);
  });
  it("adds the display lag and rolls the date over", () => {
    const t = getIsraelTime(new Date("2026-07-01T20:59:55Z"), 8);
    expect([t.hour, t.minute, t.day, t.month]).toEqual([0, 0, 2, 7]);
    expect(t.isoDate).toBe("2026-07-02");
  });
  it("uses Monday=0 weekdays like Python", () => {
    expect(getIsraelTime(new Date("2026-11-09T10:00:00Z")).weekday).toBe(0); // Monday
    expect(getIsraelTime(new Date("2026-11-15T10:00:00Z")).weekday).toBe(6); // Sunday
  });
});

describe("getTimeLines", () => {
  it("joins hour and minutes on one line when short", () => {
    const lines = getTimeLines(15, 15);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("שָׁלוֹשׁ");
    expect(lines[0]).toContain("וָרֶבַע");
  });
  it("splits into three lines when long", () => {
    expect(getTimeLines(23, 53)).toHaveLength(3);
  });
  it("separates the period word", () => {
    const { timeLines, periodLine } = splitPeriod(getTimeLines(9, 0));
    expect(periodLine).toBe("בַּבֹּקֶר");
    expect(timeLines).toHaveLength(1);
  });
  it("maps 0:xx to twelve", () => {
    expect(getTimeLines(0, 5)[0]).toContain("שְׁתֵּים עֶשְׂרֵה");
  });
});

describe("getMode", () => {
  it("picks night, quiet and day", () => {
    expect(getMode(true, 12, 0)).toBe("night");
    expect(getMode(false, 6, 0)).toBe("quiet");
    expect(getMode(false, 7, 29)).toBe("quiet");
    expect(getMode(false, 7, 30)).toBe("day");
  });
});

describe("normalizeFont", () => {
  it("falls back to the default for unknown fonts", () => {
    expect(normalizeFont("evil/../x")).toBe("NotoSansHebrew-Bold");
    expect(normalizeFont("Heebo-Bold")).toBe("Heebo-Bold");
  });
});
