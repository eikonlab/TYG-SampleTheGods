import { useEffect, useRef } from "react";
import { SLEEP_PROMPT } from "../constants.js";
import { YEARS } from "../data/years.js";
import { useT } from "../i18n.js";
import { mediaDate, toAscii } from "./format.js";

/*
 * SleepScreen.jsx — ÉCRAN DE VEILLE (en bas du terminal)
 * ------------------------------------------------------------
 * Le terminal « se fait une démo » tout seul, en boucle :
 *   Last login: Mon Nov 16 14:02:11 on console
 *   young gods ~ % ascii 1987/rock aux arenes-11.jpg     ← la commande se tape
 *   [photo d'archive dessinée en caractères]             ← apparaît ligne par ligne
 *   -- 1987 - 12/03/1987                                   (ligne de balayage jaune),
 *   young gods ~ % █   joue une note pour commencer        grésille un peu, puis se
 *                                                           désagrège → photo suivante
 * Une photo au hasard parmi toutes les années à chaque tour.
 * Affiché à l'ouverture de la page et après SLEEP_AFTER_MS sans activité
 * (réglages dans constants.js). App.jsx le retire à la première note jouée.
 *
 * Réglages :
 *   RAMP      = caractères du plus sombre au plus clair
 *   CHAR_W    = largeur d'un caractère / sa hauteur (police Intel One Mono ≈ 0.6)
 *   ART_SIZE  = taille des caractères du dessin [min, max] (px)
 *   TYPE_MS   = vitesse de frappe de la commande (ms par lettre)
 *   SCAN_MS   = durée d'apparition du dessin
 *   HOLD_MS   = durée d'affichage
 *   DECAY_MS  = durée de la désagrégation
 *   GLITCH    = probabilité d'un petit accroc à chaque image (~60 par seconde) pendant l'affichage
 */

const RAMP = " .,:;-~=+*xX%#@";
const NOISE = "!/\\|_-=+*<>#%@01";
const CHAR_W = 0.6;
const ART_SIZE = [6, 10];
const TYPE_MS = 38;
const SCAN_MS = 2200;
const HOLD_MS = 7000;
const DECAY_MS = 1400;
const PAUSE_MS = 600;
const GLITCH = 0.05;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Date au format du terminal Mac : "Mon Nov 16 14:02:11"
function loginDate(date) {
  const two = (n) => String(n).padStart(2, "0");
  return `${DAYS[date.getDay()]} ${MONTHS[date.getMonth()]} ${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}

const randomInt = (n) => Math.floor(Math.random() * n);
const noiseChar = () => NOISE[randomInt(NOISE.length)];

// Une photo au hasard (une année au hasard, puis une photo de cette année).
function pickImage() {
  const years = YEARS.filter((year) => year.items.some((item) => item.kind === "image"));
  if (!years.length) return null;
  const images = years[randomInt(years.length)].items.filter((item) => item.kind === "image");
  return images[randomInt(images.length)];
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Photo → lignes de caractères. Le contraste est étiré (2 % les plus sombres = noir,
// 2 % les plus clairs = blanc) pour que chaque photo remplisse toute la gamme.
function imageToArt(img, cols, rows) {
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, cols, rows);
  const { data } = g.getImageData(0, 0, cols, rows);
  const light = new Float32Array(cols * rows);
  for (let i = 0; i < light.length; i++) {
    light[i] = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
  }
  const sorted = Float32Array.from(light).sort();
  const low = sorted[Math.floor(sorted.length * 0.02)];
  const high = Math.max(low + 1, sorted[Math.floor(sorted.length * 0.98)]);
  const lines = [];
  for (let y = 0; y < rows; y++) {
    let line = "";
    for (let x = 0; x < cols; x++) {
      const v = Math.min(1, Math.max(0, (light[y * cols + x] - low) / (high - low)));
      line += RAMP[Math.round(Math.pow(v, 0.9) * (RAMP.length - 1))];
    }
    lines.push(line);
  }
  return lines;
}

// Taille du dessin : remplit la place libre du terminal en gardant les proportions de la photo.
function measure(terminal, aspect) {
  const style = getComputedStyle(terminal);
  const lineH = parseFloat(style.lineHeight) || 28;
  const width = terminal.clientWidth - 2 * (parseFloat(style.paddingLeft) || 16);
  const height = terminal.clientHeight - 2 * (parseFloat(style.paddingTop) || 16) - 5 * (lineH + 4);
  const [minSize, maxSize] = ART_SIZE;
  const size = Math.min(maxSize, Math.max(minSize, Math.round(height / 80)));
  let rows = Math.floor(height / size);
  let cols = Math.round((rows * aspect) / CHAR_W);
  const maxCols = Math.floor(width / (size * CHAR_W));
  if (cols > maxCols) {
    cols = maxCols;
    rows = Math.round((cols * CHAR_W) / aspect);
  }
  return { cols: Math.max(10, cols), rows: Math.max(5, rows), size };
}

export default function SleepScreen({ since }) {
  const t = useT();
  const commandRef = useRef(null);
  const artRef = useRef(null);
  const beforeRef = useRef(null); // lignes au-dessus de la ligne jaune
  const scanRef = useRef(null); // ligne jaune (balayage / accroc)
  const afterRef = useRef(null); // lignes en dessous
  const captionRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let frame = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const wait = (ms) =>
      new Promise((resolve) => {
        timer = setTimeout(resolve, ms);
      });
    // Appelle step(progression 0 → 1, temps) à chaque image pendant ms millisecondes.
    const animate = (ms, step) =>
      new Promise((resolve) => {
        const start = performance.now();
        function tick(now) {
          if (cancelled) return resolve();
          const p = Math.min(1, (now - start) / ms);
          step(p, now);
          if (p < 1) frame = requestAnimationFrame(tick);
          else resolve();
        }
        frame = requestAnimationFrame(tick);
      });

    function show(before, scan = "", after = "") {
      beforeRef.current.textContent = before;
      scanRef.current.textContent = scan;
      afterRef.current.textContent = after;
    }

    async function run() {
      while (!cancelled) {
        const item = pickImage();
        const terminal = artRef.current?.closest(".terminal");
        if (!item || !terminal) {
          await wait(2000);
          continue;
        }
        let img;
        try {
          img = await loadImage(item.thumb ?? item.src);
        } catch {
          await wait(300);
          continue;
        }
        if (cancelled) return;

        const { cols, rows, size } = measure(terminal, img.naturalWidth / img.naturalHeight || 1.5);
        const art = imageToArt(img, cols, rows);
        const pre = artRef.current;
        pre.style.fontSize = `${size}px`;
        pre.style.lineHeight = `${size}px`;
        pre.style.height = `${rows * size}px`;
        show("");
        captionRef.current.textContent = "";

        // 1. La commande se tape lettre par lettre.
        const command = `ascii ${item.yearName}/${toAscii(item.name)}`;
        for (let i = 1; i <= command.length && !cancelled; i++) {
          commandRef.current.textContent = command.slice(0, i);
          await wait(reduced ? 0 : TYPE_MS + Math.random() * 45);
        }
        if (cancelled) return;
        await wait(250);

        // 2. Le dessin apparaît ligne par ligne, sous une ligne de balayage jaune qui grésille.
        if (reduced) {
          show(art.join("\n"));
        } else {
          await animate(SCAN_MS, (p) => {
            const shown = Math.floor(p * rows);
            if (shown >= rows) return show(art.join("\n"));
            const scan = art[shown].replace(/[^ ]/g, () => (Math.random() < 0.6 ? noiseChar() : "#"));
            show(art.slice(0, shown).join("\n") + (shown ? "\n" : ""), scan);
          });
        }
        if (cancelled) return;
        const date = mediaDate(item);
        captionRef.current.textContent = `-- ${item.yearName}${date ? ` - ${date}` : ""}`;

        // 3. Affichage : de temps en temps, une ligne accroche (bout de ligne brouillé, en jaune).
        let glitchRow = -1;
        let glitchUntil = 0;
        if (reduced) {
          await wait(HOLD_MS);
        } else {
          await animate(HOLD_MS, (p, now) => {
            if (glitchRow >= 0 && now > glitchUntil) {
              glitchRow = -1;
              show(art.join("\n"));
            }
            if (glitchRow < 0 && Math.random() < GLITCH) {
              glitchRow = randomInt(rows);
              glitchUntil = now + 50 + Math.random() * 140;
              const start = randomInt(cols);
              const length = 4 + randomInt(Math.max(5, cols / 3));
              const shift = randomInt(9) - 4; // la ligne glisse aussi un peu sur le côté
              const line = art[glitchRow];
              let row = (shift > 0 ? " ".repeat(shift) + line : line.slice(-shift)).slice(0, cols);
              row = row.slice(0, start) + row.slice(start, start + length).replace(/./g, noiseChar) + row.slice(start + length);
              show(
                art.slice(0, glitchRow).join("\n") + (glitchRow ? "\n" : ""),
                row,
                glitchRow < rows - 1 ? "\n" + art.slice(glitchRow + 1).join("\n") : "",
              );
            }
          });
        }
        if (cancelled) return;

        // 4. Désagrégation : les caractères se brouillent puis s'éteignent, au hasard.
        if (!reduced) {
          const grid = art.map((line) => line.split(""));
          const perFrame = Math.ceil((cols * rows) / 28);
          await animate(DECAY_MS, (p) => {
            for (let i = 0; i < perFrame * (0.4 + p); i++) {
              const row = grid[randomInt(rows)];
              const x = randomInt(cols);
              row[x] = row[x] === " " || NOISE.includes(row[x]) ? " " : noiseChar();
            }
            show(grid.map((line) => line.join("")).join("\n"));
          });
        }
        if (cancelled) return;
        show("");
        commandRef.current.textContent = "";
        captionRef.current.textContent = "";
        await wait(PAUSE_MS);
      }
    }

    run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <>
      <div className="term-line dim">Last login: {loginDate(since)} on console</div>
      <div className="term-line is-clip">
        {SLEEP_PROMPT} <span ref={commandRef} />
      </div>
      <pre className="sleep-art" ref={artRef} aria-hidden="true">
        <span ref={beforeRef} />
        <span ref={scanRef} className="sleep-art-scan" />
        <span ref={afterRef} />
      </pre>
      <div className="term-line dim sleep-caption" ref={captionRef} />
      <div className="term-line">
        {SLEEP_PROMPT} <span className="term-cursor" aria-hidden="true" />
        <span className="sleep-hint">   {t("sleepHint")}</span>
      </div>
    </>
  );
}
