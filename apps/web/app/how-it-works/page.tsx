import Link from 'next/link';
import {
  QrCode,
  Sparkles,
  ShieldCheck,
  ArrowRight,
  Layers,
  Store,
  Lock,
} from 'lucide-react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { ContextualNavBar } from '@/components/contextual-nav';
import { EcosystemTabs } from '@/components/home/EcosystemTabs';

export default function HowItWorksPage() {
  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-neutral-50">
      <SiteHeader />

      <main className="flex-1">
        <section className="border-b border-neutral-800/80 px-4 py-10 sm:px-6 md:py-14">
          <div className="mx-auto max-w-5xl">
            <ContextualNavBar
              backHref="/"
              backLabel="Back to Home"
              breadcrumbs={[
                { label: 'Home', href: '/' },
                { label: 'How It Works' },
              ]}
            />

            <div className="text-center">
              <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-violet-400">
                <QrCode className="h-3.5 w-3.5" />
                Dual-Ecosystem Workflow
              </div>
              <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-white sm:text-5xl">
                How WearMe Works for Local Boutiques &amp; Online Shoppers
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-neutral-400 sm:text-base">
                Whether you are scanning a QR tag at a neighborhood boutique or signing in online
                from home, WearMe keeps the experience fast, bounded, and strictly private.
              </p>
            </div>
          </div>
        </section>

        <EcosystemTabs />

        {/* Privacy & Category Routing Callout */}
        <section className="border-t border-neutral-800/80 px-4 py-14 sm:px-6">
          <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-emerald-800/60 bg-emerald-950/15 p-6">
              <div className="mb-3 flex items-center gap-2 text-emerald-400">
                <Lock className="h-5 w-5" />
                <h2 className="text-lg font-bold text-white">
                  Time-Bounded Store QR vs. Personal Wardrobe
                </h2>
              </div>
              <p className="text-xs leading-relaxed text-neutral-300 sm:text-sm">
                Walk-in boutique shoppers scanning a valid store QR (
                <code className="text-emerald-300">/try-on?storeId=...</code>) receive a time-bounded
                in-store session without needing an account upfront. Online shoppers sign in via
                WhatsApp, SMS, or Email OTP to use their personal Digital Wardrobe.
              </p>
              <div className="mt-4">
                <Link
                  href="/try-on?storeId=store_indiranagar_01&subcategory=TSHIRT"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300"
                >
                  <Store className="h-3.5 w-3.5" />
                  Try Walk-In Boutique QR Demo
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>

            <div className="rounded-2xl border border-violet-800/60 bg-violet-950/15 p-6">
              <div className="mb-3 flex items-center gap-2 text-violet-400">
                <Layers className="h-5 w-5" />
                <h2 className="text-lg font-bold text-white">
                  Category-Aware Anatomical Routing
                </h2>
              </div>
              <p className="text-xs leading-relaxed text-neutral-300 sm:text-sm">
                Every try-on request is checked against our 38-subcategory capability matrix.
                Upper-body clothing routes to diffusion VTON providers, necklaces/pendants route to
                our landmark-guided PoC when enabled, and unsupported categories are clearly gated.
              </p>
              <div className="mt-4 flex flex-wrap gap-4">
                <Link
                  href="/categories"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-400 hover:text-violet-300"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Inspect 38 Wearable Subcategories
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link
                  href="/security"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-300 hover:text-white"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Security Guarantees
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
