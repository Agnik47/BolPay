/** Shared by the emergency-advance card and the full-screen voice screen. */

export interface Preview {
  transcript: string; englishTranslation: string | null; translationFailed: boolean; urgency: "urgent" | "normal"; language: string; amount: number | null; amountMismatch: boolean;
  modelAvailable: boolean; reasonCategory: string; summary: string; readBack: string | null; available: number; blocks: string[]; source: "voice" | "text";
}

export const LANGS: Record<string, string> = { bn: "Bengali", hi: "Hindi", kn: "Kannada", mr: "Marathi", ta: "Tamil", te: "Telugu", gu: "Gujarati", ml: "Malayalam", pa: "Punjabi", en: "English" };

// What the worker can pick before speaking. "auto" lets Sarvam detect it. Hinglish is transcribed as Hindi.
export const PICKER: { code: string; label: string; name: string }[] = [
  { code: "auto", label: "Auto", name: "Detect my language" },
  { code: "bn-IN", label: "বাংলা", name: "Bengali" },
  { code: "hi-IN", label: "हिंदी", name: "Hindi / Hinglish" },
  { code: "kn-IN", label: "ಕನ್ನಡ", name: "Kannada" },
  { code: "mr-IN", label: "मराठी", name: "Marathi" },
  { code: "ta-IN", label: "தமிழ்", name: "Tamil" },
  { code: "te-IN", label: "తెలుగు", name: "Telugu" },
  { code: "en-IN", label: "English", name: "English" },
];
export const LANG_KEY = "bolpay.advance.language";
export const JSON_HEADERS = { "Content-Type": "application/json" };

export async function api<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    return res.ok ? { ok: true, data } : { ok: false, error: data.error ?? "Something went wrong. Please try again." };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return { ok: false, error: "aborted" };
    return { ok: false, error: "Could not reach the server. Check your connection and try again." };
  }
}
