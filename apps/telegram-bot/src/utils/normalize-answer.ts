/**
 * Tolerant short-answer grading.
 *
 * Players type answers freehand under time pressure, so we accept anything
 * that unambiguously conveys the right answer:
 *   - casing, accents, punctuation, hyphens, quotes  ("Co-Pilot." → copilot)
 *   - filler words and articles                      ("the elevator" → elevator)
 *   - singular/plural and light verb endings         ("speeds" → speed)
 *   - British/American spellings                     ("aluminium" → aluminum)
 *   - aviation abbreviations                         ("rwy" → runway)
 *   - unit synonyms                                  ("feet" → ft)
 *   - word order                                     ("gear landing" → landing gear)
 *   - acronyms vs expansions                         ("cvr" → cockpit voice recorder)
 *   - ordinary typos, via Damerau-Levenshtein        ("altimiter" → altimeter)
 *
 * Two categories are deliberately NOT forgiven, because forgiving them would
 * change what the player actually said:
 *   - numbers: "150" never matches "160", "10" never matches "100"
 *   - negations / negating prefixes: "symmetric" never matches "asymmetric",
 *     and "not increase" never matches "increase"
 */

// ───────────────────────────── Lookup tables ─────────────────────────────

/** Dropped when the answer still has other content left. Negations are NOT here. */
const STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "or", "to", "for", "in", "on", "at", "as", "by",
  "with", "from", "into", "onto", "is", "are", "was", "were", "be", "been", "being",
  "it", "its", "this", "that", "these", "those", "there", "their", "they", "them",
  "we", "you", "i", "my", "your", "he", "she", "his", "her",
  "called", "named", "known", "answer", "called", "aka", "ie", "eg", "etc",
]);

/** Words that flip meaning — presence on only one side blocks a containment match. */
const NEGATIONS = new Set([
  "not", "no", "never", "none", "neither", "nor", "without", "except", "unless",
  "isnt", "arent", "wasnt", "werent", "dont", "doesnt", "didnt", "wont", "cant",
  "cannot", "shouldnt", "wouldnt", "couldnt", "havent", "hasnt", "hadnt",
]);

/** Aviation shorthand → full words. Expanded before anything else. */
const ABBREVIATIONS: Record<string, string> = {
  acft: "aircraft", ac: "aircraft", aca: "aircraft",
  ap: "autopilot", afcs: "autopilot",
  rwy: "runway", twy: "taxiway", apt: "airport",
  apch: "approach", appr: "approach", app: "approach",
  dep: "departure", arr: "arrival",
  clb: "climb", des: "descent", dsc: "descent",
  spd: "speed", hdg: "heading", alt: "altitude",
  temp: "temperature", press: "pressure", pres: "pressure",
  eng: "engine", engs: "engines", pwr: "power",
  hyd: "hydraulic", elec: "electrical", pneu: "pneumatic",
  pax: "passengers", nav: "navigation", comm: "communication", comms: "communication",
  wx: "weather", vis: "visibility", turb: "turbulence",
  ldg: "landing", tkof: "takeoff", to: "takeoff",
  fwd: "forward", inop: "inoperative",
  qty: "quantity", freq: "frequency", alty: "altitude",
};

/** Multi-word expansions, applied to the whole normalized string. */
const PHRASE_EXPANSIONS: Array<[RegExp, string]> = [
  [/\bundercarriage\b/g, "landing gear"],
  [/\bt\s*o\s*ga\b/g, "takeoff go around"],
  [/\bgo\s*around\b/g, "go around"],
  [/\bangle\s*of\s*attack\b/g, "angle of attack"],
  [/\bnose\s*(up|down)\b/g, "nose $1"],
];

/** British → American, plus a few common misspell-prone variants. */
const SPELLING_VARIANTS: Record<string, string> = {
  colour: "color", behaviour: "behavior", favour: "favor", honour: "honor",
  labour: "labor", vapour: "vapor", harbour: "harbor", neighbour: "neighbor",
  centre: "center", metre: "meter", litre: "liter", fibre: "fiber",
  theatre: "theater", calibre: "caliber",
  aeroplane: "airplane", aluminium: "aluminum", tyre: "tire", kerb: "curb",
  analyse: "analyze", organise: "organize", realise: "realize",
  recognise: "recognize", minimise: "minimize", maximise: "maximize",
  stabiliser: "stabilizer", pressurise: "pressurize", pressurised: "pressurized",
  utilise: "utilize", normalise: "normalize", equalise: "equalize",
  defence: "defense", licence: "license", offence: "offense",
  travelling: "traveling", cancelled: "canceled", fuelled: "fueled",
  modelling: "modeling", signalling: "signaling", levelled: "leveled",
  programme: "program", catalogue: "catalog", dialogue: "dialog",
  manoeuvre: "maneuver", manoeuvring: "maneuvering", manoeuvres: "maneuvers",
  draught: "draft", plough: "plow", storey: "story", sulphur: "sulfur",
  gauge: "gauge", guage: "gauge",
};

/** Unit synonyms → one canonical token. Plurals listed explicitly. */
const UNITS: Record<string, string> = {
  ft: "ft", foot: "ft", feet: "ft",
  kt: "kt", kts: "kt", knot: "kt", knots: "kt",
  nm: "nm", nmi: "nm",
  sm: "sm",
  m: "m", meter: "m", meters: "m", metre: "m", metres: "m",
  km: "km", kilometer: "km", kilometers: "km", kilometre: "km", kilometres: "km",
  deg: "deg", degree: "deg", degrees: "deg",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  kg: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg",
  hpa: "hpa", hectopascal: "hpa", hectopascals: "hpa",
  mb: "mb", millibar: "mb", millibars: "mb",
  inhg: "inhg",
  fpm: "fpm",
  psi: "psi", mph: "mph", kmh: "kmh", kph: "kmh",
  pct: "percent", percent: "percent", percentage: "percent",
};

/** Spelled-out numbers → digits. "second" is omitted: it collides with the time unit. */
const NUMBER_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
  thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17",
  eighteen: "18", nineteen: "19", twenty: "20", thirty: "30", forty: "40",
  fourty: "40", fifty: "50", sixty: "60", seventy: "70", eighty: "80",
  ninety: "90", hundred: "100", thousand: "1000",
  first: "1", third: "3", fourth: "4", fifth: "5", sixth: "6", seventh: "7",
  eighth: "8", ninth: "9", tenth: "10",
};

const IRREGULAR_PLURALS: Record<string, string> = {
  children: "child", men: "man", women: "woman", teeth: "tooth", geese: "goose",
  mice: "mouse", people: "person", criteria: "criterion", phenomena: "phenomenon",
  indices: "index", vertices: "vertex", matrices: "matrix", axes: "axis",
  analyses: "analysis", bases: "basis", crises: "crisis", radii: "radius",
  nuclei: "nucleus", stimuli: "stimulus", media: "medium", formulae: "formula",
  aircraft: "aircraft", series: "series", species: "species",
  // -f/-fe plurals: the generic rules would mangle these.
  leaves: "leaf", knives: "knife", wives: "wife", lives: "life", halves: "half",
  shelves: "shelf", wolves: "wolf", calves: "calf", selves: "self", thieves: "thief",
  loaves: "loaf",
};

/** Opposites that survive typo tolerance and must never be collapsed. */
const ANTONYMS: Array<[string, string]> = [
  ["increase", "decrease"], ["increasing", "decreasing"], ["increased", "decreased"],
  ["ascend", "descend"], ["ascending", "descending"], ["climb", "descend"],
  ["climbing", "descending"], ["extend", "retract"], ["extended", "retracted"],
  ["engage", "disengage"], ["advance", "retard"], ["rich", "lean"],
  ["above", "below"], ["over", "under"], ["max", "min"], ["maximum", "minimum"],
  ["positive", "negative"], ["open", "closed"], ["on", "off"], ["up", "down"],
  ["left", "right"], ["port", "starboard"], ["forward", "aft"],
  ["head", "tail"], ["headwind", "tailwind"], ["windward", "leeward"],
  ["inbound", "outbound"], ["hot", "cold"], ["high", "low"], ["lead", "lag"],
  ["gain", "loss"], ["true", "false"], ["true", "magnetic"], ["yes", "no"],
  ["symmetric", "asymmetric"], ["symmetrical", "asymmetrical"],
  ["clockwise", "counterclockwise"], ["stable", "unstable"],
];

const ANTONYM_KEYS = new Set(ANTONYMS.map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`)));

/** Prefixes that negate or invert a word: "legal" vs "illegal", "ice" vs "deice". */
const NEGATING_PREFIXES = [
  "un", "in", "im", "il", "ir", "non", "dis", "de", "a", "anti", "mis",
  "under", "over", "counter", "sub", "super",
];

// ─────────────────────────── String normalization ───────────────────────────

const DIACRITIC_RANGE = /[̀-ͯ]/g;

/** Lowercase, strip accents/punctuation, unify separators, drop thousands separators. */
function baseNormalize(raw: string): string {
  let s = raw.normalize("NFKD").replace(DIACRITIC_RANGE, "");
  s = s.toLowerCase();
  // Apostrophes vanish so "isn't" → "isnt" and "pilot's" → "pilots".
  s = s.replace(/['‘’‚‛ʼ`]/g, "");
  // "10,000" / "10 000" → "10000" so digit comparison stays reliable.
  s = s.replace(/(\d)[,  ](?=\d{3}(?:\D|$))/g, "$1");
  // Everything else that isn't a letter, digit or space becomes a separator.
  s = s.replace(/[^a-z0-9\s]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of PHRASE_EXPANSIONS) {
    s = s.replace(pattern, replacement);
  }
  return s;
}

/** Regular English pluralisation, reversed. */
function singularize(token: string): string {
  const irregular = IRREGULAR_PLURALS[token];
  if (irregular) return irregular;
  if (token.length <= 3) return token;
  if (/(ss|us|is|as)$/.test(token)) return token;
  if (/ies$/.test(token) && token.length > 4) return `${token.slice(0, -3)}y`;
  if (/(ch|sh|s|x|z)es$/.test(token)) return token.slice(0, -2);
  if (/s$/.test(token)) return token.slice(0, -1);
  return token;
}

/**
 * Dictionary lookup tolerant of typos in the *key* itself — so misspelling
 * the full word "hectopascals" as "hetopasals" still resolves to "hpa"
 * instead of silently skipping straight to a literal, uncorrected token.
 * Uses the same edit-distance budget as tokensMatch; short keys (<=4 chars,
 * budget 0) fall back to exact matching automatically, so units like "ft"
 * or "kg" are unaffected — only the long, typo-prone entries benefit.
 */
function fuzzyDictLookup(token: string, dict: Record<string, string>): string | undefined {
  const exact = dict[token];
  if (exact) return exact;

  let best: string | undefined;
  let bestDist = Infinity;
  for (const key in dict) {
    const shorter = Math.min(token.length, key.length);
    const budget = maxEdits(shorter);
    if (budget === 0) continue; // already tried as an exact match above
    if (Math.abs(token.length - key.length) > budget) continue;
    if (token[0] !== key[0] && shorter < 7) continue;
    const d = editDistance(token, key, budget);
    if (d <= budget && d < bestDist) {
      bestDist = d;
      best = dict[key];
      if (d === 0) break;
    }
  }
  return best;
}

/**
 * Canonical form of a single word. May expand into several words.
 * When `fuzzy` is set, dictionary keys themselves tolerate typos, so a
 * misspelled "hetopasals" can still be recognised as "hectopascals".
 */
function canonicalTokens(token: string, fuzzy: boolean): string[] {
  if (!token) return [];
  const look = (dict: Record<string, string>, key: string) =>
    fuzzy ? fuzzyDictLookup(key, dict) : dict[key];

  const expanded = look(ABBREVIATIONS, token);
  if (expanded) return expanded.split(" ");

  let t = look(SPELLING_VARIANTS, token) ?? token;
  const unit = look(UNITS, t);
  if (unit) return [unit];
  const num = look(NUMBER_WORDS, t);
  if (num) return [num];
  t = singularize(t);
  // Singularizing may reveal a variant/unit ("stabilisers" → "stabiliser").
  t = look(SPELLING_VARIANTS, t) ?? t;
  return [look(UNITS, t) ?? t];
}

/** Full token pipeline. Stopwords are dropped only if content survives. */
function tokenize(raw: string, fuzzy = false): string[] {
  const base = baseNormalize(raw);
  if (!base) return [];
  const tokens = base
    .split(" ")
    .flatMap((token) => canonicalTokens(token, fuzzy))
    .filter(Boolean);
  const content = tokens.filter((t) => !STOPWORDS.has(t));
  return content.length ? content : tokens;
}

/** Kept for backwards compatibility — now returns the fully canonical form. */
export function normalizeAnswer(answer: string): string {
  return tokenize(answer).join(" ");
}

// ──────────────────────────── Typo tolerance ────────────────────────────

/** Damerau-Levenshtein (counts a transposition as one edit), with early exit. */
function editDistance(a: string, b: string, max: number): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (!la) return lb;
  if (!lb) return la;

  let beforePrev: number[] = [];
  let prev: number[] = Array.from({ length: lb + 1 }, (_, j) => j);

  for (let i = 1; i <= la; i++) {
    const cur: number[] = new Array(lb + 1);
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, beforePrev[j - 2]! + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    beforePrev = prev;
    prev = cur;
  }
  return prev[lb]!;
}

/** Edit budget scales with word length; short words must be spelled right. */
function maxEdits(length: number): number {
  if (length <= 4) return 0;
  if (length <= 7) return 1;
  if (length <= 11) return 2;
  return 3;
}

function isNumeric(token: string): boolean {
  return /^\d+$/.test(token);
}

/** True when one word is the other with a negating prefix bolted on. */
function isNegatingVariant(a: string, b: string): boolean {
  const [shortWord, longWord] = a.length <= b.length ? [a, b] : [b, a];
  return NEGATING_PREFIXES.some((p) => longWord === p + shortWord);
}

function areAntonyms(a: string, b: string): boolean {
  return ANTONYM_KEYS.has(a < b ? `${a}|${b}` : `${b}|${a}`);
}

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

/** Index of the single differing character, or -1 if not exactly one. */
function loneDiffIndex(a: string, b: string): number {
  if (a.length !== b.length) return -1;
  let found = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      if (found !== -1) return -1;
      found = i;
    }
  }
  return found;
}

/**
 * Endings that distinguish real terms rather than marking a typo — the
 * chemistry oxyanion series above all (nitrate/nitrite, chlorate/chlorite).
 */
const SUFFIX_ALTERNATIONS = new Set(["ate|ite", "ate|ide", "ide|ite"]);

/**
 * A vowel swapped at the end of a word usually marks a *different word* rather
 * than a typo. Short words are guarded outright; longer ones only when the
 * ending is a known meaningful alternation, so "elevater" → "elevator" and
 * "turbulance" → "turbulence" still count as typos.
 */
function isMeaningfulSuffixSwap(a: string, b: string): boolean {
  const i = loneDiffIndex(a, b);
  if (i === -1) return false;
  if (i < a.length - 3) return false;
  if (!VOWELS.has(a[i]!) || !VOWELS.has(b[i]!)) return false;
  if (Math.min(a.length, b.length) <= 7) return true;
  const endA = a.slice(-3);
  const endB = b.slice(-3);
  return SUFFIX_ALTERNATIONS.has(endA < endB ? `${endA}|${endB}` : `${endB}|${endA}`);
}

/**
 * Same stem, different prefix — exothermic/endothermic, chloride/fluoride,
 * prograde/retrograde. A prefix that is merely an extension of the other
 * (mitoc/mitoch) is an ordinary typo and stays allowed.
 */
function hasDifferingMorpheme(a: string, b: string): boolean {
  let shared = 0;
  while (
    shared < a.length &&
    shared < b.length &&
    a[a.length - 1 - shared] === b[b.length - 1 - shared]
  ) {
    shared++;
  }
  if (shared < 5) return false;
  const prefixA = a.slice(0, a.length - shared);
  const prefixB = b.slice(0, b.length - shared);
  if (!prefixA || !prefixB) return false;
  if (prefixA.startsWith(prefixB) || prefixB.startsWith(prefixA)) return false;
  return true;
}

/** Strips light inflection so "increasing" and "increase" reduce alike. */
function looseStem(token: string): string {
  let t = token;
  const stripped = t.replace(/(ings|ing|ed|es|s)$/, "");
  if (stripped.length >= 3) t = stripped;
  t = t.replace(/e$/, "");
  t = t.replace(/([a-z])\1$/, "$1");
  return t;
}

/**
 * Word-level equality with typo tolerance and meaning guards.
 * `maxOverride` tightens the edit budget for callers that compare whole
 * phrases, where a long string would otherwise buy enough edits to hide a
 * completely different word.
 */
function tokensMatch(a: string, b: string, maxOverride?: number): boolean {
  if (a === b) return true;
  // Numbers are literal: 150 is not 160, 10 is not 100.
  if (isNumeric(a) || isNumeric(b)) return false;
  if (areAntonyms(a, b) || isNegatingVariant(a, b)) return false;
  if (hasDifferingMorpheme(a, b)) return false;
  if (isMeaningfulSuffixSwap(a, b)) return false;
  if (looseStem(a) === looseStem(b)) return true;

  const shorter = Math.min(a.length, b.length);
  let budget = maxEdits(shorter);
  if (maxOverride !== undefined) budget = Math.min(budget, maxOverride);
  if (budget === 0) return false;
  // A different first letter is rarely a typo, so demand a near-perfect match
  // on a word long enough for the rest to carry the evidence.
  if (a[0] !== b[0]) {
    if (shorter < 7) return false;
    budget = Math.min(budget, 1);
  }
  return editDistance(a, b, budget) <= budget;
}

// ───────────────────────────── Answer matching ─────────────────────────────

function digitsOf(tokens: string[]): string[] {
  return tokens.filter(isNumeric);
}

/** Every number on one side must appear on the other, in the same order. */
function numbersAgree(a: string[], b: string[]): boolean {
  const da = digitsOf(a);
  const db = digitsOf(b);
  if (da.length !== db.length) return false;
  return da.every((n, i) => n === db[i]);
}

/** Order-insensitive pairing where each token is consumed at most once. */
function multisetMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const pool = [...b];
  for (const token of a) {
    const idx = pool.findIndex((candidate) => tokensMatch(token, candidate));
    if (idx === -1) return false;
    pool.splice(idx, 1);
  }
  return true;
}

/** "cvr" vs "cockpit voice recorder" — initials of the multi-word side. */
function acronymMatch(single: string[], words: string[]): boolean {
  if (single.length !== 1 || words.length < 2) return false;
  const acronym = single[0]!;
  if (acronym.length < 2 || acronym.length > 6 || isNumeric(acronym)) return false;
  return acronym === words.map((w) => w[0]!).join("");
}

function hasNegation(tokens: string[]): boolean {
  return tokens.some((t) => NEGATIONS.has(t));
}

/** Do two complete answers mean the same thing? */
function answersMatch(userTokens: string[], targetTokens: string[]): boolean {
  if (!userTokens.length || !targetTokens.length) return false;
  if (!numbersAgree(userTokens, targetTokens)) return false;
  if (hasNegation(userTokens) !== hasNegation(targetTokens)) return false;

  if (userTokens.join(" ") === targetTokens.join(" ")) return true;
  if (multisetMatch(userTokens, targetTokens)) return true;
  // Spacing/hyphen differences: "air speed" vs "airspeed". Budget is capped at
  // one edit — this path exists to undo tokenization, not to forgive a word.
  if (tokensMatch(userTokens.join(""), targetTokens.join(""), 1)) return true;
  if (acronymMatch(userTokens, targetTokens)) return true;
  if (acronymMatch(targetTokens, userTokens)) return true;
  return false;
}

/** Is `phrase` present inside `user`, as a contiguous run (or a single word)? */
function phraseAppearsIn(userTokens: string[], phraseTokens: string[]): boolean {
  if (!phraseTokens.length || !userTokens.length) return false;
  if (phraseTokens.length > userTokens.length) return false;
  // A sentence saying "not the elevator" must not count as "elevator".
  if (hasNegation(userTokens) && !hasNegation(phraseTokens)) return false;
  if (!digitsOf(phraseTokens).every((n) => userTokens.includes(n))) return false;

  for (let start = 0; start + phraseTokens.length <= userTokens.length; start++) {
    let ok = true;
    for (let k = 0; k < phraseTokens.length; k++) {
      if (!tokensMatch(userTokens[start + k]!, phraseTokens[k]!)) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

/** Upper bound on how wordy an answer can be before containment stops counting. */
const MAX_CONTAINMENT_TOKENS = 15;

export function isShortAnswerCorrect(
  answer: string,
  correctAnswer?: string | null,
  acceptedKeywords: string[] = [],
): boolean {
  if (!answer || !answer.trim()) return false;

  const alternatives = [correctAnswer, ...acceptedKeywords].filter(
    (value): value is string => Boolean(value && value.trim()),
  );

  const attempt = (fuzzy: boolean): boolean => {
    const userTokens = tokenize(answer, fuzzy);
    if (!userTokens.length) return false;

    // 1. The answer itself, and each keyword treated as a full alternative answer.
    for (const alternative of alternatives) {
      if (answersMatch(userTokens, tokenize(alternative, fuzzy))) return true;
    }

    // 2. Legacy semantics: when keywords are *required* terms, all must appear.
    if (acceptedKeywords.length) {
      const keywordTokenSets = acceptedKeywords
        .filter((k) => k && k.trim())
        .map((k) => tokenize(k, fuzzy))
        .filter((t) => t.length);
      if (
        keywordTokenSets.length &&
        keywordTokenSets.every((k) => phraseAppearsIn(userTokens, k))
      ) {
        return true;
      }
    }

    // 3. The player wrote a sentence that contains the answer.
    if (correctAnswer && userTokens.length <= MAX_CONTAINMENT_TOKENS) {
      if (phraseAppearsIn(userTokens, tokenize(correctAnswer, fuzzy))) return true;
    }

    return false;
  };

  // Strict tokenization first, so ordinary typo tolerance is never disturbed by
  // a dictionary key coincidentally sitting close to the player's word. Only if
  // nothing matches do we retry allowing typos in the dictionary keys as well.
  return attempt(false) || attempt(true);
}
