export default async function ThanksPage({ searchParams }: { searchParams: Promise<{ declined?: string }> }) {
  const { declined } = await searchParams;
  return (
    <div className="pb-8">
      <span aria-hidden className="mb-6 block h-1 w-12 rounded-full bg-[var(--brand-mark)]" />
      <h1 className="text-3xl font-semibold tracking-tight">{declined ? "Thank you for letting us know" : "Thank you for your reference"}</h1>
      <p className="mt-3 text-[16px] text-muted-foreground">
        {declined ? "We will not contact you again about this applicant." : "We have received it. Only our Human Resources team will read it. You can close this page."}
      </p>
    </div>
  );
}
