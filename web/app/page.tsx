import { redirect } from "next/navigation";

// The root of the admissions site is the front door.
export default function RootPage() {
  redirect("/join");
}
