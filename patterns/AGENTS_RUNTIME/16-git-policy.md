## Git Policy

Default policy: the agent may edit and verify files; the user reviews and
commits unless they explicitly ask the agent to commit. Follow
`patterns/GIT_WORKFLOW.md` for commit requests, dirty worktrees, diff hygiene,
and project commit-message language preferences.

- Treat commit/push as the final task-write boundary: complete task-scoped
  tracked writes before staging, then recheck `git status --short` after the
  last mutation and after commit/push. Local and upstream HEAD equality does not
  prove that the worktree is clean. Never report a complete clean finish while
  a new task-scoped diff remains.
- Treat Git finish as finalization of an already established scope, not as a new
  implementation or repair task. Resolve scope only from the active conversation
  task or explicit user-selected changes; never classify the whole dirty
  worktree as one package from apparent similarity. If scope is ambiguous, stop
  before staging or writes and ask what to include.
- A failed finish-time check does not by itself authorize product fixes, test
  rewrites, runtime-state deletion, dependency changes, service restarts, or
  broad cleanup. Correct only failures caused by the scoped work when the fix is
  already covered by the original task; otherwise report the blocker.
- Before staging, inspect untracked and unusually large files. Never add, stage,
  commit, or push content payloads such as LLM or other model
  weights/checkpoints, photos, video, audio, datasets, archives, or similar
  large binary artifacts. Store them outside Git and track only compact
  manifests, source URLs, checksums, or retrieval instructions. Add an ignore
  rule during finish only for active-task output or when already authorized;
  leave unrelated prohibited content unstaged and report it. Proceed only when
  the user explicitly approves an exact project-specific exception and storage
  approach.
