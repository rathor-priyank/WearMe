import Link from 'next/link';
import { Sparkles, ShieldCheck, Layers, Wand2, History } from 'lucide-react';

export function SiteFooter() {
  return (
    <footer className="border-t border-neutral-800/80 bg-neutral-950 px-4 py-12 md:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-8 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-600 text-white">
                <Sparkles className="h-4 w-4" />
              </div>
              <span className="text-base font-bold tracking-tight text-white">WearMe</span>
            </div>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-neutral-400">
              Category-aware virtual try-on platform with region-isolated compositing. Preserves
              face identity, skin tone, original body proportions, and non-target clothing.
            </p>
            <p className="mt-3 text-xs text-neutral-500">
              Upper-body clothing is live-validated via diffusion try-on; Necklace &amp; Pendant PoC
              runs behind an explicit feature flag (<code className="text-neutral-400">ENABLE_NECKLACE_POC</code>).
              Non-validated categories are never routed to clothing or mock models as fake AI output.
            </p>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
              Platform
            </h3>
            <ul className="mt-3 flex flex-col gap-2 text-sm text-neutral-400">
              <li>
                <Link href="/try-on" className="inline-flex items-center gap-1.5 hover:text-white">
                  <Wand2 className="h-3.5 w-3.5 text-violet-400" />
                  Virtual Try-On Studio
                </Link>
              </li>
              <li>
                <Link
                  href="/categories"
                  className="inline-flex items-center gap-1.5 hover:text-white"
                >
                  <Layers className="h-3.5 w-3.5 text-violet-400" />
                  38 Wearable Categories
                </Link>
              </li>
              <li>
                <Link href="/history" className="inline-flex items-center gap-1.5 hover:text-white">
                  <History className="h-3.5 w-3.5 text-violet-400" />
                  Session Job History
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
              Trust &amp; Architecture
            </h3>
            <ul className="mt-3 flex flex-col gap-2 text-sm text-neutral-400">
              <li>
                <Link href="/privacy" className="inline-flex items-center gap-1.5 hover:text-white">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                  Privacy &amp; Data Retention
                </Link>
              </li>
              <li className="text-xs text-neutral-500">
                Immediate 1-click deletion via <code className="text-neutral-400">DELETE /try-on/:jobId</code>
              </li>
              <li className="text-xs text-neutral-500">
                7-day <code className="text-neutral-400">expiresAt</code> retention metadata
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-neutral-900 pt-6 text-xs text-neutral-500 sm:flex-row">
          <p>WearMe · Category-Aware Virtual Try-On Platform</p>
          <p>Next.js App Router · NestJS API · FastAPI Computer Vision &amp; VTON Service</p>
        </div>
      </div>
    </footer>
  );
}

