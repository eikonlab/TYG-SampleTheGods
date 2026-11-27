import { DESTROY, DESTROY_DEFAULT, EFFECTS, EFFECT_MAX, SOUNDS, SOUND_MAX } from "../state/fxSettings.js";
import { toAscii } from "./format.js";
import { LANG_MODES } from "../i18n.js";

/*
 * FxPanel.jsx — PANNEAU DE RÉGLAGES (touche Ctrl)
 * ------------------------------------------------------------
 * Un curseur par effet visuel (intensité) et par son (volume).
 * Double-clic sur un curseur = retour à 100 %.
 * Les touches tapées dans le panneau ne déclenchent pas le piano / la molette.
 */

function Slider({ id, label, value, min = 0, max, normal = 1, onChange }) {
  const percent = Math.round(value * 100);
  return (
    <label className="fx-row">
      <span className="fx-label">{toAscii(label)}</span>
      <input
        type="range"
        min={min * 100}
        max={max * 100}
        step="5"
        value={percent}
        onChange={(event) => onChange(id, Number(event.target.value) / 100)}
        onDoubleClick={() => onChange(id, normal)}
      />
      <span className={`fx-value${value === 0 ? " is-off" : value !== normal ? " is-changed" : ""}`}>
        {value === 0 ? "off" : `${percent}%`}
      </span>
    </label>
  );
}

const LANG_MODE_LABELS = { random: "aleatoire", loop: "boucle", fixed: "fixe (fr)" };

export default function FxPanel({ settings, crt, perf, langMode, onChange, onReset, onToggleCrt, onTogglePerf, onLangMode, onClose }) {
  return (
    <aside
      className="fx-panel"
      aria-label="Réglages des effets et du son"
      // Empêche les touches (flèches, lettres) d'agir sur le piano pendant qu'on règle.
      onKeyDown={(event) => {
        if (event.key !== "Control") event.stopPropagation();
        if (event.key === "Escape") onClose();
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header className="fx-head">
        <span>
          <span className="accent">^</span> reglages
        </span>
        <button type="button" className="fx-close" onClick={onClose} aria-label="Fermer">
          x
        </button>
      </header>

      <section className="fx-section">
        <div className="fx-title">
          <span>effets</span>
          <button type="button" className={`fx-toggle${crt ? " is-on" : ""}`} onClick={onToggleCrt}>
            [{crt ? "x" : " "}] cathodique
          </button>
        </div>
        <Slider id={DESTROY.id} label={DESTROY.label} value={settings[DESTROY.id]} max={1} normal={DESTROY_DEFAULT} onChange={onChange} />
        <div className="dim">0 = propre - 15 = normal - 100 = detruit : molette modulation (midi) ou 1 / 2</div>
        {EFFECTS.map(({ id, label }) => (
          <Slider key={id} id={id} label={label} value={settings[id]} max={EFFECT_MAX} onChange={onChange} />
        ))}
      </section>

      <section className="fx-section">
        <div className="fx-title">
          <span>son</span>
        </div>
        {SOUNDS.map(({ id, label }) => (
          <Slider key={id} id={id} label={label} value={settings[id]} max={SOUND_MAX} onChange={onChange} />
        ))}
      </section>

      <section className="fx-section">
        <div className="fx-title">
          <span>langue</span>
          <span>
            {LANG_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                className={`fx-toggle${langMode === mode ? " is-on" : ""}`}
                onClick={() => onLangMode(mode)}
                style={{ marginLeft: 10 }}
              >
                ({langMode === mode ? "x" : " "}) {LANG_MODE_LABELS[mode]}
              </button>
            ))}
          </span>
        </div>
        <div className="dim">change a chaque touche : fr / de / en</div>
      </section>

      <section className="fx-section">
        <div className="fx-title">
          <span>infos</span>
          <button type="button" className={`fx-toggle${perf ? " is-on" : ""}`} onClick={onTogglePerf}>
            [{perf ? "x" : " "}] infos perf (fps)
          </button>
        </div>
      </section>

      <footer className="fx-foot">
        <button type="button" className="fx-reset" onClick={onReset}>
          reinitialiser
        </button>
        <span className="dim">ctrl : fermer - double-clic : 100%</span>
      </footer>
    </aside>
  );
}
