// V1 upper-body categories only; full enum defined for future expansion.
// The API and UI enforce V1_CLOTHING_CATEGORIES as the allowed set.

export enum ClothingCategory {
  // V1 — upper body
  TOP = 'TOP',
  SHIRT = 'SHIRT',
  TSHIRT = 'TSHIRT',
  JACKET = 'JACKET',
  // V2+ — will be unlocked as model support expands
  DRESS = 'DRESS',
  KURTI = 'KURTI',
  SAREE = 'SAREE',
  SALWAR_SUIT = 'SALWAR_SUIT',
  PANTS = 'PANTS',
  JEANS = 'JEANS',
  SHORTS = 'SHORTS',
  SHOES = 'SHOES',
  ACCESSORY = 'ACCESSORY',
  FULL_OUTFIT = 'FULL_OUTFIT',
}

/** Categories supported in V1 (upper-body only) */
export const V1_CLOTHING_CATEGORIES = [
  ClothingCategory.TOP,
  ClothingCategory.SHIRT,
  ClothingCategory.TSHIRT,
  ClothingCategory.JACKET,
] as const;

export type V1ClothingCategory = (typeof V1_CLOTHING_CATEGORIES)[number];

export function isV1Category(value: string): value is V1ClothingCategory {
  return (V1_CLOTHING_CATEGORIES as readonly string[]).includes(value);
}

