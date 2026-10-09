/**
 * The careers page's words. Kept in one file so the school can review and
 * change them in one place. See docs/hr/OBJECTIONS.md for why each answer is
 * here. Anything marked `confirm: true` is wording the school must check
 * before the page goes live; the page shows it as written.
 */

export const CAREERS_HERO = {
  title: "Teach at Hibiscus",
  lead: "Pre-school, primary and secondary teaching posts at our schools in Gaborone and Potchefstroom. Read the post, check what you need, and apply in your own words.",
  start: "Start in one minute. Save as you go. Come back any time.",
};

export const PROCESS_STEPS = [
  { title: "Apply online", detail: "About 40 minutes, and you can stop and come back with the link we email you." },
  { title: "We contact your referees", detail: "They get one short form. It takes them about four minutes." },
  { title: "We read every application", detail: "Each one is scored the same way, then a person decides who to meet." },
  { title: "Interview", detail: "If you are shortlisted, we invite you to meet us. You get an email at every step." },
] as const;

export const BEFORE_YOU_START = [
  "Your CV, as a PDF or a clear photo",
  "Your SACE or BTPC registration number, if you have one",
  "The date on your police clearance, if you have one",
  "The names and email addresses of two or three referees",
  "About 40 minutes for the written questions",
] as const;

export const FAQ: ReadonlyArray<{ q: string; a: string; confirm?: boolean }> = [
  {
    q: "Do you read every application?",
    a: "Yes. Every application is scored against the same qualities, and a person reads it before deciding who to interview. You get an email when we receive it and when we decide.",
  },
  {
    q: "I am not registered with SACE or BTPC yet. Can I still apply?",
    a: "Yes. Tell us where you are in the process. We will ask for proof of registration before you start work.",
  },
  {
    q: "I need a work permit. Can I apply?",
    a: "Yes. Tell us about your permit in the application. If you do not have one yet, say so. We will talk about it with you if you are shortlisted.",
    confirm: true,
  },
  {
    q: "English is not my first language. Will that count against me?",
    a: "No. We mark what your answers show about teaching, not small grammar mistakes. Write in your own words.",
  },
  {
    q: "Can I use ChatGPT or another AI tool to write my answers?",
    a: "Please do not. We check every answer for AI-written text. A person looks at anything flagged, and we may ask you about it in your interview. Nobody is rejected by a computer.",
  },
  {
    q: "What does the post pay?",
    a: "Where we can, the vacancy says. Otherwise we discuss pay and benefits at interview.",
    confirm: true,
  },
  {
    q: "What happens to my information?",
    a: "Only our Human Resources team sees it. If you are not appointed, we delete your application after 12 months, or keep it for 24 months if you ask us to contact you about future posts.",
  },
];
