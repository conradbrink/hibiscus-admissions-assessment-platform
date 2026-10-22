import { PageHeader } from "@/components/parent/page-header";
import { Button } from "@/components/ui/button";

/**
 * The development gateway's screen: three buttons that decide what the dev
 * adapter will report. Shared by the applicant's page at `/pay/dev` and a
 * family's under `/family/extras/pay/<child>/dev`, whose actions differ only
 * in whose payment they write.
 */
export function DevGatewayScreen({ action }: { action: (formData: FormData) => Promise<void> }) {
  return (
    <>
      <div className="mb-6 rounded-2xl border-4 border-dashed border-warning bg-warning/20 p-5">
        <p className="text-lg font-bold">DEVELOPMENT GATEWAY — NOTHING IS CHARGED</p>
        <p className="mt-1 text-sm">This page exists only outside production. Choose what the payment provider should report.</p>
      </div>
      <PageHeader title="Simulate the payment provider" description="On the live site this is the payment provider's own page." />
      <div className="space-y-3">
        <form action={action}><input type="hidden" name="outcome" value="paid" /><Button type="submit" size="parent" variant="success">Simulate a successful payment</Button></form>
        <form action={action}><input type="hidden" name="outcome" value="failed" /><Button type="submit" size="parent" variant="destructive">Simulate a declined payment</Button></form>
        <form action={action}><input type="hidden" name="outcome" value="cancelled" /><Button type="submit" size="parent" variant="outline">Cancel and go back</Button></form>
      </div>
    </>
  );
}
