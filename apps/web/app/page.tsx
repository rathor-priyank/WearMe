import Link from 'next/link';
import {
  Sparkles,
  ArrowRight,
  Shield,
  SlidersHorizontal,
  Layers,
  ScanFace,
  CheckCircle2,
  FlaskConical,
  Clock,
  Trash2,
  FileCheck2,
  Lock,
  HelpCircle,
} from 'lucide-react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

const PIPELINE_STEPS = [
  {
    step: '01',
    icon: FileCheck2,
    title: 'Strict Upload & Image Validation',
    description:
      'Person and product photos are verified for MIME type (JPEG/PNG/WebP), file size (up to 10 MB), and minimum pixel resolution before a try-on job is created.',
  },
  {
    step: '02',
    icon: Layers,
    title: 'Category-Aware Routing',
    description:
      'WearMe maps 38 subcategories across 8 wearable domains to the appropriate model family—preventing jewellery or accessories from ever being distorted by upper-body clothing diffusion.',
  },
  {
    step: '03',
    icon: ScanFace,
    title: 'Garment Synthesis or Landmark Placement',
    description:
      'Upper-body garments route to diffusion try-on with torso region compositing, while the experimental Necklace & Pendant PoC uses MediaPipe neck/clavicle geometry and alpha compositing.',
  },
  {
    step: '04',
    icon: SlidersHorizontal,
    title: 'Interactive Inspection & Instant Deletion',
    description:
      'Compare original and try-on results with an interactive before/after slider or 3-panel view, download verified outputs, or immediately purge job files from storage.',
  },
];

const CAPABILITY_TIERS = [
  {
    badge: 'Supported · Upper-Body Clothing',
    badgeStyle: 'border-emerald-800/80 bg-emerald-950/50 text-emerald-300',
    icon: CheckCircle2,
    iconColor: 'text-emerald-400',
    title: 'Upper-Body Garments',
    subcategories: ['T-Shirt', 'Shirt', 'Top', 'Sweater', 'Hoodie', 'Jacket', 'Kurta'],
    routing: 'yisol/IDM-VTON · FASHN API · Dev Mock',
    description:
      'Full support for tops, shirts, knitwear, and outerwear with torso-region feather compositing that preserves your face, hair, skin tone, and lower-body clothing.',
    ctaLabel: 'Try Upper-Body Clothing',
    ctaHref: '/try-on?subcategory=TSHIRT',
  },
  {
    badge: 'Experimental PoC · Neck Jewellery',
    badgeStyle: 'border-amber-700/80 bg-amber-950/50 text-amber-300',
    icon: FlaskConical,
    iconColor: 'text-amber-400',
    title: 'Necklaces & Pendants (PoC)',
    subcategories: ['Necklace', 'Pendant'],
    routing: 'landmark_jewellery_neck (ENABLE_NECKLACE_POC=true)',
    description:
      '10-stage local computer-vision pipeline: neck & clavicle landmark estimation, product matte extraction, geometric placement, chin/hair occlusion handling, and soft contact shadows.',
    ctaLabel: 'Try Necklace PoC in Studio',
    ctaHref: '/try-on?subcategory=NECKLACE',
  },
  {
    badge: 'Roadmap · Specialized Models Required',
    badgeStyle: 'border-neutral-700 bg-neutral-900 text-neutral-300',
    icon: Clock,
    iconColor: 'text-neutral-400',
    title: 'Earrings, Eyewear, Footwear & More',
    subcategories: [
      'Earrings & Rings',
      'Prescription Glasses & Sunglasses',
      'Watches & Smartwatches',
      'Lower-Body & Full-Body',
      'Bags, Footwear & Headwear',
    ],
    routing: 'Explicitly gated (never routed to clothing diffusion)',
    description:
      'Cataloged across 38 wearable subcategories in our taxonomy and evaluation harness. Requests return explicit capability diagnostics rather than fabricated outputs.',
    ctaLabel: 'Browse All 38 Subcategories',
    ctaHref: '/categories',
  },
];

const FAQS = [
  {
    question: 'Which wearable categories can I run right now?',
    answer:
      'Upper-body clothing (T-shirts, shirts, tops, sweaters, hoodies, jackets, kurtas) is supported across all configured providers. Necklaces and pendants are available as an experimental local computer-vision PoC when ENABLE_NECKLACE_POC=true is enabled on the AI service.',
  },
  {
    question: 'Why are earrings, eyewear, and shoes marked as requiring a specialized model?',
    answer:
      'Upper-body garment diffusion models (such as IDM-VTON) are trained on torso clothing and will hallucinate or corrupt images if given jewellery, eyewear, or footwear. WearMe enforces strict category routing and refuses to pass unsupported categories through clothing diffusion or present mock outputs as genuine AI results.',
  },
  {
    question: 'Does WearMe alter my face, body height, or existing bottomwear?',
    answer:
      'No. For upper-body clothing, our post-processing pipeline composites only the torso garment region with feathered edges onto your original photograph. For the Necklace/Pendant PoC, only the neck/clavicle zone is composited.',
  },
  {
    question: 'How are my uploaded photos stored and deleted?',
    answer:
      'Images are stored locally under uploads/jobs/<jobId>/ and tagged with a 7-day expiresAt timestamp in PostgreSQL. You can permanently delete any job and all of its files on disk immediately from the Try-On Studio or Session History page.',
  },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-neutral-50">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative overflow-hidden border-b border-neutral-900 px-4 py-20 sm:px-6 md:py-28">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-violet-950/35 via-neutral-950 to-neutral-950" />
          <div className="relative mx-auto max-w-5xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-800/70 bg-violet-950/60 px-4 py-1.5 text-xs font-medium text-violet-300">
              <Sparkles className="h-3.5 w-3.5 text-violet-400" />
              Category-Aware Virtual Try-On Studio · Upper-Body Clothing + Necklace PoC
            </div>

            <h1 className="mx-auto mb-6 max-w-4xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl md:text-6xl">
              Try on clothing &amp; neck jewellery with{' '}
              <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-indigo-300 bg-clip-text text-transparent">
                identity-preserving precision
              </span>
            </h1>

            <p className="mx-auto mb-10 max-w-2xl text-base leading-relaxed text-neutral-400 sm:text-lg">
              Upload a front-facing photo and a garment or necklace image. WearMe routes each request
              to category-specific computer vision pipelines—preserving your original face, skin
              tone, proportions, and unedited attire.
            </p>

            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
              <Link
                href="/try-on"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-7 py-3.5 text-base font-semibold text-white shadow-lg shadow-violet-950/50 hover:bg-violet-500 transition-colors sm:w-auto"
              >
                Open Try-On Studio
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/categories"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/90 px-7 py-3.5 text-base font-medium text-neutral-200 hover:border-neutral-700 hover:bg-neutral-800 transition-colors sm:w-auto"
              >
                <Layers className="h-4 w-4 text-violet-400" />
                Explore 38 Wearable Categories
              </Link>
            </div>

            {/* Quick Architecture Pills */}
            <div className="mt-12 grid grid-cols-2 gap-3 text-left sm:grid-cols-4">
              {[
                {
                  label: 'Wearable Taxonomy',
                  value: '8 Domains · 38 Subcategories',
                  sub: 'Explicit capability routing',
                },
                {
                  label: 'Upper-Body Clothing',
                  value: 'Torso-Preserving VTON',
                  sub: 'IDM-VTON · FASHN · Mock',
                },
                {
                  label: 'Necklace & Pendant',
                  value: '10-Stage Local CV PoC',
                  sub: 'MediaPipe + Alpha Warping',
                },
                {
                  label: 'Data Control',
                  value: 'Instant Job Deletion',
                  sub: 'One-click file & DB purge',
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-xl border border-neutral-800/80 bg-neutral-900/50 p-4"
                >
                  <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
                    {stat.label}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-neutral-100">{stat.value}</p>
                  <p className="mt-0.5 text-xs text-neutral-400">{stat.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section className="border-b border-neutral-900 px-4 py-16 sm:px-6 md:py-20">
          <div className="mx-auto max-w-6xl">
            <div className="mb-12 max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-violet-400">
                End-to-End Pipeline
              </p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
                How WearMe processes a virtual try-on job
              </h2>
              <p className="mt-2 text-sm text-neutral-400 sm:text-base">
                Every try-on request flows through NestJS validation, PostgreSQL job state tracking,
                and FastAPI category routing before returning provenance-tagged outputs.
              </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {PIPELINE_STEPS.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.step}
                    className="flex flex-col justify-between rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6"
                  >
                    <div>
                      <div className="mb-4 flex items-center justify-between">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-violet-800/50 bg-violet-950/50 text-violet-400">
                          <Icon className="h-5 w-5" />
                        </div>
                        <span className="font-mono text-xs font-semibold text-neutral-600">
                          STEP {item.step}
                        </span>
                      </div>
                      <h3 className="mb-2 text-base font-semibold text-neutral-100">
                        {item.title}
                      </h3>
                      <p className="text-xs leading-relaxed text-neutral-400">
                        {item.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Supported vs Experimental vs Roadmap Categories */}
        <section className="border-b border-neutral-900 px-4 py-16 sm:px-6 md:py-20">
          <div className="mx-auto max-w-6xl">
            <div className="mb-12 flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <div className="max-w-2xl">
                <p className="text-xs font-semibold uppercase tracking-wider text-violet-400">
                  Honest Capability Matrix
                </p>
                <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
                  Supported, Experimental PoC &amp; Roadmap Categories
                </h2>
                <p className="mt-2 text-sm text-neutral-400">
                  We distinguish between live-validated upper-body garment models, our experimental
                  local Necklace/Pendant computer-vision PoC, and categories awaiting dedicated 2D/3D
                  processors.
                </p>
              </div>
              <Link
                href="/categories"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-400 hover:text-violet-300"
              >
                View full 38-item capability catalog
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              {CAPABILITY_TIERS.map((tier) => {
                const Icon = tier.icon;
                return (
                  <div
                    key={tier.title}
                    className="flex flex-col justify-between rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6"
                  >
                    <div>
                      <div className="mb-4 flex items-center justify-between gap-2">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${tier.badgeStyle}`}
                        >
                          <Icon className={`h-3.5 w-3.5 ${tier.iconColor}`} />
                          {tier.badge}
                        </span>
                      </div>

                      <h3 className="text-lg font-bold text-neutral-100">{tier.title}</h3>
                      <p className="mt-1 font-mono text-xs text-neutral-500">{tier.routing}</p>
                      <p className="mt-3 text-sm leading-relaxed text-neutral-400">
                        {tier.description}
                      </p>

                      <div className="mt-5 flex flex-wrap gap-1.5">
                        {tier.subcategories.map((sub) => (
                          <span
                            key={sub}
                            className="rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-xs text-neutral-300"
                          >
                            {sub}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="mt-6 pt-4 border-t border-neutral-800/80">
                      <Link
                        href={tier.ctaHref}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-400 hover:text-violet-300"
                      >
                        {tier.ctaLabel}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Privacy & Data Handling Summary */}
        <section className="border-b border-neutral-900 px-4 py-16 sm:px-6 md:py-20">
          <div className="mx-auto max-w-6xl">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6 sm:p-8 md:p-10">
              <div className="grid gap-8 lg:grid-cols-3 lg:items-center">
                <div className="lg:col-span-2">
                  <div className="inline-flex items-center gap-2 rounded-full border border-emerald-800/60 bg-emerald-950/40 px-3 py-1 text-xs font-medium text-emerald-300">
                    <Shield className="h-3.5 w-3.5 text-emerald-400" />
                    Transparent Storage &amp; Privacy Controls
                  </div>
                  <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
                    Your photos stay under your control
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-neutral-400">
                    WearMe validates every upload before saving to local job storage, records a 7-day
                    expiration window (`expiresAt`), and gives you an immediate one-click delete
                    action that removes both database metadata and physical image files.
                  </p>

                  <div className="mt-6 grid gap-4 sm:grid-cols-3">
                    <div className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-4">
                      <Lock className="mb-2 h-4 w-4 text-violet-400" />
                      <p className="text-xs font-semibold text-neutral-200">
                        Isolated Job Directories
                      </p>
                      <p className="mt-1 text-xs text-neutral-400">
                        Each job writes to its own `uploads/jobs/&lt;jobId&gt;/` folder on the local
                        server.
                      </p>
                    </div>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-4">
                      <Trash2 className="mb-2 h-4 w-4 text-emerald-400" />
                      <p className="text-xs font-semibold text-neutral-200">
                        Immediate Hard Delete
                      </p>
                      <p className="mt-1 text-xs text-neutral-400">
                        `DELETE /api/v1/try-on/:jobId` deletes person, garment, and result images on
                        the spot.
                      </p>
                    </div>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-4">
                      <FileCheck2 className="mb-2 h-4 w-4 text-amber-400" />
                      <p className="text-xs font-semibold text-neutral-200">
                        Provenance Metadata
                      </p>
                      <p className="mt-1 text-xs text-neutral-400">
                        Every result clearly reports whether it was produced by a live model, PoC
                        pipeline, or dev mock.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-950 p-6">
                  <h3 className="text-sm font-semibold text-neutral-200">
                    Inspect our architecture &amp; retention rules
                  </h3>
                  <p className="text-xs leading-relaxed text-neutral-400">
                    Read the full breakdown of how person images, product cutouts, upstream AI
                    providers, and local session history work.
                  </p>
                  <Link
                    href="/privacy"
                    className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-xs font-semibold text-neutral-200 hover:border-neutral-600 hover:bg-neutral-800 transition-colors"
                  >
                    Read Privacy &amp; Pipeline Guide
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="px-4 py-16 sm:px-6 md:py-20">
          <div className="mx-auto max-w-4xl">
            <div className="mb-10 text-center">
              <div className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-violet-400">
                <HelpCircle className="h-3.5 w-3.5" />
                Frequently Asked Questions
              </div>
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Technical &amp; Product FAQ
              </h2>
            </div>

            <div className="grid gap-4">
              {FAQS.map((faq) => (
                <div
                  key={faq.question}
                  className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6"
                >
                  <h3 className="text-sm font-semibold text-neutral-100 sm:text-base">
                    {faq.question}
                  </h3>
                  <p className="mt-2 text-xs leading-relaxed text-neutral-400 sm:text-sm">
                    {faq.answer}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
