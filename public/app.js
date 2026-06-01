const STORAGE_KEY = "gymTracker.currentProfileId";

const state = {
  loading: true,
  error: "",
  notice: "",
  profiles: [],
  profile: null,
  view: "log",
  exercises: [],
  workouts: [],
  templates: [],
  exerciseSearch: "",
  exerciseManagerSearch: "",
  editingExerciseId: "",
  editingWorkoutId: "",
  addToBlockId: "",
  templateName: "",
  draft: null
};

const app = document.querySelector("#app");

function today() {
  return new Date().toISOString().slice(0, 10);
}

function draftId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function pad(number) {
  return String(number).padStart(2, "0");
}

function timeSlots({ includeEnd = false } = {}) {
  const last = includeEnd ? 48 : 47;
  return Array.from({ length: last + 1 }, (_, index) => {
    const hour = Math.floor(index / 2);
    const minute = index % 2 === 0 ? "00" : "30";
    return `${pad(hour)}:${minute}`;
  });
}

function displayTime(value) {
  if (!value) return "";
  const [hour, minute] = value.split(":");
  return `${Number(hour)}:${minute}`;
}

function defaultStartTime() {
  const date = new Date();
  const hour = date.getHours();
  const minute = date.getMinutes() >= 30 ? "30" : "00";
  return `${pad(hour)}:${minute}`;
}

function nextSlot(value) {
  const index = timeSlots().indexOf(value);
  const endSlots = timeSlots({ includeEnd: true });
  return endSlots[Math.min(index + 1, endSlots.length - 1)] || "09:30";
}

function newDraft(template = null) {
  return {
    date: today(),
    startTime: defaultStartTime(),
    durationHours: "",
    durationMinutePart: "",
    energyScore: 3,
    blocks: template ? template.blocks.map(draftBlockFromSaved) : []
  };
}

function durationParts(durationMinutes) {
  if (!Number.isFinite(durationMinutes)) return { hours: "", minutes: "" };
  return {
    hours: Math.floor(durationMinutes / 60) || "",
    minutes: durationMinutes % 60 || ""
  };
}

function draftFromWorkout(workout) {
  const duration = durationParts(workout.durationMinutes);
  return {
    date: workout.date || today(),
    startTime: workout.startTime || defaultStartTime(),
    durationHours: duration.hours,
    durationMinutePart: duration.minutes,
    energyScore: workout.energyScore ?? "",
    blocks: workoutBlocks(workout).map(draftBlockFromSaved)
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function api(path, options = {}) {
  const init = {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    }
  };
  if (options.body && typeof options.body !== "string") {
    init.body = JSON.stringify(options.body);
  }
  return fetch(path, init).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Something went wrong.");
    return payload;
  });
}

function activeSettings() {
  return {
    showEnergy: true,
    showRest: true,
    showRir: true,
    ...(state.profile?.settings || {})
  };
}

function setError(message) {
  state.error = message || "";
  state.notice = "";
  render();
}

function setNotice(message) {
  state.notice = message || "";
  state.error = "";
  render();
}

async function loadBootstrap() {
  try {
    const bootstrap = await api("/api/bootstrap");
    state.profiles = bootstrap.profiles;
    const rememberedProfileId = localStorage.getItem(STORAGE_KEY);
    const rememberedProfile = state.profiles.find((profile) => profile.id === rememberedProfileId);

    if (rememberedProfile) {
      state.profile = rememberedProfile;
      state.draft = newDraft();
      await loadProfileData();
    }
  } catch (error) {
    state.error = error.message;
  } finally {
    state.loading = false;
    render();
  }
}

async function loadProfileData() {
  if (!state.profile) return;
  const [exercisePayload, workoutPayload, templatePayload] = await Promise.all([
    api(`/api/exercises?profileId=${encodeURIComponent(state.profile.id)}&includeHidden=true`),
    api(`/api/workouts?profileId=${encodeURIComponent(state.profile.id)}`),
    api(`/api/templates?profileId=${encodeURIComponent(state.profile.id)}`)
  ]);
  state.exercises = exercisePayload.exercises;
  state.workouts = workoutPayload.workouts;
  state.templates = templatePayload.templates;
}

async function selectProfile(profileId) {
  const profile = state.profiles.find((item) => item.id === profileId);
  if (!profile) return;
  state.profile = profile;
  state.draft = newDraft();
  state.editingWorkoutId = "";
  state.view = "log";
  state.error = "";
  state.notice = "";
  localStorage.setItem(STORAGE_KEY, profile.id);
  await loadProfileData();
  render();
}

function switchProfile() {
  state.profile = null;
  state.draft = null;
  state.exercises = [];
  state.workouts = [];
  state.templates = [];
  state.addToBlockId = "";
  state.editingWorkoutId = "";
  state.templateName = "";
  state.error = "";
  state.notice = "";
  localStorage.removeItem(STORAGE_KEY);
  render();
}

function timeOptions(selected, { includeEnd = false } = {}) {
  return timeSlots({ includeEnd })
    .map((slot) => `<option value="${slot}" ${slot === selected ? "selected" : ""}>${displayTime(slot)}</option>`)
    .join("");
}

function rirOptions(selected) {
  return ['<option value="">-</option>']
    .concat(Array.from({ length: 7 }, (_, value) => `<option value="${value}" ${String(selected) === String(value) ? "selected" : ""}>${value}</option>`))
    .join("");
}

function exerciseMatches(query, { includeHidden = false } = {}) {
  const clean = query.trim().toLowerCase();
  return state.exercises
    .filter((exercise) => includeHidden || !exercise.hidden)
    .filter((exercise) => {
      if (!clean) return true;
      return [exercise.name, exercise.muscleGroup, exercise.equipment, exercise.category]
        .join(" ")
        .toLowerCase()
        .includes(clean);
    })
    .sort((a, b) => Number(a.hidden) - Number(b.hidden) || a.name.localeCompare(b.name));
}

function renderMessages() {
  return `
    ${state.error ? `<div class="alert">${escapeHtml(state.error)}</div>` : ""}
    ${state.notice ? `<div class="success">${escapeHtml(state.notice)}</div>` : ""}
  `;
}

function renderProfileGate() {
  return `
    <div class="gate-shell">
      <header class="gate-header">
        <span class="eyebrow">Nickname profiles</span>
        <h1>Gym Tracker</h1>
        <p class="lead">Choose a nickname to keep workouts separate. This is profile switching, not private login.</p>
      </header>

      <section class="panel">
        <h2>Existing users</h2>
        ${state.profiles.length === 0 ? `<div class="empty-state">No nicknames yet. Create the first one to start logging.</div>` : ""}
        <div class="profile-grid">
          ${state.profiles
            .map((profile) => `
              <button class="profile-button" type="button" data-action="select-profile" data-profile-id="${profile.id}">
                <span>
                  <strong>${escapeHtml(profile.nickname)}</strong>
                  <span>Open tracker</span>
                </span>
                <span>Choose</span>
              </button>
            `)
            .join("")}
        </div>
      </section>

      <section class="panel">
        <h2>Create nickname</h2>
        ${renderMessages()}
        <form data-form="create-profile">
          <div class="form-row">
            <label for="nickname">Nickname</label>
            <input id="nickname" name="nickname" maxlength="24" autocomplete="off" placeholder="Example: Dani">
          </div>
          <button class="btn" type="submit">Create and enter</button>
        </form>
      </section>
    </div>
  `;
}

function viewTitle() {
  return {
    log: "Log workout",
    history: "History",
    exercises: "Exercises",
    settings: "Settings"
  }[state.view];
}

function renderShell() {
  return `
    <div class="app-shell">
      <header class="topbar">
        <div>
          <span class="eyebrow">Gym tracker</span>
          <h1>${viewTitle()}</h1>
        </div>
        <button class="profile-chip" type="button" data-action="switch-profile" title="Switch profile">${escapeHtml(state.profile.nickname)}</button>
      </header>
      <main class="content">
        ${renderMessages()}
        ${renderView()}
      </main>
      <nav class="bottom-nav" aria-label="Main navigation">
        ${[
          ["log", "Log"],
          ["history", "History"],
          ["exercises", "Exercises"],
          ["settings", "Settings"]
        ]
          .map(([view, label]) => `<button class="tab-button ${state.view === view ? "active" : ""}" type="button" data-action="set-view" data-view="${view}">${label}</button>`)
          .join("")}
      </nav>
    </div>
  `;
}

function renderView() {
  if (state.view === "history") return renderHistoryView();
  if (state.view === "exercises") return renderExercisesView();
  if (state.view === "settings") return renderSettingsView();
  return renderLogView();
}

function renderLogView() {
  const settings = activeSettings();
  const draft = state.draft || newDraft();
  const isEditingWorkout = Boolean(state.editingWorkoutId);
  const targetBlock = findDraftBlock(state.addToBlockId);
  const targetBlockNumber = targetBlock ? draft.blocks.indexOf(targetBlock) + 1 : 0;
  const targetExerciseIds = new Set((targetBlock?.exercises || []).map((exercise) => exercise.exerciseId));
  const matches = exerciseMatches(state.exerciseSearch)
    .filter((exercise) => !targetBlock || !targetExerciseIds.has(exercise.id))
    .slice(0, 8);

  return `
    ${renderTemplatePanel()}
    <div class="desktop-columns">
      <section class="panel">
        <h2>Session</h2>
        <div class="form-row">
          <label for="workout-date">Day</label>
          <input id="workout-date" type="date" value="${escapeHtml(draft.date)}" data-draft-field="date">
        </div>
        <div class="form-grid session-grid">
          <div class="form-row">
            <label for="start-time">Start</label>
            <select id="start-time" data-draft-field="startTime">${timeOptions(draft.startTime)}</select>
          </div>
          <div class="form-row">
            <label for="duration-hours">Hours</label>
            <input id="duration-hours" type="number" min="0" max="24" inputmode="numeric" value="${escapeHtml(draft.durationHours)}" data-draft-field="durationHours" placeholder="Blank">
          </div>
          <div class="form-row">
            <label for="duration-minutes">Minutes</label>
            <input id="duration-minutes" type="number" min="0" max="59" inputmode="numeric" value="${escapeHtml(draft.durationMinutePart)}" data-draft-field="durationMinutePart" placeholder="Blank">
          </div>
        </div>
        ${settings.showEnergy ? `
          <div class="form-row">
            <label>Energy before workout</label>
            <div class="score-row">
              ${[1, 2, 3, 4, 5].map((score) => `<button class="score-button ${draft.energyScore === score ? "active" : ""}" type="button" data-action="set-energy" data-score="${score}">${score}</button>`).join("")}
            </div>
          </div>
        ` : ""}
      </section>

      <section class="panel">
        <div class="section-title-row">
          <div>
            <h2>${targetBlock ? `Add to card ${targetBlockNumber}` : "Add new card"}</h2>
            <p class="muted">${targetBlock ? "Search picks will join this card." : "Search picks will start their own card."}</p>
          </div>
          ${!targetBlock && draft.blocks.length > 0 ? `<button class="btn secondary" type="button" data-action="start-new-block">New card</button>` : ""}
        </div>
        ${targetBlock ? `<div class="target-banner"><span>Adding exercises to card ${targetBlockNumber}</span><button class="btn secondary" type="button" data-action="start-new-block">Add new card instead</button></div>` : ""}
        <div class="exercise-search-wrap">
          <input type="search" placeholder="Search exercise, muscle, equipment" value="${escapeHtml(state.exerciseSearch)}" data-search="log-exercise">
          <div class="search-results" id="exerciseMatches">
            ${matches.length === 0 ? `<div class="empty-state">No visible exercises match that search.</div>` : ""}
            ${matches.map((exercise) => renderExerciseSearchResult(exercise, Boolean(targetBlock))).join("")}
          </div>
        </div>
      </section>
    </div>

    <section>
      <div class="exercise-header">
        <div>
          <h2>Workout cards</h2>
          <p class="muted">${draft.blocks.length === 0 ? "Add an exercise to start tracking sets." : "Each card can be one exercise or a circuit."}</p>
        </div>
        <button class="btn secondary" type="button" data-action="start-new-block">Add new card</button>
      </div>
      <div class="selected-list">
        ${draft.blocks.length === 0 ? `<div class="empty-state">Your workout is empty.</div>` : ""}
        ${draft.blocks.map((block, index) => renderSelectedBlock(block, index, settings)).join("")}
      </div>
    </section>

    <div class="save-bar">
      ${isEditingWorkout ? `<div class="success">Editing saved workout. Updating will replace the original entry.</div>` : ""}
      <div class="button-row">
        <button class="btn" type="button" data-action="save-workout" ${draft.blocks.length === 0 ? "disabled" : ""}>${isEditingWorkout ? "Update workout" : "Save workout"}</button>
        ${isEditingWorkout ? `<button class="btn secondary" type="button" data-action="cancel-edit-workout">Cancel edit</button>` : ""}
      </div>
      <form class="template-save-form" data-form="save-template">
        <input name="name" maxlength="50" value="${escapeHtml(state.templateName)}" data-template-name placeholder="Default workout name">
        <button class="btn secondary" type="submit" ${draft.blocks.length === 0 ? "disabled" : ""}>Save as default</button>
      </form>
    </div>
  `;
}

function renderTemplatePanel() {
  return `
    <section class="panel">
      <div class="section-title-row">
        <div>
          <h2>Default workouts</h2>
          <p class="muted">${state.templates.length === 0 ? "Save a workout as a default to start faster next time." : "Load a saved workout setup into today's draft."}</p>
        </div>
      </div>
      <div class="template-list">
        ${state.templates.length === 0 ? `<div class="empty-state">No default workouts yet.</div>` : ""}
        ${state.templates.map((template) => `
          <article class="template-card">
            <button class="template-load" type="button" data-action="load-template" data-template-id="${template.id}">
              <strong>${escapeHtml(template.name)}</strong>
              <span>${template.blocks.length} ${template.blocks.length === 1 ? "card" : "cards"}</span>
            </button>
            <button class="icon-btn" type="button" data-action="delete-template" data-template-id="${template.id}" title="Delete default workout">X</button>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderExerciseSearchResult(exercise, addingToCard = false) {
  return `
    <div class="search-result">
      <div>
        <h3>${escapeHtml(exercise.name)}</h3>
        <div class="meta-line">
          <span>${escapeHtml(exercise.muscleGroup)}</span>
          <span>${escapeHtml(exercise.equipment)}</span>
        </div>
      </div>
      <button class="btn subtle" type="button" data-action="add-exercise-to-draft" data-exercise-id="${exercise.id}">${addingToCard ? "Add here" : "Start card"}</button>
    </div>
  `;
}

function trackingMode(exercise) {
  return exercise.trackingMode === "time" ? "time" : "reps";
}

function setGridClass(settings, exercise) {
  if (trackingMode(exercise) === "time") return "time-mode";
  if (!settings.showRir) return "no-rir";
  return "";
}

function renderSelectedBlock(block, blockIndex, settings) {
  const exerciseCount = block.exercises.length;
  const setCount = block.exercises.reduce((total, exercise) => total + exercise.sets.length, 0);
  const type = exerciseCount === 1 ? "Single exercise" : "Circuit";
  return `
    <section class="exercise-card block-card ${state.addToBlockId === block.draftId ? "targeted" : ""}">
      <header class="exercise-header">
        <div class="exercise-title">
          <h3>Card ${blockIndex + 1}</h3>
          <div class="meta-line">${type} - ${exerciseCount} ${exerciseCount === 1 ? "exercise" : "exercises"} - ${setCount} ${setCount === 1 ? "set" : "sets"}</div>
        </div>
        <button class="icon-btn" type="button" data-action="remove-block" data-draft-block-id="${block.draftId}" title="Remove block">X</button>
      </header>
      ${settings.showRest ? `
        <div class="form-row block-rest-row">
          <label for="rest-${block.draftId}">Rest for card (seconds)</label>
          <input id="rest-${block.draftId}" type="number" min="0" max="3600" inputmode="numeric" value="${escapeHtml(block.restSeconds)}" data-block-field="restSeconds" data-draft-block-id="${block.draftId}" placeholder="Optional">
        </div>
      ` : ""}
      <div class="block-exercise-list">
        ${block.exercises.map((exercise) => renderBlockExercise(block, exercise, settings)).join("")}
      </div>
      <div class="button-row" style="margin-top: 10px;">
        <button class="btn secondary" type="button" data-action="target-block" data-draft-block-id="${block.draftId}">Add exercise to this card</button>
      </div>
    </section>
  `;
}

function renderBlockExercise(block, exercise, settings) {
  const mode = trackingMode(exercise);
  const gridClass = setGridClass(settings, exercise);
  return `
    <div class="block-exercise">
      <div class="block-exercise-header">
        <div class="block-exercise-title">
          <strong>${escapeHtml(exercise.nameSnapshot)}</strong>
          <div class="mode-toggle" role="group" aria-label="Tracking mode">
            <button class="${mode === "reps" ? "active" : ""}" type="button" data-action="set-exercise-mode" data-tracking-mode="reps" data-draft-block-id="${block.draftId}" data-draft-exercise-id="${exercise.draftId}">Reps/Lb</button>
            <button class="${mode === "time" ? "active" : ""}" type="button" data-action="set-exercise-mode" data-tracking-mode="time" data-draft-block-id="${block.draftId}" data-draft-exercise-id="${exercise.draftId}">Time</button>
          </div>
        </div>
        <button class="icon-btn" type="button" data-action="remove-exercise-from-block" data-draft-block-id="${block.draftId}" data-draft-exercise-id="${exercise.draftId}" title="Remove exercise">X</button>
      </div>
      <div class="set-grid">
        <div class="set-head ${gridClass}">
          <span>Set</span>
          ${mode === "time" ? "<span>Time</span>" : `
            <span>Reps</span>
            <span>Lb</span>
            ${settings.showRir ? "<span>RIR</span>" : ""}
          `}
          <span></span>
        </div>
        ${exercise.sets.map((set, index) => renderSetRow(block, exercise, set, index, settings)).join("")}
      </div>
      <div class="button-row" style="margin-top: 10px;">
        <button class="btn secondary" type="button" data-action="add-set" data-draft-block-id="${block.draftId}" data-draft-exercise-id="${exercise.draftId}">Add set</button>
        <button class="btn secondary" type="button" data-action="copy-set" data-draft-block-id="${block.draftId}" data-draft-exercise-id="${exercise.draftId}">Copy last</button>
      </div>
    </div>
  `;
}

function renderSetRow(block, exercise, set, index, settings) {
  const mode = trackingMode(exercise);
  const gridClass = setGridClass(settings, exercise);
  if (mode === "time") {
    return `
      <div class="set-row ${gridClass}">
        <div class="set-number">${index + 1}</div>
        <input type="number" min="0" max="3600" inputmode="numeric" value="${escapeHtml(set.durationSeconds)}" data-set-field="durationSeconds" data-draft-block-id="${block.draftId}" data-draft-exercise-id="${exercise.draftId}" data-set-id="${set.draftId}" aria-label="Time in seconds" placeholder="Sec">
        <button class="icon-btn" type="button" data-action="remove-set" data-draft-block-id="${block.draftId}" data-draft-exercise-id="${exercise.draftId}" data-set-id="${set.draftId}" title="Remove set">X</button>
      </div>
    `;
  }
  return `
    <div class="set-row ${gridClass}">
      <div class="set-number">${index + 1}</div>
      <input type="number" min="0" max="999" inputmode="numeric" value="${escapeHtml(set.reps)}" data-set-field="reps" data-draft-block-id="${block.draftId}" data-draft-exercise-id="${exercise.draftId}" data-set-id="${set.draftId}" aria-label="Reps">
      <input type="number" min="0" max="2000" step="0.5" inputmode="decimal" value="${escapeHtml(set.weightLb)}" data-set-field="weightLb" data-draft-block-id="${block.draftId}" data-draft-exercise-id="${exercise.draftId}" data-set-id="${set.draftId}" aria-label="Weight in pounds">
      ${settings.showRir ? `<select data-set-field="rir" data-draft-block-id="${block.draftId}" data-draft-exercise-id="${exercise.draftId}" data-set-id="${set.draftId}" aria-label="RIR">${rirOptions(set.rir)}</select>` : ""}
      <button class="icon-btn" type="button" data-action="remove-set" data-draft-block-id="${block.draftId}" data-draft-exercise-id="${exercise.draftId}" data-set-id="${set.draftId}" title="Remove set">X</button>
    </div>
  `;
}

function workoutStats(workouts = state.workouts) {
  let setCount = 0;
  let volume = 0;
  for (const workout of workouts) {
    for (const block of workoutBlocks(workout)) {
      for (const exercise of block.exercises) {
        for (const set of exercise.sets) {
          setCount += 1;
          if (Number.isFinite(set.reps) && Number.isFinite(set.weightLb)) {
            volume += set.reps * set.weightLb;
          }
        }
      }
    }
  }
  return { workouts: workouts.length, setCount, volume };
}

function renderHistoryView() {
  const stats = workoutStats();
  return `
    <section class="summary-strip">
      <div class="stat"><strong>${stats.workouts}</strong><span>Workouts</span></div>
      <div class="stat"><strong>${stats.setCount}</strong><span>Sets</span></div>
      <div class="stat"><strong>${Math.round(stats.volume).toLocaleString()}</strong><span>Lb volume</span></div>
    </section>
    <div class="button-row">
      <a class="btn secondary" href="/api/export/workouts.csv?profileId=${encodeURIComponent(state.profile.id)}" download>Export CSV</a>
    </div>
    <section class="workout-list">
      ${state.workouts.length === 0 ? `<div class="empty-state">No workouts yet. Your saved sessions will appear here.</div>` : ""}
      ${state.workouts.map(renderWorkoutCard).join("")}
    </section>
  `;
}

function renderWorkoutCard(workout) {
  const blocks = workoutBlocks(workout);
  const exerciseCount = blocks.reduce((total, block) => total + block.exercises.length, 0);
  const setCount = blocks.reduce((total, block) => total + block.exercises.reduce((exerciseTotal, exercise) => exerciseTotal + exercise.sets.length, 0), 0);
  const duration = workoutDurationText(workout);
  return `
    <article class="workout-card">
      <header class="workout-header">
        <div>
          <h3>${escapeHtml(workout.date)} - ${displayTime(workout.startTime)}${duration ? ` - ${escapeHtml(duration)}` : ""}</h3>
          <div class="meta-line">
            <span>${blocks.length} ${blocks.length === 1 ? "card" : "cards"}</span>
            <span>${exerciseCount} exercises</span>
            <span>${setCount} sets</span>
            ${workout.energyScore ? `<span>Energy ${workout.energyScore}/5</span>` : ""}
          </div>
        </div>
        <div class="button-row">
          <button class="btn secondary" type="button" data-action="edit-workout" data-workout-id="${workout.id}">Edit</button>
          <button class="icon-btn" type="button" data-action="delete-workout" data-workout-id="${workout.id}" title="Delete workout">X</button>
        </div>
      </header>
      <details>
        <summary>Details</summary>
        <div class="details-list">
          ${blocks.map(renderHistoryBlock).join("")}
        </div>
      </details>
    </article>
  `;
}

function workoutBlocks(workout) {
  if (Array.isArray(workout.blocks)) return workout.blocks;
  if (!Array.isArray(workout.exercises)) return [];
  return workout.exercises.map((exercise, index) => ({
    id: exercise.id || `${workout.id}-legacy-${index}`,
    order: index + 1,
    restSeconds: firstSetRest(exercise),
    exercises: [exercise]
  }));
}

function firstSetRest(exercise) {
  const set = (exercise.sets || []).find((item) => item.restSeconds !== null && item.restSeconds !== undefined && item.restSeconds !== "");
  return set ? set.restSeconds : null;
}

function workoutDurationText(workout) {
  if (Number.isFinite(workout.durationMinutes)) {
    const hours = Math.floor(workout.durationMinutes / 60);
    const minutes = workout.durationMinutes % 60;
    if (hours && minutes) return `${hours}h ${minutes}m`;
    if (hours) return `${hours}h`;
    return `${minutes} min`;
  }
  if (workout.endTime) return `${displayTime(workout.startTime)} -> ${displayTime(workout.endTime)}`;
  return "";
}

function renderHistoryBlock(block) {
  return `
    <div class="history-block">
      <div class="meta-line">
        <strong>Card ${block.order}</strong>
        ${block.restSeconds === null || block.restSeconds === undefined ? "" : `<span>${block.restSeconds}s rest</span>`}
      </div>
      ${block.exercises.map(renderHistoryExercise).join("")}
    </div>
  `;
}

function renderHistoryExercise(exercise) {
  const mode = trackingMode(exercise);
  return `
    <div class="history-exercise">
      <strong>${escapeHtml(exercise.nameSnapshot)}</strong>
      ${exercise.sets.map((set) => {
        const parts = mode === "time"
          ? [
              `Set ${set.setNumber}`,
              set.durationSeconds === null || set.durationSeconds === undefined ? null : `${set.durationSeconds} sec`
            ].filter(Boolean)
          : [
              `Set ${set.setNumber}`,
              set.reps === null ? null : `${set.reps} reps`,
              set.weightLb === null ? null : `${set.weightLb} lb`,
              set.rir === null ? null : `RIR ${set.rir}`
            ].filter(Boolean);
        return `<div class="history-set">${escapeHtml(parts.join(" - "))}</div>`;
      }).join("")}
    </div>
  `;
}

function renderExercisesView() {
  const matches = exerciseMatches(state.exerciseManagerSearch, { includeHidden: true });
  return `
    <section class="panel">
      <h2>Add custom exercise</h2>
      <form data-form="create-exercise">
        <div class="form-row">
          <label for="custom-name">Name</label>
          <input id="custom-name" name="name" maxlength="80" placeholder="Example: Cable pullover">
        </div>
        <div class="form-grid">
          <div class="form-row">
            <label for="custom-muscle">Muscle</label>
            <input id="custom-muscle" name="muscleGroup" maxlength="80" placeholder="Back">
          </div>
          <div class="form-row">
            <label for="custom-equipment">Equipment</label>
            <input id="custom-equipment" name="equipment" maxlength="80" placeholder="Cable">
          </div>
        </div>
        <button class="btn" type="submit">Add exercise</button>
      </form>
    </section>

    <section class="panel">
      <h2>Exercise catalog</h2>
      <div class="form-row">
        <label for="manage-search">Search</label>
        <input id="manage-search" type="search" value="${escapeHtml(state.exerciseManagerSearch)}" data-search="manage-exercise" placeholder="Search all exercises">
      </div>
      <div class="exercise-list">
        ${matches.map(renderManagedExercise).join("")}
      </div>
    </section>
  `;
}

function renderManagedExercise(exercise) {
  const isEditing = state.editingExerciseId === exercise.id;
  if (isEditing) {
    return `
      <form class="exercise-card" data-form="edit-exercise" data-exercise-id="${exercise.id}">
        <div class="form-row">
          <label>Name</label>
          <input name="name" maxlength="80" value="${escapeHtml(exercise.name)}">
        </div>
        <div class="form-grid">
          <div class="form-row">
            <label>Muscle</label>
            <input name="muscleGroup" maxlength="80" value="${escapeHtml(exercise.muscleGroup)}">
          </div>
          <div class="form-row">
            <label>Equipment</label>
            <input name="equipment" maxlength="80" value="${escapeHtml(exercise.equipment)}">
          </div>
        </div>
        <div class="button-row">
          <button class="btn" type="submit">Save</button>
          <button class="btn secondary" type="button" data-action="cancel-edit-exercise">Cancel</button>
        </div>
      </form>
    `;
  }

  return `
    <article class="exercise-card ${exercise.hidden ? "hidden" : ""}">
      <header class="exercise-header">
        <div>
          <h3>${escapeHtml(exercise.name)}</h3>
          <div class="meta-line">
            <span>${escapeHtml(exercise.muscleGroup)}</span>
            <span>${escapeHtml(exercise.equipment)}</span>
          </div>
        </div>
        <span class="pill ${exercise.source === "custom" ? "blue" : "gold"}">${exercise.source === "custom" ? "Custom" : "Seeded"}</span>
      </header>
      <div class="meta-line">
        ${exercise.hidden ? `<span class="pill red">Hidden from log</span>` : ""}
        <span>${escapeHtml(exercise.sourceLicense)}</span>
      </div>
      <div class="button-row" style="margin-top: 10px;">
        <button class="btn secondary" type="button" data-action="edit-exercise" data-exercise-id="${exercise.id}">Edit</button>
        <button class="btn secondary" type="button" data-action="toggle-hide-exercise" data-exercise-id="${exercise.id}" data-hidden="${exercise.hidden ? "false" : "true"}">${exercise.hidden ? "Show" : "Hide"}</button>
      </div>
    </article>
  `;
}

function renderSettingsView() {
  const settings = activeSettings();
  return `
    <section class="panel">
      <h2>Default logging fields</h2>
      <div class="toggle-row">
        <label class="toggle">
          <span>
            <strong>Energy score</strong>
            <span class="muted">Show the 1 to 5 pre-workout energy box.</span>
          </span>
          <input type="checkbox" data-setting="showEnergy" ${settings.showEnergy ? "checked" : ""}>
        </label>
        <label class="toggle">
          <span>
            <strong>Rest time</strong>
            <span class="muted">Show seconds between workout cards.</span>
          </span>
          <input type="checkbox" data-setting="showRest" ${settings.showRest ? "checked" : ""}>
        </label>
        <label class="toggle">
          <span>
            <strong>RIR</strong>
            <span class="muted">Show reps in reserve from 0 to 6.</span>
          </span>
          <input type="checkbox" data-setting="showRir" ${settings.showRir ? "checked" : ""}>
        </label>
      </div>
    </section>
    <section class="panel">
      <h2>Profile</h2>
      <p class="muted">Current nickname: <strong>${escapeHtml(state.profile.nickname)}</strong></p>
      <p class="muted">Anyone with the app can choose a visible nickname. This version keeps profiles separate, but it is not private authentication.</p>
      <button class="btn secondary" type="button" data-action="switch-profile">Switch profile</button>
    </section>
  `;
}

function render() {
  if (state.loading) return;
  app.innerHTML = state.profile ? renderShell() : renderProfileGate();
}

function findDraftBlock(draftBlockId) {
  return state.draft?.blocks.find((block) => block.draftId === draftBlockId);
}

function findDraftExercise(draftBlockId, draftExerciseId) {
  return findDraftBlock(draftBlockId)?.exercises.find((exercise) => exercise.draftId === draftExerciseId);
}

function findDraftSet(exercise, setId) {
  return exercise?.sets.find((set) => set.draftId === setId);
}

function blankSet(seed = {}) {
  return {
    draftId: draftId(),
    reps: seed.reps ?? "",
    weightLb: seed.weightLb ?? "",
    durationSeconds: seed.durationSeconds ?? "",
    rir: seed.rir ?? ""
  };
}

function draftExerciseFromSaved(exercise) {
  return {
    draftId: draftId(),
    exerciseId: exercise.exerciseId,
    nameSnapshot: exercise.nameSnapshot,
    trackingMode: trackingMode(exercise),
    sets: (exercise.sets || []).map(blankSet)
  };
}

function draftBlockFromSaved(block) {
  return {
    draftId: draftId(),
    restSeconds: block.restSeconds ?? "",
    exercises: (block.exercises || []).map(draftExerciseFromSaved)
  };
}

function draftExerciseFromCatalog(exercise) {
  return {
    draftId: draftId(),
    exerciseId: exercise.id,
    nameSnapshot: exercise.name,
    trackingMode: "reps",
    sets: [blankSet()]
  };
}

function draftDurationMinutes(draft) {
  const hoursBlank = draft.durationHours === "" || draft.durationHours === null || draft.durationHours === undefined;
  const minutesBlank = draft.durationMinutePart === "" || draft.durationMinutePart === null || draft.durationMinutePart === undefined;
  if (hoursBlank && minutesBlank) return null;
  const hours = Number(draft.durationHours || 0);
  const minutes = Number(draft.durationMinutePart || 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return undefined;
  const total = hours * 60 + minutes;
  return total > 0 ? total : null;
}

function draftBlocksPayload(draft, settings, { includeHiddenValues = false } = {}) {
  return draft.blocks.map((block) => ({
    restSeconds: settings.showRest || includeHiddenValues ? block.restSeconds : null,
    exercises: block.exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      nameSnapshot: exercise.nameSnapshot,
      trackingMode: trackingMode(exercise),
      sets: exercise.sets.map((set) => ({
        reps: trackingMode(exercise) === "reps" ? set.reps : null,
        weightLb: trackingMode(exercise) === "reps" ? set.weightLb : null,
        durationSeconds: trackingMode(exercise) === "time" ? set.durationSeconds : null,
        rir: trackingMode(exercise) === "reps" && (settings.showRir || includeHiddenValues) ? set.rir : null
      }))
    }))
  }));
}

async function saveWorkout() {
  const draft = state.draft;
  if (!draft || draft.blocks.length === 0) return;

  try {
    const durationMinutes = draftDurationMinutes(draft);
    if (durationMinutes === undefined) {
      setError("Duration must use numbers only.");
      return;
    }
    const settings = activeSettings();
    const isEditingWorkout = Boolean(state.editingWorkoutId);
    const body = {
      profileId: state.profile.id,
      date: draft.date,
      startTime: draft.startTime,
      durationMinutes,
      energyScore: settings.showEnergy || isEditingWorkout ? draft.energyScore : null,
      blocks: draftBlocksPayload(draft, settings, { includeHiddenValues: isEditingWorkout })
    };
    const path = isEditingWorkout
      ? `/api/workouts/${encodeURIComponent(state.editingWorkoutId)}`
      : "/api/workouts";
    await api(path, { method: isEditingWorkout ? "PATCH" : "POST", body });
    state.draft = newDraft();
    state.exerciseSearch = "";
    state.addToBlockId = "";
    state.editingWorkoutId = "";
    await loadProfileData();
    state.view = "history";
    setNotice(isEditingWorkout ? "Workout updated." : "Workout saved.");
  } catch (error) {
    setError(error.message);
  }
}

async function saveTemplate(name) {
  const draft = state.draft;
  if (!draft || draft.blocks.length === 0) return;

  try {
    const settings = activeSettings();
    await api("/api/templates", {
      method: "POST",
      body: {
        profileId: state.profile.id,
        name,
        blocks: draftBlocksPayload(draft, settings)
      }
    });
    state.templateName = "";
    await loadProfileData();
    setNotice("Default workout saved.");
  } catch (error) {
    setError(error.message);
  }
}

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("form");
  if (!form) return;
  event.preventDefault();

  const formType = form.dataset.form;
  const data = Object.fromEntries(new FormData(form).entries());

  try {
    if (formType === "create-profile") {
      const payload = await api("/api/profiles", { method: "POST", body: data });
      state.profiles = [...state.profiles, payload.profile].sort((a, b) => a.nickname.localeCompare(b.nickname));
      await selectProfile(payload.profile.id);
      return;
    }

    if (formType === "create-exercise") {
      await api("/api/exercises", {
        method: "POST",
        body: {
          ...data,
          category: "Strength",
          profileId: state.profile.id
        }
      });
      form.reset();
      await loadProfileData();
      setNotice("Exercise added.");
      return;
    }

    if (formType === "edit-exercise") {
      await api(`/api/exercises/${encodeURIComponent(form.dataset.exerciseId)}`, {
        method: "PATCH",
        body: {
          ...data,
          category: "Strength",
          profileId: state.profile.id
        }
      });
      state.editingExerciseId = "";
      await loadProfileData();
      setNotice("Exercise updated.");
      return;
    }

    if (formType === "save-template") {
      state.templateName = data.name || "";
      await saveTemplate(state.templateName);
    }
  } catch (error) {
    setError(error.message);
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const action = button.dataset.action;

  try {
    if (action === "select-profile") {
      await selectProfile(button.dataset.profileId);
      return;
    }

    if (action === "switch-profile") {
      switchProfile();
      return;
    }

    if (action === "set-view") {
      state.view = button.dataset.view;
      state.error = "";
      state.notice = "";
      render();
      return;
    }

    if (action === "set-energy") {
      state.draft.energyScore = Number(button.dataset.score);
      render();
      return;
    }

    if (action === "add-exercise-to-draft") {
      const exercise = state.exercises.find((item) => item.id === button.dataset.exerciseId);
      if (!exercise) return;
      const targetBlock = findDraftBlock(state.addToBlockId);
      if (targetBlock) {
        if (!targetBlock.exercises.some((item) => item.exerciseId === exercise.id)) {
          targetBlock.exercises.push(draftExerciseFromCatalog(exercise));
        }
      } else {
        state.draft.blocks.push({
          draftId: draftId(),
          restSeconds: "",
          exercises: [draftExerciseFromCatalog(exercise)]
        });
      }
      state.exerciseSearch = "";
      render();
      return;
    }

    if (action === "target-block") {
      state.addToBlockId = button.dataset.draftBlockId;
      state.exerciseSearch = "";
      render();
      return;
    }

    if (action === "start-new-block") {
      state.addToBlockId = "";
      state.exerciseSearch = "";
      render();
      requestAnimationFrame(() => document.querySelector('[data-search="log-exercise"]')?.focus());
      return;
    }

    if (action === "cancel-block-target") {
      state.addToBlockId = "";
      state.exerciseSearch = "";
      render();
      return;
    }

    if (action === "remove-block") {
      state.draft.blocks = state.draft.blocks.filter((block) => block.draftId !== button.dataset.draftBlockId);
      if (state.addToBlockId === button.dataset.draftBlockId) state.addToBlockId = "";
      render();
      return;
    }

    if (action === "remove-exercise-from-block") {
      const block = findDraftBlock(button.dataset.draftBlockId);
      if (!block) return;
      block.exercises = block.exercises.filter((exercise) => exercise.draftId !== button.dataset.draftExerciseId);
      if (block.exercises.length === 0) {
        state.draft.blocks = state.draft.blocks.filter((item) => item.draftId !== block.draftId);
        if (state.addToBlockId === block.draftId) state.addToBlockId = "";
      }
      render();
      return;
    }

    if (action === "set-exercise-mode") {
      const exercise = findDraftExercise(button.dataset.draftBlockId, button.dataset.draftExerciseId);
      if (!exercise) return;
      exercise.trackingMode = button.dataset.trackingMode === "time" ? "time" : "reps";
      render();
      return;
    }

    if (action === "add-set") {
      const exercise = findDraftExercise(button.dataset.draftBlockId, button.dataset.draftExerciseId);
      exercise?.sets.push(blankSet());
      render();
      return;
    }

    if (action === "copy-set") {
      const exercise = findDraftExercise(button.dataset.draftBlockId, button.dataset.draftExerciseId);
      const last = exercise?.sets.at(-1);
      if (exercise && last) exercise.sets.push(blankSet(last));
      render();
      return;
    }

    if (action === "remove-set") {
      const exercise = findDraftExercise(button.dataset.draftBlockId, button.dataset.draftExerciseId);
      if (!exercise) return;
      exercise.sets = exercise.sets.filter((set) => set.draftId !== button.dataset.setId);
      if (exercise.sets.length === 0) exercise.sets.push(blankSet());
      render();
      return;
    }

    if (action === "save-workout") {
      await saveWorkout();
      return;
    }

    if (action === "delete-workout") {
      await api(`/api/workouts/${encodeURIComponent(button.dataset.workoutId)}?profileId=${encodeURIComponent(state.profile.id)}`, { method: "DELETE" });
      await loadProfileData();
      setNotice("Workout deleted.");
      return;
    }

    if (action === "edit-workout") {
      const workout = state.workouts.find((item) => item.id === button.dataset.workoutId);
      if (!workout) return;
      state.draft = draftFromWorkout(workout);
      state.editingWorkoutId = workout.id;
      state.exerciseSearch = "";
      state.addToBlockId = "";
      state.templateName = "";
      state.view = "log";
      setNotice("Editing saved workout.");
      return;
    }

    if (action === "cancel-edit-workout") {
      state.draft = newDraft();
      state.editingWorkoutId = "";
      state.exerciseSearch = "";
      state.addToBlockId = "";
      setNotice("Workout edit cancelled.");
      return;
    }

    if (action === "load-template") {
      const template = state.templates.find((item) => item.id === button.dataset.templateId);
      if (!template) return;
      state.draft = newDraft(template);
      state.exerciseSearch = "";
      state.addToBlockId = "";
      state.editingWorkoutId = "";
      state.view = "log";
      setNotice("Default workout loaded.");
      return;
    }

    if (action === "delete-template") {
      await api(`/api/templates/${encodeURIComponent(button.dataset.templateId)}?profileId=${encodeURIComponent(state.profile.id)}`, { method: "DELETE" });
      await loadProfileData();
      setNotice("Default workout deleted.");
      return;
    }

    if (action === "edit-exercise") {
      state.editingExerciseId = button.dataset.exerciseId;
      render();
      return;
    }

    if (action === "cancel-edit-exercise") {
      state.editingExerciseId = "";
      render();
      return;
    }

    if (action === "toggle-hide-exercise") {
      await api(`/api/exercises/${encodeURIComponent(button.dataset.exerciseId)}/hide`, {
        method: "POST",
        body: {
          profileId: state.profile.id,
          hidden: button.dataset.hidden === "true"
        }
      });
      await loadProfileData();
      render();
    }
  } catch (error) {
    setError(error.message);
  }
});

document.addEventListener("input", (event) => {
  const input = event.target;
  if (input.dataset.search === "log-exercise") {
    state.exerciseSearch = input.value;
    const matchesNode = document.querySelector("#exerciseMatches");
    const targetBlock = findDraftBlock(state.addToBlockId);
    const targetExerciseIds = new Set((targetBlock?.exercises || []).map((exercise) => exercise.exerciseId));
    const matches = exerciseMatches(state.exerciseSearch)
      .filter((exercise) => !targetBlock || !targetExerciseIds.has(exercise.id))
      .slice(0, 8);
    if (matchesNode) {
      matchesNode.innerHTML = matches.length === 0
        ? `<div class="empty-state">No visible exercises match that search.</div>`
        : matches.map((exercise) => renderExerciseSearchResult(exercise, Boolean(targetBlock))).join("");
    }
  }

  if (input.dataset.search === "manage-exercise") {
    state.exerciseManagerSearch = input.value;
    render();
  }

  if (input.dataset.draftField) {
    state.draft[input.dataset.draftField] = input.value;
  }

  if (input.dataset.templateName !== undefined) {
    state.templateName = input.value;
  }

  if (input.dataset.blockField) {
    const block = findDraftBlock(input.dataset.draftBlockId);
    if (block) block[input.dataset.blockField] = input.value;
  }

  if (input.dataset.setField) {
    const exercise = findDraftExercise(input.dataset.draftBlockId, input.dataset.draftExerciseId);
    const set = findDraftSet(exercise, input.dataset.setId);
    if (set) set[input.dataset.setField] = input.value;
  }
});

document.addEventListener("change", async (event) => {
  const input = event.target;

  if (input.dataset.draftField) {
    state.draft[input.dataset.draftField] = input.value;
  }

  if (input.dataset.blockField) {
    const block = findDraftBlock(input.dataset.draftBlockId);
    if (block) block[input.dataset.blockField] = input.value;
  }

  if (input.dataset.setField) {
    const exercise = findDraftExercise(input.dataset.draftBlockId, input.dataset.draftExerciseId);
    const set = findDraftSet(exercise, input.dataset.setId);
    if (set) set[input.dataset.setField] = input.value;
  }

  if (input.dataset.setting) {
    try {
      const payload = await api(`/api/profiles/${encodeURIComponent(state.profile.id)}/settings`, {
        method: "PATCH",
        body: { [input.dataset.setting]: input.checked }
      });
      state.profile = payload.profile;
      state.profiles = state.profiles.map((profile) => profile.id === payload.profile.id ? payload.profile : profile);
      localStorage.setItem(STORAGE_KEY, payload.profile.id);
      render();
    } catch (error) {
      setError(error.message);
    }
  }
});

loadBootstrap();
