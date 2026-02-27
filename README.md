# pi-session-auto-rename

Auto-renames pi sessions using AI. The extension picks a short title from the first user message, and also provides commands to rename from full chat history and choose which model to use for naming.

## Install

```bash
pi install npm:pi-session-auto-rename
```

Or from git:

```bash
pi install git:github.com/egornomic/pi-session-auto-rename
```

## What it adds

- Automatic naming when a session starts or after first assistant response
- `/name-ai` command to rename from full conversation history
- `/name-ai-config` command to pick or set the naming model (`provider/model`)

## Example

```text
User first message: "Design a migration plan for our billing schema"
→ Session name: "Billing Schema Migration Plan"
```

## Notes

- The extension uses your configured model keys in pi.
- If no API key exists for the selected naming model, it shows a warning and keeps the current session name.
