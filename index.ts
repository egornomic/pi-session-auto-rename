import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DynamicBorder, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { complete } from "@mariozechner/pi-ai";
import { Container, getEditorKeybindings, Input, type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";
import { getConversationTranscript, getFirstUserMessageText, sanitizeSessionName, type SessionEntry } from "./utils.ts";

const DEFAULT_MODEL_PROVIDER = "anthropic";
const DEFAULT_MODEL_ID = "claude-haiku-4-5";
const CONFIG_ENTRY_TYPE = "rename-ai-config";
const CONFIG_FILE_PATH = join(homedir(), ".pi", "agent", "extensions", "pi-session-auto-rename.json");

const NAME_PROMPT =
	"You create short, descriptive session names for chat sessions with AI based on the first user message in the chat. Use 2-6 words in Title Case. " +
	"Respond with only the name, no quotes or punctuation.";

const FULL_HISTORY_PROMPT =
	"You create short, descriptive session names for chat sessions with AI based on the full conversation history. Use 2-6 words in Title Case. " +
	"Respond with only the name, no quotes or punctuation.";

const NAMING_SYSTEM_PROMPT =
	"You create short, descriptive session names for chat sessions with AI. Use 2-6 words in Title Case. " +
	"Respond with only the name, no quotes or punctuation.";

type NameModelConfig = {
	provider: string;
	id: string;
};

function getDefaultModelConfig(): NameModelConfig {
	return {
		provider: DEFAULT_MODEL_PROVIDER,
		id: DEFAULT_MODEL_ID,
	};
}

function buildNamePrompt(firstMessage: string) {
	return {
		role: "user" as const,
		content: [
			{
				type: "text" as const,
				text: `${NAME_PROMPT}\n\nFirst user message:\n${firstMessage}`,
			},
		],
		timestamp: Date.now(),
	};
}

function buildHistoryPrompt(transcript: string) {
	return {
		role: "user" as const,
		content: [
			{
				type: "text" as const,
				text: `${FULL_HISTORY_PROMPT}\n\nConversation history:\n${transcript}`,
			},
		],
		timestamp: Date.now(),
	};
}

function notify(
	ctx: { hasUI: boolean; ui: { notify: (message: string, level: "info" | "warning" | "error") => void } },
	message: string,
	level: "info" | "warning" | "error",
) {
	if (ctx.hasUI) {
		ctx.ui.notify(message, level);
	}
}

function modelToRef(model: NameModelConfig): string {
	return `${model.provider}/${model.id}`;
}

function parseModelRef(value: string): NameModelConfig | null {
	const input = value.trim();
	const slashIndex = input.indexOf("/");
	if (slashIndex <= 0 || slashIndex === input.length - 1) return null;

	const provider = input.slice(0, slashIndex).trim();
	const id = input.slice(slashIndex + 1).trim();
	if (!provider || !id) return null;

	return { provider, id };
}

function normalizeModelConfig(data: unknown): NameModelConfig | null {
	if (!data || typeof data !== "object") return null;

	const provider = (data as { provider?: unknown }).provider;
	const id = (data as { id?: unknown }).id;
	if (typeof provider !== "string" || typeof id !== "string") return null;

	const normalizedProvider = provider.trim();
	const normalizedId = id.trim();
	if (!normalizedProvider || !normalizedId) return null;

	return {
		provider: normalizedProvider,
		id: normalizedId,
	};
}

function restoreSessionModelConfig(ctx: ExtensionContext): NameModelConfig | null {
	const entries = ctx.sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "custom" || entry.customType !== CONFIG_ENTRY_TYPE) continue;
		const data = normalizeModelConfig(entry.data);
		if (!data) continue;
		return data;
	}

	return null;
}

function restoreStoredModelConfig(): NameModelConfig | null {
	try {
		const content = readFileSync(CONFIG_FILE_PATH, "utf8");
		const parsed = JSON.parse(content) as unknown;
		return normalizeModelConfig(parsed);
	} catch {
		return null;
	}
}

function persistStoredModelConfig(model: NameModelConfig): boolean {
	try {
		mkdirSync(dirname(CONFIG_FILE_PATH), { recursive: true });
		writeFileSync(CONFIG_FILE_PATH, `${JSON.stringify(model, null, 2)}\n`, "utf8");
		return true;
	} catch {
		return false;
	}
}

function restoreModelConfig(ctx: ExtensionContext): NameModelConfig | null {
	const storedModel = restoreStoredModelConfig();
	if (storedModel) {
		return storedModel;
	}

	const sessionModel = restoreSessionModelConfig(ctx);
	if (sessionModel) {
		persistStoredModelConfig(sessionModel);
	}
	return sessionModel;
}

async function selectModelConfig(ctx: ExtensionContext, currentModel: NameModelConfig): Promise<NameModelConfig | null> {
	const availableModels = ctx.modelRegistry
		.getAvailable()
		.map((model) => ({ provider: model.provider, id: model.id }))
		.sort((a, b) => {
			const aRef = modelToRef(a);
			const bRef = modelToRef(b);
			return aRef.localeCompare(bRef);
		});

	if (availableModels.length === 0) {
		notify(ctx, "No models with configured auth are available.", "warning");
		return null;
	}

	if (!ctx.hasUI) {
		notify(ctx, "No interactive UI available. Use /name-ai-config provider/model", "warning");
		return null;
	}

	const selected = await ctx.ui.custom<NameModelConfig | null>((tui, theme, _kb, done) => {
		const kb = getEditorKeybindings();
		const currentRef = modelToRef(currentModel);
		const container = new Container();
		container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
		container.addChild(new Text(theme.fg("accent", theme.bold("Select Rename Model"))));
		container.addChild(new Text(theme.fg("muted", `Current: ${currentRef}`)));
		container.addChild(new Text(theme.fg("muted", "Search:")));

		const searchInput = new Input();
		container.addChild(searchInput);

		const listContainer = new Container();
		container.addChild(listContainer);

		const searchMatches = (model: NameModelConfig, query: string) => {
			if (!query) return true;
			const q = query.toLowerCase();
			const fullRef = modelToRef(model).toLowerCase();
			return fullRef.includes(q) || model.id.toLowerCase().includes(q) || model.provider.toLowerCase().includes(q);
		};

		const buildItems = (query: string): SelectItem[] => {
			return availableModels.filter((model) => searchMatches(model, query)).map((model) => ({
				value: modelToRef(model),
				label: model.id,
				description: model.provider,
			}));
		};

		let selectList: SelectList;
		let lastSelectedRef: string | undefined = currentRef;

		const rebuildList = () => {
			const query = searchInput.getValue().trim();
			const items = buildItems(query);

			const nextList = new SelectList(items, 10, {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			});

			nextList.onSelect = (item) => {
				const parsed = parseModelRef(item.value);
				if (!parsed) {
					done(null);
					return;
				}
				done(parsed);
			};
			nextList.onCancel = () => done(null);
			nextList.onSelectionChange = (item) => {
				lastSelectedRef = item.value;
			};

			const selectedIndex = lastSelectedRef ? items.findIndex((item) => item.value === lastSelectedRef) : -1;
			if (selectedIndex >= 0) {
				nextList.setSelectedIndex(selectedIndex);
			}

			selectList = nextList;
			listContainer.clear();
			listContainer.addChild(selectList);
		};

		rebuildList();

		container.addChild(new Text(theme.fg("dim", "type to search • ↑↓ navigate • enter select • esc cancel")));
		container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

		return {
			render(width: number) {
				return container.render(width);
			},
			invalidate() {
				container.invalidate();
			},
			handleInput(data: string) {
				if (
					kb.matches(data, "selectUp") ||
					kb.matches(data, "selectDown") ||
					kb.matches(data, "selectConfirm") ||
					kb.matches(data, "selectCancel")
				) {
					selectList.handleInput(data);
					const selectedItem = selectList.getSelectedItem();
					if (selectedItem) {
						lastSelectedRef = selectedItem.value;
					}
				} else {
					searchInput.handleInput(data);
					rebuildList();
				}
				tui.requestRender();
			},
		};
	});

	return selected;
}

export default function autoSessionName(pi: ExtensionAPI) {
	let namingAttempted = false;
	let namingInProgress = false;
	let nameModel: NameModelConfig = restoreStoredModelConfig() ?? getDefaultModelConfig();

	function setNameModel(model: NameModelConfig, persist = false): boolean {
		nameModel = model;
		if (!persist) return true;

		pi.appendEntry<NameModelConfig>(CONFIG_ENTRY_TYPE, model);
		return persistStoredModelConfig(model);
	}

	function restoreNameModel(ctx: ExtensionContext) {
		const restoredModel = restoreModelConfig(ctx);
		if (restoredModel) {
			setNameModel(restoredModel);
			return;
		}

		setNameModel(getDefaultModelConfig());
	}

	async function generateSessionName(
		ctx: {
			hasUI: boolean;
			ui: { notify: (message: string, level: "info" | "warning" | "error") => void };
			modelRegistry: {
				find: (provider: string, modelId: string) => { provider: string; id: string } | undefined;
				getApiKey: (model: { provider: string; id: string }) => Promise<string | undefined>;
			};
		},
		prompt: { role: "user"; content: Array<{ type: "text"; text: string }>; timestamp: number },
	): Promise<string | null> {
		try {
			const model = ctx.modelRegistry.find(nameModel.provider, nameModel.id);
			if (!model) {
				notify(ctx, `Rename model not found: ${modelToRef(nameModel)}`, "warning");
				return null;
			}

			const apiKey = await ctx.modelRegistry.getApiKey(model);
			if (!apiKey) {
				notify(ctx, `No API key for ${model.provider}. Configure it via /login or models.json.`, "warning");
				return null;
			}

			const response = await complete(
				model,
				{ systemPrompt: NAMING_SYSTEM_PROMPT, messages: [prompt] },
				{ apiKey, maxTokens: 128 },
			);
			const responseDebug = `model=${model.provider}/${model.id} stopReason=${response.stopReason}${response.errorMessage ? ` error=${response.errorMessage}` : ""} content=${JSON.stringify(response.content)}`;

			if (response.stopReason === "error") {
				notify(ctx, `Failed to name session: ${responseDebug}`, "warning");
				return null;
			}

			const rawName = response.content
				.filter((block): block is { type: "text"; text: string } => block.type === "text")
				.map((block) => block.text)
				.join("\n");
			const sessionName = sanitizeSessionName(rawName);

			if (!sessionName) {
				notify(ctx, `Session name response was empty: ${responseDebug}`, "warning");
				return null;
			}

			return sessionName;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			notify(ctx, `Failed to name session: ${message}`, "warning");
			return null;
		}
	}

	async function attemptNaming(ctx: {
		hasUI: boolean;
		ui: { notify: (message: string, level: "info" | "warning" | "error") => void };
		sessionManager: { getBranch: () => SessionEntry[] };
		modelRegistry: {
			find: (provider: string, modelId: string) => { provider: string; id: string } | undefined;
			getApiKey: (model: { provider: string; id: string }) => Promise<string | undefined>;
		};
	}) {
		if (namingAttempted || namingInProgress) return;
		if (pi.getSessionName()) return;

		const firstMessage = getFirstUserMessageText(ctx.sessionManager.getBranch());
		if (!firstMessage) return;

		namingAttempted = true;
		namingInProgress = true;

		try {
			const sessionName = await generateSessionName(ctx, buildNamePrompt(firstMessage));
			if (!sessionName) return;

			if (!pi.getSessionName()) {
				pi.setSessionName(sessionName);
				notify(ctx, `Session named: ${sessionName}`, "info");
			}
		} finally {
			namingInProgress = false;
		}
	}

	pi.registerCommand("name-ai-config", {
		description: "Configure model used by AI session naming",
		handler: async (args, ctx) => {
			if (args.trim()) {
				const parsed = parseModelRef(args);
				if (!parsed) {
					notify(ctx, "Usage: /name-ai-config provider/model", "warning");
					return;
				}

				const model = ctx.modelRegistry.find(parsed.provider, parsed.id);
				if (!model) {
					notify(ctx, `Model not found: ${modelToRef(parsed)}`, "warning");
					return;
				}

				const apiKey = await ctx.modelRegistry.getApiKey(model);
				if (!apiKey) {
					notify(ctx, `No API key for ${parsed.provider}. Configure it via /login or models.json.`, "warning");
					return;
				}

				const persisted = setNameModel(parsed, true);
				if (!persisted) {
					notify(ctx, `Rename model set to ${modelToRef(parsed)} for this runtime, but failed to persist it.`, "warning");
					return;
				}

				notify(ctx, `Rename model set to ${modelToRef(parsed)}`, "info");
				return;
			}

			notify(ctx, `Current rename model: ${modelToRef(nameModel)}`, "info");
			const selectedModel = await selectModelConfig(ctx, nameModel);
			if (!selectedModel) return;

			const persisted = setNameModel(selectedModel, true);
			if (!persisted) {
				notify(
					ctx,
					`Rename model set to ${modelToRef(selectedModel)} for this runtime, but failed to persist it.`,
					"warning",
				);
				return;
			}

			notify(ctx, `Rename model set to ${modelToRef(selectedModel)}`, "info");
		},
	});

	pi.registerCommand("name-ai", {
		description: "Name the session based on the full conversation history",
		handler: async (_args, ctx) => {
			const transcript = getConversationTranscript(ctx.sessionManager.getBranch());
			if (!transcript) {
				notify(ctx, "No user/assistant messages available to name this session.", "warning");
				return;
			}

			const sessionName = await generateSessionName(ctx, buildHistoryPrompt(transcript));
			if (!sessionName) return;

			pi.setSessionName(sessionName);
			notify(ctx, `Session named: ${sessionName}`, "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		namingAttempted = false;
		namingInProgress = false;

		restoreNameModel(ctx);
		await attemptNaming(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		restoreNameModel(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		namingAttempted = false;
		namingInProgress = false;

		restoreNameModel(ctx);
	});

	pi.on("session_fork", async (_event, ctx) => {
		namingAttempted = false;
		namingInProgress = false;

		restoreNameModel(ctx);
	});

	pi.on("message_end", async (_event, ctx) => {
		await attemptNaming(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		await attemptNaming(ctx);
	});
}
