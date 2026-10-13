'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Mail,
  Store,
  ShieldCheck,
  HelpCircle,
  Send,
  CheckCircle2,
  AlertCircle,
  Loader2,
  MessageSquare,
} from 'lucide-react';
import type { ContactInquiryCategory, ContactInquiryResponse } from '@wearme/shared';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { ContextualNavBar } from '@/components/contextual-nav';
import { tryOnApi } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const TOPIC_OPTIONS: {
  id: ContactInquiryCategory;
  label: string;
  email: string;
  description: string;
  icon: typeof Mail;
}[] = [
  {
    id: 'support',
    label: 'Customer Support',
    email: 'support@wearme.fashion',
    description: 'Help with virtual try-on uploads, OTP sign-in, or personal wardrobe looks.',
    icon: HelpCircle,
  },
  {
    id: 'partner',
    label: 'Boutique Partnership',
    email: 'partners@wearme.fashion',
    description: 'Onboarding local boutiques, store QR kit setup, and subscription plans.',
    icon: Store,
  },
  {
    id: 'privacy',
    label: 'Privacy & Data Requests',
    email: 'privacy@wearme.fashion',
    description: 'Questions about portrait storage, data deletion, or account privacy.',
    icon: ShieldCheck,
  },
  {
    id: 'security',
    label: 'Security & Vulnerability',
    email: 'security@wearme.fashion',
    description: 'Responsible disclosure, partner isolation verification, or security reviews.',
    icon: ShieldCheck,
  },
  {
    id: 'general',
    label: 'General Inquiry',
    email: 'hello@wearme.fashion',
    description: 'Press, retail ecosystem questions, or general feedback.',
    icon: MessageSquare,
  },
];

function normalizeCategory(raw: string | null): ContactInquiryCategory {
  const val = raw?.trim().toLowerCase();
  if (val === 'partner' || val === 'boutique' || val === 'shop') return 'partner';
  if (val === 'privacy') return 'privacy';
  if (val === 'security') return 'security';
  if (val === 'general') return 'general';
  return 'support';
}

function ContactPageContent() {
  const searchParams = useSearchParams();
  const initialTopic = normalizeCategory(
    searchParams?.get('topic') || searchParams?.get('type'),
  );

  const [category, setCategory] = useState<ContactInquiryCategory>(initialTopic);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [organization, setOrganization] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submittedResult, setSubmittedResult] = useState<ContactInquiryResponse | null>(null);

  useEffect(() => {
    setCategory(
      normalizeCategory(searchParams?.get('topic') || searchParams?.get('type')),
    );
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (name.trim().length < 2) {
      setErrorMessage('Please enter your name (at least 2 characters).');
      return;
    }
    if (!email.includes('@')) {
      setErrorMessage('Please enter a valid email address so we can reply.');
      return;
    }
    if (message.trim().length < 10) {
      setErrorMessage('Please provide a few more details in your message (at least 10 characters).');
      return;
    }

    setSubmitting(true);
    try {
      const response = await tryOnApi.submitContactInquiry({
        category,
        name: name.trim(),
        email: email.trim(),
        organization: organization.trim() ? organization.trim() : undefined,
        message: message.trim(),
      });
      setSubmittedResult(response);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to submit inquiry right now. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setSubmittedResult(null);
    setMessage('');
    setErrorMessage(null);
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 md:px-6 md:py-14">
      <ContextualNavBar
        backHref="/help"
        backLabel="Back to Help Center"
        breadcrumbs={[
          { label: 'Home', href: '/' },
          { label: 'Help', href: '/help' },
          { label: 'Contact & Support' },
        ]}
      />

      <div className="max-w-3xl">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-800/50 bg-violet-950/60 px-3 py-1 text-xs font-medium text-violet-300">
          <Mail className="h-3.5 w-3.5" />
          Direct Support &amp; Boutique Onboarding
        </span>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Contact WearMe
        </h1>
        <p className="mt-3 text-base leading-relaxed text-neutral-300">
          Select a department below to send a message directly to our support, boutique partnership,
          or privacy engineering teams.
        </p>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-12">
        {/* Left Column: Interactive Inquiry Form */}
        <div className="lg:col-span-7">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6 md:p-8">
            {submittedResult ? (
              <div
                data-testid="contact-submission-success"
                className="flex flex-col items-start rounded-xl border border-emerald-900/60 bg-emerald-950/30 p-6"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-900/50 text-emerald-300">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <h2 className="mt-4 text-xl font-bold text-white">Inquiry Received</h2>
                <p className="mt-2 text-sm leading-relaxed text-neutral-200">
                  {submittedResult.notice}
                </p>
                <div className="mt-4 w-full rounded-lg border border-neutral-800 bg-neutral-950/80 p-3.5 text-xs text-neutral-300">
                  <p>
                    <span className="font-semibold text-neutral-400">Reference ID:</span>{' '}
                    <code className="text-emerald-300">{submittedResult.inquiryId}</code>
                  </p>
                  <p className="mt-1">
                    <span className="font-semibold text-neutral-400">Department:</span>{' '}
                    <span className="uppercase text-violet-300">{submittedResult.category}</span>
                  </p>
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleReset}
                    className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-neutral-800"
                  >
                    Send Another Message
                  </button>
                  <Link
                    href="/help"
                    className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-500"
                  >
                    Return to Help Center
                  </Link>
                </div>
              </div>
            ) : (
              <form
                onSubmit={handleSubmit}
                data-testid="contact-inquiry-form"
                className="space-y-5"
              >
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-300">
                    1. Select Topic
                  </label>
                  <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                    {TOPIC_OPTIONS.map((item) => {
                      const Icon = item.icon;
                      const active = category === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setCategory(item.id)}
                          data-testid={`contact-topic-${item.id}`}
                          className={cn(
                            'flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors',
                            active
                              ? 'border-violet-600 bg-violet-950/50 text-white'
                              : 'border-neutral-800 bg-neutral-950/60 text-neutral-300 hover:border-neutral-700 hover:text-white',
                          )}
                        >
                          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
                          <div>
                            <div className="text-xs font-semibold">{item.label}</div>
                            <div className="mt-0.5 text-[11px] text-neutral-400">{item.email}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="contact-name"
                      className="block text-xs font-medium text-neutral-300"
                    >
                      Your Name *
                    </label>
                    <input
                      id="contact-name"
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Aarav Mehta"
                      className="mt-1.5 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3.5 py-2.5 text-sm text-white placeholder:text-neutral-500 focus:border-violet-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="contact-email"
                      className="block text-xs font-medium text-neutral-300"
                    >
                      Email Address *
                    </label>
                    <input
                      id="contact-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="mt-1.5 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3.5 py-2.5 text-sm text-white placeholder:text-neutral-500 focus:border-violet-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="contact-org"
                    className="block text-xs font-medium text-neutral-300"
                  >
                    Boutique / Store Name (Optional)
                  </label>
                  <input
                    id="contact-org"
                    type="text"
                    value={organization}
                    onChange={(e) => setOrganization(e.target.value)}
                    placeholder="e.g., Atelier Indiranagar Flagship"
                    className="mt-1.5 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3.5 py-2.5 text-sm text-white placeholder:text-neutral-500 focus:border-violet-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="contact-message"
                    className="block text-xs font-medium text-neutral-300"
                  >
                    How can we help? *
                  </label>
                  <textarea
                    id="contact-message"
                    rows={4}
                    required
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Share details about your question, store location, or support request..."
                    className="mt-1.5 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3.5 py-2.5 text-sm text-white placeholder:text-neutral-500 focus:border-violet-500 focus:outline-none"
                  />
                </div>

                {errorMessage && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-xl border border-red-900/60 bg-red-950/40 p-3 text-xs text-red-200"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  data-testid="contact-submit-button"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-950/50 transition-colors hover:bg-violet-500 disabled:opacity-50 sm:w-auto"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Sending Inquiry...</span>
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      <span>Submit Inquiry</span>
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Right Column: Direct Channels & Self-Service */}
        <div className="space-y-4 lg:col-span-5">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
            <h2 className="text-base font-bold text-white">Direct Department Channels</h2>
            <p className="mt-1.5 text-xs text-neutral-400">
              Prefer email? Reach the appropriate team directly:
            </p>
            <div className="mt-4 space-y-3">
              {TOPIC_OPTIONS.slice(0, 4).map((dept) => {
                const Icon = dept.icon;
                return (
                  <div
                    key={dept.id}
                    className="rounded-xl border border-neutral-800/90 bg-neutral-950/60 p-3.5"
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-violet-400" />
                      <span className="text-xs font-semibold text-white">{dept.label}</span>
                    </div>
                    <p className="mt-1 text-xs text-neutral-400">{dept.description}</p>
                    <a
                      href={`mailto:${dept.email}`}
                      className="mt-2 inline-block text-xs font-semibold text-violet-300 hover:text-violet-200"
                    >
                      {dept.email}
                    </a>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-5">
            <h3 className="text-sm font-semibold text-white">Looking for instant answers?</h3>
            <p className="mt-1 text-xs leading-relaxed text-neutral-400">
              Check our step-by-step guides for photo quality, supported categories, and portrait
              privacy controls.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/help"
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:border-neutral-600 hover:text-white"
              >
                Browse Help Guides
              </Link>
              <Link
                href="/account"
                className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:border-neutral-700 hover:text-white"
              >
                Manage Account Privacy
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <SiteHeader />
      <Suspense
        fallback={
          <main className="mx-auto max-w-6xl px-4 py-14 text-sm text-neutral-400 md:px-6">
            Loading contact form...
          </main>
        }
      >
        <ContactPageContent />
      </Suspense>
      <SiteFooter />
    </div>
  );
}
