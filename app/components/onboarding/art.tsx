import { useId, type ReactNode } from "react";

/**
 * Flat vector illustrations drawn for BolPay: Indian workers and owners, a microphone, rupee coins,
 * shopfronts and calendars. Everything is plain SVG so it scales, themes and animates (GSAP/motion).
 * No external assets.
 */

export const INK = "#16152b";
export const PAPER = "#fbf7ef";

/** Darkens a #rrggbb colour by `amt` (0 to 1). */
export function shade(hex: string, amt = 0.14) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.round(c * (1 - amt)));
  return `#${[f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/* ------------------------------------------------------------------ people */

export interface PersonProps {
  skin?: string;
  shirt?: string;
  collar?: string;
  hair?: string;
  hairStyle?: "short" | "long" | "bun" | "bald" | "side";
  hat?: "helmet" | "hardhat" | "cap" | null;
  hatColor?: string;
  glasses?: boolean;
  mustache?: boolean;
  bindi?: boolean;
  /** Hi-vis vest stripes. */
  vest?: boolean;
  /** Delivery-bag strap across the chest. */
  strap?: boolean;
  /** A watch on a raised wrist is drawn by the caller; this only toggles the open smile. */
  grin?: boolean;
  className?: string;
  /** Extra attributes for the root <svg> (x, y, width, height when nested in a scene). */
  svgProps?: React.SVGProps<SVGSVGElement>;
}

/** A bust, 200 x 220. Flat shapes, a darker tone for shade, no outlines. */
export function Person({
  skin = "#c98b5f",
  shirt = "#f2552c",
  collar = "#fff6e6",
  hair = "#1b1410",
  hairStyle = "short",
  hat = null,
  hatColor = "#ffb020",
  glasses = false,
  mustache = false,
  bindi = false,
  vest = false,
  strap = false,
  grin = true,
  className,
  svgProps,
}: PersonProps) {
  const sk = shade(skin, 0.16);
  const hatDark = shade(hatColor, 0.2);
  return (
    <svg viewBox="0 0 200 220" className={className} aria-hidden {...svgProps}>
      {/* hair behind the head */}
      {hairStyle === "long" && <path d="M56 92 C46 150 54 176 74 184 L126 184 C146 176 154 150 144 92 Z" fill={hair} />}
      {hairStyle === "bun" && <circle cx="100" cy="30" r="17" fill={hair} />}

      {/* torso */}
      <path d="M14 222 C14 176 50 152 100 152 C150 152 186 176 186 222 Z" fill={shirt} />
      <path d="M14 222 C14 190 30 172 50 162 C40 180 40 200 44 222 Z" fill={shade(shirt, 0.12)} opacity=".7" />
      {vest && (
        <g>
          <path d="M60 164 L72 222 H92 L84 154 Z" fill="#ffd400" />
          <path d="M140 164 L128 222 H108 L116 154 Z" fill="#ffd400" />
          <path d="M66 190 L88 190 M64 205 L90 205 M134 190 L112 190 M136 205 L110 205" stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity=".85" />
        </g>
      )}
      {strap && <path d="M34 168 L150 222 H122 L26 182 Z" fill="#2b2f4a" />}

      {/* neck and collar */}
      <path d="M84 124 H116 V152 C116 164 84 164 84 152 Z" fill={sk} />
      <path d="M76 152 L100 184 L124 152 L112 148 L100 166 L88 148 Z" fill={collar} />
      <path d="M88 150 L100 168 L112 150 Z" fill={sk} />

      {/* ears */}
      <circle cx="62" cy="96" r="8" fill={skin} />
      <circle cx="138" cy="96" r="8" fill={skin} />
      <circle cx="62" cy="97" r="3.5" fill={sk} />
      <circle cx="138" cy="97" r="3.5" fill={sk} />

      {/* head */}
      <ellipse cx="100" cy="92" rx="38" ry="44" fill={skin} />

      {/* hair on top */}
      {hairStyle === "short" && !hat && <path d="M61 90 C54 48 84 36 102 36 C128 36 148 54 139 90 C135 72 124 62 100 62 C78 62 66 72 61 90 Z" fill={hair} />}
      {hairStyle === "side" && !hat && <path d="M60 92 C52 48 88 34 108 36 C136 38 150 60 139 92 C132 70 116 60 92 64 C74 66 64 76 60 92 Z" fill={hair} />}
      {hairStyle === "long" && !hat && <path d="M60 92 C56 52 82 38 102 38 C128 38 146 54 140 92 C134 72 120 62 100 62 C82 62 66 72 60 92 Z" fill={hair} />}
      {hairStyle === "bun" && !hat && <path d="M62 90 C58 54 84 42 100 42 C120 42 142 54 138 90 C132 72 120 64 100 64 C82 64 68 72 62 90 Z" fill={hair} />}

      {/* face */}
      <path d="M76 82 Q85 76 94 81" stroke={hair} strokeWidth="4.2" strokeLinecap="round" fill="none" />
      <path d="M106 81 Q115 76 124 82" stroke={hair} strokeWidth="4.2" strokeLinecap="round" fill="none" />
      <circle cx="85" cy="94" r="3.8" fill="#1b1b2b" />
      <circle cx="115" cy="94" r="3.8" fill="#1b1b2b" />
      <circle cx="86.3" cy="92.8" r="1.2" fill="#fff" />
      <circle cx="116.3" cy="92.8" r="1.2" fill="#fff" />
      <path d="M100 96 Q94 108 102 110" stroke={sk} strokeWidth="3.2" strokeLinecap="round" fill="none" />
      <circle cx="73" cy="108" r="7" fill="#ff7a7a" opacity=".22" />
      <circle cx="127" cy="108" r="7" fill="#ff7a7a" opacity=".22" />
      {grin ? (
        <path d="M86 115 Q100 131 114 115 Q100 120 86 115 Z" fill="#fff" stroke="#7a2e22" strokeWidth="2.6" strokeLinejoin="round" />
      ) : (
        <path d="M89 117 Q100 124 111 117" stroke="#7a2e22" strokeWidth="3" strokeLinecap="round" fill="none" />
      )}
      {mustache && <path d="M83 113 Q92 104 100 109 Q108 104 117 113 Q108 110 100 113 Q92 110 83 113 Z" fill={hair} />}
      {bindi && <circle cx="100" cy="76" r="2.8" fill="#d7263d" />}
      {glasses && (
        <g stroke="#1b1b2b" strokeWidth="3" fill="none">
          <circle cx="85" cy="94" r="11" />
          <circle cx="115" cy="94" r="11" />
          <path d="M96 94 H104" />
        </g>
      )}

      {/* headwear */}
      {hat === "helmet" && (
        <g>
          <path d="M58 88 C54 40 146 40 142 88 Z" fill={hatColor} />
          <path d="M56 88 H144 L150 95 H50 Z" fill={hatDark} />
          <path d="M76 62 Q100 48 124 62" stroke="#fff" strokeWidth="5" strokeLinecap="round" fill="none" opacity=".4" />
        </g>
      )}
      {hat === "hardhat" && (
        <g>
          <path d="M60 84 C58 42 142 42 140 84 Z" fill={hatColor} />
          <rect x="93" y="40" width="14" height="26" rx="5" fill={hatDark} />
          <path d="M50 90 Q50 80 60 80 H140 Q150 80 150 90 Z" fill={hatDark} />
        </g>
      )}
      {hat === "cap" && (
        <g>
          <path d="M60 84 C58 46 142 46 140 84 Z" fill={hatColor} />
          <path d="M56 84 H144 L166 92 Q150 96 138 92 H60 Z" fill={hatDark} />
          <circle cx="100" cy="62" r="4" fill="#fff" opacity=".5" />
        </g>
      )}
    </svg>
  );
}

/** Ready-made cast, reused across the screens so the same faces appear throughout. */
export const CAST = {
  rider: { skin: "#b97a50", shirt: "#f2552c", hat: "helmet", hatColor: "#ffb020", strap: true, hair: "#1a120d", mustache: true } as PersonProps,
  owner: { skin: "#c98b5f", shirt: "#3a3fd1", hair: "#241812", glasses: true, mustache: true, hairStyle: "side" } as PersonProps,
  supervisor: { skin: "#a8693f", shirt: "#12a594", hat: "cap", hatColor: "#16152b", hair: "#1a120d", mustache: true } as PersonProps,
  worker: { skin: "#d19a6a", shirt: "#ffb020", collar: "#fff", hair: "#1a120d", hairStyle: "short" } as PersonProps,
  builder: { skin: "#9a5f3a", shirt: "#ff7a45", hat: "hardhat", hatColor: "#ffd400", vest: true, hair: "#1a120d" } as PersonProps,
  shopkeeper: { skin: "#c68a5c", shirt: "#f4efe3", collar: "#e6dcc6", hair: "#211812", mustache: true, hairStyle: "side", glasses: false } as PersonProps,
  aunty: { skin: "#d29a6b", shirt: "#d7263d", hairStyle: "long", hair: "#1a120d", bindi: true } as PersonProps,
  didi: { skin: "#b7774c", shirt: "#7c5cff", hairStyle: "bun", hair: "#1a120d", bindi: true } as PersonProps,
} as const;

/* ------------------------------------------------------------- mic and coin */

/** The BolPay microphone: ink body with a dotted grille, a saffron band and a live LED. 200 x 300. */
export function Mic({ className, live = true, svgProps }: { className?: string; live?: boolean; svgProps?: React.SVGProps<SVGSVGElement> }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 200 300" className={className} aria-hidden {...svgProps}>
      <defs>
        <linearGradient id={`b${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#34385c" />
          <stop offset="1" stopColor="#0d0d1f" />
        </linearGradient>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffd166" />
          <stop offset="0.55" stopColor="#ff9248" />
          <stop offset="1" stopColor="#ff5d73" />
        </linearGradient>
        <pattern id={`p${id}`} width="11" height="11" patternUnits="userSpaceOnUse">
          <circle cx="5.5" cy="5.5" r="1.7" fill="#fff" opacity=".2" />
        </pattern>
        <clipPath id={`c${id}`}>
          <rect x="45" y="14" width="110" height="156" rx="55" />
        </clipPath>
      </defs>
      <ellipse cx="100" cy="288" rx="46" ry="7" fill="#16152b" opacity=".12" />
      {/* handle */}
      <path d="M70 168 H130 L120 262 Q100 278 80 262 Z" fill={`url(#b${id})`} />
      <path d="M82 176 L88 256" stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity=".12" />
      <text x="100" y="236" textAnchor="middle" fontSize="38" fontWeight="800" fill="#ffd166" fontFamily="var(--font-display), system-ui, sans-serif">
        ₹
      </text>
      {/* head */}
      <rect x="45" y="14" width="110" height="156" rx="55" fill={`url(#b${id})`} />
      <g clipPath={`url(#c${id})`}>
        <rect x="45" y="14" width="110" height="156" fill={`url(#p${id})`} />
        <ellipse cx="74" cy="64" rx="13" ry="46" fill="#fff" opacity=".16" transform="rotate(-8 74 64)" />
      </g>
      <rect x="40" y="112" width="120" height="18" rx="9" fill={`url(#g${id})`} />
      <rect x="40" y="112" width="120" height="6" rx="3" fill="#fff" opacity=".28" />
      {live && <circle cx="100" cy="152" r="5" fill="#27e0a3" />}
    </svg>
  );
}

/** A rupee coin, 80 x 80. */
export function Coin({ className, svgProps }: { className?: string; svgProps?: React.SVGProps<SVGSVGElement> }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 80 80" className={className} aria-hidden {...svgProps}>
      <defs>
        <radialGradient id={`o${id}`} cx="0.35" cy="0.3" r="0.9">
          <stop offset="0" stopColor="#fff0b3" />
          <stop offset="0.5" stopColor="#ffc93c" />
          <stop offset="1" stopColor="#e59a14" />
        </radialGradient>
      </defs>
      <circle cx="40" cy="40" r="36" fill={`url(#o${id})`} />
      <circle cx="40" cy="40" r="27" fill="none" stroke="#c97d0c" strokeWidth="3" opacity=".55" />
      <text x="40" y="53" textAnchor="middle" fontSize="36" fontWeight="800" fill="#a85f00" fontFamily="var(--font-display), system-ui, sans-serif">
        ₹
      </text>
    </svg>
  );
}

/** A banknote, 120 x 64. */
export function Note({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 64" className={className} aria-hidden>
      <rect width="120" height="64" rx="7" fill="#7fcf9a" />
      <rect x="6" y="6" width="108" height="52" rx="4" fill="none" stroke="#fff" strokeWidth="2" opacity=".7" />
      <circle cx="60" cy="32" r="16" fill="#58b87a" />
      <text x="60" y="40" textAnchor="middle" fontSize="22" fontWeight="800" fill="#fff" fontFamily="var(--font-display), system-ui, sans-serif">
        ₹
      </text>
      <circle cx="18" cy="32" r="5" fill="#fff" opacity=".6" />
      <circle cx="102" cy="32" r="5" fill="#fff" opacity=".6" />
    </svg>
  );
}

/* ---------------------------------------------------------------- business */

const Frame = ({ children, className, w = 160, h = 140 }: { children: ReactNode; className?: string; w?: number; h?: number }) => (
  <svg viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden>
    {children}
  </svg>
);

/** A neighbourhood shop with a striped awning. */
export function ShopArt({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <rect x="18" y="58" width="124" height="72" fill="#fff3dd" />
      <rect x="18" y="58" width="124" height="72" fill="#f2552c" opacity=".05" />
      {Array.from({ length: 6 }, (_, i) => (
        <path key={i} d={`M${20 + i * 20} 34 h20 v20 a10 10 0 0 1 -20 0 z`} fill={i % 2 ? "#fff" : "#f2552c"} />
      ))}
      <rect x="16" y="26" width="128" height="10" rx="3" fill={INK} />
      <rect x="58" y="12" width="44" height="16" rx="3" fill="#ffb020" />
      <path d="M66 20 h28" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <rect x="28" y="72" width="40" height="34" fill="#bfe8ea" />
      <path d="M28 89 H68 M48 72 V106" stroke="#fff" strokeWidth="2.5" />
      <rect x="84" y="78" width="38" height="52" fill="#12a594" />
      <circle cx="115" cy="106" r="2.6" fill="#ffd166" />
      <rect x="32" y="108" width="12" height="10" fill="#ffb020" />
      <rect x="46" y="112" width="14" height="6" fill="#d7263d" />
      <path d="M8 130 H152" stroke={INK} strokeWidth="3" strokeLinecap="round" opacity=".18" />
    </Frame>
  );
}

/** A factory with a saw-tooth roof, chimney and smoke. */
export function FactoryArt({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <rect x="112" y="22" width="16" height="64" fill="#8a93b5" />
      <rect x="108" y="18" width="24" height="8" fill="#6c7599" />
      <circle cx="122" cy="10" r="7" fill="#dfe3f2" />
      <circle cx="132" cy="3" r="5" fill="#eef0f8" />
      <path d="M14 126 V68 L44 46 V68 L74 46 V68 L104 46 V126 Z" fill="#ffb020" />
      <path d="M14 126 V68 L44 46 V68 L74 46 V68 L104 46 V126 Z" fill="#fff" opacity=".1" />
      <rect x="14" y="68" width="108" height="58" fill="#ffc94d" />
      {[24, 50, 76].map((x) => (
        <rect key={x} x={x} y="82" width="18" height="16" fill="#2b2f4a" />
      ))}
      {[24, 50, 76].map((x) => (
        <rect key={x + 1} x={x + 3} y="85" width="12" height="4" fill="#7fe0d6" opacity=".8" />
      ))}
      <rect x="100" y="94" width="22" height="32" fill="#12a594" />
      <circle cx="140" cy="108" r="13" fill="#f2552c" />
      <circle cx="140" cy="108" r="5" fill="#fff" />
      <path d="M140 91 v6 M140 119 v6 M123 108 h6 M151 108 h6" stroke="#f2552c" strokeWidth="5" strokeLinecap="round" />
      <path d="M8 126 H152" stroke={INK} strokeWidth="3" strokeLinecap="round" opacity=".18" />
    </Frame>
  );
}

/** A tower crane over a half-built block. */
export function SiteArt({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <rect x="86" y="14" width="9" height="116" fill="#ffb020" />
      {Array.from({ length: 8 }, (_, i) => (
        <path key={i} d={`M86 ${24 + i * 14} L95 ${34 + i * 14} M95 ${24 + i * 14} L86 ${34 + i * 14}`} stroke="#c97d0c" strokeWidth="1.6" />
      ))}
      <rect x="22" y="14" width="124" height="8" fill="#ffb020" />
      <path d="M22 22 L66 14 M146 22 L118 14" stroke="#c97d0c" strokeWidth="1.8" />
      <rect x="18" y="12" width="20" height="14" fill="#2b2f4a" />
      <path d="M126 22 V62" stroke={INK} strokeWidth="2" />
      <rect x="118" y="62" width="16" height="12" rx="2" fill="#f2552c" />
      <rect x="12" y="92" width="64" height="38" fill="#cfd5ea" />
      <rect x="12" y="74" width="64" height="18" fill="#e5e9f6" />
      {[18, 36, 54].map((x) => (
        <rect key={x} x={x} y="100" width="12" height="14" fill="#8f98bd" />
      ))}
      {[18, 36, 54].map((x) => (
        <rect key={x + 2} x={x} y="80" width="12" height="8" fill="#b6bedc" />
      ))}
      <path d="M8 130 H152" stroke={INK} strokeWidth="3" strokeLinecap="round" opacity=".18" />
    </Frame>
  );
}

/** A delivery parcel with a map pin. */
export function ParcelArt({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <path d="M30 62 L80 40 L130 62 V108 L80 130 L30 108 Z" fill="#e9a35a" />
      <path d="M30 62 L80 84 V130 L30 108 Z" fill="#d78d41" />
      <path d="M80 84 L130 62 V108 L80 130 Z" fill="#f2b574" />
      <path d="M55 51 L105 73 V86 L55 64 Z" fill="#fff6e0" opacity=".85" />
      <path d="M80 84 V130" stroke="#b9722b" strokeWidth="2" />
      <path d="M118 16 C104 16 96 27 96 38 C96 54 118 72 118 72 C118 72 140 54 140 38 C140 27 132 16 118 16 Z" fill="#f2552c" />
      <circle cx="118" cy="38" r="8" fill="#fff" />
      <path d="M8 132 H152" stroke={INK} strokeWidth="3" strokeLinecap="round" opacity=".18" />
    </Frame>
  );
}

/** A toolbox, for "something else". */
export function ToolboxArt({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <path d="M58 52 V40 a8 8 0 0 1 8 -8 h28 a8 8 0 0 1 8 8 v12" fill="none" stroke={INK} strokeWidth="8" strokeLinecap="round" />
      <rect x="22" y="52" width="116" height="72" rx="9" fill="#7c5cff" />
      <rect x="22" y="82" width="116" height="10" fill="#5b3fd9" />
      <rect x="70" y="76" width="20" height="22" rx="4" fill="#ffd166" />
      <rect x="22" y="52" width="116" height="14" rx="7" fill="#fff" opacity=".14" />
    </Frame>
  );
}

/* ---------------------------------------------------------------- calendars */

/** A month sheet with `rows` weeks highlighted: 1 = a week, 2 = a fortnight, 4 = the month. */
export function CalendarArt({ rows, className }: { rows: 1 | 2 | 4; className?: string }) {
  const cell = 15;
  return (
    <Frame className={className} w={140} h={120}>
      <rect x="10" y="12" width="120" height="100" rx="10" fill="#fff" />
      <path d="M10 22 a10 10 0 0 1 10 -10 h100 a10 10 0 0 1 10 10 v14 H10 Z" fill="#f2552c" />
      <rect x="34" y="4" width="7" height="16" rx="3.5" fill={INK} />
      <rect x="99" y="4" width="7" height="16" rx="3.5" fill={INK} />
      {Array.from({ length: 4 }, (_, r) => (
        <g key={r}>
          {rows >= r + 1 && <rect x="14" y={42 + r * 17} width="112" height="15" rx="7.5" fill="#ffd166" opacity=".55" />}
          {Array.from({ length: 7 }, (_, c) => (
            <circle key={c} cx={22 + c * cell} cy={49.5 + r * 17} r="3" fill={rows >= r + 1 ? "#c97d0c" : "#cfd3e2"} />
          ))}
        </g>
      ))}
    </Frame>
  );
}

/* --------------------------------------------------------------- team icons */

/** A sheet of rows: the CSV option. */
export function SheetArt({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <rect x="30" y="14" width="100" height="112" rx="8" fill="#fff" />
      <rect x="30" y="14" width="100" height="26" rx="8" fill="#12a594" />
      <rect x="30" y="30" width="100" height="10" fill="#12a594" />
      {[52, 70, 88, 106].map((y) => (
        <g key={y}>
          <rect x="40" y={y} width="22" height="9" rx="3" fill="#cfd3e2" />
          <rect x="68" y={y} width="52" height="9" rx="3" fill="#e5e8f3" />
        </g>
      ))}
      <path d="M50 27 h20 M84 27 h30" stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity=".8" />
    </Frame>
  );
}

/** Two plugs meeting: the "connect Zoho" option. */
export function LinkArt({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <rect x="12" y="52" width="48" height="36" rx="12" fill="#3a3fd1" />
      <rect x="100" y="52" width="48" height="36" rx="12" fill="#12a594" />
      <path d="M60 62 h14 M60 78 h14 M100 62 h-14 M100 78 h-14" stroke={INK} strokeWidth="6" strokeLinecap="round" />
      <path d="M72 70 h16" stroke="#ffd166" strokeWidth="6" strokeLinecap="round" />
      <circle cx="36" cy="70" r="7" fill="#fff" opacity=".9" />
      <circle cx="124" cy="70" r="7" fill="#fff" opacity=".9" />
      <path d="M72 38 l8 -14 l8 14 M72 102 l8 14 l8 -14" stroke="#ffb020" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Frame>
  );
}

/** One person and a plus: "add by hand". */
export function AddPersonArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 140" className={className} aria-hidden>
      <g transform="translate(28 6) scale(.62)">
        <Person {...CAST.worker} />
      </g>
      <circle cx="124" cy="44" r="20" fill="#f2552c" />
      <path d="M124 34 v20 M114 44 h20" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

/* ----------------------------------------------------------------- scenery */

/** A pale street of Indian shopfronts, for the sides of the welcome screen. Decorative. */
export function Streetscape({ side, className }: { side: "left" | "right"; className?: string }) {
  const flip = side === "right" ? "scale(-1 1) translate(-360 0)" : undefined;
  return (
    <svg viewBox="0 0 360 520" className={className} aria-hidden preserveAspectRatio="xMinYMax meet">
      <g transform={flip} opacity=".9">
        <rect x="0" y="150" width="150" height="370" fill="#cfe8e4" />
        <rect x="0" y="150" width="150" height="20" fill="#b7d8d3" />
        <rect x="16" y="190" width="44" height="64" fill="#e9f5f2" />
        <rect x="76" y="190" width="44" height="64" fill="#e9f5f2" />
        <path d="M10 262 H130 M10 270 H130" stroke="#9cc7c0" strokeWidth="3" />
        <rect x="16" y="290" width="44" height="64" fill="#e9f5f2" />
        <rect x="76" y="290" width="44" height="64" fill="#b7d8d3" />
        <rect x="20" y="108" width="84" height="30" fill="#ffd9a0" />
        <path d="M30 123 h64" stroke="#e2a24c" strokeWidth="5" strokeLinecap="round" />
        <rect x="150" y="230" width="120" height="290" fill="#dde6f7" />
        <rect x="150" y="230" width="120" height="16" fill="#c4d2ef" />
        <rect x="166" y="262" width="34" height="50" fill="#f3f7ff" />
        <rect x="218" y="262" width="34" height="50" fill="#f3f7ff" />
        <rect x="166" y="340" width="34" height="50" fill="#f3f7ff" />
        <rect x="218" y="340" width="34" height="50" fill="#aebfe6" />
        <rect x="270" y="320" width="90" height="200" fill="#f7e0d6" />
        {Array.from({ length: 5 }, (_, i) => (
          <path key={i} d={`M${270 + i * 18} 320 h18 v16 a9 9 0 0 1 -18 0 z`} fill={i % 2 ? "#fff" : "#f4a58a"} />
        ))}
        <rect x="284" y="372" width="62" height="60" fill="#fdf2ec" />
        <path d="M96 150 V80 M96 90 h22 M96 100 h30" stroke="#9cc7c0" strokeWidth="3" />
        <path d="M14 94 q40 -24 82 -8" stroke="#9cc7c0" strokeWidth="2" fill="none" />
      </g>
    </svg>
  );
}

/** India's flag, tiny, for the language chip. */
export function Flag({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <clipPath id="flagc">
        <circle cx="12" cy="12" r="12" />
      </clipPath>
      <g clipPath="url(#flagc)">
        <rect width="24" height="8" fill="#ff9933" />
        <rect y="8" width="24" height="8" fill="#fff" />
        <rect y="16" width="24" height="8" fill="#138808" />
        <circle cx="12" cy="12" r="2.6" fill="none" stroke="#1a2a8a" strokeWidth="1" />
      </g>
    </svg>
  );
}
