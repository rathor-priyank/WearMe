import Link from 'next/link';
import { Sparkles, Lock } from 'lucide-react';
import { FOOTER_NAV_GROUPS } from '@/lib/navigation';

export function SiteFooter() {
  return (
    <footer className="border-t border-neutral-800/80 bg-neutral-950 px-4 py-14 md:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 md:grid-cols-12">
          <div className="md:col-span-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white">
                <Sparkles className="h-4 w-4" />
              </div>
              <span className="text-lg font-bold tracking-tight text-white">WearMe</span>
            </div>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-neutral-300">
              Privacy-first virtual try-on platform helping shoppers preview clothing and supported
              fashion items in local partner boutiques and online.
            </p>
            <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
              <Lock className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              <span>Customer photos are private. Shops never access your portraits or results.</span>
            </div>
          </div>

          <div className="md:col-span-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-200">
              Product
            </h3>
            <ul className="mt-3 flex flex-col gap-2.5 text-sm text-neutral-400">
              {FOOTER_NAV_GROUPS.product.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="transition-colors hover:text-white">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="md:col-span-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-200">
              For Boutiques
            </h3>
            <ul className="mt-3 flex flex-col gap-2.5 text-sm text-neutral-400">
              {FOOTER_NAV_GROUPS.partners.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="transition-colors hover:text-white">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="md:col-span-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-200">
              Support &amp; Company
            </h3>
            <ul className="mt-3 flex flex-col gap-2.5 text-sm text-neutral-400">
              {FOOTER_NAV_GROUPS.supportAndCompany.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="transition-colors hover:text-white">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="md:col-span-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-200">
              Trust &amp; Legal
            </h3>
            <ul className="mt-3 flex flex-col gap-2.5 text-sm text-neutral-400">
              {FOOTER_NAV_GROUPS.privacyAndLegal.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="transition-colors hover:text-white">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-neutral-900 pt-6 text-xs text-neutral-400 sm:flex-row">
          <p>&copy; {new Date().getFullYear()} WearMe Fashion Technologies. All rights reserved.</p>
          <p>
            Visual try-on previews assist styling decisions and do not guarantee physical tailoring
            or exact garment measurements.
          </p>
        </div>
      </div>
    </footer>
  );
}
