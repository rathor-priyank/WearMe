import type {
  LiveValidationStatus,
  ProviderSupportStatus,
  WearableDomain,
  WearableSubcategory,
} from './clothing';

export enum TryOnStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export type UsageBillingModeType = 'STORE_SPONSORED' | 'PERSONAL' | 'LEGACY_UNKNOWN';

export interface CreateJobResponse {
  jobId: string;
  status: TryOnStatus;
  billingMode?: UsageBillingModeType;
  sponsoredStoreId?: string | null;
  createdAt: string;
}

export interface JobStatusResponse {
  jobId: string;
  status: TryOnStatus;
  category: string;
  subcategory?: string;
  domain?: string;
  personImageUrl?: string;
  garmentImageUrl?: string;
  resultUrl?: string;
  aiProvider?: string;
  isExperimentalPoc?: boolean;
  isMock?: boolean;
  aiProviderMeta?: Record<string, unknown>;
  errorMessage?: string;
  billingMode?: UsageBillingModeType;
  sponsoredStoreId?: string | null;
  savedToWardrobe?: boolean;
  retailerSource?: string;
  productTitle?: string;
  createdAt: string;
  completedAt?: string;
  expiresAt?: string;
}

export interface ProcessJobResponse {
  jobId: string;
  status: TryOnStatus;
  billingMode?: UsageBillingModeType;
  resultUrl?: string;
  errorMessage?: string;
}

export interface CategoryCapabilityItem {
  subcategory: WearableSubcategory;
  domain: WearableDomain;
  dbCategory: string;
  label: string;
  targetBodyRegion: string;
  requiredLandmarks: string[];
  routingStrategy: string;
  idmVtonCompatible: boolean;
  fashnV16Category: 'tops' | 'bottoms' | 'one-pieces' | null;
  liveValidationStatus: LiveValidationStatus;
  providerSupportStatus: ProviderSupportStatus;
  selectedRoute?: string | null;
}

export interface CategoriesResponse {
  activeProvider: string;
  necklacePocEnabled: boolean;
  categories: CategoryCapabilityItem[];
}

export interface JobHistoryResponse {
  jobs: JobStatusResponse[];
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  services: {
    database: 'ok' | 'error';
    storage: 'ok' | 'error';
    ai: 'ok' | 'error';
  };
}

// ─── Network Effect Flywheel & Multi-Channel OTP Authentication ──────────────

export type OtpChannel = 'whatsapp' | 'sms' | 'email';

export interface AuthChannelCapability {
  channel: OtpChannel;
  label: string;
  enabled: boolean;
  providerName: string;
  isLiveConfigured: boolean;
}

export interface AuthChannelsResponse {
  channels: AuthChannelCapability[];
  resendCooldownSeconds: number;
  otpValiditySeconds: number;
}

export interface RequestOtpPayload {
  channel?: OtpChannel;
  phone?: string;
  email?: string;
  storeId?: string;
  storeName?: string;
}

export interface RequestOtpResponse {
  sessionToken: string;
  channel: OtpChannel;
  destination: string;
  phoneE164: string;
  expiresAt: string;
  resendAvailableInSeconds?: number;
  devOtpPreview?: string;
}

export interface UpgradeSessionPayload {
  channel?: OtpChannel;
  phone?: string;
  email?: string;
  otpCode: string;
  jobId?: string;
  storeId?: string;
  storeName?: string;
  replaceBasePortrait?: boolean;
  returnUrl?: string;
}

export interface WardrobeUserProfile {
  id: string;
  phoneE164: string | null;
  email?: string | null;
  name?: string | null;
  basePersonImageUrl?: string | null;
  originStoreId?: string | null;
  originStoreName?: string | null;
  createdAt: string;
}

export interface UpgradeSessionResponse {
  authToken: string;
  user: WardrobeUserProfile;
  upgradedJobsCount: number;
  redirectTo: string;
}

export interface RetailerCatalogItem {
  id: string;
  brand: string;
  title: string;
  category: string;
  subcategory: WearableSubcategory;
  domain: WearableDomain;
  priceInr: number;
  accentColor: string;
  tagline: string;
  previewSvgDataUri: string;
}

export interface WardrobeResponse {
  user: WardrobeUserProfile;
  savedLooks: JobStatusResponse[];
  retailerCatalog: RetailerCatalogItem[];
}

export interface WardrobeTryOnPayload {
  catalogItemId: string;
}

export interface PartnerStorePublicInfo {
  storeId: string;
  storeName: string;
  city: string;
  verifiedPartner: boolean;
  supportedSubcategories: string[];
}

export interface PartnerStoreAnalyticsResponse {
  storeId: string;
  storeName: string;
  totalTryOnSessions: number;
  totalTryOnJobs: number;
  completedTryOnJobs: number;
  savedToWardrobeCount: number;
  firstTouchAttributedUsersCount: number;
  privacyNotice: string;
}

export type ContactInquiryCategory =
  | 'general'
  | 'partner'
  | 'support'
  | 'privacy'
  | 'security';

export interface ContactInquiryPayload {
  category: ContactInquiryCategory;
  name: string;
  email: string;
  organization?: string;
  message: string;
}

export interface ContactInquiryResponse {
  inquiryId: string;
  category: ContactInquiryCategory;
  receivedAt: string;
  deliveryMode: 'logged_local_queue' | 'webhook_forwarded';
  notice: string;
}

export interface DeletePortraitResponse {
  deleted: boolean;
  userId: string;
}

export interface DeleteAccountResponse {
  deleted: boolean;
  userId: string;
  deletedJobsCount: number;
}

// ─── Store-Sponsored Sessions, Consumer Entitlements & Partner Billing ────────

export type SponsoredSessionExpiredReason =
  | 'SESSION_EXPIRED'
  | 'INACTIVITY_TIMEOUT'
  | 'REVOKED'
  | 'STORE_SUSPENDED'
  | 'SUBSCRIPTION_INACTIVE'
  | 'STORE_QUOTA_EXHAUSTED';

export interface SponsoredSessionStateResponse {
  sessionToken: string;
  usageMode: UsageBillingModeType;
  active: boolean;
  storeId: string | null;
  storeName: string | null;
  city?: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  lastActivityAt: string | null;
  remainingSeconds: number;
  inactivityTimeoutMinutes: number;
  maxLifetimeMinutes: number;
  expiredReason: SponsoredSessionExpiredReason | null;
  storeQuotaRemaining: number | null;
  message: string;
}

export interface ConsumerEntitlementSummary {
  planId: string;
  status: string;
  includedCredits: number;
  consumedCredits: number;
  reservedCredits: number;
  remainingCredits: number;
  failedGenerationsCount: number;
  periodStart: string;
  periodEnd: string;
}

export interface EntitlementStatusResponse {
  effectiveBillingMode: UsageBillingModeType;
  sponsoredSession: SponsoredSessionStateResponse | null;
  personalEntitlement: ConsumerEntitlementSummary;
  authenticatedUserId: string | null;
  originStoreAttribution: {
    storeId: string | null;
    storeName: string | null;
  } | null;
}

export interface PartnerStoreSubscriptionResponse {
  storeId: string;
  storeName: string;
  city: string | null;
  storeStatus: 'ACTIVE' | 'SUSPENDED';
  subscriptionId: string;
  planId: string;
  planName: string;
  monthlyPriceInr: number;
  subscriptionStatus: string;
  periodStart: string;
  periodEnd: string;
  includedCredits: number;
  consumedCredits: number;
  reservedCredits: number;
  remainingCredits: number;
  failedGenerationsCount: number;
  overagePolicy: 'BLOCK' | 'ALLOW_CONFIGURED';
  quotaExhausted: boolean;
  lowQuotaWarning: boolean;
}

export interface PartnerLedgerSummaryItem {
  id: string;
  eventType: string;
  creditsDelta: number;
  reason: string | null;
  createdAt: string;
}

export interface PartnerStoreUsageResponse {
  storeId: string;
  storeName: string;
  subscription: PartnerStoreSubscriptionResponse;
  activeSponsoredSessionsCount: number;
  expiredSponsoredSessionsCount: number;
  totalSponsoredTryOnJobs: number;
  completedSponsoredTryOnJobs: number;
  failedSponsoredTryOnJobs: number;
  savedToWardrobeFromStoreCount: number;
  firstTouchAttributedUsersCount: number;
  recentLedgerSummary: PartnerLedgerSummaryItem[];
  privacyNotice: string;
}

export interface PartnerStoreAuthResponse {
  authenticated: boolean;
  storeId: string;
  storeName: string;
  city: string | null;
  storeStatus: 'ACTIVE' | 'SUSPENDED';
  subscriptionStatus: string;
  periodEnd: string;
  remainingCredits: number;
}

export interface PartnerStoreQrTokenResponse {
  storeId: string;
  qrToken: string;
  issuedAt: string;
  expiresAt: string;
  ttlSeconds: number;
  singleUse: boolean;
  checkInPath: string;
}

export interface PartnerStoreRenewSubscriptionRequest {
  planId?: string;
  includedCredits?: number;
}

