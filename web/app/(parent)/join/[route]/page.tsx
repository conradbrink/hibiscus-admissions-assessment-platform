import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EnquiryForm } from "@/components/parent/enquiry-form";
import { PageHeader, StepIndicator } from "@/components/parent/page-header";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadCatalogue } from "@/lib/enquiry";
import { codedPromotionLive } from "@/lib/promotions/load";
import type { EntryRoute } from "@/lib/supabase/types";
import { submitEnquiry } from "../actions";

const ROUTES: Record<string, { entry: EntryRoute; title: string; description: string; steps: number }> = {
  assessment: {
    entry: "assessment",
    title: "Book an assessment",
    description: "For children joining Reception to Form 5. Eight quick details, then choose a date. About two minutes. A younger child is offered a visit instead.",
    steps: 3,
  },
  visit: {
    entry: "visit",
    title: "Book a school visit",
    description: "For any age; Nursery to Pre-Reception begin here. Eight quick details, then choose a time to come and see us.",
    steps: 3,
  },
  call: {
    entry: "callback",
    title: "Request a call",
    description: "Tell us who to call and we will phone you within a working day.",
    steps: 1,
  },
};

export async function generateMetadata({ params }: { params: Promise<{ route: string }> }): Promise<Metadata> {
  const { route } = await params;
  return { title: ROUTES[route]?.title ?? "Join" };
}

export default async function JoinRoutePage({ params }: { params: Promise<{ route: string }> }) {
  const { route } = await params;
  const config = ROUTES[route];
  if (!config) notFound();

  const admin = createAdminClient();
  const [catalogue, promoCodesLive] = await Promise.all([loadCatalogue(admin), codedPromotionLive(admin)]);
  const action = submitEnquiry.bind(null, config.entry);

  return (
    <>
      <StepIndicator step={1} total={config.steps} />
      <PageHeader title={config.title} description={config.description} />
      <EnquiryForm
        route={config.entry}
        campuses={catalogue.campuses.map((c) => ({ id: c.id, name: c.name, descriptor: c.descriptor }))}
        promoCodesLive={promoCodesLive}
        action={action}
      />
    </>
  );
}
