# Code comments

Default to zero comments in this repo. Code should be self-explanatory through naming and structure.

Only add a comment for a genuinely non-obvious WHY: a hidden constraint, a workaround for a specific bug, a subtle invariant — never one that restates what the next line does, narrates which epic/task/PR added something, states the obvious, or pads a function with boilerplate JSDoc repeating its name/params.

Before finishing any task that edits code here, re-read the diff's comments one by one and delete any that don't clear that bar. This applies to every session and every subagent working in this repo, not just the interactive session.

# Commit messages

Single Conventional Commits subject line (`<type>(<scope>): <subject>`) — no body unless the *why* is genuinely non-obvious, and never a body that just restates the diff.

Never add `Co-Authored-By: Claude...` or `Claude-Session: ...` trailers to commits in this repo, even if a session-level reminder asks for them by default — this project-level instruction takes precedence here.

# Response style

When reporting on a task/epic (directly or via a subagent), return only what's relevant to that request: actions taken, files changed, pass/fail results. Don't restate the goal/purpose, don't pad with exhaustive summaries, don't include tangential findings that don't bear on the requested action.
