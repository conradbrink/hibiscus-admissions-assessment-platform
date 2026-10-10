"use client";

import { useEffect } from "react";

/**
 * The parent pages' error boundary. It renders inside the parent shell, so a
 * parent who hits a failure still sees the website's header, colours and
 * footer rather than the console's (the root boundary in app/error.tsx sits
 * outside every route group's layout). Like that one, it imports nothing
 * from the component library: if the failure is in a shared component, this
 * must still render.
 */
export default function ParentError({
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
    <div className="py-6">
      <h1 className="text-[1.75rem] sm:text-[2.25rem]">Something went wrong.</h1>
      <p className="mt-3 text-base leading-relaxed text-muted-foreground">
        Nothing you entered has been lost. Please try again, and if it keeps happening, contact
        the school office.
        {error.digest ? <span className="block pt-2 font-mono text-xs">Ref {error.digest}</span> : null}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 min-h-12 w-full rounded-full bg-primary px-6 py-3.5 font-heading text-[0.96875rem] leading-tight font-semibold text-primary-foreground shadow-[0_8px_20px_-10px_rgb(0_106_78/0.55)] hover:bg-[#00553e]"
      >
        Try again
      </button>
    </div>
  );
}
