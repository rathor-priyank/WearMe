import Link from 'next/link';
import {
  Shield,
  Lock,
  Trash2,
  Server,
  FileCheck2,
  Scale,
  ArrowRight,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

const PROVIDERS_PRIVACY = [
  {
    name: 'Local Necklace/Pendant PoC (landmark_jewellery_neck)',
    env: 'ENABLE_NECKLACE_POC=true / AI_PROVIDER=necklace-poc',
    network: '100% Local Processing (No external network transfer)',
    license: 'First-party WearMe CV pipeline (MediaPipe / OpenCV / Pillow)',
    details:
      'Person and jewellery images are processed entirely inside the local FastAPI service using landmark geometry, alpha matte extraction, and feather compositing.',
  },
  {
    name: 'Development Mock Provider (MockProvider)',
    env: 'AI_PROVIDER=mock (Default)',
    network: '100% Local Processing (No external network transfer)',
    license: 'Internal development & test harness',
    details:
      'Produces a clearly watermarked composite image locally so developers can verify upload, job polling, and deletion lifecycles without consuming GPU quota.',
  },
  {
    name: 'Hugging Face IDM-VTON (HuggingFaceProvider)',
    env: 'AI_PROVIDER=huggingface',
    network: 'HTTPS Gradio call to yisol/IDM-VTON Space',
    license: 'CC BY-NC-SA 4.0 (Non-Commercial Research & Evaluation Only)',
    details:
      'Transmits preprocessed upper-body person and garment images to the configured Hugging Face Space. Access tokens (HF_API_TOKEN) are kept strictly server-side and redacted from all logs and error responses.',
  },
  {
    name: 'FASHN Virtual Try-On API (FASHNApiProvider)',
    env: 'AI_PROVIDER=fashn',
    network: 'HTTPS REST call to api.fashn.ai/v1',
    license: 'Commercial API (Subject to FASHN API terms)',
    details:
      'Sends base64-encoded person and garment inputs to the FASHN v1 endpoint when explicitly configured with a server-side FASHN_API_KEY.',
  },
];

export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-neutral-50">
      <SiteHeader />

      <main className="flex-1 px-4 py-10 sm:px-6 md:py-12">
        <div className="mx-auto max-w-4xl">
          {/* Header */}
          <div className="mb-10 border-b border-neutral-800/80 pb-6">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">
              <Shield className="h-3.5 w-3.5" />
              Privacy, Data Retention &amp; Pipeline Transparency
            </div>
            <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
              How WearMe Handles Your Photos &amp; Try-On Jobs
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-neutral-400 sm:text-base">
              This page documents the exact technical behavior of the WearMe platform—from file
              upload validation and local filesystem layout to immediate deletion and upstream AI
              provider data flow.
            </p>
          </div>

          {/* Section 1: Upload Validation & Local Storage */}
          <section className="mb-8 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6 sm:p-8">
            <div className="mb-4 flex items-center gap-2.5">
              <FileCheck2 className="h-5 w-5 text-violet-400" />
              <h2 className="text-xl font-bold text-neutral-100">
                1. Upload Validation &amp; Isolated Job Storage
              </h2>
            </div>
            <p className="text-sm leading-relaxed text-neutral-400">
              When you submit a try-on request via <code className="text-neutral-200">POST /api/v1/try-on/upload</code>,
              both the NestJS API and the FastAPI AI service validate your files before running
              inference:
            </p>

            <ul className="mt-4 space-y-2.5 text-xs text-neutral-300 sm:text-sm">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <span>
                  <strong>Strict MIME, Magic-Byte &amp; Pixel Bomb Limits:</strong> Only{' '}
                  <code className="text-neutral-200">image/jpeg</code>,{' '}
                  <code className="text-neutral-200">image/png</code>, and{' '}
                  <code className="text-neutral-200">image/webp</code> files up to 10 MB and
                  4096×4096 px (16.7M pixels max) are accepted.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <span>
                  <strong>Session-Scoped Job Ownership:</strong> Each browser generates a local
                  session identifier (<code className="text-neutral-200">x-wearme-session-id</code>
                  ). Jobs created with a session ID cannot be viewed, processed, listed, or deleted
                  by other browser sessions.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <span>
                  <strong>Isolated Job Directory &amp; Path Boundary Enforcement:</strong> Files for
                  each job are written to{' '}
                  <code className="text-neutral-200">uploads/jobs/&lt;jobId&gt;/</code> with
                  allowlisted names (<code className="text-neutral-200">person.*</code>,{' '}
                  <code className="text-neutral-200">garment.*</code>, and{' '}
                  <code className="text-neutral-200">result.*</code>). When serving files via{' '}
                  <code className="text-neutral-200">
                    GET /api/v1/files/jobs/:jobId/:filename
                  </code>
                  , the API validates UUID and filename patterns and enforces strict directory
                  boundary checks against path traversal.
                </span>
              </li>
            </ul>
          </section>

          {/* Section 2: Retention & Immediate Deletion */}
          <section className="mb-8 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6 sm:p-8">
            <div className="mb-4 flex items-center gap-2.5">
              <Trash2 className="h-5 w-5 text-emerald-400" />
              <h2 className="text-xl font-bold text-neutral-100">
                2. Data Retention (`expiresAt`) &amp; Immediate Deletion
              </h2>
            </div>
            <p className="text-sm leading-relaxed text-neutral-400">
              Every <code className="text-neutral-200">TryOnJob</code> row in PostgreSQL is created
              with an <code className="text-neutral-200">expiresAt</code> timestamp set to{' '}
              <strong>7 days</strong> after creation (<code className="text-neutral-200">IMAGE_RETENTION_DAYS=7</code>).
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                <h3 className="text-sm font-semibold text-neutral-100">
                  Immediate Hard Delete (Recommended)
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-neutral-400">
                  Clicking <strong>Delete Job</strong> in the Studio or Session History triggers{' '}
                  <code className="text-neutral-200">DELETE /api/v1/try-on/:jobId</code>. This
                  immediately deletes all uploaded/generated files, removes the entire{' '}
                  <code className="text-neutral-200">uploads/jobs/&lt;jobId&gt;/</code> directory
                  from disk, and deletes the PostgreSQL record.
                </p>
              </div>
              <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                <h3 className="text-sm font-semibold text-neutral-100">
                  7-Day Expiration &amp; Orphan Cleanup
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-neutral-400">
                  Expired jobs (<code className="text-neutral-200">expiresAt &lt;= now</code>) are
                  automatically purged when accessed and excluded from{' '}
                  <code className="text-neutral-200">GET /api/v1/try-on/jobs</code>. Operators can
                  also run <code className="text-neutral-200">pnpm cleanup:storage</code> to purge
                  all expired database jobs and any orphaned{' '}
                  <code className="text-neutral-200">uploads/jobs/&lt;jobId&gt;/</code> folders.
                </p>
              </div>
            </div>
          </section>

          {/* Section 3: AI Providers & Licensing */}
          <section className="mb-8 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6 sm:p-8">
            <div className="mb-4 flex items-center gap-2.5">
              <Server className="h-5 w-5 text-violet-400" />
              <h2 className="text-xl font-bold text-neutral-100">
                3. AI Provider Routing &amp; Licensing Constraints
              </h2>
            </div>
            <p className="mb-5 text-sm leading-relaxed text-neutral-400">
              WearMe never silently substitutes mock output when a real AI provider fails, and never
              exposes upstream API tokens or internal server paths to the browser. Below is how each
              configured provider processes images:
            </p>

            <div className="space-y-4">
              {PROVIDERS_PRIVACY.map((p) => (
                <div
                  key={p.name}
                  className="rounded-xl border border-neutral-800 bg-neutral-950 p-4"
                >
                  <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-center">
                    <h3 className="text-sm font-bold text-neutral-100">{p.name}</h3>
                    <code className="rounded border border-neutral-800 bg-neutral-900 px-2 py-0.5 font-mono text-[11px] text-violet-300">
                      {p.env}
                    </code>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-neutral-400">
                    <span>
                      <strong className="text-neutral-300">Network:</strong> {p.network}
                    </span>
                    <span>
                      <strong className="text-neutral-300">License:</strong> {p.license}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-neutral-400">{p.details}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Section 4: Evaluation Consent Gate */}
          <section className="mb-10 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6 sm:p-8">
            <div className="mb-3 flex items-center gap-2.5">
              <Scale className="h-5 w-5 text-amber-400" />
              <h2 className="text-xl font-bold text-neutral-100">
                4. Benchmark &amp; Evaluation Consent Gate
              </h2>
            </div>
            <p className="text-sm leading-relaxed text-neutral-400">
              Our offline evaluation harness (<code className="text-neutral-200">scripts/evaluate_vton.py</code>)
              enforces a mandatory permission gate (<code className="text-neutral-200">verify_case_permission</code>
              ): benchmark cases without <code className="text-neutral-200">consent_verified: true</code>,{' '}
              <code className="text-neutral-200">permission_source</code>, and{' '}
              <code className="text-neutral-200">license_url</code> /{' '}
              <code className="text-neutral-200">attribution</code> are rejected before any image
              file is read from disk.
            </p>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-violet-800/50 bg-violet-950/20 p-6">
            <div>
              <h3 className="text-base font-bold text-neutral-100">
                Ready to test a virtual try-on?
              </h3>
              <p className="text-xs text-neutral-400">
                Try upper-body garments or the experimental Necklace/Pendant PoC in the Studio.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/categories"
                className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-xs font-semibold text-neutral-200 hover:border-neutral-600 transition-colors"
              >
                Explore Categories
              </Link>
              <Link
                href="/try-on"
                className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-violet-500 transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Open Studio
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

