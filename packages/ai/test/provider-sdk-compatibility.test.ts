import { FinishReason } from "@google/genai";
import { afterEach, expect, test, vi } from "vitest";
import { getModel } from "../src/models.js";
import { streamAnthropic } from "../src/providers/anthropic.js";
import { mapStopReason, mapStopReasonString } from "../src/providers/google-shared.js";

afterEach(() => {
	vi.unstubAllGlobals();
});

test("Anthropic SDK 1 preserves the existing sampling and API-key wire contract", async () => {
	let requestHeaders = new Headers();
	let requestBody: Record<string, unknown> = {};
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_input: unknown, init?: RequestInit) => {
			requestHeaders = new Headers(init?.headers);
			requestBody = JSON.parse(String(init?.body));
			const events = [
				{
					type: "message_start",
					message: {
						id: "msg_test",
						type: "message",
						role: "assistant",
						model: "claude-sonnet-4-5",
						content: [],
						stop_reason: null,
						stop_sequence: null,
						usage: { input_tokens: 1, output_tokens: 0 },
					},
				},
				{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
				{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
				{ type: "content_block_stop", index: 0 },
				{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
				{ type: "message_stop" },
			];
			return new Response(
				events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
				{
					headers: { "content-type": "text/event-stream" },
				},
			);
		}),
	);
	const result = await streamAnthropic(
		getModel("anthropic", "claude-sonnet-4-5"),
		{ messages: [{ role: "user", content: "Hello", timestamp: 0 }] },
		{ apiKey: "test-key", temperature: 0.25 },
	).result();
	expect(result.stopReason).toBe("stop");
	expect(result.content).toEqual([{ type: "text", text: "Hello" }]);
	expect(requestBody.temperature).toBe(0.25);
	expect(requestHeaders.get("anthropic-version")).toBe("2023-06-01");
	expect(requestHeaders.get("x-api-key")).toBe("test-key");
	expect(requestHeaders.has("authorization")).toBe(false);
});

test("Google SDK finish reasons retain truncation and failure semantics", () => {
	expect(mapStopReason(FinishReason.CONTINUATION)).toBe("length");
	expect(mapStopReasonString("CONTINUATION")).toBe("length");
	expect(mapStopReason(FinishReason.TOO_MANY_TOOL_CALLS)).toBe("error");
	expect(mapStopReasonString("TOO_MANY_TOOL_CALLS")).toBe("error");
});
