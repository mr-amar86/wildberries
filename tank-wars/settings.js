/*
 * SETTINGS.JS - all tunable Tank Wars game mechanics live here.
 * Edit values below and reload the page - nothing in game.js needs to change.
 *
 * terrain.roughness      - 0..1, how jagged the midpoint-displacement hills are
 *                           (0 = smooth rolling hills, 1 = jagged/spiky terrain)
 * terrain.minHeight/maxHeight - allowed range (in px, measured as distance from
 *                           canvas bottom) for the generated terrain surface
 * terrain.viewWidth       - visible viewport width in px (the canvas element's actual
 *                           pixel width). terrain.width is the full scrollable world -
 *                           when it's wider than viewWidth, the camera pans to follow
 *                           the action; see the `camera` section below
 * terrain.soilSpeckCount - how many tinted texture specks are scattered through the dirt
 *                           per game, so the ground isn't a flat gradient
 * camera.followEase       - 0..1, how quickly the camera eases toward its target position
 *                           each frame (higher = snappier, lower = more of a lazy drift)
 * camera.idleAnchorFrac   - 0..1, where the tank sits horizontally in the viewport while
 *                           aiming and no shot is in flight (0 = left edge, 0.5 = centered)
 * camera.impactHoldMs     - how long (ms) the camera lingers on an impact point after a hit
 *                           before easing back to the tank, so the player can actually see
 *                           what just happened instead of snapping away immediately
 * ui.gameEndDelayMs       - how long (ms) to wait after the game is actually won or lost
 *                           before the result overlay appears, so the final impact plays
 *                           out (and the camera has time to hold on it) instead of the
 *                           screen cutting to the overlay instantly
 * tank.startingAmmo      - shots available per game
 * tank.angleMin/angleMax - firing angle range in degrees (0 = flat right, 180 = flat left)
 * tank.powerMin/powerMax - firing power range shown on the HUD
 * tank.powerToVelocityScale - multiplies "power" into actual launch speed (px/frame)
 * gravity                - downward acceleration applied to projectiles every physics tick
 * wind.min/max           - range of possible wind strength values
 * wind.changeEvery       - "shot" = re-roll wind after every shot, "round" = only once per game
 * wind.visualScale       - multiplies the wind value when drawing the on-screen wind meter
 * base.maxHP             - logistics base total hit points
 * base.width/height      - size in px of the base's bounding shape (used for collision + drawing)
 * base.damageTintThresholds - HP fractions at which the base sprite gets progressively
 *                           more scorched/darkened (first match wins, ordered high->low)
 * damage.directHitMin/Max     - damage range dealt when a shell lands inside the base's box
 * damage.splashRadiusMultiplier - splash blast radius, expressed as a multiple of base.width
 * damage.nearMissDamageClose  - damage dealt for a near-miss right at the edge of the base box
 * damage.nearMissDamageFar    - damage dealt for a near-miss at the outer edge of splash radius
 * damage.falloffExponent      - 1 = linear falloff between close/far near-miss damage,
 *                           >1 = damage drops off faster the further away you land
 * crater.radius           - radius (px) carved out of the terrain heightmap per impact
 * buildings.count         - how many apartment blocks get scattered across the terrain per game
 * buildings.minSize/maxSize - random size range (px) for each block, for visual variety
 * background.distantBuildingCount - how many far-off skyline silhouettes get scattered
 *                           across the map per game (pure backdrop, no collision)
 * background.treeCount    - how many treeline silhouettes get scattered across the map
 *                           per game (pure backdrop, no collision)
 * buildings.hitBehavior   - what a direct hit on a block does:
 *                           "none"     = pure background scenery, shots fly through untouched
 *                           "cosmetic" = shots still fly through, but a hit collapses that one
 *                                        block into rubble for the rest of the game (no score/
 *                                        HP effect either way - just visual feedback)
 *                           "solid"    = blocks act like cover: a shot detonates on contact and
 *                                        stops there (collapsing the block), the same way a shot
 *                                        into the terrain would, so a block can shield the base
 *
 * shield.enabled          - master on/off switch for the base's shield
 * shield.cyclePeriodMin/Max - how often (seconds) the shield comes up, measured from the start
 *                           of one activation to the start of the next. Rolled once per new game
 *                           to a single value within this range (e.g. "every 9 seconds")
 * shield.activeDurationMin/Max - how long (seconds) the shield stays up each time it activates.
 *                           Also rolled once per new game within this range (e.g. "for 1 second")
 * shield.damageReduction  - fraction (0..1) of incoming damage blocked while the shield is up,
 *                           applied to direct hits and near-misses alike (0.95 = 95% reduction)
 * shield.flickerSpeed     - how fast the shield visual pulses/flickers while active (higher = faster)
 *
 * defenseDrones.enabled       - master on/off switch for the depot's defense drones
 * defenseDrones.countMin/Max  - how many defense drones scramble each time the player launches
 *                           their own FPV drone (rolled once per drone launch, to a whole
 *                           number within this range)
 * defenseDrones.spawnZoneStart - fraction (0..1) of the terrain width, measured from the left,
 *                           marking where defense drones are allowed to spawn - they only
 *                           guard the depot's side of the map
 * defenseDrones.altitudeMin/Max - how high (px) above the terrain surface at their spawn column
 *                           a defense drone hovers
 * defenseDrones.hoverRadius   - how far (px) a defense drone drifts side to side from its spawn
 *                           point while hovering
 * defenseDrones.hoverSpeed    - how fast (radians per ms) a defense drone oscillates side to
 *                           side; higher = faster, twitchier drifting
 * defenseDrones.hitRadius     - distance (px) at which the player's FPV drone counts as having
 *                           collided with a defense drone - both explode, base takes no damage
 *
 * weapons.startingIndex   - index into weapons.list selected when a new game begins
 * weapons.list            - the arsenal, cycled with keys 1..9 or the on-screen picker. Each entry:
 *     id             - internal key, keep unique
 *     label          - name shown in the weapon picker
 *     ammoCost       - how many shots this weapon deducts from the shared ammo pool per use
 *     color          - fill color of the flying projectile
 *     projectileRadius - drawn size (px) of the flying projectile
 *     velocityScale  - optional override of tank.powerToVelocityScale (e.g. a heavier, slower shell)
 *     directHitMin/Max, splashRadiusMultiplier, nearMissDamageClose/Far, falloffExponent, craterRadius
 *                    - same meaning as the top-level damage settings and crater.radius above, but
 *                      scoped to this weapon. The "standard" entry omits these and simply falls
 *                      back to the top-level damage/crater settings, so tuning "the default shell"
 *                      still only means editing one place.
 *     clusterCount   - cluster weapons only: how many bomblets burst out on primary detonation
 *     clusterSpreadSpeed - cluster weapons only: max horizontal/vertical scatter speed (px/frame)
 *                      given to each bomblet
 *     bomblet        - cluster weapons only: a nested damage profile (same fields as above) used
 *                      when each individual bomblet lands
 *     isDrone        - marks this weapon as an FPV drone: instead of a ballistic arc, firing it
 *                      hands the angle/power steering keys to the pilot in real time until it
 *                      detonates (on impact or when its battery runs out)
 *     drone          - drone weapons only:
 *         batteryMs        - how long (ms) the drone can fly before it auto-detonates in place
 *         thrustAccel      - acceleration (px/frame^2) applied per frame while a steering key is held
 *         maxSpeed         - hard cap (px/frame) on the drone's velocity in any direction
 *         gravity          - constant downward "sink" applied every frame regardless of input,
 *                            so the pilot has to actively hold climb to hold altitude
 *         windMultiplier   - how much harder wind pushes the (light) drone than it pushes a shell
 *
 *     clusterCount/isDrone are independent flags and can combine on one weapon (see
 *     "clusterDrone" below): a piloted drone that, when it detonates, also bursts into
 *     bomblets - primary damage fields are the drone's own detonation, `bomblet` is each
 *     bomblet's. Getting intercepted by a defense drone denies the cluster payload entirely
 *     (interception bypasses detonation, same as any other FPV drone).
 */
const SETTINGS = {
  terrain: {
    width: 2000,
    viewWidth: 1200,
    height: 600,
    roughness: 0.55,
    minHeight: 120,
    maxHeight: 380,
    soilSpeckCount: 650,
  },

  camera: {
    followEase: 0.08,
    idleAnchorFrac: 0.25,
    impactHoldMs: 1200,
  },

  ui: {
    gameEndDelayMs: 1800,
  },

  background: {
    distantBuildingCount: 25,
    treeCount: 65,
  },

  tank: {
    startingAmmo: 18,
    angleMin: 0,
    angleMax: 180,
    powerMin: 0,
    powerMax: 150,
    powerToVelocityScale: 0.17,
    width: 34,
    height: 14,
    barrelLength: 22,
    angleStep: 1.2,
    powerStep: 1.2,
  },

  gravity: 0.16,

  wind: {
    min: -35,
    max: 35,
    changeEvery: "shot",
    visualScale: 1.0,
    accelScale: 0.0028,
  },

  base: {
    maxHP: 100,
    width: 72,
    height: 46,
    damageTintThresholds: [
      { hp: 1.0, tint: null },
      { hp: 0.66, tint: "rgba(60,40,20,0.25)" },
      { hp: 0.33, tint: "rgba(40,25,15,0.5)" },
      { hp: 0.0, tint: "rgba(20,15,15,0.8)" },
    ],
  },

  damage: {
    directHitMin: 35,
    directHitMax: 50,
    splashRadiusMultiplier: 2.4,
    nearMissDamageClose: 15,
    nearMissDamageFar: 2,
    falloffExponent: 1,
  },

  crater: {
    radius: 26,
  },

  shield: {
    enabled: true,
    cyclePeriodMin: 7,
    cyclePeriodMax: 12,
    activeDurationMin: 1.2,
    activeDurationMax: 2.6,
    damageReduction: 0.95,
    flickerSpeed: 14,
  },

  defenseDrones: {
    enabled: true,
    countMin: 3,
    countMax: 5,
    spawnZoneStart: 0.5,
    altitudeMin: 60,
    altitudeMax: 220,
    hoverRadius: 22,
    hoverSpeed: 0.0018,
    hitRadius: 14,
  },

  buildings: {
    count: 35,
    minSize: 18,
    maxSize: 36,
    hitBehavior: "cosmetic",
  },

  weapons: {
    startingIndex: 0,
    list: [
      {
        id: "standard",
        label: "Standard Shell",
        ammoCost: 1,
        color: "#1a1a1a",
        projectileRadius: 4,
      },
      {
        id: "heavy",
        label: "Heavy Shell",
        ammoCost: 2,
        color: "#3a2a1a",
        projectileRadius: 6,
        velocityScale: 0.14,
        directHitMin: 55,
        directHitMax: 75,
        splashRadiusMultiplier: 3.2,
        nearMissDamageClose: 22,
        nearMissDamageFar: 4,
        falloffExponent: 1,
        craterRadius: 38,
      },
      {
        id: "cluster",
        label: "Cluster Shell",
        ammoCost: 2,
        color: "#8a1a1a",
        projectileRadius: 4,
        directHitMin: 8,
        directHitMax: 12,
        splashRadiusMultiplier: 1.2,
        nearMissDamageClose: 6,
        nearMissDamageFar: 1,
        falloffExponent: 1,
        craterRadius: 14,
        clusterCount: 5,
        clusterSpreadSpeed: 3.5,
        bomblet: {
          directHitMin: 10,
          directHitMax: 16,
          splashRadiusMultiplier: 1.6,
          nearMissDamageClose: 8,
          nearMissDamageFar: 1,
          falloffExponent: 1,
          craterRadius: 16,
        },
      },
      {
        id: "drone",
        label: "FPV Drone",
        ammoCost: 3,
        color: "#2a2a2a",
        projectileRadius: 3,
        isDrone: true,
        velocityScale: 0.08,
        directHitMin: 45,
        directHitMax: 60,
        splashRadiusMultiplier: 1.0,
        nearMissDamageClose: 6,
        nearMissDamageFar: 1,
        falloffExponent: 1,
        craterRadius: 20,
        drone: {
          batteryMs: 5000,
          thrustAccel: 0.35,
          maxSpeed: 6,
          gravity: 0.05,
          windMultiplier: 2.5,
        },
      },
      {
        id: "clusterDrone",
        label: "Cluster FPV Drone",
        ammoCost: 4,
        color: "#6a1a4a",
        projectileRadius: 4,
        isDrone: true,
        velocityScale: 0.08,
        directHitMin: 6,
        directHitMax: 10,
        splashRadiusMultiplier: 1.0,
        nearMissDamageClose: 5,
        nearMissDamageFar: 1,
        falloffExponent: 1,
        craterRadius: 12,
        clusterCount: 5,
        clusterSpreadSpeed: 3.5,
        bomblet: {
          directHitMin: 10,
          directHitMax: 16,
          splashRadiusMultiplier: 1.6,
          nearMissDamageClose: 8,
          nearMissDamageFar: 1,
          falloffExponent: 1,
          craterRadius: 16,
        },
        drone: {
          batteryMs: 5000,
          thrustAccel: 0.35,
          maxSpeed: 6,
          gravity: 0.05,
          windMultiplier: 2.5,
        },
      },
    ],
  },
};
