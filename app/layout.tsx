import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Devanagari, Noto_Sans_Bengali, Noto_Sans_Kannada, Noto_Sans_Tamil, Noto_Sans_Telugu } from "next/font/google";
import { InteractionSounds } from "./components/feedback/InteractionSounds";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// Replies can come back in Hindi, so Devanagari gets a matching face. Loaded only when used.
const plexDeva = IBM_Plex_Sans_Devanagari({
  variable: "--font-plex-deva",
  subsets: ["devanagari"],
  weight: ["400", "500", "600"],
  preload: false,
});

// Worker-facing voice screens show what was said in Bengali, Kannada, Tamil or Telugu. Each face loads only when a page uses that script.
const notoBengali = Noto_Sans_Bengali({ variable: "--font-noto-bengali", subsets: ["bengali"], weight: ["400", "500", "600"], preload: false });
const notoKannada = Noto_Sans_Kannada({ variable: "--font-noto-kannada", subsets: ["kannada"], weight: ["400", "500", "600"], preload: false });
const notoTamil = Noto_Sans_Tamil({ variable: "--font-noto-tamil", subsets: ["tamil"], weight: ["400", "500", "600"], preload: false });
const notoTelugu = Noto_Sans_Telugu({ variable: "--font-noto-telugu", subsets: ["telugu"], weight: ["400", "500", "600"], preload: false });

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "BolPay",
  description: "Voice-first payroll for daily-wage teams, paid out through Cashfree.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexDeva.variable} ${notoBengali.variable} ${notoKannada.variable} ${notoTamil.variable} ${notoTelugu.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {children}
        <InteractionSounds />
      </body>
    </html>
  );
}
