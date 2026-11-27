/*
 * synth.js — SAMPLER YOUNG GODS (Web Audio)
 * ------------------------------------------------------------
 * Rôle : quand on appuie sur une touche, joue un extrait des Young Gods
 *        (un extrait différent par touche ET par année).
 *   synthNoteOn(note, force) → démarre l'extrait de cette touche (note MIDI ; force 0 → 1)
 *   synthNoteOff(note)       → relâche : l'extrait s'éteint en fondu
 *   setSynthVolume(v)        → volume (panneau Ctrl : volume général × son du sampler)
 *   setSamplerYear(nom)      → choisit la série d'extraits de l'année affichée
 *   getSamplerStatus()       → ce qui sonne en ce moment (pour l'affichage, voir SamplerHud.jsx)
 * Utilisé par : hooks/useKeyboard.js, hooks/useMidi.js, App.jsx (volume, année).
 *
 * Les extraits sont lus DIRECTEMENT dans les enregistrements d'origine de
 * dossiers <année>/AUDIO du disque externe (lien src/audio/originaux) : aucun son n'est
 * copié. La liste des passages est dans audio/extraits/<année>.txt
 * (n° | <année>/AUDIO/fichier | moment dans le fichier) : 10 secondes par passage.
 * Seul ce morceau du fichier est téléchargé (voir decoupe.js), pas le fichier entier.
 * Chaque année (1985 → 2026 + sans-date) a jusqu'à 76 passages, un par touche du
 * clavier MIDI. Seuls les passages enregistrés l'année du dossier sont joués : une
 * année sans enregistrement reste muette, et une année qui a moins de 76 passages
 * à elle les répète sur le clavier.
 *
 * Touches : la note la plus grave du clavier MIDI (FIRST_MIDI_NOTE) = extrait 01,
 * la suivante = 02, … jusqu'à 76. Le clavier de l'ordinateur joue les mêmes
 * notes que le MIDI ("a" = do4 = note 60 → extrait 25, … ";" → extrait 41).
 * L'extrait tourne en boucle tant que la touche est tenue.
 * Polyphonique : chaque touche a sa propre voix (on peut superposer les extraits).
 */

import { FIRST_MIDI_NOTE } from "../constants.js";
import { cutClip } from "./decoupe.js";

// Réglages du son
const VOLUME = 0.8;
const ATTACK = 0.015;  // fondu d'entrée (secondes)
const RELEASE = 0.4;   // fondu de sortie quand on relâche (secondes)
const LOOP = true;     // l'extrait tourne en boucle tant que la touche est tenue
const KEYBOARD_NOTE = 60;  // note de la touche "a" du clavier d'ordinateur
const KEYBOARD_KEYS = 17;  // touches a … ; (préchargées en premier à chaque changement d'année)
const CACHE_MAX = 100;     // nombre d'extraits décodés gardés en mémoire (~3,5 Mo chacun) :
                           // les 76 de l'année affichée + quelques-uns de l'année d'avant

const CLIP_LENGTH = 10; // secondes jouées à partir du moment indiqué dans extraits/<année>.txt

// Adresse des enregistrements (dossiers <année>/AUDIO) (lien src/audio/originaux vers le disque externe).
const AUDIO_BASE =
  import.meta.env.VITE_AUDIO_URL ??
  (import.meta.env.DEV ? import.meta.env.BASE_URL + "src/audio/originaux/" : "../audio/");

// Passages rangés par année : { "1987": [{ id, number, url, start }, …], … }
// On ne garde que les passages enregistrés CETTE année-là : un enregistrement de
// 1990 listé dans 1991.txt est ignoré. Une année sans enregistrement n'a donc pas
// de son, et ses touches restent muettes.
const CLIPS = {};
const lists = import.meta.glob("./extraits/*.txt", { eager: true, query: "?raw", import: "default" });

// "8:16" ou "1:02:03" → secondes
function seconds(text) {
  return text.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

for (const path of Object.keys(lists).sort()) {
  const folder = path.split("/").pop().replace(".txt", "");
  for (const line of lists[path].split("\n")) {
    const [number, file, time] = line.split("|").map((part) => part.trim());
    if (!number || !file || !time) continue;
    const recorded = file.split("/")[0];
    const sameYear = folder === "sans-date" ? recorded === "0000" || recorded === "no date" : recorded === folder;
    if (!sameYear) continue;
    (CLIPS[folder] ||= []).push({
      id: `${folder}/${number}`,
      number: Number(number),
      url: AUDIO_BASE + file.split("/").map(encodeURIComponent).join("/"),
      start: seconds(time),
    });
  }
}
const CLIP_YEARS = Object.keys(CLIPS);

// Cache : passage → promesse du son décodé (chargé seulement quand on en a besoin).
// Les plus anciens sont oubliés au-delà de CACHE_MAX pour ne pas saturer la mémoire.
const buffers = new Map();
let currentYear = CLIP_YEARS[CLIP_YEARS.length - 1];

// Nom affiché → dossier d'extraits. Pas d'emprunt aux années voisines :
// une année sans enregistrement → null (pas de son).
function clipYearFor(name) {
  if (CLIPS[name]) return name;
  if (Number.isNaN(Number(name)) && CLIPS["sans-date"]) return "sans-date";
  return null;
}

function loadClip(item) {
  let clip = buffers.get(item.id);
  if (clip) {
    buffers.delete(item.id); // remis en dernier = utilisé récemment
  } else {
    clip = cutClip(getContext(), item.url, item.start, CLIP_LENGTH).catch((error) => {
      console.warn(`Son introuvable : ${decodeURIComponent(item.url)} à ${item.start} s`, error);
      buffers.delete(item.id); // réessayé la prochaine fois
      return null;
    });
  }
  buffers.set(item.id, clip);
  while (buffers.size > CACHE_MAX) buffers.delete(buffers.keys().next().value);
  return clip;
}

// Passage d'une note dans la série de l'année.
function clipFor(clips, note) {
  const n = clips.length;
  return clips[(((note - FIRST_MIDI_NOTE) % n) + n) % n];
}

// Appelé par App.jsx quand l'année change (et à l'ouverture de la page) :
// on précharge TOUS les extraits de l'année (76, un par touche MIDI), pour qu'une
// touche sonne tout de suite, même la première fois. Les touches de l'ordinateur
// passent en premier. Un par un, pour ne pas faire ramer l'affichage ; si l'année
// change entre-temps, l'ancien préchargement s'arrête.
let preloadRun = 0;
export function setSamplerYear(name) {
  currentYear = clipYearFor(String(name));
  const clips = CLIPS[currentYear];
  if (!clips) return;
  getContext(); // le décodage marche même si le son est encore bloqué par le navigateur

  const first = [];
  for (let i = 0; i < KEYBOARD_KEYS; i++) first.push(clipFor(clips, KEYBOARD_NOTE + i));
  const order = [...new Set([...first, ...clips])];

  const run = ++preloadRun;
  (async () => {
    for (const clip of order) {
      if (run !== preloadRun) return;
      await loadClip(clip);
    }
  })();
}

let ctx = null;
let master = null;
let analyser = null;      // mesure le niveau sonore du sampler (pour l'affichage)
let levelData = null;
const voices = new Map(); // note → voix en cours
// Ce qui est affiché : note → { note, clip, year, status, startedAt, duration, releasedAt }
//   status = "loading" (extrait pas encore prêt) | "playing" | "release" (fondu de sortie) | "error"
const display = new Map();
let volume = 1;           // réglage du panneau Ctrl (0 → 1)

// BUG DU SON (molette « destruction ») : la hauteur et le timbre ne changent pas,
// mais le son « bugge » pendant qu'il joue, comme un vieux poste mal réglé :
//   creux     : le son baisse d'un coup une fraction de seconde (sans claquer, jamais à zéro)
//   hachures  : le son « tremble » en rafale (fort / faible / fort / faible)
//   craquements : petits parasites étouffés
//   sauts (vidéos) : la vidéo recule d'un petit bout et rejoue, comme une bande qui accroche
// Plus la molette est haute, plus les bugs sont fréquents et longs.
// Une saturation s'ajoute aussi (sans couper les aigus).
// Le son des vidéos passe par le même chemin (attachVideo) :
//   sampler → master ─┐
//   vidéos → volume ──┴→ gate (coupures) ─┬─ dry ─────────────┬─→ sortie
//                                         └─ shaper → wet ─────┘
let distortion = 0;
let gate = null;
let dry = null;
let wet = null;
let glitchTimer = 0;
const DISTORT_WET_MAX = 0.2;  // part de son saturé au maximum
const GLITCH_RATE = 5;        // nombre de bugs par seconde (environ) molette en haut
const CRACKLE_VOLUME = 0.15;  // force des craquements
const VIDEO_SKIP_CHANCE = 0.2; // part des bugs qui font sauter une vidéo en arrière
const videos = new Map();     // <video> branchée en ce moment → { source, volume }
const routed = new WeakMap(); // toutes les <video> déjà branchées une fois (le branchement est définitif)

function saturationCurve(drive) {
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / Math.tanh(drive);
  }
  return curve;
}

function applyDistortion() {
  if (!ctx) return;
  const now = ctx.currentTime;
  wet.gain.setTargetAtTime(distortion * DISTORT_WET_MAX, now, 0.05);
  dry.gain.setTargetAtTime(1 - distortion * DISTORT_WET_MAX * 0.7, now, 0.05);
}

// Creux de volume arrondi (pas de coupure sèche qui claque) :
// le son descend à « depth » en FADE secondes, y reste, puis remonte.
const FADE = 0.008;
const DIP_DEPTH = [0.12, 0.4]; // le son ne disparaît jamais complètement (0 = silence, 1 = rien)
function dip(at, length, depth) {
  const g = gate.gain;
  g.setValueAtTime(1, at);
  g.linearRampToValueAtTime(depth, at + FADE);
  g.setValueAtTime(depth, at + FADE + length);
  g.linearRampToValueAtTime(1, at + 2 * FADE + length);
}

function randomDepth() {
  const [low, high] = DIP_DEPTH;
  return low + Math.random() * (high - low);
}

// Petit craquement étouffé (bruit court filtré : pas de clic aigu).
function crackle(at) {
  const length = Math.ceil(ctx.sampleRate * (0.006 + Math.random() * 0.014));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const envelope = Math.sin((Math.PI * i) / length); // monte et descend en douceur
    data[i] = (Math.random() * 2 - 1) * envelope;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 2200;
  const amp = ctx.createGain();
  amp.gain.value = CRACKLE_VOLUME * (0.4 + 0.6 * distortion);
  source.connect(filter);
  filter.connect(amp);
  amp.connect(gate);
  source.start(at);
  source.onended = () => amp.disconnect();
}

function playingVideos() {
  return [...videos.keys()].filter((video) => !video.paused && !video.ended && !video.muted);
}

// Saut de bande : la vidéo recule d'un petit bout, une ou plusieurs fois (elle « accroche »).
// Le son baisse un court instant autour de chaque saut pour qu'il ne claque pas.
function skipVideo(video) {
  const back = 0.04 + Math.random() * 0.12 * distortion;
  const repeats = 1 + Math.floor(Math.random() * (1 + distortion));
  for (let i = 0; i < repeats; i++) {
    setTimeout(() => {
      if (video.paused) return;
      dip(ctx.currentTime, 0.03, 0.15);
      setTimeout(() => {
        video.currentTime = Math.max(0, video.currentTime - back);
      }, FADE * 1000);
    }, i * back * 1000);
  }
}

// Un bug : creux, hachure douce, craquement ou saut de vidéo (choisi au hasard).
function glitchOnce() {
  const playing = playingVideos();
  if (playing.length && Math.random() < VIDEO_SKIP_CHANCE) {
    skipVideo(playing[Math.floor(Math.random() * playing.length)]);
    return;
  }
  const now = ctx.currentTime + 0.005;
  gate.gain.cancelScheduledValues(now);
  gate.gain.setValueAtTime(1, now);
  const kind = Math.random();
  if (kind < 0.45) {
    dip(now, 0.015 + Math.random() * 0.07 * distortion, randomDepth());
  } else if (kind < 0.8) {
    const cuts = 2 + Math.floor(Math.random() * (1 + 2 * distortion));
    const step = 0.025 + Math.random() * 0.03;
    const depth = randomDepth();
    for (let i = 0; i < cuts; i++) dip(now + i * 2 * step, step - 2 * FADE, depth);
  } else {
    crackle(now);
    if (Math.random() < 0.4) crackle(now + 0.02 + Math.random() * 0.05);
  }
}

// Boucle des bugs : tourne tant que la destruction est au-dessus du normal.
// Ne bugge que si un extrait est en train de sonner.
function scheduleGlitches() {
  clearTimeout(glitchTimer);
  glitchTimer = 0;
  if (distortion <= 0) return;
  const wait = 120 + Math.random() * (2000 / (GLITCH_RATE * distortion));
  glitchTimer = setTimeout(() => {
    if (ctx && ctx.state === "running" && (voices.size > 0 || playingVideos().length > 0)) glitchOnce();
    scheduleGlitches();
  }, wait);
}

// Branche le son d'une vidéo sur le chemin des bugs. Renvoie une fonction de débranchement.
// Le volume passe alors par setVideoVolume (et non plus par video.volume).
export function attachVideo(video) {
  if (!videos.has(video)) {
    try {
      const ac = getContext();
      // Une vidéo ne peut être branchée qu'une fois : on garde le branchement pour le réutiliser.
      let entry = routed.get(video);
      if (!entry) {
        const source = ac.createMediaElementSource(video);
        const volumeNode = ac.createGain();
        volumeNode.gain.value = video.volume;
        video.volume = 1;
        source.connect(volumeNode);
        // Le son ne sort que si l'audio est réveillé : on le réveille au lancement de la vidéo.
        video.addEventListener("play", () => ac.state === "suspended" && ac.resume());
        entry = { source, volume: volumeNode };
        routed.set(video, entry);
      }
      entry.volume.connect(gate);
      videos.set(video, entry);
    } catch {
      // Web Audio indisponible : la vidéo garde son son normal (sans bugs)
    }
  }
  return () => detachVideo(video);
}

function detachVideo(video) {
  const entry = videos.get(video);
  if (!entry) return;
  entry.volume.disconnect();
  videos.delete(video);
}

export function setVideoVolume(video, value) {
  const entry = routed.get(video);
  if (entry) entry.volume.gain.value = value;
  else video.volume = value;
}

export function setSynthDistortion(amount) {
  distortion = Math.max(0, Math.min(1, amount));
  applyDistortion();
  if (distortion <= 0 && gate && ctx) {
    gate.gain.cancelScheduledValues(ctx.currentTime);
    gate.gain.setValueAtTime(1, ctx.currentTime);
  }
  scheduleGlitches();
}

function getContext() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = VOLUME * volume;
    gate = ctx.createGain();
    master.connect(gate);
    dry = ctx.createGain();
    gate.connect(dry);
    dry.connect(ctx.destination);
    const shaper = ctx.createWaveShaper();
    shaper.curve = saturationCurve(4);
    shaper.oversample = "2x";
    wet = ctx.createGain();
    wet.gain.value = 0;
    gate.connect(shaper);
    shaper.connect(wet);
    wet.connect(ctx.destination);
    applyDistortion();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    levelData = new Float32Array(analyser.fftSize);
    master.connect(analyser);
  }
  // Le navigateur suspend l'audio tant qu'on n'a pas interagi : une touche suffit à le réveiller.
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}


export function setSynthVolume(value) {
  volume = Math.max(0, value);
  if (master) master.gain.value = VOLUME * volume;
}

export function synthNoteOn(note, force = 0.8) {
  const clips = CLIPS[currentYear];
  if (!clips || clips.length === 0) return;
  const ac = getContext();
  synthNoteOff(note); // si l'extrait sonnait encore, on le relâche d'abord

  const amp = ac.createGain();
  amp.connect(master);
  const voice = { amp, source: null };
  voices.set(note, voice);

  const clip = clipFor(clips, note);
  const info = {
    note,
    clip: clip.number,
    year: currentYear,
    status: "loading",
    startedAt: 0,
    duration: 0,
    releasedAt: 0,
  };
  voice.info = info;
  display.set(note, info);

  const start = (buffer) => {
    if (!buffer) {
      info.status = "error";
      info.releasedAt = ac.currentTime;
      return;
    }
    if (voices.get(note) !== voice) return; // touche déjà relâchée
    const now = ac.currentTime;
    info.status = "playing";
    info.startedAt = now;
    info.duration = buffer.duration;
    const source = ac.createBufferSource();
    source.buffer = buffer;
    source.loop = LOOP;
    source.connect(amp);
    amp.gain.setValueAtTime(0, now);
    amp.gain.linearRampToValueAtTime(0.4 + 0.6 * force, now + ATTACK);
    source.onended = () => amp.disconnect();
    source.start(now);
    voice.source = source;
  };

  // L'extrait n'est peut-être pas encore décodé : on attend qu'il le soit.
  loadClip(clip).then(start);
}

export function synthNoteOff(note) {
  const voice = voices.get(note);
  if (!voice || !ctx) return;
  voices.delete(note);

  const now = ctx.currentTime;
  if (!voice.source) {
    voice.amp.disconnect();
    if (display.get(note) === voice.info && voice.info.status === "loading") display.delete(note);
    return;
  }
  voice.info.status = "release";
  voice.info.releasedAt = now;
  voice.amp.gain.cancelScheduledValues(now);
  voice.amp.gain.setValueAtTime(voice.amp.gain.value, now);
  voice.amp.gain.setTargetAtTime(0, now, RELEASE / 4);
  voice.source.stop(now + RELEASE + 0.05);
}

// Pour l'affichage (SamplerHud.jsx), appelé à chaque image :
//   level  = niveau sonore du sampler (0 → 1 environ)
//   voices = extraits en cours : { note, clip, year, status, progress (0 → 1), elapsed, duration, fade (1 → 0) }
const HOLD_ERROR = 1.2; // secondes pendant lesquelles un extrait introuvable reste affiché
export function getSamplerStatus() {
  if (!ctx) return { level: 0, voices: [], blocked: false };
  const now = ctx.currentTime;

  analyser.getFloatTimeDomainData(levelData);
  let sum = 0;
  for (let i = 0; i < levelData.length; i++) sum += levelData[i] * levelData[i];
  const level = Math.min(1, Math.sqrt(sum / levelData.length) * 3);

  const list = [];
  for (const [note, info] of display) {
    let fade = 1;
    if (info.status === "release") {
      fade = 1 - (now - info.releasedAt) / RELEASE;
      if (fade <= 0) {
        display.delete(note);
        continue;
      }
    } else if (info.status === "error" && now - info.releasedAt > HOLD_ERROR) {
      display.delete(note);
      continue;
    }
    const elapsed = info.startedAt ? now - info.startedAt : 0;
    const progress = info.duration ? (elapsed % info.duration) / info.duration : 0;
    list.push({ ...info, elapsed, progress, fade, loops: info.duration ? Math.floor(elapsed / info.duration) : 0 });
  }
  list.sort((a, b) => a.note - b.note);
  // Son bloqué par le navigateur (Chrome ouvert à la main, sans l'option du serveur).
  return { level, voices: list, blocked: ctx.state !== "running" };
}
