"use client";

import { startTransition, type FormEvent } from "react";

/**
 * Submit a server action without React resetting the form afterwards.
 *
 * React resets a `<form action={fn}>` once the action resolves. For an
 * uncontrolled field that is what you want. For a field held in state and
 * seeded from props — which every editor in the console does, so the live
 * preview and the "problems" list can react to typing — it is a trap:
 *
 *   · React writes each field's *mount-time* value into the DOM's default
 *     attribute, so the reset restores what the field held when the page
 *     loaded, not what was just saved.
 *   · React's own tree still holds the new value, so nothing has changed as
 *     far as it is concerned, and it never writes the DOM back.
 *
 * The result is a form that silently shows stale values after a successful
 * save. It bit the message-template editor first and most visibly: ticking
 * "Active", saving, and watching the tick disappear while the database
 * happily held `is_active = true`. The neighbouring checkbox stayed ticked,
 * which is the tell — it had been ticked at mount, so its default matched.
 *
 * Submitting the action ourselves skips that reset entirely, and every field
 * keeps the value the person just saved. The cost is that these forms no
 * longer submit without JavaScript, which costs nothing real here: the live
 * preview, the validation list and the disabled Save button all need it
 * anyway.
 */
export function submitWithoutReset(formAction: (formData: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };
}
