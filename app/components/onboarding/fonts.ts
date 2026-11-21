import { Bricolage_Grotesque } from "next/font/google";

/** A characterful display face for the sign-up screens. Body text keeps the app's IBM Plex. */
export const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});
