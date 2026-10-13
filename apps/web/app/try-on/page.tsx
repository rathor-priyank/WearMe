'use client';

import { Suspense, useState, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Sparkles,
  Loader2,
  AlertCircle,
  CheckCircle2,
  FlaskConical,
  Clock,
  Info,
  Camera,
  Shirt,
  Gem,
  Layers,
  History,
  Store,
  QrCode,
  BookmarkCheck,
} from 'lucide-react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { ImageUpload } from '@/components/image-upload';
import { TryOnResult } from '@/components/try-on-result';
import { tryOnApi, buildFallbackCategoriesResponse } from '@/lib/api-client';
import {
  clearStoredStoreContext,
  getOrCreateSessionId,
  recordSessionJob,
  removeSessionJob,
  setStoredStoreContext,
  type StoreQrContext,
} from '@/lib/job-history';
import {
  NECKLACE_POC_SUBCATEGORIES,
  TryOnStatus,
  UPPER_BODY_SUBCATEGORIES,
  WearableDomain,
} from '@wearme/shared';
import type {
  JobStatusResponse,
  CategoriesResponse,
  CategoryCapabilityItem,
  EntitlementStatusResponse,
  SponsoredSessionStateResponse,
} from '@wearme/shared';
import { cn } from '@/lib/utils';

type Step = 'upload' | 'processing' | 'result';

const DOMAIN_LABELS: Record<string, string> = {
  [WearableDomain.CLOTHING]: 'Clothing',
  [WearableDomain.JEWELLERY]: 'Jewellery',
  [WearableDomain.EYEWEAR]: 'Eyewear',
  [WearableDomain.WRISTWEAR]: 'Wristwear',
  [WearableDomain.BAGS]: 'Bags',
  [WearableDomain.FOOTWEAR]: 'Footwear',
  [WearableDomain.HEADWEAR]: 'Headwear',
  [WearableDomain.ACCESSORIES]: 'Accessories',
};

function canUploadSubcategory(item: CategoryCapabilityItem): boolean {
  return (
    item.providerSupportStatus === 'supported' ||
    item.providerSupportStatus === 'experimental_poc'
  );
}

function getSupportBadge(item: CategoryCapabilityItem) {
  if (item.providerSupportStatus === 'supported') {
    return {
      label: 'Supported',
      className: 'border-emerald-800/80 bg-emerald-950/60 text-emerald-300',
      dotClass: 'bg-emerald-400',
    };
  }
  if (item.providerSupportStatus === 'experimental_poc') {
    return {
      label: 'Experimental PoC (Enabled)',
      className: 'border-amber-700/80 bg-amber-950/60 text-amber-300',
      dotClass: 'bg-amber-400',
    };
  }
  if ((NECKLACE_POC_SUBCATEGORIES as readonly string[]).includes(item.subcategory)) {
    return {
      label: 'PoC Disabled (ENABLE_NECKLACE_POC=false)',
      className: 'border-neutral-700 bg-neutral-900 text-neutral-400',
      dotClass: 'bg-neutral-500',
    };
  }
  if (item.providerSupportStatus === 'requires_specialized_model') {
    return {
      label: 'Requires Specialized Model',
      className: 'border-neutral-700 bg-neutral-900 text-neutral-400',
      dotClass: 'bg-neutral-500',
    };
  }
  return {
    label: 'Unsupported',
    className: 'border-red-900/60 bg-red-950/40 text-red-300',
    dotClass: 'bg-red-400',
  };
}

function TryOnStudioContent() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const [selectedDomain, setSelectedDomain] = useState<string>(WearableDomain.CLOTHING);
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>('TSHIRT');
  const [personImage, setPersonImage] = useState<File | null>(null);
  const [garmentImage, setGarmentImage] = useState<File | null>(null);
  const [step, setStep] = useState<Step>('upload');
  const [jobId, setJobId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [processError, setProcessError] = useState<string | null>(null);
  const [deletedNotice, setDeletedNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [personPreview, setPersonPreview] = useState<string | null>(null);
  const [productPreview, setProductPreview] = useState<string | null>(null);
  const [storeContext, setStoreContext] = useState<StoreQrContext | null>(null);
  const [sponsoredSession, setSponsoredSession] =
    useState<SponsoredSessionStateResponse | null>(null);
  const [entitlements, setEntitlements] = useState<EntitlementStatusResponse | null>(null);
  const [isSwitchingMode, setIsSwitchingMode] = useState(false);
  const [activeSessionToken, setActiveSessionToken] = useState<string>('');

  // Load capability catalog from API with immediate fallback
  const { data: categoriesData } = useQuery<CategoriesResponse>({
    queryKey: ['wearable-categories'],
    queryFn: () => tryOnApi.getCategories(),
    staleTime: 60_000,
  });

  const catalogItems: CategoryCapabilityItem[] = useMemo(() => {
    if (categoriesData?.categories && categoriesData.categories.length > 0) {
      return categoriesData.categories;
    }
    return buildFallbackCategoriesResponse().categories;
  }, [categoriesData]);

  const refreshEntitlements = useCallback(async () => {
    try {
      const status = await tryOnApi.getEntitlements();
      setEntitlements(status);
      if (status.sponsoredSession) {
        setSponsoredSession(status.sponsoredSession);
      }
    } catch {
      // Non-fatal if API is offline in preview
    }
  }, []);

  // Pre-select subcategory & establish/inspect bounded Store-Sponsored QR Session vs. Personal WearMe mode
  useEffect(() => {
    setActiveSessionToken(getOrCreateSessionId());
    const paramStoreId = searchParams.get('storeId')?.trim();
    const paramQrToken = searchParams.get('qrToken')?.trim();
    let cancelled = false;

    if (paramStoreId) {
      tryOnApi
        .startOrInspectSponsoredSession(paramStoreId, paramQrToken)
        .then((sessionState) => {
          if (cancelled) return;
          setSponsoredSession(sessionState);
          if (sessionState.active && sessionState.storeId && sessionState.storeName) {
            const verifiedCtx: StoreQrContext = {
              storeId: sessionState.storeId,
              storeName: sessionState.storeName,
              expiresAt: sessionState.expiresAt,
            };
            setStoreContext(verifiedCtx);
            setStoredStoreContext(verifiedCtx);
          } else {
            setStoreContext(null);
            clearStoredStoreContext();
          }
          void refreshEntitlements();
        })
        .catch(() => {
          if (cancelled) return;
          setSponsoredSession(null);
          setStoreContext(null);
          clearStoredStoreContext();
          void refreshEntitlements();
        });
    } else {
      // No ?storeId= in URL -> never default to a store; inspect server entitlement state
      clearStoredStoreContext();
      setStoreContext(null);
      setSponsoredSession(null);
      void refreshEntitlements();
    }

    const paramSub = searchParams.get('subcategory')?.toUpperCase();
    if (paramSub) {
      const matched = catalogItems.find((item) => item.subcategory === paramSub);
      if (matched) {
        setSelectedDomain(matched.domain);
        setSelectedSubcategory(matched.subcategory);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [searchParams, catalogItems, refreshEntitlements]);

  const handleSwitchToPersonalMode = useCallback(async () => {
    setIsSwitchingMode(true);
    setSubmitError(null);
    try {
      const updated = await tryOnApi.switchToPersonalMode();
      setEntitlements(updated);
      setSponsoredSession(null);
      setStoreContext(null);
      clearStoredStoreContext();
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error ? err.message : 'Could not switch to Personal WearMe mode.',
      );
    } finally {
      setIsSwitchingMode(false);
    }
  }, []);

  const handleLoadWalkInDemoInputs = useCallback(async () => {
    const createCanvasFile = async (
      filename: string,
      draw: (ctx: CanvasRenderingContext2D) => void,
    ): Promise<File> => {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 640;
      const ctx = canvas.getContext('2d')!;
      draw(ctx);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), 'image/png'),
      );
      return new File([blob], filename, { type: 'image/png' });
    };

    const samplePerson = await createCanvasFile('walkin-shopper-portrait.png', (ctx) => {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, 512, 640);
      // Head & neck
      ctx.fillStyle = '#e2b897';
      ctx.beginPath();
      ctx.arc(256, 150, 56, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(232, 195, 48, 45);
      // Torso base
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(156, 235, 200, 260);
      // Lower body
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(166, 495, 180, 145);
    });

    const sampleGarment = await createCanvasFile('indiranagar-store-tee.png', (ctx) => {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, 512, 640);
      ctx.fillStyle = '#7c3aed';
      ctx.fillRect(116, 130, 280, 340);
      ctx.fillStyle = '#ddd6fe';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('INDIRANAGAR BOUTIQUE', 256, 290);
      ctx.fillText('SIGNATURE CREW TEE', 256, 325);
    });

    setSelectedDomain(WearableDomain.CLOTHING);
    setSelectedSubcategory('TSHIRT');
    setPersonImage(samplePerson);
    setGarmentImage(sampleGarment);
    setSubmitError(null);
  }, []);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      if (personPreview) URL.revokeObjectURL(personPreview);
      if (productPreview) URL.revokeObjectURL(productPreview);
    };
  }, [personPreview, productPreview]);

  const domainSubcategories = useMemo(
    () => catalogItems.filter((item) => item.domain === selectedDomain),
    [catalogItems, selectedDomain],
  );

  const activeSpec: CategoryCapabilityItem = useMemo(() => {
    const found = catalogItems.find((item) => item.subcategory === selectedSubcategory);
    if (found) return found;
    return buildFallbackCategoriesResponse().categories[0]!;
  }, [catalogItems, selectedSubcategory]);

  const handleSelectDomain = useCallback(
    (domain: string) => {
      setSelectedDomain(domain);
      const itemsInDomain = catalogItems.filter((item) => item.domain === domain);
      const preferred =
        itemsInDomain.find((item) => canUploadSubcategory(item)) ?? itemsInDomain[0];
      if (preferred) {
        setSelectedSubcategory(preferred.subcategory);
      }
      setSubmitError(null);
    },
    [catalogItems],
  );

  // Poll job status while in processing or result state
  const { data: jobStatus } = useQuery<JobStatusResponse>({
    queryKey: ['job', jobId],
    queryFn: () => tryOnApi.getStatus(jobId!),
    enabled: (step === 'processing' || step === 'result') && !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === TryOnStatus.COMPLETED || status === TryOnStatus.FAILED) return false;
      return 2000;
    },
  });

  // Transition to result when job finishes
  const currentStatus = jobStatus?.status;
  useEffect(() => {
    if (
      step === 'processing' &&
      (currentStatus === TryOnStatus.COMPLETED || currentStatus === TryOnStatus.FAILED)
    ) {
      setStep('result');
    }
  }, [step, currentStatus]);

  const isNecklacePoc = (NECKLACE_POC_SUBCATEGORIES as readonly string[]).includes(
    activeSpec.subcategory,
  );
  const isStudioUploadable = canUploadSubcategory(activeSpec);

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;
    if (sponsoredSession && !sponsoredSession.active) {
      setSubmitError(
        sponsoredSession.message ||
          'Your in-store try-on session has ended. Click "Continue with Personal WearMe" or "Scan Shop QR Again" above.',
      );
      return;
    }
    if (!isStudioUploadable) {
      setSubmitError(
        `${activeSpec.label} requires a specialized model (${activeSpec.routingStrategy}) and cannot be processed through the upper-body clothing or necklace PoC pipeline.`,
      );
      return;
    }
    if (!personImage || !garmentImage) {
      setSubmitError('Please upload both your person photo and a product image.');
      return;
    }

    setSubmitError(null);
    setProcessError(null);
    setDeletedNotice(null);
    setIsSubmitting(true);

    let createdJobId: string | null = null;
    try {
      const sponsoredStoreIdToPass =
        sponsoredSession?.active && sponsoredSession.storeId
          ? sponsoredSession.storeId
          : undefined;

      // Step 1: Upload images and create job (pass dbCategory + explicit subcategory + verified storeId only if active)
      const job = await tryOnApi.upload(
        personImage,
        garmentImage,
        activeSpec.dbCategory,
        activeSpec.subcategory,
        sponsoredStoreIdToPass,
      );
      createdJobId = job.jobId;

      // Record in client session history
      recordSessionJob({
        jobId: job.jobId,
        category: activeSpec.dbCategory,
        subcategory: activeSpec.subcategory,
        createdAt: job.createdAt,
      });

      // Track previews for side-by-side display
      if (personPreview) URL.revokeObjectURL(personPreview);
      if (productPreview) URL.revokeObjectURL(productPreview);
      setPersonPreview(URL.createObjectURL(personImage));
      setProductPreview(URL.createObjectURL(garmentImage));

      setJobId(job.jobId);
      setStep('processing');

      // Step 2: Trigger AI inference while user sees the processing indicator
      await tryOnApi.process(job.jobId);
      await queryClient.invalidateQueries({ queryKey: ['job', job.jobId] });
      void refreshEntitlements();
      setIsSubmitting(false);
      setStep('result');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Request failed. Please try again.';
      setIsSubmitting(false);
      void refreshEntitlements();

      if (createdJobId) {
        setProcessError(message);
        await queryClient.invalidateQueries({ queryKey: ['job', createdJobId] });
        setStep('result');
      } else {
        setSubmitError(message);
      }
    }
  }, [
    isSubmitting,
    sponsoredSession,
    isStudioUploadable,
    activeSpec,
    personImage,
    garmentImage,
    personPreview,
    productPreview,
    queryClient,
    refreshEntitlements,
  ]);

  const handleEditInputs = useCallback(() => {
    setStep('upload');
    setJobId(null);
    setSubmitError(null);
    setProcessError(null);
  }, []);

  const handleReset = useCallback(() => {
    setStep('upload');
    setJobId(null);
    setPersonImage(null);
    setGarmentImage(null);
    setSubmitError(null);
    setProcessError(null);
    if (personPreview) {
      URL.revokeObjectURL(personPreview);
      setPersonPreview(null);
    }
    if (productPreview) {
      URL.revokeObjectURL(productPreview);
      setProductPreview(null);
    }
  }, [personPreview, productPreview]);

  const handleDeleteJob = useCallback(
    async (targetJobId: string) => {
      await tryOnApi.deleteJob(targetJobId);
      removeSessionJob(targetJobId);
      queryClient.removeQueries({ queryKey: ['job', targetJobId] });
      handleReset();
      setDeletedNotice('Try-on job and all associated images have been permanently deleted.');
    },
    [queryClient, handleReset],
  );

  const canSubmit =
    !!personImage &&
    !!garmentImage &&
    !isSubmitting &&
    isStudioUploadable &&
    !(sponsoredSession && !sponsoredSession.active);

  const fallbackJob: JobStatusResponse = processError
    ? {
        jobId: jobId ?? '',
        status: TryOnStatus.FAILED,
        category: activeSpec.dbCategory,
        subcategory: activeSpec.subcategory,
        errorMessage: processError,
        createdAt: new Date().toISOString(),
      }
    : {
        jobId: jobId ?? '',
        status: TryOnStatus.PROCESSING,
        category: activeSpec.dbCategory,
        subcategory: activeSpec.subcategory,
        createdAt: new Date().toISOString(),
      };

  const activeBadge = getSupportBadge(activeSpec);

  const steps = [
    { id: 'upload', label: '1. Select & Upload' },
    { id: 'processing', label: '2. AI Processing' },
    { id: 'result', label: '3. Review & Save Look' },
  ] as const;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 md:py-10">
      {/* Studio Header & 3-Step Flow Indicator */}
      <div className="mb-8 flex flex-col justify-between gap-4 border-b border-neutral-800/80 pb-6 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-violet-400">
            <Sparkles className="h-3.5 w-3.5" />
            <span>
              {sponsoredSession?.active && storeContext
                ? `In-Store Try-On · ${storeContext.storeName}`
                : 'Virtual Try-On Studio'}
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            Configure &amp; Run Try-On
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            Select a wearable category, upload your front-facing photo and product image, and inspect
            the result side-by-side.
          </p>
        </div>

        <ol
          data-testid="tryon-step-indicator"
          aria-label="Try-on progress"
          className="flex flex-wrap items-center gap-2"
        >
          {steps.map((s) => {
            const isCurrent = step === s.id;
            return (
              <li
                key={s.id}
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
                  isCurrent
                    ? 'border-violet-600 bg-violet-950/70 text-violet-200'
                    : 'border-neutral-800 bg-neutral-900/60 text-neutral-400',
                )}
              >
                {s.label}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Billing & Session Entitlement Mode Banner */}
      {sponsoredSession && !sponsoredSession.active ? (
        <div
          data-testid="expired-store-session-banner"
          className="mb-6 flex flex-col justify-between gap-4 rounded-2xl border border-amber-700/70 bg-amber-950/35 px-5 py-4 sm:flex-row sm:items-center"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-700/60 bg-amber-950/80 text-amber-300">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-amber-200">
                  In-Store Try-On Session Ended ({sponsoredSession.expiredReason ?? 'EXPIRED'})
                </span>
                {sponsoredSession.storeName && (
                  <span className="rounded bg-neutral-950/80 px-2 py-0.5 text-[11px] text-neutral-300">
                    {sponsoredSession.storeName}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-amber-100/90">
                {sponsoredSession.message}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={isSwitchingMode}
              onClick={handleSwitchToPersonalMode}
              className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50 transition-colors"
            >
              Continue with Personal WearMe
            </button>
            <span className="rounded-xl border border-amber-700/50 bg-amber-950/50 px-3 py-2 text-[11px] text-amber-200/90">
              Or scan the physical QR standee in store to check in again
            </span>
          </div>
        </div>
      ) : sponsoredSession?.active && storeContext ? (
        <div
          data-testid="active-store-session-banner"
          className="mb-6 flex flex-col justify-between gap-3 rounded-2xl border border-violet-800/50 bg-gradient-to-r from-violet-950/35 via-neutral-900/90 to-emerald-950/30 px-4 py-3.5 sm:flex-row sm:items-center"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-700/60 bg-violet-950/70 text-violet-300">
              <QrCode className="h-4 w-4" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1 font-semibold text-violet-200">
                  <Store className="h-3.5 w-3.5 text-emerald-400" />
                  Trying on at {storeContext.storeName} (Store-Sponsored Session)
                </span>
                <span className="rounded bg-emerald-950/80 border border-emerald-800/60 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                  {Math.max(1, Math.ceil((sponsoredSession.remainingSeconds ?? 3600) / 60))} min left
                </span>
                {typeof sponsoredSession.storeQuotaRemaining === 'number' && (
                  <span className="rounded bg-neutral-950/90 px-2 py-0.5 font-mono text-[11px] text-neutral-400">
                    Store quota remaining: {sponsoredSession.storeQuotaRemaining}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-neutral-400">
                Sponsored by {storeContext.storeName} while you are in store. Save your look with OTP after generation to keep it in your personal Digital Wardrobe.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {step === 'upload' && (
              <button
                type="button"
                data-testid="load-walkin-demo-button"
                onClick={handleLoadWalkInDemoInputs}
                className="shrink-0 rounded-xl border border-violet-700/60 bg-violet-950/60 px-3.5 py-2 text-xs font-semibold text-violet-200 hover:bg-violet-900/60 hover:text-white transition-colors"
              >
                Load Sample Walk-In QR Inputs
              </button>
            )}
            <button
              type="button"
              disabled={isSwitchingMode}
              onClick={handleSwitchToPersonalMode}
              className="shrink-0 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-medium text-neutral-300 hover:border-neutral-600 hover:text-white transition-colors"
            >
              Switch to Personal Mode
            </button>
          </div>
        </div>
      ) : (
        <div
          data-testid="personal-wearme-banner"
          className="mb-6 flex flex-col justify-between gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/70 px-4 py-3.5 sm:flex-row sm:items-center"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-800/60 bg-emerald-950/50 text-emerald-300">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-neutral-100">
                  Personal WearMe Mode
                </span>
                {entitlements?.personalEntitlement && (
                  <span className="rounded border border-emerald-800/60 bg-emerald-950/50 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                    Personal Allowance: {entitlements.personalEntitlement.remainingCredits} /{' '}
                    {entitlements.personalEntitlement.includedCredits} credits remaining
                  </span>
                )}
                {activeSessionToken && (
                  <span className="rounded bg-neutral-950/90 px-2 py-0.5 font-mono text-[11px] text-neutral-500">
                    Session: {activeSessionToken.slice(0, 14)}…
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-neutral-400">
                Try-ons here use your Personal WearMe allowance and never charge any partner boutique.
                {entitlements?.originStoreAttribution?.storeName
                  ? ` (Originally joined via ${entitlements.originStoreAttribution.storeName} — first-touch attribution only.)`
                  : ''}
              </p>
            </div>
          </div>
          {step === 'upload' && (
            <button
              type="button"
              data-testid="load-walkin-demo-button"
              onClick={handleLoadWalkInDemoInputs}
              className="shrink-0 rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 py-2 text-xs font-semibold text-neutral-200 hover:border-violet-700/60 hover:text-white transition-colors"
            >
              Load Sample Studio Inputs
            </button>
          )}
        </div>
      )}

      {deletedNotice && (
        <div className="mb-6 flex items-center gap-2.5 rounded-xl border border-emerald-800/80 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>{deletedNotice}</span>
        </div>
      )}

      {step === 'upload' ? (
        <div className="grid gap-8 lg:grid-cols-12">
          {/* Left Column: Category Selection + Uploads */}
          <div className="flex flex-col gap-6 lg:col-span-7">
            {/* Step 1: Wearable Domain & Subcategory Selector */}
            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5 sm:p-6">
              <div className="mb-4 flex items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-violet-400">
                    Step 1
                  </span>
                  <h2 className="text-base font-semibold text-neutral-100">
                    Select Wearable Category &amp; Subcategory
                  </h2>
                </div>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
                    activeBadge.className,
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', activeBadge.dotClass)} />
                  {activeBadge.label}
                </span>
              </div>

              {/* Domain Tabs */}
              <div className="mb-4">
                <label className="mb-2 block text-xs font-medium text-neutral-400">
                  Wearable Domain (8 domains)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {Object.keys(DOMAIN_LABELS).map((domain) => {
                    const isSelected = selectedDomain === domain;
                    return (
                      <button
                        key={domain}
                        type="button"
                        onClick={() => handleSelectDomain(domain)}
                        className={cn(
                          'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                          isSelected
                            ? 'border-violet-500 bg-violet-600/20 text-violet-200'
                            : 'border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200',
                        )}
                      >
                        {DOMAIN_LABELS[domain] ?? domain}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Subcategory Pills */}
              <div>
                <label className="mb-2 block text-xs font-medium text-neutral-400">
                  Subcategory ({domainSubcategories.length} in{' '}
                  {DOMAIN_LABELS[selectedDomain] ?? selectedDomain})
                </label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {domainSubcategories.map((item) => {
                    const isSelected = selectedSubcategory === item.subcategory;
                    const badge = getSupportBadge(item);
                    return (
                      <button
                        key={item.subcategory}
                        type="button"
                        onClick={() => {
                          setSelectedSubcategory(item.subcategory);
                          setSubmitError(null);
                        }}
                        className={cn(
                          'flex flex-col items-start justify-between rounded-xl border p-3 text-left transition-all',
                          isSelected
                            ? 'border-violet-500 bg-violet-950/30 ring-1 ring-violet-500/40'
                            : 'border-neutral-800 bg-neutral-950/70 hover:border-neutral-700',
                        )}
                      >
                        <div className="flex w-full items-center justify-between gap-1">
                          <span className="text-xs font-semibold text-neutral-100">
                            {item.label}
                          </span>
                          <span
                            className={cn('h-2 w-2 shrink-0 rounded-full', badge.dotClass)}
                            title={badge.label}
                          />
                        </div>
                        <span className="mt-1.5 text-[11px] text-neutral-400">
                          {badge.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Active Subcategory Status Notice */}
              {isNecklacePoc && (
                <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-700/60 bg-amber-950/25 p-3.5 text-xs text-amber-200/90">
                  <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <div>
                    <p className="font-semibold text-amber-200">
                      Experimental PoC · Necklace &amp; Pendant Local CV Pipeline
                    </p>
                    <p className="mt-0.5 leading-relaxed text-amber-300/80">
                      Routes to <code className="text-amber-200">landmark_jewellery_neck</code>{' '}
                      (10-stage MediaPipe neck/clavicle landmark detection, product alpha extraction,
                      geometric placement &amp; chin occlusion). Requires{' '}
                      <code className="text-amber-200">ENABLE_NECKLACE_POC=true</code> on the backend
                      services.
                    </p>
                  </div>
                </div>
              )}

              {!isStudioUploadable && (
                <div className="mt-4 flex items-start gap-3 rounded-xl border border-neutral-700 bg-neutral-950 p-4 text-xs text-neutral-300">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
                  <div>
                    <p className="font-semibold text-neutral-100">
                      {activeSpec.label} — Requires Specialized Model (
                      <code className="text-violet-300">{activeSpec.routingStrategy}</code>)
                    </p>
                    <p className="mt-1 leading-relaxed text-neutral-400">
                      Target anatomical region:{' '}
                      <code className="text-neutral-200">{activeSpec.targetBodyRegion}</code>. WearMe
                      does not route non-upper-body or non-necklace items through upper-body clothing
                      diffusion models to avoid fabricated or distorted outputs. Select an{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDomain(WearableDomain.CLOTHING);
                          setSelectedSubcategory('TSHIRT');
                        }}
                        className="font-medium text-violet-400 underline hover:text-violet-300"
                      >
                        Upper-Body Garment
                      </button>{' '}
                      or{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDomain(WearableDomain.JEWELLERY);
                          setSelectedSubcategory('NECKLACE');
                        }}
                        className="font-medium text-amber-400 underline hover:text-amber-300"
                      >
                        Necklace / Pendant PoC
                      </button>{' '}
                      to run a try-on job.
                    </p>
                  </div>
                </div>
              )}
            </section>

            {/* Step 2: Image Uploads */}
            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5 sm:p-6">
              <div className="mb-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-violet-400">
                  Step 2
                </span>
                <h2 className="text-base font-semibold text-neutral-100">
                  Upload Person &amp; {isNecklacePoc ? 'Jewellery Product' : 'Garment'} Images
                </h2>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <ImageUpload
                  label="1. Your Photo (Person)"
                  hint={
                    isNecklacePoc
                      ? 'Front-facing portrait with clearly visible chin, neck & collarbone (min 512×512 px)'
                      : 'Clear, front-facing upper-body photo in good lighting (JPEG, PNG, WebP · max 10 MB)'
                  }
                  value={personImage}
                  onChange={(file) => {
                    setPersonImage(file);
                    setSubmitError(null);
                    setDeletedNotice(null);
                  }}
                  disabled={isSubmitting || !isStudioUploadable}
                />
                <ImageUpload
                  label={
                    isNecklacePoc
                      ? `2. ${activeSpec.label} Cutout / Photo`
                      : `2. ${activeSpec.label} Image`
                  }
                  hint={
                    isNecklacePoc
                      ? 'Transparent PNG or clean high-contrast background product image of the necklace/pendant'
                      : `Clean product photo or flat-lay of the ${activeSpec.label.toLowerCase()} (max 10 MB)`
                  }
                  value={garmentImage}
                  onChange={(file) => {
                    setGarmentImage(file);
                    setSubmitError(null);
                    setDeletedNotice(null);
                  }}
                  disabled={isSubmitting || !isStudioUploadable}
                />
              </div>

              {/* Error Banner */}
              {submitError && (
                <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-900 bg-red-950/30 px-4 py-3 text-xs text-red-300 sm:text-sm">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  <span>{submitError}</span>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={cn(
                  'mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-4 text-sm font-semibold transition-all sm:text-base',
                  canSubmit
                    ? 'bg-violet-600 text-white shadow-lg shadow-violet-950/40 hover:bg-violet-500'
                    : 'cursor-not-allowed border border-neutral-800 bg-neutral-900 text-neutral-500',
                )}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Uploading &amp; processing try-on…
                  </>
                ) : !isStudioUploadable ? (
                  <>
                    <Clock className="h-4 w-4" />
                    {activeSpec.label} Requires Specialized Model
                  </>
                ) : (
                  <>
                    <Sparkles className="h-5 w-5" />
                    Generate {activeSpec.label} Try-On
                  </>
                )}
              </button>
            </section>
          </div>

          {/* Right Column: Live Guidance, Technical Spec & Input Readiness */}
          <div className="flex flex-col gap-6 lg:col-span-5">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5 sm:p-6">
              <div className="mb-4 flex items-center gap-2">
                <Info className="h-4 w-4 text-violet-400" />
                <h3 className="text-sm font-semibold text-neutral-100">
                  Selected Category Pipeline Spec
                </h3>
              </div>

              <dl className="space-y-3 text-xs">
                <div className="flex items-center justify-between border-b border-neutral-800/80 pb-2.5">
                  <dt className="text-neutral-400">Subcategory</dt>
                  <dd className="font-semibold text-neutral-100">
                    {activeSpec.label} ({activeSpec.subcategory})
                  </dd>
                </div>
                <div className="flex items-center justify-between border-b border-neutral-800/80 pb-2.5">
                  <dt className="text-neutral-400">Target Body Region</dt>
                  <dd className="font-mono text-neutral-200">{activeSpec.targetBodyRegion}</dd>
                </div>
                <div className="flex items-center justify-between border-b border-neutral-800/80 pb-2.5">
                  <dt className="text-neutral-400">Routing Strategy</dt>
                  <dd className="font-mono text-violet-300">{activeSpec.routingStrategy}</dd>
                </div>
                  <div>
                  <dt className="mb-1.5 text-neutral-400">Required Anatomical Landmarks</dt>
                  <dd className="flex flex-wrap gap-1.5">
                    {activeSpec.requiredLandmarks.map((lm) => (
                      <span
                        key={lm}
                        className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-0.5 font-mono text-[11px] text-neutral-300"
                      >
                        {lm}
                      </span>
                    ))}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 border-t border-neutral-800/80 pt-3">
                <Link
                  href="/categories"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-300 hover:text-violet-200"
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span>Inspect all 38 wearable subcategories &amp; routing status</span>
                </Link>
              </div>
            </div>

            {/* Best Results Checklist */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5 sm:p-6">
              <div className="mb-4 flex items-center gap-2">
                {isNecklacePoc ? (
                  <Gem className="h-4 w-4 text-amber-400" />
                ) : (
                  <Shirt className="h-4 w-4 text-violet-400" />
                )}
                <h3 className="text-sm font-semibold text-neutral-100">
                  {isNecklacePoc
                    ? 'Necklace / Pendant PoC Input Requirements'
                    : 'Upper-Body Garment Try-On Tips'}
                </h3>
              </div>

              <ul className="space-y-2.5 text-xs text-neutral-300">
                {isNecklacePoc ? (
                  <>
                    <li className="flex items-start gap-2">
                      <Camera className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                      <span>
                        <strong>Exposed Neck &amp; Clavicle:</strong> Use a front-facing photo (yaw
                        ≤ 25°) where the chin, neck base, and shoulders are unobstructed by scarves
                        or high collars.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                      <span>
                        <strong>Product Cutout:</strong> Transparent PNGs or necklaces photographed
                        against a uniform white/solid background produce the sharpest chain alpha
                        matte.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                      <span>
                        <strong>Honest Failure Handling:</strong> If landmarks cannot be detected or
                        the product matte is empty, WearMe reports a clear diagnostic error instead
                        of returning a fake image.
                      </span>
                    </li>
                  </>
                ) : (
                  <>
                    <li className="flex items-start gap-2">
                      <Camera className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-400" />
                      <span>
                        <strong>Front-Facing Pose:</strong> Stand facing the camera with arms
                        slightly relaxed at your sides and even lighting.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-400" />
                      <span>
                        <strong>Identity &amp; Lower-Body Preservation:</strong> Only the upper-body
                        torso region is composited—preserving your face, hair, skin tone, and
                        bottomwear.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-400" />
                      <span>
                        <strong>Clean Garment Image:</strong> Use a single flat-lay or catalog photo
                        of the garment without another person wearing it when possible.
                      </span>
                    </li>
                  </>
                )}
              </ul>
            </div>
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-4xl">
          <TryOnResult
            job={
              jobStatus &&
              (jobStatus.status === TryOnStatus.COMPLETED ||
                jobStatus.status === TryOnStatus.FAILED)
                ? jobStatus
                : fallbackJob
            }
            personPreview={personPreview}
            productPreview={productPreview}
            onReset={handleReset}
            onEditInputs={handleEditInputs}
            onDelete={handleDeleteJob}
          />
        </div>
      )}
    </div>
  );
}

export default function TryOnPage() {
  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-neutral-50">
      <SiteHeader />
      <main className="flex-1">
        <Suspense
          fallback={
            <div className="flex min-h-[60vh] items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
            </div>
          }
        >
          <TryOnStudioContent />
        </Suspense>
      </main>
      <SiteFooter />
    </div>
  );
}
