/**
 * Deterministic amount detection in a transcript, used to cross-check what the model extracted.
 * A misheard or mis-extracted amount (2,000 vs 20,000) must never be silently accepted, so the model's
 * number is only trusted when it agrees with a number actually present in the words, or the worker
 * confirms it on screen. Handles Latin, Bengali and Devanagari digits and "<n> thousand" in English,
 * Hindi and Bengali for n up to ten.
 */

const DIGIT_BLOCKS: [number, number][] = [[0x09e6, 0x09ef], [0x0966, 0x096f]]; // Bengali, Devanagari

export function toAsciiDigits(s: string): string {
  return [...s].map((ch) => {
    const c = ch.codePointAt(0)!;
    for (const [lo, hi] of DIGIT_BLOCKS) if (c >= lo && c <= hi) return String(c - lo);
    return ch;
  }).join("");
}

const SMALL: Record<string, number> = {
  // English
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  // Hindi (Latin and Devanagari)
  ek: 1, do: 2, teen: 3, char: 4, paanch: 5, panch: 5, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10,
  "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5, "छह": 6, "सात": 7, "आठ": 8, "नौ": 9, "दस": 10,
  // Bengali
  "এক": 1, "দু": 2, "দুই": 2, "তিন": 3, "চার": 4, "পাঁচ": 5, "ছয়": 6, "সাত": 7, "আট": 8, "নয়": 9, "দশ": 10,
};
const THOUSAND = new Set(["thousand", "hazar", "hazaar", "hajar", "हज़ार", "हजार", "হাজার"]);

export function detectAmounts(text: string): number[] {
  const t = toAsciiDigits(text).toLowerCase().replace(/(?<=\d),(?=\d)/g, "").replace(/[,₹]/g, " ").replace(/\s+/g, " ");
  const found = new Set<number>();
  const t2 = t.replace(/(\d+)\.(\d+)k\b/g, (_, w: string, f: string) => String(Math.round(Number(`${w}.${f}`) * 1000)));
  const tokens = t2.split(/[\s.;:!?()"'।]+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const next = tokens[i + 1];
    // "2k" / "2.5k" shorthand, common when typing Romanised Hindi or Bengali.
    const k = /^(\d+(?:\.\d+)?)k$/.exec(tok);
    if (k) {
      const v = Math.round(Number(k[1]) * 1000);
      if (v >= 1 && v <= 1_000_000) found.add(v);
      continue;
    }
    const n = /^\d+$/.test(tok) ? Number(tok) : SMALL[tok];
    if (n !== undefined && next && THOUSAND.has(next)) {
      found.add(n * 1000);
      i++;
    } else if (/^\d+$/.test(tok)) {
      const v = Number(tok);
      if (v >= 1 && v <= 1_000_000) found.add(v);
    } else if (THOUSAND.has(tok) && !(tokens[i - 1] && (/^\d+$/.test(tokens[i - 1]) || SMALL[tokens[i - 1]] !== undefined))) {
      found.add(1000);
    }
  }
  return [...found];
}

/** Decide which amount to offer the worker, and whether to warn that the sources disagree. */
export function reconcileAmount(modelAmount: number | null, text: string, modelRan = false): { amount: number | null; source: "model" | "transcript" | "none"; mismatch: boolean } {
  const detected = detectAmounts(text);
  const model = modelAmount !== null && Number.isInteger(modelAmount) && modelAmount > 0 ? modelAmount : null;
  if (model !== null) {
    if (detected.length === 0 || detected.includes(model)) return { amount: model, source: "model", mismatch: false };
    return { amount: null, source: "none", mismatch: true }; // the model's number isn't in the words: make the worker type it
  }
  // The model read the message and found no clear amount ("maybe two or three thousand"): never guess one from the words.
  // Only when the model was unavailable is a single number in the words offered, and the worker confirms it on screen.
  if (!modelRan && detected.length === 1) return { amount: detected[0], source: "transcript", mismatch: false };
  return { amount: null, source: "none", mismatch: false };
}
