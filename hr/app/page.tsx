import { redirect } from "next/navigation";

/** The HR site's front door is the vacancy list; staff sign in at /staff. */
export default function Home() {
  redirect("/vacancies");
}
