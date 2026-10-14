## Git Policy

Default policy: the agent may edit and verify files; the user reviews and
commits unless they explicitly ask the agent to commit. Follow
`patterns/GIT_WORKFLOW.md` for commit requests, dirty worktrees, diff hygiene,
and project commit-message language preferences.

- `gi пуш` / `ги пуш` explicitly requests a scoped commit followed by a push;
  `gi только пуш` requests a push of existing commits only. A project rule that
  the user commits by default does not cancel these explicit commands. An
  unconditional project-local ban on agent commits does override them: report
  the conflict instead of treating `gi пуш` as push-only or suggesting a manual
  commit followed by the same command.
- If no eligible selected changes need a new commit, `gi push` / `ги пуш`
  still pushes existing outgoing commits to the configured upstream after the
  compact Git safety checks. Do not create an empty commit or require a second
  push-only command. If there is nothing to commit or push, report that state.
  Never skip eligible selected changes to turn a commit/push request into
  push-only execution.
- Before staging for a push, identify the current branch and its upstream. If
  no upstream exists, obtain the intended remote branch before committing and
  set tracking on the first push. Do not infer the destination from another
  remote branch that contains the current HEAD.

- Treat commit/push as the final task-write boundary: complete task-scoped
  tracked writes before staging, then recheck `git status --short` after the
  last mutation and after commit/push. Local and upstream HEAD equality does not
  prove that the worktree is clean. Never report a complete clean finish while
  a new task-scoped diff remains.
- Git finish does not start a project-memory audit, specification writeback,
  feature implementation, or product test cycle. Those belong to the
  implementation task. Perform only the requested Git operation and the
  compact Git safety checks below, unless a more specific project-local rule
  expressly requires another finish-time check.
- Treat Git finish as finalization, not as a new implementation or repair task.
  Use explicit user-selected changes first, then the active conversation task.
  If neither exists, a standalone `gi commit`, `gi push`, or `gi commit push`
  (including Russian aliases) selects the current repository's eligible tracked
  and untracked changes. This command-defined scope also applies in a new chat;
  do not ask whether to include all changes merely because chat history is absent
  or many files are dirty. Inspect the changes before staging, exclude secrets,
  prohibited content, generated noise, and known separately reserved work, and
  briefly report the selected scope and exclusions. Within an active task,
  never classify the whole dirty worktree as one package from apparent similarity.
  Ask only when a concrete conflicting scope instruction or inseparable excluded
  change prevents safe selection. `gi only push` never selects working-tree files.
- Treat `gi push all`, `ги пуш всё`, `ги пуш все`, and equivalent commit or
  commit/push forms as explicit selection of all eligible tracked and untracked
  changes in the verified current repository, including staged, unstaged,
  deleted, and pre-existing changes. This selection overrides the active-task
  default; do not silently narrow it to this chat's edits. Preserve concrete
  separate-work reservations and report conflicts with them. A new chat's
  ordinary `gi push` has the same repository scope when no narrower selection
  or active task exists; old summaries alone do not create an active task.
  All-changes selection does not include ignored files, other repositories,
  worktrees, or branches, and does not override safety exclusions or authorize
  force-push. `gi only push all` remains push-only.
- Before staging, inventory the full selection with
  `git status --short --untracked-files=all`, including existing staged changes.
  Account for every selected eligible change in the staged diff before commit;
  do not commit excluded staged changes or silently reset the user's index.
  After commit/push, report each remaining changed path with its exclusion
  reason or blocker. An eligible selected remainder makes the finish incomplete;
  matching upstream HEAD alone is not success. If an expected file is ignored,
  explain its ignore rule with `git check-ignore` instead of force-adding it.
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
- Exclude rebuildable application builds, frontend bundles, installers, and
  intermediate build output from staging and commits, including changes to
  already tracked output; allow scoped index removals from authorized cleanup.
  Keep output in dedicated ignored directories;
  retain source, build configuration, and dependency lockfiles in Git. Follow
  `patterns/AGENTS_RUNTIME/09-build-and-install.md` for authorized layout and
  tracking cleanup. Git finish alone does not authorize that cleanup; generated
  source and database migrations are not automatically build artifacts. An
  exception requires explicit approval of the exact output and storage approach.
