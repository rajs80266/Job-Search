import { describe, expect, it } from "vitest";
import { PROFILE_PATH } from "../../src/config";
import { parseLocation } from "../../src/lib/location";
import { loadProfile } from "../../src/profile/store";
import { compileProfile } from "../../src/scoring/compile-profile";

const profile = compileProfile(loadProfile(PROFILE_PATH));
const parse = (raw: string, indiaFiltered = false) => parseLocation(raw, indiaFiltered, profile);

describe("parseLocation", () => {
  it("maps aliases to canonical city names", () => {
    expect(parse("Bangalore, KA")).toEqual({
      cities: ["Bengaluru"],
      isIndia: true,
      isRemote: false,
    });
  });

  it("returns every matched city in profile order", () => {
    expect(parse("Gurgaon (NCR)").cities).toEqual(["Delhi NCR", "Gurugram"]);
    expect(parse("Mumbai | Bengaluru").cities).toEqual(["Bengaluru", "Mumbai"]);
  });

  it("is India when any part of a multi-location string is India", () => {
    const location = parse("London, United Kingdom | Bengaluru, India");

    expect(location.isIndia).toBe(true);
    expect(location.cities).toEqual(["Bengaluru"]);
  });

  it("recognizes India without a city", () => {
    expect(parse("India")).toEqual({ cities: [], isIndia: true, isRemote: false });
    expect(parse("Karnataka").isIndia).toBe(true);
  });

  it("does not treat words that merely contain an India term as India", () => {
    expect(parse("Indianapolis, IN").isIndia).toBe(false);
  });

  it("adds Remote to cities and treats remote India and remote APAC as India", () => {
    expect(parse("Remote - India")).toEqual({
      cities: ["Remote"],
      isIndia: true,
      isRemote: true,
    });
    expect(parse("Remote – APAC").isIndia).toBe(true);
  });

  it("does not treat bare, US or EMEA remote as India", () => {
    expect(parse("Remote").isIndia).toBe(false);
    expect(parse("Remote - US").isIndia).toBe(false);
    expect(parse("Remote - EMEA").isIndia).toBe(false);
  });

  it("does not treat a named foreign country as India, even with a shared city or region word", () => {
    expect(parse("Taguig, NCR, Philippines").isIndia).toBe(false);
    expect(parse("Hyderabad, Pakistan")).toEqual({ cities: [], isIndia: false, isRemote: false });
    expect(parse("Delhi, NY, USA").isIndia).toBe(false);
    expect(parse("Remote (Asia - Japan)").isIndia).toBe(false);
    expect(parse("Remote - Anywhere in the US").isIndia).toBe(false);
  });

  it("does not read 'anywhere' in 'Work from anywhere' as a region that includes India", () => {
    expect(parse("Work from anywhere").isIndia).toBe(false);
    expect(parse("Work from anywhere, United States").isIndia).toBe(false);
    expect(parse("Remote - Anywhere").isIndia).toBe(true);
  });

  it("judges each place of a multi-location string on its own", () => {
    expect(parse("Pune | Singapore")).toEqual({ cities: ["Pune"], isIndia: true, isRemote: false });
    expect(parse("Hyderabad, Pakistan | Bengaluru").cities).toEqual(["Bengaluru"]);
    expect(parse("Hyderabad, Pakistan | Remote - US")).toEqual({
      cities: ["Remote"],
      isIndia: false,
      isRemote: true,
    });
  });

  it("an India term beats a foreign country in the same place", () => {
    expect(parse("Bengaluru, India (supports Singapore)").isIndia).toBe(true);
  });

  it("does not treat hybrid as remote", () => {
    expect(parse("Pune (Hybrid)")).toMatchObject({ isRemote: false, cities: ["Pune"] });
  });

  it("forces isIndia when the request was already restricted to India", () => {
    expect(parse("2 Locations", true)).toEqual({ cities: [], isIndia: true, isRemote: false });
  });

  it("is not India for other countries or an empty location", () => {
    expect(parse("Singapore").isIndia).toBe(false);
    expect(parse("").isIndia).toBe(false);
  });
});
