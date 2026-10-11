# Product Roadmap

## V1 — Focused Upper-Body MVP (Current)

- Anonymous single-garment try-on flow (`TOP`, `SHIRT`, `TSHIRT`, `JACKET`)
- Drag-and-drop person + garment image upload with MIME & magic-byte validation
- End-to-end pipeline: Next.js -> NestJS -> Python FastAPI -> Storage -> Side-by-side result view
- Pluggable AI provider (`mock` for pipeline verification, `fashn-api` for real VTON inference)
- Image download and explicit job/image deletion (`DELETE /api/v1/try-on/:jobId`)

## V2 — Real VTON Production & Consumer Accounts

- Production VTON provider evaluation and commercial license verification
- Async job queue (BullMQ + Redis) with webhook/SSE status updates
- Cloud object storage (`AWS S3` / `Cloudflare R2`) with short-lived pre-signed URLs
- Optional user authentication, saved try-on history, and automated TTL cleanup cron
- Expanded garment categories: `DRESS`, `KURTI`, `PANTS`, `JEANS`, `SHORTS`

## V3 — Seller Portal & Multi-Garment Styling

- Seller accounts, product catalog upload, and try-on asset pre-processing
- Shareable try-on links, QR codes for physical stores, and embeddable web widget
- Complete outfit composition (top + bottom + outerwear) and side-by-side outfit comparison
- Complex traditional wear support (`SAREE`, `SALWAR_SUIT`)

## Future — AI Fashion Commerce & Enterprise API

- External B2B API keys, usage metering, and webhook callbacks
- AI personal stylist & outfit recommendations
- Direct checkout and e-commerce platform integrations (Shopify, WooCommerce)

