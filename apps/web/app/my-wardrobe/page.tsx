'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  BookmarkCheck,
  Sparkles,
  Smartphone,
  ShieldCheck,
  Store,
  ShoppingBag,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Wand2,
  LogOut,
  UserCheck,
  KeyRound,
  Download,
} from 'lucide-react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { tryOnApi } from '@/lib/api-client';
import {
  clearStoredAuthSession,
  getOrCreateSessionId,
  getStoredStoreContext,
  setStoredAuthSession,
} from '@/lib/job-history';
import type {
  JobStatusResponse,
  RetailerCatalogItem,
  WardrobeResponse,
} from '@wearme/shared';
import { cn } from '@/lib/utils';

export default function MyWardrobePage() {
  const [wardrobe, setWardrobe] = useState<WardrobeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const [sessionId, setSessionId] = useState('');

  // Inline WhatsApp OTP verification state for unauthenticated visitors
  const [phoneInput, setPhoneInput] = useState('+91 98765 43210');
  const [otpStep, setOtpStep] = useState<'phone' | 'otp'>('phone');
  const [otpInput, setOtpInput] = useState('');
  const [devOtpHint, setDevOtpHint] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // 1-Click Cross-Retailer Try-On state
  const [tryingCatalogId, setTryingCatalogId] = useState<string | null>(null);
  const [tryOnError, setTryOnError] = useState<string | null>(null);
  const [tryOnSuccessNotice, setTryOnSuccessNotice] = useState<string | null>(null);

  const loadWardrobe = useCallback(async () => {
    setLoading(true);
    setUnauthenticated(false);
    try {
      const data = await tryOnApi.getWardrobe();
      setWardrobe(data);
      setUnauthenticated(false);
    } catch {
      setWardrobe(null);
      setUnauthenticated(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSessionId(getOrCreateSessionId());
    void loadWardrobe();
  }, [loadWardrobe]);

  const handleRequestOtp = async () => {
    if (!phoneInput.trim() || authBusy) return;
    setAuthBusy(true);
    setAuthError(null);
    try {
      const storeCtx = getStoredStoreContext();
      const res = await tryOnApi.requestOtp({
        phone: phoneInput.trim(),
        storeId: storeCtx?.storeId ?? 'store_indiranagar_01',
        storeName: storeCtx?.storeName ?? 'Studio Namma Indiranagar',
      });
      setDevOtpHint(res.devOtpPreview ?? null);
      if (res.devOtpPreview) {
        setOtpInput(res.devOtpPreview);
      }
      setOtpStep('otp');
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Failed to send WhatsApp OTP.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otpInput.length !== 6 || authBusy) return;
    setAuthBusy(true);
    setAuthError(null);
    try {
      const storeCtx = getStoredStoreContext();
      const res = await tryOnApi.upgradeSession({
        phone: phoneInput.trim(),
        otpCode: otpInput.trim(),
        storeId: storeCtx?.storeId ?? 'store_indiranagar_01',
        storeName: storeCtx?.storeName ?? 'Studio Namma Indiranagar',
      });
      setStoredAuthSession(res.authToken, res.user);
      await loadWardrobe();
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Invalid OTP verification code.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleOneClickRetailerTryOn = async (item: RetailerCatalogItem) => {
    if (tryingCatalogId) return;
    setTryingCatalogId(item.id);
    setTryOnError(null);
    setTryOnSuccessNotice(null);
    try {
      const newLook: JobStatusResponse = await tryOnApi.tryOnFromCatalog(item.id);
      setWardrobe((prev) =>
        prev
          ? {
              ...prev,
              savedLooks: [
                newLook,
                ...prev.savedLooks.filter((l) => l.jobId !== newLook.jobId),
              ],
            }
          : prev,
      );
      setTryOnSuccessNotice(
        `Generated "${item.title}" (${item.brand}) using your saved base portrait and added it to your Digital Wardrobe.`,
      );
    } catch (err: unknown) {
      setTryOnError(
        err instanceof Error
          ? err.message
          : '1-click cross-retailer try-on failed. Please try again.',
      );
    } finally {
      setTryingCatalogId(null);
    }
  };

  const handleSignOut = () => {
    clearStoredAuthSession();
    setWardrobe(null);
    setUnauthenticated(true);
    setOtpStep('phone');
  };

  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-neutral-50">
      <SiteHeader />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 md:py-10">
        {/* Page Header */}
        <div className="mb-8 flex flex-col justify-between gap-4 border-b border-neutral-800/80 pb-6 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">
              <BookmarkCheck className="h-3.5 w-3.5" />
              B2C Persistent Digital Wardrobe · Network Effect Flywheel
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
              My Digital Wardrobe
            </h1>
            <p className="mt-1 text-sm text-neutral-400">
              Your saved walk-in store base portrait and cross-platform online retailer try-on hub.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              href="/try-on?storeId=store_indiranagar_01&storeName=Studio%20Namma%20Indiranagar"
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-violet-500 transition-colors"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Walk-In Studio QR Try-On
            </Link>
            {wardrobe && (
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 px-3.5 py-2 text-xs font-medium text-neutral-300 hover:border-neutral-700 hover:text-white"
              >
                <LogOut className="h-3.5 w-3.5 text-neutral-400" />
                Sign Out
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-[45vh] flex-col items-center justify-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-10 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
            <p className="text-sm font-medium text-neutral-300">
              Loading your persistent Digital Wardrobe…
            </p>
          </div>
        ) : unauthenticated || !wardrobe ? (
          /* Protected Route Gate: WhatsApp OTP Session Upgrade */
          <div
            data-testid="wardrobe-auth-gate"
            className="mx-auto max-w-xl rounded-2xl border border-neutral-800 bg-neutral-900/70 p-6 sm:p-8"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-700/60 bg-emerald-950/60 text-emerald-400">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">
                  Unlock Your Digital Wardrobe
                </h2>
                <p className="text-xs text-neutral-400">
                  Upgrade your anonymous walk-in session{' '}
                  {sessionId ? `(${sessionId.slice(0, 14)}…)` : ''} via WhatsApp OTP
                </p>
              </div>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-neutral-300">
              When you try on an outfit at a partner boutique via QR code, verifying your WhatsApp
              number promotes your anonymous <code className="text-violet-300">TryOnSession</code>{' '}
              into a persistent B2C account—saving your base photo so you can try on garments from
              cross-platform retailers in 1 click.
            </p>

            {otpStep === 'phone' ? (
              <div className="mt-6 space-y-4">
                <div>
                  <label
                    htmlFor="gate-phone-input"
                    className="mb-1.5 block text-xs font-medium text-neutral-300"
                  >
                    WhatsApp Phone Number
                  </label>
                  <input
                    id="gate-phone-input"
                    data-testid="gate-phone-input"
                    type="tel"
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  data-testid="gate-request-otp-button"
                  onClick={handleRequestOtp}
                  disabled={authBusy || !phoneInput.trim()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                >
                  {authBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Smartphone className="h-4 w-4" />
                  )}
                  Send WhatsApp OTP &amp; Claim Session
                </button>
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                {devOtpHint && (
                  <div className="flex items-center justify-between rounded-xl border border-amber-700/60 bg-amber-950/30 px-3.5 py-2.5 text-xs text-amber-200">
                    <span className="inline-flex items-center gap-1.5">
                      <KeyRound className="h-3.5 w-3.5 text-amber-400" />
                      Dev Sandbox WhatsApp OTP:{' '}
                      <code className="font-mono font-bold text-amber-100">{devOtpHint}</code>
                    </span>
                    <button
                      type="button"
                      onClick={() => setOtpInput(devOtpHint)}
                      className="font-semibold text-amber-300 underline"
                    >
                      Auto-fill
                    </button>
                  </div>
                )}

                <div>
                  <label
                    htmlFor="gate-otp-input"
                    className="mb-1.5 block text-xs font-medium text-neutral-300"
                  >
                    6-Digit WhatsApp OTP
                  </label>
                  <input
                    id="gate-otp-input"
                    data-testid="gate-otp-input"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 py-2.5 font-mono text-sm tracking-widest text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <div className="flex gap-2.5">
                  <button
                    type="button"
                    data-testid="gate-verify-otp-button"
                    onClick={handleVerifyOtp}
                    disabled={authBusy || otpInput.length !== 6}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                  >
                    {authBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-4 w-4" />
                    )}
                    Verify &amp; Open My Wardrobe
                  </button>
                  <button
                    type="button"
                    onClick={() => setOtpStep('phone')}
                    className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-xs font-medium text-neutral-400 hover:text-white"
                  >
                    Back
                  </button>
                </div>
              </div>
            )}

            {authError && (
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-red-900 bg-red-950/30 px-3.5 py-2.5 text-xs text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                <span>{authError}</span>
              </div>
            )}
          </div>
        ) : (
          /* Authenticated Digital Wardrobe Interface */
          <div data-testid="wardrobe-authenticated-view" className="space-y-8">
            {/* Verified Identity & Acquisition Provenance Banner */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-800/60 bg-gradient-to-r from-emerald-950/40 via-neutral-900 to-violet-950/30 px-5 py-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-700/60 bg-emerald-950/80 px-3 py-1 text-xs font-semibold text-emerald-300">
                  <UserCheck className="h-3.5 w-3.5" />
                  Verified WhatsApp: {wardrobe.user.phoneE164}
                </span>
                {wardrobe.user.originStoreName && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-700/60 bg-violet-950/60 px-3 py-1 text-xs font-medium text-violet-200">
                    <Store className="h-3.5 w-3.5 text-violet-400" />
                    Acquired via: {wardrobe.user.originStoreName}
                  </span>
                )}
                <span className="text-xs text-neutral-400">
                  {wardrobe.savedLooks.length} saved look
                  {wardrobe.savedLooks.length === 1 ? '' : 's'} · Eternal retention (no 7-day expiry)
                </span>
              </div>
            </div>

            {tryOnSuccessNotice && (
              <div
                data-testid="wardrobe-tryon-success"
                className="flex items-center gap-2.5 rounded-xl border border-emerald-800/80 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-300"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                <span>{tryOnSuccessNotice}</span>
              </div>
            )}

            {tryOnError && (
              <div className="flex items-center gap-2.5 rounded-xl border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                <span>{tryOnError}</span>
              </div>
            )}

            {/* Top Grid: Saved Base Portrait (Left) + Cross-Platform B2C Retailer Catalog (Right) */}
            <div className="grid gap-6 lg:grid-cols-12">
              {/* Saved Base Portrait Card */}
              <div className="flex flex-col justify-between rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5 lg:col-span-4">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                      Saved Base Photo
                    </span>
                    <span className="rounded-full border border-emerald-800/60 bg-emerald-950/50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
                      1-Click Ready
                    </span>
                  </div>
                  <h2 className="mt-1 text-base font-bold text-white">
                    Your Walk-In Base Portrait
                  </h2>
                  <p className="mt-1 text-xs text-neutral-400">
                    Promoted from your in-store QR session. Select any partner retailer garment on
                    the right to try it on immediately without re-uploading a selfie.
                  </p>

                  <div className="relative mt-4 aspect-[3/4] w-full overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950">
                    {wardrobe.user.basePersonImageUrl ? (
                      <Image
                        src={wardrobe.user.basePersonImageUrl}
                        alt="Saved base portrait"
                        fill
                        className="object-contain"
                        sizes="(max-width: 1024px) 100vw, 33vw"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-neutral-400">
                        <Wand2 className="h-6 w-6 text-violet-400" />
                        <span>
                          No base portrait saved yet. Run a try-on in the Studio to set your base
                          photo!
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <Link
                  href="/try-on"
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-neutral-700 bg-neutral-950 py-2.5 text-xs font-semibold text-neutral-200 hover:border-violet-600 hover:text-white"
                >
                  <Wand2 className="h-3.5 w-3.5 text-violet-400" />
                  Update Base Photo in Studio
                </Link>
              </div>

              {/* Cross-Platform Retailer Feed */}
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5 sm:p-6 lg:col-span-8">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-violet-400">
                      Cross-Platform B2C Marketplace
                    </span>
                    <h2 className="text-base font-bold text-white sm:text-lg">
                      1-Click Try-On Across Partner Online Retailers
                    </h2>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-violet-800/60 bg-violet-950/40 px-3 py-1 text-xs font-medium text-violet-300">
                    <ShoppingBag className="h-3.5 w-3.5" />
                    Uses Saved Base Portrait
                  </span>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {wardrobe.retailerCatalog.map((item) => {
                    const isRunning = tryingCatalogId === item.id;
                    return (
                      <div
                        key={item.id}
                        className="flex flex-col justify-between rounded-xl border border-neutral-800 bg-neutral-950/80 p-4 transition-colors hover:border-neutral-700"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="rounded-md border border-violet-800/50 bg-violet-950/50 px-2 py-0.5 text-[11px] font-semibold text-violet-300">
                              {item.brand}
                            </span>
                            <span className="text-xs font-semibold text-neutral-300">
                              ₹{item.priceInr.toLocaleString('en-IN')}
                            </span>
                          </div>

                          <div className="mt-3 flex items-center gap-3.5">
                            <div className="relative h-24 w-20 shrink-0 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
                              <Image
                                src={item.previewSvgDataUri}
                                alt={item.title}
                                fill
                                className="object-contain p-1"
                                unoptimized
                              />
                            </div>
                            <div>
                              <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                              <p className="mt-0.5 text-xs text-neutral-400">{item.tagline}</p>
                              <span className="mt-2 inline-block rounded bg-neutral-900 px-2 py-0.5 font-mono text-[10px] text-neutral-400">
                                {item.subcategory}
                              </span>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          data-testid={`tryon-catalog-${item.id}`}
                          onClick={() => handleOneClickRetailerTryOn(item)}
                          disabled={Boolean(tryingCatalogId) || !wardrobe.user.basePersonImageUrl}
                          className={cn(
                            'mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold transition-all',
                            wardrobe.user.basePersonImageUrl
                              ? 'bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-60'
                              : 'cursor-not-allowed border border-neutral-800 bg-neutral-900 text-neutral-500',
                          )}
                        >
                          {isRunning ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Generating look with saved photo…
                            </>
                          ) : (
                            <>
                              <Sparkles className="h-3.5 w-3.5" />
                              Instant Try-On with Saved Photo
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Saved Wardrobe Looks Grid */}
            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5 sm:p-6">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                    Persistent Collection
                  </span>
                  <h2 className="text-lg font-bold text-white">
                    Saved Wardrobe Looks ({wardrobe.savedLooks.length})
                  </h2>
                </div>
              </div>

              {wardrobe.savedLooks.length === 0 ? (
                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-8 text-center text-sm text-neutral-400">
                  No looks saved yet. Complete a try-on in the Studio or click &ldquo;Instant Try-On
                  with Saved Photo&rdquo; on any partner brand item above!
                </div>
              ) : (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {wardrobe.savedLooks.map((look) => (
                    <div
                      key={look.jobId}
                      data-testid={`saved-look-card-${look.jobId}`}
                      className="flex flex-col justify-between overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950"
                    >
                      <div>
                        <div className="flex items-center justify-between border-b border-neutral-800/80 px-3.5 py-2.5 text-xs">
                          <span className="font-semibold text-emerald-300">
                            {look.retailerSource || 'Partner Store QR'}
                          </span>
                          <span className="rounded bg-neutral-900 px-2 py-0.5 font-mono text-[11px] text-neutral-300">
                            {look.subcategory || look.category}
                          </span>
                        </div>

                        <div className="relative aspect-[3/4] w-full bg-neutral-900">
                          {look.resultUrl ? (
                            <Image
                              src={look.resultUrl}
                              alt={look.productTitle || 'Saved wardrobe look'}
                              fill
                              className="object-contain"
                              sizes="(max-width: 768px) 100vw, 33vw"
                              unoptimized
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-xs text-neutral-500">
                              Preview unavailable
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between border-t border-neutral-800/80 px-3.5 py-3">
                        <div className="truncate pr-2">
                          <p className="truncate text-xs font-semibold text-neutral-200">
                            {look.productTitle || `${look.subcategory || look.category} Look`}
                          </p>
                          <p className="text-[11px] text-neutral-500">
                            Saved · Never expires
                          </p>
                        </div>
                        {look.resultUrl && (
                          <a
                            href={look.resultUrl}
                            download={`wardrobe-${look.jobId.slice(0, 8)}.jpg`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-neutral-200 hover:border-violet-600 hover:text-white"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Save
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}

