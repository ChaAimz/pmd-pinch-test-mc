# Project Workflows

Multi-step orchestration recipes for recurring tasks. Each workflow is a Markdown file describing the steps, the agent each step should run on, and the artifacts produced. Think of these as a "playbook" you can run by referencing the file in a prompt.

## Why a separate folder

- `commands/` = one-shot slash commands (single action).
- `skills/` = reusable expert behavior (HOW to do a thing).
- `workflows/` = multi-step plays that compose agents + skills + commands across phases.

## Suggested workflows for this project

| File | Purpose |
|---|---|
| `phase-c-implementation.md` | Tasks 15–23 of Plan 1 — Hybrid: TestRunner on Sonnet, REST/WS endpoints on Codex |
| `hardware-bringup.md` | Real device bring-up: COM scan → calibration → 10-loop dry run → 100-loop stress |
| `release-cut.md` | Tag → build → smoke-test → package → install on operator PC |
| `incident-triage.md` | Stuck/aborted session → replay parquet → identify state stuck → file fix PR |

## Template

```markdown
---
name: phase-c-implementation
owner: orchestrator
agents_used: [black, qa, docs]
---

# Phase C — Hybrid implementation

## Step 1 — TestRunner (Sonnet, inline)
- ...

## Step 2 — REST endpoints batch (Codex via /codex:rescue)
- ...

## Step 3 — WS integration test (qa agent)
- ...

## Step 4 — README polish + Phase C summary (docs agent)
- ...
```

Drop new workflow files here as the project grows. Commit them so the team uses the same playbooks.
