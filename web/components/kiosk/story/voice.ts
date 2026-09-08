"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pickVoice, VOICE_STYLE } from "@/lib/assessment/story";

/**
 * The voice that reads the story. Web Speech API on the kiosk computer,
 * with the softest female English voice the device has; staff can choose
 * another from the adult strip and the choice sticks to that computer.
 *
 * Pre-recorded clips: when a chapter is recorded by a real person, drop
 * the files in public/story/voice/<item code>.mp3 and list the codes in
 * RECORDED. The player plays the clip and falls back to the synthesiser
 * for anything not recorded. Nothing else changes.
 */

const RECORDED = new Set<string>();
const STORAGE_KEY = "hibiscus.story.voice";

export type Narrator = {
  supported: boolean;
  speaking: boolean;
  voices: SpeechSynthesisVoice[];
  voiceName: string | null;
  chooseVoice: (name: string | null) => void;
  speak: (text: string, clipCode?: string | null) => void;
  stop: () => void;
};

export function useNarrator(): Narrator {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [chosen, setChosen] = useState<string | null>(() => {
    try {
      return typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Private mode or storage disabled: the automatic choice applies.
      return null;
    }
  });
  const [speaking, setSpeaking] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!supported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, [supported]);

  const voice = useMemo(() => {
    const picked = chosen ? voices.find((v) => v.name === chosen) : null;
    return picked ?? pickVoice(voices);
  }, [voices, chosen]);

  const stop = useCallback(() => {
    if (supported) window.speechSynthesis.cancel();
    if (audio.current) {
      audio.current.pause();
      audio.current = null;
    }
    setSpeaking(false);
  }, [supported]);

  const speak = useCallback(
    (text: string, clipCode?: string | null) => {
      stop();
      if (clipCode && RECORDED.has(clipCode)) {
        const a = new Audio(`/story/voice/${clipCode}.mp3`);
        audio.current = a;
        a.onended = () => setSpeaking(false);
        a.onerror = () => setSpeaking(false);
        setSpeaking(true);
        void a.play().catch(() => setSpeaking(false));
        return;
      }
      if (!supported) return;
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? "en-GB";
      u.rate = VOICE_STYLE.rate;
      u.pitch = VOICE_STYLE.pitch;
      u.volume = VOICE_STYLE.volume;
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    },
    [stop, supported, voice],
  );

  const chooseVoice = useCallback((name: string | null) => {
    setChosen(name);
    try {
      if (name) window.localStorage.setItem(STORAGE_KEY, name);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Not remembered on this computer; still used for this sitting.
    }
  }, []);

  useEffect(() => stop, [stop]);

  return { supported, speaking, voices, voiceName: voice?.name ?? null, chooseVoice, speak, stop };
}
