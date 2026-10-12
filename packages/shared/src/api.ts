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

export interface CreateJobResponse {
  jobId: string;
  status: TryOnStatus;
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

// ─── Network Effect Flywheel (B2B2C Session Upgrade -> B2C Digital Wardrobe) ───

export interface RequestOtpPayload {
  phone: string;
  storeId?: string;
  storeName?: string;
}

export interface RequestOtpResponse {
  sessionToken: string;
  phoneE164: string;
  channel: 'whatsapp';
  expiresAt: string;
  devOtpPreview?: string;
}

export interface UpgradeSessionPayload {
  phone: string;
  otpCode: string;
  jobId?: string;
  storeId?: string;
  storeName?: string;
  replaceBasePortrait?: boolean;
}

export interface WardrobeUserProfile {
  id: string;
  phoneE164: string;
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
