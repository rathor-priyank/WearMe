'use client';

import Link from 'next/link';
import {
  QrCode,
  Sparkles,
  ArrowRight,
  Store,
  Globe,
  CheckCircle2,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const LOCAL_SHOP_STEPS = [
  {
    step: '01',
    title: 'Visit a WearMe partner shop',
    description:
      'Walk into any participating local boutique or retail store displaying a WearMe QR code.',
  },
  {
    step: '02',
    title: 'Scan the shop or product QR code',
    description:
      'Use your phone camera to scan the shop standee or garment hanger QR code—no app download required.',
  },
  {
    step: '03',
    title: 'Browse the supported catalog on mobile',
    description:
      'Explore the boutique’s supported clothing and fashion items directly in your mobile browser.',
  },
  {
    step: '04',
    title: 'Upload a photo or use your saved portrait',
    description:
      'Snap or upload a front-facing photo, or use your saved WearMe portrait if you already have an account.',
  },
  {
    step: '05',
    title: 'Preview how the selected item looks on you',
    description:
      'Generate a private visual try-on preview in seconds without waiting for a busy physical trial room.',
  },
  {
    step: '06',
    title: 'Optionally sign in with OTP to save looks',
    description:
      'Verify via WhatsApp, SMS, or Email OTP to save your portrait and favorite looks to your private wardrobe.',
  },
  {
    step: '07',
    title: 'Decide with confidence in store or from home',
    description:
      'Compare your saved looks on the shop floor or revisit your personal wardrobe later from home.',
  },
] as const;

const ONLINE_SHOPPER_STEPS = [
  {
    step: '01',
    title: 'Sign in using WhatsApp, SMS, or Email OTP',
    description:
      'Visit WearMe and sign in with a one-time verification code sent to your preferred channel.',
  },
  {
    step: '02',
    title: 'Upload or manage your personal portrait',
    description:
      'Save a base portrait in your private account so you do not need to upload a photo every time.',
  },
  {
    step: '03',
    title: 'Browse supported clothing & fashion categories',
    description:
      'Review live-supported upper-body garments, experimental capabilities, and category guidelines.',
  },
  {
    step: '04',
    title: 'Select a product or upload a garment image',
    description:
      'Pick an item from the curated multi-brand catalog or upload a supported garment photo.',
  },
  {
    step: '05',
    title: 'Generate your virtual try-on preview',
    description:
      'Our category-aware pipeline renders your visual try-on preview while preserving your identity.',
  },
  {
    step: '06',
    title: 'Save looks to your personal digital wardrobe',
    description:
      'Organize favorite outfits in your private wardrobe to compare styles before purchasing.',
  },
  {
    step: '07',
    title: 'Delete photos, history, or account anytime',
    description:
      'You remain in full control—delete individual try-on jobs, your saved portrait, or your entire account whenever you want.',
  },
] as const;

export function EcosystemTabs() {
  return (
    <section
      id="how-it-works"
      className="border-b border-neutral-900 bg-neutral-950/60 px-4 py-16 sm:px-6 md:py-24"
    >
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto mb-10 max-w-3xl text-center">
          <Badge variant="default" className="mb-3">
            <Sparkles className="h-3.5 w-3.5 text-violet-400" />
            <span>How WearMe Works</span>
          </Badge>
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Two Ways to Experience WearMe
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-neutral-300 sm:text-base">
            Whether you are scanning a QR code inside a local partner boutique or exploring styles
            online from home, your photos remain private to you.
          </p>
        </div>

        <Tabs defaultValue="boutique" className="w-full">
          <div className="flex justify-center">
            <TabsList className="grid w-full max-w-lg grid-cols-2">
              <TabsTrigger value="boutique">
                <Store className="h-4 w-4" />
                <span>1. Local Shop Customer Flow</span>
              </TabsTrigger>
              <TabsTrigger value="online">
                <Globe className="h-4 w-4" />
                <span>2. Online Shopper Flow</span>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Path 1: Local Shop Customer Flow (7 Steps) */}
          <TabsContent value="boutique">
            <Card className="overflow-hidden border-violet-900/50 bg-gradient-to-b from-neutral-900/90 to-neutral-950 p-6 sm:p-8">
              <div className="mb-8 flex flex-col justify-between gap-4 border-b border-neutral-800/80 pb-6 md:flex-row md:items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant="emerald">In-Store QR Experience</Badge>
                    <span className="font-mono text-xs text-neutral-400">
                      No login required to try on · Optional OTP save
                    </span>
                  </div>
                  <h3 className="mt-2 text-xl font-bold text-white sm:text-2xl">
                    Local Shop Customer Flow (7 Steps)
                  </h3>
                </div>

                <Link
                  href="/try-on?storeId=store_indiranagar_01"
                  className="inline-flex items-center gap-2 rounded-xl border border-violet-700/70 bg-violet-950/60 px-4 py-2.5 text-xs font-semibold text-violet-200 hover:bg-violet-900/60 sm:text-sm"
                >
                  <QrCode className="h-4 w-4 text-violet-300" />
                  <span>Try Partner Boutique QR Demo</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {LOCAL_SHOP_STEPS.map((item) => (
                  <div
                    key={item.step}
                    className="flex flex-col justify-between rounded-2xl border border-neutral-800/90 bg-neutral-950/80 p-5 transition-all hover:border-violet-600/60"
                  >
                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <span className="inline-flex items-center gap-1 rounded-md border border-violet-800/60 bg-violet-950/60 px-2 py-0.5 font-mono text-xs font-bold text-violet-300">
                          Step {item.step}
                        </span>
                        <CheckCircle2 className="h-4 w-4 text-emerald-400/80" />
                      </div>
                      <h4 className="text-sm font-bold text-white sm:text-base">{item.title}</h4>
                      <p className="mt-2 text-xs leading-relaxed text-neutral-300">
                        {item.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>

          {/* Path 2: Independent Online Shopper Flow (7 Steps) */}
          <TabsContent value="online">
            <Card className="overflow-hidden border-fuchsia-900/50 bg-gradient-to-b from-neutral-900/90 to-neutral-950 p-6 sm:p-8">
              <div className="mb-8 flex flex-col justify-between gap-4 border-b border-neutral-800/80 pb-6 md:flex-row md:items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant="default">Personal Digital Wardrobe</Badge>
                    <span className="font-mono text-xs text-neutral-400">
                      WhatsApp, SMS, or Email OTP · Full Data Control
                    </span>
                  </div>
                  <h3 className="mt-2 text-xl font-bold text-white sm:text-2xl">
                    Independent Online Shopper Flow (7 Steps)
                  </h3>
                </div>

                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 rounded-xl border border-fuchsia-700/70 bg-fuchsia-950/60 px-4 py-2.5 text-xs font-semibold text-fuchsia-200 hover:bg-fuchsia-900/60 sm:text-sm"
                >
                  <Sparkles className="h-4 w-4 text-fuchsia-300" />
                  <span>Sign In to Personal Wardrobe</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {ONLINE_SHOPPER_STEPS.map((item) => (
                  <div
                    key={item.step}
                    className="flex flex-col justify-between rounded-2xl border border-neutral-800/90 bg-neutral-950/80 p-5 transition-all hover:border-fuchsia-600/60"
                  >
                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <span className="inline-flex items-center gap-1 rounded-md border border-fuchsia-800/60 bg-fuchsia-950/60 px-2 py-0.5 font-mono text-xs font-bold text-fuchsia-300">
                          Step {item.step}
                        </span>
                        <CheckCircle2 className="h-4 w-4 text-fuchsia-400/80" />
                      </div>
                      <h4 className="text-sm font-bold text-white sm:text-base">{item.title}</h4>
                      <p className="mt-2 text-xs leading-relaxed text-neutral-300">
                        {item.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
