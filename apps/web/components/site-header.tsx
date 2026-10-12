'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sparkles, Layers, History, ShieldCheck, Wand2, BookmarkCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { href: '/try-on', label: 'Try-On Studio', icon: Wand2 },
  { href: '/my-wardrobe', label: 'My Wardrobe', icon: BookmarkCheck },
  { href: '/categories', label: 'Categories (38)', icon: Layers },
  { href: '/history', label: 'Recent Jobs', icon: History },
  { href: '/privacy', label: 'Privacy & Pipeline', icon: ShieldCheck },
] as const;

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-800/80 bg-neutral-950/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 md:px-6">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white shadow-md shadow-violet-950/50">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-base font-bold tracking-tight text-white group-hover:text-violet-300 transition-colors">
              WearMe
            </span>
            <span className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">
              Virtual Try-On Studio
            </span>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
          {NAV_LINKS.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-violet-950/60 text-violet-300 border border-violet-800/60'
                    : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200',
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/try-on"
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-violet-950 hover:bg-violet-500 transition-colors sm:text-sm"
          >
            <Wand2 className="h-3.5 w-3.5" />
            Launch Studio
          </Link>
        </div>
      </div>

      {/* Mobile secondary nav bar */}
      <div className="flex items-center gap-1 overflow-x-auto border-t border-neutral-900 px-4 py-2 md:hidden">
        {NAV_LINKS.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                active
                  ? 'bg-violet-950/70 text-violet-300 border border-violet-800/50'
                  : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </header>
  );
}
