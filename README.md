# Gym Tracker

Mobile-first nickname-based gym tracker for logging workouts, exercises, set rows, reps, pounds, rest time, pre-workout energy, and RIR.

## Run Locally

```powershell
node server.mjs
```

Open:

```text
http://localhost:3000
```

If this Codex desktop shell says the `node` app alias is blocked, use the bundled runtime directly:

```powershell
& 'C:\Users\danit\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' server.mjs
```

The app stores data through the server API in `data/tracker-db.json`. That file is ignored by Git so local workout data does not get committed.

## Test

```powershell
node scripts/smoke-test.mjs
```

## Check

```powershell
node --check server.mjs
node --check public/app.js
node --check scripts/smoke-test.mjs
```

## Version One Behavior

- Users are nicknames, not private accounts.
- Existing nicknames are visible in the picker.
- The selected nickname is remembered in that browser.
- Workouts are separated by nickname.
- Weight is pounds only.
- The exercise catalog is seeded from public wger-style exercise data with source metadata kept on every seeded exercise.

## Deployment Note

This version is ready to run on Render as a Node web service with a persistent disk. The deployment config lives in `render.yaml`, and the step-by-step guide is in `DEPLOYMENT.md`.

Vercel-style serverless hosting is not a good fit for the current file-backed data store because serverless files are not durable.
