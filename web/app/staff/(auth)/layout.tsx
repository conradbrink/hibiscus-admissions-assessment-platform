import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-1">
          <Logo className="h-12 w-auto" />
          <p className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Admissions</p>
        </div>
        {children}
      </div>
    </div>
  );
}
