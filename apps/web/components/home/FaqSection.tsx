import Link from 'next/link';
import { HelpCircle, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export const WEARME_FAQ_ITEMS = [
  {
    question: 'What is WearMe?',
    answer:
      'WearMe is a privacy-first virtual try-on platform that lets shoppers preview how supported clothing and fashion items look on their own photo—both inside local partner boutiques via QR code and online through a personal digital wardrobe.',
  },
  {
    question: 'How does WearMe work in a local shop?',
    answer:
      'When you visit a participating shop, you scan the shop’s WearMe QR code or a garment tag QR code with your phone camera. This opens the mobile try-on experience in your browser so you can upload a photo and preview supported items immediately.',
  },
  {
    question: 'Do I need an account when scanning a shop QR code?',
    answer:
      'No. Walk-in shoppers scanning a valid partner boutique QR code can browse and run virtual try-on previews anonymously without creating an account upfront. Signing in with an OTP is only required if you choose to save your portrait and looks to a permanent wardrobe.',
  },
  {
    question: 'Can the shopkeeper see my uploaded photo or try-on result?',
    answer:
      'No. Your uploaded portrait, generated try-on results, and personal wardrobe are strictly private to you. Shopkeepers and partner stores only receive aggregated operational analytics (such as total scan counts) and are blocked by server-side access controls from viewing customer photos.',
  },
  {
    question: 'How do I save my photo and try-on looks for future use?',
    answer:
      'After generating a try-on preview—or from the login page—you can verify a 6-digit one-time password (OTP). Your portrait is copied into your private user storage vault (users/<userId>/base_portrait.jpg) and your saved looks are linked to your personal wardrobe.',
  },
  {
    question: 'Which sign-in methods does WearMe support?',
    answer:
      'WearMe supports passwordless one-time password (OTP) verification via WhatsApp, SMS, and Email. You can sign in with whichever channel is most convenient for you and link your phone number and email to the same account.',
  },
  {
    question: 'What clothing or fashion categories are currently supported?',
    answer:
      'Upper-body garments—including T-shirts, shirts, kurtas, tops, sweaters, hoodies, and jackets—are live-supported. Necklace and pendant try-on is available as an experimental proof-of-concept when explicitly enabled on both API and AI services.',
  },
  {
    question: 'Why are some categories marked experimental or planned?',
    answer:
      'Different fashion categories (such as eyewear, earrings, footwear, or lower-body garments) require dedicated anatomical landmark alignment or specialized computer vision models. WearMe discloses support status honestly and never routes unsupported categories to fake or generic models.',
  },
  {
    question: 'How long are photos and try-on results stored?',
    answer:
      'Anonymous try-on jobs automatically expire after 7 days and are purged from storage. If you verify via OTP and save a look or base portrait to your personal wardrobe, it is retained in your private account until you choose to delete it.',
  },
  {
    question: 'How can I delete my photo, try-on results, or account?',
    answer:
      'You can delete any individual try-on job in one click from your History or Wardrobe page, delete your saved base portrait at any time from your Account & Privacy page, or permanently delete your entire account and all associated files.',
  },
  {
    question: 'Does WearMe guarantee exact garment size or physical fit?',
    answer:
      'No. WearMe provides a visual styling preview to help you see how colors, silhouettes, and designs look on your photo. It is not a physical tailoring or body-measurement tool.',
  },
  {
    question: 'How can a shop partner with WearMe?',
    answer:
      'Boutique owners and retail stores can visit the Partner page (/partner) to generate store-specific QR standees and contact our partnership team for catalog onboarding.',
  },
] as const;

interface FaqSectionProps {
  limit?: number;
  showHelpCenterLink?: boolean;
}

export function FaqSection({ limit, showHelpCenterLink = true }: FaqSectionProps = {}) {
  const items = typeof limit === 'number' ? WEARME_FAQ_ITEMS.slice(0, limit) : WEARME_FAQ_ITEMS;

  return (
    <section
      id="faq"
      className="border-b border-neutral-900 px-4 py-16 sm:px-6 md:py-20"
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <Badge variant="default" className="mb-3">
              <HelpCircle className="h-3.5 w-3.5 text-violet-400" />
              <span>Frequently Asked Questions</span>
            </Badge>
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Clear answers about how WearMe works
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-neutral-300 sm:text-base">
              Everything shoppers and boutique partners need to know about privacy, supported
              categories, OTP sign-in, and data control.
            </p>
          </div>
          {showHelpCenterLink && (
            <Link
              href="/help#faq"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-300 hover:text-violet-200 sm:text-sm"
            >
              <span>
                {typeof limit === 'number'
                  ? `Read All ${WEARME_FAQ_ITEMS.length} FAQs & Guides`
                  : 'Browse Step-by-Step Help Guides'}
              </span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {items.map((item, idx) => (
            <details
              key={item.question}
              open={idx < 4}
              className="group rounded-2xl border border-neutral-800/90 bg-neutral-900/50 p-5 transition-colors hover:border-violet-800/60"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-bold text-white sm:text-base">
                <span>{item.question}</span>
                <span className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-0.5 font-mono text-xs text-violet-300 group-open:bg-violet-950/70">
                  Q{idx + 1}
                </span>
              </summary>
              <p className="mt-3 border-t border-neutral-800/80 pt-3 text-xs leading-relaxed text-neutral-300 sm:text-sm">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
