import { createContext, useContext } from "react";

/*
 * i18n.js — LANGUES DE L'INTERFACE
 * ------------------------------------------------------------
 * Chaque touche jouée fait changer la langue des textes (terminal, légende,
 * statut MIDI). Le mode se règle dans le panneau Ctrl :
 *   "random" → une autre langue au hasard (jamais deux fois la même de suite)
 *   "loop"   → toujours dans l'ordre de LANGS
 *   "fixed"  → reste en français
 * Les commandes du terminal (cd, show) ne sont pas traduites.
 * Pour corriger une traduction : modifier STRINGS ci-dessous.
 */

export const LANGS = ["fr", "de", "en"];
export const LANG_MODES = ["random", "loop", "fixed"];
export const DEFAULT_LANG = "fr";

const STRINGS = {
  fr: {
    media: "media",
    medias: "medias",
    photos: "photos",
    videos: "videos",
    noMedia: "aucun media",
    noMediaOnKey: "-- aucun media sur cette touche",
    keysRange: "touches > medias {from}-{to}",
    midiSearching: "MIDI : recherche...",
    midiUnavailable: "MIDI indisponible - clavier actif",
    midiRefused: "MIDI refuse - clavier actif",
    midiNone: "MIDI : aucun clavier - clavier actif",
    midiConnected: "MIDI : {names}",
    sleepHint: "joue une note pour commencer",
  },
  de: {
    media: "Medium",
    medias: "Medien",
    photos: "Fotos",
    videos: "Videos",
    noMedia: "keine Medien",
    noMediaOnKey: "-- kein Medium auf dieser Taste",
    keysRange: "Tasten > Medien {from}-{to}",
    midiSearching: "MIDI: Suche...",
    midiUnavailable: "MIDI nicht verfügbar - Tastatur aktiv",
    midiRefused: "MIDI verweigert - Tastatur aktiv",
    midiNone: "MIDI: kein Keyboard - Tastatur aktiv",
    midiConnected: "MIDI: {names}",
    sleepHint: "spiel eine Note, um zu beginnen",
  },
  en: {
    media: "item",
    medias: "items",
    photos: "photos",
    videos: "videos",
    noMedia: "no media",
    noMediaOnKey: "-- no media on this key",
    keysRange: "keys > items {from}-{to}",
    midiSearching: "MIDI: searching...",
    midiUnavailable: "MIDI unavailable - computer keyboard active",
    midiRefused: "MIDI denied - computer keyboard active",
    midiNone: "MIDI: no keyboard - computer keyboard active",
    midiConnected: "MIDI: {names}",
    sleepHint: "play a note to start",
  },
};

// t("fr", "keysRange", { from: 1, to: 17 }) → "touches > medias 1-17"
export function translate(lang, key, params = {}) {
  const text = STRINGS[lang]?.[key] ?? STRINGS[DEFAULT_LANG][key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ""));
}

// Langue suivante selon le mode (appelée à chaque touche jouée).
export function nextLang(current, mode) {
  if (mode === "fixed") return DEFAULT_LANG;
  const index = LANGS.indexOf(current);
  if (mode === "loop") return LANGS[(index + 1) % LANGS.length];
  const others = LANGS.filter((lang) => lang !== current);
  return others[Math.floor(Math.random() * others.length)];
}

// Langue en cours, fournie par App.jsx à tous les composants.
export const LangContext = createContext(DEFAULT_LANG);

// Dans un composant : const t = useT();  t("noMedia")
export function useT() {
  const lang = useContext(LangContext);
  const t = (key, params) => translate(lang, key, params);
  t.lang = lang;
  return t;
}
