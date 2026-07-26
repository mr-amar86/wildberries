// ---------------------------------------------------------------------------
// PLAYGROUND.JS - builds the settings panel and wires it to the (unmodified)
// game engine from game.js, which has already run newGame() and started its
// render loop by the time this script executes. Runs entirely on top of the
// SETTINGS global; never edits settings.js or game.js.
// ---------------------------------------------------------------------------

const SCHEMA = [
  {
    title: "Terrain",
    fields: [
      { path: "terrain.roughness", label: "Roughness", min: 0, max: 1, step: 0.05 },
      { path: "terrain.minHeight", label: "Min Height", min: 20, max: 500, step: 10 },
      { path: "terrain.maxHeight", label: "Max Height", min: 20, max: 600, step: 10 },
      { path: "terrain.width", label: "Canvas Width", min: 600, max: 1800, step: 20, reload: true },
      { path: "terrain.height", label: "Canvas Height", min: 300, max: 900, step: 20, reload: true },
    ],
  },
  {
    title: "Tank & Controls",
    fields: [
      { path: "tank.startingAmmo", label: "Starting Ammo", min: 1, max: 60, step: 1 },
      { path: "tank.angleMin", label: "Angle Min", min: 0, max: 180, step: 1 },
      { path: "tank.angleMax", label: "Angle Max", min: 0, max: 180, step: 1 },
      { path: "tank.powerMin", label: "Power Min", min: 0, max: 100, step: 1 },
      { path: "tank.powerMax", label: "Power Max", min: 0, max: 250, step: 1 },
      { path: "tank.powerToVelocityScale", label: "Power → Velocity Scale", min: 0.02, max: 0.5, step: 0.01 },
      { path: "tank.angleStep", label: "Angle Step / frame", min: 0.1, max: 5, step: 0.1 },
      { path: "tank.powerStep", label: "Power Step / frame", min: 0.1, max: 5, step: 0.1 },
    ],
  },
  {
    title: "Physics & Wind",
    fields: [
      { path: "gravity", label: "Gravity", min: 0.01, max: 0.6, step: 0.01 },
      { path: "wind.min", label: "Wind Min", min: -150, max: 0, step: 5 },
      { path: "wind.max", label: "Wind Max", min: 0, max: 150, step: 5 },
      { path: "wind.changeEvery", label: "Wind Changes", type: "select", options: ["shot", "round"] },
      { path: "wind.visualScale", label: "Wind Meter Visual Scale", min: 0.1, max: 3, step: 0.1 },
      { path: "wind.accelScale", label: "Wind Accel Scale", min: 0.0005, max: 0.02, step: 0.0005 },
    ],
  },
  {
    title: "Base",
    fields: [
      { path: "base.maxHP", label: "Max HP", min: 10, max: 500, step: 10 },
      { path: "base.width", label: "Width", min: 20, max: 200, step: 2 },
      { path: "base.height", label: "Height", min: 10, max: 150, step: 2 },
    ],
  },
  {
    title: "Standard Damage (fallback)",
    fields: [
      { path: "damage.directHitMin", label: "Direct Hit Min", min: 0, max: 150, step: 1 },
      { path: "damage.directHitMax", label: "Direct Hit Max", min: 0, max: 200, step: 1 },
      { path: "damage.splashRadiusMultiplier", label: "Splash Radius × base.width", min: 0.2, max: 6, step: 0.1 },
      { path: "damage.nearMissDamageClose", label: "Near-Miss Close", min: 0, max: 60, step: 1 },
      { path: "damage.nearMissDamageFar", label: "Near-Miss Far", min: 0, max: 30, step: 1 },
      { path: "damage.falloffExponent", label: "Falloff Exponent", min: 0.2, max: 4, step: 0.1 },
    ],
  },
  {
    title: "Crater",
    fields: [{ path: "crater.radius", label: "Radius", min: 5, max: 100, step: 1 }],
  },
  {
    title: "Shield",
    fields: [
      { path: "shield.enabled", label: "Enabled", type: "checkbox" },
      { path: "shield.cyclePeriodMin", label: "Cycle Period Min (s)", min: 1, max: 30, step: 0.5 },
      { path: "shield.cyclePeriodMax", label: "Cycle Period Max (s)", min: 1, max: 30, step: 0.5 },
      { path: "shield.activeDurationMin", label: "Active Duration Min (s)", min: 0.1, max: 10, step: 0.1 },
      { path: "shield.activeDurationMax", label: "Active Duration Max (s)", min: 0.1, max: 10, step: 0.1 },
      { path: "shield.damageReduction", label: "Damage Reduction", min: 0, max: 1, step: 0.05 },
      { path: "shield.flickerSpeed", label: "Flicker Speed", min: 1, max: 40, step: 1 },
    ],
  },
  {
    title: "Depot Defense Drones",
    fields: [
      { path: "defenseDrones.enabled", label: "Enabled", type: "checkbox" },
      { path: "defenseDrones.countMin", label: "Count Min", min: 0, max: 12, step: 1 },
      { path: "defenseDrones.countMax", label: "Count Max", min: 0, max: 12, step: 1 },
      { path: "defenseDrones.spawnZoneStart", label: "Spawn Zone Start (× width)", min: 0, max: 0.95, step: 0.05 },
      { path: "defenseDrones.altitudeMin", label: "Altitude Min (px above ground)", min: 10, max: 400, step: 10 },
      { path: "defenseDrones.altitudeMax", label: "Altitude Max (px above ground)", min: 10, max: 500, step: 10 },
      { path: "defenseDrones.hoverRadius", label: "Hover Drift Radius", min: 0, max: 100, step: 2 },
      { path: "defenseDrones.hoverSpeed", label: "Hover Speed", min: 0.0002, max: 0.01, step: 0.0002 },
      { path: "defenseDrones.hitRadius", label: "Hit Radius", min: 2, max: 40, step: 1 },
    ],
  },
  {
    title: "Buildings",
    fields: [
      { path: "buildings.count", label: "Count", min: 0, max: 60, step: 1 },
      { path: "buildings.minSize", label: "Min Size", min: 5, max: 100, step: 1 },
      { path: "buildings.maxSize", label: "Max Size", min: 5, max: 150, step: 1 },
      { path: "buildings.hitBehavior", label: "Hit Behavior", type: "select", options: ["none", "cosmetic", "solid"] },
    ],
  },
];

function weaponFields(w, base) {
  const fields = [
    { path: `${base}.ammoCost`, label: "Ammo Cost", min: 1, max: 10, step: 1 },
    { path: `${base}.projectileRadius`, label: "Projectile Radius", min: 1, max: 15, step: 1 },
  ];
  if (w.velocityScale !== undefined) {
    fields.push({ path: `${base}.velocityScale`, label: "Velocity Scale", min: 0.02, max: 0.5, step: 0.01 });
  }
  if (w.directHitMin !== undefined) {
    fields.push(
      { path: `${base}.directHitMin`, label: "Direct Hit Min", min: 0, max: 150, step: 1 },
      { path: `${base}.directHitMax`, label: "Direct Hit Max", min: 0, max: 200, step: 1 },
      { path: `${base}.splashRadiusMultiplier`, label: "Splash Radius × base.width", min: 0.2, max: 6, step: 0.1 },
      { path: `${base}.nearMissDamageClose`, label: "Near-Miss Close", min: 0, max: 60, step: 1 },
      { path: `${base}.nearMissDamageFar`, label: "Near-Miss Far", min: 0, max: 30, step: 1 },
      { path: `${base}.falloffExponent`, label: "Falloff Exponent", min: 0.2, max: 4, step: 0.1 },
      { path: `${base}.craterRadius`, label: "Crater Radius", min: 5, max: 100, step: 1 },
    );
  }
  if (w.clusterCount !== undefined) {
    fields.push(
      { path: `${base}.clusterCount`, label: "Cluster Count", min: 1, max: 20, step: 1 },
      { path: `${base}.clusterSpreadSpeed`, label: "Cluster Spread Speed", min: 0.5, max: 12, step: 0.1 },
      { path: `${base}.bomblet.directHitMin`, label: "Bomblet Direct Hit Min", min: 0, max: 100, step: 1 },
      { path: `${base}.bomblet.directHitMax`, label: "Bomblet Direct Hit Max", min: 0, max: 150, step: 1 },
      { path: `${base}.bomblet.splashRadiusMultiplier`, label: "Bomblet Splash Radius × base.width", min: 0.2, max: 6, step: 0.1 },
      { path: `${base}.bomblet.nearMissDamageClose`, label: "Bomblet Near-Miss Close", min: 0, max: 60, step: 1 },
      { path: `${base}.bomblet.nearMissDamageFar`, label: "Bomblet Near-Miss Far", min: 0, max: 30, step: 1 },
      { path: `${base}.bomblet.falloffExponent`, label: "Bomblet Falloff Exponent", min: 0.2, max: 4, step: 0.1 },
      { path: `${base}.bomblet.craterRadius`, label: "Bomblet Crater Radius", min: 5, max: 100, step: 1 },
    );
  }
  if (w.isDrone) {
    fields.push(
      { path: `${base}.drone.batteryMs`, label: "Battery (ms)", min: 500, max: 15000, step: 100 },
      { path: `${base}.drone.thrustAccel`, label: "Thrust Accel", min: 0.05, max: 1, step: 0.01 },
      { path: `${base}.drone.maxSpeed`, label: "Max Speed", min: 1, max: 20, step: 0.5 },
      { path: `${base}.drone.gravity`, label: "Drone Gravity (sink)", min: 0, max: 0.3, step: 0.01 },
      { path: `${base}.drone.windMultiplier`, label: "Wind Multiplier", min: 0.2, max: 5, step: 0.1 },
    );
  }
  return fields;
}

let dirty = false;
function markDirty() {
  if (dirty) return;
  dirty = true;
  const btn = document.getElementById("pg-apply");
  btn.classList.add("dirty");
  btn.textContent = "Apply Settings & Reload ●";
}

function renderField(container, field, draft) {
  const row = document.createElement("div");
  row.className = "pg-field";

  const label = document.createElement("label");
  label.textContent = field.label;
  if (field.reload) {
    const tag = document.createElement("span");
    tag.className = "pg-reload-tag";
    tag.textContent = "reload";
    tag.title = "Affects canvas size - takes effect on Apply & Reload, not New Terrain.";
    label.appendChild(tag);
  }
  row.appendChild(label);

  const current = twGetPath(draft, field.path);

  if (field.type === "checkbox") {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!current;
    input.addEventListener("change", () => {
      twSetPath(draft, field.path, input.checked);
      markDirty();
    });
    row.appendChild(input);
  } else if (field.type === "select") {
    const select = document.createElement("select");
    field.options.forEach((opt) => {
      const value = opt && opt.value !== undefined ? opt.value : opt;
      const text = opt && opt.label !== undefined ? opt.label : opt;
      const o = document.createElement("option");
      o.value = value;
      o.textContent = text;
      if (String(value) === String(current)) o.selected = true;
      select.appendChild(o);
    });
    select.addEventListener("change", () => {
      const v = field.numeric ? Number(select.value) : select.value;
      twSetPath(draft, field.path, v);
      markDirty();
    });
    row.appendChild(select);
  } else {
    const wrap = document.createElement("div");
    wrap.className = "pg-range-wrap";
    const range = document.createElement("input");
    range.type = "range";
    range.min = field.min;
    range.max = field.max;
    range.step = field.step;
    range.value = current;
    const num = document.createElement("input");
    num.type = "number";
    num.min = field.min;
    num.max = field.max;
    num.step = field.step;
    num.value = current;
    range.addEventListener("input", () => {
      num.value = range.value;
      twSetPath(draft, field.path, Number(range.value));
      markDirty();
    });
    num.addEventListener("input", () => {
      if (num.value === "") return;
      range.value = num.value;
      twSetPath(draft, field.path, Number(num.value));
      markDirty();
    });
    wrap.appendChild(range);
    wrap.appendChild(num);
    row.appendChild(wrap);
  }

  container.appendChild(row);
}

function addSection(root, title, buildBody) {
  const details = document.createElement("details");
  details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = title;
  details.appendChild(summary);
  const body = document.createElement("div");
  body.className = "pg-section-body";
  buildBody(body);
  details.appendChild(body);
  root.appendChild(details);
}

function buildPanel() {
  const draft = twCloneDeep(SETTINGS);
  const root = document.getElementById("pg-sections");
  root.innerHTML = "";

  SCHEMA.forEach((section) => {
    addSection(root, section.title, (body) => {
      section.fields.forEach((f) => renderField(body, f, draft));
    });
  });

  addSection(root, "Weapons", (body) => {
    renderField(
      body,
      {
        path: "weapons.startingIndex",
        label: "Starting Weapon",
        type: "select",
        numeric: true,
        options: SETTINGS.weapons.list.map((w, i) => ({ value: i, label: w.label })),
      },
      draft
    );
  });

  SETTINGS.weapons.list.forEach((w, i) => {
    addSection(root, `${i + 1}. ${w.label}`, (body) => {
      weaponFields(w, `weapons.list.${i}`).forEach((f) => renderField(body, f, draft));
    });
  });

  return draft;
}

function updateStatusBanner() {
  const banner = document.getElementById("pg-status");
  const hasOverrides = !!localStorage.getItem(TW_STORAGE_KEY);
  banner.textContent = hasOverrides ? "Custom settings active" : "Default settings";
  banner.classList.toggle("custom", hasOverrides);
}

(function init() {
  const draft = buildPanel();
  updateStatusBanner();

  document.getElementById("pg-apply").addEventListener("click", () => {
    localStorage.setItem(TW_STORAGE_KEY, JSON.stringify(draft));
    location.reload();
  });

  document.getElementById("pg-newmap").addEventListener("click", () => {
    newGame();
  });

  document.getElementById("pg-reset").addEventListener("click", () => {
    localStorage.removeItem(TW_STORAGE_KEY);
    location.reload();
  });
})();
