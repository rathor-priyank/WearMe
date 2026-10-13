import { redirect } from 'next/navigation';

/**
 * Legacy /faq route redirects to the single canonical Help Center & FAQ destination (/help#faq)
 * so FAQ content is never duplicated across multiple URLs.
 */
export default function FaqPage() {
  redirect('/help#faq');
}
