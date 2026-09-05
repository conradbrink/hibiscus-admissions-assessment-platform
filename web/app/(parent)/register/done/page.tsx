import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/parent/page-header";
import { Button } from "@/components/ui/button";
import { missingDocumentsText } from "@/lib/registration/completeness";
import { registrationForSession } from "@/lib/registration/session";

export const metadata: Metadata = { title: "Registration submitted" };

export default async function DonePage() {
  const { graph, bundle } = await registrationForSession();
  const missing = missingDocumentsText(bundle.completeness);
  const complete = graph.application.status === "registration_complete" || graph.application.status === "enrolled";
  return (
    <>
      <PageHeader eyebrow="Registration" title={complete ? "Thank you — registration is complete" : "Thank you — almost there"} />
      {complete ? (
        <section className="rounded-2xl bg-success/10 p-5 text-sm">
          <p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="size-4 text-success" aria-hidden /> Nothing more to do right now.</p>
          <p className="mt-1 text-muted-foreground">The school will check the documents and confirm {graph.application.child_first_name}&rsquo;s enrolment by email.</p>
        </section>
      ) : (
        <section className="rounded-2xl bg-warning/20 p-5 text-sm">
          <p className="font-semibold">Still needed: {missing ?? "a few details"}.</p>
          <p className="mt-1">We have saved everything you entered. Enrolment is confirmed once the required documents are in.</p>
          <div className="mt-4"><Button size="parent" nativeButton={false} render={<Link href="/register/documents" />}>Add documents</Button></div>
        </section>
      )}
      <p className="mt-6 text-sm"><Link href="/next" className="font-medium text-primary underline underline-offset-2">Back to your application</Link></p>
    </>
  );
}
