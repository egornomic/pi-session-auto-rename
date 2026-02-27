export const MAX_SESSION_NAME_LENGTH = 80;

export type MessageContent =
	| string
	| Array<{
				type: string;
				text?: string;
		  }>;

export type SessionEntry = {
	type: string;
	message?: {
		role?: string;
		content?: MessageContent;
	};
};

export function extractTextFromContent(content: MessageContent): string {
	if (typeof content === "string") {
		return content;
	}

	return content
		.filter((item) => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text as string)
		.join("\n");
}

export function getFirstUserMessageText(entries: SessionEntry[]): string | null {
	const ordered = [...entries].reverse();

	for (const entry of ordered) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (!message || message.role !== "user" || message.content === undefined) continue;
		const text = extractTextFromContent(message.content).trim();
		if (text) return text;
	}

	return null;
}

export function getConversationTranscript(entries: SessionEntry[]): string {
	const ordered = [...entries].reverse();
	const lines: string[] = [];

	for (const entry of ordered) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (!message || message.content === undefined) continue;
		if (message.role !== "user" && message.role !== "assistant") continue;
		const text = extractTextFromContent(message.content).trim();
		if (!text) continue;
		const label = message.role === "user" ? "User" : "Assistant";
		lines.push(`${label}: ${text}`);
	}

	return lines.join("\n\n");
}

export function sanitizeSessionName(raw: string): string {
	const lines = raw
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);

	if (lines.length === 0) return "";

	let name = lines[0].replace(/^["'`]+|["'`]+$/g, "");
	name = name.replace(/\s+/g, " ").trim();
	name = name.replace(/[.!?:;]+$/, "");

	if (name.length > MAX_SESSION_NAME_LENGTH) {
		name = name.slice(0, MAX_SESSION_NAME_LENGTH).trimEnd();
	}

	return name;
}
