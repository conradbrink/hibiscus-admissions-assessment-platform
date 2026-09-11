import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/parent/page-header";
import {
  familyClient,
  loadFamily,
  loadFamilyContacts,
  loadFamilyStudents,
} from "@/lib/family/scope";
import { formatDate } from "@/lib/format-date";
import { requireFamilySession } from "@/lib/tokens/server";

export const metadata: Metadata = { title: "Your family" };

/**
 * The family hub: every child at once, which is the whole point of the
 * family link. Read-only for now — the checklist, the dates and the termly
 * "is she coming back?" arrive on top of this.
 *
 * Every read goes through `lib/family/scope`, which takes the verified
 * session and never a raw id. `scope.test.ts` fails the build if this file
 * ever queries a table itself.
 */
export default async function FamilyHubPage() {
  const session = await requireFamilySession();
  const admin = familyClient();

  const [family, students, contacts] = await Promise.all([
    loadFamily(admin, session),
    loadFamilyStudents(admin, session),
    loadFamilyContacts(admin, session),
  ]);

  const surname = family?.display_name?.trim();

  return (
    <>
      <PageHeader
        eyebrow="Hibiscus"
        title={surname ? `The ${surname} family` : "Your family"}
        description="Everything we hold for your children at Hibiscus, in one place."
      />

      {students.length ? (
        <ul className="space-y-3">
          {students.map((s) => (
            <li key={s.id} className="rounded-2xl border border-border/60 bg-card p-4">
              <p className="font-medium">{s.preferred_name || s.legal_first_name} {s.legal_last_name}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {s.grade?.name ?? "Class to be confirmed"}
                {s.campus ? ` · ${s.campus.name}` : ""}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {s.status === "onboarding"
                  ? "Starting soon."
                  : s.status === "on_leave"
                    ? "On leave."
                    : "Attending."}
                {s.details_confirmed_at
                  ? ` You last checked these details on ${formatDate(s.details_confirmed_at)}.`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">
          We have no children enrolled under this family yet. If that looks wrong, reply to any email
          from us and we will put it right.
        </p>
      )}

      <nav className="mt-6 flex flex-wrap gap-3 text-sm">
        <Link href="/family/checklist" className="rounded-lg border border-border/60 px-3 py-2 hover:bg-muted">
          What is still to do
        </Link>
        <Link href="/family/extras" className="rounded-lg border border-border/60 px-3 py-2 hover:bg-muted">
          Extras you can order
        </Link>
      </nav>

      {contacts.length ? (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold">Who we contact</h2>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {contacts.map((c) => (
              <li key={c.id}>
                {c.first_name} {c.last_name} · {c.email}
                {c.mobile ? ` · ${c.mobile}` : ""}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            If any of this has changed, reply to one of our emails and tell us.
          </p>
        </section>
      ) : null}
    </>
  );
}
