-- CreateEnum
CREATE TYPE "TryOnStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ClothingCategory" AS ENUM ('TOP', 'SHIRT', 'TSHIRT', 'JACKET', 'DRESS', 'KURTI', 'SAREE', 'SALWAR_SUIT', 'PANTS', 'JEANS', 'SHORTS', 'SHOES', 'ACCESSORY', 'FULL_OUTFIT');

-- CreateTable
CREATE TABLE "TryOnJob" (
    "id" TEXT NOT NULL,
    "status" "TryOnStatus" NOT NULL DEFAULT 'PENDING',
    "category" "ClothingCategory" NOT NULL,
    "personImageKey" TEXT NOT NULL,
    "garmentImageKey" TEXT NOT NULL,
    "resultImageKey" TEXT,
    "personImageMeta" JSONB,
    "garmentImageMeta" JSONB,
    "resultImageMeta" JSONB,
    "aiProvider" TEXT,
    "aiProviderMeta" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "TryOnJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TryOnJob_status_idx" ON "TryOnJob"("status");

-- CreateIndex
CREATE INDEX "TryOnJob_createdAt_idx" ON "TryOnJob"("createdAt");
