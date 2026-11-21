/** The owner's whole journey: the account on /signup, then the business and the team on /onboarding. */
export const JOURNEY = ["account", "business", "team"] as const;
export type JourneyStep = (typeof JOURNEY)[number];
export const TOTAL = JOURNEY.length;
export const indexOf = (s: JourneyStep) => JOURNEY.indexOf(s);

/** Steps on /onboarding. Once the business exists, a refresh resumes at the team. */
export type WizardStep = "business" | "team";

export const CYCLES = [
  { value: "weekly", title: "Weekly" },
  { value: "fortnightly", title: "Twice a month" },
  { value: "monthly", title: "Monthly" },
] as const;
export type Cycle = (typeof CYCLES)[number]["value"];

/** The daily wage (₹) people start on until the owner edits them. */
export const DEFAULT_WAGE = 800;
