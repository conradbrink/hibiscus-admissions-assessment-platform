import Link from "next/link";
import { PageHeader } from "@/components/parent/page-header";

export default function ParentNotFound() {
  return (
    <>
      <PageHeader title="That page does not exist." description="The link may have been copied incorrectly." />
      <p className="text-sm">
        <Link href="/join" className="font-medium text-primary underline underline-offset-2">
          Go to the start
        </Link>
      </p>
    </>
  );
}
