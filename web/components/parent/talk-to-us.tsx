import { streetLine, telHref, whatsappHref } from "@/lib/campus-contact";

/**
 * A person, at the bottom of a page full of links.
 *
 * Everything else on the parent's pages asks them to do something on their
 * own — book, accept, pay, upload. Some families want to ask a question first,
 * and until now the only contact details they had were three lines printed at
 * the bottom of an email, which they would have had to copy out by hand.
 *
 * Renders nothing at all when a campus has neither number. An empty "Talk to
 * us" heading over a blank space is worse than no offer of help.
 */
export function TalkToUs({
  campusName,
  address,
  phone,
  whatsapp,
  studentFirstName,
}: {
  campusName: string;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  studentFirstName?: string | null;
}) {
  // An opening line, so the team can see who is asking before they reply.
  const opener = studentFirstName
    ? `Hello, I have a question about ${studentFirstName}'s place at ${campusName}.`
    : `Hello, I have a question about admissions at ${campusName}.`;
  const wa = whatsappHref(whatsapp, { text: opener });
  const tel = telHref(phone);
  const street = streetLine(address);
  if (!wa && !tel) return null;

  return (
    <section className="mt-5 surface p-5 text-sm">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Rather talk to someone?</p>
      <p className="mt-1 text-muted-foreground">
        Our admissions team at {campusName} would rather you asked than wondered.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {wa ? (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 font-medium text-primary-foreground"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
            </svg>
            Message us on WhatsApp
          </a>
        ) : null}
        {tel ? (
          <a
            href={tel}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 font-medium"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" />
            </svg>
            Call {phone}
          </a>
        ) : null}
      </div>
      {street ? <p className="mt-3 text-muted-foreground">Or come and see us: {street}</p> : null}
    </section>
  );
}
