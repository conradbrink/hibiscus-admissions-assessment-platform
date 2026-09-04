import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  canAccessPath,
  homeFor,
  matchesPrefix,
  toPermissionSet,
} from "@/lib/permissions";

/**
 * Session refresh and path authorisation for the **staff** console.
 *
 * The matcher below is `/staff/:path*` and nothing else. Parent pages are
 * deliberately outside it: they have no Supabase session to refresh, and
 * running a `getUser()` round trip on every parent page load would slow the
 * one part of the product where speed is the whole point. Parent access is
 * checked by `lib/tokens` inside each route.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

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
          response = NextResponse.next({ request });
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
    return NextResponse.redirect(url);
  }

  if (user && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/staff";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (user && !isLoginPage && !isPasswordResetPage) {
    const { data: granted, error: permissionError } = await supabase.rpc(
      "my_permissions"
    );

    // A query that failed is not the same fact as a person with no
    // permissions. Falling through to "nothing" on a timeout would strand an
    // administrator on the no-access page looking like a broken account.
    if (permissionError) {
      return new NextResponse(
        "Could not check your access just now. Reload in a moment.",
        { status: 503 }
      );
    }

    const permissions = toPermissionSet(granted as string[] | null);

    if (!canAccessPath(permissions, pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = homeFor(permissions);
      url.search = "";
      // Guard against a home that is itself refused, which would loop.
      if (url.pathname === pathname) return response;
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  // Route handlers under /api authenticate themselves and return a real 401;
  // a redirect there would replay a POST against the login page.
  matcher: ["/staff/:path*"],
};
