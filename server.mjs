import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.TRACKER_DATA_DIR || path.join(__dirname, "data");
const DB_FILE = process.env.TRACKER_DB_FILE || path.join(DATA_DIR, "tracker-db.json");
const SEED_FILE = path.join(__dirname, "data", "seed-exercises.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const WGER_SOURCE_URL = "https://wger.de/api/v2/exercise/";
const WGER_LICENSE = "CC-BY-SA 3.0, per wger documentation for initial exercise data";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || "app_state";
const SUPABASE_STATE_ID = process.env.SUPABASE_STATE_ID || "default";
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const SCHEMA_VERSION = 3;

let writeQueue = Promise.resolve();

function nowIso() {
  return new Date().toISOString();
}

function defaultSettings() {
  return {
    showEnergy: true,
    showRest: true,
    showRir: true
  };
}

function normalizeDb(db) {
  let changed = false;

  if (db.schemaVersion !== SCHEMA_VERSION) {
    db.schemaVersion = SCHEMA_VERSION;
    changed = true;
  }
  db.profiles = Array.isArray(db.profiles) ? db.profiles : [];
  db.exercises = Array.isArray(db.exercises) ? db.exercises : [];
  db.workouts = Array.isArray(db.workouts) ? db.workouts : [];
  db.templates = Array.isArray(db.templates) ? db.templates : [];

  for (const profile of db.profiles) {
    const previous = JSON.stringify(profile);
    profile.settings = { ...defaultSettings(), ...(profile.settings || {}) };
    profile.hiddenExerciseIds = profile.hiddenExerciseIds || [];
    profile.exerciseOverrides = profile.exerciseOverrides || {};
    profile.nicknameKey = profile.nicknameKey || profile.nickname.trim().toLowerCase();
    changed = changed || previous !== JSON.stringify(profile);
  }

  db.workouts = db.workouts.map((workout, index) => {
    const previous = JSON.stringify(workout);
    const normalized = normalizeStoredWorkout(workout, index);
    changed = changed || previous !== JSON.stringify(normalized);
    return normalized;
  });

  db.templates = db.templates.map((template, index) => {
    const previous = JSON.stringify(template);
    const normalized = normalizeStoredTemplate(template, index);
    changed = changed || previous !== JSON.stringify(normalized);
    return normalized;
  });

  return { db, changed };
}

async function createInitialDb() {
  const rawSeed = JSON.parse(await readFile(SEED_FILE, "utf8"));
  const createdAt = nowIso();
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt,
    profiles: [],
    exercises: rawSeed.map((exercise) => ({
      ...exercise,
      ownerProfileId: null,
      source: "wger/public exercise data",
      sourceUrl: WGER_SOURCE_URL,
      sourceLicense: WGER_LICENSE,
      createdAt,
      updatedAt: createdAt
    })),
    workouts: [],
    templates: []
  };
}

async function ensureDb() {
  if (USE_SUPABASE) {
    const existing = await readSupabaseDb();
    if (existing) {
      const { db, changed } = normalizeDb(existing);
      if (changed) await saveDb(db);
      return;
    }
    await saveDb(await createInitialDb());
    return;
  }

  await mkdir(DATA_DIR, { recursive: true });
  if (existsSync(DB_FILE)) {
    const { db, changed } = normalizeDb(await readDb());
    if (changed) await saveDb(db);
    return;
  }

  await saveDb(await createInitialDb());
}

async function readDb() {
  if (USE_SUPABASE) {
    const db = await readSupabaseDb();
    if (db) return normalizeDb(db).db;
    const initial = await createInitialDb();
    await saveDb(initial);
    return initial;
  }
  return JSON.parse(await readFile(DB_FILE, "utf8"));
}

async function saveDb(db) {
  if (USE_SUPABASE) {
    await saveSupabaseDb(db);
    return;
  }
  await writeFile(DB_FILE, `${JSON.stringify(db, null, 2)}\n`, "utf8");
}

async function supabaseRequest(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase storage error (${response.status}): ${text.slice(0, 300)}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function readSupabaseDb() {
  const rows = await supabaseRequest(`${encodeURIComponent(SUPABASE_TABLE)}?id=eq.${encodeURIComponent(SUPABASE_STATE_ID)}&select=data`, {
    method: "GET"
  });
  return rows?.[0]?.data || null;
}

async function saveSupabaseDb(db) {
  await supabaseRequest(`${encodeURIComponent(SUPABASE_TABLE)}?on_conflict=id`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({
      id: SUPABASE_STATE_ID,
      data: db,
      updated_at: nowIso()
    })
  });
}

function withDb(mutator) {
  const run = writeQueue.catch(() => undefined).then(async () => {
    const db = await readDb();
    const result = await mutator(db);
    await saveDb(db);
    return result;
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message, details = undefined) {
  sendJson(res, status, { error: message, details });
}

function sendText(res, status, body, headers = {}) {
  res.writeHead(status, {
    "cache-control": "no-store",
    ...headers
  });
  res.end(body);
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function workoutsCsv(profile, workouts) {
  const headers = [
    "workout_id",
    "profile_nickname",
    "date",
    "start_time",
    "duration_minutes",
    "energy_score",
    "block_order",
    "block_rest_seconds",
    "exercise_order",
    "exercise_name",
    "tracking_mode",
    "set_number",
    "reps",
    "weight_lb",
    "duration_seconds",
    "rir",
    "created_at"
  ];
  const rows = [headers];

  for (const workout of workouts) {
    for (const block of workoutBlocks(workout)) {
      for (const exercise of block.exercises) {
        for (const set of exercise.sets) {
          rows.push([
            workout.id,
            profile.nickname,
            workout.date,
            workout.startTime,
            workout.durationMinutes,
            workout.energyScore,
            block.order,
            block.restSeconds,
            exercise.order,
            exercise.nameSnapshot,
            trackingMode(exercise),
            set.setNumber,
            set.reps,
            set.weightLb,
            set.durationSeconds,
            set.rir,
            workout.createdAt
          ]);
        }
      }
    }
  }

  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

async function parseBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 1_000_000) {
      throw Object.assign(new Error("Request body is too large"), { status: 413 });
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { status: 400 });
  }
}

function publicProfile(profile) {
  return {
    id: profile.id,
    nickname: profile.nickname,
    createdAt: profile.createdAt,
    settings: { ...defaultSettings(), ...(profile.settings || {}) }
  };
}

function findProfile(db, profileId) {
  return db.profiles.find((profile) => profile.id === profileId);
}

function cleanText(value, fallback = "") {
  return String(value ?? fallback).trim().replace(/\s+/g, " ");
}

function validateNickname(nickname) {
  const clean = cleanText(nickname);
  if (clean.length < 1 || clean.length > 24) {
    return { ok: false, message: "Nickname must be 1 to 24 characters." };
  }
  if (!/^[A-Za-z0-9 _.-]+$/.test(clean)) {
    return { ok: false, message: "Nickname can use letters, numbers, spaces, dots, dashes, and underscores." };
  }
  return { ok: true, nickname: clean, key: clean.toLowerCase() };
}

function mergedExerciseForProfile(profile, exercise) {
  const override = profile?.exerciseOverrides?.[exercise.id] || {};
  return {
    ...exercise,
    ...override,
    id: exercise.id,
    ownerProfileId: exercise.ownerProfileId,
    source: exercise.source,
    sourceUrl: exercise.sourceUrl,
    sourceLicense: exercise.sourceLicense,
    hidden: Boolean(profile?.hiddenExerciseIds?.includes(exercise.id))
  };
}

function visibleExercises(db, profile, includeHidden = false) {
  return db.exercises
    .filter((exercise) => !exercise.ownerProfileId || exercise.ownerProfileId === profile.id)
    .map((exercise) => mergedExerciseForProfile(profile, exercise))
    .filter((exercise) => includeHidden || !exercise.hidden)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeExerciseFields(body) {
  const name = cleanText(body.name);
  if (!name || name.length > 80) {
    return { ok: false, message: "Exercise name must be 1 to 80 characters." };
  }
  return {
    ok: true,
    values: {
      name,
      category: cleanText(body.category || "Strength").slice(0, 40),
      muscleGroup: cleanText(body.muscleGroup || "General").slice(0, 80),
      equipment: cleanText(body.equipment || "Any").slice(0, 80)
    }
  };
}

function parseOptionalNumber(value, { min, max, integer = false } = {}) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  if (integer && !Number.isInteger(number)) return undefined;
  if (min !== undefined && number < min) return undefined;
  if (max !== undefined && number > max) return undefined;
  return number;
}

function timeIndex(value, allowEnd = false) {
  if (typeof value !== "string") return -1;
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return -1;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (![0, 30].includes(minute)) return -1;
  if (allowEnd && hour === 24 && minute === 0) return 48;
  if (hour < 0 || hour > 23) return -1;
  return hour * 2 + (minute === 30 ? 1 : 0);
}

function safeId(value) {
  const id = cleanText(value);
  return id || randomUUID();
}

function cleanOrder(value, fallback) {
  const order = Number(value);
  return Number.isInteger(order) && order > 0 ? order : fallback;
}

function storedNumber(value, options) {
  const parsed = parseOptionalNumber(value, options);
  return parsed === undefined ? null : parsed;
}

function durationFromTimes(startTime, endTime) {
  const startIndex = timeIndex(startTime);
  const endIndex = timeIndex(endTime, true);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) return null;
  return (endIndex - startIndex) * 30;
}

function trackingMode(exercise = {}) {
  return exercise.trackingMode === "time" ? "time" : "reps";
}

function normalizeStoredSet(set = {}, setIndex = 0) {
  return {
    id: safeId(set.id),
    setNumber: cleanOrder(set.setNumber, setIndex + 1),
    reps: storedNumber(set.reps, { min: 0, max: 999, integer: true }),
    weightLb: storedNumber(set.weightLb, { min: 0, max: 2000 }),
    durationSeconds: storedNumber(set.durationSeconds, { min: 0, max: 3600, integer: true }),
    rir: storedNumber(set.rir, { min: 0, max: 6, integer: true })
  };
}

function firstLegacyRestSeconds(exercise = {}) {
  const sets = Array.isArray(exercise.sets) ? exercise.sets : [];
  for (const set of sets) {
    const restSeconds = storedNumber(set?.restSeconds, { min: 0, max: 3600, integer: true });
    if (restSeconds !== null) return restSeconds;
  }
  return null;
}

function normalizeStoredExercise(exercise = {}, exerciseIndex = 0) {
  return {
    id: safeId(exercise.id),
    exerciseId: exercise.exerciseId || null,
    nameSnapshot: cleanText(exercise.nameSnapshot || exercise.name || "Exercise").slice(0, 80),
    trackingMode: trackingMode(exercise),
    order: cleanOrder(exercise.order, exerciseIndex + 1),
    sets: (Array.isArray(exercise.sets) ? exercise.sets : [])
      .map((set, setIndex) => normalizeStoredSet(set, setIndex))
  };
}

function normalizeStoredBlock(block = {}, blockIndex = 0) {
  return {
    id: safeId(block.id),
    order: cleanOrder(block.order, blockIndex + 1),
    restSeconds: storedNumber(block.restSeconds, { min: 0, max: 3600, integer: true }),
    exercises: (Array.isArray(block.exercises) ? block.exercises : [])
      .map((exercise, exerciseIndex) => normalizeStoredExercise(exercise, exerciseIndex))
      .filter((exercise) => exercise.sets.length > 0)
  };
}

function workoutBlocks(workout = {}) {
  if (Array.isArray(workout.blocks)) return workout.blocks;
  if (!Array.isArray(workout.exercises)) return [];
  return workout.exercises.map((exercise, exerciseIndex) => ({
    id: safeId(exercise.id),
    order: exerciseIndex + 1,
    restSeconds: firstLegacyRestSeconds(exercise),
    exercises: [exercise]
  }));
}

function normalizeStoredWorkout(workout = {}, workoutIndex = 0) {
  const durationMinutes = storedNumber(workout.durationMinutes, { min: 1, max: 1440, integer: true })
    ?? durationFromTimes(workout.startTime, workout.endTime);
  const normalized = {
    id: safeId(workout.id),
    profileId: cleanText(workout.profileId),
    date: cleanText(workout.date || todayLikeDate(workout.createdAt)),
    startTime: cleanText(workout.startTime),
    durationMinutes,
    energyScore: storedNumber(workout.energyScore, { min: 1, max: 5, integer: true }),
    blocks: workoutBlocks(workout)
      .map((block, blockIndex) => normalizeStoredBlock(block, blockIndex))
      .filter((block) => block.exercises.length > 0),
    createdAt: cleanText(workout.createdAt || nowIso()),
    updatedAt: cleanText(workout.updatedAt || workout.createdAt || nowIso())
  };
  if (workout.endTime) normalized.endTime = cleanText(workout.endTime);
  normalized.order = cleanOrder(workout.order, workoutIndex + 1);
  return normalized;
}

function todayLikeDate(value) {
  const text = cleanText(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : nowIso().slice(0, 10);
}

function normalizeStoredTemplate(template = {}, templateIndex = 0) {
  const name = cleanText(template.name || `Default workout ${templateIndex + 1}`).slice(0, 50);
  return {
    id: safeId(template.id),
    profileId: cleanText(template.profileId),
    name,
    nameKey: cleanText(template.nameKey || name.toLowerCase()),
    blocks: workoutBlocks(template)
      .map((block, blockIndex) => normalizeStoredBlock(block, blockIndex))
      .filter((block) => block.exercises.length > 0),
    createdAt: cleanText(template.createdAt || nowIso()),
    updatedAt: cleanText(template.updatedAt || template.createdAt || nowIso())
  };
}

function incomingBlocksFromBody(body) {
  if (Array.isArray(body.blocks)) return body.blocks;
  if (!Array.isArray(body.exercises)) return [];
  return body.exercises.map((exercise, exerciseIndex) => ({
    order: exerciseIndex + 1,
    restSeconds: firstLegacyRestSeconds(exercise),
    exercises: [exercise]
  }));
}

function normalizeIncomingBlocks(db, body) {
  const rawBlocks = incomingBlocksFromBody(body);
  if (rawBlocks.length === 0) {
    return { ok: false, status: 400, message: "Add at least one exercise before saving." };
  }

  const blocks = [];
  rawBlocks.forEach((block, blockIndex) => {
    const restSeconds = parseOptionalNumber(block.restSeconds, { min: 0, max: 3600, integer: true });
    if (restSeconds === undefined) {
      throw Object.assign(new Error("Rest time is outside the allowed range."), { status: 400 });
    }

    const rawExercises = Array.isArray(block.exercises) ? block.exercises : [];
    const exercises = [];
    rawExercises.forEach((exercise, exerciseIndex) => {
      const baseExercise = db.exercises.find((item) => item.id === exercise.exerciseId);
      const nameSnapshot = cleanText(exercise.nameSnapshot || baseExercise?.name || "Exercise").slice(0, 80);
      const mode = trackingMode(exercise);
      if (!Array.isArray(exercise.sets) || exercise.sets.length === 0) return;

      const sets = exercise.sets.map((set, setIndex) => {
        if (mode === "time") {
          const durationSeconds = parseOptionalNumber(set.durationSeconds, { min: 0, max: 3600, integer: true });
          if (durationSeconds === undefined) {
            throw Object.assign(new Error("Exercise time is outside the allowed range."), { status: 400 });
          }
          return {
            id: randomUUID(),
            setNumber: setIndex + 1,
            reps: null,
            weightLb: null,
            durationSeconds,
            rir: null
          };
        }

        const reps = parseOptionalNumber(set.reps, { min: 0, max: 999, integer: true });
        const weightLb = parseOptionalNumber(set.weightLb, { min: 0, max: 2000 });
        const rir = parseOptionalNumber(set.rir, { min: 0, max: 6, integer: true });
        if ([reps, weightLb, rir].some((value) => value === undefined)) {
          throw Object.assign(new Error("Set values are outside the allowed range."), { status: 400 });
        }

        return {
          id: randomUUID(),
          setNumber: setIndex + 1,
          reps,
          weightLb,
          durationSeconds: null,
          rir
        };
      });

      exercises.push({
        id: randomUUID(),
        exerciseId: exercise.exerciseId || null,
        nameSnapshot,
        trackingMode: mode,
        order: exerciseIndex + 1,
        sets
      });
    });

    if (exercises.length > 0) {
      blocks.push({
        id: randomUUID(),
        order: blockIndex + 1,
        restSeconds,
        exercises
      });
    }
  });

  if (blocks.length === 0) {
    return { ok: false, status: 400, message: "Add at least one set before saving." };
  }

  return { ok: true, blocks };
}

function validateTemplateName(name) {
  const clean = cleanText(name);
  if (clean.length < 1 || clean.length > 50) {
    return { ok: false, message: "Default workout name must be 1 to 50 characters." };
  }
  return { ok: true, name: clean, key: clean.toLowerCase() };
}

function normalizeWorkout(db, body) {
  const profile = findProfile(db, body.profileId);
  if (!profile) return { ok: false, status: 404, message: "Profile was not found." };

  const date = cleanText(body.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, status: 400, message: "Workout date is required." };
  }

  const startTime = cleanText(body.startTime);
  const startIndex = timeIndex(startTime);
  if (startIndex < 0) {
    return { ok: false, status: 400, message: "Workout start time must use 30-minute slots." };
  }

  const durationMinutes = parseOptionalNumber(body.durationMinutes, { min: 1, max: 1440, integer: true });
  if (durationMinutes === undefined) {
    return { ok: false, status: 400, message: "Workout duration must be blank or between 1 minute and 24 hours." };
  }

  const energyScore = parseOptionalNumber(body.energyScore, { min: 1, max: 5, integer: true });
  if (energyScore === undefined) {
    return { ok: false, status: 400, message: "Energy score must be between 1 and 5." };
  }

  const blocks = normalizeIncomingBlocks(db, body);
  if (!blocks.ok) return blocks;

  return {
    ok: true,
    workout: {
      id: randomUUID(),
      profileId: profile.id,
      date,
      startTime,
      durationMinutes,
      energyScore,
      blocks: blocks.blocks,
      createdAt: nowIso(),
      updatedAt: nowIso()
    }
  };
}

function normalizeTemplate(db, body) {
  const profile = findProfile(db, body.profileId);
  if (!profile) return { ok: false, status: 404, message: "Profile was not found." };

  const name = validateTemplateName(body.name);
  if (!name.ok) return { ok: false, status: 400, message: name.message };

  const blocks = normalizeIncomingBlocks(db, body);
  if (!blocks.ok) return blocks;

  return {
    ok: true,
    template: {
      id: randomUUID(),
      profileId: profile.id,
      name: name.name,
      nameKey: name.key,
      blocks: blocks.blocks,
      createdAt: nowIso(),
      updatedAt: nowIso()
    }
  };
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, storage: USE_SUPABASE ? "supabase" : "local-file" });
  }

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    const db = await readDb();
    return sendJson(res, 200, {
      profiles: db.profiles.map(publicProfile)
    });
  }

  if (req.method === "GET" && url.pathname === "/api/profiles") {
    const db = await readDb();
    return sendJson(res, 200, { profiles: db.profiles.map(publicProfile) });
  }

  if (req.method === "POST" && url.pathname === "/api/profiles") {
    const body = await parseBody(req);
    const validation = validateNickname(body.nickname);
    if (!validation.ok) return sendError(res, 400, validation.message);

    const profile = await withDb(async (db) => {
      if (db.profiles.some((item) => item.nicknameKey === validation.key)) {
        throw Object.assign(new Error("That nickname already exists."), { status: 409 });
      }
      const createdAt = nowIso();
      const nextProfile = {
        id: randomUUID(),
        nickname: validation.nickname,
        nicknameKey: validation.key,
        createdAt,
        settings: defaultSettings(),
        hiddenExerciseIds: [],
        exerciseOverrides: {}
      };
      db.profiles.push(nextProfile);
      return publicProfile(nextProfile);
    });
    return sendJson(res, 201, { profile });
  }

  const settingsMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)\/settings$/);
  if (req.method === "PATCH" && settingsMatch) {
    const body = await parseBody(req);
    const profile = await withDb(async (db) => {
      const nextProfile = findProfile(db, settingsMatch[1]);
      if (!nextProfile) throw Object.assign(new Error("Profile was not found."), { status: 404 });
      const nextSettings = { ...defaultSettings(), ...nextProfile.settings };
      for (const key of ["showEnergy", "showRest", "showRir"]) {
        if (key in body) nextSettings[key] = Boolean(body[key]);
      }
      nextProfile.settings = nextSettings;
      return publicProfile(nextProfile);
    });
    return sendJson(res, 200, { profile });
  }

  if (req.method === "GET" && url.pathname === "/api/exercises") {
    const db = await readDb();
    const profile = findProfile(db, url.searchParams.get("profileId"));
    if (!profile) return sendError(res, 404, "Profile was not found.");
    const includeHidden = url.searchParams.get("includeHidden") === "true";
    return sendJson(res, 200, { exercises: visibleExercises(db, profile, includeHidden) });
  }

  if (req.method === "POST" && url.pathname === "/api/exercises") {
    const body = await parseBody(req);
    const normalized = normalizeExerciseFields(body);
    if (!normalized.ok) return sendError(res, 400, normalized.message);

    const exercise = await withDb(async (db) => {
      const profile = findProfile(db, body.profileId);
      if (!profile) throw Object.assign(new Error("Profile was not found."), { status: 404 });
      const createdAt = nowIso();
      const nextExercise = {
        id: randomUUID(),
        ...normalized.values,
        ownerProfileId: profile.id,
        source: "custom",
        sourceUrl: null,
        sourceLicense: "User-created",
        createdAt,
        updatedAt: createdAt
      };
      db.exercises.push(nextExercise);
      return mergedExerciseForProfile(profile, nextExercise);
    });
    return sendJson(res, 201, { exercise });
  }

  const exerciseMatch = url.pathname.match(/^\/api\/exercises\/([^/]+)$/);
  if (req.method === "PATCH" && exerciseMatch) {
    const body = await parseBody(req);
    const normalized = normalizeExerciseFields(body);
    if (!normalized.ok) return sendError(res, 400, normalized.message);

    const exercise = await withDb(async (db) => {
      const profile = findProfile(db, body.profileId);
      if (!profile) throw Object.assign(new Error("Profile was not found."), { status: 404 });
      const baseExercise = db.exercises.find((item) => item.id === exerciseMatch[1]);
      if (!baseExercise) throw Object.assign(new Error("Exercise was not found."), { status: 404 });

      if (baseExercise.ownerProfileId === profile.id) {
        Object.assign(baseExercise, normalized.values, { updatedAt: nowIso() });
      } else {
        profile.exerciseOverrides[baseExercise.id] = {
          ...(profile.exerciseOverrides[baseExercise.id] || {}),
          ...normalized.values,
          updatedAt: nowIso()
        };
      }
      return mergedExerciseForProfile(profile, baseExercise);
    });
    return sendJson(res, 200, { exercise });
  }

  const hideMatch = url.pathname.match(/^\/api\/exercises\/([^/]+)\/hide$/);
  if (req.method === "POST" && hideMatch) {
    const body = await parseBody(req);
    const exercise = await withDb(async (db) => {
      const profile = findProfile(db, body.profileId);
      if (!profile) throw Object.assign(new Error("Profile was not found."), { status: 404 });
      const baseExercise = db.exercises.find((item) => item.id === hideMatch[1]);
      if (!baseExercise) throw Object.assign(new Error("Exercise was not found."), { status: 404 });

      const hiddenSet = new Set(profile.hiddenExerciseIds || []);
      if (body.hidden) hiddenSet.add(baseExercise.id);
      else hiddenSet.delete(baseExercise.id);
      profile.hiddenExerciseIds = [...hiddenSet];
      return mergedExerciseForProfile(profile, baseExercise);
    });
    return sendJson(res, 200, { exercise });
  }

  if (req.method === "GET" && url.pathname === "/api/templates") {
    const db = await readDb();
    const profile = findProfile(db, url.searchParams.get("profileId"));
    if (!profile) return sendError(res, 404, "Profile was not found.");
    const templates = db.templates
      .filter((template) => template.profileId === profile.id)
      .sort((a, b) => a.name.localeCompare(b.name));
    return sendJson(res, 200, { templates });
  }

  if (req.method === "POST" && url.pathname === "/api/templates") {
    const body = await parseBody(req);
    const normalized = normalizeTemplate(await readDb(), body);
    if (!normalized.ok) return sendError(res, normalized.status, normalized.message);
    const template = await withDb(async (db) => {
      const fresh = normalizeTemplate(db, body);
      if (!fresh.ok) throw Object.assign(new Error(fresh.message), { status: fresh.status });
      if (db.templates.some((item) => item.profileId === fresh.template.profileId && item.nameKey === fresh.template.nameKey)) {
        throw Object.assign(new Error("That default workout name already exists."), { status: 409 });
      }
      db.templates.push(fresh.template);
      return fresh.template;
    });
    return sendJson(res, 201, { template });
  }

  const templateMatch = url.pathname.match(/^\/api\/templates\/([^/]+)$/);
  if (req.method === "DELETE" && templateMatch) {
    const profileId = url.searchParams.get("profileId");
    const result = await withDb(async (db) => {
      const index = db.templates.findIndex((template) => template.id === templateMatch[1] && template.profileId === profileId);
      if (index < 0) throw Object.assign(new Error("Default workout was not found."), { status: 404 });
      db.templates.splice(index, 1);
      return { ok: true };
    });
    return sendJson(res, 200, result);
  }

  if (req.method === "GET" && url.pathname === "/api/workouts") {
    const db = await readDb();
    const profile = findProfile(db, url.searchParams.get("profileId"));
    if (!profile) return sendError(res, 404, "Profile was not found.");
    const workouts = db.workouts
      .filter((workout) => workout.profileId === profile.id)
      .sort((a, b) => `${b.date} ${b.startTime}`.localeCompare(`${a.date} ${a.startTime}`));
    return sendJson(res, 200, { workouts });
  }

  if (req.method === "GET" && url.pathname === "/api/export/workouts.csv") {
    const db = await readDb();
    const profile = findProfile(db, url.searchParams.get("profileId"));
    if (!profile) return sendError(res, 404, "Profile was not found.");
    const workouts = db.workouts
      .filter((workout) => workout.profileId === profile.id)
      .sort((a, b) => `${b.date} ${b.startTime}`.localeCompare(`${a.date} ${a.startTime}`));
    const safeNickname = profile.nickname.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "workouts";
    return sendText(res, 200, workoutsCsv(profile, workouts), {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${safeNickname}-workouts.csv"`
    });
  }

  if (req.method === "POST" && url.pathname === "/api/workouts") {
    const body = await parseBody(req);
    const normalized = normalizeWorkout(await readDb(), body);
    if (!normalized.ok) return sendError(res, normalized.status, normalized.message);
    const workout = await withDb(async (db) => {
      const fresh = normalizeWorkout(db, body);
      if (!fresh.ok) throw Object.assign(new Error(fresh.message), { status: fresh.status });
      db.workouts.push(fresh.workout);
      return fresh.workout;
    });
    return sendJson(res, 201, { workout });
  }

  const workoutMatch = url.pathname.match(/^\/api\/workouts\/([^/]+)$/);
  if (req.method === "PATCH" && workoutMatch) {
    const body = await parseBody(req);
    const normalized = normalizeWorkout(await readDb(), body);
    if (!normalized.ok) return sendError(res, normalized.status, normalized.message);
    const workout = await withDb(async (db) => {
      const index = db.workouts.findIndex((item) => item.id === workoutMatch[1] && item.profileId === body.profileId);
      if (index < 0) throw Object.assign(new Error("Workout was not found."), { status: 404 });
      const fresh = normalizeWorkout(db, body);
      if (!fresh.ok) throw Object.assign(new Error(fresh.message), { status: fresh.status });
      const existing = db.workouts[index];
      const updated = {
        ...fresh.workout,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: nowIso()
      };
      if (existing.order !== undefined) updated.order = existing.order;
      db.workouts[index] = updated;
      return updated;
    });
    return sendJson(res, 200, { workout });
  }

  if (req.method === "DELETE" && workoutMatch) {
    const profileId = url.searchParams.get("profileId");
    const result = await withDb(async (db) => {
      const index = db.workouts.findIndex((workout) => workout.id === workoutMatch[1] && workout.profileId === profileId);
      if (index < 0) throw Object.assign(new Error("Workout was not found."), { status: 404 });
      db.workouts.splice(index, 1);
      return { ok: true };
    });
    return sendJson(res, 200, result);
  }

  return sendError(res, 404, "API route was not found.");
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

async function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const decoded = decodeURIComponent(pathname);
  const filePath = path.resolve(PUBLIC_DIR, `.${decoded}`);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "cache-control": "no-cache"
    });
    res.end(file);
  } catch {
    const fallback = await readFile(path.join(PUBLIC_DIR, "index.html"));
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-cache"
    });
    res.end(fallback);
  }
}

await ensureDb();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    const status = error.status || 500;
    sendError(res, status, error.message || "Unexpected server error.");
  }
});

server.listen(PORT, () => {
  console.log(`Gym tracker running on http://localhost:${PORT}`);
});
