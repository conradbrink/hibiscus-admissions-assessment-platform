import { CodeEntry } from "@/components/kiosk/code-entry";

/**
 * Where a lab computer starts. The teacher reads the code off the launch
 * dialog; whoever is at the keyboard types it.
 */
export default async function SitPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-3xl font-bold tracking-tight">Start your assessment</h1>
      <p className="mt-2 text-base text-muted-foreground">Type the six-letter code your teacher gives you.</p>
      {reason === "expired" ? (
        <p className="mt-4 rounded-md bg-warning/20 px-3 py-2 text-sm text-warning-foreground">This assessment is no longer open on this computer. Ask your teacher for a new code.</p>
      ) : reason === "invalid" ? (
        <p className="mt-4 rounded-md bg-warning/20 px-3 py-2 text-sm text-warning-foreground">That code did not work. Check it with your teacher.</p>
      ) : null}
      <CodeEntry />
    </div>
  );
}
