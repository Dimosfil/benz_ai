## Project Operation Commands

- Treat `gi prod`, `gi production`, `gi прод`, and `ги прод` as requests to
  publish the current development version of an online service into its
  documented production service folder. Use this only for services that run
  continuously against real remote APIs, webhooks, chats, marketplaces,
  payment providers, or other live external systems. Normal development,
  refactoring, tests, formatting, cleanup, and `gi restart` operate on the
  development checkout/service and must not edit, stop, reset, or test against
  the production service folder unless the user explicitly invokes the
  production command or local instructions define a stricter production
  workflow. Before `gi prod`, read project-local run/deploy instructions,
  service contracts, production folder config, secret-handling rules, ignore
  rules, and verification requirements. The production folder is a live runtime
  target, not the editable source of truth: never copy production secrets,
  databases, logs, caches, user data, or remote API state back into development.
  Build or prepare the documented artifact from the development checkout,
  exclude dev caches and generated noise, sync only approved source/build files
  into the production folder, preserve production-local config and secrets, and
  use an atomic or backup/rollback-friendly handoff when local tooling supports
  it. If the production folder, include/exclude rules, restart/switchover
  command, health check, or rollback path is undocumented, ask one short
  clarification question instead of guessing. After publishing, verify the
  production service with the documented health signal or harmless remote-API
  check and report exactly what was synced, what production-local state was
  preserved, whether the live service was restarted or left running, and any
  unverified risk. Follow `patterns/PROJECT_DEV_PROD_SERVICES.md`.
- Treat `gi set devops`, `gi devops`, `ги девопс`, and equivalent wording as a
  request to mark the current project as a deploy-infrastructure owner for GI
  migrations and deploy commands. Verify the active project identity first, then
  create or update an ignored local marker such as
  `tools/project-memory/devops.local.json` with non-secret metadata: role
  `deploy-owner`, timestamp, reason, and optional deploy entrypoint or gateway
  contract pointer. This marker exempts the current project from GI migrations
  that remove project-owned direct deploy scripts or FTP/SFTP config, because
  the project is the deploy gateway itself. It does not grant permission to read
  unrelated projects, expose secrets, edit private gateway config from a
  consuming project, or treat any unmarked project as deploy infrastructure.
- Treat `gi deploy`, `ги деплой`, `gi deploy <method-or-path>`, and
  `ги деплой <способ-или-путь>` as requests to deploy the current project or site
  through the explicitly named method, service, saved deploy gateway, or deploy
  gateway path. If the argument is an absolute or clearly project-local path,
  treat that path as a user-authorized external deploy gateway and record it as
  the current project's selected deploy gateway in an ignored local file such as
  `tools/deploy/deploy-gateway.local.json`; it does not become the active
  editable source project. Future short deploy commands without a method or path
  should reuse the saved gateway. Store only local selection metadata there, such
  as gateway path, entrypoint, source-path parameter, project id, deploy mode,
  and target name; keep credentials and private remote paths in the gateway's
  own ignored config or secret store. Before running anything from that gateway,
  read its local `AGENTS.md`, `COMMANDS.md`, and deploy runbook such as
  `docs/deploy.md` when present. Prefer the gateway's single documented
  entrypoint, for example `tools/deploy/deploy.ps1`, and pass the current project
  root as `-SourcePath` or the gateway's documented source parameter. Pass
  project id, deploy mode, target name, or hosting-project mapping only when the
  gateway contract defines them. Do not infer credentials, print secrets, edit
  the gateway's private local config, run arbitrary helper commands from the
  gateway, or switch to treating the gateway as the product being deployed. If no
  argument is supplied and no selected gateway exists, stop and ask the user to
  make the full first call, for example `gi deploy <method-or-path>` /
  `ги деплой <способ-или-путь>`. Do not reinterpret a bare first `gi deploy` as
  `gi prod`, direct FTP upload, a build, or another deployment workflow. If the
  gateway contract, required entrypoint, source-path parameter, target mapping,
  or deploy mode is missing, ask one short clarification question instead of
  guessing.
- When the user's task explicitly targets preparing or repairing the deploy
  gateway itself, work in that gateway project and create or update the reusable
  deploy contract there: `AGENTS.md`, `COMMANDS.md`, a deploy runbook such as
  `docs/deploy.md`, one documented entrypoint such as
  `tools/deploy/deploy.ps1`, redacted config examples, and verification or
  rollback notes. Keep real secrets and private target paths in the gateway's
  ignored local config or secret store, not in shared instructions or consuming
  projects.
- During GI update migrations that retire project-owned direct deployment,
  non-devops projects must remove, disable, or stop relying on their own direct
  deploy/upload scripts, FTP/SFTP configs, and private deploy helpers. Preserve
  only ignored selected-gateway metadata such as
  `tools/deploy/deploy-gateway.local.json`, redacted examples, and documented
  build artifact contracts needed by the gateway. If the current project is not
  marked devops and no selected deploy gateway exists, stop and ask for the
  gateway path instead of uploading directly or creating a new personal deploy
  path. If the current project is marked devops, keep and maintain the deploy
  scripts/configuration as gateway-owned infrastructure.
- Treat `gi ftp <deploy-hub-path>` and `ги фтп <путь-к-deploy-хабу>` as the
  FTP/SFTP gateway variant: deploy the current project's configured build output
  through the user-provided deploy gateway path, using the gateway's documented
  entrypoint and passing the current project root as the source. Record the path
  as the current project's selected deploy gateway so later `gi ftp` / `ги фтп`
  can use it without repeating the path. The gateway owns FTP/SFTP
  configuration, destination selection, and secret references. Read its local
  instructions first, do not bypass the gateway by rewriting its private local
  JSON files, and do not upload directly unless the gateway contract explicitly
  delegates that operation back to the current project.
- When a deploy gateway accepts project registration, a `gi ftp <deploy-hub-path>`
  run for an unmapped current project should use the current project folder name
  as the default project id, derive the destination from the gateway's documented
  naming convention, register or update that project in the gateway-owned
  deploy registry, and continue through the gateway entrypoint. Unless the
  gateway contract explicitly names an existing target hostname, the derived
  public target must be project-scoped, such as a sanitized project id under the
  gateway's configured base domain. Do not target the apex/root domain, shared
  hub hostname, or another project's hostname as the upload/provisioning target
  for an unmapped project. The project agent should not ask the user to choose a
  remote folder, project id, or subdomain when the gateway contract defines
  deterministic registration; it should use the documented project-id-to-hostname
  rule or stop with the missing gateway contract. The gateway must also record
  enough non-secret metadata for later hub or index maintenance, such as project
  id, public URL or target name, source identity, deploy artifact path, deploy
  time/status, and whether a visible project card is pending. A pending
  domain/hosting request does not by itself stop artifact upload: if the gateway
  contract defines a pending, staging, queue, or handoff upload target, build and
  upload the current artifact there, then report the public site as pending
  devops/hosting publication. If registration, target provisioning, or artifact
  selection cannot continue, do not report a vague blocker; return an explicit
  deploy error with the failed step, evidence, responsible system or owner, next
  required action, and the artifact/source state already recorded. Never fall
  back to a root/default remote path or upload the whole repository.
- Before reporting an unknown deploy project, missing target mapping, or
  provisioning blocker, inspect the gateway-owned registry plus any documented
  project inbox, pending queue, hub-card queue, or domain/hosting request list.
  If the current project already has a pending or errored inbox entry, treat that
  entry as the active deploy state. For a pending entry, update it with the
  latest build/source metadata when the gateway contract allows, upload the
  artifact to the gateway's documented pending/staging/handoff target when one
  exists, and report that devops/hosting publication is still pending. For an
  errored entry or rejected request, first determine whether the evidence is a
  fresh result from the current deploy attempt or only a stale, cached,
  screen-derived, or external quota/provisioning claim. Stale or indirect
  evidence is warning context, not a stop condition: say that a provisioning
  error may occur, then run the gateway's documented create/refresh/provisioning
  attempt when it is safe and non-destructive. Stop only after the current
  attempt returns an explicit error, or when the gateway contract has no
  documented way to attempt or refresh provisioning. The stop report must name
  the failed domain/hosting/provisioning step, evidence, responsible system or
  owner, next required action, and artifact/source state. Do not ask the user
  for a different remote folder, create a duplicate mapping, target the apex/root
  domain, or upload into the gateway root merely because the final
  hosting-project map is not ready yet. If the gateway provides a documented
  request/inbox workflow for new domains, subdomains, or hosting slots, create
  or refresh that non-secret request for the project-scoped hostname before deciding
  whether to continue artifact upload or return an explicit error.
- Treat `gi ftp`, `ги фтп`, `gi ftp push`, `ги фтп пуш`, `gi upload ftp`,
  `gi deploy ftp`, and `gi залей на фтп` as requests to upload the current
  project's configured build output to FTP, FTPS, or SFTP. Treat
  `gi ftp config`, `gi ftp конфиг`, and `ги фтп конфиг` as requests to create,
  inspect, or update the project-local FTP/SFTP config without uploading. Treat
  `gi ftp folder`, `gi ftp папка`, and `ги фтп папка` as requests to inspect,
  choose, or update the remote upload folder (`remotePath`) without uploading.
  Treat `gi ftp service`, `gi ftp сервис`, and `ги фтп сервис` as requests to
  manually register, inspect, or select an FTP/FTPS/SFTP service record in
  config-service without uploading. In non-devops projects, these commands must
  use the saved deploy gateway or ask for one; they must not create or use a
  project-owned direct FTP/SFTP deploy path. Direct project-local FTP/SFTP
  upload is allowed only in a project marked devops, or when a documented deploy
  gateway contract explicitly delegates that upload operation back to the
  current project. Read project-local deploy instructions and selected gateway
  metadata first; read `tools/deploy/ftp.local.json` only for a devops project
  or documented gateway delegation. When a devops project needs FTP and local
  config does not name a target service, query config-service for FTP-capable
  services.
  If exactly one matching service exists, use it after verifying its contract;
  if several exist, ask the user to choose with the same plain inline numbered
  checkbox marker style used by language selection. Keep secrets out of
  config-service:
  store only discovery metadata and secret references such as environment
  variable names. Keep project-specific deploy settings in the separate
  project-local config file rather than shared instructions or chat history.
  Treat upload stalls, hangs, repeated timeouts, and failed stream opens as
  failed FTP/FTPS transfers. When FTP/FTPS upload fails or is unreliable,
  immediately check the selected service contract, project-local config, and
  user-provided details for an authorized SSH-based SFTP route to the same
  remote deploy folder. If the needed SSH host, port, user, and credential
  reference are available, switch to SFTP over SSH before more FTP/FTPS upload
  variants and report that fallback. If they are missing, report the exact
  missing SFTP details instead of inventing credentials or retrying the same
  failing FTP path. Do not disable TLS certificate validation or accept invalid
  FTPS certificates as a routine fallback unless the deploy contract or current
  user message explicitly authorizes that degraded security path.
  Prefer `tools/deploy/ftp.local.example.json` only as a redacted shape. Do not
  commit hostnames, usernames, passwords, tokens, private keys, or private
  remote paths unless project policy explicitly marks them non-secret. Follow
  `patterns/PROJECT_FTP_DEPLOY.md`.
- Treat `gi reboot`, `ги ребут`, `gi restart`, and `ги рестарт` as requests to
  start or restart all documented applications in the current project using
  project-local run instructions. Before starting anything, identify the full
  app set from local run instructions, manifests, service records, desktop
  packaging metadata, or project memory; do not assume a successful web/API
  start covers the project. For local web/API services, resolve the service id,
  port, URL, and neighboring endpoints through config-service before running a
  start command; fixed ports in local runbooks or examples do not authorize a
  fallback bind. If the resolved port is occupied, verify whether the owner is
  the same documented service instance using project-local identity signals
  such as service id, command, cwd, health endpoint, or process metadata. If the
  port belongs to another service or ownership is unclear, stop and report the
  port-conflict blocker; do not stop the owner without explicit user approval
  and do not move the requested app to another port. If the owner is the same
  service, restart or reuse it only through the documented run contract. If a
  config-service record is missing, use only the documented
  config-service registration workflow from `08-config-service-and-task-manager`
  to create or update it before startup, or stop with the exact missing
  contract. If local instructions define a preferred start/restart command that
  launches the full app set, use it only with the config-service-resolved local
  runtime values for web/API apps. Otherwise enumerate every documented app or
  runtime, such as desktop app, web/API app, and background workers, then
  restart each running app and start each missing app. Launch in the background
  so focus does not jump away from the user's current window. After launch, wait
  briefly and verify the documented startup success signal for each app:
  still-running expected processes, visible desktop windows when applicable,
  health/discovery endpoints for web/API apps, and relevant startup or crash
  logs when documented. The final report must account for each app by name or
  role with started/restarted/skipped status and verification evidence. Do not
  report reboot success from a PID alone, from a web health check alone, or
  while any expected desktop app, web/API app, or worker is unlaunched or
  unverified. If a documented desktop app lacks a launch command or window
  verification signal, report that as a blocker or partial failure instead of
  success. If any app exits, no expected window or health signal appears, or a
  new startup traceback is present, report the reboot as failed or partially
  unverified with the concrete evidence. Published hosting environments follow
  their hosting or production deploy contract and are not restarted by local
  `gi reboot` unless project-local production instructions explicitly define
  that behavior.
- Treat `gi docker`, `ги докер`, and equivalent Docker restart wording as a
  request to restart the current project's documented Docker or Docker Compose
  runtime, rebuilding first only when local Docker state requires it. Read
  project-local Docker/run instructions, Dockerfile or Containerfile,
  `compose.yaml`, `compose.yml`, `docker-compose*.yml`, container scripts,
  manifests, service records, and project memory before touching containers. If
  the project has no Docker/Compose config and no documented Docker run
  contract, report that Docker is not configured for this project and stop
  instead of inventing commands. If Docker CLI, Docker Compose, or the Docker
  engine is unavailable or not running, report that blocker and do not claim a
  restart. Rebuild before restart when the image is missing, the local Docker
  contract says to rebuild, Dockerfile/Compose/build-context/dependency
  manifests changed since the known running image, or freshness cannot be
  confidently proven. Prefer project-documented commands; otherwise use the
  narrow project Compose operation, such as `docker compose up -d --build` when
  rebuilding is needed and `docker compose up -d` or the documented restart
  command when the existing image is current. Scope all operations to the
  current project only: do not prune Docker system state, remove volumes, delete
  images, or stop unrelated containers. After the operation, verify documented
  container status, health checks, mapped service URLs, and recent logs when
  failures appear, then report rebuilt/restarted/not-configured/blocked status
  with evidence.
- Treat `gi first test`, `gi первый тест`, and `ги первый тест` as requests to
  verify the current application's first-launch experience by resetting only
  documented project-owned app cache, generated state, temporary first-run
  profiles, and rebuildable local app settings. Read project-local run, cleanup,
  cache reset, and test instructions first. Do not delete user documents,
  production data, secrets, credentials, external service data, shared system
  caches, sibling projects, or arbitrary user-home folders. If exact reset
  paths, keys, scripts, or commands are missing, ask one short clarification
  question instead of guessing. After reset, start the app, run the documented
  first-launch smoke/onboarding checks, and report what was cleared, what
  passed, and what was intentionally left untouched.
- Treat `gi test task`, `gi testing task`, `gi тест таск`, `ги тест таск`,
  `gi задача теста`, and equivalent wording as requests to set the active
  release/full-system verification workload for the current project. The
  supplied task text is the user-selected scenario for the next `gi test`; it is
  not evidence that the scenario already passed. Record it in the
  project-local test task location when local instructions define one,
  otherwise keep it as current chat context and report where it is tracked.
  Do not replace this with a generic `gi test plan`, old task status, demo
  artifact, or stale handoff summary.
- Treat `gi test`, `ги тест`, `gi full test`, `gi release test`,
  `gi system test`, and equivalent full-project test wording as requests to
  run the current project's documented full verification flow against the
  active test task. Do not confuse this with `gi test plan`, which remains a
  plan-only command by default. First load the active test task from the current
  message or project-local memory; if none exists, ask one short question for
  the test task before running. Then read project-local instructions, README,
  manifests, runbooks, test configs, and source entry points needed to identify
  exact current commands, services, app set, ports, routes, payloads,
  environment variables, storage, auth, queues, workers, and health checks.
  Before executing the verification ladder, restore the project-owned runtime
  state to the documented default/factory baseline using the same reset contract
  as `gi default`, while preserving only project-local exclusions that are
  explicitly documented for the current project. Examples of exclusions may
  include secrets, production-local state, user data, configured external
  service credentials, or named persistent fixtures; browser `localStorage`,
  cookies, IndexedDB, generated test databases, runtime logs, queues, temporary
  worker state, and app caches are not exclusions unless the current project's
  reset contract says so. If the project has no documented reset targets or the
  reset would touch ambiguous user-owned data, stop with that blocker instead
  of running a dirty-state test. After reset, read back the effective runtime
  configuration from the project-local source of truth, such as config files,
  backend state, service discovery, or database metadata. UI-only browser state
  is not a valid source of truth for selected chain, preset, execution mode,
  ports, task, or service endpoints; if the live test depends on such a value,
  persist it through the documented backend or project-local config first, or
  report the missing contract as the blocker.
  Start or restart documented apps when needed, run the verification ladder
  through the broadest documented suite justified by the command, and report
  the task used, commands run, results, blockers, and unverified areas. For
  `gi test`, dry-run mode is retired as a validity path: do not use `--dry-run`,
  simulation mode, dispatcher-only execution, replayed logs, mock-only runs, or
  compile/unit-only checks as the test result, and do not run dry-run mode at
  all unless the user explicitly asks for that diagnostic mode. If explicitly
  requested, label it as diagnostic and never report it as a passed `gi test`.
  A full-system `gi test` must exercise the documented live runtime surface for
  the selected task, including application processes, API/backend, storage,
  queues or workers, UI/auth flows, service discovery, orchestrator or agent
  handoff loops, and health/contract endpoints when the project defines them.
  If the live services/apps/workers/UI cannot be started or reached, report
  `gi test` as blocked or not checked instead of substituting a dry-run. Old
  summaries, screenshots, completed demo artifacts, previous task statuses, and
  old chat snippets are evidence only; they do not satisfy a fresh `gi test`
  request. Rerun the current documented checks or report the exact blocker that
  prevents a rerun.
- Treat `gi default`, `gi defaults`, and `ги дефолт` as requests to restore the
  current project to its documented first-run/default state. Read project-local
  reset, cleanup, first-run, run, backup, and test instructions first. Use only
  documented reset scripts, paths, keys, or contracts for project-owned app
  state, generated caches, local settings, onboarding flags, temporary profiles,
  runtime logs, queues, worker state, generated test databases, browser storage
  for the app origin, and other rebuildable state. Preserve only exclusions
  explicitly documented by the current project; do not infer exclusions from old
  chat, screenshots, stale run artifacts, or browser state. Do not delete source
  files, project-memory specifications, instruction-kit files, user documents,
  production data, secrets, credentials, external service data, shared system
  caches, sibling projects, or arbitrary user-home folders. If reset targets are
  not documented, ask one short clarification question instead of guessing. If a
  reset could be irreversible or remove user-owned data, stop for explicit
  confirmation and prefer a backup or rename step when local rules allow it.
  After reset, start the project through documented run instructions, verify the
  default or first-launch success signals, and report what was reset, what was left
  untouched, what passed, and any blocker.
- Treat `gi install`, `gi инсталл`, `ги инсталл`, and obvious typo variants
  such as `gi иснтлл` as requests to build the current project and produce an
  installer. Use Windows as the default target platform when the user and the
  project-local packaging contract do not name a different platform. For
  Windows, use Inno Setup by default when no installer tool is named. If the
  user writes a program after `gi install` / `gi инсталл`, use that program as
  the preferred packaging tool. If the user names macOS, iOS, Android, Linux,
  or another platform, or the project-local packaging contract selects one,
  follow that platform's local build, signing, packaging, and artifact
  verification contract instead of falling back to Windows. Ask a short
  clarification question if the named platform is supported by the project but
  its packaging contract is missing or ambiguous. Read project-local build and
  packaging instructions, scripts, manifests, and installer configs first.
  Keep build instructions, packaging configs, signing/notarization/provisioning
  notes, verification notes, and produced installer artifacts separated by
  target platform in project-local folders or per-platform artifact manifests.
  Follow the project's existing packaging layout when it has one; when creating
  or repairing a layout, use platform-specific folders such as
  `packaging/windows/`, `packaging/macos/`, `packaging/ios/`,
  `packaging/android/`, `packaging/linux/`, or equivalent project-local names.
  Do not mix artifacts for different platforms in one unscoped output folder.
  Resolve the application version from project-local metadata such as
  manifests, package files, assembly attributes, release files, or installer
  configs before packaging; update the version in build output, installer
  metadata, and the installer filename or artifact name when the local tooling
  supports it.
  `restore`, dependency install, build, and test checks are prerequisites only:
  they do not complete `gi install` unless the packaging command also runs and
  a current installer artifact is produced or explicitly verified. Do not report
  the project as installed/restored when only verification ran; report the
  installer artifact path, version, and checks after successful packaging. Ask a
  short clarification question if the build, installer, or versioning contract
  is missing instead of inventing one.
- Treat `gi sql`, `gi sqlite`, `ги sql`, `ги sqlite`, `gi vector`,
  `gi вектор`, and `ги вектор` as requests to inspect project-memory retrieval
  readiness and current metrics. For SQL, read `tools/project-memory/rag-system.json`
  when present, run the local index stats command when available, count
  reviewable project-memory/spec files, compare the numbers with the configured
  or default SQLite activation limits, and report whether SQLite/FTS is absent,
  current, stale, or recommended. For vector, read vector and embedding metadata,
  check semantic corpus size and chunk count, run the vector adapter status
  command when available, compare the numbers with vector activation limits, and
  report collection, record count, index path, freshness caveats, and readiness.
  These are inspection commands by default; do not create external services,
  install heavy dependencies, upload data, or index private sources unless the
  user explicitly asks and project-local rules allow it.
- Treat `gi build`, `gi собрать`, `ги билд`, `ги собрать`, `gi rebuild`, and
  `ги ребилд` as requests to build or rebuild the current project or
  application only, producing the documented release/upload-ready output such
  as a static `dist/`, bundle, executable, package, or other artifact. Read
  project-local build or rebuild instructions, manifests, scripts, hosting
  base-path/public-path config, and packaging metadata before running the
  documented command.
  Do not treat these project build commands as dependency restore, tests-only
  verification, FTP/SFTP upload, production publication, installer packaging,
  or any RAG/GI tooling rebuild, and do not combine them with a RAG rebuild
  unless the user explicitly asks for both. If no project build/rebuild
  contract exists, ask one short clarification question instead of inventing a
  command. Use `gi ftp` for upload, `gi prod` for documented production
  publication, `gi install` for installer packaging, and `gi tools rebuild` or
  `gi rag rebuild` when the GI/RAG layer itself must be rebuilt.
- Treat `gi tools rebuild`, `gi rag rebuild`, `ги тулс ребилд`,
  `ги раг ребилд`, and equivalent full GI/RAG rebuild wording as requests to
  rebuild the current project's entire configured GI/RAG project-memory
  retrieval system from approved sources: source manifest, SQLite/FTS or
  structured memory indexes, chunk exports, vector indexes, adapter metadata,
  and retrieval eval/status checks. This is a heavy command and requires an
  explicit user confirmation immediately before running the full rebuild, even
  if the user requested the command by name. Before asking for confirmation,
  read `tools/project-memory/rag-system.json`, list the configured rebuild
  nodes, generated paths that may be replaced, expected local scripts or
  adapters, and privacy exclusions. Do not include secrets, private runtime
  data, ignored telemetry, or sources outside the current project root. After a
  successful rebuild, run the configured stats/status/eval checks, update local
  rebuild state such as `last_full_rebuild_migration` or per-node markers when
  present, and report changed generated artifacts without committing
  rebuildable indexes.
- Treat `gi tools rebuild sql`, `gi rag rebuild sql`,
  `gi tools rebuild vector`, `gi rag rebuild vector`,
  `gi tools rebuild chunks`, `gi rag rebuild chunks`,
  `gi tools rebuild manifest`, `gi rag rebuild manifest`,
  `gi tools rebuild evals`, `gi rag rebuild evals`, and Russian equivalents
  such as `ги тулс ребилд sql`, `ги раг ребилд sql`,
  `ги тулс ребилд вектор`, `ги раг ребилд вектор`,
  `ги тулс ребилд чанки`, `ги раг ребилд чанки`,
  `ги тулс ребилд манифест`, `ги раг ребилд манифест`,
  `ги тулс ребилд тесты`, and `ги раг ребилд тесты` as requests to rebuild only
  the named GI/RAG node. Read `rag-system.json`, run only the documented node
  command or local helper, then verify that node's status. Ask one short
  clarification question if the node is not configured instead of guessing a
  command. For an `evals` node, prefer machine-checkable retrieval checks that
  verify index health, count consistency, and expected source paths in top
  keyword, semantic, or hybrid results; do not treat an answer's wording as the
  primary eval target.
- During `gi обновить`, inspect each newly applied migration. If a migration
  changes RAG source rules, chunking, embedding metadata, SQLite/vector schemas,
  retrieval adapters, or project-memory index scripts, check the project's
  `rag-system.json` rebuild state. If the project has not rebuilt the affected
  RAG nodes for that migration, tell the user exactly which nodes are stale and
  ask for confirmation before running the full `gi tools rebuild`; for narrow
  migrations, run or offer the smallest documented node rebuild that satisfies
  the migration. Do not mark RAG rebuild state current until the rebuild and
  readback/status checks succeed.
