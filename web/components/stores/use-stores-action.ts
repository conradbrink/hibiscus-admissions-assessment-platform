"use client";

import { useState, useTransition, type FormEvent } from "react";
import type { StoresActionState } from "@/lib/stores/server";

type Action = (state: StoresActionState, formData: FormData) => Promise<StoresActionState>;

/**
 * A Stores server action run from a form's submit handler, with what it
 * returned handed to `onDone` when it worked.
 *
 * Not `useActionState` with an effect watching its result: reacting to a
 * result in an effect is a second render for nothing (and the lint rule says
 * so), while here the result is handled in the same transition that fetched
 * it. It also keeps React from resetting the form after a refusal, so the
 * person corrects one field rather than typing everything again.
 */
export function useStoresAction(action: Action) {
  const [state, setState] = useState<StoresActionState>({});
  const [pending, start] = useTransition();
  const run = (formData: FormData, onDone?: (result: StoresActionState) => void) =>
    start(async () => {
      const result = await action({}, formData);
      setState(result);
      if (result.ok) onDone?.(result);
    });
  const onSubmit = (onDone?: (result: StoresActionState) => void) => (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    run(new FormData(e.currentTarget), onDone);
  };
  return { state, pending, run, onSubmit, reset: () => setState({}) };
}
