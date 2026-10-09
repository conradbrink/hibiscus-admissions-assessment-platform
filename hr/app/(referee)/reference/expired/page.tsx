export default function ExpiredPage() {
  return (
    <div className="pb-8">
      <h1 className="text-3xl font-semibold tracking-tight">This link is no longer open</h1>
      <p className="mt-3 text-[16px] text-muted-foreground">
        The reference may already have been given, or the time to give it has passed. If you still want to give a reference, please reply to the email we sent you.
      </p>
    </div>
  );
}
