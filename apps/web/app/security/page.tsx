import Link from 'next/link';
import {
  ShieldCheck,
  Lock,
  EyeOff,
  KeyRound,
  FileCheck2,
  Trash2,
  Server,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { ContextualNavBar } from '@/components/contextual-nav';

const SECURITY_CONTROLS = [
  {
    title: 'Strict Customer vs. Shopkeeper Isolation',
    icon: EyeOff,
    points: [
      'Customer portraits and generated try-on images are scoped exclusively to the customer session or authenticated customer account.',
      'Storage endpoints (/api/v1/files/jobs/:jobId/:filename and /api/v1/files/users/:userId/:filename) reject any request carrying shopkeeper headers or storeId parameters with HTTP 403 Forbidden.',
      'Partner boutiques only receive aggregated operational analytics (scan counts, category interest, first-touch attribution counts).',
    ],
  },
  {
    title: 'Authorized & HMAC-Signed File Delivery',
    icon: Lock,
    points: [
      'Customer files are never exposed via public directory listings or unauthenticated static folders.',
      'Every image URL returned by the API includes a short-lived HMAC-SHA256 signature bound to the exact storage key and expiration timestamp.',
      'Direct requests to file endpoints verify either a valid customer signature, an HttpOnly session cookie, or a verified Bearer token.',
    ],
  },
  {
    title: 'Multi-Channel Passwordless OTP Hardening',
    icon: KeyRound,
    points: [
      'Supports WhatsApp, SMS, and Email OTP verification with cryptographically random 6-digit codes.',
      'Enforces a 5-minute OTP TTL, 30-second resend cooldown, per-target rate limiting, and maximum verification attempt lockouts.',
      'Uses constant-time digest comparison (crypto.timingSafeEqual) and invalidates OTP codes immediately after single use.',
      'Development OTP fallback (123456) is strictly disabled when NODE_ENV=production.',
    ],
  },
  {
    title: 'Upload Validation & Pixel-Bomb Protection',
    icon: FileCheck2,
    points: [
      'Both NestJS and FastAPI verify file MIME types and magic-byte signatures (JPEG, PNG, WebP only).',
      'Enforces a 10 MB file size ceiling and 4096×4096 maximum pixel dimensions to prevent decompression bomb attacks.',
      'Strict path-traversal guards ensure all reads and writes remain inside the designated uploads root.',
    ],
  },
  {
    title: 'HttpOnly Session Cookies & Secret Redaction',
    icon: Server,
    points: [
      'Authentication tokens and session identifiers are issued via HttpOnly, SameSite=Lax cookies (with Secure in production).',
      'Long-lived raw bearer tokens are never persisted in browser localStorage.',
      'Upstream AI provider keys (HF_API_TOKEN, FASHN_API_KEY) remain strictly server-side and are redacted from all error responses.',
    ],
  },
  {
    title: 'Self-Service Portrait & Account Deletion',
    icon: Trash2,
    points: [
      'Anonymous try-on jobs automatically expire after 7 days (IMAGE_RETENTION_DAYS=7).',
      'Customers can immediately delete any single try-on job, delete their saved base portrait, or permanently delete their entire account and all associated files.',
    ],
  },
];

export default function SecurityPage() {
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
              { label: 'Security Architecture' },
            ]}
          />

          <div className="border-b border-neutral-800/80 pb-8">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              Security &amp; Privacy Architecture
            </div>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-white sm:text-5xl">
              Your Style Is Personal. Your Photos Should Be Too.
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-relaxed text-neutral-300 sm:text-lg">
              WearMe is architected from the storage layer up so that customer portraits and
              generated try-on outputs remain private to the customer—even when a try-on begins via
              an in-store boutique QR code.
            </p>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {SECURITY_CONTROLS.map((sec) => {
              const Icon = sec.icon;
              return (
                <div
                  key={sec.title}
                  className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6"
                >
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-800/60 bg-emerald-950/50 text-emerald-400">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h2 className="text-base font-bold text-white sm:text-lg">{sec.title}</h2>
                  </div>
                  <ul className="space-y-2.5 text-xs leading-relaxed text-neutral-300 sm:text-sm">
                    {sec.points.map((pt) => (
                      <li key={pt} className="flex items-start gap-2">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          <div className="mt-12 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-800/50 bg-emerald-950/20 p-6">
            <div>
              <h3 className="text-base font-bold text-white">
                Manage your saved photos and privacy settings
              </h3>
              <p className="mt-1 text-xs text-neutral-300 sm:text-sm">
                Read our full data retention policy or open your Account &amp; Privacy controls.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/privacy"
                className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-xs font-semibold text-neutral-200 hover:border-neutral-600"
              >
                Privacy Policy
              </Link>
              <Link
                href="/account"
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                Account &amp; Privacy Controls
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

