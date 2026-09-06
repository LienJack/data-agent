<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

## Task Commit Policy

- A task that changes repository files is complete only after those changes are committed to Git.
- Use one scoped commit per completed task by default. Stage only files owned by the current task; never include unrelated modified or untracked files from parallel work.
- Run the task's relevant validation before committing, and make the commit message describe the completed task accurately.
- If a safe scoped commit cannot be created, report the blocker and do not claim the task is complete.
- Do not amend, squash, rewrite, or otherwise alter existing commits unless the user explicitly requests it.
- An explicit user instruction not to commit overrides this policy for that task.

## Prohibited Tooling

- Do not use the Compound Engineering plugin (`compound-engineering@compound-engineering-plugin`) in this repository.
- This prohibition covers every `ce-*` skill, command, agent, subagent, tool, workflow, and any alias or package that exposes them.
- Use project-scoped Trellis helpers or standard Codex tooling instead.

## Test Resource Lifecycle

- Before browser or Docker tests, inspect existing task-owned sessions, processes, containers, ports, and memory use. Reuse one browser session and normally one active test page; do not launch another Chrome for each case, retry, or resume.
- Run resource-heavy builds and tests serially. Keep only the current scratch database and the containers required by the active test. Count all task-owned containers, including Sandbox network/egress sidecars; record the expected peak before starting.
- Stop or remove completed task-owned temporary instances before starting the next batch. After success, failure, pause, or interruption, verify remaining processes, containers, ports, and memory; command exit alone is not cleanup evidence.
- Never terminate the user's browser or unrelated services, run global Docker prune, or delete retained volumes/evidence. In NAS mode, keep OrbStack off; do not restart a local VM for a test.
- Follow [.trellis/spec/backend/local-runtime-modes.md](.trellis/spec/backend/local-runtime-modes.md) section 8 for limits, ownership checks, and cleanup verification.
