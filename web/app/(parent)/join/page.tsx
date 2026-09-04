import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, Phone, School } from "lucide-react";
import { FunnelBeacon } from "@/components/parent/funnel-beacon";
import { PageHeader } from "@/components/parent/page-header";

export const metadata: Metadata = { title: "Join Hibiscus Schools" };

const CHOICES = [
  {
    href: "/join/assessment",
    icon: CalendarCheck,
    title: "Book an assessment",
    detail: "For Reception and above. Choose a date in about a minute.",
    primary: true,
  },
  {
    href: "/join/visit",
    icon: School,
    title: "Book a school visit",
    detail: "Come and see the campus before you decide.",
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
        eyebrow="Join Hibiscus Schools"
        title="Take the first step towards joining Hibiscus Schools."
        description="Tell us a little about your child and choose how you would like to begin. No account, no password, no paperwork."
      />
      <div className="space-y-3">
        {CHOICES.map(({ href, icon: Icon, title, detail, primary }) => (
          <Link
            key={href}
            href={href}
            className={
              primary
                ? "flex items-center gap-4 rounded-2xl bg-primary p-5 text-primary-foreground shadow-sm transition-transform active:translate-y-px"
                : "flex items-center gap-4 rounded-2xl border border-border bg-card p-5 text-card-foreground transition-colors hover:bg-muted active:translate-y-px"
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
              <span className="block text-lg font-semibold">{title}</span>
              <span className={primary ? "block text-sm text-primary-foreground/85" : "block text-sm text-muted-foreground"}>
                {detail}
              </span>
            </span>
          </Link>
        ))}
      </div>
      <p className="mt-8 text-sm leading-relaxed text-muted-foreground">
        Children joining Nursery to Pre-Reception do not sit an assessment. Start with any option
        and we will guide you.
      </p>
    </>
  );
}
