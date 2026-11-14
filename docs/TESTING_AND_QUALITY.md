# AgroVera — Testing, Verification & Quality

---

## 1. How to run

```bash
npm test          # 10 acceptance tests, ~0.6 s, offline
npm run lint      # TypeScript type check (tsc --noEmit)
npm run build     # production bundle
```

The tests use Node's built-in runner (`node:test`, `node:assert/strict`) through `tsx --test`, so there are no extra test-framework dependencies. They need **no network access and no Gemini key**: weather is injected through a mock `fetch`, and the agents through a mock `AgentProviderAdapter`.

## 2. Verification results (14 Nov 2026, commit `4f92e28`)

| Check | Result |
|---|---|
| `bun install` | ✅ 221 packages |
| `npm install --legacy-peer-deps` + `npm install react-is --legacy-peer-deps` | ✅ |
| `npm test` | ✅ **10 / 10 pass**, 0 fail |
| `npm run lint` | ✅ no type errors |
| `npm run build` (Bun install, or npm + react-is) | ✅ 2,075 modules; JS 903 kB (260 kB gzip), CSS 33 kB |
| `npm run dev` | ✅ server on :3000, SPA returns 200 |
| `NODE_ENV=production node server.ts` | ✅ serves `dist/`, SPA returns 200 |
| `GET /api/config-status` | ✅ reports models; key value never exposed |
| `POST /api/simulate` (valid / invalid farm) | ✅ 200 with results / 400 with bilingual issues |
| `POST /api/evaluate` without a key | ✅ 200 with deterministic simulation + `aiError`, no crash |
| `POST /api/weather` without outbound network | ✅ `status: "unavailable"` with error message, no fabricated values |

## 3. Acceptance test suite (`src/engine/acceptance.test.ts`)

All tests use a fixed mock DWD ICON response for Karlsruhe: 7 days in April 2026 with two hot days (30.5 / 31.1 °C), one frost night (−0.8 °C) and 4 mm of total rain. That gives the heat, frost and dry-window indicators a known trigger state.

| # | Test | What it proves |
|---|---|---|
| 1 | **Germany primary defaults** | The default farm is Karlsruhe (49.0069, 8.4037), Germany, EUR, m³, Europe/Berlin; all six German city presets exist. |
| 2 | **Farm input validation** | Invalid area, month, soil, water and budget are rejected with EN + DE messages; missing coordinates become an *uncertainty* flag and are never filled with made-up values. |
| 3 | **Weather parsing and error handling** | The parser computes summaries and indicators correctly; HTTP errors, network failures and incomplete payloads produce `status: 'unavailable'` with no invented numbers. |
| 4 | **Crop profiles and provenance** | All 4 crops are present with bilingual names, Destatis-backed yields marked `verified_source`, and costs/prices marked `illustrative_estimate`; the transparency registry includes a `missing` entry. |
| 5 | **Hard constraints** | Sowing-window, m³ irrigation and EUR budget rules make crops infeasible exactly when they should, with specific reasons, deterministically. |
| 6 | **Scenarios and overrides** | Drought, heatwave and similar scenarios plus custom multipliers change supplemental irrigation demand and rankings in the expected direction. |
| 7 | **Language invariance** | `en.json` and `de.json` have identical key sets; dashboard counts and crop rankings are identical in EN and DE, and only the headline text differs; formatting is locale-correct (`€42,000` vs `42.000 €`). |
| 8 | **Self-correction loop (EN and DE)** | Mock Decision Agent proposes infeasible *Potato* under drought in cycle 1 → Critic rejects → gate fails → recalculation → cycle 2 proposes feasible *Barley* → gate passes. Checks the timeline stages, call counts and localised text. |
| 9 | **Cycle limit and independent gate** | A Decision Agent that keeps recommending out-of-season *Winter Wheat* is stopped after exactly `MAX_REVIEW_CYCLES = 2`; `maxCyclesReached = true`, `requiresHumanReview = true`. The gate rejects even when the Critic passes it. |
| 10 | **Branding and secret-exposure audit** | No leftover legacy project name in source files; no client-side file imports `@google/genai` or references `GEMINI_API_KEY`. |

## 4. Quality and safety measures built into the design

### 4.1 Anti-hallucination

| Measure | Location |
|---|---|
| All numbers computed deterministically, passed to LLMs as data | `simulator.ts`, `agents.ts` payloads |
| System prompt forbids altering or inventing numbers | Decision Agent rule 1 |
| Independent Critic checks `numericalClaimsSupported` | `criticResponseSchema` |
| Gate fails if the Critic flags unsupported numbers | `INDEPENDENT_CRITIC_VERDICT` |
| JSON schemas constrain the output structure; canonical IDs stay untranslated | `decisionResponseSchema`, `criticResponseSchema` |

### 4.2 Constraint safety

| Measure | Location |
|---|---|
| Infeasible crops can't pass the gate, whatever the LLMs say | `HARD_CONSTRAINT_FEASIBILITY`, `WATER_…`, `BUDGET_…`, `SEASONAL_…` |
| `none` is only accepted when nothing is feasible | `NO_FEASIBLE_CONSISTENCY` |
| Verified-feasible crops must be preferred over uncertain ones | `PREFER_VERIFIED_FEASIBLE` |

### 4.3 Transparency and responsible-AI behaviour

- Mandatory `keyAssumptions`, `missingInformation` and `humanReviewNotice` (checked by `UNCERTAINTY_AND_SAFETY_DISCLOSURE`).
- No yield, price or weather guarantees; no unverified chemical or pesticide recommendations (Decision Agent rule 5).
- Every recommendation points to human advisory services (Offizialberatung / Landwirtschaftskammer).
- The 7–14-day forecast scope notice is attached to every weather result, and the Critic checks `forecastUncertaintyCommunicated`.
- Each data point is classified *verified / illustrative / missing* and shown in the Data Sources view.
- The full agent timeline (actor, model, status, duration, cycle) is shown to the user.

### 4.4 Robustness

- Every external call is wrapped. Weather never throws (it returns `unavailable`); AI failures return partial results plus `aiError`.
- Weather fetch has a 9 s timeout.
- The review loop is capped at 2 cycles, bounding cost and latency.
- Pure functions plus dependency injection (`fetchImpl`, `adapter`) make the critical paths fully unit-testable.
