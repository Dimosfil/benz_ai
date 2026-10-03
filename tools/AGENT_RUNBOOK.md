# Agent Runbook

Every command should be copy-pasteable from the project root.

## Install

```powershell
npm install
```

## Run

```powershell
npm start
```

## Test

GI chat commands: `gi test` explains the tester; `gi test start` executes the
selected local scenario; `gi full test` requests full-system verification.
The commands below and README are the current testing entrypoint. A canonical
scenario inventory, input policy, evidence paths and restoration contracts
remain undefined. Use `templates/PROJECT_TESTING.template.md` as an optional
authoring scaffold, preserving the actual commands. Scenarios needing content
must define approved sources or synthetic preparation, destination fields,
input acceptance and cleanup/retention.

```powershell
npm test
```

## Build

```powershell
docker compose build
```

Release artifact: local OCI image `benz-ai:local`.

## Docker Run

```powershell
docker compose up -d
docker compose ps
Invoke-RestMethod -Uri http://127.0.0.1:3000/api/health
```

The container runs as the non-root `node` user on a read-only root filesystem.
Compose injects only the explicitly allowlisted Benz AI settings from ignored
`.env`; no `.env` file is copied into the image.

## Smoke Check

```powershell
npm start
```

Expected result:

```text
The server starts and serves the web app at http://localhost:3000.
```

## Logs

```powershell
# Server logs are printed to the terminal running npm start or npm run dev.
```

## Environment Notes

- Optional: set GEOCODER_USER_AGENT before public or repeated geocoding use.
- Development watch mode: `npm run dev`.
