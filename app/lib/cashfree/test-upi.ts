/**
 * Cashfree's sandbox test UPI IDs, and the rule for handing them to workers who have none. Pure and dependency-free,
 * so it runs on the server, in the browser and in scripts/advance-check.mjs.
 *
 * Only `success@upi` and `failure@upi` are in Cashfree's transfer tables; `invalid@upi` is the example Cashfree gives
 * for a failed validation. Any other ID fails in the sandbox, and none of these can ever be paid for real.
 */
export const TEST_VPA = { success: "success@upi", failure: "failure@upi", invalid: "invalid@upi" } as const;
const ALL = new Set<string>(Object.values(TEST_VPA));

export const isTestVpa = (v: string | null | undefined) => ALL.has((v ?? "").trim().toLowerCase());

export interface AssignableWorker { id: string; name: string; status: string; payoutUpi: string }

export interface TestUpiPlan {
  /** Workers whose UPI ID changes, with the test ID they get. */
  changes: { id: string; upi: string }[];
  /** Of those, how many get the failing ID. */
  failing: number;
  /** Active workers left alone because they already hold a real UPI ID. */
  skippedReal: number;
}

/**
 * Who gets which test ID. Only active workers with no UPI ID, or one that is already a test ID (so the success and
 * failure mix can be changed), are touched. A real UPI ID is never overwritten. Everyone gets `success@upi` except
 * the workers named in `failIds`, plus the first `failCount` of the rest (by name) when a count is given.
 */
export function planTestUpiAssignment(workers: AssignableWorker[], opts: { onlyIds?: string[] | null; failIds?: string[]; failCount?: number } = {}): TestUpiPlan {
  const only = opts.onlyIds ? new Set(opts.onlyIds) : null;
  const pool = workers.filter((w) => w.status === "active" && (!only || only.has(w.id)));
  const targets = pool.filter((w) => !w.payoutUpi.trim() || isTestVpa(w.payoutUpi));
  const skippedReal = pool.length - targets.length;

  const failing = new Set((opts.failIds ?? []).filter((id) => targets.some((w) => w.id === id)));
  const fresh = targets.filter((w) => !w.payoutUpi.trim());
  let more = Math.max(0, Math.min(Math.floor(opts.failCount ?? 0), fresh.length));
  for (const w of [...fresh].sort((x, y) => x.name.localeCompare(y.name))) {
    if (more <= 0) break;
    if (!failing.has(w.id)) { failing.add(w.id); more--; }
  }

  const changes = targets
    .map((w) => ({ id: w.id, upi: failing.has(w.id) ? TEST_VPA.failure : TEST_VPA.success, was: w.payoutUpi.trim().toLowerCase() }))
    .filter((c) => c.upi !== c.was)
    .map(({ id, upi }) => ({ id, upi }));
  return { changes, failing: targets.filter((w) => failing.has(w.id)).length, skippedReal };
}
