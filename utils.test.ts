import assert from "node:assert/strict";
import test from "node:test";
import { getConversationTranscript, getFirstUserMessageText, type SessionEntry } from "./utils.ts";

const conversation: SessionEntry[] = [
	{ type: "custom" },
	{ type: "message", message: { role: "user", content: "  " } },
	{ type: "message", message: { role: "user", content: "Plan the billing migration" } },
	{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "Start with a backup" }] } },
	{ type: "message", message: { role: "toolResult", content: "Backup complete" } },
	{ type: "message", message: { role: "user", content: [{ type: "image" }, { type: "text", text: "Then migrate invoices" }] } },
];

test("automatic naming uses the earliest nonempty user message", () => {
	assert.equal(getFirstUserMessageText(conversation), "Plan the billing migration");
});

test("history naming preserves conversation order and excludes tool output", () => {
	assert.equal(
		getConversationTranscript(conversation),
		"User: Plan the billing migration\n\nAssistant: Start with a backup\n\nUser: Then migrate invoices",
	);
});

test("sessions without user or assistant text have nothing to name", () => {
	const entries: SessionEntry[] = [
		{ type: "custom" },
		{ type: "message", message: { role: "user", content: [{ type: "image" }] } },
		{ type: "message", message: { role: "toolResult", content: "Tool output" } },
	];
	assert.equal(getFirstUserMessageText(entries), null);
	assert.equal(getConversationTranscript(entries), "");
});
