# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Tank Wars — a single-player, browser-based artillery game (Scorched Earth / Tank Wars clone) with a "Soviet" visual theme. One tank on destructible terrain, no enemy tank, the objective is destroying a stationary enemy logistics depot in as few shots as possible before running out of ammo.

It lives entirely in `tank-wars/` as four static files, no build step, no dependencies:

- `tank-wars/index.html` — page shell, HUD markup, canvas element
- `tank-wars/style.css` — all visual styling (Soviet red/charcoal/cream palette)
- `tank-wars/settings.js` — every tunable game-mechanics value, loaded as a plain `const SETTINGS = {...}` global before `game.js`. Has a large comment block at the top documenting every field — check there before changing a number.
- `tank-wars/game.js` — all game logic. Reads every tunable from `SETTINGS` at runtime; never hardcode gameplay numbers here — add/adjust a `SETTINGS` field instead.

## Running it

- Double-click `tank-wars/index.html` to open it directly as a `file://` URL, or
- Serve it locally, e.g. `python -m http.server 8791` from inside `tank-wars/` and open `http://localhost:8791`.

No test suite, linter, or `package.json` — plain vanilla JS/CSS/HTML.

**Cache gotcha:** when iterating against a local static server (not `file://`), a browser can serve a stale cached `settings.js` alongside a fresh `game.js` (or vice versa), since a plain dev server sends no cache-control headers. A mismatch (e.g. `game.js` referencing `SETTINGS.shield` that an old cached `settings.js` doesn't have) throws before the render loop starts, producing a blank canvas and a HUD frozen at its raw HTML placeholder text. Hard-refresh (Ctrl+Shift+R) fixes it — it isn't a code bug, and it's worth ruling this out first if the game appears to have suddenly stopped rendering.

## Architecture

**Settings-driven design.** `settings.js` is the single source of truth for every tunable (terrain shape, tank/ammo, gravity, wind, base HP/size, damage falloff curve, crater size, buildings, shield timing, weapon stats). Preserve this split when adding features — new mechanics should get new `SETTINGS` fields (with a doc comment) rather than inline constants.

**Projectile model.** Firing doesn't set a single global `projectile` — it pushes into `activeProjectiles`, an array, because cluster shells burst into multiple independently-flying bomblets (`spawnBomblets`) and the FPV drone needs its own per-frame control path. `updateProjectile()` iterates `activeProjectiles` each frame and dispatches each one to either `updateBallistic()` (gravity + wind, 4 physics substeps per frame for collision accuracy) or `updateDrone()` (real-time player-piloted thrust, no ballistic arc), based on `weapon.isDrone`. Both funnel into the shared `resolveImpactChecks()` for base/building/terrain/out-of-bounds collision. A "volley" (the original shot plus any bomblets it spawned) only counts as finished — triggering wind re-roll and win/lose checks — once `activeProjectiles` is empty again (the `volleyPending` flag), so a cluster shell doesn't re-roll wind once per bomblet.

**Weapons.** `SETTINGS.weapons.list` is the arsenal; the HUD weapon-picker buttons are generated from this array at runtime (`buildWeaponUI`), so adding a weapon is just a new list entry, no HTML changes. `weaponProfile(weapon)` resolves a weapon into its damage/crater profile, falling back to the top-level `SETTINGS.damage`/`SETTINGS.crater` for the "standard" shell so that entry doesn't duplicate numbers. Keys 1-9 (or the picker) select a weapon. While a drone is in flight, the same steering keys are hijacked away from tank angle/power — see the `pilotedDrone()` guard in `update()`. `isDrone` and `clusterCount` are independent flags that can combine on one weapon (`clusterDrone`: a piloted drone that bursts into bomblets on detonation) — the cluster-burst trigger in `explode()` checks `weapon.clusterCount`, not a weapon id, and `spawnBomblets()` explicitly forces `isDrone: false` on the bomblets' weapon so they don't inherit pilotability from a drone parent. Keep both of those generalized (capability checks, not id/type checks) when touching this path.

**Terrain.** A midpoint-displacement heightmap (`terrainHeights`, one Y value per X column) generates rolling hills; `craterAt()` mutates it in place on every impact so later shots see the updated shape. The tank and base each have a protected "pedestal" column range that `craterAt()` refuses to dig into, so an explosion next to (or under) them never leaves them floating over a pit.

**Buildings.** Decorative Soviet apartment blocks (`generateBuildings`), scattered across the terrain while avoiding the tank/base footprint. `SETTINGS.buildings.hitBehavior` (`"none"` / `"cosmetic"` / `"solid"`) controls whether shots ignore them, cosmetically collapse them without affecting flight, or treat them as solid cover that stops a shot — read by `checkBuildingHit`/`resolveBuildingHit`, called from the same `resolveImpactChecks()` used by every projectile type.

**Base shield.** `newGame()` rolls a random cycle period and active duration once per game (within `SETTINGS.shield.*` min/max) and stores them on `base`. `isShieldActive(now)` derives on/off purely from a modulo of elapsed time against those two numbers — there's no separate interval/timer. Damage is scaled down after the fact in `explode()` when the shield happens to be up at the moment of impact.

**Depot defense drones.** `spawnDefenseDrones()` scrambles a random count (`SETTINGS.defenseDrones.countMin/Max`) of hovering interceptors into `defenseDrones` whenever the player fires the FPV drone weapon (hooked in `fire()`), placed at random columns in the depot's half of the map (`spawnZoneStart`) at a random altitude above the terrain there. Each one hovers by oscillating around its spawn column via a sine wave (`updateDefenseDrones()`, driven by `hoverRadius`/`hoverSpeed`) — no gravity, no ballistic state. `resolveImpactChecks()` checks the player's piloted drone against them first (`checkDefenseDroneHit`, radius-based via `hitRadius`) before falling through to the normal base/building/terrain checks; a hit destroys both via `resolveDefenseDroneHit()` — particles and a floating "INTERCEPTED" text, but critically it bypasses `explode()` entirely, so no crater and no base damage. The squad is cleared back to empty once the volley resolves (same `volleyPending`-goes-empty point used for the wind re-roll), so a fresh random count scrambles on the *next* drone launch rather than accumulating.

**Camera & world/viewport split.** The map can be wider than the screen: `SETTINGS.terrain.width` (`W` in game.js) is the full scrollable world, `SETTINGS.terrain.viewWidth` (`VIEW_W`) is the visible canvas pixel width (`canvas.width` is set to `VIEW_W`, not `W`). `cameraX` is the world-x shown at screen-x 0. `updateCamera()` eases `cameraX` (`SETTINGS.camera.followEase`) toward a target each frame: the in-flight projectile's x if one exists, otherwise a fixed anchor near the tank (`SETTINGS.camera.idleAnchorFrac`) — unless `manualPan` is set, in which case the camera just sits wherever the player left it. Click-drag or wheel-scroll on the canvas sets `manualPan = true`; `fire()` resets it to `false`, handing control back to auto-follow for the shot. When adding new world-space entities, position them in world coordinates (0..W) same as everything else — the coordinate translation is handled once in `render()`, not per-entity.

**Rendering.** `render(now)` runs every `requestAnimationFrame` tick and redraws everything from scratch. Screen-space layers (sky, wind readout box, minimap) are drawn without translation; everything else is drawn inside a single `ctx.translate(-cameraX, 0)` block so world-space code never needs to know about the camera: distant buildings/forest → terrain → buildings → base → shield dome → defense drones → tank → trails → projectiles → particles → damage numbers. The wind indicator and minimap are drawn directly on the canvas (`drawWindBox`, `drawMinimap`), not in the HTML HUD — the wind box was deliberately moved there from a DOM element, so don't reintroduce a DOM wind readout without removing this one. The minimap (top-right) renders a scaled-down terrain silhouette plus tank/base/projectile markers and a highlighted rectangle for the camera's current viewport.

**Background scenery gotcha.** Distant buildings/forest (`drawDistantBuildings`/`drawForest`) anchor to `Math.max(nominalHorizonY, terrainHeightAt(x))`, not a flat horizon line — a flat line floats disconnected above the ground wherever the terrain (which varies a lot, e.g. the cliff beside the depot) dips lower than that line. Keep this per-x clamping pattern for any future backdrop layer that isn't the sky itself.

## Testing changes

No automated test suite. Changes have been smoke-tested with headless Chrome driven by `playwright-core`, installed and run from a scratch/temp directory outside the repo (point `chromium.launch({ executablePath: ... })` at the system Chrome install — there's no bundled Chromium here). Never `npm install` inside `tank-wars/`; it must stay dependency-free since the whole point is a static, buildless deliverable.

## Ideas discussed but not yet built

From design conversations, not yet implemented — worth surfacing if asked "what's next":
- Chain-reaction hazard buildings (a fuel depot that explodes bigger and can set off neighbors)
- Impact "juice": screen shake, explosion sound effects
- In-memory best-score tracking across "Play Again" runs
- Multi-round campaign (destroy a base, face a tougher one)
- Enemy AI turret that shoots back (bigger scope — would turn this from a target range into a duel)
