# Deploying the Gym Tracker to Render

This app is ready for a permanent phone URL on Render. It stays fully open by design: anyone with the URL can select any nickname in the picker.

## What Render Will Run

The included `render.yaml` creates one Node web service:

- Service name: `nickname-gym-tracker`
- Runtime: Node
- Region: `ohio`
- Plan: `starter`
- Build command: `npm run check`
- Start command: `npm start`
- Health check path: `/api/health`
- Persistent disk: `tracker-data`
- Disk mount path: `/opt/render/project/src/storage`
- Data file: `/opt/render/project/src/storage/tracker-db.json`

The persistent disk matters because Render's normal filesystem is temporary. Anything written outside the disk can disappear after a deploy or restart.

## Step 1: Put The Project On GitHub

Render deploys from a GitHub, GitLab, or Bitbucket repository. The simplest non-technical path is GitHub:

1. Go to `https://github.com/new`.
2. Create a repository, for example `gym-tracker`.
3. Upload this project folder's files to that repository.
4. Do not upload `data/tracker-db.json`, `.tmp-run`, or `.tmp-smoke`; they are ignored by `.gitignore`.

## Step 2: Create The Render Service

1. Go to `https://dashboard.render.com`.
2. Choose `New` -> `Blueprint`.
3. Connect the GitHub repository that contains this project.
4. Render should detect `render.yaml`.
5. Confirm the service settings and create the Blueprint.
6. Wait for the deploy to finish.

Render will give you a public URL like:

```text
https://nickname-gym-tracker.onrender.com
```

Open that URL on your iPhone. In Safari, you can use Share -> Add to Home Screen.

## After Deployment

Test these flows from the phone URL:

- Create two nicknames.
- Log a workout.
- Refresh the page and confirm the workout is still there.
- Edit or hide an exercise.
- Toggle settings for energy, rest, and RIR.
- Redeploy or restart the service in Render and confirm data still exists.

## Important Notes

- The app has no password, email, PIN, or access code.
- The Render URL is public.
- Persistent disk services cannot scale to multiple instances on Render.
- Deploys with a persistent disk may have a short restart window.
