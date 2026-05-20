# Project Memory

Shared memory notes for the team. Drop short Markdown files here when something is worth remembering across sessions and contributors — incidents, design decisions, hardware quirks, vendor support notes.

This is intentionally NOT the same as Claude Code's per-user auto-memory (which lives at `~/.claude/projects/.../memory/`). That one belongs to the individual developer. This folder is shared via git.

## Suggested layout

```
.claude/memory/
  hardware/
    plc-rs485-quirk.md     # the wiring fix we found the hard way
    imada-baud-mismatch.md
  incidents/
    2026-04-12-clamp-stuck.md   # postmortem
  vendors/
    keyence-support-rep.md      # contact + ticket history
```

## Per-file template

```markdown
# <one-line title>

**Date:** YYYY-MM-DD
**Author:** <name>
**Tags:** hardware, plc, incident, ...

## What happened / What we learned

…

## Why it matters

…

## How to act on it

…
```

Keep entries terse. Link out to PR / commit / spec sections rather than duplicating their content here.

> If you're looking for the design spec, that's at `docs/superpowers/specs/`.
> If you're looking for implementation plans, that's at `docs/superpowers/plans/`.
> This folder is for the *operational knowledge* that doesn't fit either.
