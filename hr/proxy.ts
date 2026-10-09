import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { canAccessPath, homeFor, matchesPrefix, toPermissionSet } from "@/lib/permissions";
import { contentSecurityPolicy, newNonce } from "@/lib/security-headers";
import { mfaOutcome, mfaPathAllowed, mfaRedirectPath } from "@/lib/staff/mfa";
import { isStaffPublicPath } from "@/lib/staff/public-paths";

/**
 * Two jobs, the same two as the admissions proxy.
 *
 * Every HTML request gets a Content-Security-Policy with a fresh nonce.
 *
 * Only `/staff` gets the session refresh, the second-factor check and the
 * path authorisation. Applicant and referee pages have no Supabase session;
 * their cookie is checked by `lib/tokens` inside each route. `/api` is left
 * out: its handlers authenticate themselves and must never meet a redirect.
 */
export async function proxy(request: NextRequest) {
  const nonce = newNonce();
  const csp = contentSecurityPolicy(process.env, { nonce });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const withPolicy = <T extends NextResponse>(res: T): T => {
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };

  let response = withPolicy(NextResponse.next({ request: { headers: requestHeaders } }));
  const { pathname } = request.nextUrl;
  if (pathname !== "/staff" && !pathname.startsWith("/staff/")) return response;

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = withPolicy(NextResponse.next({ request: { headers: requestHeaders } }));
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    return withPolicy(NextResponse.redirect(url));
  };

  if (!user && !isStaffPublicPath(pathname)) return redirectTo("/staff/login");
  if (user && matchesPrefix(pathname, "/staff/login")) return redirectTo("/staff");
  if (!user || isStaffPublicPath(pathname)) return response;

  // The second factor before permissions: somebody who still owes a code has
  // not finished signing in. A verdict that cannot be reached is a 503, never
  // a redirect to a page they could not leave.
  const { data: settingRow, error: settingError } = await supabase.from("settings").select("value").eq("key", "staff_mfa_required").maybeSingle();
  const { data: levels, error: levelError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (settingError || levelError) {
    return withPolicy(new NextResponse("Could not check your sign-in just now. Reload in a moment.", { status: 503 }));
  }
  const outcome = mfaOutcome({
    hasVerifiedFactor: levels?.nextLevel === "aal2",
    currentLevel: (levels?.currentLevel ?? null) as "aal1" | "aal2" | null,
    requiredBySchool: settingRow?.value === true,
  });
  if (!mfaPathAllowed(outcome, pathname)) return redirectTo(mfaRedirectPath(outcome));

  const { data: granted, error: permissionError } = await supabase.rpc("my_permissions");
  if (permissionError) {
    return withPolicy(new NextResponse("Could not check your access just now. Reload in a moment.", { status: 503 }));
  }
  const permissions = toPermissionSet(granted as string[] | null);
  if (!canAccessPath(permissions, pathname)) {
    const home = homeFor(permissions);
    if (home === pathname) return response;
    return redirectTo(home);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|api/|favicon.ico|icon.png|apple-icon.png|brand/).*)"],
};
