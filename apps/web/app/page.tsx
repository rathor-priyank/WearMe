import { cookies } from 'next/headers';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { HeroSection } from '@/components/home/HeroSection';
import { FeaturesGrid } from '@/components/home/FeaturesGrid';
import { EcosystemTabs } from '@/components/home/EcosystemTabs';
import { SecurityTrustSection } from '@/components/home/SecurityTrustSection';
import { FaqSection } from '@/components/home/FaqSection';
import { AUTH_COOKIE_NAME } from '@/lib/job-history';

/**
 * WearMe Public Website Homepage (Server Component).
 * Concisely communicates what WearMe does, how In-Store QR try-on and Personal Wardrobes work,
 * strict customer photo privacy boundaries, and routes users to either Customer Try-On or Partner Portal
 * without duplicating full help centers, partner dashboards, or contact forms inline.
 */
export default async function HomePage() {
  const cookieStore = await cookies();
  const authCookie = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const loggedInFlag = cookieStore.get('wearme_logged_in_v1')?.value;
  const initialIsAuthenticated = Boolean(
    (authCookie && authCookie.startsWith('wm_auth_')) || loggedInFlag === '1',
  );

  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-neutral-50">
      <SiteHeader />

      <main className="flex-1">
        <HeroSection initialIsAuthenticated={initialIsAuthenticated} />
        <FeaturesGrid />
        <EcosystemTabs />
        <SecurityTrustSection />
        <FaqSection limit={4} />
      </main>

      <SiteFooter />
    </div>
  );
}
