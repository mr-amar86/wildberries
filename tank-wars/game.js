// ---------------------------------------------------------------------------
// TANK WARS - game logic. All tunable numbers come from SETTINGS (settings.js).
// ---------------------------------------------------------------------------

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const W = SETTINGS.terrain.width;         // full scrollable world width
const VIEW_W = SETTINGS.terrain.viewWidth; // visible viewport (canvas pixel width)
const H = SETTINGS.terrain.height;
canvas.width = VIEW_W;
canvas.height = H;

// ---- DOM refs -------------------------------------------------------------
const el = {
  angle: document.getElementById("hud-angle"),
  power: document.getElementById("hud-power"),
  ammo: document.getElementById("hud-ammo"),
  hpBar: document.getElementById("hp-bar-inner"),
  overlay: document.getElementById("overlay"),
  overlayTitle: document.getElementById("overlay-title"),
  overlayDetail: document.getElementById("overlay-detail"),
  playAgain: document.getElementById("play-again"),
  fireBtn: document.getElementById("fire-btn"),
  weaponSelect: document.getElementById("weapon-select"),
  droneStatus: document.getElementById("drone-status"),
  batteryBar: document.getElementById("battery-bar-inner"),
};

// ---- helpers ---------------------------------------------------------------
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function randRange(lo, hi) { return lo + Math.random() * (hi - lo); }
function lerp(a, b, t) { return a + (b - a) * t; }

// ---- mutable game state -----------------------------------------------------
let terrainHeights;      // Float64Array[W] - surface y per column
let tankX, baseX;
let tankGroundY, baseGroundY;
let baseBox;             // {left, right, top, bottom}

let tank, base, wind, ammo, shotsFired, activeProjectiles, trails, volleyPending;
let damageTexts, particles, keys, gameOver, gameWon, buildings, currentWeaponIndex;
let defenseDrones;
let background, soilSpecks;

// ---- camera -----------------------------------------------------------------
// the world can be wider than the viewport; cameraX is the world-x shown at screen-x 0.
// manualPan is set while the player drags/scrolls the map by hand, which suspends
// auto-follow until the next shot is fired.
let cameraX = 0;
let manualPan = false;
let isDragging = false, dragStartClientX = 0, dragStartCamera = 0;

function newGame() {
  terrainHeights = generateTerrain();

  tankX = Math.round(W * 0.12);
  baseX = Math.round(W * 0.85);

  flatten(tankX, SETTINGS.tank.width * 3);
  flatten(baseX, SETTINGS.base.width * 1.8);

  tankGroundY = terrainHeights[tankX];
  baseGroundY = terrainHeights[baseX];

  baseBox = {
    left: baseX - SETTINGS.base.width / 2,
    right: baseX + SETTINGS.base.width / 2,
    top: baseGroundY - SETTINGS.base.height,
    bottom: baseGroundY,
  };

  buildings = generateBuildings();
  background = generateBackground();
  soilSpecks = generateSoilTexture();

  cameraX = clamp(tankX - VIEW_W * SETTINGS.camera.idleAnchorFrac, 0, W - VIEW_W);
  manualPan = false;

  tank = { angle: 55, power: 55 };
  base = {
    hp: SETTINGS.base.maxHP,
    scorchMarks: [],
    destroyed: false,
    shieldPeriodMs: randRange(SETTINGS.shield.cyclePeriodMin, SETTINGS.shield.cyclePeriodMax) * 1000,
    shieldActiveMs: randRange(SETTINGS.shield.activeDurationMin, SETTINGS.shield.activeDurationMax) * 1000,
    shieldCycleStart: performance.now(),
  };
  ammo = SETTINGS.tank.startingAmmo;
  shotsFired = 0;
  activeProjectiles = [];
  trails = [];
  volleyPending = false;
  defenseDrones = [];
  damageTexts = [];
  particles = [];
  keys = keys || {};
  gameOver = false;
  gameWon = false;
  currentWeaponIndex = SETTINGS.weapons.startingIndex;

  rollWind();
  el.overlay.classList.add("hidden");
  buildWeaponUI();
  updateHUD();
}

// ---- terrain generation (midpoint displacement) ----------------------------
function generateTerrain() {
  const segs = 256; // power of two working resolution (kept low so hills stay smooth/rolling; fine sub-pixel noise is not useful at 3000px wide)
  const minH = SETTINGS.terrain.minHeight;
  const maxH = SETTINGS.terrain.maxHeight;
  const roughness = clamp(SETTINGS.terrain.roughness, 0, 1);
  const decay = 0.25 + roughness * 0.45;

  const work = new Float64Array(segs + 1);
  work[0] = randRange(minH, maxH);
  work[segs] = randRange(minH, maxH);

  let range = maxH - minH;
  let step = segs;
  while (step > 1) {
    const half = step / 2;
    for (let i = half; i < segs; i += step) {
      const avg = (work[i - half] + work[i + half]) / 2;
      work[i] = clamp(avg + (Math.random() * 2 - 1) * range, minH - range, maxH + range);
    }
    range *= decay;
    step = half;
  }

  const heights = new Float64Array(W);
  for (let x = 0; x < W; x++) {
    const idx = (x / (W - 1)) * segs;
    const i0 = Math.floor(idx);
    const i1 = Math.min(segs, i0 + 1);
    const t = idx - i0;
    const hillHeight = clamp(lerp(work[i0], work[i1], t), minH, maxH);
    heights[x] = H - hillHeight;
  }
  return heights;
}

function flatten(centerX, halfWidth) {
  const flatY = terrainHeights[clamp(Math.round(centerX), 0, W - 1)];
  const lo = Math.max(0, Math.round(centerX - halfWidth));
  const hi = Math.min(W - 1, Math.round(centerX + halfWidth));
  for (let x = lo; x <= hi; x++) terrainHeights[x] = flatY;
}

function terrainHeightAt(x) {
  return terrainHeights[clamp(Math.round(x), 0, W - 1)];
}

function craterAt(cx, cy, radius) {
  const lo = Math.max(0, Math.floor(cx - radius));
  const hi = Math.min(W - 1, Math.ceil(cx + radius));
  const tankPedLo = tankX - SETTINGS.tank.width / 2 - 2, tankPedHi = tankX + SETTINGS.tank.width / 2 + 2;
  const basePedLo = baseX - SETTINGS.base.width / 2 - 2, basePedHi = baseX + SETTINGS.base.width / 2 + 2;
  for (let x = lo; x <= hi; x++) {
    // keep the tank/base standing on solid ground even if a shell lands right beside or under them
    if ((x >= tankPedLo && x <= tankPedHi) || (x >= basePedLo && x <= basePedHi)) continue;
    const dx = x - cx;
    if (Math.abs(dx) > radius) continue;
    const craterY = cy + Math.sqrt(radius * radius - dx * dx);
    if (craterY > terrainHeights[x]) terrainHeights[x] = craterY;
  }
}

// ---- distant scenery (sky silhouette layers) + soil texture -----------------
const DISTANT_BUILDING_COLOR = "rgba(47,51,58,0.28)";
const FOREST_SHADES = ["#2e4a2a", "#355b30", "#284122"];
const SOIL_SHADES = [
  "rgba(120,86,52,0.5)",
  "rgba(40,26,12,0.55)",
  "rgba(160,120,80,0.35)",
  "rgba(90,60,35,0.45)",
];

// rolled once per game so the skyline/soil pattern stay put for the round, same as buildings
function generateBackground() {
  const distantBuildings = [];
  for (let i = 0; i < SETTINGS.background.distantBuildingCount; i++) {
    distantBuildings.push({
      x: randRange(0, W),
      width: randRange(18, 44),
      height: randRange(H * 0.06, H * 0.2),
      hasStack: Math.random() < 0.35,
    });
  }

  const forest = [];
  for (let i = 0; i < SETTINGS.background.treeCount; i++) {
    forest.push({
      x: randRange(0, W),
      width: randRange(12, 22),
      height: randRange(16, 38),
      shade: FOREST_SHADES[Math.floor(Math.random() * FOREST_SHADES.length)],
    });
  }

  return { distantBuildings, forest };
}

// small tinted specks scattered through the dirt so it isn't a flat gradient; y is
// recomputed from the live terrain surface each draw, so craters carry the texture with them
function generateSoilTexture() {
  const specks = [];
  for (let i = 0; i < SETTINGS.terrain.soilSpeckCount; i++) {
    specks.push({
      x: randRange(0, W),
      depth: randRange(3, 220),
      size: randRange(1, 3),
      shade: SOIL_SHADES[Math.floor(Math.random() * SOIL_SHADES.length)],
    });
  }
  return specks;
}

// ---- background apartment blocks (panelki) ----------------------------------
const CONCRETE_SHADES = ["#8b8d86", "#9a988c", "#7d8177", "#a3a396", "#8f8a7c"];

function generateBuildings() {
  const list = [];
  const tankExclLo = tankX - SETTINGS.tank.width * 3 - 20;
  const tankExclHi = tankX + SETTINGS.tank.width * 3 + 20;
  const baseExclLo = baseX - SETTINGS.base.width * 1.8 - 20;
  const baseExclHi = baseX + SETTINGS.base.width * 1.8 + 20;

  for (let i = 0; i < SETTINGS.buildings.count; i++) {
    let x, tries = 0;
    do {
      x = randRange(25, W - 25);
      tries++;
    } while (
      ((x >= tankExclLo && x <= tankExclHi) || (x >= baseExclLo && x <= baseExclHi)) &&
      tries < 25
    );

    const size = randRange(SETTINGS.buildings.minSize, SETTINGS.buildings.maxSize);
    const width = size * randRange(0.85, 1.1);
    const floors = Math.round(randRange(3, 7));
    const windowCols = Math.max(2, Math.round(width / 13));
    const height = floors * (size * 0.4);

    const litWindows = new Set();
    for (let r = 0; r < floors; r++) {
      for (let c = 0; c < windowCols; c++) {
        if (Math.random() < 0.16) litWindows.add(r + "," + c);
      }
    }

    list.push({
      x, width, height, floors, windowCols,
      color: CONCRETE_SHADES[Math.floor(Math.random() * CONCRETE_SHADES.length)],
      hasAerial: Math.random() < 0.5,
      litWindows,
      destroyed: false,
    });
  }
  return list;
}

function buildingBox(b) {
  const groundY = terrainHeightAt(b.x);
  return {
    left: b.x - b.width / 2,
    right: b.x + b.width / 2,
    top: groundY - b.height,
    bottom: groundY,
    groundY,
  };
}

function checkBuildingHit(x, y) {
  if (SETTINGS.buildings.hitBehavior === "none") return null;
  for (const b of buildings) {
    if (b.destroyed) continue;
    const box = buildingBox(b);
    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return b;
  }
  return null;
}

// ---- depot defense drones -----------------------------------------------
// scrambled fresh each time the player launches their own FPV drone, guarding
// the depot's side of the map until that volley resolves (see updateProjectile).
function spawnDefenseDrones() {
  const cfg = SETTINGS.defenseDrones;
  if (!cfg.enabled) return;
  const count = Math.round(randRange(cfg.countMin, cfg.countMax));
  const zoneLo = W * cfg.spawnZoneStart;
  for (let i = 0; i < count; i++) {
    const anchorX = randRange(zoneLo, W - 15);
    const groundY = terrainHeightAt(anchorX);
    const altitude = randRange(cfg.altitudeMin, cfg.altitudeMax);
    defenseDrones.push({
      anchorX,
      y: clamp(groundY - altitude, 20, groundY - 20),
      phase: Math.random() * Math.PI * 2,
      x: anchorX,
    });
  }
}

function updateDefenseDrones(now) {
  const cfg = SETTINGS.defenseDrones;
  for (const d of defenseDrones) {
    d.x = d.anchorX + Math.sin(now * cfg.hoverSpeed + d.phase) * cfg.hoverRadius;
  }
}

function checkDefenseDroneHit(x, y) {
  const r = SETTINGS.defenseDrones.hitRadius;
  for (const d of defenseDrones) {
    const dx = x - d.x, dy = y - d.y;
    if (dx * dx + dy * dy <= r * r) return d;
  }
  return null;
}

// both drones are destroyed on contact; the depot itself takes no damage from an interception
function resolveDefenseDroneHit(p, d) {
  defenseDrones.splice(defenseDrones.indexOf(d), 1);
  const mx = (p.x + d.x) / 2, my = (p.y + d.y) / 2;
  spawnParticles(mx, my, ["#e8c9c9", "#8a2020", "#3a1414"]);
  spawnDamageText(mx, my, "INTERCEPTED", "#ff8f6b");
}

// ---- wind -------------------------------------------------------------------
function rollWind() {
  wind = randRange(SETTINGS.wind.min, SETTINGS.wind.max);
}

// ---- camera -------------------------------------------------------------
// while manually panned, the camera just sits wherever the player left it; otherwise
// it eases toward the in-flight projectile, or a fixed anchor point near the tank
function desiredCameraX() {
  if (manualPan) return cameraX;
  const proj = activeProjectiles[0];
  if (proj) return clamp(proj.x - VIEW_W / 2, 0, W - VIEW_W);
  return clamp(tankX - VIEW_W * SETTINGS.camera.idleAnchorFrac, 0, W - VIEW_W);
}

function updateCamera() {
  cameraX = clamp(lerp(cameraX, desiredCameraX(), SETTINGS.camera.followEase), 0, W - VIEW_W);
}

// ---- input --------------------------------------------------------------
const KEY_BLOCK = new Set([
  "arrowleft", "arrowright", "arrowup", "arrowdown", " ", "a", "d", "w", "s",
]);
keys = {};

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (KEY_BLOCK.has(k)) e.preventDefault();
  keys[k] = true;
  if (k === " ") fire();
  if (k >= "1" && k <= "9") setWeapon(Number(k) - 1);
});
window.addEventListener("keyup", (e) => {
  keys[e.key.toLowerCase()] = false;
});
el.fireBtn.addEventListener("click", fire);
el.playAgain.addEventListener("click", newGame);

// click-drag or scroll the map to look around; both hand control to manualPan
// until the next shot is fired (see fire())
canvas.addEventListener("mousedown", (e) => {
  isDragging = true;
  dragStartClientX = e.clientX;
  dragStartCamera = cameraX;
});
window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  manualPan = true;
  const scale = VIEW_W / canvas.getBoundingClientRect().width;
  cameraX = clamp(dragStartCamera - (e.clientX - dragStartClientX) * scale, 0, W - VIEW_W);
});
window.addEventListener("mouseup", () => { isDragging = false; });
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  manualPan = true;
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  cameraX = clamp(cameraX + delta, 0, W - VIEW_W);
}, { passive: false });

// ---- weapons --------------------------------------------------------------
function currentWeapon() {
  return SETTINGS.weapons.list[currentWeaponIndex];
}

// resolves a weapon (or its bomblet sub-config) into a full damage/crater profile,
// falling back to the top-level damage/crater settings for the "standard" shell
function weaponProfile(weapon) {
  if (weapon.directHitMin === undefined) {
    return { ...SETTINGS.damage, craterRadius: SETTINGS.crater.radius };
  }
  return weapon;
}

function setWeapon(i) {
  if (i < 0 || i >= SETTINGS.weapons.list.length) return;
  currentWeaponIndex = i;
  updateWeaponUI();
}

function buildWeaponUI() {
  el.weaponSelect.innerHTML = "";
  SETTINGS.weapons.list.forEach((w, i) => {
    const btn = document.createElement("button");
    btn.className = "weapon-btn";
    btn.textContent = `${i + 1}. ${w.label} (${w.ammoCost})`;
    btn.addEventListener("click", () => setWeapon(i));
    el.weaponSelect.appendChild(btn);
  });
  updateWeaponUI();
}

function updateWeaponUI() {
  Array.from(el.weaponSelect.children).forEach((btn, i) => {
    btn.classList.toggle("active", i === currentWeaponIndex);
    btn.disabled = ammo < SETTINGS.weapons.list[i].ammoCost;
  });
}

// ---- firing -------------------------------------------------------------
function barrelTip() {
  const rad = (tank.angle * Math.PI) / 180;
  const pivotX = tankX;
  const pivotY = tankGroundY - SETTINGS.tank.height;
  return {
    x: pivotX + Math.cos(rad) * SETTINGS.tank.barrelLength,
    y: pivotY - Math.sin(rad) * SETTINGS.tank.barrelLength,
  };
}

function fire() {
  const weapon = currentWeapon();
  if (activeProjectiles.length > 0 || ammo < weapon.ammoCost || gameOver) return;
  ammo -= weapon.ammoCost;
  shotsFired++;
  volleyPending = true;
  manualPan = false; // firing hands control of the camera back to auto-follow
  if (weapon.isDrone) spawnDefenseDrones();

  const rad = (tank.angle * Math.PI) / 180;
  const speed = tank.power * (weapon.velocityScale || SETTINGS.tank.powerToVelocityScale);
  const tip = barrelTip();

  spawnProjectile(tip.x, tip.y, Math.cos(rad) * speed, -Math.sin(rad) * speed, weapon, false);
  updateHUD();
}

function spawnProjectile(x, y, vx, vy, weapon, isBomblet) {
  const trailObj = { points: [], impactAt: null };
  trails.push(trailObj);
  const proj = { x, y, vx, vy, weapon, isBomblet, trail: trailObj };
  if (weapon.isDrone) proj.battery = weapon.drone.batteryMs;
  activeProjectiles.push(proj);
}

function pilotedDrone() {
  return activeProjectiles.find((p) => p.weapon.isDrone) || null;
}

function checkBaseHit(x, y) {
  if (base.destroyed) return false;
  return x >= baseBox.left && x <= baseBox.right && y >= baseBox.top && y <= baseBox.bottom;
}

function isShieldActive(now) {
  if (!SETTINGS.shield.enabled) return false;
  const elapsed = (now - base.shieldCycleStart) % base.shieldPeriodMs;
  return elapsed < base.shieldActiveMs;
}

function computeDamage(ix, iy, hitBase, profile) {
  if (hitBase) {
    return { damage: randRange(profile.directHitMin, profile.directHitMax), type: "direct" };
  }
  const dx = Math.max(baseBox.left - ix, 0, ix - baseBox.right);
  const dy = Math.max(baseBox.top - iy, 0, iy - baseBox.bottom);
  const dist = Math.sqrt(dx * dx + dy * dy);
  const splashRadius = profile.splashRadiusMultiplier * SETTINGS.base.width;
  if (dist <= splashRadius) {
    const t = clamp(dist / splashRadius, 0, 1);
    const factor = Math.pow(1 - t, profile.falloffExponent);
    const dmg = profile.nearMissDamageFar +
      (profile.nearMissDamageClose - profile.nearMissDamageFar) * factor;
    return { damage: dmg, type: "splash" };
  }
  return { damage: 0, type: "none" };
}

function spawnDamageText(x, y, text, color) {
  damageTexts.push({ x, y, text, color, born: performance.now() });
}

function spawnParticles(x, y, palette) {
  const colors = palette || ["#ff8c42", "#7a7a7a"];
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.3;
    const speed = randRange(1, 4.5);
    particles.push({
      x, y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed - 1,
      born: performance.now(),
      life: randRange(500, 1000),
      color: colors[Math.floor(Math.random() * colors.length)],
      size: randRange(2, 4),
    });
  }
}

function resolveBuildingHit(building, x, y) {
  building.destroyed = true;
  spawnParticles(x, y, ["#c9c6ba", "#6b6a62", "#8a8a8a"]);
  return SETTINGS.buildings.hitBehavior === "solid"; // true = shot stops here, false = cosmetic (keeps flying)
}

function addScorchMark() {
  if (base.scorchMarks.length >= 14) return;
  base.scorchMarks.push({
    rx: randRange(-0.4, 0.4),
    ry: randRange(-0.4, 0.35),
    r: randRange(4, 9),
  });
}

function spawnBomblets(x, y, weapon) {
  for (let i = 0; i < weapon.clusterCount; i++) {
    const vx = randRange(-weapon.clusterSpreadSpeed, weapon.clusterSpreadSpeed);
    const vy = randRange(-weapon.clusterSpreadSpeed, -1);
    spawnProjectile(x, y, vx, vy, weapon, true);
  }
}

function explode(ix, iy, hitBase, proj) {
  const profile = proj.isBomblet ? proj.weapon.bomblet : weaponProfile(proj.weapon);
  craterAt(ix, terrainHeightAt(ix), profile.craterRadius);

  if (!base.destroyed) {
    const { damage, type } = computeDamage(ix, iy, hitBase, profile);
    if (damage > 0) {
      const shielded = isShieldActive(performance.now());
      const finalDamage = shielded ? damage * (1 - SETTINGS.shield.damageReduction) : damage;
      base.hp = Math.max(0, base.hp - finalDamage);
      spawnDamageText(
        ix, iy,
        "-" + Math.round(finalDamage) + (shielded ? " (shielded)" : ""),
        shielded ? "#7fe0ff" : type === "direct" ? "#ff5c5c" : "#ffcf5c"
      );
      addScorchMark();
      if (base.hp <= 0) base.destroyed = true;
    }
  }

  spawnParticles(ix, iy);
  if (proj.weapon.id === "cluster" && !proj.isBomblet) spawnBomblets(ix, iy, proj.weapon);
}

function checkGameEnd() {
  if (base.hp <= 0 && !gameOver) {
    gameOver = true;
    gameWon = true;
    const ammoUsed = SETTINGS.tank.startingAmmo - ammo;
    const efficiency = Math.round((ammo / SETTINGS.tank.startingAmmo) * 100);
    showOverlay(
      "Logistics Base Destroyed!",
      `Shots fired: ${shotsFired}<br>Ammo used: ${ammoUsed} / ${SETTINGS.tank.startingAmmo}<br>Efficiency score: ${efficiency}%`
    );
  } else if (activeProjectiles.length === 0 && base.hp > 0 && !gameOver) {
    const minCost = Math.min(...SETTINGS.weapons.list.map((w) => w.ammoCost));
    if (ammo < minCost) {
      gameOver = true;
      showOverlay(
        "Out of Ammo — Base Survived",
        `Base HP remaining: ${Math.round(base.hp)} / ${SETTINGS.base.maxHP}`
      );
    }
  }
}

function showOverlay(title, detailHtml) {
  el.overlayTitle.textContent = title;
  el.overlayDetail.innerHTML = detailHtml;
  el.overlay.classList.remove("hidden");
}

// ---- physics update -------------------------------------------------------
// shared collision checks for anything currently in flight (shell, bomblet, or drone).
// returns true once the projectile is resolved (exploded, or silently left the play area).
function resolveImpactChecks(p) {
  if (p.weapon.isDrone) {
    const hitDrone = checkDefenseDroneHit(p.x, p.y);
    if (hitDrone) {
      resolveDefenseDroneHit(p, hitDrone);
      return true;
    }
  }
  if (checkBaseHit(p.x, p.y)) {
    explode(p.x, p.y, true, p);
    return true;
  }
  const hitBuilding = checkBuildingHit(p.x, p.y);
  if (hitBuilding && resolveBuildingHit(hitBuilding, p.x, p.y)) return true;
  if (p.y >= terrainHeightAt(p.x)) {
    explode(p.x, p.y, false, p);
    return true;
  }
  if (p.x < 0 || p.x > W || p.y > H + 150) return true;
  return false;
}

function updateBallistic(p, substeps) {
  for (let s = 0; s < substeps; s++) {
    p.vx += (wind * SETTINGS.wind.accelScale) / substeps;
    p.vy += SETTINGS.gravity / substeps;
    p.x += p.vx / substeps;
    p.y += p.vy / substeps;
    if (resolveImpactChecks(p)) return true;
    p.trail.points.push({ x: p.x, y: p.y });
  }
  return false;
}

// FPV drone: no ballistic arc - the pilot directly commands thrust every frame with the
// same steering keys that adjust angle/power for the other weapons, against a light natural
// sink and a battery that runs out and detonates the drone where it stands.
function updateDrone(p) {
  const d = p.weapon.drone;
  const climb = (keys["arrowup"] || keys["w"]) ? -d.thrustAccel : 0;
  const dive = (keys["arrowdown"] || keys["s"]) ? d.thrustAccel : 0;
  const left = (keys["arrowleft"] || keys["a"]) ? -d.thrustAccel : 0;
  const right = (keys["arrowright"] || keys["d"]) ? d.thrustAccel : 0;

  p.vy += climb + dive + d.gravity;
  p.vx += left + right + wind * SETTINGS.wind.accelScale * d.windMultiplier;
  p.vx = clamp(p.vx, -d.maxSpeed, d.maxSpeed);
  p.vy = clamp(p.vy, -d.maxSpeed, d.maxSpeed);
  p.x += p.vx;
  p.y += p.vy;
  p.trail.points.push({ x: p.x, y: p.y });

  if (resolveImpactChecks(p)) return true;

  p.battery -= 1000 / 60;
  if (p.battery <= 0) {
    explode(p.x, p.y, checkBaseHit(p.x, p.y), p);
    return true;
  }
  return false;
}

function updateProjectile() {
  const substeps = 4;
  for (let idx = activeProjectiles.length - 1; idx >= 0; idx--) {
    const p = activeProjectiles[idx];
    const resolved = p.weapon.isDrone ? updateDrone(p) : updateBallistic(p, substeps);
    if (resolved) {
      p.trail.impactAt = performance.now();
      activeProjectiles.splice(idx, 1);
    }
  }

  if (volleyPending && activeProjectiles.length === 0) {
    volleyPending = false;
    if (!gameOver && SETTINGS.wind.changeEvery === "shot") rollWind();
    defenseDrones = [];
    checkGameEnd();
    updateHUD();
  }
}

// ---- HUD --------------------------------------------------------------------
function updateHUD() {
  el.angle.textContent = Math.round(tank.angle) + "°";
  el.power.textContent = Math.round(tank.power);
  el.ammo.textContent = ammo;

  const hpFrac = clamp(base.hp / SETTINGS.base.maxHP, 0, 1);
  el.hpBar.style.width = hpFrac * 100 + "%";
  el.hpBar.style.background = hpFrac > 0.5
    ? "linear-gradient(90deg, #b768ff, #7fe0ff)"
    : hpFrac > 0.2
      ? "linear-gradient(90deg, #ff9d5c, #ffcf5c)"
      : "linear-gradient(90deg, #ff5c5c, #ff8f6b)";

  el.fireBtn.disabled = activeProjectiles.length > 0 || ammo < currentWeapon().ammoCost || gameOver;
  updateWeaponUI();

  const drone = pilotedDrone();
  el.droneStatus.classList.toggle("hidden", !drone);
  if (drone) {
    const batteryFrac = clamp(drone.battery / drone.weapon.drone.batteryMs, 0, 1);
    el.batteryBar.style.width = batteryFrac * 100 + "%";
  }
}

// ---- rendering ---------------------------------------------------------------
// screen-space (not affected by camera scroll) - the sky doesn't parallax
function drawSky() {
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.65);
  sky.addColorStop(0, "#454f5e");
  sky.addColorStop(0.55, "#7c8b93");
  sky.addColorStop(1, "#c8b696");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_W, H);
}

// distant scenery sits on a nominal horizon line, but never above the *actual* local
// terrain - when the ground dips lower than that horizon (a valley, a cliff), the
// element's base drops down to meet it instead of floating over the gap
function drawDistantBuildings() {
  const horizon = H * 0.58;
  ctx.fillStyle = DISTANT_BUILDING_COLOR;
  for (const b of background.distantBuildings) {
    const groundY = Math.max(horizon, terrainHeightAt(b.x));
    ctx.fillRect(b.x - b.width / 2, groundY - b.height, b.width, b.height);
    if (b.hasStack) ctx.fillRect(b.x + b.width * 0.25, groundY - b.height - 14, 3, 14);
  }
}

function drawForest() {
  const horizon = H * 0.6;
  for (const t of background.forest) {
    const groundY = Math.max(horizon, terrainHeightAt(t.x));
    ctx.fillStyle = t.shade;
    ctx.beginPath();
    ctx.moveTo(t.x - t.width / 2, groundY);
    ctx.lineTo(t.x, groundY - t.height);
    ctx.lineTo(t.x + t.width / 2, groundY);
    ctx.closePath();
    ctx.fill();
  }
}

function drawSoilTexture() {
  for (const s of soilSpecks) {
    const y = terrainHeightAt(s.x) + s.depth;
    if (y > H) continue;
    ctx.fillStyle = s.shade;
    ctx.beginPath();
    ctx.ellipse(s.x, y, s.size, s.size * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTerrain() {
  const h = terrainHeights;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, H);
  ctx.lineTo(0, h[0]);
  for (let x = 1; x < W; x += 2) ctx.lineTo(x, h[x]);
  ctx.lineTo(W - 1, h[W - 1]);
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.clip();

  const dirtGrad = ctx.createLinearGradient(0, H * 0.4, 0, H);
  dirtGrad.addColorStop(0, "#6b4a2f");
  dirtGrad.addColorStop(0.4, "#5a3d26");
  dirtGrad.addColorStop(0.7, "#472f1c");
  dirtGrad.addColorStop(1, "#33220f");
  ctx.fillStyle = dirtGrad;
  ctx.fillRect(0, 0, W, H);

  drawSoilTexture();
  ctx.restore();

  const grassH = 10;
  ctx.beginPath();
  ctx.moveTo(0, h[0]);
  for (let x = 1; x < W; x += 2) ctx.lineTo(x, h[x]);
  ctx.lineTo(W - 1, h[W - 1]);
  for (let x = W - 1; x >= 0; x -= 2) ctx.lineTo(x, h[x] + grassH);
  ctx.closePath();
  ctx.fillStyle = "#4c9a3c";
  ctx.fill();
}

function drawBuildings() {
  for (const b of buildings) {
    const box = buildingBox(b);
    const bx = box.left;
    const by = box.top;

    if (b.destroyed) {
      ctx.fillStyle = "#2a2823";
      ctx.beginPath();
      ctx.moveTo(bx - 3, box.groundY);
      ctx.lineTo(bx + 4, by + b.height * 0.7);
      ctx.lineTo(bx + b.width * 0.35, by + b.height * 0.5);
      ctx.lineTo(bx + b.width * 0.6, by + b.height * 0.75);
      ctx.lineTo(bx + b.width + 3, by + b.height * 0.65);
      ctx.lineTo(bx + b.width + 3, box.groundY);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.stroke();
      continue;
    }

    // panel body
    ctx.fillStyle = b.color;
    ctx.fillRect(bx, by, b.width, b.height);

    // concrete panel seams
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.lineWidth = 1;
    const seamCols = Math.max(2, Math.round(b.width / 20));
    for (let i = 1; i < seamCols; i++) {
      const sx = bx + (b.width / seamCols) * i;
      ctx.beginPath();
      ctx.moveTo(sx, by);
      ctx.lineTo(sx, box.groundY);
      ctx.stroke();
    }

    // flat roof cap
    ctx.fillStyle = "#5c5b54";
    ctx.fillRect(bx - 2, by - 4, b.width + 4, 5);

    // windows grid
    const padX = b.width * 0.12;
    const rowH = b.height / b.floors;
    const colW = (b.width - padX * 2) / b.windowCols;
    for (let r = 0; r < b.floors; r++) {
      for (let c = 0; c < b.windowCols; c++) {
        const wx = bx + padX + colW * c + colW * 0.2;
        const wy = by + rowH * r + rowH * 0.25;
        const ww = colW * 0.6;
        const wh = rowH * 0.5;
        ctx.fillStyle = b.litWindows.has(r + "," + c) ? "#e8d27a" : "#3a4a52";
        ctx.fillRect(wx, wy, ww, wh);
      }
    }

    // small red star medallion + aerial for Soviet flavor
    ctx.fillStyle = "#c62828";
    drawStar(bx + b.width / 2, by - 9, 5);
    if (b.hasAerial) {
      ctx.strokeStyle = "#3a3a3a";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx + b.width * 0.75, by - 4);
      ctx.lineTo(bx + b.width * 0.75, by - 18);
      ctx.moveTo(bx + b.width * 0.75 - 5, by - 14);
      ctx.lineTo(bx + b.width * 0.75 + 5, by - 14);
      ctx.stroke();
    }
  }
}

function drawStar(cx, cy, r) {
  const spikes = 5;
  const inner = r * 0.45;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const rad = i % 2 === 0 ? r : inner;
    const a = (Math.PI / spikes) * i - Math.PI / 2;
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

// small berry cluster + leaf, used as the depot's roof emblem in place of a star
function drawWildberry(cx, cy, r) {
  const berryR = r * 0.42;
  const offsets = [
    { dx: -berryR * 0.9, dy: berryR * 0.5 },
    { dx: berryR * 0.9, dy: berryR * 0.5 },
    { dx: 0, dy: -berryR * 0.3 },
    { dx: 0, dy: berryR * 1.1 },
  ];
  ctx.fillStyle = "#5a1a4a";
  for (const o of offsets) {
    ctx.beginPath();
    ctx.arc(cx + o.dx, cy + o.dy, berryR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  for (const o of offsets) {
    ctx.beginPath();
    ctx.arc(cx + o.dx - berryR * 0.3, cy + o.dy - berryR * 0.3, berryR * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "#3c6b35";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy - berryR * 0.3);
  ctx.lineTo(cx, cy - r);
  ctx.stroke();
  ctx.fillStyle = "#4c8a3f";
  ctx.beginPath();
  ctx.ellipse(cx + r * 0.35, cy - r * 0.75, r * 0.35, r * 0.16, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawTank() {
  const bw = SETTINGS.tank.width;
  const bh = SETTINGS.tank.height;
  const bx = tankX - bw / 2;
  const by = tankGroundY - bh;

  ctx.fillStyle = "#4b5320";
  ctx.beginPath();
  ctx.moveTo(bx, tankGroundY);
  ctx.lineTo(bx, by + bh * 0.4);
  ctx.quadraticCurveTo(bx, by, bx + bw * 0.25, by);
  ctx.lineTo(bx + bw * 0.75, by);
  ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + bh * 0.4);
  ctx.lineTo(bx + bw, tankGroundY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#20240f";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = "#3d431a";
  const pivotX = tankX, pivotY = tankGroundY - bh;
  ctx.beginPath();
  ctx.arc(pivotX, pivotY, bh * 0.5, 0, Math.PI * 2);
  ctx.fill();

  const tip = barrelTip();
  ctx.strokeStyle = "#2f2f2f";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(pivotX, pivotY);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();
}

function drawBase() {
  const bw = SETTINGS.base.width;
  const bh = SETTINGS.base.height;
  const bx = baseX - bw / 2;
  const by = baseGroundY - bh;
  const hpFrac = clamp(base.hp / SETTINGS.base.maxHP, 0, 1);

  if (base.destroyed) {
    ctx.fillStyle = "#1c1a1a";
    ctx.beginPath();
    ctx.moveTo(bx - 4, baseGroundY);
    ctx.lineTo(bx + 6, by + bh * 0.75);
    ctx.lineTo(bx + bw * 0.4, by + bh * 0.55);
    ctx.lineTo(bx + bw * 0.65, by + bh * 0.8);
    ctx.lineTo(bx + bw + 4, by + bh * 0.7);
    ctx.lineTo(bx + bw + 4, baseGroundY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.stroke();
    return;
  }

  // walls (weathered concrete)
  ctx.fillStyle = "#e4ded0";
  ctx.fillRect(bx, by, bw, bh);

  // roof
  ctx.fillStyle = "#d8c9ff";
  ctx.beginPath();
  ctx.moveTo(bx - 5, by);
  ctx.lineTo(bx + bw / 2, by - bh * 0.35);
  ctx.lineTo(bx + bw + 5, by);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#8b5cf6";
  ctx.lineWidth = 2;
  ctx.stroke();

  // wildberry emblem at the roof apex
  drawWildberry(bx + bw / 2, by - bh * 0.35 - 3, 7);

  // violet trim stripe
  ctx.fillStyle = "#8b5cf6";
  ctx.fillRect(bx, by + bh * 0.55, bw, bh * 0.1);

  // door
  ctx.fillStyle = "#8b5cf6";
  ctx.fillRect(bx + bw * 0.42, by + bh * 0.55, bw * 0.16, bh * 0.45);

  // outline
  ctx.strokeStyle = "#b8a8d8";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(bx, by, bw, bh);

  // damage tint overlay
  for (const t of SETTINGS.base.damageTintThresholds) {
    if (hpFrac <= t.hp && t.tint) {
      ctx.fillStyle = t.tint;
      ctx.fillRect(bx, by, bw, bh);
    }
  }

  // scorch marks
  ctx.fillStyle = "rgba(20,15,10,0.55)";
  for (const s of base.scorchMarks) {
    ctx.beginPath();
    ctx.arc(baseX + s.rx * bw, (by + bh / 2) + s.ry * bh, s.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // health bar above base
  const barW = bw * 1.1, barH = 6;
  const barX = baseX - barW / 2, barY = by - 16;
  ctx.fillStyle = "rgba(10,14,23,0.8)";
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = hpFrac > 0.5 ? "#7fe0ff" : hpFrac > 0.2 ? "#ffcf5c" : "#ff5c5c";
  ctx.fillRect(barX, barY, barW * hpFrac, barH);
  ctx.strokeStyle = "#2b3a52";
  ctx.strokeRect(barX, barY, barW, barH);
}

// pulsing/flickering energy dome that covers the base while its shield cycle is active
function drawShield(now) {
  if (base.destroyed || !isShieldActive(now)) return;

  const bw = SETTINGS.base.width;
  const bh = SETTINGS.base.height;
  const cx = baseX;
  const cy = baseGroundY - bh * 0.4;
  const radius = bw * 0.85;

  const flicker = 0.55 + Math.abs(Math.sin((now / 1000) * SETTINGS.shield.flickerSpeed)) * 0.4;

  ctx.save();
  ctx.globalAlpha = flicker;
  ctx.fillStyle = "rgba(127, 224, 255, 0.16)";
  ctx.strokeStyle = "#7fe0ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawTrail(now) {
  trails = trails.filter((t) => t.impactAt === null || now - t.impactAt < 2200);
  for (const t of trails) {
    const alpha = t.impactAt === null ? 1 : clamp(1 - (now - t.impactAt) / 2200, 0, 1);
    ctx.fillStyle = `rgba(255, 230, 120, ${alpha * 0.85})`;
    for (let i = 0; i < t.points.length; i += 2) {
      const p = t.points[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawProjectile() {
  for (const p of activeProjectiles) {
    if (p.weapon.isDrone) {
      drawDroneSprite(p.x, p.y);
      continue;
    }
    ctx.fillStyle = p.weapon.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.weapon.projectileRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDroneSprite(x, y) {
  const r = 7;
  ctx.save();
  ctx.translate(x, y);

  ctx.strokeStyle = "#4a4a4a";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-r, -r);
  ctx.lineTo(r, r);
  ctx.moveTo(-r, r);
  ctx.lineTo(r, -r);
  ctx.stroke();

  ctx.fillStyle = "rgba(210,210,210,0.65)";
  for (const [dx, dy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
    ctx.beginPath();
    ctx.arc(dx, dy, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#2a2a2a";
  ctx.fillRect(-r * 0.5, -r * 0.28, r, r * 0.56);

  ctx.fillStyle = "#e23838";
  ctx.beginPath();
  ctx.arc(0, 0, 1.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawDefenseDrones() {
  for (const d of defenseDrones) drawDefenseDroneSprite(d.x, d.y);
}

function drawDefenseDroneSprite(x, y) {
  const r = 7;
  ctx.save();
  ctx.translate(x, y);

  ctx.strokeStyle = "#6b1f1f";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-r, -r);
  ctx.lineTo(r, r);
  ctx.moveTo(-r, r);
  ctx.lineTo(r, -r);
  ctx.stroke();

  ctx.fillStyle = "rgba(230, 140, 140, 0.65)";
  for (const [dx, dy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
    ctx.beginPath();
    ctx.arc(dx, dy, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#3a1414";
  ctx.fillRect(-r * 0.5, -r * 0.28, r, r * 0.56);

  ctx.fillStyle = "#ff3b3b";
  ctx.beginPath();
  ctx.arc(0, 0, 1.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawParticles(now) {
  particles = particles.filter((p) => now - p.born < p.life);
  for (const p of particles) {
    const age = now - p.born;
    const t = age / p.life;
    const alpha = 1 - t;
    ctx.fillStyle = p.color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(p.x + p.vx * age * 0.03, p.y + p.vy * age * 0.03 + t * t * 8, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawDamageTexts(now) {
  damageTexts = damageTexts.filter((d) => now - d.born < 1300);
  ctx.font = "bold 16px 'Courier New', monospace";
  ctx.textAlign = "center";
  for (const d of damageTexts) {
    const age = now - d.born;
    const t = age / 1300;
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = d.color;
    ctx.fillText(d.text, d.x, d.y - t * 30);
    ctx.globalAlpha = 1;
  }
}

// wind readout box drawn directly on the game screen: bold signed number + 3 chevrons
// that drift left<->right on a loop (opacity dipping at each end), mirrored and reversed
// for headwind, with chevron count and drift speed both scaling with wind strength.
function drawWindBox(now) {
  const boxW = 128, boxH = 32;
  const bx = VIEW_W / 2 - boxW / 2, by = 12;

  ctx.fillStyle = "#26231d";
  ctx.fillRect(bx, by, boxW, boxH);
  ctx.strokeStyle = "#55503f";
  ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, boxW, boxH);

  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = "bold 15px 'Courier New', monospace";
  ctx.fillStyle = "#e9e2cf";
  ctx.fillText((wind >= 0 ? "+" : "") + Math.round(wind), bx + 12, by + boxH / 2 + 1);

  const windFrac = clamp((Math.abs(wind) / SETTINGS.wind.max) * SETTINGS.wind.visualScale, 0, 1);
  const activeChevrons = wind === 0 ? 0 : windFrac < 0.34 ? 1 : windFrac < 0.67 ? 2 : 3;
  const duration = lerp(1.4, 0.7, windFrac);
  const groupCenterX = bx + boxW - 26;
  const chevronY = by + boxH / 2 + 1;

  ctx.save();
  if (wind < 0) {
    // mirror the whole group: flips the glyphs to point left AND reverses the drift direction
    ctx.translate(groupCenterX, chevronY);
    ctx.scale(-1, 1);
    ctx.translate(-groupCenterX, -chevronY);
  }

  ctx.font = "bold 14px 'Courier New', monospace";
  ctx.textAlign = "center";
  const t = now / 1000;
  for (let i = 0; i < 3; i++) {
    if (i >= activeChevrons) continue;
    const phase = (t / duration) * Math.PI * 2 + i * (0.15 / duration) * Math.PI * 2;
    const s = Math.sin(phase);
    const x = groupCenterX + (i - 1) * 11 + s * 3;
    ctx.globalAlpha = 0.25 + ((s + 1) / 2) * 0.75;
    ctx.fillStyle = "#7fe0ff";
    ctx.fillText("›", x, chevronY);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// small live overview of the whole world in the top-right corner: terrain silhouette,
// tank/base markers, in-flight projectiles, and a highlighted box for what the camera
// currently frames - screen-space, drawn on top of everything else
function drawMinimap() {
  const mmW = 220, mmH = 50, padX = 6, padY = 6;
  const mx = VIEW_W - mmW - 14, my = 14;
  const innerW = mmW - padX * 2, innerH = mmH - padY * 2;
  const toMiniX = (worldX) => mx + padX + (worldX / W) * innerW;
  const groundY = my + padY + innerH;
  const bandH = innerH * 0.55;
  const minH = SETTINGS.terrain.minHeight, maxH = SETTINGS.terrain.maxHeight;

  ctx.fillStyle = "rgba(20,18,14,0.85)";
  ctx.fillRect(mx, my, mmW, mmH);
  ctx.strokeStyle = "#55503f";
  ctx.lineWidth = 1;
  ctx.strokeRect(mx, my, mmW, mmH);

  ctx.beginPath();
  ctx.moveTo(mx + padX, groundY);
  const samples = 100;
  for (let i = 0; i <= samples; i++) {
    const wx = clamp(Math.round((i / samples) * (W - 1)), 0, W - 1);
    const hillHeight = H - terrainHeights[wx];
    const frac = clamp((hillHeight - minH) / (maxH - minH), 0, 1);
    ctx.lineTo(toMiniX(wx), groundY - frac * bandH);
  }
  ctx.lineTo(mx + padX + innerW, groundY);
  ctx.closePath();
  ctx.fillStyle = "#5a3d26";
  ctx.fill();

  ctx.fillStyle = base.destroyed ? "#555" : "#b768ff";
  ctx.beginPath();
  ctx.arc(toMiniX(baseX), groundY - 4, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#8bc34a";
  ctx.beginPath();
  ctx.arc(toMiniX(tankX), groundY - 4, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffcf5c";
  for (const p of activeProjectiles) {
    ctx.beginPath();
    ctx.arc(toMiniX(p.x), groundY - bandH * 0.6, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  const viewX0 = toMiniX(cameraX);
  const viewX1 = toMiniX(cameraX + VIEW_W);
  ctx.strokeStyle = "#7fe0ff";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(viewX0, my + padY, viewX1 - viewX0, innerH);
}

function render(now) {
  ctx.clearRect(0, 0, VIEW_W, H);
  drawSky();
  ctx.save();
  ctx.translate(-cameraX, 0);
  drawDistantBuildings();
  drawForest();
  drawTerrain();
  drawBuildings();
  drawBase();
  drawShield(now);
  drawDefenseDrones();
  drawTank();
  drawTrail(now);
  drawProjectile();
  drawParticles(now);
  drawDamageTexts(now);
  ctx.restore();
  drawWindBox(now);
  drawMinimap();
}

// ---- main loop ----------------------------------------------------------
function update() {
  // while a drone is being piloted, the same steering keys fly it instead of aiming the tank
  if (!gameOver && !pilotedDrone()) {
    if (keys["arrowleft"] || keys["a"]) tank.angle = clamp(tank.angle - SETTINGS.tank.angleStep, SETTINGS.tank.angleMin, SETTINGS.tank.angleMax);
    if (keys["arrowright"] || keys["d"]) tank.angle = clamp(tank.angle + SETTINGS.tank.angleStep, SETTINGS.tank.angleMin, SETTINGS.tank.angleMax);
    if (keys["arrowup"] || keys["w"]) tank.power = clamp(tank.power + SETTINGS.tank.powerStep, SETTINGS.tank.powerMin, SETTINGS.tank.powerMax);
    if (keys["arrowdown"] || keys["s"]) tank.power = clamp(tank.power - SETTINGS.tank.powerStep, SETTINGS.tank.powerMin, SETTINGS.tank.powerMax);
  }
  updateDefenseDrones(performance.now());
  updateProjectile();
  updateCamera();
  updateHUD();
}

function loop(now) {
  update();
  render(now);
  requestAnimationFrame(loop);
}

newGame();
requestAnimationFrame(loop);
