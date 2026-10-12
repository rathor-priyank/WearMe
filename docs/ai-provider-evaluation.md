# WearMe — AI Provider Quality Evaluation & Benchmark Protocol

This document records the verified technical specification, pricing, licensing/privacy terms, 24-case reproducible benchmark protocol, 1–5 human scoring rubric, and root-cause analysis for WearMe's virtual try-on inference pipeline.

---

## 1. End-to-End Image Pipeline & Artifact Preservation

### 1.1 Ingestion, Preprocessing & Storage Flow
1. **Web Upload (`apps/web/app/try-on/page.tsx`)**:
   - User selects `personImage`, `garmentImage`, and upper-body `category` (`TOP`, `SHIRT`, `TSHIRT`, `JACKET`) and calls `POST /api/v1/try-on/upload`.
2. **API Validation & Storage (`apps/api/src/modules/try-on/try-on.service.ts`)**:
   - Validates size (`<= 10 MB`), MIME type (`image/jpeg`, `image/png`, `image/webp`), magic byte signatures, and `sharp` dimensions (`64×64` to `4096×4096 px`).
   - Saves raw inputs to `uploads/jobs/<jobId>/person.<ext>` and `uploads/jobs/<jobId>/garment.<ext>`.
3. **AI Service Preprocessing & Post-Processing (`apps/ai`)**:
   - **`HuggingFaceProvider` (`yisol/IDM-VTON`)**:
     - Applies EXIF transposition and fits `person_image` into a `768×1024` (3:4) canvas (`prepare_person_canvas`) using edge-replicated padding (`mode="edge"`).
     - Calls `yisol/IDM-VTON` (`api_name="/tryon"`), which returns `(raw_tryon_output, mask_gray_output)`.
     - Post-processes via `restore_unmasked_regions`: extracts the inpainting mask from `mask_gray`, harmonizes unmasked exposure and bare-arm skin tones, crops out the 3:4 padding, resizes to original dimensions, and composites strictly inside the feathered upper-body mask.
   - **`FASHNApiProvider` (`tryon-v1.6` / `tryon-max`)**:
     - Validates and encodes `person_image` and `garment_image` as base64 data URIs (`validate_and_encode_image`) and submits to `POST https://api.fashn.ai/v1/run`, polling `GET /v1/status/{id}` until completion.

### 1.2 Preserving Raw Provider Outputs Alongside Post-Processed Outputs
To ensure upper-body compositing (`restore_unmasked_regions`) **never silently hides upstream model defects** (or introduces color/clipping artifacts of its own), `HuggingFaceProvider.process(..., debug_artifact_dir=...)` and `scripts/evaluate_vton.py` preserve every stage of each evaluation run under `uploads/eval_runs/<case_id>/<adapter_name>/`:
- `01_person_orig.<ext>` — Unmodified original person image
- `02_garment_orig.<ext>` — Unmodified original garment image
- `03_person_preprocessed.png` — Exact `768×1024` 3:4 padded canvas sent to the provider
- `04_provider_raw_output.png` — **Uncomposited** raw `768×1024` output returned directly by the provider
- `04b_provider_raw_unpadded.jpg` — Uncomposited raw provider output unpadded to original dimensions (without mask compositing or skin-tone adjustments)
- `05_provider_mask.png` — Raw `mask_gray` inpainting mask returned by `yisol/IDM-VTON`
- `06_final_composited.jpg` — Final post-processed image after `restore_unmasked_regions`
- `07_comparison_strip.jpg` — Labeled side-by-side contact sheet (`1. Person Input | 2. Garment Input | 3. Raw Provider Output | 4. Provider Mask | 5. Final Output`)

---

## 2. Reproducible 24-Pair Benchmark Suite & Permission Protocol

A repeatable adapter-based benchmark harness is implemented at [`scripts/evaluate_vton.py`](file:///Users/priyank08/Desktop/WearMe/scripts/evaluate_vton.py) with its 24-case stratified manifest at [`scripts/eval_manifest.example.json`](file:///Users/priyank08/Desktop/WearMe/scripts/eval_manifest.example.json).

### 2.1 Explicit Permission & Provenance Enforcement
Every evaluation case in the manifest must include explicit usage authorization:
- `consent_verified: true`
- `permission_source`: e.g., `"user_consented_own_photo"`, `"unsplash_cc0_commercial_ok"`, or `"pexels_license"`
- `license_url` and `attribution`

`verify_case_permission()` in [`scripts/evaluate_vton.py`](file:///Users/priyank08/Desktop/WearMe/scripts/evaluate_vton.py) rejects any case where `consent_verified` is `false` or provenance fields are missing. Furthermore, calling live GPU or paid API providers requires passing `--confirm-live` on the command line so GPU quota and API credits are never consumed accidentally.

### 2.2 Stratified 24-Case Test Matrix (`TC-01` .. `TC-24`)

| Case ID | Category | Stress Group | Person Condition | Garment Condition |
| :--- | :--- | :--- | :--- | :--- |
| **TC-01** | `TSHIRT` | `baseline_studio` | Studio front-facing, neutral light | Flat-lay crewneck cotton t-shirt |
| **TC-02** | `SHIRT` | `baseline_studio` | Studio front-facing, arms relaxed | Flat-lay long-sleeve oxford button-down |
| **TC-03** | `JACKET` | `baseline_studio` | Clear front-facing portrait | Flat-lay structured zip-up jacket |
| **TC-04** | `TOP` | `baseline_studio` | Clear front-facing portrait | Clean product photo of patterned blouse |
| **TC-05** | `TSHIRT` | `sleeve_neckline_transition` | Wearing bulky long-sleeve hoodie | Short-sleeve fitted t-shirt (bare forearm synthesis) |
| **TC-06** | `JACKET` | `sleeve_neckline_transition` | Wearing sleeveless tank top | Long-sleeve tailored blazer (sleeve extension) |
| **TC-07** | `TOP` | `sleeve_neckline_transition` | Wearing high-collar turtleneck | Open V-neck top (neck/clavicle skin inpainting) |
| **TC-08** | `TSHIRT` | `sleeve_neckline_transition` | Wearing crew-neck tee | Short-sleeve polo shirt with collar & 3-button placket |
| **TC-09** | `TSHIRT` | `patterns_logos_textures` | Casual indoor smartphone photo | Graphic print t-shirt with chest typography/logo |
| **TC-10** | `SHIRT` | `patterns_logos_textures` | Clear front-facing smartphone photo | High-frequency plaid / tartan checkered shirt |
| **TC-11** | `SHIRT` | `patterns_logos_textures` | Front-facing torso portrait | Narrow vertical pinstripe dress shirt |
| **TC-12** | `TOP` | `patterns_logos_textures` | Front-facing neutral portrait | 3D relief chunky cable-knit sweater top |
| **TC-13** | `SHIRT` | `garment_photo_types` | Casual front-facing smartphone photo | Model-worn e-commerce catalog shirt (`garment_photo_type=model`) |
| **TC-14** | `JACKET` | `garment_photo_types` | Front-facing upper-body photo | Ghost-mannequin jacket showing inner collar label |
| **TC-15** | `TSHIRT` | `garment_photo_types` | Front-facing person photo | Smartphone photo of t-shirt on a hanger against wall |
| **TC-16** | `TOP` | `garment_photo_types` | Clear front-facing portrait | Warm beige/tan/camel top (tests skin-heuristic false positives) |
| **TC-17** | `TOP` | `pose_and_occlusion` | One hand resting on waist/hip | Clean product photo of knit top (hand/finger occlusion) |
| **TC-18** | `SHIRT` | `pose_and_occlusion` | Arms folded across chest | Striped long-sleeve shirt (complex self-occlusion) |
| **TC-19** | `TSHIRT` | `pose_and_occlusion` | 45-degree three-quarter torso turn | Flat-lay solid t-shirt (perspective shoulder warp) |
| **TC-20** | `TOP` | `pose_and_occlusion` | Long hair draped over shoulders/chest | Scoop-neck blouse (hair strand preservation) |
| **TC-21** | `JACKET` | `aspect_ratio_and_resolution` | Full-body 9:16 vertical portrait | Flat-lay bomber jacket (height & pillarbox padding test) |
| **TC-22** | `TSHIRT` | `aspect_ratio_and_resolution` | Square 1:1 waist-up crop | Flat-lay crewneck t-shirt (letterbox padding test) |
| **TC-23** | `SHIRT` | `lighting_skin_body_diversity` | Deep skin tone, warm indoor shadows | Camp collar button-up shirt (skin-tone & shadow matching) |
| **TC-24** | `TOP` | `lighting_skin_body_diversity` | Plus-size silhouette, high-waisted jeans | Catalog draped top (body shape & waistline boundary) |

---

## 3. Consistent 1–5 Human Scoring Rubric

> **Important Note**: Virtual try-on realism, garment structural fidelity, and anatomical/fabric artifacts **cannot be fully automated or treated as purely objective metrics**. Automated checks in `evaluate_vton.py` verify only deterministic properties (image decoding, dimensions, SHA-256 provenance, latency, and cost) and leave the 1–5 rubric fields as `null` placeholders in `results.json` and `___ / 5` blanks in `report.md` for human visual grading using `07_comparison_strip.jpg`.

| Rubric Dimension | `1` (Severe Failure) | `2` (Poor) | `3` (Acceptable) | `4` (Good) | `5` (Production Grade) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Garment Fidelity** *(color, pattern, logos, collar, buttons, sleeve length)* | Wrong garment type/color; logos or patterns completely obliterated. | Major distortion of pattern/stripes; wrong sleeve length or missing collar/zipper. | Overall color and silhouette match, but chest text/logos are blurry or button placket is warped. | Accurate color, cut, collar, and sleeve length; minor softening on fine micro-text or dense plaid. | Exact match to source garment's color, weave, logos, collar structure, buttons, and hem. |
| **2. Identity Preservation** *(face, skin tone, hair, height/shape, bottomwear, background)* | Face, body proportions, or background altered or stretched. | Noticeable skin-tone shift on neck/arms, clipped hair, or bleeding into trousers/skirt. | Face and background preserved, but slight seam halo at waist/neck or minor arm thickness change. | Original face, hair, height, bottomwear, and background intact; natural skin transition at cuffs/neck. | Indistinguishable from original photo outside the garment; seamless skin-tone and lighting match on arms/neck. |
| **3. Fit & Fabric Realism** *(drape, folds, shoulder alignment, torso geometry)* | Garment floats like a flat sticker or ignores body pose entirely. | Stiff, unnatural silhouette; misaligned shoulder seams or implausible waistline tuck. | Follows torso pose reasonably well, but fabric folds look airbrushed or flat under lighting. | Natural shoulder drape, realistic tension folds, and coherent shadowing matching scene light. | Physically plausible cloth behavior, realistic fabric weight/sheen, and natural interaction with body contour. |
| **4. Visual Artifacts** *(hands/fingers, boundary seams, ghost sleeves, double collars)* | Mangled/missing hands or severe hallucinated limbs/ghost clothing. | Visible leftover cuffs/collar from original shirt or blurred/webbed fingers overlapping torso. | Minor boundary feathering halo or slight softness where hands/hair overlap the garment. | Clean boundaries and intact hands/fingers; only negligible pixel-level softness on close zoom. | Zero ghosting, sharp occlusion boundaries around hands/hair, and no diffusion noise or color banding. |

---

## 4. Root-Cause Analysis: Likely Causes of Garment Mismatch & Realism Defects

1. **Coarse Static Category Descriptions (`SUPPORTED_UPPER_CATEGORIES` in `huggingface_provider.py`)**:
   - `IDM-VTON` conditions its diffusion U-Net on `garment_des`. Passing a static string like `"short sleeve round neck t-shirt"` for every `TSHIRT` or `"upper body top"` for every `TOP` causes prompt-image conflict when the garment has a V-neck, polo collar, crop hem, or long sleeves.
2. **Garment Image Orientation & Aspect-Ratio Distortion**:
   - Unlike `person_image`, `garment_image` in `HuggingFaceProvider` is written directly to disk without `ImageOps.exif_transpose` or 3:4 aspect-ratio padding. EXIF-rotated phone photos of garments or wide/square garment photos get stretched into `768×1024` inside IDM-VTON, warping logos and stripes.
3. **Effective Torso Resolution on Full-Body Portraits (`prepare_person_canvas`)**:
   - Scaling a head-to-toe `9:16` photo into `768×1024` leaves fewer than `250×300 px` for the upper body, degrading fine garment weave and button detail, while wide `mode="edge"` smear bars can confuse pose estimation near the elbows.
4. **False-Positive Skin Heuristic on Warm-Toned Garments (`_is_skin_pixel` in `restore_unmasked_regions`)**:
   - Warm beige, tan, camel, peach, or terracotta garments (`TC-16`) match the YCbCr skin thresholds (`Cb ∈ [77, 135], Cr ∈ [131, 180]`), causing Step B of `restore_unmasked_regions` to shift the garment's color toward the subject's skin tone.
5. **Coarse Agnostic Masking (`mask_gray`) & Boundary Clipping**:
   - When transitioning from a bulky jacket/hoodie to a fitted top (`TC-05`) or when long hair/hands overlap the chest (`TC-17`, `TC-20`), IDM-VTON's coarse polygon mask can either erase overlapping hair/fingers or clip the bottom hem of untucked garments during mask compositing.

---

## 5. Running the Adapter-Based Benchmark (`mock`, `idm-vton`, `fashn-v1.6`, `fashn-tryon-max`)

```bash
# 1. Offline Dry-Run Verification (Default MockAdapter — 0 GPU quota, $0 cost)
./apps/ai/.venv/bin/python scripts/evaluate_vton.py --provider mock

# 2. Stage-1 Live Hugging Face IDM-VTON Benchmark (saves raw + mask + composited + strip in 1 call)
./apps/ai/.venv/bin/python scripts/evaluate_vton.py \
    --provider huggingface \
    --manifest scripts/eval_manifest.json \
    --cases TC-01,TC-05,TC-09,TC-16 \
    --confirm-live

# 3. Stage-1 Live FASHN v1.6 + Optional Stage-2 Try-On Max Comparison
AI_API_KEY=fa-xxxx ./apps/ai/.venv/bin/python scripts/evaluate_vton.py \
    --provider fashn-v1.6 \
    --include-tryon-max \
    --manifest scripts/eval_manifest.json \
    --cases TC-01,TC-05,TC-09,TC-16 \
    --confirm-live
```

---

## 6. Licensing Constraints & Verified Commercial Terms

| Provider / Adapter | Model & Endpoint | License & Dependencies | Commercial Production Permitted? | Verified Terms, Cost & Privacy |
| :--- | :--- | :--- | :--- | :--- |
| **`HuggingFaceProvider` (`idm-vton`)** | `yisol/IDM-VTON` (`https://yisol-idm-vton.hf.space`, `/tryon`) | **CC BY-NC-SA 4.0** + **DensePose** (Detectron2 non-commercial license) + **HumanParsing** (non-commercial research license) | **NO — Non-Commercial Only** | Strictly limited to academic research, local evaluation, and non-commercial demos. Cannot be used in commercial production regardless of hosting platform. |
| **`FASHNApiProvider` (`fashn-v1.6`)** | `tryon-v1.6` (`POST https://api.fashn.ai/v1/run`) | Commercial API Terms of Service (`fashn.ai`) | **YES (With Paid Plan)** | **1 credit / image (`~$0.04–$0.075`)**, `864×1296 px`, `~8–12s` latency (`balanced`), **0 credits on failed runs**. Base64 inputs deleted after processing; `return_base64: true` avoids 72h CDN retention; customer data not used for model training. Requires billing setup to create API keys. |
| **`FASHNApiProvider` (`fashn-tryon-max`)** | `tryon-max` (`POST https://api.fashn.ai/v1/run`) | Commercial API Terms of Service (`fashn.ai`) | **YES (With Paid Plan)** | **1–5 credits / image** (`fast` 1k = 1 credit; `balanced` 1k = 2 credits), `~10–55s` latency. Recommended as an optional Stage-2 benchmark on hard logo/occlusion cases (`TC-09`, `TC-10`, `TC-18`). |
| **Other Alternatives (`fal.ai`, Self-Hosted)** | `fal-ai/fashn/tryon/v1.6` or self-hosted commercial weights | Varies by endpoint and preprocessor weights | **Endpoint-Dependent** | Commercial endpoints wrapping FASHN (`fal-ai/fashn/tryon/v1.6`) permit commercial use under fal.ai/FASHN terms (`~$0.075/image`), whereas `idm-vton` or `cat-vton` endpoints remain bound by upstream non-commercial checkpoint/DensePose licenses. |

---

## 7. Multi-Category Wearable Taxonomy & 120-Case Benchmark (`v2.0`)

### 7.1 Category-Aware Routing (`apps/ai/app/services/category_router.py`)
- [`wearable_taxonomy.py`](file:///Users/priyank08/Desktop/WearMe/apps/ai/app/services/wearable_taxonomy.py) defines 8 wearable domains (`clothing`, `jewellery`, `eyewear`, `wristwear`, `bags`, `footwear`, `headwear`, `accessories`) across 38 canonical subcategories, each declaring its `target_body_region`, `required_landmarks`, `routing_strategy`, and honest `live_validation_status` (`verified_live_idm_vton`, `supported_fashn_api_unverified_live`, or `requires_specialized_model_unverified_live`).
- [`CategoryRouterProvider`](file:///Users/priyank08/Desktop/WearMe/apps/ai/app/services/category_router.py) routes requests based on `(category, subcategory)` and **never forces non-upper-body categories through `yisol/IDM-VTON` (`/tryon`)** or silently substitutes mock outputs for failed real inference.

### 7.2 120-Case Benchmark Allocation (`scripts/eval_manifest.v2.example.json`)
- **Total Cases**: `120` (`24` Clothing + `20` Jewellery + `14` Eyewear + `12` Wristwear + `12` Bags + `16` Footwear + `12` Headwear & Hair Accessories + `10` Other Accessories: Belts, Scarves & Ties).
- **Incomplete Dataset Safeguard**: Unpopulated template entries are explicitly marked with `dataset_status: "template_incomplete_images"`, `image_readiness: "missing_images"`, `person_image_path: null`, `product_image_path: null`, and `consent_verified: false` so the template cannot be mistaken for a completed dataset.
- **5-Dimension 1–5 Category-Aware Human Quality Rubric**:
  1. `product_fidelity_1_to_5`
  2. `placement_and_fit_1_to_5`
  3. `identity_and_anatomy_preservation_1_to_5`
  4. `occlusion_and_realism_1_to_5`
  5. `lighting_pose_and_quality_robustness_1_to_5`

---

## 8. 20-Case Quality Pilot (`scripts/eval_manifest.pilot20.example.json`)

To validate one new wearable category properly before scaling across all 8 domains, [`scripts/eval_manifest.pilot20.example.json`](file:///Users/priyank08/Desktop/WearMe/scripts/eval_manifest.pilot20.example.json) defines a focused, reproducible **20-case quality pilot** (`schema_version: "2.1-pilot20"`):

| Pilot Group | Case IDs | Count | Subcategories | Current Provider Support Status |
| :--- | :--- | :---: | :--- | :--- |
| **1. Clothing** | `PILOT-001` .. `PILOT-005` | `5` | `TSHIRT`, `SHIRT`, `JACKET`, `SWEATER`, `TOP` | `supported` (`verified_live_idm_vton` / `fashn-api`) |
| **2. Necklaces / Pendants** | `PILOT-006` .. `PILOT-010` | `5` | `NECKLACE` (3), `PENDANT` (2) | `requires_specialized_model` (no validated live provider yet) |
| **3. Earrings** | `PILOT-011` .. `PILOT-015` | `5` | `EARRINGS` (5) | `requires_specialized_model` (no validated live provider yet) |
| **4. Eyewear** | `PILOT-016` .. `PILOT-020` | `5` | `PRESCRIPTION_GLASSES` (3), `SUNGLASSES` (2) | `requires_specialized_model` (no validated live provider yet) |

### 8.1 Honest Safeguards & Zero-Cost Dry-Run
- **No Fabricated Inputs or Scores**: Because real consented images are not bundled in the repository, all 20 pilot template entries set `person_image_path: null`, `product_image_path: null`, `consent_verified: false`, `dataset_status: "template_incomplete_images"`, and explicitly enumerate `missing_inputs: ["person_image_path", "product_image_path", "permission_source", "license_url", "attribution", "consent_verified"]`.
- **Mandatory Permission Gate**: `verify_case_permission()` is enforced before any image file is read from disk.
- **No Silent Misrouting or Fake Mock Fallback**: Categories without a validated live provider (`NECKLACE`, `PENDANT`, `EARRINGS`, `PRESCRIPTION_GLASSES`, `SUNGLASSES`) report `status: "requires_specialized_model"` (and unknown or incompatible categories report `status: "unsupported"`). They are **never** routed to `yisol/IDM-VTON`, FASHN clothing inference, or `MockProvider` output as though they were real.
- **Zero-Cost Dry-Run CLI**:
  ```bash
  ./apps/ai/.venv/bin/python scripts/evaluate_vton.py \
      --manifest scripts/eval_manifest.pilot20.example.json \
      --provider idm-vton \
      --dry-run
  ```

---

## 9. Next Proposed Implementation: Necklace & Pendant Proof-of-Concept (`NECKLACE` / `PENDANT`)

Before adding providers for earrings or eyewear, the next engineering milestone is a dedicated **Necklace & Pendant Try-On Proof-of-Concept** (`routing_strategy: "landmark_jewellery_neck"`, `target_body_region: "neck_clavicle"`) targeting pilot cases `PILOT-006` .. `PILOT-010`.

### 9.1 Required Anatomical Landmarks & Pose Envelope
1. **Primary Landmarks (MediaPipe Pose + FaceMesh)**:
   - `face_mesh_chin_152` (menton / chin tip) and `face_mesh_jawline_234_454` (left/right mandibular angles) — determine head pitch, head yaw ($\theta_{\text{yaw}}$), and upper neck boundary.
   - `pose_shoulders_11_12` (left/right acromion joints) — determine torso roll ($\theta_{\text{roll}}$), shoulder span $W_{\text{shoulder}}$, and neck base axis.
2. **Derived Neck & Clavicle Control Points**:
   - **Suprasternal Notch ($P_{\text{notch}}$)**: Interpolated along the neck midline from `face_mesh_chin_152` to the shoulder midpoint $M_{\text{shoulder}}$ at $t \approx 0.72$.
   - **Medial Clavicle Anchors ($P_{\text{clav,L}}, P_{\text{clav,R}}$)**: Offset laterally by $\pm 0.18 \cdot W_{\text{shoulder}}$ around $P_{\text{notch}}$, foreshortened proportionally to $\cos(\theta_{\text{yaw}})$ on angled poses (`PILOT-008`).
3. **Supported Pose Envelope**:
   - Frontal and three-quarter portraits with $|\theta_{\text{yaw}}| \le 25^\circ$, $|\theta_{\text{roll}}| \le 15^\circ$, and inter-shoulder width $W_{\text{shoulder}} \ge 180\text{ px}$ (so `1–3 px` fine chain links remain resolvable).
   - Fails fast with `VTONValidationError` if neck/shoulder landmarks are occluded or out of frame.

### 9.2 Image Input Requirements
- **Person Image**:
  - `JPEG`, `PNG`, or `WEBP` (`>= 768×1024 px` recommended), EXIF-normalized, showing chin, neck, and upper chest/clavicles (`PILOT-006` .. `PILOT-010`).
- **Product Image (Necklace / Pendant)**:
  - Isolated product photo on transparent (`RGBA`) or uniform studio white/neutral background.
  - **Product Preprocessing**:
    - High-precision alpha matting (preserving `1–3 px` metallic links and gemstone facets without morphological erosion).
    - Automatic extraction of 3 canonical product control points: left upper chain tangent ($Q_{\text{L}}$), right upper chain tangent ($Q_{\text{R}}$), and lowest central pendant/apex point ($Q_{\text{drop}}$).

### 9.3 Placement, Perspective Warping & Occlusion Handling
1. **Perspective & Thin-Plate Spline (TPS) / Catenary Warping**:
   - Map product control points $(Q_{\text{L}}, Q_{\text{R}}, Q_{\text{drop}})$ to anatomical anchors $(P_{\text{clav,L}}, P_{\text{clav,R}}, P_{\text{notch}} + \Delta y_{\text{drop}})$.
   - Enforce vertical gravity alignment on the pendant medallion (`PILOT-007`, `PILOT-009`) so rigid pendants hang plumb rather than shearing with shoulder tilt.
2. **Foreground Occlusion Handling (`alpha_effective = alpha_necklace * (1 - alpha_occluder)`)**:
   - **Hair Strands (`PILOT-009`)**: Segment hair overlapping the neck/clavicle region so foreground hair strands pass naturally *in front of* the chain.
   - **Open Shirt Collars & Lapels (`PILOT-010`)**: Segment upper garment collar boundaries near the lateral neck base so the outer chain tucks cleanly *beneath* shirt lapels while the central drop remains visible over bare skin/sternum.
   - **Chin Boundary**: Clip upward placement against the lower chin contour (`face_mesh_chin_152`) under downward head tilt.
3. **Contact Shadow & Local Exposure Harmonization**:
   - Render a subtle directional contact shadow (`2–4 px` Gaussian blur, `15–25%` opacity) along the skin beneath the chain and pendant, and match specular white balance to local neck skin luminance without modifying any pixel outside the `neck_clavicle` ROI.

### 9.4 Quantitative & Human-Rubric Success Criteria
Before promoting `NECKLACE` / `PENDANT` from `requires_specialized_model` to a validated provider status, the PoC must pass all 5 necklace/pendant pilot cases (`PILOT-006` .. `PILOT-010`) under the 5-dimension `1–5` human rubric:
- **1. Product Fidelity**: Mean score **`>= 4.0 / 5.0`** (no case `< 3`); `1–3 px` chain links remain continuous without breaks, and pendant aspect ratio distortion is `< 5%`.
- **2. Placement & Fit**: Mean score **`>= 4.0 / 5.0`** (no case `< 3`); symmetrical clavicle seating and vertical pendant drop on both `0°` frontal (`PILOT-006`, `PILOT-007`) and `15°` yaw (`PILOT-008`) poses.
- **3. Identity & Anatomy Preservation**: Score **`== 5.0 / 5.0`** on all 5 cases; `100%` pixel-identical face, hair, clothing, and background outside the `neck_clavicle` ROI, preserving exact original dimensions.
- **4. Occlusion & Realism**: Mean score **`>= 3.8 / 5.0`**; clean foreground occlusion under hair strands (`PILOT-009`) and open shirt collars (`PILOT-010`) with realistic skin contact shadow.
- **5. Lighting, Pose & Quality Robustness**: Mean score **`>= 3.8 / 5.0`**; deterministic execution with local latency `<= 500 ms` and `$0` external API cost.

### 9.5 Implemented Experimental PoC (`apps/ai/app/services/necklace_poc_provider.py`)
The 10-stage local Necklace & Pendant PoC processor (`NecklacePocProvider`, `routing_strategy: "landmark_jewellery_neck"`) is implemented behind an explicit feature flag (`ENABLE_NECKLACE_POC=false` by default):

- **Supported Subcategories**: Only `NECKLACE` and `PENDANT` (or `category=ACCESSORY` with `subcategory=NECKLACE|PENDANT`). `EARRINGS`, `EYEWEAR`, and all other non-clothing categories continue to return `requires_specialized_model` and are never routed through `NecklacePocProvider`, `yisol/IDM-VTON`, or `MockProvider`.
- **Honest Detector Backend Labeling & Plausibility Validation**:
  - When MediaPipe (`mediapipe`) is installed, `_try_mediapipe_landmarks()` extracts anatomical FaceMesh/Pose keypoints (`detector_backend: "mediapipe_face_pose"`, `verified_anatomical: true`).
  - When MediaPipe is not installed, `detect_neck_clavicle_landmarks()` falls back to the skin/silhouette contour estimator and explicitly tags metadata with `detector_backend: "heuristic_skin_silhouette_fallback"`, `verified_anatomical: false`, and `landmark_detector_warning`.
  - `validate_landmarks_plausibility()` enforces finite coordinates, confidence `>= 0.55`, pose limits (`|yaw| <= 25°`, `|roll| <= 18°`), anatomical horizontal/vertical ordering, and shoulder-to-jaw neck constriction (`shoulder_width >= 1.15 * jaw_span`).
- **Artifact & Provenance Preservation**: When an artifact directory is provided (e.g., via `scripts/evaluate_vton.py`), `NecklacePocProvider` saves `01_person_orig.*`, `02_product_orig.*`, `03_person_preprocessed.png` (landmark & ROI overlay), `04_provider_raw_output.png` (unoccluded placement), `05_provider_mask.png` (effective alpha matte after occlusion), `06_final_composited.jpg` (final composite with 100% pixel identity outside `roi_box`), and `07_comparison_strip.jpg`.

### 9.6 Real-Image Pilot Validation Runbook (`v2.1-pilot20`)

1. **Copy the Pilot Manifest Template**:
   ```bash
   cp scripts/eval_manifest.pilot20.example.json scripts/eval_manifest.pilot20.local.json
   ```
2. **Populate Real Consented Assets**:
   For each case you are evaluating (`PILOT-001`..`PILOT-005` for upper-body clothing; `PILOT-006`..`PILOT-010` for necklaces/pendants):
   - Set `"person_image_path"` and `"product_image_path"` to existing local image paths (`JPEG`, `PNG`, or `WEBP`).
   - Set `"permission_source"` (e.g., `"user_consented_own_photo"`), `"license_url"`, `"attribution"`, and `"consent_verified": true`.
3. **Run Zero-Cost Dry-Run Verification First (`$0` / `0` GPU Quota)**:
   ```bash
   ./apps/ai/.venv/bin/python scripts/evaluate_vton.py \
       --manifest scripts/eval_manifest.pilot20.local.json \
       --provider idm-vton \
       --enable-necklace-poc \
       --dry-run
   ```
   Confirm populated cases report `DRY_RUN_READY` and unpopulated/specialized cases report `DRY_RUN_MISSING_INPUTS` or `requires_specialized_model`.
4. **Run Local Necklace/Pendant PoC Evaluation (`$0` External API Cost)**:
   ```bash
   ./apps/ai/.venv/bin/python scripts/evaluate_vton.py \
       --manifest scripts/eval_manifest.pilot20.local.json \
       --provider necklace-poc \
       --enable-necklace-poc \
       --output-dir eval_outputs/pilot20_necklace_poc
   ```
5. **Complete Manual Human Rubric Scoring**:
   Inspect each case's `07_comparison_strip.jpg` and fill in the 5 rubric scores (`product_fidelity_1_to_5`, `placement_and_fit_1_to_5`, `identity_and_anatomy_preservation_1_to_5`, `occlusion_and_realism_1_to_5`, `lighting_pose_and_quality_robustness_1_to_5`) in the generated JSON report.
