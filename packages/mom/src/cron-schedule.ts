import { CronDate } from "croner";

/** Preserve Croner 9's current-time placeholder, which became a wildcard in 10. */
export function normalizeLegacySchedule(schedule: string, timezone: string, now = new Date()): string {
	if (!schedule.includes("?")) return schedule;
	const parts = schedule.replace(/\s+/g, " ").split(" ");
	if (parts.length !== 5 && parts.length !== 6) return schedule;
	const date = new CronDate(now, timezone).getDate(true);
	const values = [
		date.getSeconds(),
		date.getMinutes(),
		date.getHours(),
		date.getDate(),
		date.getMonth() + 1,
		date.getDay(),
	];
	const offset = parts.length === 5 ? 1 : 0;
	return parts.map((part, index) => part.replace("?", String(values[index + offset]))).join(" ");
}
