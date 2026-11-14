# AgroVera

**Smarter Farming. Verified Decisions.**  
**Intelligenter Anbau. Geprüfte Entscheidungen.**

AgroVera is a Germany-focused, fully bilingual (**English / Deutsch**) agricultural intelligence and crop decision-support platform. It combines a deterministic TypeScript agronomic simulation engine, live Deutscher Wetterdienst (**DWD ICON**) weather forecasts via Open-Meteo, published **Statistisches Bundesamt (Destatis)** national harvest yield references, and a server-side multi-agent verification pipeline powered by **Gemini 4 Carbon** and **Gemini 4 Hydrogen**.

---

## Key Capabilities

1. **Germany Primary Region (`Deutschland`)**
   - Default farm profile in **Karlsruhe, Baden-Württemberg** (`49.0069° N, 8.4037° E`, timezone `Europe/Berlin`), with quick-select German locations (Karlsruhe, Munich/München, Stuttgart, Freiburg, Berlin, Hamburg) and live Open-Meteo geocoding.
   - European metric & financial conventions: `EUR (€)`, `hectares (ha)`, `cubic metres (m³)` for irrigation volume, `°C`, and `mm`.

2. **Structured, Source-Aware German Crop Profiles**
   - `winter_wheat` — **Winter Wheat / Winterweizen** (*Triticum aestivum*)
   - `barley` — **Barley / Gerste** (*Hordeum vulgare*)
   - `maize` — **Maize / Mais** (*Zea mays*)
   - `potato` — **Potato / Kartoffel** (*Solanum tuberosum*)
   - Strict separation between **total seasonal crop water demand (`mm/ha`)** and **supplemental irrigation required from farm water reserves (`m³`)**, plus German sowing-window enforcement (`optimal` / `shoulder` / `out_of_season`).

3. **Data Provenance & Scientific Transparency**
   - **Verified Source**: Live short-term forecasts from **DWD ICON** via Open-Meteo (`7–14 days`) and published German harvest yield averages from **Destatis (2024–2025)**.
   - **Illustrative Estimate**: Direct variable input costs (`EUR/ha`), farmgate price bands (`EUR/t`), and supplemental irrigation ranges structured after **LfL Bayern** and **LTZ Augustenberg** enterprise budget categories.
   - **Missing / Not Connected**: Explicitly documented where live historical 30-year DWD CDC station archives or field-specific Nmin/NPK soil lab tests are not connected.

4. **Complete Bilingual Localization (`EN | DE`)**
   - Instant `EN | DE` switcher in the top navigation bar (persisted in `localStorage`).
   - Deterministic simulation calculations, scores, and feasibility statuses are **100% language-invariant**.
   - Gemini Decision & Critic Agents generate natural English in `EN` mode and idiomatic, farmer-appropriate German in `DE` mode while keeping internal crop IDs canonical.

5. **Multi-Agent Verification Loop (Max 2 Cycles)**
   - **Orchestrator**: `gemini-4-hydrogen` invokes the deterministic simulation tool.
   - **Decision Agent**: `gemini-4-carbon` (`ThinkingLevel.HIGH`) synthesizes trade-offs strictly from verified simulation numbers.
   - **Independent Critic Agent**: Separate `gemini-4-carbon` (`ThinkingLevel.HIGH`) adversarial call audits hard constraints, numerical fidelity, and forecast horizon limits, backed by a deterministic TypeScript validation gate.

---

## Development & Verification

```bash
# Start full-stack Express + Vite server on port 3000
npm run dev

# Run deterministic unit & acceptance tests
npm test

# Type-check and build production bundle
npm run lint
npm run build

# Start production server (Cloud Run compatible)
npm start
```
