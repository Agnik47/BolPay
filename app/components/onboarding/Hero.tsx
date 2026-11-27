"use client";

import gsap from "gsap";
import { useEffect, useRef } from "react";
import { CAST, Coin, Mic, Person, type PersonProps } from "./art";

/** Scene coordinates. The viewBox is wider than the main action so the ground runs off both edges. */
const VIEW = { x: -300, w: 1600, h: 520 };
const MIC = { x: 500, y: 255 }; // where the voice (and the money) leaves from

// The street's horizon: a big ellipse. People stand on it, so their feet sit lower toward the edges.
const GROUND = { cx: 500, cy: 1310, rx: 2000, ry: 900 };
const horizonAt = (x: number) => GROUND.cy - GROUND.ry * Math.sqrt(Math.max(0, 1 - ((x - GROUND.cx) / GROUND.rx) ** 2));

const PEOPLE: { x: number; s: number; who: PersonProps; amount: string }[] = [
  { x: -10, s: 0.72, who: CAST.rider, amount: "₹850" },
  { x: 118, s: 0.84, who: CAST.aunty, amount: "₹900" },
  { x: 258, s: 0.96, who: CAST.builder, amount: "₹1,100" },
  { x: 550, s: 0.96, who: CAST.worker, amount: "₹800" },
  { x: 714, s: 0.84, who: CAST.didi, amount: "₹950" },
  { x: 866, s: 0.72, who: CAST.shopkeeper, amount: "₹700" },
];

/** Where a person stands: their box, and the spot on their chest the coin flies to. */
function place(p: { x: number; s: number }) {
  const w = 200 * p.s;
  const h = 220 * p.s;
  const y = horizonAt(p.x + w / 2) - h * 0.82;
  return { w, h, y, cx: p.x + w / 2, chest: y + h * 0.7 };
}

const LINES = [
  { lang: "EN", text: "Pay everyone for this week" },
  { lang: "हिं", text: "सबको इस हफ़्ते की सैलरी दे दो" },
  { lang: "ಕನ್ನ", text: "ಎಲ್ಲರಿಗೂ ಈ ವಾರದ ಸಂಬಳ ಕೊಡಿ" },
];

/**
 * The welcome scene. One loop, about six seconds: you speak, sound rings leave the mic, rupee coins fly out to
 * everyone on the street, and each person lights up with their amount. It is the product in one picture.
 * Reduced motion gets the finished frame, standing still.
 */
export function Hero() {
  const svg = useRef<SVGSVGElement>(null);
  const quote = useRef<HTMLSpanElement>(null);
  const tag = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const q = quote.current!;
    const t = tag.current!;
    const sizes = PEOPLE.map((p) => {
      const { cx, chest } = place(p);
      return { cx, cy: chest };
    });

    if (reduce) {
      q.textContent = LINES[0].text;
      t.textContent = LINES[0].lang;
      gsap.set("[data-chip]", { opacity: 1, scale: 1, transformOrigin: "50% 100%" });
      return;
    }

    let line = 0;
    let typing: gsap.core.Tween | null = null; // created later by the timeline, so not tracked by ctx
    const ctx = gsap.context(() => {
      gsap.set("[data-coin]", { opacity: 0 });
      gsap.set("[data-chip]", { opacity: 0, scale: 0.4, transformOrigin: "50% 100%" });
      gsap.set("[data-glow]", { opacity: 0, scale: 0.6, transformOrigin: "50% 50%" });
      gsap.set("[data-ring]", { opacity: 0, attr: { r: 60 } });

      const type = (text: string, lang: string) => {
        t.textContent = lang;
        const o = { n: 0 };
        typing?.kill();
        return (typing = gsap.to(o, {
          n: text.length,
          duration: Math.min(1.5, text.length * 0.045),
          ease: "none",
          onUpdate: () => {
            q.textContent = text.slice(0, Math.round(o.n));
          },
        }));
      };

      const flight = (i: number) => {
        const { cx, cy } = sizes[i];
        const p0 = { x: MIC.x, y: MIC.y };
        const p2 = { x: cx, y: cy };
        const p1 = { x: (p0.x + p2.x) / 2, y: Math.min(p0.y, p2.y) - 170 - Math.abs(cx - MIC.x) * 0.12 };
        const coin = `[data-coin="${i}"]`;
        const prog = { v: 0 };
        const tl = gsap.timeline();
        tl.set(coin, { opacity: 1 });
        tl.to(prog, {
          v: 1,
          duration: 1.05,
          ease: "power2.inOut",
          onUpdate: () => {
            const u = prog.v;
            const x = (1 - u) ** 2 * p0.x + 2 * (1 - u) * u * p1.x + u * u * p2.x;
            const y = (1 - u) ** 2 * p0.y + 2 * (1 - u) * u * p1.y + u * u * p2.y;
            gsap.set(coin, { x, y, rotation: u * 540, scale: 0.55 + Math.sin(u * Math.PI) * 0.5 });
          },
        });
        tl.to(coin, { opacity: 0, scale: 0.1, duration: 0.18 }, ">-0.12");
        tl.to(`[data-person="${i}"]`, { y: -14, duration: 0.18, ease: "power2.out", yoyo: true, repeat: 1 }, "<0.02");
        tl.to(`[data-glow="${i}"]`, { opacity: 0.9, scale: 1.15, duration: 0.35, ease: "power2.out" }, "<");
        tl.to(`[data-chip="${i}"]`, { opacity: 1, scale: 1, duration: 0.45, ease: "back.out(2.4)" }, "<0.05");
        return tl;
      };

      const loop = gsap.timeline({ repeat: -1, repeatDelay: 0.5 });
      loop.add(() => {
        const l = LINES[line++ % LINES.length];
        q.textContent = "";
        type(l.text, l.lang);
      }, 0);
      loop.fromTo("[data-mic]", { scale: 1 }, { scale: 1.06, duration: 0.5, yoyo: true, repeat: 3, ease: "sine.inOut", transformOrigin: "50% 60%" }, 0.2);
      loop.fromTo("[data-led]", { opacity: 1 }, { opacity: 0.25, duration: 0.25, yoyo: true, repeat: 7 }, 0.2);
      [0, 1, 2, 3].forEach((i) => {
        loop.fromTo(`[data-ring="${i}"]`, { attr: { r: 60 }, opacity: 0.55 }, { attr: { r: 900 }, opacity: 0, duration: 3.2, ease: "power1.out" }, 1.5 + i * 0.5);
      });
      // Coins leave nearest-first, alternating sides, so it reads as the sound reaching each person.
      [2, 3, 1, 4, 0, 5].forEach((i, k) => loop.add(flight(i), 2.3 + k * 0.16));
      loop.to(["[data-chip]", "[data-glow]"], { opacity: 0, duration: 0.5, ease: "power1.in" }, 6.6);
      loop.to("[data-chip]", { scale: 0.4, duration: 0.5 }, 6.6);
      loop.add(() => {
        q.textContent = "";
      }, 7);
    }, svg);

    return () => {
      typing?.kill();
      ctx.revert();
    };
  }, []);

  return (
    <div className="relative w-full">
      {/* what you said */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex -translate-y-3 justify-center">
        <div className="flex max-w-[92vw] items-center gap-3 rounded-full bg-white/80 py-2 pl-3 pr-5 shadow-[0_8px_30px_-10px_rgba(22,21,43,0.25)] backdrop-blur">
          <span ref={tag} className="rounded-full bg-[#16152b] px-2.5 py-0.5 font-mono text-[10px] font-semibold tracking-widest text-white">EN</span>
          <span className="min-h-6 min-w-[12ch] text-[0.95rem] font-medium text-[#16152b] sm:text-base" aria-live="off">
            <span ref={quote}>&nbsp;</span>
            <span aria-hidden className="ml-0.5 inline-block h-4 w-[2px] translate-y-[3px] animate-pulse bg-[#f2552c]" />
          </span>
        </div>
      </div>

      <div className="h-[300px] w-full sm:h-[360px] lg:h-[min(46vh,480px)] lg:min-h-[340px]">
        <svg ref={svg} viewBox={`${VIEW.x} 0 ${VIEW.w} ${VIEW.h}`} preserveAspectRatio="xMidYMax slice" className="size-full" role="img" aria-label="A microphone sends rupee payments to a street of workers">
          <defs>
            <linearGradient id="horizon" gradientUnits="userSpaceOnUse" x1="-300" x2="1300" y1="0" y2="0">
              <stop offset="0" stopColor="#ffb020" stopOpacity="0" />
              <stop offset="0.3" stopColor="#ff8a5c" />
              <stop offset="0.5" stopColor="#ff5d73" />
              <stop offset="0.7" stopColor="#7c5cff" />
              <stop offset="1" stopColor="#12a594" stopOpacity="0" />
            </linearGradient>
            <radialGradient id="glow">
              <stop offset="0" stopColor="#ffd166" stopOpacity="0.95" />
              <stop offset="1" stopColor="#ffd166" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="micHalo">
              <stop offset="0" stopColor="#ffb36b" stopOpacity="0.55" />
              <stop offset="1" stopColor="#ffb36b" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* sound leaving the mic */}
          <circle cx={MIC.x} cy={MIC.y} r="220" fill="url(#micHalo)" />
          {[0, 1, 2, 3].map((i) => (
            <circle key={i} data-ring={i} cx={MIC.x} cy={MIC.y} r="60" fill="none" stroke="#ff7a59" strokeWidth="3" />
          ))}

          {/* people, standing on the horizon */}
          {PEOPLE.map((p, i) => {
            const { w, h, y } = place(p);
            return (
              <g key={i}>
                <circle data-glow={i} cx={p.x + w / 2} cy={y + h * 0.5} r={110 * p.s + 20} fill="url(#glow)" />
                <g data-person={i}>
                  <Person {...p.who} svgProps={{ x: p.x, y, width: w, height: h }} />
                </g>
                <g data-chip={i} transform={`translate(${p.x + w / 2 - 46} ${y - 12})`}>
                  <rect width="92" height="30" rx="15" fill="#16152b" />
                  <circle cx="16" cy="15" r="8" fill="#27e0a3" />
                  <path d="M12.5 15.2 l2.7 2.6 l5 -5.4" stroke="#16152b" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  <text x="30" y="20" fontSize="14" fontWeight="700" fill="#fff" fontFamily="var(--font-display), system-ui, sans-serif">{p.amount}</text>
                </g>
              </g>
            );
          })}

          {/* the ground */}
          <ellipse cx={GROUND.cx} cy={GROUND.cy} rx={GROUND.rx} ry={GROUND.ry} fill="#fffdf8" />
          <path d={`M ${GROUND.cx - GROUND.rx} ${GROUND.cy} A ${GROUND.rx} ${GROUND.ry} 0 0 1 ${GROUND.cx + GROUND.rx} ${GROUND.cy}`} fill="none" stroke="url(#horizon)" strokeWidth="2.5" />
          <ellipse cx={MIC.x} cy={horizonAt(MIC.x) + 4} rx="70" ry="9" fill="#16152b" opacity=".1" />

          {/* the mic, in front of everything */}
          <g data-mic>
            <Mic live={false} svgProps={{ x: MIC.x - 77, y: horizonAt(MIC.x) - 228, width: 154, height: 231 }} />
            <circle data-led cx={MIC.x} cy={horizonAt(MIC.x) - 228 + 231 * 0.5067} r="3.3" fill="#27e0a3" />
          </g>

          {/* money in flight */}
          {PEOPLE.map((_, i) => (
            <g key={i} data-coin={i} opacity="0">
              <Coin svgProps={{ x: -22, y: -22, width: 44, height: 44 }} />
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
