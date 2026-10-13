import Link from 'next/link';
import { Search, Wand2, BookmarkCheck, Info, ArrowRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

const CORE_CAPABILITIES = [
  {
    icon: Search,
    accent: 'text-violet-400 border-violet-800/60 bg-violet-950/60',
    tag: '01 · Browse & Select',
    title: 'Discover products',
    description:
      'Browse supported items from partner shops or online catalogs across upper-body clothing and supported fashion categories.',
  },
  {
    icon: Wand2,
    accent: 'text-fuchsia-400 border-fuchsia-800/60 bg-fuchsia-950/60',
    tag: '02 · Visual Try-On',
    title: 'Preview your look',
    description:
      'Upload a photo or use your saved portrait to generate a visual try-on preview that preserves your face, hair, and background.',
  },
  {
    icon: BookmarkCheck,
    accent: 'text-emerald-400 border-emerald-800/60 bg-emerald-950/60',
    tag: '03 · Personal Wardrobe',
    title: 'Shop with confidence',
    description:
      'Save favorites to your personal wardrobe and decide what suits you before buying—in a local boutique or from home.',
  },
] as const;

export function FeaturesGrid() {
  return (
    <section
      id="what-wearme-does"
      className="border-b border-neutral-900 px-4 py-16 sm:px-6 md:py-24"
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-violet-400">
              What WearMe Does
            </p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Clear, privacy-first virtual try-on for everyday shopping
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-neutral-300 sm:text-base">
              WearMe helps you visualize how supported clothing and fashion items look on your own
              photo before you commit to buying.
            </p>
          </div>
          <Link
            href="/categories"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-300 hover:text-violet-200 sm:text-sm"
          >
            <span>View 38-Category Support Matrix</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {CORE_CAPABILITIES.map((item) => {
            const Icon = item.icon;
            return (
              <Card
                key={item.title}
                className="flex flex-col justify-between border-neutral-800/90 bg-neutral-900/50 transition-all duration-200 hover:-translate-y-1 hover:border-violet-700/60"
              >
                <CardHeader>
                  <div className="mb-3 flex items-center justify-between">
                    <div
                      className={`flex h-11 w-11 items-center justify-center rounded-xl border ${item.accent}`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="rounded-full border border-neutral-800 bg-neutral-950 px-2.5 py-1 font-mono text-[10px] font-medium text-neutral-300">
                      {item.tag}
                    </span>
                  </div>
                  <CardTitle className="text-xl">{item.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm leading-relaxed text-neutral-300">
                    {item.description}
                  </CardDescription>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mt-8 flex items-start gap-3 rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3.5 text-xs leading-relaxed text-neutral-300 sm:text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
          <p>
            <strong className="font-semibold text-white">Visual Preview Notice:</strong> WearMe
            provides a visual preview to help with styling decisions; it does not guarantee exact
            physical tailoring or measurement accuracy.
          </p>
        </div>
      </div>
    </section>
  );
}
