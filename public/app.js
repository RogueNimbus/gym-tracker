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
  exerciseSearch: "",
  exerciseManagerSearch: "",
  editingExerciseId: "",
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

function newDraft() {
  const startTime = defaultStartTime();
  return {
    date: today(),
    startTime,
    endTime: nextSlot(startTime),
    energyScore: 3,
    exercises: []
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
  const [exercisePayload, workoutPayload] = await Promise.all([
    api(`/api/exercises?profileId=${encodeURIComponent(state.profile.id)}&includeHidden=true`),
    api(`/api/workouts?profileId=${encodeURIComponent(state.profile.id)}`)
  ]);
  state.exercises = exercisePayload.exercises;
  state.workouts = workoutPayload.workouts;
}

async function selectProfile(profileId) {
  const profile = state.profiles.find((item) => item.id === profileId);
  if (!profile) return;
  state.profile = profile;
  state.draft = newDraft();
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
  const addedExerciseIds = new Set(draft.exercises.map((exercise) => exercise.exerciseId));
  const matches = exerciseMatches(state.exerciseSearch).filter((exercise) => !addedExerciseIds.has(exercise.id)).slice(0, 8);

  return `
    <div class="desktop-columns">
      <section class="panel">
        <h2>Session</h2>
        <div class="form-row">
          <label for="workout-date">Day</label>
          <input id="workout-date" type="date" value="${escapeHtml(draft.date)}" data-draft-field="date">
        </div>
        <div class="form-grid">
          <div class="form-row">
            <label for="start-time">Start</label>
            <select id="start-time" data-draft-field="startTime">${timeOptions(draft.startTime)}</select>
          </div>
          <div class="form-row">
            <label for="end-time">End</label>
            <select id="end-time" data-draft-field="endTime">${timeOptions(draft.endTime, { includeEnd: true })}</select>
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
        <h2>Add exercise</h2>
        <div class="exercise-search-wrap">
          <input type="search" placeholder="Search exercise, muscle, equipment" value="${escapeHtml(state.exerciseSearch)}" data-search="log-exercise">
          <div class="search-results" id="exerciseMatches">
            ${matches.length === 0 ? `<div class="empty-state">No visible exercises match that search.</div>` : ""}
            ${matches.map(renderExerciseSearchResult).join("")}
          </div>
        </div>
      </section>
    </div>

    <section>
      <div class="exercise-header">
        <div>
          <h2>Workout sets</h2>
          <p class="muted">${draft.exercises.length === 0 ? "Add an exercise to start tracking sets." : "Each row is one performed set."}</p>
        </div>
      </div>
      <div class="selected-list">
        ${draft.exercises.length === 0 ? `<div class="empty-state">Your workout is empty.</div>` : ""}
        ${draft.exercises.map((exercise) => renderSelectedExercise(exercise, settings)).join("")}
      </div>
    </section>

    <div class="save-bar">
      <button class="btn" type="button" data-action="save-workout" ${draft.exercises.length === 0 ? "disabled" : ""}>Save workout</button>
    </div>
  `;
}

function renderExerciseSearchResult(exercise) {
  return `
    <div class="search-result">
      <div>
        <h3>${escapeHtml(exercise.name)}</h3>
        <div class="meta-line">
          <span>${escapeHtml(exercise.muscleGroup)}</span>
          <span>${escapeHtml(exercise.equipment)}</span>
        </div>
      </div>
      <button class="btn subtle" type="button" data-action="add-exercise-to-draft" data-exercise-id="${exercise.id}">Add</button>
    </div>
  `;
}

function setGridClass(settings) {
  if (!settings.showRest && !settings.showRir) return "compact";
  if (!settings.showRest) return "no-rest";
  if (!settings.showRir) return "no-rir";
  return "";
}

function renderSelectedExercise(exercise, settings) {
  const gridClass = setGridClass(settings);
  return `
    <section class="exercise-card">
      <header class="exercise-header">
        <div class="exercise-title">
          <h3>${escapeHtml(exercise.nameSnapshot)}</h3>
          <div class="meta-line">${exercise.sets.length} ${exercise.sets.length === 1 ? "set" : "sets"}</div>
        </div>
        <button class="icon-btn" type="button" data-action="remove-exercise-from-draft" data-draft-exercise-id="${exercise.draftId}" title="Remove exercise">X</button>
      </header>
      <div class="set-grid">
        <div class="set-head ${gridClass}">
          <span>Set</span>
          <span>Reps</span>
          <span>Lb</span>
          ${settings.showRest ? "<span>Rest</span>" : ""}
          ${settings.showRir ? "<span>RIR</span>" : ""}
          <span></span>
        </div>
        ${exercise.sets.map((set, index) => renderSetRow(exercise, set, index, settings)).join("")}
      </div>
      <div class="button-row" style="margin-top: 10px;">
        <button class="btn secondary" type="button" data-action="add-set" data-draft-exercise-id="${exercise.draftId}">Add set</button>
        <button class="btn secondary" type="button" data-action="copy-set" data-draft-exercise-id="${exercise.draftId}">Copy last</button>
      </div>
    </section>
  `;
}

function renderSetRow(exercise, set, index, settings) {
  const gridClass = setGridClass(settings);
  return `
    <div class="set-row ${gridClass}">
      <div class="set-number">${index + 1}</div>
      <input type="number" min="0" max="999" inputmode="numeric" value="${escapeHtml(set.reps)}" data-set-field="reps" data-draft-exercise-id="${exercise.draftId}" data-set-id="${set.draftId}" aria-label="Reps">
      <input type="number" min="0" max="2000" step="0.5" inputmode="decimal" value="${escapeHtml(set.weightLb)}" data-set-field="weightLb" data-draft-exercise-id="${exercise.draftId}" data-set-id="${set.draftId}" aria-label="Weight in pounds">
      ${settings.showRest ? `<input type="number" min="0" max="3600" inputmode="numeric" value="${escapeHtml(set.restSeconds)}" data-set-field="restSeconds" data-draft-exercise-id="${exercise.draftId}" data-set-id="${set.draftId}" aria-label="Rest seconds">` : ""}
      ${settings.showRir ? `<select data-set-field="rir" data-draft-exercise-id="${exercise.draftId}" data-set-id="${set.draftId}" aria-label="RIR">${rirOptions(set.rir)}</select>` : ""}
      <button class="icon-btn" type="button" data-action="remove-set" data-draft-exercise-id="${exercise.draftId}" data-set-id="${set.draftId}" title="Remove set">X</button>
    </div>
  `;
}

function workoutStats(workouts = state.workouts) {
  let setCount = 0;
  let volume = 0;
  for (const workout of workouts) {
    for (const exercise of workout.exercises) {
      for (const set of exercise.sets) {
        setCount += 1;
        if (Number.isFinite(set.reps) && Number.isFinite(set.weightLb)) {
          volume += set.reps * set.weightLb;
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
    <section class="workout-list">
      ${state.workouts.length === 0 ? `<div class="empty-state">No workouts yet. Your saved sessions will appear here.</div>` : ""}
      ${state.workouts.map(renderWorkoutCard).join("")}
    </section>
  `;
}

function renderWorkoutCard(workout) {
  const setCount = workout.exercises.reduce((total, exercise) => total + exercise.sets.length, 0);
  return `
    <article class="workout-card">
      <header class="workout-header">
        <div>
          <h3>${escapeHtml(workout.date)} · ${displayTime(workout.startTime)} -> ${displayTime(workout.endTime)}</h3>
          <div class="meta-line">
            <span>${workout.exercises.length} exercises</span>
            <span>${setCount} sets</span>
            ${workout.energyScore ? `<span>Energy ${workout.energyScore}/5</span>` : ""}
          </div>
        </div>
        <button class="icon-btn" type="button" data-action="delete-workout" data-workout-id="${workout.id}" title="Delete workout">X</button>
      </header>
      <details>
        <summary>Details</summary>
        <div class="details-list">
          ${workout.exercises.map(renderHistoryExercise).join("")}
        </div>
      </details>
    </article>
  `;
}

function renderHistoryExercise(exercise) {
  return `
    <div class="history-exercise">
      <strong>${escapeHtml(exercise.nameSnapshot)}</strong>
      ${exercise.sets.map((set) => {
        const parts = [
          `Set ${set.setNumber}`,
          set.reps === null ? null : `${set.reps} reps`,
          set.weightLb === null ? null : `${set.weightLb} lb`,
          set.restSeconds === null ? null : `${set.restSeconds}s rest`,
          set.rir === null ? null : `RIR ${set.rir}`
        ].filter(Boolean);
        return `<div class="history-set">${escapeHtml(parts.join(" · "))}</div>`;
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
            <span class="muted">Show seconds between sets.</span>
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

function findDraftExercise(draftExerciseId) {
  return state.draft?.exercises.find((exercise) => exercise.draftId === draftExerciseId);
}

function findDraftSet(exercise, setId) {
  return exercise?.sets.find((set) => set.draftId === setId);
}

function blankSet(seed = {}) {
  return {
    draftId: draftId(),
    reps: seed.reps ?? "",
    weightLb: seed.weightLb ?? "",
    restSeconds: seed.restSeconds ?? "",
    rir: seed.rir ?? ""
  };
}

async function saveWorkout() {
  const draft = state.draft;
  if (!draft || draft.exercises.length === 0) return;

  try {
    const body = {
      profileId: state.profile.id,
      date: draft.date,
      startTime: draft.startTime,
      endTime: draft.endTime,
      energyScore: activeSettings().showEnergy ? draft.energyScore : null,
      exercises: draft.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        nameSnapshot: exercise.nameSnapshot,
        sets: exercise.sets.map((set) => ({
          reps: set.reps,
          weightLb: set.weightLb,
          restSeconds: activeSettings().showRest ? set.restSeconds : null,
          rir: activeSettings().showRir ? set.rir : null
        }))
      }))
    };
    await api("/api/workouts", { method: "POST", body });
    state.draft = newDraft();
    state.exerciseSearch = "";
    await loadProfileData();
    state.view = "history";
    setNotice("Workout saved.");
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
      state.draft.exercises.push({
        draftId: draftId(),
        exerciseId: exercise.id,
        nameSnapshot: exercise.name,
        sets: [blankSet()]
      });
      state.exerciseSearch = "";
      render();
      return;
    }

    if (action === "remove-exercise-from-draft") {
      state.draft.exercises = state.draft.exercises.filter((exercise) => exercise.draftId !== button.dataset.draftExerciseId);
      render();
      return;
    }

    if (action === "add-set") {
      const exercise = findDraftExercise(button.dataset.draftExerciseId);
      exercise?.sets.push(blankSet());
      render();
      return;
    }

    if (action === "copy-set") {
      const exercise = findDraftExercise(button.dataset.draftExerciseId);
      const last = exercise?.sets.at(-1);
      if (exercise && last) exercise.sets.push(blankSet(last));
      render();
      return;
    }

    if (action === "remove-set") {
      const exercise = findDraftExercise(button.dataset.draftExerciseId);
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
    const addedExerciseIds = new Set(state.draft.exercises.map((exercise) => exercise.exerciseId));
    const matches = exerciseMatches(state.exerciseSearch).filter((exercise) => !addedExerciseIds.has(exercise.id)).slice(0, 8);
    if (matchesNode) {
      matchesNode.innerHTML = matches.length === 0
        ? `<div class="empty-state">No visible exercises match that search.</div>`
        : matches.map(renderExerciseSearchResult).join("");
    }
  }

  if (input.dataset.search === "manage-exercise") {
    state.exerciseManagerSearch = input.value;
    render();
  }

  if (input.dataset.draftField) {
    state.draft[input.dataset.draftField] = input.value;
  }

  if (input.dataset.setField) {
    const exercise = findDraftExercise(input.dataset.draftExerciseId);
    const set = findDraftSet(exercise, input.dataset.setId);
    if (set) set[input.dataset.setField] = input.value;
  }
});

document.addEventListener("change", async (event) => {
  const input = event.target;

  if (input.dataset.draftField) {
    state.draft[input.dataset.draftField] = input.value;
    if (input.dataset.draftField === "startTime" && timeSlots({ includeEnd: true }).indexOf(state.draft.endTime) <= timeSlots().indexOf(input.value)) {
      state.draft.endTime = nextSlot(input.value);
      render();
    }
  }

  if (input.dataset.setField) {
    const exercise = findDraftExercise(input.dataset.draftExerciseId);
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
