# CLAUDE.md

All agent guidance for this repository lives in AGENTS.md. Claude Code imports it here:

@AGENTS.md

Claude-specific notes:
- When executing a plan task, follow `docs/plans/README.md`. One task per subagent is a good default. Tick the board line and the step checkboxes when the task's PR merges.
- Commits may be signed via the user's SSH agent. If signing fails, leave the work staged and report it. Never disable signing.
