import Link from 'next/link';
import { Scale, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { ContextualNavBar } from '@/components/contextual-nav';

export default function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-neutral-50">
      <SiteHeader />

      <main className="flex-1 px-4 py-10 sm:px-6 md:py-14">
        <div className="mx-auto max-w-4xl">
          <ContextualNavBar
            backHref="/"
            backLabel="Back to Home"
            breadcrumbs={[
              { label: 'Home', href: '/' },
              { label: 'Terms of Service' },
            ]}
          />

          <div className="border-b border-neutral-800/80 pb-8">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-violet-400">
              <Scale className="h-3.5 w-3.5" />
              Terms of Use &amp; Product Disclaimers
            </div>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              WearMe Terms of Use
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-neutral-400 sm:text-base">
              Clear terms governing the use of WearMe&apos;s walk-in boutique QR try-on experience,
              online Digital Wardrobe, and virtual try-on previews.
            </p>
          </div>

          <div className="mt-8 space-y-6">
            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6">
              <h2 className="text-lg font-bold text-white">
                1. Visual Style Preview Disclaimer (Not a Size Guarantee)
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-neutral-300">
                WearMe generates AI and computer-vision virtual try-on previews to help shoppers
                visualize how garments and jewellery styles look. Generated outputs are visual
                approximations only and do not constitute physical sizing, tailoring, or fit
                measurement guarantees. Always consult retailer size charts before purchasing.
              </p>
            </section>

            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6">
              <h2 className="text-lg font-bold text-white">
                2. Acceptable Photo Uploads &amp; Consent
              </h2>
              <ul className="mt-3 space-y-2 text-sm text-neutral-300">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  <span>
                    You may only upload portraits of yourself or images for which you hold explicit
                    permission from the subject.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  <span>
                    Uploading unlawful, non-consensual, or abusive imagery is strictly prohibited.
                  </span>
                </li>
              </ul>
            </section>

            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6">
              <h2 className="text-lg font-bold text-white">
                3. Customer Ownership &amp; Partner Boutique Boundaries
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-neutral-300">
                You retain ownership of any portrait you upload. Partner boutiques using WearMe QR
                codes are contractually and technically prohibited from accessing your uploaded
                portraits, generated try-on images, phone number, email address, or private Digital
                Wardrobe.
              </p>
            </section>

            <section className="rounded-2xl border border-amber-800/60 bg-amber-950/20 p-6">
              <div className="flex items-center gap-2 text-amber-300">
                <AlertTriangle className="h-5 w-5" />
                <h2 className="text-lg font-bold text-white">
                  4. Upstream AI Provider Licensing Notice
                </h2>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-neutral-300">
                When configured with <code className="text-amber-200">AI_PROVIDER=huggingface</code>{' '}
                (IDM-VTON), inference is subject to the upstream CC BY-NC-SA 4.0 non-commercial
                research license. Commercial deployments must use a licensed commercial provider
                (such as <code className="text-amber-200">AI_PROVIDER=fashn</code>) or first-party
                licensed weights.
              </p>
            </section>
          </div>

          <div className="mt-10 flex flex-wrap gap-3">
            <Link
              href="/privacy"
              className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-xs font-semibold text-neutral-200 hover:border-neutral-600"
            >
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              Read Privacy Policy
            </Link>
            <Link
              href="/security"
              className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-xs font-semibold text-neutral-200 hover:border-neutral-600"
            >
              Security Architecture
            </Link>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

