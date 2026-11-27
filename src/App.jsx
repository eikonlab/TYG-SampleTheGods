import { useEffect, useReducer, useRef, useState } from "react";
import Caption from "./components/Caption.jsx";
import FxPanel from "./components/FxPanel.jsx";
import KeyStrip, { noteForKey } from "./components/KeyStrip.jsx";
import PerfHud from "./components/PerfHud.jsx";
import SamplerHud from "./components/SamplerHud.jsx";
import { KEY_COUNT, MIDI_KEY_COUNT, SLEEP_AFTER_MS } from "./constants.js";
import Stage from "./components/Stage.jsx";
import Timeline from "./components/Timeline.jsx";
import TopBar from "./components/TopBar.jsx";
import { YEARS } from "./data/years.js";
import { preloadItems } from "./data/preload.js";
import { LangContext } from "./i18n.js";
import { useKeyboard } from "./hooks/useKeyboard.js";
import { useMidi } from "./hooks/useMidi.js";
import { setSamplerYear, setSynthDistortion, setSynthVolume, synthNoteOff, synthNoteOn } from "./audio/synth.js";
import { useWheelRepeat } from "./hooks/useWheelRepeat.js";
import { archivesReducer, createInitialState, itemForKey } from "./state/archivesReducer.js";
import { DESTROY_STEP, defaultSettings, effectCssVars, effectValue, loadSettings, saveSettings, wreckLevel } from "./state/fxSettings.js";

/*F
 * App.jsx — LE CHEF D'ORCHESTRE
 * ------------------------------------------------------------
 * Relie toutes les pièces entre elles.
 *   1. ENTRÉES  : clavier (useKeyboard), MIDI (useMidi), souris, molette (useWheelRepeat)
 *                 → envoient une "action" avec dispatch({ type: ..., ... })
 *   2. ÉTAT     : archivesReducer calcule le nouvel état
 *   3. AFFICHAGE: les composants dessinent l'état
 *
 *   ┌─────────────────────────────────── statut MIDI ┐  TopBar (Échap)
 *   │ $ show 1998/rock aux arènes-11.jpg           ⌃   │
 *   │ ┌──────────┐  terminal (Stage) : les images ┤   │  Timeline
 *   │ └──────────┘  s'impriment l'une sous l'autre ⌄   │
 *   │ rock aux arènes-11                    3/27 (ou 27 médias) │  Caption
 *   │ [a][w][s][e][d][f][t][g][y][h][u][j][k][o][l]…   │  KeyStrip
 *   └──────────────────────────────────────────────────┘
 */
export default function App() {
  // Mode de changement de langue (panneau Ctrl), gardé d'une visite à l'autre.
  const [state, dispatch] = useReducer(archivesReducer, undefined, () => {
    let mode;
    try {
      mode = localStorage.getItem("archives-lang-mode") || undefined;
    } catch {
      // stockage indisponible
    }
    return createInitialState(mode);
  });
  useEffect(() => {
    try {
      localStorage.setItem("archives-lang-mode", state.langMode);
    } catch {
      // stockage indisponible
    }
  }, [state.langMode]);
  const pointerKey = useRef(-1); // touche cliquée à la souris (-1 = aucune)
  const [chromeHidden, setChromeHidden] = useState(true); // piano et ligne du haut masqués au départ ; Échap les affiche / masque
  const [crt, setCrt] = useState(true); // § active / désactive l'effet écran cathodique
  // Infos performances (fps, mémoire…) : case du panneau Ctrl, gardée d'une visite à l'autre.
  const [perf, setPerf] = useState(() => {
    try {
      return localStorage.getItem("archives-perf") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("archives-perf", perf ? "1" : "0");
    } catch {
      // stockage indisponible
    }
  }, [perf]);
  // Écran de veille : affiché au démarrage et après SLEEP_AFTER_MS sans activité.
  // Seule une NOTE le retire : touche du piano au clavier d'ordinateur (a w s e d …),
  // note MIDI, ou clic sur une touche du piano en bas. Les autres touches (flèches, z/x,
  // Échap, Ctrl…), le clic ailleurs, la souris et la molette ne le font pas partir
  // (une fois réveillé, elles relancent quand même le compte à rebours).
  //
  // Mise en veille animée, comme un vrai terminal :
  //   "typing" → « young gods ~ % clear » se tape lettre par lettre
  //   "wiping" → glitch : le flux (images, lignes) se découpe, saute, change de couleur
  //              puis s'écrase en une ligne et disparaît (+ bug d'écran et bruit)
  //   "asleep" → terminal vidé (images effacées) : « Last login… » + « young gods ~ % █ »
  // N'importe quelle touche pendant l'animation l'annule (rien n'est effacé).
  const [sleepPhase, setSleepPhase] = useState("asleep"); // "awake" | "typing" | "wiping" | "asleep"
  const [typed, setTyped] = useState(""); // lettres de « clear » déjà tapées
  const [sleepSince, setSleepSince] = useState(() => new Date());
  const sleepTimers = useRef([]);
  const phaseRef = useRef("asleep");
  phaseRef.current = sleepPhase;
  const [{ wake, keepAwake }] = useState(() => {
    const CLEAR = "clear";
    const TYPE_MS = 110; // temps entre deux lettres
    const PAUSE_MS = 350; // pause après « clear », comme si on appuyait sur Entrée
    const WIPE_MS = 600; // durée de l'effacement (même valeur que .terminal.is-clearing dans App.css)

    function later(ms, fn) {
      sleepTimers.current.push(setTimeout(fn, ms));
    }
    function goToSleep() {
      setTyped("");
      setSleepPhase("typing");
      for (let i = 1; i <= CLEAR.length; i++) later(i * TYPE_MS, () => setTyped(CLEAR.slice(0, i)));
      const wipeAt = CLEAR.length * TYPE_MS + PAUSE_MS;
      later(wipeAt, () => {
        setSleepPhase("wiping");
        clearGlitch.current(); // bug d'écran + bruit + tremblement
      });
      later(wipeAt + WIPE_MS, () => {
        dispatch({ type: "clearLog" });
        setSleepSince(new Date());
        setSleepPhase("asleep");
      });
    }
    // Une note jouée : réveil (retire l'invite) et compte à rebours relancé.
    function wake() {
      sleepTimers.current.forEach(clearTimeout);
      sleepTimers.current = [];
      phaseRef.current = "awake";
      setSleepPhase("awake");
      later(SLEEP_AFTER_MS, goToSleep);
    }
    // Une autre touche : ne retire pas l'invite, mais si on est déjà réveillé (ou en
    // train de s'endormir) elle compte comme une activité.
    function keepAwake() {
      if (phaseRef.current !== "asleep") wake();
    }
    return { wake, keepAwake };
  });
  useEffect(() => {
    window.addEventListener("keydown", keepAwake, true);
    return () => {
      window.removeEventListener("keydown", keepAwake, true);
      sleepTimers.current.forEach(clearTimeout);
    };
  }, [keepAwake]);
  const [glitch, setGlitch] = useState(null); // bug d'écran en cours : { top } (position de la bande), ou null
  const audioCtxRef = useRef(null);

  // Panneau de réglages (touche Ctrl) : intensité de chaque effet + volume de chaque son.
  const [fxOpen, setFxOpen] = useState(false);
  const [fx, setFx] = useState(loadSettings);
  const fxRef = useRef(fx); // copie lue par les boucles d'animation et les sons (sans attendre React)
  fxRef.current = fx;
  useEffect(() => saveSettings(fx), [fx]);
  useEffect(() => setSynthVolume(fx.master * fx.synth), [fx.master, fx.synth]);

  // Ctrl seul (appuyé puis relâché sans autre touche) ouvre / ferme le panneau.
  // Ctrl + une autre touche (raccourcis du navigateur) ne fait rien.
  useEffect(() => {
    let ctrlAlone = false;
    function handleDown(event) {
      if (event.key === "Control") {
        if (!event.repeat) ctrlAlone = true;
      } else {
        ctrlAlone = false;
      }
    }
    function handleUp(event) {
      if (event.key === "Control" && ctrlAlone) setFxOpen((open) => !open);
      ctrlAlone = false;
    }
    function handleBlur() {
      ctrlAlone = false;
    }
    window.addEventListener("keydown", handleDown, true);
    window.addEventListener("keyup", handleUp, true);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleDown, true);
      window.removeEventListener("keyup", handleUp, true);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  // Sortie d'un son de glitch : passe par un gain = volume général × volume de ce son.
  // Renvoie null si le son est coupé.
  function soundOutput(ctx, soundId) {
    const volume = fxRef.current.master * fxRef.current[soundId];
    if (volume <= 0) return null;
    const out = ctx.createGain();
    out.gain.value = volume;
    out.connect(ctx.destination);
    return out;
  }

  // Une touche qui ouvre une vidéo ne joue pas d'extrait du sampler : on n'entend que la vidéo.
  const stateRef = useRef(state);
  stateRef.current = state;
  const [isVideoKey] = useState(() => (key) => {
    const { selectedYear, keyOffset } = stateRef.current;
    const year = YEARS[selectedYear];
    return !!year && itemForKey(year, key, keyOffset)?.kind === "video";
  });

  // Note enfoncée (clavier d'ordinateur ou MIDI) : réveille l'écran de veille.
  // Les autres actions (molette, z/x, flèches…) passent sans réveiller.
  const [noteDispatch] = useState(() => (action) => {
    if (action.type === "noteOn") wake();
    dispatch(action);
  });
  // Molette de modulation MIDI : en bas → propre, en haut → écran détruit (voir fxSettings.js).
  const [setFxAmountFromWheel] = useState(() => (value) =>
    setFx((current) => ({ ...current, destroy: Math.round(value * 100) / 100 })),
  );
  const midi = useMidi(noteDispatch, isVideoKey, keepAwake, setFxAmountFromWheel);

  useKeyboard(noteDispatch, isVideoKey);
  useWheelRepeat(state.wheelValue, dispatch);

  function ensureAudioContext() {
    if (typeof window === "undefined") return null;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;

    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioCtor();
    }

    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume().catch(() => {});
    }

    return audioCtxRef.current;
  }

  function playYearChangeGlitch() {
    if (!state.started) return;

    const ctx = ensureAudioContext();
    if (!ctx) return;
    const out = soundOutput(ctx, "yearGlitch");
    if (!out) return;

    const now = ctx.currentTime;
    const duration = 0.17;

    function makeNoiseBuffer(lengthSeconds) {
      const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * lengthSeconds), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      }
      return buffer;
    }

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = makeNoiseBuffer(duration);

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "highpass";
    noiseFilter.frequency.value = 1800;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.18, now + 0.006);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(out);
    noiseSource.start(now);
    noiseSource.stop(now + duration);

    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + duration);
    oscGain.gain.setValueAtTime(0.0001, now);
    oscGain.gain.exponentialRampToValueAtTime(0.09, now + 0.01);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(oscGain);
    oscGain.connect(out);
    osc.start(now);
    osc.stop(now + duration);

    const crackle = ctx.createOscillator();
    const crackleGain = ctx.createGain();
    crackle.type = "square";
    crackle.frequency.setValueAtTime(120, now);
    crackle.frequency.exponentialRampToValueAtTime(44, now + duration * 0.7);
    crackleGain.gain.setValueAtTime(0.0001, now);
    crackleGain.gain.exponentialRampToValueAtTime(0.045, now + 0.004);
    crackleGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    crackle.connect(crackleGain);
    crackleGain.connect(out);
    crackle.start(now);
    crackle.stop(now + duration);
  }

  const year = YEARS[state.selectedYear];
  // Le sampler joue les extraits de l'année affichée.
  useEffect(() => {
    if (year) setSamplerYear(year.name);
  }, [year]);

  // Médias des touches préchargés (images décodées + vignettes), pour un affichage immédiat.
  // Les touches du clavier d'ordinateur d'abord, puis le reste du clavier MIDI.
  useEffect(() => {
    if (!year) return;
    const keyCount = midi.connected ? MIDI_KEY_COUNT : KEY_COUNT;
    const keys = Array.from({ length: keyCount }, (_, key) => key);
    preloadItems(keys.map((key) => itemForKey(year, key, state.keyOffset)));
  }, [year, state.keyOffset, midi.connected]);

  // Touche cliquée à la souris : même son qu'au clavier (sauf touche vidéo).
  const pointerNote = useRef(-1);
  function handleKeyDown(key) {
    wake(); // clic sur une touche du piano = note jouée
    pointerKey.current = key;
    pointerNote.current = noteForKey(key, midi.connected);
    if (!isVideoKey(key)) synthNoteOn(pointerNote.current);
    dispatch({ type: "noteOn", key, time: performance.now() });
  }

  // Le bouton de la souris peut être relâché n'importe où dans la fenêtre.
  useEffect(() => {
    function handlePointerUp() {
      if (pointerKey.current < 0) return;
      synthNoteOff(pointerNote.current);
      dispatch({ type: "noteOff", key: pointerKey.current });
      pointerKey.current = -1;
    }

    window.addEventListener("pointerup", handlePointerUp);
    return () => window.removeEventListener("pointerup", handlePointerUp);
  }, []);

  // Échap : masque / réaffiche le piano en bas et la ligne du haut.
  useEffect(() => {
    function handleEscape(event) {
      if (event.key !== "Escape" || event.repeat) return;
      setChromeHidden((hidden) => !hidden);
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  // Le navigateur n'autorise le son qu'après un geste de l'utilisateur :
  // un clic (onPointerDown plus bas) OU n'importe quelle touche du clavier active le son des vidéos.
  useEffect(() => {
    function handleFirstKey() {
      dispatch({ type: "start" });
    }

    window.addEventListener("keydown", handleFirstKey);
    return () => window.removeEventListener("keydown", handleFirstKey);
  }, []);

  // 1 / 2 : moins / plus de destruction (comme la molette de modulation MIDI).
  // On garde la touche enfoncée pour changer en continu.
  useEffect(() => {
    function handleAmount(event) {
      if (event.key !== "1" && event.key !== "2") return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const step = event.key === "2" ? DESTROY_STEP : -DESTROY_STEP;
      setFx((current) => {
        const destroy = Math.round(Math.min(1, Math.max(0, current.destroy + step)) * 100) / 100;
        return { ...current, destroy };
      });
    }

    window.addEventListener("keydown", handleAmount);
    return () => window.removeEventListener("keydown", handleAmount);
  }, []);

  // § : active / désactive l'effet écran cathodique (vieux moniteur).
  useEffect(() => {
    function handleCrt(event) {
      if (event.key !== "§") return;
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      setCrt((on) => !on);
    }

    window.addEventListener("keydown", handleCrt);
    return () => window.removeEventListener("keydown", handleCrt);
  }, []);

  // À chaque changement d'année (seulement avec l'effet cathodique) : l'écran "bugge" un court instant.
  // Réglage : GLITCH_LENGTH = durée d'un bug (en ms, entre min et max).
  // Glitch de la mise en veille (appelé par wake/goToSleep plus haut) : bande de bug,
  // bruit de glitch et tremblement de l'écran, pendant que les images s'effacent.
  const clearGlitch = useRef(() => {});
  clearGlitch.current = () => {
    if (!crt) return;
    playYearChangeGlitch();
    if (effectValue(fxRef.current, "glitch") > 0) {
      setGlitch({ top: `${Math.round(20 + Math.random() * 50)}%` });
      setTimeout(() => setGlitch(null), 550);
    }
    bumpShake(4);
  };

  const shownYear = useRef(state.selectedYear); // année déjà affichée (pas de bug à l'ouverture de la page)
  useEffect(() => {
    if (shownYear.current === state.selectedYear) return;
    shownYear.current = state.selectedYear;
    if (!crt) return;
    playYearChangeGlitch();
    bumpShake(2); // changement d'année = interaction : secoue l'écran
    if (effectValue(fxRef.current, "glitch") <= 0) return; // bug visuel coupé dans le panneau
    const GLITCH_LENGTH = [180, 650];
    const [min, max] = GLITCH_LENGTH;
    setGlitch({ top: `${Math.round(Math.random() * 80)}%` });
    const timer = setTimeout(() => setGlitch(null), min + Math.random() * (max - min));
    return () => {
      clearTimeout(timer);
      setGlitch(null);
    };
  }, [state.selectedYear]); // eslint-disable-line react-hooks/exhaustive-deps

  // À chaque nouvelle image (seulement avec l'effet cathodique) : tout l'écran tremble
  // horizontalement, comme une vieille télé qui perd la synchro (« horizontal jitter »).
  // Chaque image ajoute de l'« énergie » au tremblement ; l'énergie retombe toute seule.
  // → plus on joue de touches rapidement (ou en accord), plus ça tremble fort.
  // Réglages :
  //   JITTER_PX    = décalage pour UNE touche (px)
  //   JITTER_SPEED = vitesse de l'oscillation (allers-retours par seconde, environ)
  //   HALF_LIFE    = temps (ms) pour que le tremblement perde la moitié de sa force
  //   ENERGY_MAX   = force maximale (× le tremblement d'une touche)
  //   DISTORT_PX   = lignes de distorsion : décalage des bandes sur le côté pour UNE touche (px)
  //   DISTORT_ROLL = vitesse de défilement des bandes vers le bas (px par seconde)
  //   KICK_CHANCE / KICK_PX = petits décrochages brusques par-dessus l'ondulation (côté « bug »)
  //   BASE_FORCE / RUSH_CURVE = doux avec une touche, de plus en plus violent avec plus de touches :
  //     force = BASE_FORCE × (nombre de touches récentes)^RUSH_CURVE
  //     ex. 1 touche → ×0.35, 2 → ×1, 3 → ×1.8, 5 → ×3.9, 8 → ×7.9
  //   (taille des bandes : baseFrequency du <feTurbulence> plus bas, 2e chiffre — plus grand = bandes plus fines)
  const JITTER_PX = 4;
  const JITTER_SPEED = 9;
  const HALF_LIFE = 450;
  const ENERGY_MAX = 8;
  const DISTORT_PX = 18;
  const KICK_CHANCE = 0.12; // probabilité d'un petit « décrochage » brusque, vérifiée environ 60 fois par seconde
  const KICK_PX = 6; // force d'un décrochage (px, pour UNE touche)
  const BASE_FORCE = 0.35; // force pour UNE seule touche (1 = ancienne force) : plus petit = plus doux au départ
  const RUSH_CURVE = 1.5; // accélération de la violence avec le nombre de touches (1 = régulière, 2 = explose vite)
  const DISTORT_ROLL = 220;
  // Destruction (molette de modulation / 1-2), au-dessus du réglage normal.
  // Les gros mouvements ne partent QUE sur une interaction (note, clic, changement d'année)
  // et retombent ensuite : au repos, l'écran reste immobile.
  //   WRECK_KICK   = décrochages brusques en plus, et plus forts
  //   WRECK_RGB_PX = séparation rouge / bleu des images (px) au maximum
  //                  (30 % fixe au repos, le reste seulement pendant le mouvement)
  const WRECK_KICK = 0.15;
  const WRECK_RGB_PX = 3;
  //   WRECK_TEAR_PX = déchirure des couleurs : le rouge et le bleu glissent en bandes horizontales (px)
  //   WRECK_HUE_DEG = la teinte des images oscille de ± ce nombre de degrés
  //   WRECK_GHOST_PX = image fantôme (écho décalé à droite, comme un câble ou une antenne abîmés)
  //   WRECK_VHOLD    = probabilité qu'un décrochage fasse décrocher la synchro verticale :
  //                    l'image défile vers le bas (on voit la bande noire entre deux images),
  //                    puis se raccroche d'un coup, avec un petit rebond — comme une vraie télé
  //   WRECK_ROLL_SPEED = vitesse de ce défilement (hauteurs d'écran par seconde)
  //   WRECK_SKEW_DEG = l'image se penche (synchro horizontale déréglée)
  //   WRECK_PUMP     = la luminosité "pompe" (alimentation fatiguée) et l'image "respire" avec :
  //                    plus claire = un peu plus grande (WRECK_BREATHE), surtout en hauteur
  const WRECK_TEAR_PX = 12;
  const WRECK_HUE_DEG = 4;
  const WRECK_GHOST_PX = 14;
  const WRECK_VHOLD = 0.5;
  const WRECK_ROLL_SPEED = 0.9;
  const WRECK_SKEW_DEG = 2.5;
  const WRECK_PUMP = 0.3;
  const WRECK_BREATHE = 0.025;
  //   WRECK_HUM      = bande sombre de ronflement secteur (50 Hz) qui remonte lentement l'écran
  //   WRECK_INTERF   = barres d'interférence verticales (parasite radio) qui dérivent sur le côté
  const WRECK_HUM = 0.45;
  const WRECK_INTERF = 0.35;

  const mainRef = useRef(null);
  const distortMap = useRef(null); // <feDisplacementMap> : force des lignes de distorsion
  const distortRoll = useRef(null); // <feOffset> : fait défiler les bandes
  const shake = useRef({ energy: 0, shown: 0, frame: 0, lastTime: 0, roll: 0, kick: 0, vhold: 0, rollLeft: 0, hum: 0, interf: 0 });
  const humRef = useRef(null); // bande de ronflement secteur
  const interfRef = useRef(null); // barres d'interférence verticales
  const rgbRed = useRef(null); // <feOffset> du canal rouge (séparation RGB)
  const rgbBlue = useRef(null); // <feOffset> du canal bleu
  const tearRed = useRef(null); // <feDisplacementMap> : déchirure du canal rouge
  const tearBlue = useRef(null); // <feDisplacementMap> : déchirure du canal bleu
  const tearRoll = useRef(null); // <feOffset> : fait défiler les bandes de déchirure
  const ghost = useRef(null); // <feOffset> : décalage de l'image fantôme

  // Séparation rouge / bleu des images (px).
  // (et image fantôme : écho décalé, proportionnel à la destruction)
  function setRgbSplit(px) {
    rgbRed.current?.setAttribute("dx", px.toFixed(1));
    rgbBlue.current?.setAttribute("dx", (-px).toFixed(1));
    ghost.current?.setAttribute("dx", (wreckLevel(fxRef.current) * WRECK_GHOST_PX + px).toFixed(1));
  }

  // Distorsion des couleurs : déchirure (px) et décalage de teinte (degrés).
  function setColorDistort(element, tear, hue) {
    tearRed.current?.setAttribute("scale", tear.toFixed(1));
    tearBlue.current?.setAttribute("scale", (-tear).toFixed(1));
    element?.style.setProperty("--wreck-hue", `${hue.toFixed(1)}deg`);
  }

  function resetShake(element) {
    setRgbSplit(wreckLevel(fxRef.current) * WRECK_RGB_PX * 0.3); // au repos : écart fixe, sans mouvement
    setColorDistort(element, 0, 0);
    if (!element) return;
    element.style.translate = "";
    element.style.transform = "";
    element.style.filter = "";
    distortMap.current?.setAttribute("scale", "0");
    if (humRef.current) humRef.current.style.opacity = "0";
    if (interfRef.current) interfRef.current.style.opacity = "0";
  }

  // Une interaction ajoute de l'énergie au tremblement (et lance la boucle si besoin).
  function bumpShake(amount) {
    if (!crt) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const s = shake.current;
    s.energy = Math.min(ENERGY_MAX, s.energy + amount);
    if (!s.frame) {
      s.lastTime = performance.now();
      s.frame = requestAnimationFrame(runShake);
    }
  }

  // Boucle d'animation : tourne seulement tant qu'il reste de l'énergie (après une interaction).
  function runShake(time) {
    const s = shake.current;
    const element = mainRef.current;
    const dt = time - s.lastTime;
    s.lastTime = time;
    s.energy *= Math.pow(0.5, dt / HALF_LIFE);
    const wreck = wreckLevel(fxRef.current); // 0 = normal ou propre, 1 = détruit

    if (!element || (s.energy < 0.03 && s.shown < 0.03)) {
      s.energy = 0;
      s.shown = 0;
      s.frame = 0;
      resetShake(element);
      return;
    }

    // Montée et descente en douceur : la force affichée rejoint l'énergie progressivement
    // (pas de saut brutal quand une touche arrive).
    s.shown += (s.energy - s.shown) * Math.min(1, dt / 60);

    // Doux pour une touche, de plus en plus violent quand les touches s'accumulent.
    const force = BASE_FORCE * Math.pow(s.shown, RUSH_CURVE);

    // Oscillation fluide et irrégulière (somme de sinus) au lieu de sauts au hasard.
    const t = (time / 1000) * JITTER_SPEED * 2 * Math.PI;
    const wobble = 0.6 * Math.sin(t) + 0.3 * Math.sin(t * 2.3 + 1.7) + 0.1 * Math.sin(t * 5.1 + 0.4);
    // De temps en temps, un décrochage brusque qui revient vite (perte de synchro).
    if (Math.random() < (KICK_CHANCE + wreck * WRECK_KICK) * Math.min(1, force)) {
      s.kick = (Math.random() < 0.5 ? -1 : 1) * KICK_PX * (1 + wreck * 3);
    }
    s.kick *= 0.6;
    // Perte de synchro verticale : sur un décrochage, l'image se met à défiler vers le bas
    // (la bande noire entre deux images apparaît en haut), puis se raccroche d'un coup.
    if (wreck > 0 && !s.rollLeft && Math.abs(s.kick) > KICK_PX && Math.random() < WRECK_VHOLD * wreck) {
      s.rollLeft = 120 + Math.random() * 450 * wreck; // durée du défilement (ms)
    }
    if (s.rollLeft > 0) {
      s.vhold += WRECK_ROLL_SPEED * element.clientHeight * (0.5 + 0.5 * wreck) * (dt / 1000);
      s.rollLeft -= dt;
      if (s.rollLeft <= 0) {
        s.rollLeft = 0;
        s.vhold = -6 * wreck; // raccroché : petit rebond vers le haut
      }
    } else {
      s.vhold *= Math.pow(0.5, dt / 40);
      if (Math.abs(s.vhold) < 0.3) s.vhold = 0;
    }
    // intensités réglées dans le panneau Ctrl (× force du tremblement : molette / 1-2)
    const jitter = effectValue(fxRef.current, "jitter");
    const distort = effectValue(fxRef.current, "distort");
    element.style.translate = `${((wobble * JITTER_PX + s.kick) * force * jitter).toFixed(2)}px ${s.vhold.toFixed(1)}px`;

    // Lignes de distorsion : des bandes horizontales glissent sur le côté et défilent vers le bas.
    s.roll = (s.roll + (DISTORT_ROLL * dt) / 1000) % (3 * element.clientHeight || 2000);
    const motion = Math.min(1, force);
    // Synchro horizontale déréglée : l'image se penche.
    // Luminosité qui pompe, et l'image "respire" avec (plus claire = plus grande, surtout en hauteur).
    const swell = wreck * motion * Math.sin(t * 0.21 + 0.8);
    const pump = 1 + WRECK_PUMP * swell;
    element.style.transform =
      wreck > 0
        ? `skewX(${(wreck * motion * WRECK_SKEW_DEG * wobble).toFixed(2)}deg) scale(${(1 + WRECK_BREATHE * 0.4 * swell).toFixed(4)}, ${(1 + WRECK_BREATHE * swell).toFixed(4)})`
        : "";
    const filters = [];
    if (distort > 0) filters.push("url(#crt-hdistort)");
    if (wreck > 0) filters.push(`brightness(${pump.toFixed(3)})`);
    element.style.filter = filters.join(" ");
    distortMap.current?.setAttribute("scale", (DISTORT_PX * force * distort).toFixed(1));
    distortRoll.current?.setAttribute("dy", s.roll.toFixed(1));

    // Séparation rouge / bleu des images (convergence déréglée) : petit écart fixe, qui s'ouvre pendant le mouvement.
    setRgbSplit(wreck * WRECK_RGB_PX * (0.3 + 0.7 * motion * Math.abs(wobble)));

    // Distorsion des couleurs pendant le mouvement : bandes où le rouge et le bleu se
    // déchirent (dans des sens opposés), et teinte qui oscille, plus fort aux décrochages.
    const tear = wreck * motion * (WRECK_TEAR_PX + Math.abs(s.kick) * 3);
    const hue = wreck * motion * WRECK_HUE_DEG * (0.7 * wobble + 0.3 * Math.sign(s.kick) * Math.min(1, Math.abs(s.kick) / KICK_PX));
    setColorDistort(element, tear, hue);
    tearRoll.current?.setAttribute("dy", (-s.roll * 0.6).toFixed(1));

    // Bande de ronflement secteur : large bande sombre et floue qui remonte lentement.
    const height = element.clientHeight || 800;
    s.hum = (s.hum + 0.12 * height * (dt / 1000)) % (height * 1.6);
    if (humRef.current) {
      humRef.current.style.opacity = (wreck * motion * WRECK_HUM).toFixed(3);
      humRef.current.style.transform = `translateY(${(height - s.hum).toFixed(1)}px)`;
    }
    // Barres d'interférence verticales : douces, elles dérivent sur le côté et frémissent.
    s.interf += (dt / 1000) * (25 + 60 * wreck) * (1 + 0.5 * wobble);
    if (interfRef.current) {
      interfRef.current.style.opacity = (wreck * motion * WRECK_INTERF * (0.8 + 0.2 * Math.random())).toFixed(3);
      interfRef.current.style.backgroundPosition = `${s.interf.toFixed(1)}px 0`;
    }
    s.frame = requestAnimationFrame(runShake);
  }

  const lastMedia = [...state.log].reverse().find((entry) => entry.type === "media");
  // Change à chaque nouvelle image, y compris une image ajoutée à un accord.
  const mediaSignature = lastMedia ? `${lastMedia.id}:${lastMedia.items.length}` : "";
  const shownMedia = useRef(mediaSignature); // pas de tremblement à l'ouverture de la page
  useEffect(() => {
    if (shownMedia.current === mediaSignature) return;
    shownMedia.current = mediaSignature;
    bumpShake(1); // +1 touche
  }, [mediaSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  // Destruction au-dessus du normal : effets fixes (couleurs, neige, écart RGB au repos).
  const wrecked = crt && wreckLevel(fx) > 0;
  // Petits bugs spontanés, même sans interaction : de temps en temps l'écran frémit un peu
  // tout seul (léger tremblement, petite déchirure…). Plus la destruction est haute, plus
  // ils sont fréquents. Les GROS mouvements restent réservés aux interactions.
  //   IDLE_BUG_EVERY = attente entre deux petits bugs (ms) : [molette juste au-dessus du normal, molette en haut]
  //   IDLE_BUG_FORCE = force d'un petit bug (1 = une touche jouée)
  const IDLE_BUG_EVERY = [6000, 1200];
  const IDLE_BUG_FORCE = [0.25, 0.6];
  useEffect(() => {
    if (!wrecked) return;
    let timer = 0;
    function next() {
      const wreck = wreckLevel(fxRef.current);
      const [slow, fast] = IDLE_BUG_EVERY;
      const wait = (slow + (fast - slow) * wreck) * (0.4 + Math.random() * 1.2);
      timer = setTimeout(() => {
        const [low, high] = IDLE_BUG_FORCE;
        bumpShake(low + Math.random() * (high - low) * wreckLevel(fxRef.current));
        next();
      }, wait);
    }
    next();
    return () => clearTimeout(timer);
  }, [wrecked]); // eslint-disable-line react-hooks/exhaustive-deps

  // Le son du sampler sature aussi (coupé avec l'effet cathodique, touche §).
  useEffect(() => setSynthDistortion(crt ? wreckLevel(fx) : 0), [crt, fx.destroy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!shake.current.frame) setRgbSplit(wreckLevel(fx) * WRECK_RGB_PX * 0.3);
  }, [fx.destroy]); // eslint-disable-line react-hooks/exhaustive-deps

  // Arrête le tremblement si l'effet cathodique est coupé ou si la page se ferme.
  useEffect(() => {
    const s = shake.current;
    const element = mainRef.current;
    return () => {
      cancelAnimationFrame(s.frame);
      s.rollLeft = 0;
      s.vhold = 0;
      s.frame = 0;
      s.energy = 0;
      s.shown = 0;
      resetShake(element);
    };
  }, [crt]);

  return (
    <LangContext.Provider value={state.lang}>
    <main
      ref={mainRef}
      className={`app${chromeHidden ? " is-chrome-hidden" : ""}${crt ? " is-crt" : ""}${glitch ? " is-glitch" : ""}${wrecked ? " is-wrecked" : ""}`}
      style={effectCssVars(fx)}
      onPointerDown={() => {
        dispatch({ type: "start" });
        bumpShake(1); // clic = interaction : secoue l'écran
      }}
    >
      {!chromeHidden && <TopBar midi={midi} />}

      <section className="middle">
        <Stage
          year={year}
          log={state.log}
          started={state.started}
          sleepPhase={sleepPhase}
          sleepSince={sleepSince}
          typed={typed}
          videoVolume={Math.min(1, fx.master * fx.videos)}
          onMediaFailed={(item) => dispatch({ type: "mediaFailed", item })}
        />
        <Timeline
          selectedYear={state.selectedYear}
          wheelValue={state.wheelValue}
          onSelect={(index) => dispatch({ type: "selectYear", index })}
          onStep={(direction) => dispatch({ type: "changeYear", direction })}
        />
      </section>

      <Caption year={year} log={state.log} />

      {!chromeHidden && (
        <KeyStrip
          year={year}
          keyOffset={state.keyOffset}
          pressedKeys={state.pressedKeys}
          playedKeys={state.playedKeys}
          isMidi={midi.connected}
          onKeyDown={handleKeyDown}
        />
      )}

      {/* Toujours visible (même avec Échap) : descend en bas de l'écran quand le piano est masqué.
          Dans <main>, sous le calque cathodique : subit les mêmes effets que le reste de l'écran
          (lignes, masque, lueur, tremblement, distorsion…). */}
      <SamplerHud targetRef={mainRef} isMidi={midi.connected} low={chromeHidden} />

      {/* Filtre des lignes de distorsion horizontales (utilisé pendant le tremblement).
          baseFrequency "0 0.025" : 0 = bandes parfaitement horizontales, 0.025 = hauteur des bandes. */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        {/* Zone du filtre étendue vers le haut : on y prend les bandes qu'on fait descendre sur l'écran. */}
        <filter id="crt-hdistort" x="0" y="-300%" width="100%" height="400%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0 0.025" numOctaves="2" seed="3" stitchTiles="stitch" result="noise" />
          <feOffset ref={distortRoll} in="noise" dy="0" result="bands" />
          {/* Canal vert fixé au milieu : aucun décalage vertical, seulement horizontal */}
          <feColorMatrix in="bands" type="matrix" values="1 0 0 0 0  0 0 0 0 0.5  0 0 0 0 0  0 0 0 0 1" result="map" />
          <feDisplacementMap ref={distortMap} in="SourceGraphic" in2="map" scale="0" xChannelSelector="R" yChannelSelector="G" />
</filter>
        {/* Séparation rouge / vert / bleu des images (destruction) : le rouge part à droite,
            le bleu à gauche, le vert reste en place ; dx réglé à chaque image par runShake. */}
        <filter id="crt-rgbsplit" x="-5%" y="0" width="110%" height="100%" colorInterpolationFilters="sRGB">
          {/* Bandes horizontales qui servent à déchirer le rouge et le bleu (scale réglé par runShake) */}
          <feTurbulence type="fractalNoise" baseFrequency="0 0.045" numOctaves="1" seed="7" result="tearNoise" />
          <feOffset ref={tearRoll} in="tearNoise" dy="0" result="tearBands" />
          <feColorMatrix in="tearBands" type="matrix" values="1 0 0 0 0  0 0 0 0 0.5  0 0 0 0 0  0 0 0 0 1" result="tearMap" />
          <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red" />
          <feOffset ref={rgbRed} in="red" dx="0" result="redShifted" />
          <feDisplacementMap ref={tearRed} in="redShifted" in2="tearMap" scale="0" xChannelSelector="R" yChannelSelector="G" result="redMoved" />
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green" />
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue" />
          <feOffset ref={rgbBlue} in="blue" dx="0" result="blueShifted" />
          <feDisplacementMap ref={tearBlue} in="blueShifted" in2="tearMap" scale="0" xChannelSelector="R" yChannelSelector="G" result="blueMoved" />
          <feBlend in="redMoved" in2="green" mode="screen" result="redGreen" />
          <feBlend in="redGreen" in2="blueMoved" mode="screen" result="rgb" />
          {/* Image fantôme : écho faible décalé à droite */}
          <feOffset ref={ghost} in="rgb" dx="0" result="ghostMoved" />
          <feComponentTransfer in="ghostMoved" result="ghostFaint">
            <feFuncA type="linear" slope="0.35" />
          </feComponentTransfer>
          <feBlend in="rgb" in2="ghostFaint" mode="screen" />
        </filter>
      </svg>

      {/* Calque écran cathodique : lignes, masque RGB, vignettage, scintillement */}
      {crt && (
        <div className="crt" aria-hidden="true">
          <div className="crt-scanlines" />
          <div className="crt-mask" />
          {/* Fréquence plus haute que la vitesse : plusieurs bandes à l'écran en même temps */}
          <div className={fx.rollRate > fx.rollSpeed ? "crt-roll crt-roll--multi" : "crt-roll"} />
          <div className="crt-vignette" />
          {wrecked && <div className="crt-purity" />}
          {wrecked && <div className="crt-noise" />}
          {glitch && <div className="crt-glitch" style={{ top: glitch.top }} />}
          {wrecked && <div ref={humRef} className="crt-hum" />}
          {wrecked && <div ref={interfRef} className="crt-interference" />}
        </div>
      )}
    </main>

    {perf && <PerfHud />}

    {fxOpen && (
      <FxPanel
        settings={fx}
        crt={crt}
        onChange={(id, value) => setFx((current) => ({ ...current, [id]: value }))}
        onReset={() => setFx(defaultSettings())}
        onToggleCrt={() => setCrt((on) => !on)}
        perf={perf}
        langMode={state.langMode}
        onLangMode={(mode) => dispatch({ type: "setLangMode", mode })}
        onTogglePerf={() => setPerf((on) => !on)}
        onClose={() => setFxOpen(false)}
      />
    )}
    </LangContext.Provider>
  );
}
