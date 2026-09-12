import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  canAccessPath,
  homeFor,
  matchesPrefix,
  toPermissionSet,
} from "@/lib/permissions";
import { contentSecurityPolicy, newNonce } from "@/lib/security-headers";
import { mfaOutcome, mfaPathAllowed, mfaRedirectPath } from "@/lib/staff/mfa";

/**
 * Two jobs, and they have different scopes.
 *
 * **Every** HTML request gets a Content-Security-Policy carrying a fresh
 * nonce. The nonce goes into the *request* headers as well, because that is
 * how Next is told to stamp it onto the scripts it injects, and into `x-nonce`
 * for the one route that writes its own inline script (the payment gateway
 * bridge).
 *
 * **Only** `/staff` gets the session refresh and the path authorisation.
 * Parent pages are deliberately outside that: they have no Supabase session
 * to refresh, and a `getUser()` round trip on every parent page load would
 * slow the one part of the product where speed is the whole point. Parent
 * access is checked by `lib/tokens` inside each route.
 *
 * The matcher below therefore covers everything except the static assets,
 * where a policy would be noise, and `/api`, whose route handlers return
 * JSON, authenticate themselves and must never meet the redirect below.
 */
export async function proxy(request: NextRequest) {
  const nonce = newNonce();
  const csp = contentSecurityPolicy(process.env, { nonce });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next reads the policy from the request to find the nonce to stamp.
  requestHeaders.set("Content-Security-Policy", csp);

  const withPolicy = <T extends NextResponse>(res: T): T => {
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };

  let response = withPolicy(NextResponse.next({ request: { headers: requestHeaders } }));

  // Everything below is the staff console's. A parent page has its policy and
  // is on its way.
  const staffPath = request.nextUrl.pathname === "/staff" || request.nextUrl.pathname.startsWith("/staff/");
  if (!staffPath) return response;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = withPolicy(NextResponse.next({ request: { headers: requestHeaders } }));
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isLoginPage = matchesPrefix(pathname, "/staff/login");
  // /staff/reset-password carries a recovery session established by the
  // emailed link, so it must be exempt from the permission check below or a
  // member of staff who forgot their password is bounced before they can set
  // a new one.
  const isPasswordResetPage =
    matchesPrefix(pathname, "/staff/forgot-password") ||
    matchesPrefix(pathname, "/staff/reset-password");

  if (!user && !isLoginPage && !isPasswordResetPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/staff/login";
    url.search = "";
    return withPolicy(NextResponse.redirect(url));
  }

  if (user && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/staff";
    url.search = "";
    return withPolicy(NextResponse.redirect(url));
  }

  // The second factor comes before permissions, and before the path check.
  //
  // Ordering matters twice over. Somebody who still owes a code has not
  // finished signing in, so telling them what they may not open answers the
  // wrong question. And the verify screen has to be reachable while every
  // other page is not, which only works if this runs before `canAccessPath`.
  //
  // A verdict that cannot be reached is answered the way a failed permission
  // read is a few lines below: 503 and reload. Never a redirect to the verify
  // screen -- somebody with no factor would be stranded there, asked for a
  // code no app can produce.
  if (user && !isLoginPage && !isPasswordResetPage) {
    const { data: settingRow, error: settingError } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "staff_mfa_required")
      .maybeSingle();
    // `nextLevel` is aal2 exactly when the session carries a verified factor,
    // read from the session rather than fetched, so this adds no round trip to
    // the auth server on every single page load.
    const { data: levels, error: levelError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (settingError || levelError) {
      return withPolicy(
        new NextResponse("Could not check your sign-in just now. Reload in a moment.", { status: 503 })
      );
    }

    const outcome = mfaOutcome({
      hasVerifiedFactor: levels?.nextLevel === "aal2",
      currentLevel: (levels?.currentLevel ?? null) as "aal1" | "aal2" | null,
      requiredBySchool: settingRow?.value === true,
    });

    if (!mfaPathAllowed(outcome, pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = mfaRedirectPath(outcome);
      url.search = "";
      return withPolicy(NextResponse.redirect(url));
    }
  }

  if (user && !isLoginPage && !isPasswordResetPage) {
    const { data: granted, error: permissionError } = await supabase.rpc(
      "my_permissions"
    );

    // A query that failed is not the same fact as a person with no
    // permissions. Falling through to "nothing" on a timeout would strand an
    // administrator on the no-access page looking like a broken account.
    if (permissionError) {
      return withPolicy(
        new NextResponse("Could not check your access just now. Reload in a moment.", { status: 503 })
      );
    }

    const permissions = toPermissionSet(granted as string[] | null);

    if (!canAccessPath(permissions, pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = homeFor(permissions);
      url.search = "";
      // Guard against a home that is itself refused, which would loop.
      if (url.pathname === pathname) return response;
      return withPolicy(NextResponse.redirect(url));
    }
  }

  return response;
}

export const config = {
  // Everything that is a document, because every document needs the policy.
  // Not the static assets — a policy on a chunk is noise — and not `/api`,
  // whose route handlers return JSON, authenticate themselves and would be
  // wrecked by the redirect above replaying a POST against the login page.
  matcher: ["/((?!_next/static|_next/image|api/|favicon.ico|icon.png|apple-icon.png).*)"],
};
