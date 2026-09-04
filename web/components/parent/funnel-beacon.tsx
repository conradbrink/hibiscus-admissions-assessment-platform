"use client";

import { useEffect } from "react";

/**
 * Records one funnel step from the browser, with the time since the parent
 * first arrived. `t0` lives in sessionStorage so it survives the redirects
 * between steps and dies with the tab.
 *
 * `sendBeacon` so navigation is never delayed by measurement, and a guard
 * so a step is recorded once per tab even under React strict-mode double
 * effects.
 */
export function FunnelBeacon({ step }: { step: string }) {
  useEffect(() => {
    try {
      const key = `hbs_funnel_sent_${step}`;
      if (sessionStorage.getItem(key)) return;
      let t0 = Number(sessionStorage.getItem("hbs_funnel_t0"));
      if (!t0) {
        t0 = Date.now();
        sessionStorage.setItem("hbs_funnel_t0", String(t0));
      }
      const body = JSON.stringify({ step, elapsedMs: Date.now() - t0 });
      const blob = new Blob([body], { type: "application/json" });
      if (!navigator.sendBeacon?.("/api/funnel", blob)) {
        void fetch("/api/funnel", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => {});
      }
      sessionStorage.setItem(key, "1");
    } catch {
      // Private mode or a blocked storage API. Measurement is optional.
    }
  }, [step]);
  return null;
}

/** Reads t0 for forms to submit, so the server can compute elapsed time. */
export function FunnelT0Field() {
  useEffect(() => {
    try {
      const el = document.querySelector<HTMLInputElement>("input[name=t0]");
      if (el) el.value = sessionStorage.getItem("hbs_funnel_t0") ?? "";
    } catch {
      // ignore
    }
  }, []);
  return <input type="hidden" name="t0" defaultValue="" />;
}
