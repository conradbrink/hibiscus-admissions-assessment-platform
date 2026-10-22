import type { Metadata } from "next";

export const metadata: Metadata = { title: "Thank you" };

/**
 * Where a buyer lands when this browser does not know their order — they
 * paid on another device, or the browser dropped its cookie. Their payment
 * is confirmed without them either way, and the email is how they get the
 * tickets.
 */
export default function ThanksPage() {
  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <h1 className="text-2xl font-bold tracking-tight">Thank you</h1>
      <p className="mt-3 text-base leading-relaxed text-muted-foreground">
        If your payment went through, your tickets are on their way to your email. They usually arrive within a few minutes. Please check your
        spam folder too.
      </p>
      <p className="mt-3 text-base leading-relaxed text-muted-foreground">
        No email after an hour? Contact the school with the name and email address you used, and we will send the tickets again.
      </p>
    </div>
  );
}
