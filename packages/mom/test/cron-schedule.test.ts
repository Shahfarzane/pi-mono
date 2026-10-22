import assert from "node:assert/strict";
import { test } from "node:test";
import { Cron } from "croner";
import { normalizeLegacySchedule } from "../src/cron-schedule.js";

test("current-time placeholders retain their timezone and five/six-field meaning", () => {
	const now = new Date("2026-10-22T12:34:56Z");
	assert.equal(normalizeLegacySchedule("? ? ? ? ? ?", "Europe/Stockholm", now), "56 34 14 22 10 4");
	assert.equal(normalizeLegacySchedule("? ? * * *", "Europe/Stockholm", now), "34 14 * * *");
	assert.equal(normalizeLegacySchedule("*/5 * * * *", "UTC", now), "*/5 * * * *");
});

test("numeric step prefixes continue to schedule at the same interval", () => {
	const cron = new Cron("5/5 * * * *", { sloppyRanges: true, mode: "5-or-6-parts", timezone: "UTC" });
	assert.equal(cron.nextRun(new Date("2026-10-22T12:06:00Z"))?.toISOString(), "2026-10-22T12:10:00.000Z");
	cron.stop();
});
