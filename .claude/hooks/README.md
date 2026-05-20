# Project Hooks

Hooks let the harness run scripts in response to events (UserPromptSubmit, PreToolUse, PostToolUse, SessionStart, Stop, etc.). They are configured in `.claude/settings.json` under a `hooks` key, not by file presence here.

## Example: format Python on every Write/Edit

Add to `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/format-python.ps1"
          }
        ]
      }
    ]
  }
}
```

The script receives JSON on stdin describing the tool call. See https://docs.anthropic.com/en/docs/claude-code/hooks for the full event reference.

## Example: refuse to commit if pytest red

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/block-failing-commit.ps1"
          }
        ]
      }
    ]
  }
}
```

Drop the PowerShell / bash scripts in this folder and reference them in `settings.json`.
