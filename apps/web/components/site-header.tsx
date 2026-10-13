'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Sparkles,
  History,
  Wand2,
  BookmarkCheck,
  Store,
  LogIn,
  LogOut,
  Home,
  HelpCircle,
  BookOpen,
  UserCheck,
  Menu,
  X,
  ArrowRight,
  ArrowLeft,
  BarChart3,
  CreditCard,
  QrCode,
  LayoutDashboard,
  LifeBuoy,
} from 'lucide-react';
import { tryOnApi } from '@/lib/api-client';
import {
  clearStoredAuthSession,
  isBrowserAuthenticated,
} from '@/lib/job-history';
import {
  PUBLIC_PRIMARY_NAV,
  CUSTOMER_PRIMARY_NAV,
  PARTNER_PORTAL_TABS,
  resolveNavigationContext,
  isNavItemActive,
  resolvePartnerTab,
  buildPersonalTryOnHref,
  type NavigationContext,
  type PartnerPortalTabId,
} from '@/lib/navigation';
import { cn } from '@/lib/utils';

const NAV_ICONS: Record<string, typeof Home> = {
  '/': Home,
  '/how-it-works': BookOpen,
  '/partner': Store,
  '/help': HelpCircle,
  '/try-on': Wand2,
  '/my-wardrobe': BookmarkCheck,
  '/history': History,
  '/account': UserCheck,
};

const PARTNER_TAB_ICONS: Record<PartnerPortalTabId, typeof LayoutDashboard> = {
  overview: LayoutDashboard,
  usage: BarChart3,
  subscription: CreditCard,
  setup: QrCode,
  support: LifeBuoy,
};

export interface SiteHeaderProps {
  contextOverride?: NavigationContext;
  storeId?: string | null;
  storeName?: string | null;
  subcategory?: string | null;
  activePartnerTab?: PartnerPortalTabId;
  onSelectPartnerTab?: (tab: PartnerPortalTabId) => void;
}

export function SiteHeader({
  contextOverride,
  storeId: storeIdProp,
  storeName,
  subcategory,
  activePartnerTab: activePartnerTabProp,
  onSelectPartnerTab,
}: SiteHeaderProps = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [urlStoreId, setUrlStoreId] = useState<string | null>(null);
  const [urlPartnerTab, setUrlPartnerTab] = useState<PartnerPortalTabId>('overview');

  useEffect(() => {
    setIsAuthenticated(isBrowserAuthenticated());
    setMobileMenuOpen(false);
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      setUrlStoreId(params.get('storeId'));
      setUrlPartnerTab(resolvePartnerTab(params.get('tab')));
    }
  }, [pathname]);

  const effectiveStoreId = storeIdProp !== undefined ? storeIdProp : urlStoreId;
  const effectivePartnerTab = activePartnerTabProp ?? urlPartnerTab;

  const navContext =
    contextOverride ??
    resolveNavigationContext({
      pathname,
      isAuthenticated,
      storeId: effectiveStoreId,
    });

  const handleLogout = async () => {
    try {
      await tryOnApi.logout();
    } catch {
      // Proceed with local cleanup even if network call fails
    }
    clearStoredAuthSession();
    setIsAuthenticated(false);
    setMobileMenuOpen(false);
    router.push('/');
    router.refresh();
  };

  const handlePartnerTabClick = (tabId: PartnerPortalTabId) => {
    setUrlPartnerTab(tabId);
    setMobileMenuOpen(false);
    if (onSelectPartnerTab) {
      onSelectPartnerTab(tabId);
    } else {
      router.push(`/partner?tab=${tabId}`);
    }
  };

  // 1. Focused Store-Sponsored QR Try-On Header
  if (navContext === 'sponsored-tryon') {
    const personalHref = buildPersonalTryOnHref({ subcategory });
    return (
      <header
        data-testid="sponsored-tryon-header"
        className="sticky top-0 z-40 border-b border-emerald-900/50 bg-neutral-950/95 backdrop-blur-md"
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <Link href="/" className="group flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-600 to-teal-600 text-white shadow-md">
                <Store className="h-4 w-4" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-bold tracking-tight text-white">
                  WearMe <span className="font-normal text-emerald-300">In-Store Fitting</span>
                </span>
                <span className="text-[11px] font-medium text-neutral-400">
                  {storeName ? `Sponsored by ${storeName}` : `Boutique QR Session (${effectiveStoreId})`}
                </span>
              </div>
            </Link>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={personalHref}
              data-testid="header-switch-personal-button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:border-violet-600/60 hover:bg-neutral-800 hover:text-white"
            >
              <Wand2 className="h-3.5 w-3.5 text-violet-400" />
              <span>Switch to Personal WearMe</span>
            </Link>

            {isAuthenticated ? (
              <Link
                href="/my-wardrobe"
                className="inline-flex items-center gap-1.5 rounded-lg border border-violet-800/60 bg-violet-950/60 px-3 py-1.5 text-xs font-semibold text-violet-200 transition-colors hover:bg-violet-900/60"
              >
                <BookmarkCheck className="h-3.5 w-3.5 text-violet-300" />
                <span>My Wardrobe</span>
              </Link>
            ) : (
              <Link
                href={`/login?next=${encodeURIComponent('/my-wardrobe')}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900/70 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-700 hover:text-white"
              >
                <LogIn className="h-3.5 w-3.5 text-violet-400" />
                <span>Sign In</span>
              </Link>
            )}
          </div>
        </div>
      </header>
    );
  }

  // 2. Partner Portal Header
  if (navContext === 'partner') {
    return (
      <header
        data-testid="partner-portal-header"
        className="sticky top-0 z-40 border-b border-neutral-800/90 bg-neutral-950/95 backdrop-blur-md"
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <Link href="/partner" className="group flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white shadow-md">
                <Store className="h-4 w-4" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold tracking-tight text-white">WearMe</span>
                  <span className="rounded border border-violet-700/60 bg-violet-950/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-300">
                    Partner Portal
                  </span>
                </div>
                <span className="text-[10px] font-medium uppercase tracking-widest text-neutral-400">
                  Boutique Sponsorship & Quota Console
                </span>
              </div>
            </Link>
          </div>

          <nav
            className="hidden items-center gap-1 lg:flex"
            aria-label="Partner portal navigation"
          >
            {PARTNER_PORTAL_TABS.map((tab) => {
              const Icon = PARTNER_TAB_ICONS[tab.id];
              const active = effectivePartnerTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handlePartnerTabClick(tab.id)}
                  data-testid={`partner-nav-tab-${tab.id}`}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors',
                    active
                      ? 'border border-violet-700/60 bg-violet-950/70 text-violet-200'
                      : 'text-neutral-300 hover:bg-neutral-900 hover:text-white',
                  )}
                >
                  <Icon className="h-3.5 w-3.5 text-violet-400" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-700 hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5 text-neutral-400" />
              <span>Public Site</span>
            </Link>

            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-expanded={mobileMenuOpen}
              aria-label="Toggle partner navigation menu"
              className="inline-flex items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 p-2 text-neutral-300 hover:bg-neutral-800 hover:text-white lg:hidden"
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="border-t border-neutral-800 bg-neutral-950 px-4 py-3 lg:hidden">
            <nav className="flex flex-col gap-1" aria-label="Mobile partner navigation">
              {PARTNER_PORTAL_TABS.map((tab) => {
                const Icon = PARTNER_TAB_ICONS[tab.id];
                const active = effectivePartnerTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => handlePartnerTabClick(tab.id)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium',
                      active
                        ? 'bg-violet-950/70 text-violet-200'
                        : 'text-neutral-300 hover:bg-neutral-900 hover:text-white',
                    )}
                  >
                    <Icon className="h-4 w-4 text-violet-400" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        )}
      </header>
    );
  }

  // 3. Focused Auth Header (/login)
  if (navContext === 'auth') {
    return (
      <header
        data-testid="auth-header"
        className="sticky top-0 z-40 border-b border-neutral-800/80 bg-neutral-950/90 backdrop-blur-md"
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 md:px-6">
          <Link href="/" className="group flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white shadow-md">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-base font-bold tracking-tight text-white">WearMe</span>
              <span className="text-[10px] font-medium uppercase tracking-widest text-neutral-400">
                Secure OTP Verification
              </span>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-700 hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5 text-violet-400" />
              <span>Back to Home</span>
            </Link>
            <Link
              href="/help"
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-700 hover:text-white"
            >
              <HelpCircle className="h-3.5 w-3.5 text-violet-400" />
              <span>Help</span>
            </Link>
          </div>
        </div>
      </header>
    );
  }

  // 4. Customer App Header vs. 5. Public Website Header
  const isCustomerContext = navContext === 'customer';
  const primaryNavItems = isCustomerContext ? CUSTOMER_PRIMARY_NAV : PUBLIC_PRIMARY_NAV;

  return (
    <header
      data-testid={isCustomerContext ? 'customer-app-header' : 'public-site-header'}
      className="sticky top-0 z-40 border-b border-neutral-800/80 bg-neutral-950/90 backdrop-blur-md"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 md:px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white shadow-md shadow-violet-950/50">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-base font-bold tracking-tight text-white transition-colors group-hover:text-violet-300">
              WearMe
            </span>
            <span className="text-[10px] font-medium uppercase tracking-widest text-neutral-400">
              {isCustomerContext ? 'Personal Wardrobe & Try-On' : 'Virtual Try-On Platform'}
            </span>
          </div>
        </Link>

        <nav
          className="hidden items-center gap-1 lg:flex"
          aria-label={isCustomerContext ? 'Customer navigation' : 'Main navigation'}
        >
          {primaryNavItems.map((item) => {
            const Icon = NAV_ICONS[item.href] || Sparkles;
            const active = isNavItemActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors xl:text-sm',
                  active
                    ? 'border border-violet-800/60 bg-violet-950/60 text-violet-200'
                    : item.isPrimaryAction
                      ? 'border border-violet-900/40 bg-violet-950/30 text-violet-200 hover:bg-violet-950/60 hover:text-white'
                      : 'text-neutral-300 hover:bg-neutral-900 hover:text-white',
                )}
              >
                <Icon className="h-3.5 w-3.5 text-violet-400/90" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Right Action Area: Context-disciplined with zero duplicate destinations */}
        <div className="flex items-center gap-2">
          {isCustomerContext ? (
            <>
              <Link
                href="/help"
                className="hidden items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900/80 px-2.5 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-700 hover:text-white sm:inline-flex"
              >
                <HelpCircle className="h-3.5 w-3.5 text-violet-400" />
                <span>Help</span>
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                data-testid="header-logout-button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-700 hover:bg-neutral-800 hover:text-white"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sign Out</span>
              </button>
            </>
          ) : isAuthenticated ? (
            <>
              <Link
                href="/my-wardrobe"
                className="hidden items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-medium text-neutral-200 transition-colors hover:border-violet-700/60 hover:text-white sm:inline-flex"
              >
                <BookmarkCheck className="h-3.5 w-3.5 text-violet-400" />
                <span>My Wardrobe</span>
              </Link>
              <Link
                href="/try-on"
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-violet-950 transition-colors hover:bg-violet-500"
              >
                <Wand2 className="h-3.5 w-3.5" />
                <span>Open Try-On</span>
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                data-testid="header-logout-button"
                className="hidden items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-2 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-700 hover:bg-neutral-800 hover:text-white md:inline-flex"
                title="Sign Out"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="sr-only">Sign Out</span>
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900/90 px-3 py-2 text-xs font-semibold text-neutral-200 transition-colors hover:border-neutral-700 hover:bg-neutral-800 hover:text-white"
              >
                <LogIn className="h-3.5 w-3.5 text-violet-400" />
                <span>Sign In</span>
              </Link>
              <Link
                href="/try-on"
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-violet-950 transition-colors hover:bg-violet-500"
              >
                <span>Start Try-On</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </>
          )}

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-expanded={mobileMenuOpen}
            aria-label="Toggle navigation menu"
            className="inline-flex items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 p-2 text-neutral-300 hover:bg-neutral-800 hover:text-white lg:hidden"
          >
            {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Context-disciplined Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="border-t border-neutral-800 bg-neutral-950 px-4 py-4 lg:hidden">
          <nav className="flex flex-col gap-1.5" aria-label="Mobile navigation">
            {primaryNavItems.map((item) => {
              const Icon = NAV_ICONS[item.href] || Sparkles;
              const active = isNavItemActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium',
                    active
                      ? 'bg-violet-950/60 text-violet-200'
                      : 'text-neutral-200 hover:bg-neutral-900 hover:text-white',
                  )}
                >
                  <Icon className="h-4 w-4 text-violet-400" />
                  <span>{item.label}</span>
                </Link>
              );
            })}

            {isCustomerContext && (
              <div className="mt-2 flex items-center justify-between border-t border-neutral-800 pt-3">
                <Link
                  href="/"
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-xs font-medium text-neutral-400 hover:text-white"
                >
                  ← Public Website
                </Link>
                <Link
                  href="/help"
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-xs font-medium text-violet-300 hover:text-violet-200"
                >
                  Help & Support
                </Link>
              </div>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
