import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');

function readWebFile(relPath) {
  return fs.readFileSync(path.join(webRoot, relPath), 'utf8');
}

test('Navigation IA: Public, Customer, Sponsored Try-On, and Partner contexts are strictly separated', () => {
  const navSource = readWebFile('lib/navigation.ts');

  // 1. Public primary nav has strictly 4 canonical items: Home, How It Works, For Boutiques, Help
  assert.match(navSource, /PUBLIC_PRIMARY_NAV:\s*readonly\s+NavItem\[\]\s*=\s*\[/);
  for (const expectedHref of ["'/'", "'/how-it-works'", "'/partner'", "'/help'"]) {
    assert.ok(
      navSource.includes(`href: ${expectedHref}`),
      `Expected PUBLIC_PRIMARY_NAV to include ${expectedHref}`,
    );
  }

  // 2. Customer primary nav has strictly 4 canonical items: Try On, My Wardrobe, My Activity, Account
  for (const expectedHref of ["'/try-on'", "'/my-wardrobe'", "'/history'", "'/account'"]) {
    assert.ok(
      navSource.includes(`href: ${expectedHref}`),
      `Expected CUSTOMER_PRIMARY_NAV to include ${expectedHref}`,
    );
  }

  // 3. Partner portal tabs define all 5 structured sections
  for (const tabId of ["'overview'", "'usage'", "'subscription'", "'setup'", "'support'"]) {
    assert.ok(
      navSource.includes(`id: ${tabId}`),
      `Expected PARTNER_PORTAL_TABS to include tab ${tabId}`,
    );
  }

  // 4. Switching to Personal WearMe explicitly strips storeId while preserving safe params like subcategory
  assert.match(navSource, /export function buildPersonalTryOnHref/);
  assert.doesNotMatch(
    navSource.slice(navSource.indexOf('export function buildPersonalTryOnHref')),
    /search\.set\(['"]storeId['"]/,
    'buildPersonalTryOnHref must never carry storeId into Personal WearMe mode',
  );
});

test('SiteHeader: Eliminates duplicate links and adapts to all 5 user contexts', () => {
  const headerSource = readWebFile('components/site-header.tsx');

  // Verifies distinct header test IDs for each context
  assert.ok(headerSource.includes('data-testid="sponsored-tryon-header"'));
  assert.ok(headerSource.includes('data-testid="partner-portal-header"'));
  assert.ok(headerSource.includes('data-testid="auth-header"'));
  assert.ok(headerSource.includes("'customer-app-header' : 'public-site-header'"));

  // Verifies old duplicate "Partner With WearMe" action bar button was removed
  assert.ok(
    !headerSource.includes('Partner With WearMe'),
    'SiteHeader must not duplicate Partner link in the right action bar alongside primary nav',
  );

  // Verifies focused store-sponsored header has an explicit Switch to Personal WearMe action
  assert.ok(headerSource.includes('data-testid="header-switch-personal-button"'));
  assert.ok(headerSource.includes('Switch to Personal WearMe'));
});

test('Route Consolidation: /faq redirects to canonical /help#faq and /contact renders interactive form', () => {
  const faqPageSource = readWebFile('app/faq/page.tsx');
  assert.ok(
    faqPageSource.includes("redirect('/help#faq')"),
    '/faq must redirect to canonical /help#faq instead of duplicating FAQ content',
  );

  const helpPageSource = readWebFile('app/help/page.tsx');
  assert.ok(
    helpPageSource.includes('<FaqSection'),
    '/help must serve as the single canonical destination for both guides and FAQ',
  );

  const contactPageSource = readWebFile('app/contact/page.tsx');
  assert.ok(
    contactPageSource.includes('data-testid="contact-inquiry-form"'),
    '/contact must render an interactive inquiry form rather than a circular self-link',
  );
  assert.ok(
    contactPageSource.includes('tryOnApi.submitContactInquiry'),
    '/contact form must submit to tryOnApi.submitContactInquiry',
  );
  assert.ok(
    !contactPageSource.includes('<ContactSupportSection'),
    '/contact must not render the homepage ContactSupportSection teaser card',
  );
});

test('Multi-Step Flows: /try-on and /login provide step indicators and preserve user inputs when stepping back', () => {
  const tryOnSource = readWebFile('app/try-on/page.tsx');
  const tryOnResultSource = readWebFile('components/try-on-result.tsx');
  const loginSource = readWebFile('app/login/page.tsx');

  // 3-step indicator on /try-on
  assert.ok(tryOnSource.includes('data-testid="tryon-step-indicator"'));
  assert.ok(tryOnSource.includes('1. Select & Upload'));
  assert.ok(tryOnSource.includes('2. AI Processing'));
  assert.ok(tryOnSource.includes('3. Review & Save Look'));

  // Stepping back from result to upload preserves personImage and garmentImage via handleEditInputs
  assert.ok(tryOnSource.includes('const handleEditInputs = useCallback'));
  assert.ok(tryOnSource.includes('onEditInputs={handleEditInputs}'));
  assert.ok(tryOnResultSource.includes('data-testid="adjust-inputs-keep-photos-button"'));

  // 2-step indicator on /login
  assert.ok(loginSource.includes('data-testid="login-step-indicator"'));
  assert.ok(loginSource.includes('1. Channel &amp; Destination'));
  assert.ok(loginSource.includes('2. Verify 6-Digit OTP'));
});

test('Partner Portal: Organizes store telemetry, subscription, QR setup, and privacy boundaries into structured views', () => {
  const partnerSource = readWebFile('app/partner/page.tsx');

  assert.ok(partnerSource.includes('data-testid="partner-subscription-dashboard"'));
  assert.ok(partnerSource.includes('role="tablist"'));
  assert.ok(partnerSource.includes("activeTab === 'overview'"));
  assert.ok(partnerSource.includes("activeTab === 'usage'"));
  assert.ok(partnerSource.includes("activeTab === 'subscription'"));
  assert.ok(partnerSource.includes("activeTab === 'setup'"));
  assert.ok(partnerSource.includes("activeTab === 'support'"));
});

test('Contextual Back & Breadcrumbs: Integrated across nested customer, partner, and secondary public routes', () => {
  const routesWithContextualNav = [
    'app/my-wardrobe/page.tsx',
    'app/history/page.tsx',
    'app/account/page.tsx',
    'app/partner/page.tsx',
    'app/categories/page.tsx',
    'app/how-it-works/page.tsx',
    'app/help/page.tsx',
    'app/contact/page.tsx',
    'app/about/page.tsx',
    'app/security/page.tsx',
    'app/privacy/page.tsx',
    'app/terms/page.tsx',
  ];

  for (const routeFile of routesWithContextualNav) {
    const content = readWebFile(routeFile);
    assert.ok(
      content.includes('<ContextualNavBar'),
      `Expected ${routeFile} to render <ContextualNavBar /> for predictable back/breadcrumb navigation`,
    );
  }
});

