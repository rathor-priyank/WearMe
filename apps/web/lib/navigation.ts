export type NavigationContext =
  | 'public'
  | 'customer'
  | 'sponsored-tryon'
  | 'partner'
  | 'auth';

export interface NavItem {
  href: string;
  label: string;
  description?: string;
  isPrimaryAction?: boolean;
}

export type PartnerPortalTabId =
  | 'overview'
  | 'usage'
  | 'subscription'
  | 'setup'
  | 'support';

export interface PartnerPortalTab {
  id: PartnerPortalTabId;
  label: string;
  href: string;
  description: string;
}

/**
 * Public Website primary navigation.
 * Strictly limited to 4 top-level destinations so visitors are never overwhelmed.
 * Secondary trust, legal, category, and support pages live in the footer and contextual links.
 */
export const PUBLIC_PRIMARY_NAV: readonly NavItem[] = [
  { href: '/', label: 'Home', description: 'Platform overview' },
  { href: '/how-it-works', label: 'How It Works', description: 'In-store QR & online flows' },
  { href: '/partner', label: 'For Boutiques', description: 'Store partner portal & plans' },
  { href: '/help', label: 'Help', description: 'Guides & FAQ' },
] as const;

/**
 * Authenticated Customer Application primary navigation.
 * Strictly limited to the 4 customer destinations with zero partner/marketing clutter.
 */
export const CUSTOMER_PRIMARY_NAV: readonly NavItem[] = [
  { href: '/try-on', label: 'Try On', description: 'Virtual fitting studio', isPrimaryAction: true },
  { href: '/my-wardrobe', label: 'My Wardrobe', description: 'Saved portrait & looks' },
  { href: '/history', label: 'My Activity', description: 'Recent try-on jobs' },
  { href: '/account', label: 'Account', description: 'Privacy & account settings' },
] as const;

/**
 * Partner Portal structured navigation tabs.
 */
export const PARTNER_PORTAL_TABS: readonly PartnerPortalTab[] = [
  {
    id: 'overview',
    label: 'Overview',
    href: '/partner?tab=overview',
    description: 'Store status, active plan summary, and quick actions',
  },
  {
    id: 'usage',
    label: 'Usage & Credits',
    href: '/partner?tab=usage',
    description: 'Atomic credit ledger, reserved vs. consumed credits, and session telemetry',
  },
  {
    id: 'subscription',
    label: 'Subscription',
    href: '/partner?tab=subscription',
    description: 'Plan tier comparison, billing cycle window, and overage protection',
  },
  {
    id: 'setup',
    label: 'QR & Store Setup',
    href: '/partner?tab=setup',
    description: 'In-store QR URL generator, session expiry rules, and walk-in demo',
  },
  {
    id: 'support',
    label: 'Help / Support',
    href: '/partner?tab=support',
    description: 'Shopkeeper privacy boundaries, onboarding assistance, and partner support',
  },
] as const;

/**
 * Footer navigation groups — authoritative home for secondary informational, legal, and support links.
 */
export const FOOTER_NAV_GROUPS = {
  product: [
    { href: '/how-it-works', label: 'How It Works' },
    { href: '/categories', label: 'Supported Categories (38)' },
    { href: '/try-on', label: 'Personal Try-On Studio' },
    { href: '/my-wardrobe', label: 'My Digital Wardrobe' },
  ],
  partners: [
    { href: '/partner', label: 'Partner Overview' },
    { href: '/partner?tab=subscription', label: 'Boutique Subscription Plans' },
    { href: '/partner?tab=setup', label: 'In-Store QR Setup' },
    { href: '/contact?topic=partner', label: 'Partner Onboarding Inquiry' },
  ],
  supportAndCompany: [
    { href: '/about', label: 'About WearMe' },
    { href: '/help', label: 'Help Center & Guides' },
    { href: '/help#faq', label: 'Frequently Asked Questions' },
    { href: '/contact', label: 'Contact Support' },
  ],
  privacyAndLegal: [
    { href: '/security', label: 'Security Architecture' },
    { href: '/privacy', label: 'Privacy Policy' },
    { href: '/terms', label: 'Terms of Service' },
    { href: '/account', label: 'Data & Portrait Controls' },
  ],
} as const;

const CUSTOMER_APP_PREFIXES = ['/try-on', '/my-wardrobe', '/history', '/account'];

/**
 * Determines which navigation context is active for the current route and session state.
 */
export function resolveNavigationContext(params: {
  pathname: string | null | undefined;
  isAuthenticated: boolean;
  storeId?: string | null;
}): NavigationContext {
  const pathname = params.pathname || '/';

  if (pathname === '/login' || pathname.startsWith('/login/')) {
    return 'auth';
  }

  if (pathname === '/partner' || pathname.startsWith('/partner/')) {
    return 'partner';
  }

  const trimmedStoreId = params.storeId?.trim();
  if ((pathname === '/try-on' || pathname.startsWith('/try-on/')) && trimmedStoreId) {
    return 'sponsored-tryon';
  }

  const isCustomerRoute = CUSTOMER_APP_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isCustomerRoute && params.isAuthenticated) {
    return 'customer';
  }

  return 'public';
}

/**
 * Checks whether a primary navigation item is active for the given pathname.
 */
export function isNavItemActive(pathname: string | null | undefined, itemHref: string): boolean {
  const current = pathname || '/';
  if (itemHref === '/') {
    return current === '/';
  }
  const cleanHref = itemHref.split('?')[0]?.split('#')[0] || itemHref;
  return current === cleanHref || current.startsWith(`${cleanHref}/`);
}

/**
 * Resolves a valid PartnerPortalTabId from a raw query parameter.
 */
export function resolvePartnerTab(rawTab: string | null | undefined): PartnerPortalTabId {
  const normalized = rawTab?.trim().toLowerCase();
  const matched = PARTNER_PORTAL_TABS.find((tab) => tab.id === normalized);
  return matched ? matched.id : 'overview';
}

/**
 * Builds the canonical URL for switching from a store-sponsored QR session to Personal WearMe.
 * Explicitly strips `storeId` so store sponsorship is never carried into personal mode,
 * while preserving safe non-billing parameters such as `subcategory`.
 */
export function buildPersonalTryOnHref(params?: {
  subcategory?: string | null;
}): string {
  const search = new URLSearchParams();
  if (params?.subcategory?.trim()) {
    search.set('subcategory', params.subcategory.trim());
  }
  const query = search.toString();
  return query ? `/try-on?${query}` : '/try-on';
}

