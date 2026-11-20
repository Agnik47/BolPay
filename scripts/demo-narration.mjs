#!/usr/bin/env node
/**
 * Renders the demo video narration with Sarvam AI text-to-speech.
 *
 *   node scripts/demo-narration.mjs
 *   node scripts/demo-narration.mjs N3 M1        only these clips
 *
 * Reads SARVAM_API_KEY from the environment or .env. Text, model and clip ids live in
 * docs/demo-video/narration.json. Output: demo-assets/audio/narrator and demo-assets/audio/manager
 * (ignored by git) as WAV files, with the measured length of each clip.
 *
 * Environment: NARRATOR_SPEAKER (default: shubh), MANAGER_SPEAKER (default: ritu), SARVAM_TTS_MODEL
 * (default: the model in narration.json), CLIP_LANGUAGE (default: en-IN). Speaker names are lowercase and
 * must exist for the model; the list is in Sarvam's text-to-speech reference.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };
if (existsSync(join(root, ".env"))) {
  for (const l of readFileSync(join(root, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const key = env.SARVAM_API_KEY;
if (!key) throw new Error("SARVAM_API_KEY is not set");
const narratorSpeaker = env.NARRATOR_SPEAKER || "shubh";
const managerSpeaker = env.MANAGER_SPEAKER || "ritu";
const language = env.CLIP_LANGUAGE || "en-IN";

const script = JSON.parse(readFileSync(join(root, "docs/demo-video/narration.json"), "utf8"));
const model = env.SARVAM_TTS_MODEL || script.model;
const only = new Set(process.argv.slice(2));
const jobs = [
  ...script.narrator.map((c) => ({ ...c, speaker: narratorSpeaker, dir: "narrator" })),
  ...script.manager.map((c) => ({ ...c, speaker: managerSpeaker, dir: "manager" })),
].filter((c) => only.size === 0 || only.has(c.id));

/** Length in seconds of a PCM WAV file, from its fmt and data chunks. */
function wavSeconds(buf) {
  let byteRate = 0;
  for (let p = 12; p + 8 <= buf.length; ) {
    const id = buf.toString("latin1", p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === "fmt ") byteRate = buf.readUInt32LE(p + 16);
    if (id === "data") return byteRate ? Math.min(size, buf.length - p - 8) / byteRate : 0;
    p += 8 + size + (size % 2);
  }
  return 0;
}

let chars = 0;
for (const c of jobs) {
  // Square-bracket delivery tags were written for another voice model; Sarvam would read them aloud.
  const text = c.text.replace(/\[[^\]]*\]\s*/g, "").trim();
  const res = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: { "api-subscription-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text, language_code: language, model, speaker: c.speaker }),
  });
  if (!res.ok) {
    console.error(`${c.id}: HTTP ${res.status} ${(await res.text()).slice(0, 220)}`);
    process.exitCode = 1;
    break;
  }
  const { audios } = await res.json();
  if (!Array.isArray(audios) || !audios[0]) {
    console.error(`${c.id}: Sarvam returned no audio`);
    process.exitCode = 1;
    break;
  }
  const audio = Buffer.from(audios[0], "base64");
  const dir = join(root, "demo-assets/audio", c.dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${c.id}.wav`), audio);
  chars += text.length;
  console.log(`${c.id.padEnd(4)} ${wavSeconds(audio).toFixed(1).padStart(5)} s  (${c.dir})`);
}
if (!process.exitCode) console.log(`done: ${jobs.length} clips, ${chars} characters, model ${model}`);
