# Project-Scoped Skills

Skills live as folders here. Each skill folder has a `SKILL.md` with YAML frontmatter and the skill body. Claude Code auto-discovers skills in `.claude/skills/` and exposes them via the Skill tool.

## Structure

```
.claude/skills/
  pinch-test-runner-debug/
    SKILL.md
    helpers/
      replay-parquet.py
  hardware-bringup-checklist/
    SKILL.md
```

## SKILL.md template

```markdown
---
name: pinch-test-runner-debug
description: Debug a stuck or aborted test run by replaying its parquet waveforms and inspecting the last state transitions.
---

When the user reports a stuck or aborted test session, follow these steps:

1. List recent runs from `data/pinch.db` (`SELECT id, status, abort_reason FROM test_runs ORDER BY id DESC LIMIT 10`).
2. For each run, list the per-loop parquet files in `data/waveforms/<run_id>/`.
3. Use `python helpers/replay-parquet.py <path>` to print the peak/avg/hold values.
4. Cross-reference with the `state_change` events in `logs/app.log` for the same window.
5. Suggest the next state machine transition or PLC bit that should have fired.
```

## Suggested skills for this project

- `pinch-test-runner-debug` — replay a parquet + state transitions
- `hardware-bringup-checklist` — pre-deployment hardware-in-loop walkthrough
- `recipe-import-export` — import recipes from CSV / export to backup

Add a folder, write `SKILL.md`, commit. The skill becomes available on next session start.
