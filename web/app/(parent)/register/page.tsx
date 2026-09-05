import { redirect } from "next/navigation";
import { nextStep } from "@/lib/registration/completeness";
import { registrationForSession } from "@/lib/registration/session";

/** Lands on the first step still to do; after submission, on the review page. */
export default async function RegisterIndex() {
  const { bundle, editable } = await registrationForSession();
  redirect(editable ? `/register/${nextStep(bundle.completeness)}` : "/register/review");
}
