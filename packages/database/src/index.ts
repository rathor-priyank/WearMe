// Re-export Prisma client and generated types for consumption by other packages.
// Consumers import from '@wearme/database' instead of directly from '@prisma/client'.

export {
  PrismaClient,
  Prisma,
  SessionStatus,
  UsageBillingMode,
  PartnerStoreStatus,
  SubscriptionStatus,
  OveragePolicy,
  ReservationStatus,
  LedgerEventType,
} from '@prisma/client';
export type {
  TryOnJob,
  TryOnSession,
  User,
  PartnerStore,
  PartnerStoreSubscription,
  ConsumerEntitlement,
  UsageReservation,
  UsageLedgerEntry,
  ClothingCategory,
  TryOnStatus,
} from '@prisma/client';

import { PrismaClient } from '@prisma/client';

// Singleton pattern for the Prisma client — prevents multiple connection pools
// in development due to hot-reloading. In production, only one instance is created.
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export function createPrismaClient(): PrismaClient {
  if (process.env['NODE_ENV'] === 'production') {
    return new PrismaClient();
  }
  // Re-use singleton in dev to avoid exhausting connection pool on hot reload
  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      log: ['query', 'warn', 'error'],
    });
  }
  return global.__prisma;
}

