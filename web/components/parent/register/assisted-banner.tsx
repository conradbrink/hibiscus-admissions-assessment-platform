import { finishAssistedRegistration } from "@/app/(parent)/register/actions";
import { Button } from "@/components/ui/button";
import { assistedSessionStaff } from "@/lib/registration/session";

/**
 * Shown on every registration page while a member of staff has the form open
 * at the desk (`startAssistedRegistration`), so neither the family nor the
 * next person to sit at that computer mistakes it for the family's own link.
 * Nothing at all on a parent's own session.
 */
export async function AssistedBanner() {
  const staff = await assistedSessionStaff();
  if (!staff) return null;
  const name = staff.name;
  return (
    <div className="mb-5 rounded-2xl border-2 border-primary bg-card p-4 text-sm" role="status">
      <p className="font-semibold">Filled in at the school with {name}</p>
      <p className="mt-1 text-muted-foreground">
        Every answer and document is saved under {name}&rsquo;s name as well as the family&rsquo;s. The parent types their own name and signs the agreements themselves.
      </p>
      <form action={finishAssistedRegistration} className="mt-3">
        <Button type="submit" size="sm" variant="outline">Finish and close the form</Button>
      </form>
    </div>
  );
}
