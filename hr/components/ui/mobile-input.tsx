"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  DIALLING_CODES,
  ELSEWHERE_CODE,
  checkMobile,
  splitMobile,
} from "@/lib/phone";

/**
 * A mobile number asked for in two parts: the country, then the number.
 *
 * The school messages families on WhatsApp, which only accepts a number in
 * E.164 — country code, national number, no zero, no spaces. Asking for the
 * country separately is the difference between knowing that and guessing it,
 * and the check runs as the number is typed rather than when a message
 * bounces a week later.
 *
 * What is submitted is a single hidden field under `name`, holding the E.164
 * number, so every action and schema that already reads `mobile` is
 * unchanged. It is empty until the number checks out, and the browser is told
 * to refuse the form until then, so nothing half-typed reaches the server —
 * which checks it again anyway, with the same function.
 */
export function MobileInput({
  name,
  defaultValue,
  required,
  readOnly,
  invalid,
  autoComplete = "tel",
}: {
  name: string;
  defaultValue?: string | null;
  required?: boolean;
  readOnly?: boolean;
  invalid?: boolean;
  autoComplete?: string;
}) {
  const initial = splitMobile(defaultValue);
  const [dialling, setDialling] = useState(initial.dialling);
  const [national, setNational] = useState(initial.national);
  const [touched, setTouched] = useState(false);
  const numberRef = useRef<HTMLInputElement>(null);
  const noteId = useId();

  const country = DIALLING_CODES.find((c) => c.code === dialling);
  const empty = national.trim() === "";
  const check = empty ? null : checkMobile(dialling, national);
  const problem = check && !check.ok ? check.reason : null;

  // The browser does the refusing, so a wrong number cannot be submitted by
  // pressing enter; the message is the country's own sentence, not "invalid".
  useEffect(() => {
    const el = numberRef.current;
    if (!el) return;
    el.setCustomValidity(problem && !empty ? problem : "");
  }, [problem, empty]);

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <NativeSelect
          aria-label="Country code"
          className="w-[9.5rem] shrink-0"
          value={dialling}
          disabled={readOnly}
          onChange={(e) => {
            setDialling(e.target.value);
            setTouched(true);
          }}
        >
          {DIALLING_CODES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} {c.name}
            </option>
          ))}
          <option value={ELSEWHERE_CODE}>Somewhere else</option>
        </NativeSelect>
        <Input
          ref={numberRef}
          id={name}
          type="tel"
          inputMode="tel"
          autoComplete={autoComplete}
          placeholder={country?.placeholder ?? "Country code and number"}
          value={national}
          required={required}
          readOnly={readOnly}
          aria-describedby={noteId}
          {...(invalid || (touched && problem) ? { "aria-invalid": true as const } : {})}
          onChange={(e) => setNational(e.target.value)}
          onBlur={() => setTouched(true)}
        />
      </div>

      {/* The number as it will be stored and messaged, or what is wrong with
          it. Only after the field has been left, so nobody is corrected
          mid-word. */}
      <p id={noteId} className={`text-xs ${touched && problem ? "text-destructive" : "text-muted-foreground"}`} aria-live="polite">
        {touched && problem
          ? problem
          : check && check.ok
            ? `We will message ${check.pretty}.`
            : (country?.hint ?? "Choose the country, then enter the number.")}
      </p>

      {/* Joined even when it does not check out, so the server refuses it with
          the same sentence rather than a vaguer "enter a mobile number" — and
          so what the parent typed comes back on the field after a round trip. */}
      <input
        type="hidden"
        name={name}
        value={check && check.ok ? check.e164 : empty ? "" : `${dialling === ELSEWHERE_CODE ? "+" : dialling}${national.replace(/\D/g, "")}`}
      />
    </div>
  );
}
