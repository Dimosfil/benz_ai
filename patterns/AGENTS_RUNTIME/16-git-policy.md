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
- Never add, stage, commit, or push model weights or checkpoints, photos,
  video, audio, datasets, archives, or similar large binary content. Keep these
  payloads outside Git in project-approved artifact or object storage; commit
  only compact manifests, source URLs, checksums, or retrieval instructions.
  Inspect untracked and unusually large files before staging. Do not silently
  remove tracked content or rewrite history. Exceptions require explicit user
  approval for the exact content and the project-specific Git storage approach.
