/** The owner's whole journey, one question per screen. The first four happen on /signup, the rest on /onboarding. */
export const JOURNEY = ["role", "name", "email", "password", "business", "type", "size", "cycle", "wage", "rules", "team", "payouts", "voice", "invite"] as const;
export type JourneyStep = (typeof JOURNEY)[number];
export const TOTAL = JOURNEY.length;
export const indexOf = (s: JourneyStep) => JOURNEY.indexOf(s);

/** Steps that exist only after the business has been created; a refresh resumes at one of these. */
export const WIZARD_STEPS = ["cycle", "wage", "rules", "team", "payouts", "voice", "invite", "done"] as const;
export type WizardStep = "business" | "type" | "size" | (typeof WIZARD_STEPS)[number];

export const BUSINESS_TYPES = [
  { value: "delivery", title: "Delivery & fleet", caption: "Riders and drivers" },
  { value: "retail", title: "Shops & retail", caption: "Counters and stores" },
  { value: "factory", title: "Factory or workshop", caption: "Shift workers" },
  { value: "construction", title: "Construction", caption: "Site crews" },
  { value: "other", title: "Something else", caption: "Any team paid by the day" },
] as const;

export const TEAM_SIZES = ["1–10", "11–50", "51–200", "200+"] as const;

export const CYCLES = [
  { value: "weekly", title: "Every week", caption: "Monday to Sunday", rows: 1 },
  { value: "fortnightly", title: "Twice a month", caption: "1st–15th · 16th–end", rows: 2 },
  { value: "monthly", title: "Once a month", caption: "The calendar month", rows: 4 },
] as const;
