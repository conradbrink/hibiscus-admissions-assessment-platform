"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pickVoice, VOICE_STYLE } from "@/lib/assessment/story";

/**
 * The voice that reads the story.
 *
 * With `serverVoice` on, every line is a recording fetched from
 * /api/sit/voice (ElevenLabs, cached on the server after the first time it
 * is said) and played through an <audio> element; the next line is fetched
 * while the current one plays, so there is no gap. Without it, or when a
 * fetch fails, the browser's own speech synthesis reads the line with the
 * softest female English voice the device has, which staff can change from
 * the adult strip; that choice sticks to the computer.
 */

const STORAGE_KEY = "hibiscus.story.voice";

export type Narrator = {
  supported: boolean;
  /** Recordings from the server rather than the browser's synthesiser. */
  recorded: boolean;
  speaking: boolean;
  voices: SpeechSynthesisVoice[];
  voiceName: string | null;
  chooseVoice: (name: string | null) => void;
  speak: (text: string) => void;
  prefetch: (text: string) => void;
  stop: () => void;
};

export function useNarrator(serverVoice: boolean): Narrator {
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
  // Object URLs for lines already fetched, by text. Small: a chapter is a few dozen lines.
  const clips = useRef<Map<string, Promise<string | null>>>(new Map());
  // Which utterance is current, so a stale fetch cannot start playing over a newer line.
  const turn = useRef(0);

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
    turn.current += 1;
    if (supported) window.speechSynthesis.cancel();
    if (audio.current) {
      audio.current.pause();
      audio.current = null;
    }
    setSpeaking(false);
  }, [supported]);

  const synthesise = useCallback(
    (text: string) => {
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
    [supported, voice],
  );

  const fetchClip = useCallback(
    (text: string): Promise<string | null> => {
      const key = text.replace(/\s+/g, " ").trim();
      const existing = clips.current.get(key);
      if (existing) return existing;
      const p = fetch(`/api/sit/voice?t=${encodeURIComponent(key)}`)
        .then(async (res) => {
          if (!res.ok) return null;
          const blob = await res.blob();
          return URL.createObjectURL(blob);
        })
        .catch(() => null);
      clips.current.set(key, p);
      // A failed fetch is not remembered, so the next attempt tries again.
      void p.then((url) => {
        if (!url) clips.current.delete(key);
      });
      return p;
    },
    [],
  );

  const prefetch = useCallback(
    (text: string) => {
      if (serverVoice && text.trim()) void fetchClip(text);
    },
    [serverVoice, fetchClip],
  );

  const speak = useCallback(
    (text: string) => {
      stop();
      const line = text.trim();
      if (!line) return;
      if (!serverVoice) {
        synthesise(line);
        return;
      }
      const mine = ++turn.current;
      setSpeaking(true);
      void fetchClip(line).then((url) => {
        if (turn.current !== mine) return;
        if (!url) {
          synthesise(line);
          return;
        }
        const a = new Audio(url);
        audio.current = a;
        a.onended = () => setSpeaking(false);
        a.onerror = () => setSpeaking(false);
        void a.play().catch(() => {
          // Autoplay refused (no gesture yet): show the words and stay quiet.
          setSpeaking(false);
        });
      });
    },
    [stop, serverVoice, fetchClip, synthesise],
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

  return { supported, recorded: serverVoice, speaking, voices, voiceName: voice?.name ?? null, chooseVoice, speak, prefetch, stop };
}
