import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** No scores, no verdict. The child tells the teacher they have finished. */
export default function DonePage() {
  return (
    <div className="mx-auto max-w-md text-center">
      <CheckCircle2 className="mx-auto size-16 text-success" aria-hidden />
      <h1 className="mt-4 text-3xl font-bold tracking-tight">All done — well done!</h1>
      <p className="mt-2 text-base text-muted-foreground">Your answers have been handed in. Please tell your teacher you have finished.</p>
      <div className="mt-8">
        <Button size="parent" variant="outline" nativeButton={false} render={<Link href="/sit" />}>
          Ready for the next child
        </Button>
      </div>
    </div>
  );
}
