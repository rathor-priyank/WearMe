# WearMe — AI Virtual Fashion Try-On Platform

WearMe is an AI-powered virtual fashion try-on platform structured as a clean TypeScript + Python monorepo.

## Architecture

- **`apps/web`** — Next.js 16 (App Router), TypeScript, Tailwind CSS v4, TanStack Query
- **`apps/api`** — NestJS REST API (`:3001`), Swagger (`/api/docs`), Storage & AI provider abstractions
- **`apps/ai`** — Python 3.11 FastAPI inference microservice (`:8001`) supporting `mock` (`MockProvider`) and `fashn-api` (`FASHNApiProvider`)
- **`packages/shared`** — Shared TypeScript types, DTO interfaces, and upper-body category enums (`TOP`, `SHIRT`, `TSHIRT`, `JACKET`)
- **`packages/database`** — PostgreSQL 16 (`:5434`) + Prisma ORM

## Quick Start

```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
pnpm dev
```

- **Web UI**: [http://localhost:3000](http://localhost:3000)
- **API**: [http://localhost:3001/api/v1](http://localhost:3001/api/v1)
- **Swagger UI**: [http://localhost:3001/api/docs](http://localhost:3001/api/docs)
- **AI Service**: [http://localhost:8001/health](http://localhost:8001/health)

## Switching Between Mock and Real AI (`fashn-api`)

By default, `.env` uses `AI_PROVIDER=mock` for zero-cost local pipeline verification. To enable real AI virtual try-on via the official FASHN API v1:

```env
AI_PROVIDER=fashn-api
AI_API_KEY=your_fashn_api_key_here
AI_REQUEST_TIMEOUT_SECONDS=120
FASHN_MODEL_NAME=tryon-v1.6
FASHN_MODE=balanced
FASHN_RETURN_BASE64=true
```

## Documentation

- [System Architecture](docs/architecture.md)
- [AI Pipeline & FASHN Integration](docs/ai-pipeline.md)
- [AI Provider Evaluation & Cost Comparison](docs/ai-provider-evaluation.md)
- [API Reference](docs/api.md)
- [Development Guide](docs/development.md)
- [Product Roadmap](docs/product-roadmap.md)
