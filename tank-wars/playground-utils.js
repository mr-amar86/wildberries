// ---------------------------------------------------------------------------
// PLAYGROUND-UTILS.JS - tiny path/merge helpers shared by the override-loader
// (below) and playground.js. Loaded after settings.js, before game.js, so any
// saved overrides are already merged into SETTINGS before the engine reads it.
// ---------------------------------------------------------------------------

function twGetPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}

function twSetPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}

function twCloneDeep(value) {
  return JSON.parse(JSON.stringify(value));
}

// merges `source` onto `target` in place, recursing into plain objects and
// matching arrays up by index (SETTINGS has no arrays that change shape/length
// from the playground, e.g. weapons.list) rather than replacing them wholesale.
function twDeepMerge(target, source) {
  for (const key of Object.keys(source)) {
    const sv = source[key];
    if (Array.isArray(sv) && Array.isArray(target[key])) {
      sv.forEach((item, i) => {
        if (item && typeof item === "object") {
          if (!target[key][i]) target[key][i] = item;
          else twDeepMerge(target[key][i], item);
        } else {
          target[key][i] = item;
        }
      });
    } else if (sv && typeof sv === "object") {
      if (!target[key] || typeof target[key] !== "object") target[key] = {};
      twDeepMerge(target[key], sv);
    } else {
      target[key] = sv;
    }
  }
  return target;
}

const TW_STORAGE_KEY = "tankWarsPlaygroundOverrides";

(function applyStoredOverrides() {
  const raw = localStorage.getItem(TW_STORAGE_KEY);
  if (!raw) return;
  try {
    twDeepMerge(SETTINGS, JSON.parse(raw));
  } catch (e) {
    console.warn("Tank Wars Playground: could not apply saved overrides", e);
  }
})();
