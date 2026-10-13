'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Download,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  FlaskConical,
  Loader2,
  Trash2,
  Columns2,
  SlidersHorizontal,
  Clock,
  Cpu,
  BookmarkCheck,
  Smartphone,
  ShieldCheck,
  ArrowRight,
  Store,
  KeyRound,
  Mail,
  MessageSquare,
  Lock,
} from 'lucide-react';
import type { JobStatusResponse, OtpChannel } from '@wearme/shared';
import { TryOnStatus } from '@wearme/shared';
import { tryOnApi } from '@/lib/api-client';
import {
  getStoredAuthToken,
  getStoredStoreContext,
  getStoredUserProfile,
  isBrowserAuthenticated,
  setStoredAuthSession,
} from '@/lib/job-history';
import { cn } from '@/lib/utils';

interface TryOnResultProps {
  job: JobStatusResponse;
  personPreview: string | null;
  productPreview?: string | null;
  onReset: () => void;
  onEditInputs?: () => void;
  onDelete?: (jobId: string) => Promise<void>;
}

type ViewMode = 'side-by-side' | 'slider';
type SaveStep = 'idle' | 'phone' | 'otp' | 'saved';

export function TryOnResult({
  job,
  personPreview,
  productPreview,
  onReset,
  onEditInputs,
  onDelete,
}: TryOnResultProps) {
  const router = useRouter();
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side');
  const [sliderPercent, setSliderPercent] = useState(50);
  const [resultImageError, setResultImageError] = useState(false);

  // Network Effect Flywheel state ("Save Look to Wardrobe")
  const [saveStep, setSaveStep] = useState<SaveStep>('idle');
  const [otpChannel, setOtpChannel] = useState<OtpChannel>('whatsapp');
  const [phoneInput, setPhoneInput] = useState('+91 98765 43210');
  const [emailInput, setEmailInput] = useState('shopper@wearme.example');
  const [otpInput, setOtpInput] = useState('');
  const [devOtpHint, setDevOtpHint] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [verifiedIdentity, setVerifiedIdentity] = useState<string | null>(null);
  const [storeLabel, setStoreLabel] = useState<string>('Studio Namma Indiranagar');

  useEffect(() => {
    setResultImageError(false);
  }, [job.resultUrl, job.jobId]);

  useEffect(() => {
    const isAuth = isBrowserAuthenticated() || Boolean(getStoredAuthToken());
    const existingProfile = getStoredUserProfile();
    const storeCtx = getStoredStoreContext();
    if (storeCtx?.storeName) {
      setStoreLabel(storeCtx.storeName);
    }
    if (isAuth && existingProfile) {
      setVerifiedIdentity(existingProfile.phoneE164 || existingProfile.email || 'Verified Account');
      if (job.savedToWardrobe) {
        setSaveStep('saved');
      }
    }
  }, [job.savedToWardrobe, job.jobId]);

  const canDownload =
    job.status === TryOnStatus.COMPLETED && Boolean(job.resultUrl) && !resultImageError;

  const handleDownload = async () => {
    if (!canDownload || !job.resultUrl) return;
    setDownloading(true);
    try {
      const res = await fetch(job.resultUrl, { credentials: 'include' });
      if (!res.ok) {
        setResultImageError(true);
        throw new Error('Failed to fetch generated image');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const subcatSlug = (job.subcategory || job.category || 'tryon').toLowerCase();
      a.download = `wearme-${subcatSlug}-${job.jobId.slice(0, 8)}.jpg`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete || !job.jobId) return;
    setDeleting(true);
    try {
      await onDelete(job.jobId);
    } finally {
      setDeleting(false);
    }
  };

  const handleStartSaveToWardrobe = async () => {
    setSaveError(null);
    const isAuth = isBrowserAuthenticated() || Boolean(getStoredAuthToken());
    if (isAuth && job.jobId) {
      setSaveBusy(true);
      try {
        await tryOnApi.saveJobToWardrobe(job.jobId);
        setSaveStep('saved');
      } catch {
        // Session may have expired; fall back to OTP upgrade flow
        setSaveStep('phone');
      } finally {
        setSaveBusy(false);
      }
      return;
    }
    setSaveStep('phone');
  };

  const activeTarget = otpChannel === 'email' ? emailInput.trim() : phoneInput.trim();

  const handleRequestOtp = async () => {
    if (!activeTarget || saveBusy) return;
    setSaveBusy(true);
    setSaveError(null);
    try {
      const storeCtx = getStoredStoreContext();
      const res = await tryOnApi.requestOtp({
        channel: otpChannel,
        phone: otpChannel !== 'email' ? phoneInput.trim() : undefined,
        email: otpChannel === 'email' ? emailInput.trim() : undefined,
        storeId: storeCtx?.storeId ?? 'store_indiranagar_01',
        storeName: storeCtx?.storeName ?? storeLabel,
      });
      setDevOtpHint(res.devOtpPreview ?? null);
      if (res.devOtpPreview) {
        setOtpInput(res.devOtpPreview);
      }
      setSaveStep('otp');
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to send verification OTP.');
    } finally {
      setSaveBusy(false);
    }
  };

  const handleVerifyOtpAndUpgrade = async () => {
    if (!otpInput.trim() || saveBusy) return;
    setSaveBusy(true);
    setSaveError(null);
    try {
      const storeCtx = getStoredStoreContext();
      const res = await tryOnApi.upgradeSession({
        channel: otpChannel,
        phone: otpChannel !== 'email' ? phoneInput.trim() : undefined,
        email: otpChannel === 'email' ? emailInput.trim() : undefined,
        otpCode: otpInput.trim(),
        jobId: job.jobId,
        storeId: storeCtx?.storeId ?? 'store_indiranagar_01',
        storeName: storeCtx?.storeName ?? storeLabel,
      });
      setStoredAuthSession(res.authToken, res.user);
      setVerifiedIdentity(res.user.phoneE164 || res.user.email || 'Verified Account');
      setSaveStep('saved');
      router.push('/my-wardrobe');
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Invalid OTP verification code.');
    } finally {
      setSaveBusy(false);
    }
  };

  if (job.status === TryOnStatus.FAILED) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-red-900/80 bg-red-950/20 p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-red-800/60 bg-red-950/60 text-red-400">
          <AlertCircle className="h-6 w-6" />
        </div>
        <div className="max-w-lg">
          <p className="text-base font-semibold text-red-200">Virtual try-on failed</p>
          <p className="mt-1.5 text-sm leading-relaxed text-red-300/90">
            {job.errorMessage ?? 'An unexpected error occurred during processing.'}
          </p>
          <p className="mt-2 text-xs text-neutral-400">
            WearMe never returns an unmodified portrait or a fake overlay when inference fails.
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          {onEditInputs && (
            <button
              type="button"
              data-testid="adjust-inputs-keep-photos-button"
              onClick={onEditInputs}
              className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Adjust inputs (keep photos)
            </button>
          )}
          <button
            type="button"
            onClick={onReset}
            className="flex items-center gap-2 rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-200 hover:bg-neutral-700"
          >
            <RefreshCw className="h-4 w-4" />
            Start fresh try-on
          </button>
          {onDelete && job.jobId && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-2 rounded-lg border border-red-800/60 bg-red-950/40 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-900/40 disabled:opacity-60"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete uploaded images immediately
            </button>
          )}
        </div>
      </div>
    );
  }

  if (job.status === TryOnStatus.PROCESSING || job.status === TryOnStatus.PENDING) {
    return (
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-neutral-800 bg-neutral-900/80 p-10 text-center">
        <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-violet-800/60 bg-violet-950/40">
          <Loader2 className="h-7 w-7 animate-spin text-violet-400" />
        </div>
        <div className="max-w-md">
          <p className="text-base font-semibold text-white">
            Generating your {job.subcategory || job.category} try-on…
          </p>
          <p className="mt-1.5 text-sm text-neutral-400">
            Validating inputs, isolating the target anatomical region, and preserving original face,
            skin tone, and non-target clothing.
          </p>
        </div>
        <div className="grid w-full max-w-md grid-cols-3 gap-2 pt-2 text-left text-xs">
          <div className="rounded-lg border border-violet-800/50 bg-violet-950/30 p-2.5 text-violet-200">
            <span className="block font-semibold">1. Validation</span>
            <span className="text-[11px] text-violet-300/80">MIME &amp; signature verified</span>
          </div>
          <div className="rounded-lg border border-violet-800/50 bg-violet-950/30 p-2.5 text-violet-200">
            <span className="block font-semibold">2. Inference</span>
            <span className="text-[11px] text-violet-300/80">Region-aware synthesis</span>
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-2.5 text-neutral-400">
            <span className="block font-semibold">3. Compositing</span>
            <span className="text-[11px] text-neutral-500">Identity &amp; proportion lock</span>
          </div>
        </div>
      </div>
    );
  }

  if (job.status === TryOnStatus.COMPLETED && job.resultUrl) {
    const isMock = job.aiProvider === 'mock' || Boolean(job.isMock);
    const isExperimentalPoc =
      Boolean(job.isExperimentalPoc) || job.aiProvider === 'necklace-poc';
    const originalSrc = personPreview ?? job.personImageUrl ?? null;
    const productSrc = productPreview ?? job.garmentImageUrl ?? null;
    const inferenceMs =
      typeof job.aiProviderMeta?.['inferenceMs'] === 'number'
        ? (job.aiProviderMeta['inferenceMs'] as number)
        : typeof job.aiProviderMeta?.['elapsed_ms'] === 'number'
          ? (job.aiProviderMeta['elapsed_ms'] as number)
          : null;
    const targetRegion =
      typeof job.aiProviderMeta?.['target_body_region'] === 'string'
        ? (job.aiProviderMeta['target_body_region'] as string)
        : null;

    return (
      <div className="flex flex-col gap-5">
        {isMock && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-700/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <div>
              <p className="font-semibold text-amber-300">
                MOCK MODE — Pipeline Test Output (Not Real AI)
              </p>
              <p className="mt-0.5 text-xs text-amber-200/80">
                This image was generated by the deterministic local MockProvider overlay. To run
                real upper-body diffusion inference, set{' '}
                <code className="rounded bg-amber-900/50 px-1 py-0.5">
                  AI_PROVIDER=huggingface
                </code>{' '}
                (non-commercial) or{' '}
                <code className="rounded bg-amber-900/50 px-1 py-0.5">AI_PROVIDER=fashn-api</code>.
              </p>
            </div>
          </div>
        )}

        {isExperimentalPoc && (
          <div className="flex items-start gap-3 rounded-xl border border-fuchsia-700/60 bg-fuchsia-950/30 px-4 py-3 text-sm text-fuchsia-200">
            <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-fuchsia-400" />
            <div>
              <p className="font-semibold text-fuchsia-300">
                Experimental PoC — Landmark-Guided Necklace / Pendant Processor
              </p>
              <p className="mt-0.5 text-xs text-fuchsia-200/80">
                Generated locally via{' '}
                <code className="rounded bg-fuchsia-900/50 px-1 py-0.5">
                  landmark_jewellery_neck
                </code>{' '}
                (chin, suprasternal notch &amp; medial clavicle anchor detection + catenary warp +
                chin/hair occlusion mask). Pixels outside the neck/clavicle placement box remain
                100% identical to your original portrait.
              </p>
            </div>
          </div>
        )}

        {/* Status & Telemetry Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900/80 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2.5 text-sm">
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-400">
              <CheckCircle className="h-4 w-4" />
              Try-on complete
            </span>
            <span className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-0.5 text-xs font-medium text-neutral-300">
              {job.subcategory || job.category}
            </span>
            {targetRegion && (
              <span className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-xs text-neutral-400">
                Region: {targetRegion}
              </span>
            )}
            {inferenceMs !== null && (
              <span className="inline-flex items-center gap-1 text-xs text-neutral-400">
                <Clock className="h-3.5 w-3.5" />
                {(inferenceMs / 1000).toFixed(2)}s
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {job.aiProvider && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 text-xs font-medium',
                  isMock
                    ? 'border-amber-700/50 bg-amber-950/40 text-amber-300'
                    : isExperimentalPoc
                      ? 'border-fuchsia-700/50 bg-fuchsia-950/40 text-fuchsia-300'
                      : 'border-violet-700/50 bg-violet-950/40 text-violet-300',
                )}
              >
                <Cpu className="h-3 w-3" />
                {isMock
                  ? 'mock (pipeline test)'
                  : isExperimentalPoc
                    ? 'necklace-poc (experimental)'
                    : `${job.aiProvider} (live AI)`}
              </span>
            )}

            {originalSrc && (
              <div className="flex rounded-lg border border-neutral-800 bg-neutral-950 p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode('side-by-side')}
                  className={cn(
                    'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    viewMode === 'side-by-side'
                      ? 'bg-violet-600 text-white'
                      : 'text-neutral-400 hover:text-white',
                  )}
                >
                  <Columns2 className="h-3.5 w-3.5" />
                  Side-by-Side
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('slider')}
                  className={cn(
                    'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    viewMode === 'slider'
                      ? 'bg-violet-600 text-white'
                      : 'text-neutral-400 hover:text-white',
                  )}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Compare Slider
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Comparison Viewer */}
        {viewMode === 'slider' && originalSrc ? (
          <div className="flex flex-col gap-3">
            <div className="relative mx-auto aspect-[3/4] w-full max-w-lg select-none overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
              {/* Base layer: Generated Result */}
              <Image
                src={job.resultUrl}
                alt="Try-on result"
                fill
                className="object-contain"
                sizes="(max-width: 768px) 100vw, 512px"
                unoptimized
                onError={() => setResultImageError(true)}
              />
              {/* Clipped overlay layer: Original Portrait */}
              <div
                className="absolute inset-0 overflow-hidden"
                style={{ clipPath: `inset(0 ${100 - sliderPercent}% 0 0)` }}
              >
                <Image
                  src={originalSrc}
                  alt="Original portrait"
                  fill
                  className="object-contain"
                  sizes="(max-width: 768px) 100vw, 512px"
                  unoptimized
                />
              </div>
              {/* Vertical divider line */}
              <div
                className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-white shadow-[0_0_10px_rgba(0,0,0,0.8)]"
                style={{ left: `${sliderPercent}%` }}
              >
                <div className="absolute left-1/2 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/80 bg-neutral-950/90 text-white shadow-lg">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                </div>
              </div>
              <span className="pointer-events-none absolute left-3 top-3 rounded bg-black/70 px-2 py-0.5 text-[11px] font-medium text-neutral-200">
                Before (Original)
              </span>
              <span className="pointer-events-none absolute right-3 top-3 rounded bg-violet-950/85 px-2 py-0.5 text-[11px] font-medium text-violet-200">
                After (Try-On)
              </span>
            </div>

            <div className="mx-auto flex w-full max-w-lg items-center gap-3 px-2">
              <span className="text-xs text-neutral-400">Original</span>
              <input
                type="range"
                min={0}
                max={100}
                value={sliderPercent}
                onChange={(e) => setSliderPercent(Number(e.target.value))}
                aria-label="Before and after comparison slider"
                className="h-1.5 flex-1 cursor-pointer appearance-none rounded-lg bg-neutral-800 accent-violet-500"
              />
              <span className="text-xs text-violet-300">Try-On Result</span>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              'grid gap-4',
              productSrc ? 'md:grid-cols-3' : 'md:grid-cols-2',
            )}
          >
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium uppercase tracking-wider text-neutral-400">
                1. Original Portrait
              </p>
              <div className="relative aspect-[3/4] overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
                {originalSrc ? (
                  <Image
                    src={originalSrc}
                    alt="Original photo"
                    fill
                    className="object-contain"
                    sizes="(max-width: 768px) 100vw, 33vw"
                    unoptimized
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-neutral-600">
                    Original preview unavailable
                  </div>
                )}
              </div>
            </div>

            {productSrc && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-wider text-neutral-400">
                  2. Selected Product ({job.subcategory || job.category})
                </p>
                <div className="relative aspect-[3/4] overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
                  <Image
                    src={productSrc}
                    alt="Product input"
                    fill
                    className="object-contain p-3"
                    sizes="(max-width: 768px) 100vw, 33vw"
                    unoptimized
                  />
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium uppercase tracking-wider text-violet-300">
                {productSrc ? '3. ' : '2. '}
                {isMock
                  ? 'Mock Composite Result'
                  : isExperimentalPoc
                    ? 'Experimental PoC Result'
                    : 'AI Try-On Result'}
              </p>
              <div className="relative aspect-[3/4] overflow-hidden rounded-xl border border-violet-800/60 bg-neutral-900">
                {resultImageError ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-red-300">
                    <AlertCircle className="h-5 w-5 text-red-400" />
                    <span>Result image is no longer available on the server.</span>
                  </div>
                ) : (
                  <Image
                    src={job.resultUrl}
                    alt="Try-on result"
                    fill
                    className="object-contain"
                    sizes="(max-width: 768px) 100vw, 33vw"
                    unoptimized
                    onError={() => setResultImageError(true)}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {/* Network Effect Flywheel: "Save Look to Digital Wardrobe" (B2B2C -> B2C Handoff) */}
        <div className="rounded-2xl border border-emerald-700/60 bg-gradient-to-br from-emerald-950/35 via-neutral-900/90 to-violet-950/30 p-5">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div className="flex items-start gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-700/60 bg-emerald-950/70 text-emerald-300">
                <BookmarkCheck className="h-5 w-5" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-white">
                    {saveStep === 'saved'
                      ? 'Saved to Your Digital Wardrobe'
                      : 'Save Look to Digital Wardrobe (B2B2C → B2C Flywheel)'}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-700/50 bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
                    <Store className="h-3 w-3" />
                    {storeLabel}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-neutral-300">
                  {saveStep === 'saved'
                    ? `Your base portrait and this ${job.subcategory || job.category} look are permanently saved${verifiedIdentity ? ` for ${verifiedIdentity}` : ''}. Try on items across online B2C brands without re-uploading your photo.`
                    : 'Verify via WhatsApp, SMS, or Email OTP to upgrade this anonymous store session into a persistent Digital Wardrobe. Your base photo is saved so you can try on outfits from cross-platform online brands in 1 click.'}
                </p>
                <p className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-300/90">
                  <Lock className="h-3 w-3 shrink-0 text-emerald-400" />
                  Privacy Boundary: The shopkeeper cannot view your portrait or generated try-on images.
                </p>
              </div>
            </div>

            {saveStep === 'idle' && (
              <button
                type="button"
                data-testid="save-to-wardrobe-trigger"
                onClick={handleStartSaveToWardrobe}
                disabled={saveBusy}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-md shadow-emerald-950/60 hover:bg-emerald-500 disabled:opacity-60 sm:text-sm"
              >
                {saveBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Smartphone className="h-4 w-4" />
                )}
                {verifiedIdentity ? 'Save Look to My Wardrobe' : 'Save to Wardrobe (OTP)'}
              </button>
            )}

            {saveStep === 'saved' && (
              <Link
                href="/my-wardrobe"
                data-testid="open-my-wardrobe-link"
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-md shadow-emerald-950/60 hover:bg-emerald-500 sm:text-sm"
              >
                <BookmarkCheck className="h-4 w-4" />
                Open My Wardrobe
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>

          {saveStep === 'phone' && (
            <div className="mt-4 border-t border-neutral-800/80 pt-4">
              {/* Channel selector */}
              <div className="mb-3 flex flex-wrap gap-2">
                {(['whatsapp', 'sms', 'email'] as const).map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => {
                      setOtpChannel(ch);
                      setSaveError(null);
                    }}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                      otpChannel === ch
                        ? 'border-emerald-600 bg-emerald-950/70 text-emerald-200'
                        : 'border-neutral-800 bg-neutral-950 text-neutral-400 hover:text-white',
                    )}
                  >
                    {ch === 'whatsapp' && <Smartphone className="h-3.5 w-3.5 text-emerald-400" />}
                    {ch === 'sms' && <MessageSquare className="h-3.5 w-3.5 text-violet-400" />}
                    {ch === 'email' && <Mail className="h-3.5 w-3.5 text-sky-400" />}
                    {ch === 'whatsapp' ? 'WhatsApp OTP' : ch === 'sms' ? 'SMS OTP' : 'Email OTP'}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label
                    htmlFor="wardrobe-phone-input"
                    className="mb-1.5 block text-xs font-medium text-neutral-300"
                  >
                    {otpChannel === 'email'
                      ? 'Email Address (for instant OTP session upgrade)'
                      : `${otpChannel === 'whatsapp' ? 'WhatsApp' : 'SMS'} Mobile Number (for instant OTP session upgrade)`}
                  </label>
                  {otpChannel === 'email' ? (
                    <input
                      id="wardrobe-phone-input"
                      data-testid="wardrobe-email-input"
                      type="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 py-2.5 text-sm text-white placeholder:text-neutral-500 focus:border-emerald-500 focus:outline-none"
                    />
                  ) : (
                    <input
                      id="wardrobe-phone-input"
                      data-testid="wardrobe-phone-input"
                      type="tel"
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                      placeholder="+91 98765 43210"
                      className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 py-2.5 text-sm text-white placeholder:text-neutral-500 focus:border-emerald-500 focus:outline-none"
                    />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-testid="request-otp-button"
                    onClick={handleRequestOtp}
                    disabled={saveBusy || !activeTarget}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                  >
                    {saveBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Smartphone className="h-4 w-4" />
                    )}
                    Send OTP
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSaveStep('idle');
                      setSaveError(null);
                    }}
                    className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-xs font-medium text-neutral-400 hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              </div>
              {saveError && (
                <p className="mt-2 text-xs text-red-400" role="alert">
                  {saveError}
                </p>
              )}
            </div>
          )}

          {saveStep === 'otp' && (
            <div className="mt-4 border-t border-neutral-800/80 pt-4">
              {devOtpHint && (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-700/60 bg-amber-950/30 px-3.5 py-2 text-xs text-amber-200">
                  <span className="inline-flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5 text-amber-400" />
                    Local Dev Sandbox OTP ({otpChannel.toUpperCase()}):{' '}
                    <code className="rounded bg-amber-900/60 px-1.5 py-0.5 font-mono font-bold text-amber-100">
                      {devOtpHint}
                    </code>
                  </span>
                  <button
                    type="button"
                    onClick={() => setOtpInput(devOtpHint)}
                    className="font-semibold text-amber-300 underline hover:text-white"
                  >
                    Fill {devOtpHint}
                  </button>
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label
                    htmlFor="wardrobe-otp-input"
                    className="mb-1.5 block text-xs font-medium text-neutral-300"
                  >
                    Enter 6-Digit OTP sent to {activeTarget}
                  </label>
                  <input
                    id="wardrobe-otp-input"
                    data-testid="wardrobe-otp-input"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 py-2.5 font-mono text-sm tracking-widest text-white placeholder:text-neutral-500 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-testid="verify-upgrade-button"
                    onClick={handleVerifyOtpAndUpgrade}
                    disabled={saveBusy || otpInput.length !== 6}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                  >
                    {saveBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-4 w-4" />
                    )}
                    Verify &amp; Upgrade to Wardrobe
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSaveStep('phone');
                      setSaveError(null);
                    }}
                    className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-xs font-medium text-neutral-400 hover:text-white"
                  >
                    Change Channel
                  </button>
                </div>
              </div>
              {saveError && (
                <p className="mt-2 text-xs text-red-400" role="alert">
                  {saveError}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-3 pt-1">
          <button
            type="button"
            onClick={handleDownload}
            disabled={!canDownload || downloading}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-violet-950/50 hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {downloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Download generated image
          </button>
          {onEditInputs && (
            <button
              type="button"
              data-testid="adjust-inputs-keep-photos-button"
              onClick={onEditInputs}
              className="flex items-center gap-2 rounded-xl border border-violet-700/60 bg-violet-950/40 px-4 py-3 text-sm font-medium text-violet-200 hover:bg-violet-900/60 hover:text-white"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Adjust inputs (keep photos)
            </button>
          )}
          <button
            type="button"
            onClick={onReset}
            className="flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm font-medium text-neutral-200 hover:border-neutral-600 hover:text-white"
          >
            <RefreshCw className="h-4 w-4" />
            New try-on
          </button>
          {onDelete && job.jobId && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-2 rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm font-medium text-red-300 hover:bg-red-900/40 disabled:opacity-60"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete job &amp; images
            </button>
          )}
        </div>
      </div>
    );
  }

  return null;
}
