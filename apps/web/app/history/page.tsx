'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  History,
  Trash2,
  Eye,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Sparkles,
  RefreshCw,
  Info,
  ArrowRight,
} from 'lucide-react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { ContextualNavBar } from '@/components/contextual-nav';
import { TryOnResult } from '@/components/try-on-result';
import { tryOnApi } from '@/lib/api-client';
import {
  getStoredJobRecords,
  removeSessionJob,
  reconcileSessionJobsWithBackend,
  clearSessionJobs,
  type LocalJobRecord,
} from '@/lib/job-history';
import { TryOnStatus } from '@wearme/shared';
import type { JobStatusResponse } from '@wearme/shared';
import { cn } from '@/lib/utils';

export default function HistoryPage() {
  const queryClient = useQueryClient();
  const [sessionRecords, setSessionRecords] = useState<LocalJobRecord[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setSessionRecords(getStoredJobRecords());
  }, []);

  const {
    data: backendJobsData,
    isLoading,
    isSuccess: isBackendLoaded,
    refetch,
  } = useQuery({
    queryKey: ['try-on-jobs-history', sessionRecords.map((r) => r.jobId).join(',')],
    queryFn: () =>
      tryOnApi.listJobs(
        sessionRecords.length > 0 ? sessionRecords.map((r) => r.jobId) : undefined,
      ),
    staleTime: 10_000,
  });

  // When the backend responds authoritatively, prune any localStorage job IDs that were deleted or expired on the server
  useEffect(() => {
    if (!isBackendLoaded || !backendJobsData?.jobs) return;
    const activeIds = new Set(backendJobsData.jobs.map((j) => j.jobId));
    const reconciled = reconcileSessionJobsWithBackend(activeIds);
    if (reconciled.length !== sessionRecords.length) {
      setSessionRecords(reconciled);
    }
  }, [isBackendLoaded, backendJobsData, sessionRecords.length]);

  // Display authoritative backend jobs when loaded; only fall back to local records if backend is unreachable
  const mergedJobs: JobStatusResponse[] = (() => {
    if (isBackendLoaded && backendJobsData?.jobs) {
      return [...backendJobsData.jobs].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    }

    const backendJobs = backendJobsData?.jobs ?? [];
    const byId = new Map<string, JobStatusResponse>();

    for (const job of backendJobs) {
      byId.set(job.jobId, job);
    }

    for (const local of sessionRecords) {
      if (!byId.has(local.jobId)) {
        byId.set(local.jobId, {
          jobId: local.jobId,
          status: TryOnStatus.PENDING,
          category: local.category,
          subcategory: local.subcategory,
          createdAt: local.createdAt,
        });
      }
    }

    return Array.from(byId.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  })();

  const selectedJob = mergedJobs.find((j) => j.jobId === selectedJobId) ?? null;

  const handleDeleteJob = useCallback(
    async (jobId: string) => {
      setDeletingJobId(jobId);
      setNotice(null);
      try {
        await tryOnApi.deleteJob(jobId);
      } catch {
        // Even if already removed on backend, clean up local reference
      } finally {
        removeSessionJob(jobId);
        setSessionRecords(getStoredJobRecords());
        if (selectedJobId === jobId) {
          setSelectedJobId(null);
        }
        await queryClient.invalidateQueries({ queryKey: ['try-on-jobs-history'] });
        setDeletingJobId(null);
        setNotice(
          `Job ${jobId.slice(0, 8)}… and its stored images have been permanently deleted.`,
        );
      }
    },
    [selectedJobId, queryClient],
  );

  const handleClearLocalList = useCallback(() => {
    clearSessionJobs();
    setSessionRecords([]);
    setNotice('Cleared browser-stored session job references.');
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-neutral-50">
      <SiteHeader />

      <main className="flex-1 px-4 py-8 sm:px-6 md:py-10">
        <div className="mx-auto max-w-6xl">
          <ContextualNavBar
            backHref="/try-on"
            backLabel="Back to Try-On"
            breadcrumbs={[
              { label: 'Try On', href: '/try-on' },
              { label: 'My Activity' },
            ]}
          />

          {/* Header */}
          <div className="mb-8 flex flex-col justify-between gap-4 border-b border-neutral-800/80 pb-6 sm:flex-row sm:items-end">
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-violet-400">
                <History className="h-3.5 w-3.5" />
                My Activity &amp; Recent Try-On Jobs
              </div>
              <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
                My Activity &amp; Job History
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-neutral-400">
                Inspect completed try-on outputs, check processing status, or permanently delete
                stored job images from the backend.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => refetch()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 px-3.5 py-2 text-xs font-medium text-neutral-300 hover:border-neutral-700 hover:text-white transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh Status
              </button>
              {sessionRecords.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearLocalList}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 px-3.5 py-2 text-xs font-medium text-neutral-400 hover:border-neutral-700 hover:text-neutral-200 transition-colors"
                >
                  Clear Local Browser List
                </button>
              )}
              <Link
                href="/try-on"
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-500 transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5" />
                New Try-On
              </Link>
            </div>
          </div>

          {/* Scope & Deletion Banner */}
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 text-xs text-neutral-300">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
            <div>
              <p className="font-semibold text-neutral-100">
                Customer-Controlled Activity History &amp; Immediate Deletion
              </p>
              <p className="mt-0.5 leading-relaxed text-neutral-400">
                Recent jobs are synchronized from your authenticated account and browser session (
                <code className="text-neutral-300">GET /api/v1/try-on/jobs</code>). Clicking{' '}
                <strong>Delete</strong> calls{' '}
                <code className="text-neutral-300">DELETE /api/v1/try-on/:jobId</code> to
                permanently erase the database record and all image files on disk.
              </p>
            </div>
          </div>

          {notice && (
            <div className="mb-6 flex items-center gap-2.5 rounded-xl border border-emerald-800/80 bg-emerald-950/30 px-4 py-3 text-xs text-emerald-300 sm:text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>{notice}</span>
            </div>
          )}

          {/* Selected Job Inspector Modal/Panel */}
          {selectedJob && (
            <div className="mb-8 rounded-2xl border border-violet-800/60 bg-neutral-900/60 p-6">
              <div className="mb-4 flex items-center justify-between border-b border-neutral-800 pb-3">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-violet-400">
                    Inspecting Try-On Job
                  </span>
                  <h2 className="font-mono text-sm text-neutral-200">{selectedJob.jobId}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedJobId(null)}
                  className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:text-white"
                >
                  Close Inspector
                </button>
              </div>
              <TryOnResult
                job={selectedJob}
                personPreview={selectedJob.personImageUrl ?? null}
                productPreview={selectedJob.garmentImageUrl ?? null}
                onReset={() => setSelectedJobId(null)}
                onDelete={handleDeleteJob}
              />
            </div>
          )}

          {/* Job List */}
          {isLoading ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-900/40 py-16">
              <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
              <p className="mt-3 text-sm text-neutral-400">Loading recent try-on jobs…</p>
            </div>
          ) : mergedJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-900/40 px-6 py-16 text-center">
              <History className="mb-3 h-10 w-10 text-neutral-600" />
              <h2 className="text-lg font-semibold text-neutral-200">No try-on jobs found</h2>
              <p className="mt-1 max-w-md text-xs text-neutral-400 sm:text-sm">
                You haven&apos;t run any virtual try-on jobs in this session, or all previous jobs
                have been deleted.
              </p>
              <Link
                href="/try-on"
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 transition-colors"
              >
                Open Try-On Studio
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {mergedJobs.map((job) => {
                const isCompleted = job.status === TryOnStatus.COMPLETED;
                const isFailed = job.status === TryOnStatus.FAILED;
                const isDeleting = deletingJobId === job.jobId;
                const isSelected = selectedJobId === job.jobId;

                return (
                  <div
                    key={job.jobId}
                    className={cn(
                      'flex flex-col justify-between rounded-2xl border bg-neutral-900/50 p-5 transition-colors',
                      isSelected ? 'border-violet-500' : 'border-neutral-800',
                    )}
                  >
                    <div>
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
                            isCompleted
                              ? 'border-emerald-800 bg-emerald-950/50 text-emerald-300'
                              : isFailed
                                ? 'border-red-900 bg-red-950/50 text-red-300'
                                : 'border-amber-800 bg-amber-950/50 text-amber-300',
                          )}
                        >
                          {isCompleted ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : isFailed ? (
                            <XCircle className="h-3 w-3" />
                          ) : (
                            <Clock className="h-3 w-3" />
                          )}
                          {job.status}
                        </span>

                        <span className="rounded border border-neutral-800 bg-neutral-950 px-2 py-0.5 font-mono text-[11px] text-violet-300">
                          {job.subcategory ?? job.category}
                        </span>
                      </div>

                      {/* Thumbnail if completed */}
                      {isCompleted && job.resultUrl && (
                        <div className="mb-3 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950">
                          <img
                            src={job.resultUrl}
                            alt={`Try-on result ${job.jobId}`}
                            className="h-48 w-full object-contain"
                          />
                        </div>
                      )}

                      <dl className="space-y-1.5 text-xs text-neutral-400">
                        <div className="flex justify-between">
                          <dt>Job ID:</dt>
                          <dd className="font-mono text-neutral-300">
                            {job.jobId.slice(0, 12)}…
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt>Created:</dt>
                          <dd className="text-neutral-300">
                            {new Date(job.createdAt).toLocaleString()}
                          </dd>
                        </div>
                        {job.aiProvider && (
                          <div className="flex justify-between">
                            <dt>Provider:</dt>
                            <dd className="font-mono text-neutral-300">{job.aiProvider}</dd>
                          </div>
                        )}
                      </dl>

                      {isFailed && job.errorMessage && (
                        <p className="mt-3 line-clamp-2 rounded-lg border border-red-900/50 bg-red-950/20 p-2 text-[11px] text-red-300">
                          {job.errorMessage}
                        </p>
                      )}
                    </div>

                    <div className="mt-4 flex items-center gap-2 border-t border-neutral-800/80 pt-3">
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedJobId(isSelected ? null : job.jobId)
                        }
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-950 py-2 text-xs font-medium text-neutral-200 hover:border-neutral-600 hover:text-white transition-colors"
                      >
                        <Eye className="h-3.5 w-3.5 text-violet-400" />
                        {isSelected ? 'Hide Details' : 'Inspect'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteJob(job.jobId)}
                        disabled={isDeleting}
                        className="flex items-center justify-center gap-1.5 rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-950/40 disabled:opacity-50 transition-colors"
                        title="Permanently delete job and files"
                      >
                        {isDeleting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

