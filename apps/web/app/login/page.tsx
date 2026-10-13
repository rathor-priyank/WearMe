'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Smartphone,
  Mail,
  MessageSquare,
  KeyRound,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  QrCode,
  ArrowRight,
  ShieldCheck,
  BookmarkCheck,
  Lock,
} from 'lucide-react';
import type { OtpChannel } from '@wearme/shared';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { tryOnApi } from '@/lib/api-client';
import {
  getOrCreateSessionId,
  getStoredStoreContext,
  setStoredAuthSession,
} from '@/lib/job-history';
import { cn } from '@/lib/utils';

function getSafeRedirectPath(rawNext: string | null): string {
  if (!rawNext) return '/my-wardrobe';
  if (rawNext.startsWith('/') && !rawNext.startsWith('//') && !rawNext.startsWith('/login')) {
    return rawNext;
  }
  return '/my-wardrobe';
}

const CHANNEL_OPTIONS: Array<{
  channel: OtpChannel;
  label: string;
  icon: typeof Smartphone;
  placeholder: string;
  inputLabel: string;
}> = [
  {
    channel: 'whatsapp',
    label: 'WhatsApp',
    icon: Smartphone,
    placeholder: '+91 98765 43210',
    inputLabel: 'WhatsApp Mobile Number',
  },
  {
    channel: 'sms',
    label: 'SMS',
    icon: MessageSquare,
    placeholder: '+91 98765 43210',
    inputLabel: 'Mobile Number for SMS',
  },
  {
    channel: 'email',
    label: 'Email',
    icon: Mail,
    placeholder: 'you@example.com',
    inputLabel: 'Email Address',
  },
];

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = getSafeRedirectPath(searchParams.get('next'));
  const initialMode = searchParams.get('mode') === 'signup' ? 'signup' : 'login';

  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [channel, setChannel] = useState<OtpChannel>('whatsapp');
  const [step, setStep] = useState<'destination' | 'otp'>('destination');
  const [phoneInput, setPhoneInput] = useState('+91 98765 43210');
  const [emailInput, setEmailInput] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [devOtpHint, setDevOtpHint] = useState<string | null>(null);
  const [resendCooldownSec, setResendCooldownSec] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOrCreateSessionId();
  }, []);

  useEffect(() => {
    if (resendCooldownSec <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldownSec((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldownSec]);

  const activeDestination = channel === 'email' ? emailInput.trim() : phoneInput.trim();

  const handleRequestOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeDestination || busy) return;
    setBusy(true);
    setError(null);
    try {
      const storeCtx = getStoredStoreContext();
      const res = await tryOnApi.requestOtp({
        channel,
        ...(channel === 'email'
          ? { email: emailInput.trim() }
          : { phone: phoneInput.trim() }),
        storeId: storeCtx?.storeId,
      });
      setDevOtpHint(res.devOtpPreview ?? null);
      if (res.devOtpPreview) {
        setOtpInput(res.devOtpPreview);
      }
      setResendCooldownSec(res.resendAvailableInSeconds ?? 30);
      setStep('otp');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send verification code.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otpInput.trim().length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const storeCtx = getStoredStoreContext();
      const res = await tryOnApi.upgradeSession({
        channel,
        ...(channel === 'email'
          ? { email: emailInput.trim() }
          : { phone: phoneInput.trim() }),
        otpCode: otpInput.trim(),
        storeId: storeCtx?.storeId,
        returnUrl: nextPath,
      });
      setStoredAuthSession(res.authToken, res.user);
      router.push(res.redirectTo || nextPath);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid or expired OTP code.');
    } finally {
      setBusy(false);
    }
  };

  const currentChannelMeta = CHANNEL_OPTIONS.find((c) => c.channel === channel)!;

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-1 items-center gap-10 lg:grid-cols-12">
      {/* Left Column: Value Proposition */}
      <div className="lg:col-span-6">
        <Badge variant="default" className="mb-4">
          <Sparkles className="h-3.5 w-3.5 text-violet-400" />
          <span>Multi-Channel Passwordless OTP · WhatsApp, SMS &amp; Email</span>
        </Badge>
        <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          {mode === 'signup'
            ? 'Create Your Private WearMe Wardrobe'
            : 'Sign In to Your WearMe Wardrobe'}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-300 sm:text-base">
          Sign in with a one-time code via WhatsApp, SMS, or Email to access your private portrait
          vault, saved try-on looks, and standalone Virtual Try-On Studio.
        </p>

        <div className="mt-8 space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-emerald-900/60 bg-emerald-950/30 p-4">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
            <div>
              <p className="text-sm font-semibold text-white">
                Strict Customer Photo Privacy Boundary
              </p>
              <p className="mt-0.5 text-xs text-neutral-300">
                Your photos and try-on previews are private to your account. Partner shops never get
                access to your personal portraits or generated try-on images.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-neutral-800/80 bg-neutral-900/50 p-4">
            <BookmarkCheck className="mt-0.5 h-5 w-5 shrink-0 text-violet-400" />
            <div>
              <p className="text-sm font-semibold text-white">Decoupled Base Portrait Vault</p>
              <p className="mt-0.5 text-xs text-neutral-400">
                Your base photo is stored safely in user-scoped storage (
                <code className="text-violet-300">users/&lt;id&gt;/base_portrait.jpg</code>) and can
                be deleted whenever you want.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-neutral-800/80 bg-neutral-900/50 p-4">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
            <div>
              <p className="text-sm font-semibold text-white">
                Link Phone &amp; Email seamlessly
              </p>
              <p className="mt-0.5 text-xs text-neutral-400">
                Verify with WhatsApp, SMS, or Email—and link multiple channels to the same digital
                wardrobe.
              </p>
            </div>
          </div>
        </div>

        {/* Walk-In QR Exception Notice */}
        <div className="mt-6 rounded-xl border border-violet-900/60 bg-violet-950/30 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <QrCode className="h-5 w-5 shrink-0 text-violet-300" />
              <div>
                <p className="text-xs font-semibold text-violet-200">
                  In a partner boutique right now?
                </p>
                <p className="text-[11px] text-neutral-400">
                  Store QR scans launch instant try-on directly without requiring login upfront.
                </p>
              </div>
            </div>
            <Link
              href="/try-on?storeId=store_indiranagar_01"
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-violet-700/60 bg-violet-900/50 px-3 py-1.5 text-xs font-semibold text-violet-200 hover:bg-violet-800/60"
            >
              <span>QR Demo</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Right Column: Multi-Channel Auth Card */}
      <div className="lg:col-span-6">
        <Card className="border-neutral-800 bg-neutral-900/80 shadow-2xl shadow-violet-950/30">
          <CardHeader>
            {/* Mode Switcher */}
            <div className="mb-4 grid grid-cols-2 rounded-xl border border-neutral-800 bg-neutral-950 p-1">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={cn(
                  'rounded-lg py-2 text-xs font-semibold transition-all',
                  mode === 'login'
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-200',
                )}
              >
                Log In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('signup');
                  setError(null);
                }}
                className={cn(
                  'rounded-lg py-2 text-xs font-semibold transition-all',
                  mode === 'signup'
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-200',
                )}
              >
                Get Started
              </button>
            </div>

            <div
              data-testid="login-step-indicator"
              className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider"
            >
              <span
                className={cn(
                  'rounded-md border px-2 py-0.5',
                  step === 'destination'
                    ? 'border-violet-600 bg-violet-950/70 text-violet-200'
                    : 'border-emerald-800/60 bg-emerald-950/40 text-emerald-300',
                )}
              >
                1. Channel &amp; Destination
              </span>
              <span className="text-neutral-600">→</span>
              <span
                className={cn(
                  'rounded-md border px-2 py-0.5',
                  step === 'otp'
                    ? 'border-violet-600 bg-violet-950/70 text-violet-200'
                    : 'border-neutral-800 bg-neutral-950 text-neutral-500',
                )}
              >
                2. Verify 6-Digit OTP
              </span>
            </div>

            <CardTitle className="text-xl">
              {step === 'destination'
                ? 'Choose Your Verification Channel'
                : `Enter 6-Digit ${currentChannelMeta.label} OTP`}
            </CardTitle>
            <CardDescription>
              {step === 'destination'
                ? 'Select WhatsApp, SMS, or Email to receive a one-time verification code.'
                : `Code sent to ${activeDestination}. Verify to continue to ${nextPath}.`}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {step === 'destination' ? (
              <form onSubmit={handleRequestOtp} className="space-y-4">
                {/* Channel Selector */}
                <div>
                  <span className="mb-1.5 block text-xs font-medium text-neutral-300">
                    OTP Delivery Channel
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {CHANNEL_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      const selected = channel === opt.channel;
                      return (
                        <button
                          key={opt.channel}
                          type="button"
                          data-testid={`otp-channel-${opt.channel}`}
                          onClick={() => {
                            setChannel(opt.channel);
                            setError(null);
                          }}
                          className={cn(
                            'flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-all',
                            selected
                              ? 'border-violet-500 bg-violet-950/70 text-violet-200'
                              : 'border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200',
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          <span>{opt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="login-destination-input"
                    className="mb-1.5 block text-xs font-medium text-neutral-300"
                  >
                    {currentChannelMeta.inputLabel}
                  </label>
                  <div className="relative">
                    {channel === 'email' ? (
                      <Mail className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-neutral-500" />
                    ) : (
                      <Smartphone className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-neutral-500" />
                    )}
                    {channel === 'email' ? (
                      <input
                        id="login-destination-input"
                        type="email"
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        placeholder={currentChannelMeta.placeholder}
                        required
                        className="w-full rounded-xl border border-neutral-700 bg-neutral-950 py-2.5 pl-10 pr-4 text-sm text-white placeholder-neutral-500 focus:border-violet-500 focus:outline-none"
                      />
                    ) : (
                      <input
                        id="login-destination-input"
                        type="tel"
                        value={phoneInput}
                        onChange={(e) => setPhoneInput(e.target.value)}
                        placeholder={currentChannelMeta.placeholder}
                        required
                        className="w-full rounded-xl border border-neutral-700 bg-neutral-950 py-2.5 pl-10 pr-4 text-sm text-white placeholder-neutral-500 focus:border-violet-500 focus:outline-none"
                      />
                    )}
                  </div>
                </div>

                {error && (
                  <div className="flex items-center gap-2 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                    <span>{error}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  size="lg"
                  disabled={busy || !activeDestination}
                  className="w-full"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <KeyRound className="h-4 w-4" />
                  )}
                  <span>Send {currentChannelMeta.label} OTP</span>
                </Button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                {devOtpHint && (
                  <div className="flex items-center justify-between rounded-lg border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
                    <span>
                      Local Dev Sandbox OTP:{' '}
                      <code className="font-mono font-bold text-amber-300">{devOtpHint}</code>
                    </span>
                    <span className="text-[11px] text-amber-400">Auto-filled</span>
                  </div>
                )}

                <div>
                  <label
                    htmlFor="login-otp-input"
                    className="mb-1.5 block text-xs font-medium text-neutral-300"
                  >
                    6-Digit OTP Code
                  </label>
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-neutral-500" />
                    <input
                      id="login-otp-input"
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={otpInput}
                      onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ''))}
                      placeholder="123456"
                      required
                      className="w-full rounded-xl border border-neutral-700 bg-neutral-950 py-2.5 pl-10 pr-4 font-mono text-sm tracking-widest text-white placeholder-neutral-600 focus:border-violet-500 focus:outline-none"
                    />
                  </div>
                </div>

                {error && (
                  <div className="flex items-center gap-2 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                    <span>{error}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  size="lg"
                  disabled={busy || otpInput.trim().length !== 6}
                  className="w-full"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  <span>Verify &amp; Continue</span>
                </Button>

                <div className="flex items-center justify-between pt-1 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setStep('destination');
                      setError(null);
                    }}
                    className="text-neutral-400 hover:text-neutral-200"
                  >
                    Change channel or destination
                  </button>

                  <button
                    type="button"
                    disabled={resendCooldownSec > 0 || busy}
                    onClick={() => handleRequestOtp()}
                    className="font-medium text-violet-300 hover:text-violet-200 disabled:text-neutral-500"
                  >
                    {resendCooldownSec > 0
                      ? `Resend code in ${resendCooldownSec}s`
                      : 'Resend OTP'}
                  </button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-neutral-50">
      <SiteHeader />

      <main className="flex-1 px-4 py-16 sm:px-6 md:py-24">
        <Suspense
          fallback={
            <div className="mx-auto flex max-w-md items-center justify-center py-24 text-sm text-neutral-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin text-violet-400" />
              Loading authentication...
            </div>
          }
        >
          <LoginFormContent />
        </Suspense>
      </main>

      <SiteFooter />
    </div>
  );
}
