'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  QrCode,
  Store,
  Smartphone,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  ShieldCheck,
  EyeOff,
  BarChart3,
  Clock,
  CreditCard,
  AlertTriangle,
  RefreshCw,
  LayoutDashboard,
  LifeBuoy,
} from 'lucide-react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { ContextualNavBar } from '@/components/contextual-nav';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { tryOnApi } from '@/lib/api-client';
import {
  PARTNER_PORTAL_TABS,
  resolvePartnerTab,
  type PartnerPortalTabId,
} from '@/lib/navigation';
import type { PartnerStoreUsageResponse } from '@wearme/shared';
import { cn } from '@/lib/utils';

const DEMO_STORES = [
  {
    storeId: 'store_indiranagar_01',
    storeName: 'Studio Namma Indiranagar',
    city: 'Bengaluru',
    planName: 'WearMe Premium',
    includedCredits: 1500,
    monthlyPriceInr: 4999,
  },
  {
    storeId: 'store_koramangala_02',
    storeName: 'Studio Koramangala Flagship',
    city: 'Bengaluru',
    planName: 'WearMe Growth',
    includedCredits: 700,
    monthlyPriceInr: 2499,
  },
  {
    storeId: 'store_jayanagar_03',
    storeName: 'Studio Jayanagar Boutique',
    city: 'Bengaluru',
    planName: 'WearMe Growth',
    includedCredits: 700,
    monthlyPriceInr: 2499,
  },
  {
    storeId: 'store_bandra_04',
    storeName: 'Atelier Bandra West',
    city: 'Mumbai',
    planName: 'WearMe Starter',
    includedCredits: 200,
    monthlyPriceInr: 999,
  },
] as const;

const PARTNER_TIERS = [
  {
    name: 'WearMe Starter & Growth (₹999 – ₹2,499/mo)',
    tag: '200 – 700 Sponsored Credits/mo',
    description:
      'Equip your bestselling racks and mirror standees with bounded in-store QR virtual fitting sessions.',
    features: [
      'Bounded 60-minute in-store QR sessions (15-min inactivity timeout)',
      'Shop pays ONLY during active in-store QR sessions—never for at-home usage',
      'Pre-inference atomic quota reservation prevents concurrent credit over-consumption',
      'Failed AI generations are automatically refunded to your store balance',
    ],
  },
  {
    name: 'WearMe Premium Flagship (₹4,999/mo)',
    tag: '1,500 Sponsored Credits/mo',
    description:
      'High-volume store-sponsored try-on allowance with real-time usage ledger and first-touch attribution.',
    features: [
      'Automatic handoff to Personal WearMe after a customer leaves the shop',
      'First-touch originStoreId attribution without ongoing billing liability',
      'Real-time reservation, consumption & refund audit ledger',
      'Strict customer photo & PII isolation (aggregated metrics only)',
    ],
  },
] as const;

const SHOPKEEPER_ALLOWED = [
  'Subscription plan, billing period & remaining sponsored credits',
  'Consumed successful try-ons vs. in-flight reserved credits',
  'Failed AI generation count (refunded automatically; reported separately)',
  'Active vs. expired in-store QR session counts',
  'First-touch wardrobe upgrade attribution counts',
];

const SHOPKEEPER_PROHIBITED = [
  'Customer uploaded portraits or base photos',
  'Customer generated try-on output images',
  'Customer private Digital Wardrobe collections',
  'Customer phone numbers, emails, or OTP codes',
  'Customer personal try-on usage after leaving your store',
];

const TAB_ICONS: Record<PartnerPortalTabId, typeof LayoutDashboard> = {
  overview: LayoutDashboard,
  usage: BarChart3,
  subscription: CreditCard,
  setup: QrCode,
  support: LifeBuoy,
};

const DEV_PARTNER_KEYS: Record<string, string> = {
  store_indiranagar_01: 'wm_partner_indiranagar_01_dev_key',
  store_koramangala_02: 'wm_partner_koramangala_02_dev_key',
  store_jayanagar_03: 'wm_partner_jayanagar_03_dev_key',
  store_bandra_04: 'wm_partner_bandra_04_dev_key',
};

function PartnerPortalContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = resolvePartnerTab(searchParams?.get('tab'));

  const [activeTab, setActiveTab] = useState<PartnerPortalTabId>(initialTab);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('store_indiranagar_01');
  const [partnerApiKey, setPartnerApiKey] = useState<string>('');
  const [isPartnerAuthenticated, setIsPartnerAuthenticated] = useState<boolean>(false);
  const [partnerAuthNotice, setPartnerAuthNotice] = useState<string | null>(null);
  const [partnerAuthError, setPartnerAuthError] = useState<string | null>(null);
  const [isRenewingSub, setIsRenewingSub] = useState<boolean>(false);
  const [issuedQrCheckInPath, setIssuedQrCheckInPath] = useState<string | null>(null);
  const [issuedQrExpiresAt, setIssuedQrExpiresAt] = useState<string | null>(null);
  const [qrSubcategory, setQrSubcategory] = useState<string>('TSHIRT');
  const [usageData, setUsageData] = useState<PartnerStoreUsageResponse | null>(null);
  const [isLoadingUsage, setIsLoadingUsage] = useState<boolean>(false);

  useEffect(() => {
    setActiveTab(resolvePartnerTab(searchParams?.get('tab')));
  }, [searchParams]);

  const handleTabChange = (nextTab: PartnerPortalTabId) => {
    setActiveTab(nextTab);
    router.push(`/partner?tab=${nextTab}`, { scroll: false });
  };

  const loadStoreUsage = useCallback(async (storeId: string, keyOverride?: string) => {
    setIsLoadingUsage(true);
    const effectiveKey =
      keyOverride ??
      (typeof window !== 'undefined'
        ? window.sessionStorage.getItem(`wearme_partner_key_${storeId}`) ?? undefined
        : undefined);
    try {
      const data = await tryOnApi.getPartnerStoreUsage(storeId, effectiveKey);
      setUsageData(data);
      if (effectiveKey) {
        setIsPartnerAuthenticated(true);
      }
    } catch {
      const fallbackStore =
        DEMO_STORES.find((s) => s.storeId === storeId) ?? DEMO_STORES[0];
      const now = new Date();
      const periodEnd = new Date(now.getTime() + 30 * 86400_000);
      setUsageData({
        storeId: fallbackStore.storeId,
        storeName: fallbackStore.storeName,
        subscription: {
          storeId: fallbackStore.storeId,
          storeName: fallbackStore.storeName,
          city: fallbackStore.city,
          storeStatus: 'ACTIVE',
          subscriptionId: `sub_${fallbackStore.storeId}`,
          planId: fallbackStore.includedCredits >= 1500 ? 'PREMIUM' : 'GROWTH',
          planName: fallbackStore.planName,
          monthlyPriceInr: fallbackStore.monthlyPriceInr,
          subscriptionStatus: 'ACTIVE',
          periodStart: now.toISOString(),
          periodEnd: periodEnd.toISOString(),
          includedCredits: fallbackStore.includedCredits,
          consumedCredits: 0,
          reservedCredits: 0,
          remainingCredits: fallbackStore.includedCredits,
          failedGenerationsCount: 0,
          overagePolicy: 'BLOCK',
          quotaExhausted: false,
          lowQuotaWarning: false,
        },
        activeSponsoredSessionsCount: 0,
        expiredSponsoredSessionsCount: 0,
        totalSponsoredTryOnJobs: 0,
        completedSponsoredTryOnJobs: 0,
        failedSponsoredTryOnJobs: 0,
        savedToWardrobeFromStoreCount: 0,
        firstTouchAttributedUsersCount: 0,
        recentLedgerSummary: [],
        privacyNotice:
          'Aggregated store-sponsored usage & billing metrics only. Customer portraits, generated try-on images, phone numbers, emails, and personal wardrobe activity are strictly isolated and inaccessible to shop partners.',
      });
    } finally {
      setIsLoadingUsage(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedKey =
        window.sessionStorage.getItem(`wearme_partner_key_${selectedStoreId}`) ?? '';
      setPartnerApiKey(savedKey);
      setIsPartnerAuthenticated(Boolean(savedKey));
    }
    setPartnerAuthNotice(null);
    setPartnerAuthError(null);
    setIssuedQrCheckInPath(null);
    setIssuedQrExpiresAt(null);
    void loadStoreUsage(selectedStoreId);
  }, [selectedStoreId, loadStoreUsage]);

  const handleAuthenticatePartner = async () => {
    setPartnerAuthError(null);
    setPartnerAuthNotice(null);
    const trimmed = partnerApiKey.trim();
    if (!trimmed) {
      setPartnerAuthError('Enter your boutique Partner API key to authenticate.');
      return;
    }
    try {
      const res = await tryOnApi.authenticatePartnerStore(selectedStoreId, trimmed);
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(`wearme_partner_key_${selectedStoreId}`, trimmed);
      }
      setIsPartnerAuthenticated(true);
      setPartnerAuthNotice(
        `Verified partner credentials for ${res.storeName} (${res.subscriptionStatus}).`,
      );
      await loadStoreUsage(selectedStoreId, trimmed);
    } catch {
      setIsPartnerAuthenticated(false);
      setPartnerAuthError('Invalid Partner API key for the selected store.');
    }
  };

  const handleRenewSubscription = async () => {
    setPartnerAuthError(null);
    setPartnerAuthNotice(null);
    const trimmed =
      partnerApiKey.trim() || DEV_PARTNER_KEYS[selectedStoreId] || '';
    if (!trimmed) {
      setPartnerAuthError('Partner API key is required to authorize subscription renewal.');
      return;
    }
    setIsRenewingSub(true);
    try {
      const renewed = await tryOnApi.renewPartnerStoreSubscription(selectedStoreId, trimmed);
      setPartnerAuthNotice(
        `Subscription renewed for ${renewed.storeName}: ${renewed.remainingCredits.toLocaleString()} credits active until ${new Date(renewed.periodEnd).toLocaleDateString()}.`,
      );
      await loadStoreUsage(selectedStoreId, trimmed);
    } catch {
      setPartnerAuthError(
        'Subscription renewal requires a valid Partner API key for this boutique.',
      );
    } finally {
      setIsRenewingSub(false);
    }
  };

  const handleIssueSignedQrToken = async () => {
    setPartnerAuthError(null);
    const trimmed =
      partnerApiKey.trim() || DEV_PARTNER_KEYS[selectedStoreId] || undefined;
    try {
      const tokenRes = await tryOnApi.issuePartnerStoreQrToken(
        selectedStoreId,
        trimmed,
        300,
      );
      setIssuedQrCheckInPath(
        `${tokenRes.checkInPath}&subcategory=${encodeURIComponent(qrSubcategory)}`,
      );
      setIssuedQrExpiresAt(tokenRes.expiresAt);
    } catch {
      setPartnerAuthError('Authenticate with your Partner API key to issue signed QR check-in tokens.');
    }
  };

  const sub = usageData?.subscription;
  const activeTabMeta =
    PARTNER_PORTAL_TABS.find((t) => t.id === activeTab) ?? {
      id: 'overview' as const,
      label: 'Overview',
      href: '/partner?tab=overview',
      description: 'Store status, active plan summary, and quick actions',
    };

  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-neutral-50">
      <SiteHeader
        contextOverride="partner"
        activePartnerTab={activeTab}
        onSelectPartnerTab={handleTabChange}
      />

      <main className="flex-1 px-4 py-8 sm:px-6 md:py-12">
        <div className="mx-auto max-w-6xl">
          <ContextualNavBar
            backHref="/"
            backLabel="Back to Public Site"
            breadcrumbs={[
              { label: 'Home', href: '/' },
              { label: 'Partner Portal', href: '/partner' },
              { label: activeTabMeta.label },
            ]}
          />

          {/* Partner Console Top Control Bar */}
          <div className="flex flex-col justify-between gap-4 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5 sm:flex-row sm:items-center">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-violet-400">
                <Store className="h-3.5 w-3.5" />
                <span>Boutique Partner Console</span>
              </div>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                {usageData?.storeName ?? 'Studio Namma Indiranagar'}
              </h1>
              <p className="mt-1 text-xs text-neutral-400 sm:text-sm">
                {activeTabMeta.description}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <select
                aria-label="Select partner store"
                value={selectedStoreId}
                onChange={(e) => setSelectedStoreId(e.target.value)}
                className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs font-medium text-neutral-200 focus:border-violet-500 focus:outline-none"
              >
                {DEMO_STORES.map((s) => (
                  <option key={s.storeId} value={s.storeId}>
                    {s.storeName} ({s.city})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void loadStoreUsage(selectedStoreId)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-600 hover:text-white"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', isLoadingUsage && 'animate-spin')} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {/* Partner API Key Authentication Bar (Production & Authorized Actions) */}
          <div
            data-testid="partner-auth-bar"
            className="mt-4 flex flex-col justify-between gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/40 px-4 py-3.5 sm:flex-row sm:items-center"
          >
            <div className="flex items-center gap-2.5 text-xs">
              <ShieldCheck
                className={cn(
                  'h-4 w-4 shrink-0',
                  isPartnerAuthenticated ? 'text-emerald-400' : 'text-violet-400',
                )}
              />
              <div>
                <span className="font-semibold text-neutral-200">
                  {isPartnerAuthenticated
                    ? 'Partner API Key Authenticated'
                    : 'Partner Store Credentials'}
                </span>
                <span className="ml-2 text-neutral-400">
                  Required in production and for authorized subscription renewal &amp; QR token signing.
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="password"
                aria-label="Partner API Key"
                placeholder="Enter x-wearme-partner-key..."
                value={partnerApiKey}
                onChange={(e) => setPartnerApiKey(e.target.value)}
                className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-1.5 font-mono text-xs text-neutral-200 focus:border-violet-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void handleAuthenticatePartner()}
                className="rounded-xl bg-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 transition-colors"
              >
                Verify Key
              </button>
              <button
                type="button"
                onClick={() => {
                  const demoKey = DEV_PARTNER_KEYS[selectedStoreId] ?? '';
                  setPartnerApiKey(demoKey);
                }}
                className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-xs text-neutral-300 hover:border-neutral-600 hover:text-white transition-colors"
              >
                Fill Demo Key
              </button>
            </div>
          </div>

          {partnerAuthNotice && (
            <div className="mt-3 rounded-xl border border-emerald-800/60 bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-200">
              {partnerAuthNotice}
            </div>
          )}
          {partnerAuthError && (
            <div className="mt-3 rounded-xl border border-red-800/60 bg-red-950/30 px-4 py-2.5 text-xs text-red-200">
              {partnerAuthError}
            </div>
          )}

          {/* Partner Portal Section Tabs */}
          <div
            role="tablist"
            aria-label="Partner portal sections"
            className="mt-6 flex flex-wrap gap-2 border-b border-neutral-800 pb-3"
          >
            {PARTNER_PORTAL_TABS.map((tab) => {
              const Icon = TAB_ICONS[tab.id];
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => handleTabChange(tab.id)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors sm:text-sm',
                    active
                      ? 'border border-violet-600/80 bg-violet-950/70 text-white shadow-sm'
                      : 'border border-neutral-800/80 bg-neutral-900/40 text-neutral-300 hover:border-neutral-700 hover:text-white',
                  )}
                >
                  <Icon className="h-4 w-4 text-violet-400" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Persistent Live Summary Strip (always mounted for testability & quick status) */}
          <section
            data-testid="partner-subscription-dashboard"
            className="mt-6 rounded-2xl border border-violet-800/60 bg-neutral-900/60 p-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-violet-400">
                <CreditCard className="h-3.5 w-3.5" />
                <span>Store Status &amp; Sponsored Quota Summary</span>
              </div>
              <span className="font-mono text-xs text-neutral-400">
                Store ID: {selectedStoreId}
              </span>
            </div>

            {sub?.quotaExhausted && (
              <div className="mt-4 flex items-center gap-3 rounded-xl border border-red-800/80 bg-red-950/40 px-4 py-3 text-xs text-red-200">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
                <span>
                  <strong>Monthly Sponsored Quota Exhausted:</strong> New in-store sponsored try-ons
                  are blocked before AI inference. Shoppers scanning your QR code are seamlessly
                  offered Personal WearMe mode.
                </span>
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">
                  Subscription Plan
                </span>
                <div className="mt-1 text-lg font-bold text-white">
                  {sub?.planName ?? 'WearMe Premium'}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-emerald-400">
                  <span>₹{sub?.monthlyPriceInr ?? 4999}/mo</span>
                  <span>•</span>
                  <span>{sub?.subscriptionStatus ?? 'ACTIVE'}</span>
                </div>
              </div>

              <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">
                  Remaining Credits
                </span>
                <div className="mt-1 text-lg font-bold text-emerald-300">
                  {sub?.remainingCredits ?? 1500}{' '}
                  <span className="text-xs font-normal text-neutral-400">
                    / {sub?.includedCredits ?? 1500}
                  </span>
                </div>
                <div className="mt-1 text-xs text-neutral-400">
                  Overage policy: {sub?.overagePolicy ?? 'BLOCK'}
                </div>
              </div>

              <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">
                  Consumed / Reserved
                </span>
                <div className="mt-1 text-lg font-bold text-violet-300">
                  {sub?.consumedCredits ?? 0} consumed{' '}
                  <span className="text-xs font-normal text-neutral-400">
                    ({sub?.reservedCredits ?? 0} in-flight)
                  </span>
                </div>
                <div className="mt-1 text-xs text-neutral-400">
                  Failed (refunded): {sub?.failedGenerationsCount ?? 0}
                </div>
              </div>

              <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">
                  QR Sessions &amp; Flywheel
                </span>
                <div className="mt-1 text-lg font-bold text-white">
                  {usageData?.activeSponsoredSessionsCount ?? 0} active
                </div>
                <div className="mt-1 text-xs text-neutral-400">
                  {usageData?.expiredSponsoredSessionsCount ?? 0} expired •{' '}
                  {usageData?.firstTouchAttributedUsersCount ?? 0} attributed users
                </div>
              </div>
            </div>
          </section>

          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="mt-6 space-y-6">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="flex flex-col justify-between rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5">
                  <div>
                    <h2 className="text-base font-bold text-white">Usage &amp; Credit Ledger</h2>
                    <p className="mt-1.5 text-xs leading-relaxed text-neutral-400">
                      Inspect pre-inference credit reservations, completed vs. refunded jobs, and
                      recent ledger transactions.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleTabChange('usage')}
                    className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-violet-300 hover:text-violet-200"
                  >
                    <span>View Usage Details</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex flex-col justify-between rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5">
                  <div>
                    <h2 className="text-base font-bold text-white">Subscription &amp; Billing</h2>
                    <p className="mt-1.5 text-xs leading-relaxed text-neutral-400">
                      Compare Boutique Starter, Growth, and Premium Flagship plans and review
                      overage protection rules.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleTabChange('subscription')}
                    className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-violet-300 hover:text-violet-200"
                  >
                    <span>Manage Subscription</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex flex-col justify-between rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5">
                  <div>
                    <h2 className="text-base font-bold text-white">In-Store QR &amp; Setup</h2>
                    <p className="mt-1.5 text-xs leading-relaxed text-neutral-400">
                      Generate hanger QR links for your boutique and test the bounded 60-minute
                      walk-in shopper flow.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleTabChange('setup')}
                    className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-300 hover:text-emerald-200"
                  >
                    <span>Configure Store QR</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
                <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
                  <div className="flex items-start gap-3.5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-800/60 bg-emerald-950/60 text-emerald-300">
                      <Smartphone className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white">
                        How Boutique Sponsorship Protects Your Budget
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-neutral-400 sm:text-sm">
                        Your store only sponsors try-ons during an active in-store QR session (60m
                        max lifetime, 15m inactivity timeout). Once the shopper leaves the store or
                        saves looks to their personal wardrobe, all future try-ons bill their own
                        Personal WearMe account.
                      </p>
                    </div>
                  </div>
                  <Link
                    href={`/try-on?storeId=${selectedStoreId}&subcategory=TSHIRT`}
                    className={cn(buttonVariants({ variant: 'default', size: 'default' }), 'shrink-0')}
                  >
                    <QrCode className="h-4 w-4" />
                    <span>Launch Walk-In QR Demo</span>
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: USAGE & CREDITS */}
          {activeTab === 'usage' && (
            <div className="mt-6 space-y-6">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6">
                <h2 className="text-lg font-bold text-white">
                  Atomic Credit Reservation &amp; Session Telemetry
                </h2>
                <p className="mt-1 text-xs text-neutral-400 sm:text-sm">
                  Every store-sponsored try-on reserves 1 credit atomically in PostgreSQL before AI
                  inference starts, and automatically refunds the credit if upstream inference fails.
                </p>

                <div className="mt-5 grid gap-4 sm:grid-cols-3">
                  <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                    <div className="text-xs text-neutral-400">Total Sponsored Try-On Jobs</div>
                    <div className="mt-1 text-2xl font-bold text-white">
                      {usageData?.totalSponsoredTryOnJobs ?? 0}
                    </div>
                    <div className="mt-1 text-xs text-emerald-400">
                      {usageData?.completedSponsoredTryOnJobs ?? 0} completed successfully
                    </div>
                  </div>

                  <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                    <div className="text-xs text-neutral-400">Refunded Failed Generations</div>
                    <div className="mt-1 text-2xl font-bold text-amber-300">
                      {sub?.failedGenerationsCount ?? 0}
                    </div>
                    <div className="mt-1 text-xs text-neutral-400">
                      0 credits charged for failed runs
                    </div>
                  </div>

                  <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                    <div className="text-xs text-neutral-400">Wardrobe Flywheel Conversions</div>
                    <div className="mt-1 text-2xl font-bold text-violet-300">
                      {usageData?.savedToWardrobeFromStoreCount ?? 0}
                    </div>
                    <div className="mt-1 text-xs text-neutral-400">
                      {usageData?.firstTouchAttributedUsersCount ?? 0} first-touch attributed shoppers
                    </div>
                  </div>
                </div>

                <div className="mt-6">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
                    Recent Credit Ledger Entries
                  </h3>
                  {usageData?.recentLedgerSummary && usageData.recentLedgerSummary.length > 0 ? (
                    <div className="mt-3 overflow-x-auto rounded-xl border border-neutral-800">
                      <table className="w-full text-left text-xs text-neutral-300">
                        <thead className="border-b border-neutral-800 bg-neutral-950 text-neutral-400">
                          <tr>
                            <th className="px-4 py-2.5">Event Type</th>
                            <th className="px-4 py-2.5">Credits Delta</th>
                            <th className="px-4 py-2.5">Reason</th>
                            <th className="px-4 py-2.5">Timestamp</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-800/70 bg-neutral-900/40">
                          {usageData.recentLedgerSummary.map((entry, idx) => (
                            <tr key={`${entry.createdAt}-${idx}`}>
                              <td className="px-4 py-2.5 font-mono text-violet-300">
                                {entry.eventType}
                              </td>
                              <td className="px-4 py-2.5 font-mono">
                                {entry.creditsDelta > 0
                                  ? `+${entry.creditsDelta}`
                                  : entry.creditsDelta}
                              </td>
                              <td className="px-4 py-2.5">{entry.reason}</td>
                              <td className="px-4 py-2.5 text-neutral-400">
                                {new Date(entry.createdAt).toLocaleString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-2 rounded-xl border border-neutral-800 bg-neutral-950/70 p-4 text-xs text-neutral-400">
                      No credit ledger transactions recorded in the current billing window yet.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: SUBSCRIPTION */}
          {activeTab === 'subscription' && (
            <div className="mt-6 space-y-6">
              <div
                data-testid="partner-subscription-renew-panel"
                className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-violet-800/50 bg-violet-950/20 p-6"
              >
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-violet-300">
                    <CreditCard className="h-4 w-4" />
                    <span>Subscription Period Lifecycle</span>
                  </div>
                  <h3 className="mt-1 text-base font-bold text-white">
                    {sub?.planName ?? 'WearMe Growth'} · Status:{' '}
                    <span className="text-emerald-300">{sub?.subscriptionStatus ?? 'ACTIVE'}</span>
                  </h3>
                  <p className="mt-1 text-xs text-neutral-300">
                    Current period ends{' '}
                    {sub?.periodEnd ? new Date(sub.periodEnd).toLocaleDateString() : 'in 30 days'}.
                    Paid subscriptions transition to <code className="text-amber-300">PAST_DUE</code>{' '}
                    when a period ends and require explicit authorized renewal.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isRenewingSub}
                  onClick={() => void handleRenewSubscription()}
                  className="rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50 transition-colors"
                >
                  {isRenewingSub ? 'Renewing Period...' : 'Authorize 30-Day Subscription Renewal'}
                </button>
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {PARTNER_TIERS.map((tier) => (
                  <Card key={tier.name} className="border-neutral-800 bg-neutral-900/60">
                    <CardHeader>
                      <div className="mb-2 flex items-center justify-between">
                        <Sparkles className="h-5 w-5 text-violet-400" />
                        <Badge variant="emerald">{tier.tag}</Badge>
                      </div>
                      <CardTitle>{tier.name}</CardTitle>
                      <CardDescription className="mt-1">{tier.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2.5">
                        {tier.features.map((f) => (
                          <li key={f} className="flex items-center gap-2 text-sm text-neutral-300">
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
                <div>
                  <h3 className="text-base font-bold text-white">
                    Need custom multi-store credit pooling or enterprise onboarding?
                  </h3>
                  <p className="mt-1 text-xs text-neutral-400 sm:text-sm">
                    Contact our Boutique Partnership team to upgrade your store plan or onboard
                    additional locations.
                  </p>
                </div>
                <Link
                  href="/contact?topic=partner"
                  className={cn(buttonVariants({ variant: 'default', size: 'default' }))}
                >
                  <span>Contact Partner Billing</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          )}

          {/* TAB 4: QR & STORE SETUP */}
          {activeTab === 'setup' && (
            <div className="mt-6 space-y-6">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  <QrCode className="h-4 w-4" />
                  <span>In-Store Standee &amp; Hanger QR Configuration</span>
                </div>
                <h2 className="mt-1 text-xl font-bold text-white">
                  Generate Store-Sponsored QR Entry Links
                </h2>
                <p className="mt-1 text-xs text-neutral-400 sm:text-sm">
                  Print this URL as a QR code on fitting room mirrors or garment tags. Scanning
                  starts a bounded store-sponsored session verified by WearMe servers.
                </p>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="qr-subcategory-select"
                      className="block text-xs font-medium text-neutral-300"
                    >
                      Pre-Selected Garment Subcategory
                    </label>
                    <select
                      id="qr-subcategory-select"
                      value={qrSubcategory}
                      onChange={(e) => setQrSubcategory(e.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 py-2.5 text-xs font-medium text-neutral-200 focus:border-violet-500 focus:outline-none"
                    >
                      <option value="TSHIRT">T-Shirt (Upper-Body Clothing)</option>
                      <option value="SHIRT">Shirt / Blouse (Upper-Body Clothing)</option>
                      <option value="KURTA">Kurta / Ethnic Top (Upper-Body Clothing)</option>
                      <option value="JACKET">Jacket / Outerwear (Upper-Body Clothing)</option>
                      <option value="NECKLACE">Necklace / Pendant (Experimental PoC)</option>
                    </select>
                  </div>

                  <div>
                    <span className="block text-xs font-medium text-neutral-300">
                      Generated Store QR Target URL
                    </span>
                    <div className="mt-1.5 flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-950 px-3.5 py-2.5 font-mono text-xs text-emerald-300">
                      <span>
                        /try-on?storeId={selectedStoreId}&amp;subcategory={qrSubcategory}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex flex-col justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-950/80 px-4 py-3 text-xs text-neutral-400 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-violet-400" />
                    <span>
                      <strong>QR Session Expiry Policy:</strong> 60-min max lifetime, 15-min
                      inactivity timeout. Page refreshes never reset session expiry.
                    </span>
                  </div>
                  <Link
                    href={`/try-on?storeId=${selectedStoreId}&subcategory=${qrSubcategory}`}
                    className={cn(buttonVariants({ variant: 'default', size: 'sm' }))}
                  >
                    <QrCode className="h-3.5 w-3.5" />
                    <span>Test This QR Link Live</span>
                  </Link>
                </div>

                {/* Signed Single-Use In-Store QR Renewal Token Generator */}
                <div
                  data-testid="partner-qr-token-generator"
                  className="mt-5 rounded-xl border border-violet-800/40 bg-violet-950/20 p-4"
                >
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-violet-300">
                        Signed Single-Use In-Store Check-In Token (Anti-Replay Renewal)
                      </h3>
                      <p className="mt-1 text-xs text-neutral-300">
                        Expired sessions cannot be renewed remotely from home. Issue a 5-minute
                        cryptographically signed single-use QR token for physical in-store check-in.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleIssueSignedQrToken()}
                      className="shrink-0 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors"
                    >
                      Issue 5-Min Signed QR Token
                    </button>
                  </div>
                  {issuedQrCheckInPath && (
                    <div className="mt-3 flex flex-col justify-between gap-2 rounded-lg border border-emerald-800/60 bg-neutral-950 px-3 py-2 text-xs sm:flex-row sm:items-center">
                      <code className="break-all text-emerald-300">{issuedQrCheckInPath}</code>
                      <div className="flex shrink-0 items-center gap-2">
                        {issuedQrExpiresAt && (
                          <span className="text-[11px] text-neutral-400">
                            Expires {new Date(issuedQrExpiresAt).toLocaleTimeString()}
                          </span>
                        )}
                        <Link
                          href={issuedQrCheckInPath}
                          className="rounded-lg bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-500"
                        >
                          Open Check-In Link
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: HELP / SUPPORT & PRIVACY BOUNDARIES */}
          {activeTab === 'support' && (
            <div className="mt-6 space-y-6">
              <div className="rounded-2xl border border-emerald-800/60 bg-neutral-900/50 p-6">
                <div className="mb-6 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-700/60 bg-emerald-950/60 text-emerald-400">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">
                      Shopkeeper Privacy Boundary: Aggregated Metrics Only
                    </h2>
                    <p className="text-xs text-neutral-400 sm:text-sm">
                      Shoppers trust your QR codes because WearMe enforces a hard architectural
                      boundary between store analytics and customer photos.
                    </p>
                  </div>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
                    <div className="mb-3 flex items-center gap-2 text-sm font-bold text-emerald-300">
                      <BarChart3 className="h-4 w-4 text-emerald-400" />
                      <span>What Partner Boutiques Receive</span>
                    </div>
                    <ul className="space-y-2 text-xs text-neutral-300 sm:text-sm">
                      {SHOPKEEPER_ALLOWED.map((item) => (
                        <li key={item} className="flex items-start gap-2">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-xl border border-red-900/50 bg-red-950/15 p-5">
                    <div className="mb-3 flex items-center gap-2 text-sm font-bold text-red-300">
                      <EyeOff className="h-4 w-4 text-red-400" />
                      <span>Strictly Blocked From Shopkeeper Access</span>
                    </div>
                    <ul className="space-y-2 text-xs text-neutral-300 sm:text-sm">
                      {SHOPKEEPER_PROHIBITED.map((item) => (
                        <li key={item} className="flex items-start gap-2">
                          <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
                <div>
                  <h3 className="text-base font-bold text-white">
                    Need help with QR standees, store API keys, or billing?
                  </h3>
                  <p className="mt-1 text-xs text-neutral-400 sm:text-sm">
                    Reach our Boutique Partner Support team directly.
                  </p>
                </div>
                <Link
                  href="/contact?topic=partner"
                  className={cn(buttonVariants({ variant: 'default', size: 'default' }))}
                >
                  <span>Contact Partner Support</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

export default function PartnerPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-neutral-950 p-8 text-sm text-neutral-400">
          Loading Partner Portal...
        </div>
      }
    >
      <PartnerPortalContent />
    </Suspense>
  );
}
