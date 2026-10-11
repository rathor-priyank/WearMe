'use client';

import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowLeft, Sparkles, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { ImageUpload } from '@/components/image-upload';
import { TryOnResult } from '@/components/try-on-result';
import { tryOnApi } from '@/lib/api-client';
import { V1_CLOTHING_CATEGORIES, TryOnStatus } from '@wearme/shared';
import type { JobStatusResponse } from '@wearme/shared';
import { cn } from '@/lib/utils';

const CATEGORY_LABELS: Record<string, string> = {
  TOP: 'Top',
  SHIRT: 'Shirt',
  TSHIRT: 'T-Shirt',
  JACKET: 'Jacket',
};

type Step = 'upload' | 'processing' | 'result';

export default function TryOnPage() {
  const queryClient = useQueryClient();
  const [personImage, setPersonImage] = useState<File | null>(null);
  const [garmentImage, setGarmentImage] = useState<File | null>(null);
  const [category, setCategory] = useState<string>('TSHIRT');
  const [step, setStep] = useState<Step>('upload');
  const [jobId, setJobId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [processError, setProcessError] = useState<string | null>(null);
  const [deletedNotice, setDeletedNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [personPreview, setPersonPreview] = useState<string | null>(null);

  // Poll job status while in processing or result state
  const { data: jobStatus } = useQuery<JobStatusResponse>({
    queryKey: ['job', jobId],
    queryFn: () => tryOnApi.getStatus(jobId!),
    enabled: (step === 'processing' || step === 'result') && !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === TryOnStatus.COMPLETED || status === TryOnStatus.FAILED) return false;
      return 2000; // Poll every 2 seconds while pending/processing
    },
  });

  // Transition to result when job finishes
  const currentStatus = jobStatus?.status;
  if (
    step === 'processing' &&
    (currentStatus === TryOnStatus.COMPLETED || currentStatus === TryOnStatus.FAILED)
  ) {
    setStep('result');
  }

  const handleSubmit = useCallback(async () => {
    if (!personImage || !garmentImage) {
      setSubmitError('Please upload both your photo and a garment image.');
      return;
    }

    setSubmitError(null);
    setProcessError(null);
    setDeletedNotice(null);
    setIsSubmitting(true);

    let createdJobId: string | null = null;
    try {
      // Step 1: Upload images and create job
      const job = await tryOnApi.upload(personImage, garmentImage, category);
      createdJobId = job.jobId;

      // Track person preview for side-by-side display
      setPersonPreview(URL.createObjectURL(personImage));
      setJobId(job.jobId);
      setStep('processing');
      setIsSubmitting(false);

      // Step 2: Trigger AI inference while user sees the processing indicator
      await tryOnApi.process(job.jobId);
      await queryClient.invalidateQueries({ queryKey: ['job', job.jobId] });
      setStep('result');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Request failed. Please try again.';
      setIsSubmitting(false);

      if (createdJobId) {
        // Upload succeeded, but AI inference failed; fetch updated FAILED job status or display error
        setProcessError(message);
        await queryClient.invalidateQueries({ queryKey: ['job', createdJobId] });
        setStep('result');
      } else {
        setSubmitError(message);
      }
    }
  }, [personImage, garmentImage, category, queryClient]);

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
  }, [personPreview]);

  const handleDeleteJob = useCallback(
    async (targetJobId: string) => {
      await tryOnApi.deleteJob(targetJobId);
      queryClient.removeQueries({ queryKey: ['job', targetJobId] });
      handleReset();
      setDeletedNotice('Try-on job and all associated images have been deleted.');
    },
    [queryClient, handleReset],
  );

  const canSubmit = !!personImage && !!garmentImage && !isSubmitting;

  const fallbackJob: JobStatusResponse = processError
    ? {
        jobId: jobId ?? '',
        status: TryOnStatus.FAILED,
        category,
        errorMessage: processError,
        createdAt: new Date().toISOString(),
      }
    : {
        jobId: jobId ?? '',
        status: TryOnStatus.PROCESSING,
        category,
        createdAt: new Date().toISOString(),
      };

  return (
    <main className="min-h-screen px-4 py-8 md:px-6">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-8 flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-400" />
            <h1 className="text-lg font-bold">Virtual Try-On</h1>
          </div>
        </div>

        {/* Upload step */}
        {step === 'upload' && (
          <div className="flex flex-col gap-6">
            {deletedNotice && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-900 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                {deletedNotice}
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <ImageUpload
                label="Your photo"
                hint="A clear, front-facing photo works best (JPEG, PNG, WebP · max 10 MB)"
                value={personImage}
                onChange={setPersonImage}
                disabled={isSubmitting}
              />
              <ImageUpload
                label="Garment image"
                hint="A photo of the upper-body clothing item you want to try on"
                value={garmentImage}
                onChange={setGarmentImage}
                disabled={isSubmitting}
              />
            </div>

            {/* Category selector */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-neutral-300">
                Upper-body clothing category
              </label>
              <div className="flex flex-wrap gap-2">
                {V1_CLOTHING_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategory(cat)}
                    className={cn(
                      'rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                      category === cat
                        ? 'border-violet-500 bg-violet-600 text-white'
                        : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-600',
                    )}
                  >
                    {CATEGORY_LABELS[cat] ?? cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Error */}
            {submitError && (
              <div className="flex items-center gap-2 rounded-lg border border-red-900 bg-red-950/20 px-4 py-3 text-sm text-red-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {submitError}
              </div>
            )}

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={cn(
                'flex items-center justify-center gap-2 rounded-xl py-4 text-base font-semibold transition-colors',
                canSubmit
                  ? 'bg-violet-600 text-white hover:bg-violet-500 shadow-lg shadow-violet-900/30'
                  : 'cursor-not-allowed bg-neutral-800 text-neutral-500',
              )}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Uploading images…
                </>
              ) : (
                <>
                  <Sparkles className="h-5 w-5" />
                  Try it on
                </>
              )}
            </button>

            <p className="text-center text-xs text-neutral-500">
              Images are validated and auto-deleted after 7 days, or you can delete them immediately
              after viewing your result.
            </p>
          </div>
        )}

        {/* Processing / Result */}
        {(step === 'processing' || step === 'result') && (
          <TryOnResult
            job={
              jobStatus &&
              (jobStatus.status === TryOnStatus.COMPLETED ||
                jobStatus.status === TryOnStatus.FAILED)
                ? jobStatus
                : fallbackJob
            }
            personPreview={personPreview}
            onReset={handleReset}
            onDelete={handleDeleteJob}
          />
        )}
      </div>
    </main>
  );
}
