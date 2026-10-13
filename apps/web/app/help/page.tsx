import Link from 'next/link';
import {
  LifeBuoy,
  Camera,
  KeyRound,
  Trash2,
  QrCode,
  ArrowRight,
  CheckCircle2,
  MessageSquare,
} from 'lucide-react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { ContextualNavBar } from '@/components/contextual-nav';
import { FaqSection } from '@/components/home/FaqSection';

const HELP_GUIDES = [
  {
    title: 'Portrait & Garment Photo Tips for Best Try-On Results',
    icon: Camera,
    tips: [
      'Use a clear, front-facing upper-body photo with even lighting and neutral posture.',
      'For Necklace/Pendant PoC try-ons, ensure your chin, neck, and collarbone area are unobstructed.',
      'Upload JPEG, PNG, or WebP images under 10 MB and up to 4096×4096 pixels.',
      'Remember that virtual try-on is a visual style preview—not a garment size or tailoring measurement tool.',
    ],
  },
  {
    title: 'Signing In with WhatsApp, SMS, or Email OTP',
    icon: KeyRound,
    tips: [
      'Choose your preferred channel (WhatsApp, SMS, or Email) on the Sign In screen.',
      'Enter the 6-digit code within 5 minutes. You can request a new code after the 30-second cooldown.',
      'In local development (NODE_ENV != production), a sandbox OTP preview is shown for testing without external gateways.',
    ],
  },
  {
    title: 'Using Walk-In Boutique QR Codes & Session Windows',
    icon: QrCode,
    tips: [
      'Scanning a valid boutique QR tag opens the focused In-Store Try-On view without requiring prior registration.',
      'In-store sponsored sessions remain active for up to 60 minutes (with a 15-minute inactivity window) so shops never pay for unlimited future usage.',
      'You can switch to Personal WearMe at any time or save your look to your private Digital Wardrobe after completion.',
    ],
  },
  {
    title: 'Deleting Your Portrait, Jobs, or Account',
    icon: Trash2,
    tips: [
      'Click "Delete Job & Images" on any try-on result or in My Activity to immediately erase those files from disk.',
      'Open Account (/account) or My Wardrobe (/my-wardrobe) to delete your saved base portrait in one click.',
      'Use "Delete Account & All Data" in Account to permanently erase your profile, portrait, jobs, and sessions.',
    ],
  },
];

export default function HelpPage() {
  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-neutral-50">
      <SiteHeader />

      <main className="flex-1 px-4 py-10 sm:px-6 md:py-14">
        <div className="mx-auto max-w-6xl">
          <ContextualNavBar
            backHref="/"
            backLabel="Back to Home"
            breadcrumbs={[
              { label: 'Home', href: '/' },
              { label: 'Help Center & FAQ' },
            ]}
          />

          <div className="border-b border-neutral-800/80 pb-8">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-violet-400">
              <LifeBuoy className="h-3.5 w-3.5" />
              Canonical Help Center &amp; FAQ
            </div>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-white sm:text-5xl">
              How Can We Help You Today?
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-neutral-400 sm:text-base">
              Practical guides for getting great virtual try-on results, managing your saved photos,
              understanding in-store QR sessions, and onboarding your boutique.
            </p>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {HELP_GUIDES.map((guide) => {
              const Icon = guide.icon;
              return (
                <div
                  key={guide.title}
                  className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6"
                >
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-violet-800/60 bg-violet-950/50 text-violet-300">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h2 className="text-base font-bold text-white">{guide.title}</h2>
                  </div>
                  <ul className="space-y-2.5 text-xs leading-relaxed text-neutral-300 sm:text-sm">
                    {guide.tips.map((tip) => (
                      <li key={tip} className="flex items-start gap-2">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>

        {/* Full 12-question FAQ integrated into the single canonical Help destination */}
        <div className="mt-8">
          <FaqSection showHelpCenterLink={false} />
        </div>

        <div className="mx-auto mt-10 max-w-6xl">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
            <div>
              <h3 className="text-base font-bold text-white">
                Need direct assistance or want to onboard a boutique?
              </h3>
              <p className="mt-1 text-xs text-neutral-400 sm:text-sm">
                Submit a ticket directly to our Customer Support, Boutique Partnership, or Privacy
                team.
              </p>
            </div>
            <Link
              href="/contact"
              className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-violet-500"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Contact Support
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
