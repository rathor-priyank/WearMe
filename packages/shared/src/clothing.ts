// V1 upper-body categories only; full enum and multi-category wearable taxonomy defined for expansion.
// The V1 API and UI enforce V1_CLOTHING_CATEGORIES by default while supporting category-aware routing.

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

/**
 * Phase 2/3 Multi-Category Wearable Taxonomy
 * Covers all 8 wearable domains and 35 subcategories.
 */
export enum WearableDomain {
  CLOTHING = 'clothing',
  JEWELLERY = 'jewellery',
  EYEWEAR = 'eyewear',
  WRISTWEAR = 'wristwear',
  BAGS = 'bags',
  FOOTWEAR = 'footwear',
  HEADWEAR = 'headwear',
  ACCESSORIES = 'accessories',
}

export enum WearableSubcategory {
  // 1. Clothing
  TSHIRT = 'TSHIRT',
  SHIRT = 'SHIRT',
  SWEATER = 'SWEATER',
  HOODIE = 'HOODIE',
  JACKET = 'JACKET',
  TOP = 'TOP',
  DRESS = 'DRESS',
  TROUSERS = 'TROUSERS',
  SKIRT = 'SKIRT',
  ETHNIC_WEAR = 'ETHNIC_WEAR',
  SAREE = 'SAREE',

  // 2. Jewellery
  NECKLACE = 'NECKLACE',
  CHAIN = 'CHAIN',
  PENDANT = 'PENDANT',
  EARRINGS = 'EARRINGS',
  RING = 'RING',
  BRACELET = 'BRACELET',
  BANGLE = 'BANGLE',

  // 3. Eyewear
  PRESCRIPTION_GLASSES = 'PRESCRIPTION_GLASSES',
  SUNGLASSES = 'SUNGLASSES',

  // 4. Wristwear
  WATCH = 'WATCH',
  SMARTWATCH = 'SMARTWATCH',

  // 5. Bags
  HANDBAG = 'HANDBAG',
  SHOULDER_BAG = 'SHOULDER_BAG',
  BACKPACK = 'BACKPACK',

  // 6. Footwear
  SNEAKERS = 'SNEAKERS',
  FORMAL_SHOES = 'FORMAL_SHOES',
  BOOTS = 'BOOTS',
  HEELS = 'HEELS',
  SANDALS = 'SANDALS',

  // 7. Headwear & Hair Accessories
  HAT = 'HAT',
  CAP = 'CAP',
  HEADBAND = 'HEADBAND',
  HAIR_CLIP = 'HAIR_CLIP',
  OCCASION_HEADWEAR = 'OCCASION_HEADWEAR',

  // 8. Other Accessories
  BELT = 'BELT',
  SCARF = 'SCARF',
  TIE = 'TIE',
}

export type ProviderSupportStatus =
  | 'supported'
  | 'experimental_poc'
  | 'requires_specialized_model'
  | 'unsupported';

export type LiveValidationStatus =
  | 'verified_live_idm_vton'
  | 'experimental_poc_local_unverified_live'
  | 'supported_fashn_api_unverified_live'
  | 'requires_specialized_model_unverified_live'
  | 'landmark_pipeline_unverified_live';

export interface WearableCategorySpec {
  subcategory: WearableSubcategory;
  domain: WearableDomain;
  dbCategory: ClothingCategory;
  label: string;
  targetBodyRegion: string;
  requiredLandmarks: string[];
  routingStrategy: string;
  idmVtonCompatible: boolean;
  fashnV16Category: 'tops' | 'bottoms' | 'one-pieces' | null;
  liveValidationStatus: LiveValidationStatus;
  defaultSupportStatus: ProviderSupportStatus;
}

export const UPPER_BODY_SUBCATEGORIES: readonly WearableSubcategory[] = [
  WearableSubcategory.TSHIRT,
  WearableSubcategory.SHIRT,
  WearableSubcategory.TOP,
  WearableSubcategory.SWEATER,
  WearableSubcategory.HOODIE,
  WearableSubcategory.JACKET,
] as const;

export const NECKLACE_POC_SUBCATEGORIES: readonly WearableSubcategory[] = [
  WearableSubcategory.NECKLACE,
  WearableSubcategory.PENDANT,
] as const;

export const UPLOADABLE_CLOTHING_CATEGORIES = [
  ClothingCategory.TOP,
  ClothingCategory.SHIRT,
  ClothingCategory.TSHIRT,
  ClothingCategory.JACKET,
  ClothingCategory.ACCESSORY,
] as const;

export const WEARABLE_CATALOG: readonly WearableCategorySpec[] = [
  // ─── 1. Clothing — Upper Body (6) ─────────────────────────────────────────
  {
    subcategory: WearableSubcategory.TSHIRT,
    domain: WearableDomain.CLOTHING,
    dbCategory: ClothingCategory.TSHIRT,
    label: 'T-Shirt',
    targetBodyRegion: 'upper_body_torso',
    requiredLandmarks: ['pose_shoulders_11_12', 'pose_elbows_13_14', 'pose_hips_23_24'],
    routingStrategy: 'diffusion_upper_body',
    idmVtonCompatible: true,
    fashnV16Category: 'tops',
    liveValidationStatus: 'verified_live_idm_vton',
    defaultSupportStatus: 'supported',
  },
  {
    subcategory: WearableSubcategory.SHIRT,
    domain: WearableDomain.CLOTHING,
    dbCategory: ClothingCategory.SHIRT,
    label: 'Shirt',
    targetBodyRegion: 'upper_body_torso',
    requiredLandmarks: ['pose_shoulders_11_12', 'pose_elbows_13_14', 'pose_hips_23_24'],
    routingStrategy: 'diffusion_upper_body',
    idmVtonCompatible: true,
    fashnV16Category: 'tops',
    liveValidationStatus: 'verified_live_idm_vton',
    defaultSupportStatus: 'supported',
  },
  {
    subcategory: WearableSubcategory.TOP,
    domain: WearableDomain.CLOTHING,
    dbCategory: ClothingCategory.TOP,
    label: 'Top / Blouse',
    targetBodyRegion: 'upper_body_torso',
    requiredLandmarks: ['pose_shoulders_11_12', 'pose_elbows_13_14', 'pose_hips_23_24'],
    routingStrategy: 'diffusion_upper_body',
    idmVtonCompatible: true,
    fashnV16Category: 'tops',
    liveValidationStatus: 'verified_live_idm_vton',
    defaultSupportStatus: 'supported',
  },
  {
    subcategory: WearableSubcategory.SWEATER,
    domain: WearableDomain.CLOTHING,
    dbCategory: ClothingCategory.TOP,
    label: 'Sweater / Knitwear',
    targetBodyRegion: 'upper_body_torso',
    requiredLandmarks: ['pose_shoulders_11_12', 'pose_elbows_13_14', 'pose_wrists_15_16'],
    routingStrategy: 'diffusion_upper_body',
    idmVtonCompatible: true,
    fashnV16Category: 'tops',
    liveValidationStatus: 'verified_live_idm_vton',
    defaultSupportStatus: 'supported',
  },
  {
    subcategory: WearableSubcategory.HOODIE,
    domain: WearableDomain.CLOTHING,
    dbCategory: ClothingCategory.JACKET,
    label: 'Hoodie / Sweatshirt',
    targetBodyRegion: 'upper_body_torso',
    requiredLandmarks: ['pose_shoulders_11_12', 'pose_elbows_13_14', 'pose_wrists_15_16'],
    routingStrategy: 'diffusion_upper_body',
    idmVtonCompatible: true,
    fashnV16Category: 'tops',
    liveValidationStatus: 'verified_live_idm_vton',
    defaultSupportStatus: 'supported',
  },
  {
    subcategory: WearableSubcategory.JACKET,
    domain: WearableDomain.CLOTHING,
    dbCategory: ClothingCategory.JACKET,
    label: 'Jacket / Outerwear',
    targetBodyRegion: 'upper_body_torso',
    requiredLandmarks: ['pose_shoulders_11_12', 'pose_elbows_13_14', 'pose_hips_23_24'],
    routingStrategy: 'diffusion_upper_body',
    idmVtonCompatible: true,
    fashnV16Category: 'tops',
    liveValidationStatus: 'verified_live_idm_vton',
    defaultSupportStatus: 'supported',
  },
  // ─── 1b. Clothing — Lower Body, Dresses & Ethnic Wear (5) ─────────────────
  {
    subcategory: WearableSubcategory.DRESS,
    domain: WearableDomain.CLOTHING,
    dbCategory: ClothingCategory.DRESS,
    label: 'Dress',
    targetBodyRegion: 'full_body',
    requiredLandmarks: ['pose_shoulders_11_12', 'pose_hips_23_24', 'pose_knees_25_26'],
    routingStrategy: 'diffusion_one_piece',
    idmVtonCompatible: false,
    fashnV16Category: 'one-pieces',
    liveValidationStatus: 'supported_fashn_api_unverified_live',
    defaultSupportStatus: 'unsupported',
  },
  {
    subcategory: WearableSubcategory.TROUSERS,
    domain: WearableDomain.CLOTHING,
    dbCategory: ClothingCategory.PANTS,
    label: 'Trousers / Pants / Jeans',
    targetBodyRegion: 'lower_body_legs',
    requiredLandmarks: ['pose_hips_23_24', 'pose_knees_25_26', 'pose_ankles_27_28'],
    routingStrategy: 'diffusion_lower_body',
    idmVtonCompatible: false,
    fashnV16Category: 'bottoms',
    liveValidationStatus: 'supported_fashn_api_unverified_live',
    defaultSupportStatus: 'unsupported',
  },
  {
    subcategory: WearableSubcategory.SKIRT,
    domain: WearableDomain.CLOTHING,
    dbCategory: ClothingCategory.PANTS,
    label: 'Skirt',
    targetBodyRegion: 'lower_body_legs',
    requiredLandmarks: ['pose_hips_23_24', 'pose_knees_25_26'],
    routingStrategy: 'diffusion_lower_body',
    idmVtonCompatible: false,
    fashnV16Category: 'bottoms',
    liveValidationStatus: 'supported_fashn_api_unverified_live',
    defaultSupportStatus: 'unsupported',
  },
  {
    subcategory: WearableSubcategory.ETHNIC_WEAR,
    domain: WearableDomain.CLOTHING,
    dbCategory: ClothingCategory.KURTI,
    label: 'Ethnic Wear / Kurti / Salwar Suit',
    targetBodyRegion: 'full_body',
    requiredLandmarks: ['pose_shoulders_11_12', 'pose_hips_23_24', 'pose_knees_25_26'],
    routingStrategy: 'diffusion_one_piece',
    idmVtonCompatible: false,
    fashnV16Category: 'one-pieces',
    liveValidationStatus: 'supported_fashn_api_unverified_live',
    defaultSupportStatus: 'unsupported',
  },
  {
    subcategory: WearableSubcategory.SAREE,
    domain: WearableDomain.CLOTHING,
    dbCategory: ClothingCategory.SAREE,
    label: 'Saree',
    targetBodyRegion: 'full_body_saree_drape',
    requiredLandmarks: ['pose_shoulders_11_12', 'pose_hips_23_24', 'pose_ankles_27_28'],
    routingStrategy: 'diffusion_full_body_drape',
    idmVtonCompatible: false,
    fashnV16Category: 'one-pieces',
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  // ─── 2. Jewellery (7) ─────────────────────────────────────────────────────
  {
    subcategory: WearableSubcategory.NECKLACE,
    domain: WearableDomain.JEWELLERY,
    dbCategory: ClothingCategory.ACCESSORY,
    label: 'Necklace',
    targetBodyRegion: 'neck_clavicle',
    requiredLandmarks: ['face_mesh_chin_152', 'pose_shoulders_11_12'],
    routingStrategy: 'landmark_jewellery_neck',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  {
    subcategory: WearableSubcategory.CHAIN,
    domain: WearableDomain.JEWELLERY,
    dbCategory: ClothingCategory.ACCESSORY,
    label: 'Chain',
    targetBodyRegion: 'neck_clavicle',
    requiredLandmarks: ['face_mesh_chin_152', 'pose_shoulders_11_12'],
    routingStrategy: 'landmark_jewellery_neck',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  {
    subcategory: WearableSubcategory.PENDANT,
    domain: WearableDomain.JEWELLERY,
    dbCategory: ClothingCategory.ACCESSORY,
    label: 'Pendant',
    targetBodyRegion: 'neck_clavicle',
    requiredLandmarks: ['face_mesh_chin_152', 'pose_shoulders_11_12'],
    routingStrategy: 'landmark_jewellery_neck',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  {
    subcategory: WearableSubcategory.EARRINGS,
    domain: WearableDomain.JEWELLERY,
    dbCategory: ClothingCategory.ACCESSORY,
    label: 'Earrings',
    targetBodyRegion: 'face_earlobes',
    requiredLandmarks: ['face_mesh_left_ear_177_215', 'face_mesh_right_ear_401_435'],
    routingStrategy: 'landmark_jewellery_ear',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  {
    subcategory: WearableSubcategory.RING,
    domain: WearableDomain.JEWELLERY,
    dbCategory: ClothingCategory.ACCESSORY,
    label: 'Ring',
    targetBodyRegion: 'hand_finger',
    requiredLandmarks: ['hand_ring_mcp_13', 'hand_ring_pip_14'],
    routingStrategy: 'landmark_jewellery_hand',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  {
    subcategory: WearableSubcategory.BRACELET,
    domain: WearableDomain.JEWELLERY,
    dbCategory: ClothingCategory.ACCESSORY,
    label: 'Bracelet',
    targetBodyRegion: 'wrist_forearm',
    requiredLandmarks: ['hand_wrist_0', 'pose_forearm_13_15_14_16'],
    routingStrategy: 'landmark_jewellery_wrist',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  {
    subcategory: WearableSubcategory.BANGLE,
    domain: WearableDomain.JEWELLERY,
    dbCategory: ClothingCategory.ACCESSORY,
    label: 'Bangle',
    targetBodyRegion: 'wrist_forearm',
    requiredLandmarks: ['hand_wrist_0', 'pose_forearm_13_15_14_16'],
    routingStrategy: 'landmark_jewellery_wrist',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  // ─── 3. Eyewear (2) ───────────────────────────────────────────────────────
  {
    subcategory: WearableSubcategory.PRESCRIPTION_GLASSES,
    domain: WearableDomain.EYEWEAR,
    dbCategory: ClothingCategory.ACCESSORY,
    label: 'Prescription Glasses',
    targetBodyRegion: 'face_eyes_bridge',
    requiredLandmarks: ['face_mesh_eyes_33_133_362_263', 'face_mesh_bridge_6_168', 'face_mesh_temples_127_356'],
    routingStrategy: 'landmark_eyewear',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  {
    subcategory: WearableSubcategory.SUNGLASSES,
    domain: WearableDomain.EYEWEAR,
    dbCategory: ClothingCategory.ACCESSORY,
    label: 'Sunglasses',
    targetBodyRegion: 'face_eyes_bridge',
    requiredLandmarks: ['face_mesh_eyes_33_133_362_263', 'face_mesh_bridge_6_168', 'face_mesh_temples_127_356'],
    routingStrategy: 'landmark_eyewear',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  // ─── 4. Wristwear (2) ─────────────────────────────────────────────────────
  {
    subcategory: WearableSubcategory.WATCH,
    domain: WearableDomain.WRISTWEAR,
    dbCategory: ClothingCategory.ACCESSORY,
    label: 'Watch',
    targetBodyRegion: 'wrist_forearm',
    requiredLandmarks: ['hand_wrist_0', 'hand_mcp_5_17', 'pose_forearm_13_15_14_16'],
    routingStrategy: 'landmark_wristwear',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  {
    subcategory: WearableSubcategory.SMARTWATCH,
    domain: WearableDomain.WRISTWEAR,
    dbCategory: ClothingCategory.ACCESSORY,
    label: 'Smartwatch',
    targetBodyRegion: 'wrist_forearm',
    requiredLandmarks: ['hand_wrist_0', 'hand_mcp_5_17', 'pose_forearm_13_15_14_16'],
    routingStrategy: 'landmark_wristwear',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  // ─── 5. Bags (3) ──────────────────────────────────────────────────────────
  {
    subcategory: WearableSubcategory.HANDBAG,
    domain: WearableDomain.BAGS,
    dbCategory: ClothingCategory.ACCESSORY,
    label: 'Handbag / Tote',
    targetBodyRegion: 'hand_hip_side',
    requiredLandmarks: ['pose_wrists_15_16', 'pose_hips_23_24'],
    routingStrategy: 'landmark_bag',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  {
    subcategory: WearableSubcategory.SHOULDER_BAG,
    domain: WearableDomain.BAGS,
    dbCategory: ClothingCategory.ACCESSORY,
    label: 'Shoulder / Crossbody Bag',
    targetBodyRegion: 'shoulder_torso_hip',
    requiredLandmarks: ['pose_shoulders_11_12', 'pose_elbows_13_14', 'pose_hips_23_24'],
    routingStrategy: 'landmark_bag',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  {
    subcategory: WearableSubcategory.BACKPACK,
    domain: WearableDomain.BAGS,
    dbCategory: ClothingCategory.ACCESSORY,
    label: 'Backpack',
    targetBodyRegion: 'shoulders_upper_torso',
    requiredLandmarks: ['pose_shoulders_11_12', 'pose_elbows_13_14'],
    routingStrategy: 'landmark_bag',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  // ─── 6. Footwear (5) ──────────────────────────────────────────────────────
  {
    subcategory: WearableSubcategory.SNEAKERS,
    domain: WearableDomain.FOOTWEAR,
    dbCategory: ClothingCategory.SHOES,
    label: 'Sneakers',
    targetBodyRegion: 'feet_ankles',
    requiredLandmarks: ['pose_ankles_27_28', 'pose_heels_29_30', 'pose_toes_31_32'],
    routingStrategy: 'landmark_footwear',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  {
    subcategory: WearableSubcategory.FORMAL_SHOES,
    domain: WearableDomain.FOOTWEAR,
    dbCategory: ClothingCategory.SHOES,
    label: 'Formal Shoes',
    targetBodyRegion: 'feet_ankles',
    requiredLandmarks: ['pose_ankles_27_28', 'pose_heels_29_30', 'pose_toes_31_32'],
    routingStrategy: 'landmark_footwear',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  {
    subcategory: WearableSubcategory.BOOTS,
    domain: WearableDomain.FOOTWEAR,
    dbCategory: ClothingCategory.SHOES,
    label: 'Boots',
    targetBodyRegion: 'feet_ankles',
    requiredLandmarks: ['pose_knees_25_26', 'pose_ankles_27_28', 'pose_heels_29_30', 'pose_toes_31_32'],
    routingStrategy: 'landmark_footwear',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  {
    subcategory: WearableSubcategory.HEELS,
    domain: WearableDomain.FOOTWEAR,
    dbCategory: ClothingCategory.SHOES,
    label: 'Heels',
    targetBodyRegion: 'feet_ankles',
    requiredLandmarks: ['pose_ankles_27_28', 'pose_heels_29_30', 'pose_toes_31_32'],
    routingStrategy: 'landmark_footwear',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  {
    subcategory: WearableSubcategory.SANDALS,
    domain: WearableDomain.FOOTWEAR,
    dbCategory: ClothingCategory.SHOES,
    label: 'Sandals',
    targetBodyRegion: 'feet_ankles',
    requiredLandmarks: ['pose_ankles_27_28', 'pose_heels_29_30', 'pose_toes_31_32'],
    routingStrategy: 'landmark_footwear',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  // ─── 7. Headwear & Hair Accessories (5) ───────────────────────────────────
  {
    subcategory: WearableSubcategory.HAT,
    domain: WearableDomain.HEADWEAR,
    dbCategory: ClothingCategory.ACCESSORY,
    label: 'Hat',
    targetBodyRegion: 'head_crown_hair',
    requiredLandmarks: ['face_mesh_crown_10', 'face_mesh_temples_127_356'],
    routingStrategy: 'landmark_headwear',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  {
    subcategory: WearableSubcategory.CAP,
    domain: WearableDomain.HEADWEAR,
    dbCategory: ClothingCategory.ACCESSORY,
    label: 'Cap',
    targetBodyRegion: 'head_crown_hair',
    requiredLandmarks: ['face_mesh_crown_10', 'face_mesh_temples_127_356'],
    routingStrategy: 'landmark_headwear',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  {
    subcategory: WearableSubcategory.HEADBAND,
    domain: WearableDomain.HEADWEAR,
    dbCategory: ClothingCategory.ACCESSORY,
    label: 'Headband',
    targetBodyRegion: 'head_crown_hair',
    requiredLandmarks: ['face_mesh_crown_10', 'face_mesh_temples_127_356'],
    routingStrategy: 'landmark_headwear',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  {
    subcategory: WearableSubcategory.HAIR_CLIP,
    domain: WearableDomain.HEADWEAR,
    dbCategory: ClothingCategory.ACCESSORY,
    label: 'Hair Clip',
    targetBodyRegion: 'head_crown_hair',
    requiredLandmarks: ['face_mesh_crown_10', 'face_mesh_temples_127_356'],
    routingStrategy: 'landmark_headwear',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  {
    subcategory: WearableSubcategory.OCCASION_HEADWEAR,
    domain: WearableDomain.HEADWEAR,
    dbCategory: ClothingCategory.ACCESSORY,
    label: 'Occasion Headpiece / Tiara',
    targetBodyRegion: 'head_crown_hair',
    requiredLandmarks: ['face_mesh_crown_10', 'face_mesh_temples_127_356'],
    routingStrategy: 'landmark_headwear',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  // ─── 8. Other Accessories (3) ─────────────────────────────────────────────
  {
    subcategory: WearableSubcategory.BELT,
    domain: WearableDomain.ACCESSORIES,
    dbCategory: ClothingCategory.ACCESSORY,
    label: 'Belt',
    targetBodyRegion: 'waist_hip_belt',
    requiredLandmarks: ['pose_hips_23_24'],
    routingStrategy: 'landmark_accessory_belt',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  {
    subcategory: WearableSubcategory.SCARF,
    domain: WearableDomain.ACCESSORIES,
    dbCategory: ClothingCategory.ACCESSORY,
    label: 'Scarf',
    targetBodyRegion: 'neck_collar',
    requiredLandmarks: ['face_mesh_chin_152', 'pose_shoulders_11_12'],
    routingStrategy: 'landmark_accessory_neckwear',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
  {
    subcategory: WearableSubcategory.TIE,
    domain: WearableDomain.ACCESSORIES,
    dbCategory: ClothingCategory.ACCESSORY,
    label: 'Necktie / Bowtie',
    targetBodyRegion: 'neck_collar',
    requiredLandmarks: ['face_mesh_chin_152', 'pose_shoulders_11_12'],
    routingStrategy: 'landmark_accessory_neckwear',
    idmVtonCompatible: false,
    fashnV16Category: null,
    liveValidationStatus: 'requires_specialized_model_unverified_live',
    defaultSupportStatus: 'requires_specialized_model',
  },
] as const;

export function findWearableSpec(subcategoryOrCategory: string): WearableCategorySpec | undefined {
  const norm = subcategoryOrCategory.trim().toUpperCase();
  return WEARABLE_CATALOG.find((item) => item.subcategory === norm);
}


