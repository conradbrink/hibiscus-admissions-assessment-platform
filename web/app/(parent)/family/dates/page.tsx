import type { Metadata } from "next";
import { EventCard } from "@/components/parent/event-card";
import { PageHeader } from "@/components/parent/page-header";
import { loadFamilyEvents, loadFamilyStudents } from "@/lib/family/events";
import { familyClient } from "@/lib/family/scope";
import { requireFamilySession } from "@/lib/tokens/server";

export const metadata: Metadata = { title: "Dates for your diary" };

/**
 * The school's invitations to this family: open days, the Make-a-Thon, a
 * parent meeting. One tap says yes, and it can be undone.
 *
 * Every read goes through `lib/family`, which takes the verified session
 * and never a raw id. `scope.test.ts` fails the build if this file ever
 * queries a table itself.
 */
export default async function FamilyDatesPage() {
  const session = await requireFamilySession();
  const admin = familyClient();
  const [events, students] = await Promise.all([loadFamilyEvents(admin, session), loadFamilyStudents(admin, session)]);

  return (
    <>
      <PageHeader eyebrow="Hibiscus" title="Dates for your diary" description="Things the school has invited you to. Tell us if you are coming, and we will keep a place for you." />
      {events.length ? (
        <ul className="space-y-4">
          {events.map((e) => (
            <li key={e.id}>
              <EventCard event={e} students={students.map((s) => ({ id: s.id, name: s.preferred_name || s.legal_first_name }))} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">There is nothing in the diary just now. We will email you when there is.</p>
      )}
    </>
  );
}
