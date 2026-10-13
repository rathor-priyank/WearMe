import Link from 'next/link';
import {
  Sparkles,
  Store,
  ShieldCheck,
  Layers,
  Lock,
  ArrowRight,
  CheckCircle2,
  Cpu,
} from 'lucide-react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { ContextualNavBar } from '@/components/contextual-nav';

const PILLARS = [
  {
    title: 'Walk-In Boutique QR Fitting (B2B2C)',
    description:
      'Local shops and boutiques place WearMe QR tags on garment hangers and mirrors. Walk-in shoppers scan with their phone camera to preview outfits immediately—even when physical fitting rooms are full.',
    icon: Store,
  },
  {
    title: 'Personal Digital Wardrobe (B2C)',
    description:
      'Online shoppers sign in with WhatsApp, SMS, or Email OTP to store one private portrait and try on garments across participating brands without re-uploading a selfie every time.',
    icon: Sparkles,
  },
  {
    title: 'Customer-Owned Photo Privacy',
    description:
      'Every portrait and generated try-on output belongs strictly to the customer. Partner boutiques receive only aggregated operational counts and can never access customer photos.',
    icon: Lock,
  },
  {
    title: 'Honest Category-Aware AI Routing',
    description:
      'WearMe catalogs 38 wearable subcategories across 8 domains and routes each item only to validated pipelines—never faking unsupported categories as live AI.',
    icon: Cpu,
  },
];

export default function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-neutral-50">
      <SiteHeader />

      <main className="flex-1 px-4 py-10 sm:px-6 md:py-14">
        <div className="mx-auto max-w-5xl">
          <ContextualNavBar
            backHref="/"
            backLabel="Back to Home"
            breadcrumbs={[
              { label: 'Home', href: '/' },
              { label: 'About WearMe' },
            ]}
          />

          <div className="border-b border-neutral-800/80 pb-8">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-violet-400">
              <Sparkles className="h-3.5 w-3.5" />
              About WearMe
            </div>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-white sm:text-5xl">
              Privacy-First Virtual Try-On for Local Boutiques &amp; Online Shoppers
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-relaxed text-neutral-300 sm:text-lg">
              WearMe bridges physical retail and online fashion discovery. We help independent
              boutiques turn every hanger into a digital fitting room while giving shoppers a
              private, customer-controlled Digital Wardrobe.
            </p>
          </div>

          {/* Core Pillars */}
          <section className="mt-12 grid gap-6 md:grid-cols-2">
            {PILLARS.map((pillar) => {
              const Icon = pillar.icon;
              return (
                <div
                  key={pillar.title}
                  className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6"
                >
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-violet-800/60 bg-violet-950/50 text-violet-300">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h2 className="text-lg font-bold text-white">{pillar.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-neutral-400">
                    {pillar.description}
                  </p>
                </div>
              );
            })}
          </section>

          {/* Engineering Integrity */}
          <section className="mt-12 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 sm:p-8">
            <div className="flex items-center gap-2.5 text-emerald-400">
              <ShieldCheck className="h-5 w-5" />
              <h2 className="text-xl font-bold text-white">
                Our Engineering &amp; Transparency Commitments
              </h2>
            </div>
            <ul className="mt-5 grid gap-3 text-sm text-neutral-300 sm:grid-cols-2">
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <span>
                  <strong>No Shopkeeper Photo Access:</strong> Store partners can never view or
                  download customer portraits or generated try-on images.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <span>
                  <strong>No Silent AI Fallbacks:</strong> Development mock outputs and experimental
                  landmark PoCs are explicitly labeled in the UI and API metadata.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <span>
                  <strong>1-Click Self-Service Deletion:</strong> Shoppers can delete individual
                  jobs, their saved base portrait, or their entire account at any time.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <span>
                  <strong>Multi-Channel Passwordless OTP:</strong> Sign in via WhatsApp, SMS, or
                  Email without managing passwords.
                </span>
              </li>
            </ul>
          </section>

          {/* Navigation CTA */}
          <div className="mt-12 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-violet-800/50 bg-violet-950/20 p-6">
            <div>
              <h3 className="text-base font-bold text-white">
                Explore how WearMe works in stores and online
              </h3>
              <p className="mt-1 text-xs text-neutral-400 sm:text-sm">
                Inspect our 7-step flows, 56-subcategory capability matrix, or security architecture.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/how-it-works"
                className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-violet-500"
              >
                How It Works
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link
                href="/categories"
                className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-xs font-semibold text-neutral-200 hover:border-neutral-600"
              >
                <Layers className="h-3.5 w-3.5" />
                Category Matrix
              </Link>
              <Link
                href="/security"
                className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-xs font-semibold text-neutral-200 hover:border-neutral-600"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Security Architecture
              </Link>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

