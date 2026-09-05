"use client";

import { useEffect } from "react";

/**
 * The route error boundary. Imports nothing from the component library on
 * purpose: if the failure is in a shared component, this must still render.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <h1 className="text-2xl font-bold">Something went wrong.</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Nothing you entered has been lost. Please try again, and if it keeps happening, contact
        the school office.
        {error.digest ? <span className="block pt-2 font-mono text-xs">Ref {error.digest}</span> : null}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 h-12 w-full rounded-xl bg-primary px-5 text-base font-semibold text-primary-foreground"
      >
        Try again
      </button>
    </div>
  );
}
