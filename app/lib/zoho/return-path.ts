/** Where "Connect Zoho" may send the owner back to: the integrations page, or the onboarding wizard. */
export const ZOHO_RETURN_PATHS = ["/integrations", "/onboarding"] as const;
export const ZOHO_RETURN_COOKIE = "zoho_oauth_return";

/** Only an allowlisted path is ever used as a return target, never a caller-supplied URL. */
export function safeReturnPath(v: string | null | undefined): (typeof ZOHO_RETURN_PATHS)[number] {
  return ZOHO_RETURN_PATHS.find((p) => p === v) ?? "/integrations";
}
