import Link from 'next/link';
import { Sparkles, ArrowRight, Shield, Zap } from 'lucide-react';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="border-b border-neutral-800 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-violet-400" />
            <span className="text-lg font-bold tracking-tight">WearMe</span>
          </div>
          <Link
            href="/try-on"
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 transition-colors"
          >
            Try it now
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-800 bg-violet-950 px-4 py-1.5 text-sm text-violet-300">
          <Sparkles className="h-3.5 w-3.5" />
          AI-powered virtual try-on
        </div>

        <h1 className="mb-6 max-w-3xl text-5xl font-bold leading-tight tracking-tight md:text-6xl lg:text-7xl">
          See yourself in{' '}
          <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
            any outfit
          </span>
        </h1>

        <p className="mb-10 max-w-xl text-lg text-neutral-400 md:text-xl">
          Upload your photo and a clothing image. Our AI shows you exactly how it looks on you —
          before you buy.
        </p>

        <Link
          href="/try-on"
          className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-violet-900/40 hover:bg-violet-500 transition-colors"
        >
          Start trying on
          <ArrowRight className="h-5 w-5" />
        </Link>
      </section>

      {/* Features */}
      <section className="border-t border-neutral-800 px-6 py-16">
        <div className="mx-auto grid max-w-4xl gap-8 md:grid-cols-3">
          {[
            {
              icon: <Zap className="h-5 w-5 text-violet-400" />,
              title: 'Fast results',
              description: 'Get your virtual try-on result in seconds.',
            },
            {
              icon: <Sparkles className="h-5 w-5 text-violet-400" />,
              title: 'Realistic output',
              description: 'AI generates accurate clothing placement on your body.',
            },
            {
              icon: <Shield className="h-5 w-5 text-violet-400" />,
              title: 'Private by design',
              description: 'Your photos are never shared and auto-deleted after 7 days.',
            },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
              <div className="mb-3">{f.icon}</div>
              <h3 className="mb-1 font-semibold">{f.title}</h3>
              <p className="text-sm text-neutral-400">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-neutral-800 px-6 py-6 text-center text-sm text-neutral-600">
        WearMe · AI Virtual Try-On · V1
      </footer>
    </main>
  );
}

