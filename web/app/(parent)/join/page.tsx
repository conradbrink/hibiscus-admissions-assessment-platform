import type { Metadata } from "next";
import Link from "next/link";
import { Baby, CalendarCheck, Phone, School } from "lucide-react";
import { FunnelBeacon } from "@/components/parent/funnel-beacon";
import { PageHeader } from "@/components/parent/page-header";

export const metadata: Metadata = { title: "Join Hibiscus International Schools" };

const CHOICES: Array<{ href: string; icon: typeof CalendarCheck; title: string; detail: string; badge?: string; primary: boolean }> = [
  {
    href: "/join/assessment",
    icon: CalendarCheck,
    title: "Join Primary and Secondary",
    detail: "Reception to Form 5. Choose a date in about a minute.",
    // Said on the card itself, where a parent decides: cost is the first
    // thing people assume about an entrance assessment.
    badge: "Assessment is free",
    primary: true,
  },
  {
    href: "/join/preschool",
    icon: Baby,
    title: "Join pre-school",
    detail: "Nursery to Pre-Reception. No assessment: tell us about your child and book a visit to see the campus.",
    primary: false,
  },
  {
    href: "/join/visit",
    icon: School,
    title: "Book a school visit",
    detail: "Any age. Come and look around first; an assessment can be booked afterwards.",
    primary: false,
  },
  {
    href: "/join/call",
    icon: Phone,
    title: "Request a call",
    detail: "Prefer to talk? We will phone you within a working day.",
    primary: false,
  },
];

export default function JoinPage() {
  return (
    <>
      <FunnelBeacon step="join.viewed" />
      <PageHeader
        eyebrow="Join Hibiscus International Schools"
        title="Take the first step towards joining Hibiscus International Schools."
        description="Tell us a little about your child and choose how you would like to begin. No account, no password, no paperwork."
      />
      <div className="space-y-3">
        {CHOICES.map(({ href, icon: Icon, title, detail, badge, primary }) => (
          <Link
            key={href}
            href={href}
            className={
              primary
                ? "flex items-center gap-4 rounded-2xl bg-primary p-5 text-primary-foreground shadow-sm transition-transform active:translate-y-px"
                : "flex items-center gap-4 surface p-5 text-card-foreground transition-colors hover:bg-muted active:translate-y-px"
            }
          >
            <span
              className={
                primary
                  ? "flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15"
                  : "flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"
              }
            >
              <Icon className="size-5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-semibold">{title}</span>
                {badge ? (
                  <span className={primary ? "rounded-full bg-primary-foreground/20 px-2 py-0.5 text-xs font-medium" : "rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground"}>
                    {badge}
                  </span>
                ) : null}
              </span>
              <span className={primary ? "block text-sm text-primary-foreground/85" : "block text-sm text-muted-foreground"}>
                {detail}
              </span>
            </span>
          </Link>
        ))}
      </div>
      <p className="mt-8 text-sm leading-relaxed text-muted-foreground">
        Not sure which to choose? Children joining Reception or above sit a short assessment; children
        joining Nursery, Pre-Kindergarten, Kindergarten or Pre-Reception do not. Whichever option you
        start with, we will guide you to the right one.
      </p>
    </>
  );
}
