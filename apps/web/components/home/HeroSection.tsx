import Link from 'next/link';
import {
  QrCode,
  Sparkles,
  Store,
  Smartphone,
  CheckCircle2,
  ArrowUpRight,
  BookmarkCheck,
  Wand2,
  ShieldCheck,
  Lock,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { PrimaryAuthCta } from '@/components/home/PrimaryAuthCta';
import { cn } from '@/lib/utils';

export interface HeroSectionProps {
  initialIsAuthenticated?: boolean;
}

export function HeroSection({ initialIsAuthenticated = false }: HeroSectionProps) {
  return (
    <section className="relative overflow-hidden border-b border-neutral-900 px-4 py-16 sm:px-6 md:py-24 lg:py-28">
      {/* Ambient Radial Spotlight */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-violet-950/45 via-neutral-950 to-neutral-950" />
      <div className="pointer-events-none absolute -top-24 right-1/4 h-96 w-96 rounded-full bg-fuchsia-600/10 blur-3xl" />

      <div className="relative mx-auto max-w-6xl">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-10">
          {/* Left Column: Value Proposition & CTAs */}
          <div className="flex flex-col items-start text-left lg:col-span-7">
            <Badge variant="default" className="mb-6 px-3.5 py-1.5">
              <Sparkles className="h-3.5 w-3.5 text-violet-400" />
              <span>Privacy-First Virtual Try-On · In Partner Boutiques &amp; Online</span>
            </Badge>

            <h1 className="text-4xl font-extrabold leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-6xl">
              Try Before You Buy.{' '}
              <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-indigo-300 bg-clip-text text-transparent">
                In Store or Online.
              </span>
            </h1>

            <p className="mt-6 max-w-2xl text-base leading-relaxed text-neutral-300 sm:text-lg">
              WearMe helps shoppers preview clothing and supported fashion items on their own photo,
              while helping local shops and online stores create a more confident shopping
              experience.
            </p>

            {/* Primary & Secondary CTAs */}
            <div className="mt-8 flex w-full flex-col gap-3.5 sm:w-auto sm:flex-row sm:items-center">
              <PrimaryAuthCta
                initialIsAuthenticated={initialIsAuthenticated}
                defaultLabel="Explore WearMe"
                authenticatedLabel="Open My Wardrobe"
                size="lg"
                className="w-full sm:w-auto"
              />

              <Link
                href="/partner"
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'lg' }),
                  'w-full sm:w-auto',
                )}
              >
                <Store className="h-4 w-4 text-violet-400" />
                <span>Become a Shop Partner</span>
                <ArrowUpRight className="h-4 w-4 text-neutral-400" />
              </Link>
            </div>

            {/* Mandatory Supporting Trust Statement */}
            <div className="mt-6 flex items-center gap-2.5 rounded-xl border border-emerald-800/60 bg-emerald-950/35 px-4 py-3 text-xs font-medium text-emerald-200 sm:text-sm">
              <Lock className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>
                Your photos are private. Shops do not get access to your personal try-on images.
              </span>
            </div>

            {/* Core Trust Signals */}
            <div className="mt-8 grid w-full grid-cols-1 gap-3 border-t border-neutral-800/80 pt-7 sm:grid-cols-3">
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-violet-800/60 bg-violet-950/60 text-violet-300">
                  <QrCode className="h-3.5 w-3.5" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-white">In-Store QR Preview</p>
                  <p className="text-[11px] text-neutral-400">
                    Scan a partner shop QR code to try on items in your phone browser
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-emerald-800/60 bg-emerald-950/60 text-emerald-300">
                  <Smartphone className="h-3.5 w-3.5" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-white">WhatsApp, SMS &amp; Email OTP</p>
                  <p className="text-[11px] text-neutral-400">
                    Passwordless sign-in to save your portrait and favorite looks
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-fuchsia-800/60 bg-fuchsia-950/60 text-fuchsia-300">
                  <ShieldCheck className="h-3.5 w-3.5" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-white">Strict Privacy Boundary</p>
                  <p className="text-[11px] text-neutral-400">
                    Customer portraits and wardrobes stay strictly private to you
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Dual-Ecosystem Visual Preview */}
          <div className="lg:col-span-5">
            <div className="relative mx-auto max-w-md rounded-3xl border border-neutral-800 bg-neutral-900/75 p-5 shadow-2xl shadow-violet-950/30 backdrop-blur-md">
              <div className="mb-4 flex items-center justify-between border-b border-neutral-800 pb-3">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-neutral-300">
                    WearMe Fitting Experience
                  </span>
                </div>
                <span className="rounded-md border border-emerald-800/60 bg-emerald-950/60 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
                  Customer-Private Vault
                </span>
              </div>

              {/* Stage 1 Card: In-Store QR Experience */}
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950/90 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-violet-700/50 bg-violet-600/20 text-violet-300">
                      <QrCode className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white">
                        1. Partner Boutique QR Scan
                      </p>
                      <p className="text-[11px] text-neutral-400">
                        Browse catalog &amp; preview outfits on your phone
                      </p>
                    </div>
                  </div>
                  <Badge variant="emerald" className="px-2 py-0.5 text-[10px]">
                    No Login Required
                  </Badge>
                </div>

                <div className="mt-3.5 grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-2.5 text-center">
                    <p className="text-[10px] font-medium text-neutral-400">Your Photo</p>
                    <div className="mt-1.5 flex h-14 items-center justify-center rounded-lg bg-gradient-to-b from-neutral-800 to-neutral-900 text-[11px] font-semibold text-neutral-200">
                      Private Input
                    </div>
                  </div>
                  <div className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-2.5 text-center">
                    <p className="text-[10px] font-medium text-neutral-400">Store Item</p>
                    <div className="mt-1.5 flex h-14 items-center justify-center rounded-lg bg-gradient-to-b from-violet-950/70 to-neutral-900 text-[11px] font-semibold text-violet-200">
                      Supported Top
                    </div>
                  </div>
                  <div className="rounded-xl border border-violet-700/70 bg-violet-950/40 p-2.5 text-center">
                    <p className="text-[10px] font-semibold text-violet-300">Try-On Preview</p>
                    <div className="mt-1.5 flex h-14 flex-col items-center justify-center rounded-lg bg-gradient-to-br from-violet-600/40 to-fuchsia-600/40 text-[11px] font-bold text-white">
                      <Wand2 className="mb-0.5 h-3.5 w-3.5 text-violet-200" />
                      Visual Fit
                    </div>
                  </div>
                </div>
              </div>

              {/* Connector Pill */}
              <div className="my-3 flex items-center justify-between rounded-xl border border-emerald-800/50 bg-emerald-950/30 px-3.5 py-2">
                <div className="flex items-center gap-2 text-xs font-medium text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span>Optional OTP Sign-In (WhatsApp / SMS / Email)</span>
                </div>
                <span className="font-mono text-[10px] text-emerald-400/90">Private Account</span>
              </div>

              {/* Stage 2 Card: Personal Digital Wardrobe */}
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950/90 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-fuchsia-700/50 bg-fuchsia-600/20 text-fuchsia-300">
                      <BookmarkCheck className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white">
                        2. Personal Digital Wardrobe
                      </p>
                      <p className="text-[11px] text-neutral-400">
                        Reuse your saved portrait &amp; delete data anytime
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {[
                    { brand: 'Zara Online', item: 'Oxford Shirt' },
                    { brand: 'Fabindia', item: 'Nehru Jacket' },
                    { brand: 'Uniqlo', item: 'Fleece Zip' },
                  ].map((entry) => (
                    <div
                      key={entry.brand}
                      className="flex flex-1 items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-[11px]"
                    >
                      <div>
                        <p className="font-semibold text-neutral-200">{entry.brand}</p>
                        <p className="text-[10px] text-neutral-400">{entry.item}</p>
                      </div>
                      <span className="ml-2 rounded bg-violet-600/20 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300">
                        1-Click
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
