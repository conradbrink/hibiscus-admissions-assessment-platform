import Link from "next/link";
import { NAV_ICONS } from "@/components/staff/nav-icons";
import { PageTitle } from "@/components/staff/page-title";
import { visibleSettingsSections } from "@/components/staff/nav-items";
import { requireStaff } from "@/lib/staff/session";

/**
 * The one door to everything the process is configured from, in six
 * groups a person can scan: what each link does in one line, and only
 * the links this person may open.
 */
export default async function AdminIndexPage() {
  const { permissions } = await requireStaff();
  const sections = visibleSettingsSections(permissions);
  return (
    <>
      <PageTitle title="Settings" description="Everything the admissions process reads its configuration from. Change it here and every applicant from then on follows." />
      <div className="space-y-6">
        {sections.map((section) => (
          <section key={section.label} aria-label={section.label ?? undefined}>
            <h2 className="mb-2 px-1 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">{section.label}</h2>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {section.items.map((item) => {
                const Icon = NAV_ICONS[item.icon];
                return (
                  <li key={item.href}>
                    <Link href={item.href} className="surface flex items-start gap-3 px-4 py-3.5 transition-shadow hover:shadow-lift">
                      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
                        <Icon className="size-4.5" aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{item.label}</span>
                        {item.blurb ? <span className="block text-xs text-muted-foreground">{item.blurb}</span> : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
