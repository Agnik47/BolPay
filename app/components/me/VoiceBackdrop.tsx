/** Contour lines for the voice screens' background: deterministic, so server and client render the same thing. */
const PATHS = Array.from({ length: 16 }, (_, i) => {
  const y0 = 40 + i * 52;
  let d = "";
  for (let x = 0; x <= 1240; x += 40) {
    const y = y0 + Math.sin(x / 140 + i * 0.7) * 20 + Math.sin(x / 61 + i * 1.3) * 7;
    d += `${x === 0 ? "M" : "L"}${x} ${y.toFixed(1)} `;
  }
  return d;
});

/** The dark teal backdrop shared by the voice screens: soft radial light and slowly drifting contour lines. */
export function VoiceBackdrop() {
  return (
    <>
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_42%,var(--color-voice-800)_0%,var(--color-voice-900)_48%,var(--color-voice-950)_100%)]" />
      <svg aria-hidden viewBox="0 0 1240 900" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 size-full animate-[voice-drift_46s_ease-in-out_infinite] text-voice-bright opacity-[0.1]">
        {PATHS.map((d, i) => <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth="1" opacity={0.45 + (i % 4) * 0.15} />)}
      </svg>
    </>
  );
}
