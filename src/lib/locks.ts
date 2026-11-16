/**
 * Process-wide "is this job running?" registry (DIS-412).
 *
 * Lives on `global`, like the DB handle: Next bundles `instrumentation` and each route
 * separately, so a module-level variable is not shared between the scheduled jobs and the API
 * routes. One entry per job name; names are independent (the pipeline's "Scrape KB" mode runs
 * the KB sync from inside the pipeline job).
 */
export type JobName = "pipeline" | "kb-sync" | "widget-reports" | "db-clear";

declare global {
  // eslint-disable-next-line no-var
  var __jobLocks: Map<string, number> | undefined;
}

function locks(): Map<string, number> {
  if (!global.__jobLocks) global.__jobLocks = new Map();
  return global.__jobLocks;
}

/** Take the lock for `name`. Returns false when that job is already running. */
export function acquireJob(name: JobName): boolean {
  if (locks().has(name)) return false;
  locks().set(name, Date.now());
  return true;
}

export function releaseJob(name: JobName): void {
  locks().delete(name);
}

export function isJobRunning(name: JobName): boolean {
  return locks().has(name);
}

/** Jobs running right now, with their start time (ms). */
export function runningJobs(): Array<{ name: string; since: number }> {
  return [...locks().entries()].map(([name, since]) => ({ name, since }));
}
