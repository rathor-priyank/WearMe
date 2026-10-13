'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface ContextualBackButtonProps {
  fallbackHref: string;
  label?: string;
  preferFallback?: boolean;
  className?: string;
}

export function ContextualBackButton({
  fallbackHref,
  label = 'Back',
  preferFallback = false,
  className,
}: ContextualBackButtonProps) {
  const router = useRouter();

  const handleBack = () => {
    if (
      !preferFallback &&
      typeof window !== 'undefined' &&
      window.history.length > 1 &&
      document.referrer &&
      document.referrer.startsWith(window.location.origin)
    ) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  };

  return (
    <button
      type="button"
      onClick={handleBack}
      data-testid="contextual-back-button"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900/80 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-700 hover:bg-neutral-900 hover:text-white',
        className,
      )}
    >
      <ArrowLeft className="h-3.5 w-3.5 text-violet-400" />
      <span>{label}</span>
    </button>
  );
}

interface PageBreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function PageBreadcrumbs({ items, className }: PageBreadcrumbsProps) {
  if (!items.length) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      data-testid="page-breadcrumbs"
      className={cn('flex flex-wrap items-center gap-1.5 text-xs text-neutral-400', className)}
    >
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        return (
          <span key={`${item.label}-${idx}`} className="inline-flex items-center gap-1.5">
            {idx > 0 && <ChevronRight className="h-3.5 w-3.5 text-neutral-600" aria-hidden="true" />}
            {item.href && !isLast ? (
              <Link
                href={item.href}
                className="font-medium text-neutral-400 transition-colors hover:text-violet-300"
              >
                {item.label}
              </Link>
            ) : (
              <span
                className={cn(
                  'font-medium',
                  isLast ? 'text-neutral-200' : 'text-neutral-400',
                )}
                aria-current={isLast ? 'page' : undefined}
              >
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

interface ContextualNavBarProps {
  backHref: string;
  backLabel?: string;
  preferFallback?: boolean;
  breadcrumbs: BreadcrumbItem[];
  rightSlot?: React.ReactNode;
  className?: string;
}

export function ContextualNavBar({
  backHref,
  backLabel = 'Back',
  preferFallback = false,
  breadcrumbs,
  rightSlot,
  className,
}: ContextualNavBarProps) {
  return (
    <div
      className={cn(
        'mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-900/90 pb-3.5',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <ContextualBackButton
          fallbackHref={backHref}
          label={backLabel}
          preferFallback={preferFallback}
        />
        <PageBreadcrumbs items={breadcrumbs} />
      </div>
      {rightSlot && <div className="flex items-center gap-2">{rightSlot}</div>}
    </div>
  );
}

