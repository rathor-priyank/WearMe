'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ShieldCheck,
  Trash2,
  LogOut,
  UserCheck,
  Lock,
  Loader2,
  AlertCircle,
  CheckCircle2,
  BookmarkCheck,
  Store,
  Wand2,
} from 'lucide-react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { ContextualNavBar } from '@/components/contextual-nav';
import { tryOnApi } from '@/lib/api-client';
import { clearStoredAuthSession } from '@/lib/job-history';
import type { WardrobeResponse } from '@wearme/shared';

export default function AccountPrivacyPage() {
  const router = useRouter();
  const [wardrobe, setWardrobe] = useState<WardrobeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<'portrait' | 'account' | 'logout' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);

  const loadAccount = useCallback(async () => {
    setLoading(true);
    try {
      const data = await tryOnApi.getWardrobe();
      setWardrobe(data);
    } catch {
      setWardrobe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  const handleDeletePortrait = async () => {
    if (busyAction) return;
    setBusyAction('portrait');
    setError(null);
    setNotice(null);
    try {
      await tryOnApi.deletePortrait();
      await loadAccount();
      setNotice(
        'Your saved base portrait has been permanently erased from storage. Your account remains active.',
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete saved portrait.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteAccount = async () => {
    if (busyAction) return;
    setBusyAction('account');
    setError(null);
    setNotice(null);
    try {
      await tryOnApi.deleteAccount();
      clearStoredAuthSession();
      router.push('/?accountDeleted=1');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete account.');
      setBusyAction(null);
    }
  };

  const handleLogout = async () => {
    if (busyAction) return;
    setBusyAction('logout');
    try {
      await tryOnApi.logout();
    } catch {
      // Clear local session regardless
    } finally {
      clearStoredAuthSession();
      router.push('/login');
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-neutral-50">
      <SiteHeader />

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 md:py-10">
        <ContextualNavBar
          backHref="/my-wardrobe"
          backLabel="Back to My Wardrobe"
          breadcrumbs={[
            { label: 'My Wardrobe', href: '/my-wardrobe' },
            { label: 'Account' },
          ]}
        />

        <div className="mb-8 flex flex-col justify-between gap-4 border-b border-neutral-800/80 pb-6 sm:flex-row sm:items-center">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              Customer Privacy &amp; Data Ownership
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
              Account &amp; Photo Privacy Controls
            </h1>
            <p className="mt-1 text-sm text-neutral-400">
              Manage your verified identity, inspect or delete your saved portrait, or permanently
              erase your account.
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              data-testid="account-logout-button"
              onClick={handleLogout}
              disabled={Boolean(busyAction)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 px-3.5 py-2 text-xs font-medium text-neutral-300 hover:border-neutral-700 hover:text-white disabled:opacity-60"
            >
              <LogOut className="h-3.5 w-3.5 text-neutral-400" />
              Sign Out
            </button>
          </div>
        </div>

        {notice && (
          <div
            data-testid="account-privacy-notice"
            className="mb-6 flex items-center gap-2.5 rounded-xl border border-emerald-800/80 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-300"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <span>{notice}</span>
          </div>
        )}

        {error && (
          <div className="mb-6 flex items-center gap-2.5 rounded-xl border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[35vh] flex-col items-center justify-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-10 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-emerald-400" />
            <p className="text-sm text-neutral-300">Loading your privacy settings…</p>
          </div>
        ) : !wardrobe ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-8 text-center">
            <Lock className="mx-auto h-8 w-8 text-emerald-400" />
            <h2 className="mt-3 text-lg font-bold text-white">Sign in to manage your account</h2>
            <p className="mt-1 text-sm text-neutral-400">
              Authenticate via WhatsApp, SMS, or Email OTP to view and control your saved portrait
              and wardrobe data.
            </p>
            <Link
              href="/login?returnUrl=/account"
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              Sign In with OTP
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Identity & Shop Isolation Summary */}
            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6">
              <h2 className="text-base font-bold text-white">Verified Customer Profile</h2>
              <div className="mt-4 flex flex-wrap gap-3">
                {wardrobe.user.phoneE164 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-800/60 bg-emerald-950/60 px-3 py-1 text-xs font-semibold text-emerald-300">
                    <UserCheck className="h-3.5 w-3.5" />
                    Phone: {wardrobe.user.phoneE164}
                  </span>
                )}
                {wardrobe.user.email && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-800/60 bg-sky-950/60 px-3 py-1 text-xs font-semibold text-sky-300">
                    <UserCheck className="h-3.5 w-3.5" />
                    Email: {wardrobe.user.email}
                  </span>
                )}
                {wardrobe.user.originStoreName && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-800/60 bg-violet-950/60 px-3 py-1 text-xs font-medium text-violet-200">
                    <Store className="h-3.5 w-3.5 text-violet-400" />
                    First-Touch Boutique: {wardrobe.user.originStoreName}
                  </span>
                )}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-neutral-400">
                <strong className="text-emerald-300">Shopkeeper Privacy Guarantee:</strong> Even if
                you first discovered WearMe via a boutique QR code, that shopkeeper cannot view your
                portrait, your generated try-on images, your contact details, or your saved looks.
              </p>
            </section>

            {/* Saved Portrait Management */}
            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6">
              <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
                <div className="flex items-center gap-4">
                  <div className="relative h-28 w-20 shrink-0 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950">
                    {wardrobe.user.basePersonImageUrl ? (
                      <Image
                        src={wardrobe.user.basePersonImageUrl}
                        alt="Saved base portrait"
                        fill
                        className="object-contain"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center p-2 text-center text-[10px] text-neutral-500">
                        No Portrait Saved
                      </div>
                    )}
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-white">Saved Base Portrait</h2>
                    <p className="mt-1 max-w-md text-xs leading-relaxed text-neutral-400">
                      {wardrobe.user.basePersonImageUrl
                        ? 'Your base portrait is stored in your isolated customer directory for 1-click try-ons. You can delete it at any time without losing your account.'
                        : 'You do not currently have a saved base portrait on file.'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2.5">
                  <Link
                    href="/try-on"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-xs font-semibold text-neutral-200 hover:border-violet-600"
                  >
                    <Wand2 className="h-3.5 w-3.5 text-violet-400" />
                    {wardrobe.user.basePersonImageUrl ? 'Replace Portrait' : 'Upload Portrait'}
                  </Link>
                  {wardrobe.user.basePersonImageUrl && (
                    <button
                      type="button"
                      data-testid="account-delete-portrait-button"
                      onClick={handleDeletePortrait}
                      disabled={Boolean(busyAction)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-2.5 text-xs font-semibold text-red-300 hover:bg-red-900/40 disabled:opacity-60"
                    >
                      {busyAction === 'portrait' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      Delete Saved Portrait
                    </button>
                  )}
                </div>
              </div>
            </section>

            {/* Full Account & Data Erasure */}
            <section className="rounded-2xl border border-red-900/60 bg-red-950/15 p-6">
              <h2 className="text-base font-bold text-red-200">
                Permanent Account &amp; Data Deletion
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-neutral-300 sm:text-sm">
                Deleting your account permanently removes your user record, your saved base portrait
                directory (<code className="text-red-200">uploads/users/&lt;userId&gt;/</code>), all
                saved wardrobe looks, and all linked try-on job files from disk. This action cannot
                be undone.
              </p>

              {!confirmDeleteAccount ? (
                <button
                  type="button"
                  data-testid="account-delete-trigger"
                  onClick={() => setConfirmDeleteAccount(true)}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl border border-red-800/80 bg-red-950/50 px-4 py-2.5 text-xs font-semibold text-red-200 hover:bg-red-900/50"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete Account &amp; All Data…
                </button>
              ) : (
                <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-red-800 bg-neutral-950 p-4">
                  <span className="text-xs font-semibold text-red-200">
                    Are you sure you want to permanently erase your account and all photos?
                  </span>
                  <button
                    type="button"
                    data-testid="account-delete-confirm-button"
                    onClick={handleDeleteAccount}
                    disabled={Boolean(busyAction)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-500 disabled:opacity-60"
                  >
                    {busyAction === 'account' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    Yes, Permanently Delete Everything
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteAccount(false)}
                    className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-300 hover:text-white"
                  >
                    Cancel
                  </button>
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

