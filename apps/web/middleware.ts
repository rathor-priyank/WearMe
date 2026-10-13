import { NextResponse, type NextRequest } from 'next/server';

const AUTH_COOKIE_NAME = 'wearme_auth_token_v1';
const LOGGED_IN_COOKIE_NAME = 'wearme_logged_in_v1';
const SAFE_AUTH_TOKEN_REGEX = /^wm_auth_[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)?$/;
const SAFE_STORE_ID_REGEX = /^[a-zA-Z0-9_-]{2,64}$/;

function isSafeInternalPath(candidate: string | null): candidate is string {
  if (!candidate) return false;
  return candidate.startsWith('/') && !candidate.startsWith('//');
}

/**
 * WearMe Enterprise Route Segregation & Zero-Friction Boutique QR Middleware.
 *
 * - Public Business & Trust Routes:
 *   `/`, `/about`, `/how-it-works`, `/partner`, `/contact`, `/help`, `/faq`,
 *   `/privacy`, `/terms`, `/security`, `/categories`, `/login`
 * - Zero-Friction Boutique QR Exception:
 *   `/try-on?storeId=<validStoreId>` is allowed anonymously so walk-in boutique shoppers
 *   scanning a physical store or hanger QR are never blocked by a login screen.
 * - Protected Private App Routes:
 *   `/my-wardrobe`, `/history`, `/account`, and standalone `/try-on` (without `storeId`)
 *   require authentication (`wearme_auth_token_v1` HttpOnly cookie or `wearme_logged_in_v1=1`)
 *   or redirect to `/login?next=...`.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const rawToken = request.cookies.get(AUTH_COOKIE_NAME)?.value?.trim() ?? '';
  const loggedInFlag = request.cookies.get(LOGGED_IN_COOKIE_NAME)?.value?.trim() ?? '';
  const isAuthenticated = Boolean(
    (rawToken && SAFE_AUTH_TOKEN_REGEX.test(rawToken)) || loggedInFlag === '1',
  );

  // 1. Handle `/login`: redirect already-authenticated users to `?next=` or `/my-wardrobe`
  if (pathname === '/login' || pathname.startsWith('/login/')) {
    const forceSwitch = request.nextUrl.searchParams.get('switch') === '1';
    if (isAuthenticated && !forceSwitch) {
      const nextParam = request.nextUrl.searchParams.get('next');
      const targetPath = isSafeInternalPath(nextParam) ? nextParam : '/my-wardrobe';
      return NextResponse.redirect(new URL(targetPath, request.url));
    }
    return NextResponse.next();
  }

  // 2. Zero-Friction Boutique QR Exception on `/try-on?storeId=<validStoreId>`
  if (pathname === '/try-on' || pathname.startsWith('/try-on/')) {
    const storeId = request.nextUrl.searchParams.get('storeId')?.trim() ?? '';
    if (SAFE_STORE_ID_REGEX.test(storeId)) {
      return NextResponse.next();
    }
  }

  // 3. Enforce authentication on protected private app routes (`/my-wardrobe`, `/history`, `/account`, standalone `/try-on`)
  if (!isAuthenticated) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/my-wardrobe/:path*',
    '/history/:path*',
    '/account/:path*',
    '/try-on/:path*',
    '/login',
  ],
};

