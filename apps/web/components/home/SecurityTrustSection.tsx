import Link from 'next/link';
import {
  ShieldCheck,
  Lock,
  BookmarkCheck,
  Clock,
  FileCheck2,
  Eye,
  ArrowRight,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const TRUST_PILLARS = [
  {
    icon: Lock,
    title: 'Private customer photos',
    description:
      'Customer portraits and generated try-on results belong strictly to the customer experience, never to the shopkeeper or partner store.',
  },
  {
    icon: BookmarkCheck,
    title: 'Personal wardrobe',
    description:
      'Saved portraits and saved looks are tied to the customer’s authenticated account and isolated in user-scoped storage.',
  },
  {
    icon: Clock,
    title: 'Data minimization',
    description:
      'Anonymous try-on sessions expire automatically after 7 days unless the customer explicitly chooses to save them.',
  },
  {
    icon: FileCheck2,
    title: 'Secure processing',
    description:
      'Uploaded images are strictly validated for supported file types, magic bytes, pixel dimensions, and file size limits.',
  },
  {
    icon: Eye,
    title: 'Transparency',
    description:
      'Supported categories, experimental capabilities, and planned categories are disclosed honestly—never faked with mock outputs.',
  },
] as const;

export function SecurityTrustSection() {
  return (
    <section
      id="security-privacy"
      className="border-b border-neutral-900 bg-neutral-950/80 px-4 py-16 sm:px-6 md:py-24"
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-3xl">
            <Badge variant="emerald" className="mb-3">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span>Security, Privacy &amp; Customer Trust</span>
            </Badge>
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Your Style Is Personal. Your Photos Should Be Too.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-neutral-300 sm:text-base">
              Even when a customer scans a QR code inside a partner shop, the shopkeeper never gets
              access to customer portraits, generated try-on images, or personal wardrobe history.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/privacy"
              className={cn(
                buttonVariants({ variant: 'default', size: 'lg' }),
                'bg-emerald-600 hover:bg-emerald-500',
              )}
            >
              <ShieldCheck className="h-4 w-4" />
              <span>Read Our Privacy Policy</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/security"
              className={cn(buttonVariants({ variant: 'outline', size: 'lg' }))}
            >
              <span>Security Architecture</span>
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {TRUST_PILLARS.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <Card
                key={pillar.title}
                className="border-neutral-800/90 bg-neutral-900/50 transition-all hover:border-emerald-700/60"
              >
                <CardHeader className="pb-2">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-800/60 bg-emerald-950/60 text-emerald-300">
                    <Icon className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-base">{pillar.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-xs leading-relaxed text-neutral-300">
                    {pillar.description}
                  </CardDescription>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}

