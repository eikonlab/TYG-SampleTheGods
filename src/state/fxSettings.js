/*
 * fxSettings.js — RÉGLAGES DES EFFETS ET DES SONS (panneau Ctrl)
 * ------------------------------------------------------------
 * Chaque réglage est un nombre : 1 = 100 % (réglage d'origine), 0 = coupé.
 *   EFFECTS : intensité de chaque effet visuel (0 → 200 %)
 *   SOUNDS  : volume de chaque son (0 → 100 %)
 * Les valeurs sont gardées dans le navigateur (localStorage) d'une visite à l'autre.
 */

export const EFFECTS = [
  { id: "scanlines", label: "lignes de balayage" },
  { id: "mask", label: "masque RGB" },
  { id: "roll", label: "bande lumineuse" },
  { id: "rollSpeed", label: "vitesse bande lumineuse" },
  { id: "rollRate", label: "frequence bande lumineuse" },
  { id: "vignette", label: "vignettage" },
  { id: "glow", label: "lueur du texte" },
  { id: "aberration", label: "decalage rouge/bleu" },
  { id: "image", label: "contraste des images" },
  { id: "flicker", label: "scintillement" },
  { id: "jitter", label: "tremblement" },
  { id: "distort", label: "lignes de distorsion" },
  { id: "glitch", label: "bug changement d'annee" },
];
export const EFFECT_MAX = 2; // 200 %

// DESTRUCTION (molette de modulation MIDI, ou 1 = moins / 2 = plus) : de 0 à 1.
//   0                → propre : aucun tremblement, aucune distorsion
//   DESTROY_DEFAULT  → réglage normal (tremblement d'origine)
//   1                → écran détruit : tremblement continu très fort, distorsion, séparation
//                      rouge/vert/bleu des images, neige, bandes de bug au hasard
// Les autres effets cathodiques (curseurs du panneau) ne changent pas.
export const DESTROY = { id: "destroy", label: "destruction (molette)" };
export const DESTROY_DEFAULT = 0.15;
export const DESTROY_STEP = 0.05; // pas des touches 1 / 2 (20 crans du propre au détruit)
const SHAKE_MAX = 14; // tremblement / distorsion × 14 en haut de la molette
// Courbe choisie pour que DESTROY_DEFAULT donne exactement ×1.
const SHAKE_CURVE = Math.log(SHAKE_MAX) / Math.log(1 / DESTROY_DEFAULT);
const SCALED = ["jitter", "distort"];

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

// Multiplicateur du tremblement et de la distorsion : 0 (propre) → 1 (normal) → SHAKE_MAX.
export function shakeAmount(settings) {
  return SHAKE_MAX * Math.pow(clamp01(settings.destroy), SHAKE_CURVE);
}

// Effets de destruction en plus (RGB, neige, bandes…) : 0 jusqu'au réglage normal, puis → 1.
export function wreckLevel(settings) {
  const d = (clamp01(settings.destroy) - DESTROY_DEFAULT) / (1 - DESTROY_DEFAULT);
  return Math.pow(Math.max(0, d), 1.3);
}

export const SOUNDS = [
  { id: "master", label: "volume general" },
  { id: "videos", label: "son des videos" },
  { id: "yearGlitch", label: "bruit changement d'annee" },
  { id: "synth", label: "son du sampler" },
];
export const SOUND_MAX = 1; // 100 %

const STORAGE_KEY = "archives-fx-settings";

export function defaultSettings() {
  const settings = {};
  for (const { id } of [...EFFECTS, ...SOUNDS]) settings[id] = 1;
  settings.destroy = DESTROY_DEFAULT;
  return settings;
}

export function loadSettings() {
  const settings = defaultSettings();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    for (const id of Object.keys(settings)) {
      if (typeof saved[id] === "number" && Number.isFinite(saved[id])) settings[id] = saved[id];
    }
  } catch {
    // stockage indisponible : on garde les valeurs par défaut
  }
  settings.destroy = clamp01(settings.destroy);
  return settings;
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // stockage indisponible : tant pis, les réglages restent pour cette session
  }
}

// Intensité réelle d'un effet = son curseur (× la destruction pour tremblement / distorsion).
export function effectValue(settings, id) {
  return SCALED.includes(id) ? settings[id] * shakeAmount(settings) : settings[id];
}

// Variables CSS posées sur <main> : --fx-scanlines, --fx-mask, … et --fx-destroy (0 → 1).
export function effectCssVars(settings) {
  const vars = {};
  for (const { id } of EFFECTS) vars[`--fx-${id}`] = effectValue(settings, id);
  vars["--fx-destroy"] = wreckLevel(settings).toFixed(3);
  return vars;
}
