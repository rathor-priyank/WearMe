'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Layers,
  CheckCircle2,
  FlaskConical,
  Clock,
  Search,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { tryOnApi, buildFallbackCategoriesResponse } from '@/lib/api-client';
import {
  NECKLACE_POC_SUBCATEGORIES,
  UPPER_BODY_SUBCATEGORIES,
  WearableDomain,
} from '@wearme/shared';
import type {
  CategoriesResponse,
  CategoryCapabilityItem,
} from '@wearme/shared';
import { cn } from '@/lib/utils';

const DOMAIN_FILTERS = [
  { id: 'ALL', label: 'All Domains (8)' },
  { id: WearableDomain.CLOTHING, label: 'Clothing' },
  { id: WearableDomain.JEWELLERY, label: 'Jewellery' },
  { id: WearableDomain.EYEWEAR, label: 'Eyewear' },
  { id: WearableDomain.WRISTWEAR, label: 'Wristwear' },
  { id: WearableDomain.BAGS, label: 'Bags' },
  { id: WearableDomain.FOOTWEAR, label: 'Footwear' },
  { id: WearableDomain.HEADWEAR, label: 'Headwear' },
  { id: WearableDomain.ACCESSORIES, label: 'Accessories' },
];

type StatusFilter = 'ALL' | 'STUDIO_READY' | 'EXPERIMENTAL_POC' | 'SPECIALIZED_MODEL';

function isUpperBodyItem(item: CategoryCapabilityItem): boolean {
  return (
    item.providerSupportStatus === 'supported' ||
    (UPPER_BODY_SUBCATEGORIES as readonly string[]).includes(item.subcategory)
  );
}

function isNecklacePocItem(item: CategoryCapabilityItem): boolean {
  return item.providerSupportStatus === 'experimental_poc';
}

function formatStatusBadge(item: CategoryCapabilityItem) {
  if (item.providerSupportStatus === 'supported') {
    return {
      label: 'Supported · Upper-Body VTON',
      className: 'border-emerald-800/80 bg-emerald-950/60 text-emerald-300',
      icon: CheckCircle2,
    };
  }
  if (item.providerSupportStatus === 'experimental_poc') {
    return {
      label: 'Experimental PoC · Enabled',
      className: 'border-amber-700/80 bg-amber-950/60 text-amber-300',
      icon: FlaskConical,
    };
  }
  if ((NECKLACE_POC_SUBCATEGORIES as readonly string[]).includes(item.subcategory)) {
    return {
      label: 'Experimental PoC · Disabled by Default',
      className: 'border-neutral-700 bg-neutral-900 text-neutral-400',
      icon: FlaskConical,
    };
  }
  if (item.liveValidationStatus === 'supported_fashn_api_unverified_live') {
    return {
      label: 'FASHN Lower/Full-Body (Unverified Live)',
      className: 'border-sky-800/80 bg-sky-950/60 text-sky-300',
      icon: Clock,
    };
  }
  return {
    label: 'Requires Specialized Model',
    className: 'border-neutral-700 bg-neutral-900 text-neutral-400',
    icon: Clock,
  };
}

export default function CategoriesPage() {
  const [selectedDomain, setSelectedDomain] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const { data: categoriesData } = useQuery<CategoriesResponse>({
    queryKey: ['wearable-categories'],
    queryFn: () => tryOnApi.getCategories(),
    staleTime: 60_000,
  });

  const items: CategoryCapabilityItem[] = useMemo(() => {
    if (categoriesData?.categories && categoriesData.categories.length > 0) {
      return categoriesData.categories;
    }
    return buildFallbackCategoriesResponse().categories;
  }, [categoriesData]);

  const counts = useMemo(() => {
    const upperBodyCount = items.filter((i) => isUpperBodyItem(i)).length;
    const pocCount = items.filter((i) => isNecklacePocItem(i)).length;
    const specializedCount = items.length - upperBodyCount - pocCount;
    return {
      total: items.length,
      upperBodyCount,
      pocCount,
      specializedCount,
    };
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (selectedDomain !== 'ALL' && item.domain !== selectedDomain) {
        return false;
      }
      if (statusFilter === 'STUDIO_READY' && !isUpperBodyItem(item)) {
        return false;
      }
      if (statusFilter === 'EXPERIMENTAL_POC' && !isNecklacePocItem(item)) {
        return false;
      }
      if (
        statusFilter === 'SPECIALIZED_MODEL' &&
        (isUpperBodyItem(item) || isNecklacePocItem(item))
      ) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesLabel = item.label.toLowerCase().includes(q);
        const matchesSub = item.subcategory.toLowerCase().includes(q);
        const matchesRoute = item.routingStrategy.toLowerCase().includes(q);
        const matchesLandmark = item.requiredLandmarks.some((l) =>
          l.toLowerCase().includes(q),
        );
        return matchesLabel || matchesSub || matchesRoute || matchesLandmark;
      }
      return true;
    });
  }, [items, selectedDomain, statusFilter, searchQuery]);

  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-neutral-50">
      <SiteHeader />

      <main className="flex-1 px-4 py-10 sm:px-6 md:py-12">
        <div className="mx-auto max-w-6xl">
          {/* Page Header */}
          <div className="mb-8 flex flex-col justify-between gap-4 border-b border-neutral-800/80 pb-6 md:flex-row md:items-end">
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-violet-400">
                <Layers className="h-3.5 w-3.5" />
                Wearable Capability Taxonomy
              </div>
              <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
                8 Domains · {counts.total} Wearable Subcategories
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-neutral-400">
                Inspect how WearMe routes each wearable category, which anatomical landmarks are
                required, and which categories are currently studio-ready versus experimental PoC or
                roadmap.
              </p>
            </div>
            <Link
              href="/try-on"
              className="inline-flex items-center gap-2 self-start rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 transition-colors md:self-auto"
            >
              <Sparkles className="h-4 w-4" />
              Open Try-On Studio
            </Link>
          </div>

          {/* Summary Cards */}
          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={cn(
                'rounded-xl border p-4 text-left transition-colors',
                statusFilter === 'ALL'
                  ? 'border-violet-500 bg-violet-950/25'
                  : 'border-neutral-800 bg-neutral-900/50 hover:border-neutral-700',
              )}
            >
              <p className="text-xs font-medium text-neutral-400">Total Cataloged</p>
              <p className="mt-1 text-2xl font-bold text-neutral-100">{counts.total}</p>
              <p className="mt-0.5 text-xs text-neutral-500">Across 8 wearable domains</p>
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('STUDIO_READY')}
              className={cn(
                'rounded-xl border p-4 text-left transition-colors',
                statusFilter === 'STUDIO_READY'
                  ? 'border-emerald-500 bg-emerald-950/25'
                  : 'border-neutral-800 bg-neutral-900/50 hover:border-neutral-700',
              )}
            >
              <p className="text-xs font-medium text-emerald-400">Supported Upper-Body</p>
              <p className="mt-1 text-2xl font-bold text-neutral-100">
                {counts.upperBodyCount}
              </p>
              <p className="mt-0.5 text-xs text-neutral-500">
                IDM-VTON / FASHN / Dev Mock
              </p>
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('EXPERIMENTAL_POC')}
              className={cn(
                'rounded-xl border p-4 text-left transition-colors',
                statusFilter === 'EXPERIMENTAL_POC'
                  ? 'border-amber-500 bg-amber-950/25'
                  : 'border-neutral-800 bg-neutral-900/50 hover:border-neutral-700',
              )}
            >
              <p className="text-xs font-medium text-amber-400">Experimental Local PoC</p>
              <p className="mt-1 text-2xl font-bold text-neutral-100">{counts.pocCount}</p>
              <p className="mt-0.5 text-xs text-neutral-500">
                Necklace &amp; Pendant (landmark_jewellery_neck)
              </p>
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('SPECIALIZED_MODEL')}
              className={cn(
                'rounded-xl border p-4 text-left transition-colors',
                statusFilter === 'SPECIALIZED_MODEL'
                  ? 'border-neutral-500 bg-neutral-900'
                  : 'border-neutral-800 bg-neutral-900/50 hover:border-neutral-700',
              )}
            >
              <p className="text-xs font-medium text-neutral-400">
                Requires Specialized Model
              </p>
              <p className="mt-1 text-2xl font-bold text-neutral-100">
                {counts.specializedCount}
              </p>
              <p className="mt-0.5 text-xs text-neutral-500">
                Explicitly gated against false routing
              </p>
            </button>
          </div>

          {/* Filter & Search Bar */}
          <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
            <div className="flex flex-wrap gap-1.5">
              {DOMAIN_FILTERS.map((df) => (
                <button
                  key={df.id}
                  type="button"
                  onClick={() => setSelectedDomain(df.id)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                    selectedDomain === df.id
                      ? 'border-violet-500 bg-violet-600 text-white'
                      : 'border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200',
                  )}
                >
                  {df.label}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by subcategory name, code (e.g. NECKLACE), landmark (e.g. face_mesh_chin_152), or routing strategy..."
                className="w-full rounded-xl border border-neutral-800 bg-neutral-950 py-2.5 pl-10 pr-4 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-violet-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Subcategory Grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredItems.map((item) => {
              const badge = formatStatusBadge(item);
              const BadgeIcon = badge.icon;
              const studioUploadable = isUpperBodyItem(item) || isNecklacePocItem(item);
              return (
                <div
                  key={item.subcategory}
                  className="flex flex-col justify-between rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5"
                >
                  <div>
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div>
                        <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-violet-400">
                          {item.domain} · {item.targetBodyRegion}
                        </span>
                        <h2 className="mt-0.5 text-base font-bold text-neutral-100">
                          {item.label}
                        </h2>
                      </div>
                      <code className="rounded border border-neutral-800 bg-neutral-950 px-2 py-0.5 font-mono text-[11px] text-neutral-400">
                        {item.subcategory}
                      </code>
                    </div>

                    <div className="mb-3">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
                          badge.className,
                        )}
                      >
                        <BadgeIcon className="h-3.5 w-3.5" />
                        {badge.label}
                      </span>
                    </div>

                    <div className="mt-4 space-y-2 border-t border-neutral-800/80 pt-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-neutral-500">Routing:</span>
                        <code className="font-mono text-[11px] text-neutral-300">
                          {item.routingStrategy}
                        </code>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-neutral-500">Validation Status:</span>
                        <code className="font-mono text-[10px] text-neutral-400">
                          {item.liveValidationStatus}
                        </code>
                      </div>
                      <div>
                        <span className="block text-neutral-500">Required Landmarks:</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {item.requiredLandmarks.map((lm) => (
                            <span
                              key={lm}
                              className="rounded border border-neutral-800 bg-neutral-950 px-1.5 py-0.5 font-mono text-[10px] text-neutral-400"
                            >
                              {lm}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 border-t border-neutral-800/80 pt-3">
                    {studioUploadable ? (
                      <Link
                        href={`/try-on?subcategory=${item.subcategory}`}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-400 hover:text-violet-300"
                      >
                        Try {item.label} in Studio
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    ) : (
                      <Link
                        href={`/try-on?subcategory=${item.subcategory}`}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-300"
                      >
                        Inspect pipeline requirements in Studio
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {filteredItems.length === 0 && (
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-12 text-center">
              <p className="text-sm font-medium text-neutral-300">
                No wearable subcategories match your filter criteria.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSelectedDomain('ALL');
                  setStatusFilter('ALL');
                  setSearchQuery('');
                }}
                className="mt-3 text-xs font-semibold text-violet-400 hover:text-violet-300"
              >
                Reset all filters
              </button>
            </div>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

