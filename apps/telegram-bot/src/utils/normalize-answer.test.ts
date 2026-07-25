import { describe, expect, test } from "bun:test";
import { isShortAnswerCorrect, normalizeAnswer } from "./normalize-answer";

const ok = (answer: string, correct: string, keywords: string[] = []) =>
  isShortAnswerCorrect(answer, correct, keywords);

describe("accepts harmless variation", () => {
  test.each([
    // casing / whitespace / punctuation
    ["ELEVATOR", "elevator"],
    ["  elevator  ", "elevator"],
    ["elevator.", "elevator"],
    ["Elevator!", "elevator"],
    ['"elevator"', "elevator"],
    ["co-pilot", "copilot"],
    ["copilot", "co-pilot"],
    ["go-around", "go around"],
    ["air speed", "airspeed"],
    ["cross-wind", "crosswind"],
    // articles and filler
    ["the elevator", "elevator"],
    ["an aileron", "aileron"],
    ["it is the elevator", "elevator"],
    ["the landing gear", "landing gear"],
    // plurals / inflection
    ["speeds", "speed"],
    ["speed", "speeds"],
    ["flaps", "flap"],
    ["boxes", "box"],
    ["bodies", "body"],
    ["valves", "valve"],
    ["sleeves", "sleeve"],
    ["increasing", "increase"],
    ["increased", "increase"],
    // possessives / contractions
    ["pilot's seat", "pilots seat"],
    // accents
    ["Pitôt tube", "pitot tube"],
    // British / American
    ["aluminium", "aluminum"],
    ["centre of gravity", "center of gravity"],
    ["stabiliser", "stabilizer"],
    ["manoeuvre", "maneuver"],
    ["aeroplane", "airplane"],
    // word order
    ["gear landing", "landing gear"],
    ["attack angle of", "angle of attack"],
    // typos
    ["altimiter", "altimeter"],
    ["elevater", "elevator"],
    ["turbulance", "turbulence"],
    ["ailron", "aileron"],
    ["transponer", "transponder"],
    ["hydralic", "hydraulic"],
    ["levator", "elevator"],
    // acronyms
    ["cvr", "cockpit voice recorder"],
    ["cockpit voice recorder", "cvr"],
    ["fdr", "flight data recorder"],
    // aviation abbreviations
    ["rwy", "runway"],
    ["hdg", "heading"],
    ["pax", "passengers"],
    ["undercarriage", "landing gear"],
    // units and numbers
    ["10,000 ft", "10000 feet"],
    ["10000 feet", "10,000 ft"],
    ["250 kts", "250 knots"],
    ["three", "3"],
    ["3", "three"],
  ])("%j matches %j", (answer, correct) => {
    expect(ok(answer, correct)).toBe(true);
  });
});

describe("rejects genuinely different answers", () => {
  test.each([
    // different words
    ["aileron", "elevator"],
    ["rudder", "elevator"],
    ["flaps", "slats"],
    // numbers must be literal
    ["150", "160"],
    ["10", "100"],
    ["250 knots", "260 knots"],
    ["10000 ft", "1000 ft"],
    // opposites
    ["increase", "decrease"],
    ["increasing", "decreasing"],
    ["ascend", "descend"],
    ["climb", "descend"],
    ["extend", "retract"],
    ["above", "below"],
    ["left", "right"],
    ["port", "starboard"],
    ["headwind", "tailwind"],
    ["maximum", "minimum"],
    // negating prefixes
    ["symmetric", "asymmetric"],
    ["symmetrical", "asymmetrical"],
    ["stable", "unstable"],
    ["legal", "illegal"],
    ["possible", "impossible"],
    ["adequate", "inadequate"],
    ["correct", "incorrect"],
    ["ice", "deice"],
    // short words get no typo budget
    ["yaw", "yew"],
    ["gear", "gean"],
    // empty
    ["", "elevator"],
    ["   ", "elevator"],
    ["the", "elevator"],
  ])("%j does not match %j", (answer, correct) => {
    expect(ok(answer, correct)).toBe(false);
  });

  test("negated sentence containing the answer is rejected", () => {
    expect(ok("it is not the elevator", "elevator")).toBe(false);
    expect(ok("never increase power", "increase power")).toBe(false);
  });

  test("rambling answers stop counting past the length cap", () => {
    const rambling = `${"word ".repeat(20)}elevator`;
    expect(ok(rambling, "elevator")).toBe(false);
  });
});

describe("accepted keywords", () => {
  test("any keyword works as a full alternative answer", () => {
    expect(ok("stabilator", "elevator", ["stabilator", "tailplane"])).toBe(true);
    expect(ok("tailplane", "elevator", ["stabilator", "tailplane"])).toBe(true);
  });

  test("keyword alternatives tolerate typos too", () => {
    expect(ok("stabilater", "elevator", ["stabilator"])).toBe(true);
  });

  test("required-term semantics still hold", () => {
    expect(ok("angle of attack", "aoa", ["angle", "attack"])).toBe(true);
  });

  // Pre-existing behaviour, preserved deliberately: a single keyword also counts
  // as a complete alternative answer, so keyword lists are lenient by design.
  test("a lone keyword is accepted as an alternative answer", () => {
    expect(ok("angle", "aoa", ["angle", "attack"])).toBe(true);
  });

  test("no false positive from an unrelated answer", () => {
    expect(ok("rudder", "elevator", ["stabilator", "tailplane"])).toBe(false);
  });
});

describe("normalizeAnswer", () => {
  test("produces a canonical form", () => {
    // Hyphens split into separate tokens; the co-pilot/copilot equivalence is
    // resolved at match time by the squashed comparison, not by this function.
    expect(normalizeAnswer("  The  Co-Pilot's Seats! ")).toBe("co pilot seat");
    expect(normalizeAnswer("10,000 FEET")).toBe("10000 ft");
  });
});
