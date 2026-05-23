# Deploying the Gym Tracker for Free

This app can run on Render's free web service tier as long as workout data is stored outside Render. The free deployment uses Supabase's free Postgres tier as the durable storage layer.

The app stays fully open by design: anyone with the URL can select any nickname in the picker.

## Why Not CSV or Excel Storage?

Render Free does not support persistent disks. Any file the app writes on Render Free, whether JSON, CSV, or Excel, can disappear when the service restarts or redeploys.

The app includes CSV export for Excel backup, but live app storage should use Supabase.

## Step 1: Create Supabase Storage

1. Go to `https://supabase.com/dashboard`.
2. Create a free project.
3. Open `SQL Editor`.
4. Run the SQL in `supabase/schema.sql`.
5. Open `Project Settings` -> `API`.
6. Copy:
   - Project URL
   - Service role key

Keep the service role key private. It must only go in Render environment variables, never in browser code.

## Step 2: Configure Render Free

Use these Render settings:

- Service type: `Web Service`
- Repository: `RogueNimbus/gym-tracker`
- Branch: `main`
- Runtime: `Node`
- Instance type: `Free`
- Build command: `npm run check`
- Start command: `npm start`
- Health check path: `/api/health`

Add these environment variables:

```text
SUPABASE_URL=<your Supabase Project URL>
SUPABASE_SERVICE_ROLE_KEY=<your Supabase service role key>
SUPABASE_TABLE=app_state
```

Do not add a Render disk on the free plan.

## Step 3: Deploy and Test

After Render deploys, open the public URL on your phone.

Test these flows:

- Create two nicknames.
- Log a workout.
- Refresh the page and confirm the workout is still there.
- Edit or hide an exercise.
- Toggle settings for energy, rest, and RIR.
- Use History -> `Export CSV` and open the file in Excel.
- Redeploy or restart the Render service and confirm data still exists.

## Important Notes

- The app has no password, email, PIN, or access code.
- The Render URL is public.
- Render Free services can sleep after inactivity, so the first load may be slow.
- Supabase is the source of truth for deployed workout data.
