import { useEffect, useRef, useState } from "react";
import { forgetItem } from "../data/years.js";
import { mediaCount, mediaDate, toAscii } from "./format.js";
import PromptIcon from "./PromptIcon.jsx";
import { LangContext, useT } from "../i18n.js";
import SleepScreen from "./SleepScreen.jsx";
import { SLEEP_PROMPT } from "../constants.js";
import { attachVideo, setVideoVolume } from "../audio/synth.js";

/*
 * Stage.jsx — LA SCÈNE (un terminal)
 * ------------------------------------------------------------
 * Affiche le journal (log) comme une sortie de terminal : chaque entrée
 * apparaît tout de suite SOUS la précédente, le flux est collé en bas et
 * remonte ; ce qui dépasse en haut disparaît. Aucune superposition.
 *
 *   $ show 1998/rock-11.jpg
 *   ┌─ 1998/rock-11.jpg ───┐
 *   │        image         │
 *   └─ 04/08/1998 ─────────┘
 *
 * Un accord (plusieurs touches ensemble) = plusieurs cadres côte à côte sur
 * la même ligne, à la même hauteur, qui se partagent la largeur.
 */

const formatTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Un cadre : titre dans le filet du haut, date (ou lecture vidéo) dans celui du bas.
function MediaBox({ item, aspect, sound, volume, onAspect, onFailed }) {
  const t = useT();
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(item.duration || 0);
  const [ended, setEnded] = useState(false);
  const videoRef = useRef(null);

  // Son de la vidéo : activé tout de suite. Si le navigateur refuse le son avant toute action
  // de l'utilisateur, la vidéo démarre sans le son, puis le son s'active au premier clic ou à la
  // première touche.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!sound) {
      video.muted = true;
      return;
    }

    function unlock() {
      video.muted = false;
      if (video.paused && !video.ended) video.play().catch(() => {});
    }

    video.muted = false;
    video.play().catch((error) => {
      if (error.name !== "NotAllowedError") return; // ex. lecture interrompue : rien à faire
      video.muted = true; // son refusé par le navigateur : on joue sans le son en attendant
      video.play().catch(() => {});
      window.addEventListener("pointerdown", unlock, { once: true });
      window.addEventListener("keydown", unlock, { once: true });
    });

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [sound]);

  // Son de la vidéo branché sur le même chemin que le sampler (bugs du son, molette « destruction »).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    return attachVideo(video);
  }, []);

  // Volume de la vidéo (panneau Ctrl : volume général × son des vidéos).
  useEffect(() => {
    if (videoRef.current) setVideoVolume(videoRef.current, Math.max(0, Math.min(1, volume)));
  }, [volume]);

  let footer;
  if (item.kind === "video") {
    const filled = duration ? Math.round((10 * Math.min(time, duration)) / duration) : 0;
    footer = `${ended ? "[]" : ">"} ${formatTime(time)}/${formatTime(duration)} [${"#".repeat(filled)}${".".repeat(10 - filled)}]`;
  } else {
    footer = mediaDate(item) || toAscii(item.name);
  }

  return (
    <div className="term-box" style={{ flexGrow: aspect }}>
      {item.kind === "video" ? (
        <video
          className="term-img"
          style={{ aspectRatio: aspect }}
          src={item.src}
          poster={item.thumb ?? undefined}
          preload="auto"
          autoPlay
          playsInline
          ref={videoRef}
          onLoadedMetadata={(event) => {
            const { videoWidth, videoHeight, duration: length } = event.currentTarget;
            if (videoWidth && videoHeight) onAspect(videoWidth / videoHeight);
            setDuration(length);
          }}
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
          onEnded={() => setEnded(true)}
          onError={onFailed}
        />
      ) : (
        <img
          className="term-img"
          style={{ aspectRatio: aspect }}
          src={item.src}
          alt={item.name}
          decoding="sync"
          onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget;
            if (naturalWidth && naturalHeight) onAspect(naturalWidth / naturalHeight);
          }}
          onError={onFailed}
        />
      )}
      <span className="term-box-label is-bottom">{footer}</span>
    </div>
  );
}

// Une ligne de médias (1 média, ou plusieurs pour un accord).
function MediaGroup({ entry, sound, volume, onMediaFailed }) {
  const { items, year } = entry;
  // Rapport largeur/hauteur de chaque média, corrigé quand le fichier est chargé.
  const [aspects, setAspects] = useState({});
  const aspectOf = (item) => aspects[item.src] ?? item.width / item.height;
  const sum = items.reduce((total, item) => total + aspectOf(item), 0);
  // Que des images verticales → la ligne a droit à plus de hauteur.
  const isPortrait = items.every((item) => aspectOf(item) < 1);
  const height = isPortrait ? "var(--media-h-portrait)" : "var(--media-h)";

  const names = toAscii(items.length === 1 ? items[0].name : `{${items.map((item) => item.name).join(",")}}`);

  return (
    <div className="term-entry">
      <div className="term-line">
        <PromptIcon /> show {toAscii(year)}/{names}
      </div>
      {/* Largeur : celle qui donne aux cadres la hauteur maximale, sans dépasser la scène. */}
      <div
        className="term-group"
        style={{ width: `min(100% - var(--media-indent), calc(${height} * ${sum.toFixed(4)} + ${items.length * 14}px))` }}
      >
        {items.map((item) => (
          <MediaBox
            key={item.src}
            item={item}
            aspect={aspectOf(item)}
            sound={sound}
            volume={volume}
            onAspect={(value) => setAspects((current) => ({ ...current, [item.src]: value }))}
            onFailed={() => {
              forgetItem(item); // ne plus le compter ni le proposer
              onMediaFailed(item);
            }}
          />
        ))}
      </div>
    </div>
  );
}

// isLast : derniere entree apparue dans le terminal -> le surlignage de la ligne cd clignote.
function TextEntry({ entry, isLast }) {
  const t = useT();
  if (entry.type === "cd") {
    const photos = entry.count - entry.videos;
    return (
      <div className="term-entry">
        <div className="term-line">
          <PromptIcon /> <span className={`term-highlight${isLast ? " is-latest" : ""}`}>cd {toAscii(entry.year)}/</span>
        </div>
        {/* is-clip : la ligne est coupée net au bord, sans "…" */}
        <div className="term-line dim is-clip">
          {"  "}
          {toAscii(entry.count ? `${mediaCount(entry.count, t)} (${photos} ${t("photos")}, ${entry.videos} ${t("videos")})` : t("noMedia"))}
          {/* Ligne de séparation sur la même ligne (coupée au bord de l'écran) */}
          {" " + "-".repeat(400)}
        </div>
      </div>
    );
  }

  return (
    <div className={`term-line${entry.command ? "" : " dim"}`}>
      {entry.command && <><PromptIcon /> </>}
      {toAscii(entry.textKey ? t(entry.textKey, entry.params) : entry.text)}
      {(entry.errorKey || entry.error) && (
        <span className="term-error"> {toAscii(entry.errorKey ? t(entry.errorKey, entry.params) : entry.error)}</span>
      )}
    </div>
  );
}

// Veille (voir App.jsx) : sleepPhase = "awake" | "typing" | "wiping" | "asleep"
//   typing / wiping → « young gods ~ % clear » en bas ; wiping → le flux s'efface vers le haut
//   asleep          → « Last login… » + « young gods ~ % █ » (sleepSince = date de la veille)
export default function Stage({ year, log, started, videoVolume = 1, onMediaFailed, sleepPhase = "awake", sleepSince, typed = "" }) {
  const t = useT();
  const lastMedia = [...log].reverse().find((entry) => entry.type === "media");

  return (
    <div className="stage">
      <div className={`terminal${sleepPhase === "wiping" ? " is-clearing" : ""}`}>
        {/* Chaque entrée s'affiche dans la langue où elle a été écrite (entry.lang) :
            le texte déjà écrit ne change pas quand la langue change. */}
        {log.map((entry, index) => (
          <LangContext.Provider key={entry.id} value={entry.lang ?? t.lang}>
            {entry.type === "media" ? (
              <MediaGroup
                entry={entry}
                sound={started && entry === lastMedia}
                volume={videoVolume}
                onMediaFailed={onMediaFailed}
              />
            ) : (
              <TextEntry entry={entry} isLast={index === log.length - 1} />
            )}
          </LangContext.Provider>
        ))}
        {/* Au démarrage / en veille : « Last login… » + « young gods ~ % █ ».
            Sinon : curseur rectangulaire seul qui clignote. */}
        {sleepPhase === "asleep" ? (
          <SleepScreen since={sleepSince} />
        ) : sleepPhase === "typing" || sleepPhase === "wiping" ? (
          <div className="term-line">
            {SLEEP_PROMPT} {typed}
            <span className="term-cursor" aria-hidden="true" />
          </div>
        ) : (
          <div className="term-line">
            <span className="term-cursor" aria-hidden="true" />
          </div>
        )}
      </div>
    </div>
  );
}
