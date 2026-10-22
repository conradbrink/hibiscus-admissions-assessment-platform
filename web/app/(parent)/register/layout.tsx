import { AssistedBanner } from "@/components/parent/register/assisted-banner";

/** Every registration step, with the notice that says when the school has the form open. */
export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AssistedBanner />
      {children}
    </>
  );
}
