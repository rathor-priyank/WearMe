import Link from 'next/link';
import { Store, ShoppingBag, CheckCircle2, ArrowRight } from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { PrimaryAuthCta } from '@/components/home/PrimaryAuthCta';
import { cn } from '@/lib/utils';

export interface AudienceCardsProps {
  initialIsAuthenticated?: boolean;
}

const SHOP_PARTNER_BENEFITS = [
  'Help walk-in customers visualize outfits quickly on their mobile phones.',
  'Reduce hesitation when physical trial rooms are busy or unavailable.',
  'Let customers explore more items from your store catalog with confidence.',
  'Bridge offline store visits with digital follow-up through customer-saved wardrobes.',
  'Simple setup with store-specific and product-specific QR codes.',
  'Customer privacy is protected by default, building shopper trust in your store.',
] as const;

const SHOPPER_BENEFITS = [
  'Preview outfits on your own photo before buying in store or online.',
  'Avoid repeated photo uploads by saving a private base portrait if desired.',
  'Keep favorite looks organized in one personal digital wardrobe.',
  'Use seamlessly in partner shops through QR scan or online from home.',
  'Stay in full control of your personal photos, try-on history, and account data.',
] as const;

export function AudienceCards({ initialIsAuthenticated = false }: AudienceCardsProps) {
  return (
    <section
      id="for-shops"
      className="border-b border-neutral-900 px-4 py-16 sm:px-6 md:py-24"
    >
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-violet-400">
            For Shops &amp; For Shoppers
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Why Shops &amp; Shoppers Choose WearMe
          </h2>
          <p className="mt-3 text-sm text-neutral-300 sm:text-base">
            Designed to help local boutiques elevate the in-store experience while giving shoppers a
            private, reusable digital wardrobe.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          {/* Card 1: Why Shops Should Use WearMe */}
          <Card className="group flex flex-col justify-between border-neutral-800 bg-gradient-to-br from-neutral-900/90 via-neutral-900/60 to-violet-950/25 transition-all duration-200 hover:-translate-y-1 hover:border-violet-500/70">
            <div>
              <CardHeader>
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-violet-700/60 bg-violet-950/70 text-violet-300">
                    <Store className="h-6 w-6" />
                  </div>
                  <Badge variant="default">Why Shops Should Use WearMe</Badge>
                </div>
                <CardTitle className="text-2xl">
                  Elevate in-store discovery with privacy-safe QR try-on
                </CardTitle>
                <CardDescription className="mt-2 text-sm text-neutral-300">
                  Built for boutique owners, local clothing stores, and retail partners who want to
                  help customers preview more styles effortlessly.
                </CardDescription>
              </CardHeader>

              <CardContent>
                <ul className="space-y-3">
                  {SHOP_PARTNER_BENEFITS.map((point) => (
                    <li key={point} className="flex items-start gap-2.5 text-sm text-neutral-200">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </div>

            <CardFooter className="border-t border-neutral-800/80 pt-6">
              <Link
                href="/partner"
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'lg' }),
                  'w-full justify-between border-violet-700/60 bg-violet-950/40 text-violet-200 hover:bg-violet-900/50 hover:text-white',
                )}
              >
                <span>Become a WearMe Partner</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </CardFooter>
          </Card>

          {/* Card 2: Why Shoppers Should Use WearMe */}
          <Card
            id="for-shoppers"
            className="group flex flex-col justify-between border-neutral-800 bg-gradient-to-br from-neutral-900/90 via-neutral-900/60 to-emerald-950/25 transition-all duration-200 hover:-translate-y-1 hover:border-emerald-500/70"
          >
            <div>
              <CardHeader>
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-700/60 bg-emerald-950/70 text-emerald-300">
                    <ShoppingBag className="h-6 w-6" />
                  </div>
                  <Badge variant="emerald">Why Shoppers Should Use WearMe</Badge>
                </div>
                <CardTitle className="text-2xl">
                  Your private portrait vault &amp; personal digital wardrobe
                </CardTitle>
                <CardDescription className="mt-2 text-sm text-neutral-300">
                  Preview outfits before buying, keep favorite looks organized, and stay in complete
                  control of your personal photos.
                </CardDescription>
              </CardHeader>

              <CardContent>
                <ul className="space-y-3">
                  {SHOPPER_BENEFITS.map((point) => (
                    <li key={point} className="flex items-start gap-2.5 text-sm text-neutral-200">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </div>

            <CardFooter className="border-t border-neutral-800/80 pt-6">
              <PrimaryAuthCta
                initialIsAuthenticated={initialIsAuthenticated}
                defaultLabel="Explore WearMe"
                authenticatedLabel="Open My Wardrobe"
                size="lg"
                className="w-full justify-between"
              />
            </CardFooter>
          </Card>
        </div>
      </div>
    </section>
  );
}
