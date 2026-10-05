import { describe, expect, it } from "vitest";
import { isIsoDate, isValidTimeZone, localNoonToIso, toLocalDate, toUtcDate } from "./dates";

describe("isIsoDate", () => {
  it("accepts real dates only", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2023-02-29")).toBe(false);
    expect(isIsoDate("2024-13-01")).toBe(false);
    expect(isIsoDate("2024-1-01")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });
});

describe("isValidTimeZone", () => {
  it("rejects unknown zones", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
  });
});

describe("toLocalDate / toUtcDate", () => {
  it("uses the user's calendar day, not UTC's", () => {
    const iso = "2024-01-01T03:00:00.000Z";
    expect(toUtcDate(iso)).toBe("2024-01-01");
    expect(toLocalDate(iso, "America/Los_Angeles")).toBe("2023-12-31");
    expect(toLocalDate(iso, "Asia/Tokyo")).toBe("2024-01-01");
  });
});

describe("localNoonToIso", () => {
  it("returns noon in the given zone", () => {
    expect(localNoonToIso("2024-07-04", "UTC")).toBe("2024-07-04T12:00:00.000Z");
    expect(localNoonToIso("2024-07-04", "America/Los_Angeles")).toBe("2024-07-04T19:00:00.000Z");
    expect(localNoonToIso("2024-01-04", "America/Los_Angeles")).toBe("2024-01-04T20:00:00.000Z");
    expect(localNoonToIso("2024-01-04", "Asia/Kolkata")).toBe("2024-01-04T06:30:00.000Z");
    expect(localNoonToIso("2024-01-04", "Pacific/Kiritimati")).toBe("2024-01-03T22:00:00.000Z");
  });

  it("always lands on the same local day, including DST change days", () => {
    const zones = [
      "UTC",
      "America/Los_Angeles",
      "America/St_Johns",
      "Europe/London",
      "Australia/Lord_Howe",
      "Pacific/Auckland",
      "Pacific/Pago_Pago",
      "Pacific/Kiritimati",
    ];
    const dates = [
      "2024-03-10",
      "2024-03-31",
      "2024-04-07",
      "2024-09-29",
      "2024-11-03",
      "2024-12-31",
    ];
    for (const tz of zones) {
      for (const d of dates) {
        expect(toLocalDate(localNoonToIso(d, tz), tz)).toBe(d);
      }
    }
  });

  it("rejects malformed dates", () => {
    expect(() => localNoonToIso("04/07/2024", "UTC")).toThrow();
  });
});
