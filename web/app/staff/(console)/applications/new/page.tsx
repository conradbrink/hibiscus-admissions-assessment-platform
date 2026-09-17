import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MobileInput } from "@/components/ui/mobile-input";
import { NativeSelect } from "@/components/ui/native-select";
import { HEARD_FROM_OPTIONS } from "@/lib/heard-from";
import { offerableIntakes } from "@/lib/intakes";
import { monthChoices } from "@/lib/start-month";
import { PlacePicker } from "@/components/staff/place-picker";
import { requireStaff } from "@/lib/staff/session";
import { addApplicant } from "./actions";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * The front desk's version of the enquiry form: a family standing there,
 * one screen, no magic link in between. What it makes is an ordinary
 * application — the parent still gets their emails and their own link.
 */
export default async function NewApplicantPage() {
  const { supabase } = await requireStaff("applications.write");
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: campuses }, { data: grades }, { data: intakes }, { data: offered }] = await Promise.all([
    supabase.from("v_accessible_campuses").select("id, name, intake_cadence").order("sort_order"),
    supabase.from("grades").select("id, name, sort_order").eq("is_active", true).order("sort_order"),
    // Every open term, past starts included. `offerableIntakes` decides which
    // are still joinable — a date cutoff here quietly removed the term the
    // school is actually teaching, so a family enrolling a child *now* was
    // offered next January as the earliest date. The parent funnel was fixed;
    // this form was not, and staff hit it the same week.
    supabase.from("intakes").select("id, label, starts_on, is_open, academic_years(ends_on)").eq("is_open", true).order("starts_on"),
    supabase.from("campus_grades").select("campus_id, grade_id").eq("is_active", true),
  ]);

  const joinable = offerableIntakes(
    (intakes ?? []).map((i) => ({ ...i, year_ends_on: one(i.academic_years)?.ends_on ?? null })),
    today
  );

  const offeredAt = new Map<string, Set<string>>();
  for (const row of offered ?? []) {
    const set = offeredAt.get(row.campus_id) ?? new Set<string>();
    set.add(row.grade_id);
    offeredAt.set(row.campus_id, set);
  }
  // Which grades to offer in the list: everything at least one campus this
  // person can see teaches.
  const teachable = (grades ?? []).filter((g) =>
    (campuses ?? []).some((c) => offeredAt.get(c.id)?.has(g.id))
  );

  return (
    <>
      <PageTitle
        back={{ href: "/staff/applications", label: "Applicants" }}
        title="Add an applicant"
        description="For a family at the desk or on the phone. It creates the same application their own form would, and sends them the same emails."
      />

      {joinable.length === 0 ? (
        <p className="surface p-4 text-sm text-destructive">
          No start term is open, so an application cannot be created. Open one under Settings → Intakes first.
        </p>
      ) : (
        <div className="surface p-4">
          <ActionForm action={addApplicant} label="Add applicant" className="space-y-5">
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold">The child</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="childFirstName">First name</Label>
                  <Input id="childFirstName" name="childFirstName" required autoComplete="off" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="childLastName">Last name</Label>
                  <Input id="childLastName" name="childLastName" required autoComplete="off" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="childDateOfBirth">Date of birth</Label>
                  <Input id="childDateOfBirth" name="childDateOfBirth" type="date" required max={today} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="currentSchool">Current school <span className="text-muted-foreground">(optional)</span></Label>
                  <Input id="currentSchool" name="currentSchool" autoComplete="off" />
                </div>
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold">The parent</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="parentFirstName">First name</Label>
                  <Input id="parentFirstName" name="parentFirstName" required autoComplete="off" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="parentLastName">Last name</Label>
                  <Input id="parentLastName" name="parentLastName" required autoComplete="off" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" name="email" type="email" required autoComplete="off" />
                  <p className="text-xs text-muted-foreground">Everything the school sends goes here, so read it back to them.</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="mobile">Mobile <span className="text-muted-foreground">(optional)</span></Label>
                  <MobileInput name="mobile" autoComplete="off" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="whatsappOptIn" value="1" />
                The parent agreed to updates on WhatsApp as well
              </label>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold">The place</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <PlacePicker
                  campuses={(campuses ?? []).map((c) => ({ id: c.id, name: c.name, cadence: c.intake_cadence }))}
                  intakes={joinable.map((i) => ({ id: i.id, label: i.label }))}
                  months={monthChoices(today)}
                />
                <div className="space-y-1">
                  <Label htmlFor="gradeId">Grade</Label>
                  <NativeSelect id="gradeId" name="gradeId" defaultValue="">
                    <option value="">Work it out from the date of birth</option>
                    {teachable.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </NativeSelect>
                  <p className="text-xs text-muted-foreground">Choose one only when the family is transferring into a particular year. It must be taught at the campus above.</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="entryRoute">What they came for</Label>
                  <NativeSelect id="entryRoute" name="entryRoute" defaultValue="assessment">
                    <option value="assessment">An assessment</option>
                    <option value="visit">A look around the campus</option>
                    <option value="callback">A call back from the school</option>
                  </NativeSelect>
                </div>
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold">How they heard about us</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="heardFrom">Source <span className="text-muted-foreground">(optional)</span></Label>
                  <NativeSelect id="heardFrom" name="heardFrom" defaultValue="">
                    <option value="">Not asked</option>
                    {HEARD_FROM_OPTIONS.map((o) => (
                      <option key={o.key} value={o.key}>{o.label}</option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="heardFromDetail">If somewhere else, where</Label>
                  <Input id="heardFromDetail" name="heardFromDetail" autoComplete="off" />
                </div>
              </div>
            </fieldset>
          </ActionForm>
        </div>
      )}
    </>
  );
}
