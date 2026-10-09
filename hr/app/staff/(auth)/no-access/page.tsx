import { SignOutButton } from "@/components/staff/sign-out-button";

/**
 * A dead end, not a redirect: a signed-in account with no roles lands here
 * and stays here, rather than looping between pages it cannot open.
 */
export default function NoAccessPage() {
  return (
    <div className="surface p-6 text-sm">
      <h1 className="text-lg font-semibold">Your account has no HR access yet.</h1>
      <p className="mt-2 text-muted-foreground">
        You are signed in, but your account has no HR role. Ask an administrator to give you one (HR
        manager, HR staff, payroll officer or interviewer) under Staff &amp; roles in the admissions
        console.
      </p>
      <div className="mt-4">
        <SignOutButton />
      </div>
    </div>
  );
}
