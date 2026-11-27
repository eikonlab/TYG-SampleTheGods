import { useEffect, useState } from "react";
import { FIRST_MIDI_NOTE } from "../constants.js";
import { synthNoteOff, synthNoteOn } from "../audio/synth.js";

/*
 * useMidi.js — CLAVIER MIDI (vrai clavier de musique branché en USB)
 * ------------------------------------------------------------
 * Se connecte aux claviers MIDI et traduit leurs messages en actions :
 *   note enfoncée → noteOn     note relâchée → noteOff
 *   molette pitch bend → setWheel
 *   molette de modulation (CC1) → onModWheel(0 à 1) : intensité générale des effets
 * Retourne { status, params, connected } : status = clé du texte affiché en haut (voir i18n.js).
 * Utilisé par : App.jsx.
 * Web MIDI est disponible dans Chrome et Edge.
 */
export function useMidi(dispatch, isVideoKey = () => false, onActivity = () => {}, onModWheel = () => {}) {
  const [midi, setMidi] = useState({ status: "midiSearching", connected: false });

  useEffect(() => {
    if (!navigator.requestMIDIAccess) {
      setMidi({ status: "midiUnavailable", connected: false });
      return;
    }

    let cancelled = false;
    let midiAccess = null;

    // La note 36 (do2) correspond à la première touche.
    // Un message MIDI = 3 octets : [type + canal, donnée 1, donnée 2]
    //   0x90 = note enfoncée (donnée 1 = note, donnée 2 = force ; force 0 = relâchée)
    //   0x80 = note relâchée
    //   0xE0 = pitch bend : valeur sur 14 bits (0 à 16383, 8192 = repos),
    //          convertie ici en nombre de -1 à +1.
    //   0xB0 = contrôleur (donnée 1 = numéro, donnée 2 = valeur 0 à 127) ; n° 1 = molette de modulation
    function handleMessage(event) {
      const [status, data1, data2] = event.data;
      // Tout message MIDI joué (note, relâchement, pitch bend, potards, pédale…) compte
      // comme une interaction : empêche la mise en veille. Les messages système
      // (0xF0 et plus : horloge, active sensing) sont envoyés en continu par certains
      // claviers sans qu'on touche à rien, on les ignore.
      if (status < 0xf0) onActivity();
      const type = status & 0xf0;
      const key = data1 - FIRST_MIDI_NOTE;

      if (type === 0x90 && data2 > 0) {
        if (!isVideoKey(key)) synthNoteOn(data1, data2 / 127);
        dispatch({ type: "noteOn", key, time: performance.now() });
      } else if (type === 0x80 || (type === 0x90 && data2 === 0)) {
        synthNoteOff(data1);
        dispatch({ type: "noteOff", key, time: performance.now() });
      } else if (type === 0xe0) {
        dispatch({ type: "setWheel", value: (((data2 << 7) | data1) - 8192) / 8192 });
      } else if (type === 0xb0 && data1 === 1) {
        onModWheel(data2 / 127);
      }
    }

    // Branche handleMessage sur chaque clavier MIDI trouvé.
    // Rappelée à chaque branchement/débranchement (onstatechange).
    function connectInputs() {
      const names = [];
      midiAccess.inputs.forEach((input) => {
        input.onmidimessage = handleMessage;
        names.push(input.name);
      });

      setMidi({
        status: names.length > 0 ? "midiConnected" : "midiNone",
        params: { names: names.join(", ") },
        connected: names.length > 0,
      });
    }

    navigator
      .requestMIDIAccess()
      .then((access) => {
        if (cancelled) return;

        midiAccess = access;
        midiAccess.onstatechange = connectInputs;
        connectInputs();
      })
      .catch(() => {
        if (cancelled) return;
        setMidi({ status: "midiRefused", connected: false });
      });

    return () => {
      cancelled = true;
      if (!midiAccess) return;

      midiAccess.onstatechange = null;
      midiAccess.inputs.forEach((input) => {
        input.onmidimessage = null;
      });
    };
  }, [dispatch]);

  return midi;
}
