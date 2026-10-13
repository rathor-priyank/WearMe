import Link from 'next/link';
import {
  Mail,
  Store,
  ShieldAlert,
  HelpCircle,
  Lock,
  ArrowRight,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const CONTACT_CHANNELS = [
  {
    icon: HelpCircle,
    title: 'Customer Support & Help',
    email: 'support@wearme.fashion',
    topic: 'support',
    description:
      'Questions about OTP sign-in, uploading photos, or using your personal digital wardrobe.',
  },
  {
    icon: Store,
    title: 'Shop Partnership Inquiries',
    email: 'partners@wearme.fashion',
    topic: 'partner',
    description:
      'Onboard your boutique or retail store with custom QR standees and supported catalog links.',
  },
  {
    icon: Lock,
    title: 'Privacy & Data Deletion Requests',
    email: 'privacy@wearme.fashion',
    topic: 'privacy',
    description:
      'Assistance with portrait deletion, account removal, or customer data privacy inquiries.',
  },
  {
    icon: ShieldAlert,
    title: 'Security & General Business',
    email: 'security@wearme.fashion',
    topic: 'security',
    description:
      'Responsible security disclosure, enterprise compliance questions, and media inquiries.',
  },
] as const;

export function ContactSupportSection() {
  return (
    <section id="contact" className="px-4 py-16 sm:px-6 md:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-violet-400">
              Contact &amp; Support
            </p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Here for shoppers, boutiques &amp; privacy requests
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-neutral-300 sm:text-base">
              Reach the right team directly or submit a validated inquiry through our Contact Center.
            </p>
          </div>

          <Link
            href="/contact"
            className={cn(buttonVariants({ variant: 'default', size: 'lg' }))}
          >
            <Mail className="h-4 w-4" />
            <span>Open Contact Form</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {CONTACT_CHANNELS.map((channel) => {
            const Icon = channel.icon;
            return (
              <Card
                key={channel.title}
                className="flex flex-col justify-between border-neutral-800/90 bg-neutral-900/50 transition-all hover:border-violet-700/60"
              >
                <CardHeader>
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-violet-800/60 bg-violet-950/60 text-violet-300">
                    <Icon className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-base">{channel.title}</CardTitle>
                  <CardDescription className="text-xs leading-relaxed text-neutral-300">
                    {channel.description}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Link
                    href={`/contact?topic=${channel.topic}`}
                    className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-violet-300 hover:text-violet-200"
                  >
                    <span>{channel.email}</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}

