/**
 * Language handling for Sarvam text-to-speech. Pure and dependency-free, so it is also usable
 * from scripts. Sarvam TTS has no auto-detect: every request needs a BCP-47 code from this list.
 */

/** Languages Sarvam can speak, keyed by the ISO 639-1 code the voice planner uses. */
const TTS_CODES: Record<string, string> = {
  en: "en-IN", hi: "hi-IN", bn: "bn-IN", gu: "gu-IN", kn: "kn-IN", ml: "ml-IN",
  mr: "mr-IN", or: "od-IN", od: "od-IN", pa: "pa-IN", ta: "ta-IN", te: "te-IN",
};

/** Writing systems and the TTS-supported languages that use them (first entry is the default). */
const SCRIPTS: { re: RegExp; langs: string[] }[] = [
  { re: /[ऀ-ॿ]/g, langs: ["hi", "mr"] }, // Devanagari (Nepali, Konkani etc. are not supported)
  { re: /[ঀ-৿]/g, langs: ["bn"] },
  { re: /[਀-੿]/g, langs: ["pa"] },
  { re: /[઀-૿]/g, langs: ["gu"] },
  { re: /[଀-୿]/g, langs: ["or"] },
  { re: /[஀-௿]/g, langs: ["ta"] },
  { re: /[ఀ-౿]/g, langs: ["te"] },
  { re: /[ಀ-೿]/g, langs: ["kn"] },
  { re: /[ഀ-ൿ]/g, langs: ["ml"] },
  { re: /[؀-ۿݐ-ݿ]/g, langs: [] }, // Arabic script (Urdu, Sindhi, Kashmiri): no Sarvam voice
];
const LATIN = /[A-Za-zÀ-ɏ]/g;

/** Sarvam TTS code for an ISO 639-1 code ("hi" or "hi-IN"), or null when it has no voice for it. */
export function ttsCode(language: string | null | undefined): string | null {
  const base = (language ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return TTS_CODES[base] ?? null;
}

/**
 * Picks the language to speak `text` in. The text decides, the planner's language is a hint:
 * a reply that fell back to English is spoken as English even if the manager spoke Hindi, and a
 * reply in a script Sarvam can't voice (Urdu) returns null so the caller can show text only.
 */
export function pickSpeechLanguage(text: string, hint?: string | null): string | null {
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  const latin = count(LATIN);
  let best: { langs: string[]; n: number } | null = null;
  for (const s of SCRIPTS) {
    const n = count(s.re);
    if (n > (best?.n ?? 0)) best = { langs: s.langs, n };
  }
  if (!best || latin >= best.n) {
    // Latin text is English. With no letters at all (digits only) the planner's language is the best guess.
    return latin === 0 && hint ? (ttsCode(hint) ?? "en-IN") : "en-IN";
  }
  if (best.langs.length === 0) return null;
  const hinted = (hint ?? "").trim().toLowerCase().split(/[-_]/)[0];
  const lang = best.langs.includes(hinted) ? hinted : best.langs[0];
  return ttsCode(lang);
}

/**
 * Sarvam asks for numbers above four digits to be written with commas ("12,500"), otherwise they
 * can be read digit by digit. Leaves decimals, already-grouped numbers and letter-attached ids alone.
 */
export function prepareForSpeech(text: string): string {
  return text.replace(/(?<![\w.,])\d{5,9}(?![\w]|[.,]\d)/g, (n) => n.replace(/\B(?=(\d{3})+(?!\d))/g, ","));
}
