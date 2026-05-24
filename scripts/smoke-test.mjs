import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tmpDir = path.join(root, ".tmp-smoke");
const dbFile = path.join(tmpDir, "tracker-db.json");
const port = 43117;
const baseUrl = `http://127.0.0.1:${port}`;

await rm(tmpDir, { recursive: true, force: true });
await mkdir(tmpDir, { recursive: true });

const server = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    TRACKER_DB_FILE: dbFile,
    TRACKER_DATA_DIR: tmpDir
  },
  stdio: ["ignore", "pipe", "pipe"]
});

function stopServer() {
  if (!server.killed) server.kill();
}

process.on("exit", stopServer);

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Server did not start in time.");
}

async function api(pathname, options = {}) {
  const init = {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    }
  };
  if (options.body && typeof options.body !== "string") init.body = JSON.stringify(options.body);
  const response = await fetch(`${baseUrl}${pathname}`, init);
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await waitForServer();

  const dani = (await api("/api/profiles", { method: "POST", body: { nickname: "Dani" } })).profile;
  const alex = (await api("/api/profiles", { method: "POST", body: { nickname: "Alex" } })).profile;

  let duplicateBlocked = false;
  try {
    await api("/api/profiles", { method: "POST", body: { nickname: "dani" } });
  } catch (error) {
    duplicateBlocked = error.status === 409;
  }
  assert(duplicateBlocked, "Duplicate nicknames should be blocked case-insensitively.");

  const exercises = (await api(`/api/exercises?profileId=${dani.id}&includeHidden=true`)).exercises;
  assert(exercises.length >= 40, "Seeded exercise catalog should be available.");

  const bench = exercises.find((exercise) => exercise.id === "barbell-bench-press");
  assert(bench, "Bench press seed should exist.");

  await api(`/api/exercises/${bench.id}/hide`, {
    method: "POST",
    body: { profileId: dani.id, hidden: true }
  });
  const daniVisible = (await api(`/api/exercises?profileId=${dani.id}`)).exercises;
  const alexVisible = (await api(`/api/exercises?profileId=${alex.id}`)).exercises;
  assert(!daniVisible.some((exercise) => exercise.id === bench.id), "Hidden exercise should disappear for that profile.");
  assert(alexVisible.some((exercise) => exercise.id === bench.id), "Hiding should not affect another profile.");

  await api(`/api/profiles/${dani.id}/settings`, {
    method: "PATCH",
    body: { showRest: false, showRir: false }
  });
  const profiles = (await api("/api/profiles")).profiles;
  assert(profiles.find((profile) => profile.id === dani.id).settings.showRest === false, "Settings should persist.");

  await api("/api/workouts", {
    method: "POST",
    body: {
      profileId: dani.id,
      date: "2026-05-19",
      startTime: "09:00",
      durationMinutes: 75,
      energyScore: 4,
      blocks: [
        {
          restSeconds: 90,
          exercises: [
            {
              exerciseId: "lat-pulldown",
              nameSnapshot: "Lat Pulldown",
              sets: [
                { reps: 10, weightLb: 90, rir: 2 },
                { reps: 8, weightLb: 100, rir: 1 }
              ]
            },
            {
              exerciseId: "seated-cable-row",
              nameSnapshot: "Seated Cable Row",
              sets: [
                { reps: 12, weightLb: 80, rir: 3 }
              ]
            }
          ]
        }
      ]
    }
  });

  await api("/api/workouts", {
    method: "POST",
    body: {
      profileId: dani.id,
      date: "2026-05-20",
      startTime: "10:00",
      durationMinutes: null,
      energyScore: null,
      blocks: [
        {
          restSeconds: null,
          exercises: [
            {
              exerciseId: "leg-press",
              nameSnapshot: "Leg Press",
              sets: [
                { reps: 10, weightLb: 180, rir: null }
              ]
            }
          ]
        }
      ]
    }
  });

  const daniWorkouts = (await api(`/api/workouts?profileId=${dani.id}`)).workouts;
  const alexWorkouts = (await api(`/api/workouts?profileId=${alex.id}`)).workouts;
  assert(daniWorkouts.length === 2, "Dani should have two workouts.");
  assert(alexWorkouts.length === 0, "Alex should have separate workout history.");
  const pullWorkout = daniWorkouts.find((workout) => workout.date === "2026-05-19");
  const blankDurationWorkout = daniWorkouts.find((workout) => workout.date === "2026-05-20");
  assert(pullWorkout.durationMinutes === 75, "Workout should store optional duration minutes.");
  assert(blankDurationWorkout.durationMinutes === null, "Blank workout duration should stay blank.");
  assert(pullWorkout.blocks[0].exercises.length === 2, "Workout should support multi-exercise blocks.");
  assert(pullWorkout.blocks[0].restSeconds === 90, "Rest should live on the workout block.");

  const template = (await api("/api/templates", {
    method: "POST",
    body: {
      profileId: dani.id,
      name: "Pull Day",
      blocks: pullWorkout.blocks
    }
  })).template;
  assert(template.name === "Pull Day", "Template should be saved with a name.");
  const daniTemplates = (await api(`/api/templates?profileId=${dani.id}`)).templates;
  const alexTemplates = (await api(`/api/templates?profileId=${alex.id}`)).templates;
  assert(daniTemplates.length === 1, "Dani should have one default workout.");
  assert(alexTemplates.length === 0, "Templates should be profile-specific.");

  let duplicateTemplateBlocked = false;
  try {
    await api("/api/templates", {
      method: "POST",
      body: {
        profileId: dani.id,
        name: "pull day",
        blocks: pullWorkout.blocks
      }
    });
  } catch (error) {
    duplicateTemplateBlocked = error.status === 409;
  }
  assert(duplicateTemplateBlocked, "Duplicate template names should be blocked per profile.");

  await api(`/api/templates/${template.id}?profileId=${dani.id}`, { method: "DELETE" });
  assert((await api(`/api/templates?profileId=${dani.id}`)).templates.length === 0, "Template deletion should persist.");

  const csvResponse = await fetch(`${baseUrl}/api/export/workouts.csv?profileId=${dani.id}`);
  const csv = await csvResponse.text();
  assert(csvResponse.ok, "CSV export should return successfully.");
  assert(csv.includes("profile_nickname,date,start_time,duration_minutes"), "CSV export should include duration headers.");
  assert(csv.includes("Dani,2026-05-19,09:00,75"), "CSV export should include the saved workout duration.");
  assert(csv.includes("90,1,Lat Pulldown"), "CSV export should include block rest and exercise details.");

  console.log("Smoke test passed.");
} finally {
  stopServer();
  await rm(tmpDir, { recursive: true, force: true });
}
