# AgroVera — API Reference

This document covers:

1. the **internal REST API** served by `server.ts`;
2. the **external APIs** AgroVera calls (Open-Meteo, Google Gemini);
3. the **core TypeScript functions** that make up the programmatic API.

All endpoints use JSON. Base URL in development: `http://localhost:3000`.

---

## 1. Internal REST API

| Method | Path | Purpose | Calls Gemini? | Calls Open-Meteo? |
|---|---|---|---|---|
| GET | [`/api/config-status`](#get-apiconfig-status) | Health check and model configuration | No | No |
| GET | [`/api/crops`](#get-apicrops) | Crop knowledge base and provenance registry | No | No |
| GET | [`/api/geocode`](#get-apigeocode) | Location search (German results first) | No | Yes |
| POST | [`/api/weather`](#post-apiweather) | Live forecast and risk indicators | No | Yes |
| POST | [`/api/simulate`](#post-apisimulate) | Deterministic simulation only | No | No |
| POST | [`/api/evaluate`](#post-apievaluate) | Full multi-agent evaluation | Yes (3–6 calls) | Yes |

All other routes serve the single-page app.

---

### `GET /api/config-status`

Reports whether a Gemini key is configured (never its value) and which models are active.

**Response 200**

```json
{
  "appName": "AgroVera",
  "geminiKeyConfigured": true,
  "models": {
    "orchestrator": "gemini-4-hydrogen",
    "decisionAgent": "gemini-4-carbon",
    "criticAgent": "gemini-4-carbon"
  },
  "weatherSource": "Deutscher Wetterdienst (DWD ICON) via Open-Meteo API"
}
```

`geminiKeyConfigured` is `false` when the key is empty or still the placeholder `MY_GEMINI_API_KEY`.

```bash
curl http://localhost:3000/api/config-status
```

---

### `GET /api/crops`

Returns the full crop knowledge base (`src/data/crops.json`, type `CropKnowledgeDatabase`).

**Response 200 (abridged)**

```json
{
  "version": "2.0.0-de",
  "regionFocus": "Germany (Deutschland)",
  "defaultTimezone": "Europe/Berlin",
  "illustrativeDisclaimer": { "en": "...", "de": "..." },
  "exchangeRatesPerEurIllustrative": { "EUR": 1, "USD": 1.08 },
  "crops": [
    {
      "id": "winter_wheat",
      "names": { "en": "Winter Wheat", "de": "Winterweizen" },
      "scientificName": "Triticum aestivum",
      "plantingWindow": { "optimalMonths": [10, 11], "shoulderMonths": [9, 12], "label": { "en": "...", "de": "..." } },
      "soilCompatibility": { "Loamy": 96, "Silty": 92, "Clay": 80, "Sandy": 54 },
      "seasonalWaterMmHa": { "totalDemandMin": 410, "totalDemandOptimal": 490, "typicalGermanSeasonRainMm": 415, "waterloggingRainLimit": 720, "...": "..." },
      "inputCostsEurPerHa": { "total": 880, "classification": "illustrative_estimate", "...": "..." },
      "indicativeYieldTonsPerHa": { "destatisNationalAvgTonsHa": 7.83, "low": 6.1, "base": 7.83, "high": 9.2, "classification": "verified_source" },
      "indicativeMarketPriceEurPerTon": { "low": 185, "base": 215, "high": 250, "classification": "illustrative_estimate" },
      "climateSensitivity": { "heat": 0.48, "frost": 0.22, "drought": 0.44, "excessRain": 0.56, "heatStressThresholdC": 31, "frostStressThresholdC": -15 },
      "sources": { "yieldStatistics": { "sourceName": "Statistisches Bundesamt (Destatis) ...", "sourceUrl": "https://www.destatis.de/...", "classification": "verified_source" } }
    }
  ],
  "transparencyRegistry": [
    { "id": "dwd-icon-forecast", "category": "live_weather", "classification": "verified_source", "...": "..." },
    { "id": "dwd-cdc-historical", "category": "unavailable_dataset", "classification": "missing", "...": "..." }
  ]
}
```

---

### `GET /api/geocode`

Searches place names through the Open-Meteo Geocoding API. German results are sorted first.

**Query parameters**

| Name | Type | Required | Notes |
|---|---|---|---|
| `q` | string | yes | Fewer than 2 characters returns `{ "results": [] }` without calling upstream |
| `lang` | `en` \| `de` | no | Defaults to `en`; controls localised place names |

**Response 200**

```json
{
  "results": [
    {
      "id": 2892794,
      "name": "Karlsruhe",
      "admin1": "Baden-Württemberg",
      "country": "Deutschland",
      "countryCode": "DE",
      "latitude": 49.0094,
      "longitude": 8.4044,
      "elevation": 115,
      "timezone": "Europe/Berlin"
    }
  ]
}
```

Up to 8 results; coordinates rounded to 4 decimal places. *(Values above are illustrative; the shape is exact.)*

**Response 502**: upstream failure: `{ "error": "Geocoding API returned HTTP 500", "results": [] }`.

```bash
curl "http://localhost:3000/api/geocode?q=Freiburg&lang=de"
```

---

### `POST /api/weather`

Fetches the near-term forecast for given coordinates and computes the four climate risk indicators.

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `latitude` | number | yes | −90…90 |
| `longitude` | number | yes | −180…180 |
| `locationLabel` | string | no | Defaults to `"Selected Coordinates"` |
| `thresholds` | `WeatherThresholds` | no | Defaults below |

`WeatherThresholds` defaults (DWD conventions):

```json
{ "heatDayMaxTempC": 30, "frostDayMinTempC": 0, "dryWindowTotalPrecipMm": 8, "heavyRainDailyMm": 25 }
```

**Provider selection.** Coordinates inside latitude 45–56° N and longitude 4–18° E use the **DWD ICON** endpoint (7 days, `Europe/Berlin`). Anything else uses the **Open-Meteo global** forecast (14 days, timezone `auto`).

**Response 200: `WeatherForecastAnalysis`**

```json
{
  "status": "ok",
  "providerModel": "dwd-icon",
  "source": "Deutscher Wetterdienst (DWD ICON) via Open-Meteo API",
  "sourceUrl": "https://open-meteo.com/en/docs/dwd-api",
  "fetchedAt": "2026-11-14T15:00:00.000Z",
  "locationLabel": "Karlsruhe",
  "coordinates": { "latitude": 49.0, "longitude": 8.4, "elevationM": 115, "timezone": "Europe/Berlin" },
  "forecastPeriod": { "startDate": "2026-11-14", "endDate": "2026-11-20", "days": 7 },
  "thresholdsUsed": { "heatDayMaxTempC": 30, "frostDayMinTempC": 0, "dryWindowTotalPrecipMm": 8, "heavyRainDailyMm": 25 },
  "daily": [ { "date": "2026-11-14", "tempMaxC": 9.1, "tempMinC": 2.3, "precipMm": 1.2, "et0Mm": 0.6 } ],
  "summary": {
    "avgMaxTempC": 8.4, "peakMaxTempC": 10.2, "lowestMinTempC": -1.1,
    "totalPrecipMm": 14.6, "maxDailyPrecipMm": 6.0, "totalEt0Mm": 4.1,
    "hotDaysCount": 0, "frostDaysCount": 2, "heavyRainDaysCount": 0
  },
  "riskIndicators": [
    {
      "id": "frost",
      "labelBilingual": { "en": "Near-Term Frost Exposure (Frosttage)", "de": "Kurzfristiges Frostrisiko (Frosttage)" },
      "severity": "moderate",
      "triggered": true,
      "observedMetricBilingual": { "en": "Min -1.1 °C (2d ≤ 0 °C)", "de": "Min. -1.1 °C (2 Tg. ≤ 0 °C)" },
      "thresholdMetric": "≤ 0 °C",
      "affectedDays": 2,
      "explanationBilingual": { "en": "...", "de": "..." }
    }
  ],
  "scopeLimitationNotice": { "en": "Near-term meteorological forecast only (7–14 days ...)", "de": "..." }
}
```

*(Values above are illustrative; the shape is exact.)*

**Risk indicator rules**

| `id` | Triggered when | Severity `high` when |
|---|---|---|
| `heat` | ≥ 1 day with Tmax ≥ `heatDayMaxTempC` | ≥ 3 hot days or peak ≥ threshold + 4 °C |
| `frost` | ≥ 1 night with Tmin ≤ `frostDayMinTempC` | lowest ≤ −3 °C or ≥ 3 frost days |
| `dry_weather` | total precipitation < `dryWindowTotalPrecipMm` | total < 35 % of the threshold |
| `heavy_rain` | ≥ 1 day with precipitation ≥ `heavyRainDailyMm` | max day ≥ 1.4 × threshold or ≥ 2 heavy days |

**Failure behaviour.** The endpoint still returns **200**, with `status: "unavailable"`, `summary: null`, `daily: []`, `riskIndicators: []` and a bilingual `errorMessageBilingual`. Causes include invalid coordinates, upstream HTTP error, network error, a 9-second timeout or incomplete data. Values are never fabricated.

```bash
curl -X POST http://localhost:3000/api/weather \
  -H 'Content-Type: application/json' \
  -d '{"latitude":49.0069,"longitude":8.4037,"locationLabel":"Karlsruhe"}'
```

---

### `POST /api/simulate`

Runs the deterministic simulation only. It is fast, free, and makes no AI or network calls.

**Request body**

| Field | Type | Required | Default |
|---|---|---|---|
| `farm` | `FarmProfile` | yes | — |
| `scenarioId` | `baseline` \| `drought` \| `heatwave` \| `heavy_rainfall` \| `frost` | no | `baseline` |
| `scenarioOverride` | `ScenarioParametersOverride` | no | — |
| `weather` | `WeatherForecastAnalysis` \| `null` | no | `null` |

> **Note:** with `weather: null`, crops that pass every hard constraint are reported as `uncertain` (not `feasible`), because near-term conditions are unverified. To get `feasible` statuses, pass the object returned by `/api/weather`.

**`FarmProfile`**

| Field | Type | Constraints |
|---|---|---|
| `farmName` | string | |
| `country` | string | e.g. `"Germany"` |
| `regionState` | string? | |
| `locationName` | string | ≥ 2 characters (required) |
| `latitude` / `longitude` | number \| null | null → flagged as missing (uncertainty) |
| `timezone` | string | e.g. `"Europe/Berlin"` |
| `soilType` | `Sandy` \| `Loamy` \| `Clay` \| `Silty` | |
| `areaHa` | number | > 0 and ≤ 10,000 |
| `availableWaterValue` | number | ≥ 0 |
| `availableWaterUnit` | `m3_total_season` \| `mm_per_ha_season` | |
| `budgetAmount` | number | ≥ 0 |
| `currency` | `EUR` \| `USD` | USD uses an illustrative 1.08 rate |
| `preferredCrop` | `winter_wheat` \| `barley` \| `maize` \| `potato` | +3 suitability bonus |
| `plantingMonth` | integer | 1–12 |
| `priorityMode` | `balanced` \| `max_profit` \| `min_climate_risk` \| `min_water` | |
| `customWeights` | `{profit, climateResilience, waterEfficiency, soilMatch}`? | normalised to sum 1 |
| `isSampleProfile` | boolean? | |

**`ScenarioParametersOverride`** (all optional): `waterDemandMultiplier`, `seasonalRainfallMultiplier`, `heatFactor`, `frostFactor`, `droughtFactor`, `excessRainFactor`.

**Example**

```bash
curl -X POST http://localhost:3000/api/simulate \
  -H 'Content-Type: application/json' \
  -d '{
    "scenarioId": "baseline",
    "farm": {
      "farmName": "Demo", "country": "Germany",
      "locationName": "Karlsruhe, Baden-Württemberg, Germany",
      "latitude": 49.0069, "longitude": 8.4037, "timezone": "Europe/Berlin",
      "soilType": "Loamy", "areaHa": 12,
      "availableWaterValue": 19200, "availableWaterUnit": "m3_total_season",
      "budgetAmount": 42000, "currency": "EUR",
      "preferredCrop": "maize", "plantingMonth": 4, "priorityMode": "balanced"
    }
  }'
```

**Response 200: `SimulationRunOutput`**, as actually produced for the request above (`cropResults` trimmed to one crop):

```json
{
  "evaluatedAt": "2026-11-14T15:22:00.000Z",
  "scenario": { "id": "baseline", "waterDemandMultiplier": 1, "seasonalRainfallMultiplier": 1, "...": "..." },
  "weightsNormalized": { "profit": 0.3, "climateResilience": 0.3, "waterEfficiency": 0.2, "soilMatch": 0.2 },
  "farmSummary": {
    "country": "Germany", "locationName": "Karlsruhe, Baden-Württemberg, Germany",
    "plantingMonth": 4, "areaHa": 12, "soilType": "Loamy",
    "availableIrrigationMmHa": 160, "availableIrrigationTotalM3": 19200,
    "budgetInSelectedCurrency": 42000, "budgetInEurEquivalent": 42000, "currency": "EUR"
  },
  "validation": { "valid": true, "issues": [], "missingUncertaintyFields": [], "missingUncertaintyBilingual": [] },
  "cropResults": [
    {
      "cropId": "potato",
      "seasonalSuitability": "optimal",
      "feasibilityStatus": "uncertain",
      "infeasibilityReasons": [],
      "uncertaintyReasons": ["Live DWD/Open-Meteo weather forecast was unavailable; ..."],
      "waterEvaluation": {
        "totalCropDemandMinMmHa": 480, "scenarioTotalCropDemandMmHa": 480, "scenarioOptimalCropDemandMmHa": 570,
        "estimatedEffectiveSeasonRainMmHa": 370, "nearTermSeedbedPrecipCreditMmHa": 0,
        "additionalIrrigationRequiredMmHa": 110, "additionalIrrigationRequiredM3": 13200,
        "availableIrrigationMmHa": 160, "availableIrrigationTotalM3": 19200,
        "irrigationSurplusOrDeficitM3": 6000, "irrigationUtilizationPct": 68.8,
        "satisfiesWaterConstraint": true
      },
      "financialEvaluation": {
        "currency": "EUR", "inputCostPerHa": 3150, "totalFarmInputCost": 37800,
        "availableFarmBudget": 42000, "satisfiesBudgetConstraint": true,
        "destatisBenchmarkTonsPerHa": 45.02,
        "yieldTonsPerHa": { "low": 30.39, "expected": 41.45, "high": 51.73 },
        "netProfitRange": { "low": 26019, "expected": 79089, "high": 148428 }
      },
      "scores": {
        "soilCompatibility": 94, "climateResilience": 94, "waterEfficiency": 53,
        "profitPotential": 89, "preferredCropBonus": 0, "weightedSuitability": 84.3
      },
      "riskProfile": { "overallRiskLevel": "low", "...": "..." }
    }
  ],
  "feasibleCropsCount": 0,
  "topFeasibleCropId": null,
  "illustrativeDisclaimer": { "en": "...", "de": "..." }
}
```

For the same request, the four crops ranked: Potato 84.3 (uncertain), Barley 70.5 (uncertain), Maize 69.5 (uncertain), Winter Wheat 68.0 (**infeasible**: *"Out of planting season in April…"*).

`cropResults` is sorted by status (`feasible` → `uncertain` → `infeasible`), then by `weightedSuitability` descending.

**Response 400**

```json
{ "error": "Farm profile failed input validation.", "validation": { "valid": false, "issues": [ { "field": "areaHa", "message": "...", "messageBilingual": { "en": "...", "de": "..." } } ] } }
```

or `{ "error": "Missing farm profile payload." }`.

---

### `POST /api/evaluate`

Runs the complete pipeline: weather → Orchestrator (tool call) → simulation → Decision Agent → Critic Agent → validation gate, with up to 2 review cycles. See [ARCHITECTURE.md §3](ARCHITECTURE.md#3-end-to-end-request-flow-post-apievaluate).

**Request body**

| Field | Type | Required | Default |
|---|---|---|---|
| `farm` | `FarmProfile` | yes | — |
| `scenarioId` | `ClimateScenarioId` | no | `baseline` |
| `scenarioOverride` | `ScenarioParametersOverride` | no | — |
| `weatherThresholds` | `WeatherThresholds` | no | DWD defaults |
| `language` | `en` \| `de` | no | `en` (any other value → `en`) |
| `baselineComparison` | `BaselineReferenceContext` | no | — |

`BaselineReferenceContext`: `{ scenarioId, availableWaterM3, availableWaterMmHa, budgetAmount, currency, priorityMode, plantingMonth, recommendedCropId, topFeasibleCropId, cropRankings: [{ cropId, feasibilityStatus, score }] }`. When provided, the response includes `scenarioShiftExplanation`.

**Response 200: `AgenticEvaluationResponse`**

| Field | Type | Description |
|---|---|---|
| `runId` | string | `run-<timestamp>` |
| `language` | `en` \| `de` | |
| `completedAt` | ISO string | |
| `farm`, `scenarioId` | | Echo of the inputs |
| `weather` | `WeatherForecastAnalysis` | Fetched server-side |
| `simulation` | `SimulationRunOutput` | Ground truth used by the agents |
| `orchestratorSummary` | string | 2-sentence brief |
| `decision` | `DecisionAgentOutput` \| null | Final cycle's decision |
| `critic` | `CriticAgentOutput` \| null | Final cycle's audit |
| `validationGate` | `ValidationGateResult` \| null | `{ passed, requiresHumanReview, checks[], failureReasons[], failureReasonsBilingual[] }` |
| `reviewCycles` | `ReviewCycleRecord[]` | Per cycle: decision, critic, gate, optional `recalculatedStressSimulation` |
| `maxCyclesReached` | boolean | True if the gate still failed after 2 cycles |
| `requiresHumanReview` | boolean | |
| `timeline` | `AgentTimelineEvent[]` | `{ id, timestamp, stage, actor, modelId?, status, title, summary, cycle?, durationMs? }` |
| `modelsUsed` | `{ orchestrator, decisionAgent, criticAgent }` | |
| `aiError` | `{ stage, model, message }`? | Present if a model call failed |
| `scenarioShiftExplanation` | string? | |

`timeline.stage` values: `weather_request`, `weather_response`, `crop_profiles`, `orchestrator`, `simulation`, `decision_agent`, `critic_agent`, `validation_gate`, `recalculation`, `final_recommendation`.

**Example: successful decision (abridged)**

```json
{
  "decision": {
    "recommendedCropId": "barley",
    "decisionStatus": "recommended",
    "headline": "Spring barley is the most robust feasible choice for this April sowing.",
    "executiveSummary": "...",
    "tradeoffAnalysis": { "financial": "...", "climateAndEnvironmental": "...", "waterAndSoilResources": "..." },
    "alternativeComparisons": [ { "cropId": "potato", "comparisonSummary": "..." }, { "cropId": "maize", "comparisonSummary": "..." }, { "cropId": "winter_wheat", "comparisonSummary": "Out of season in April." } ],
    "keyAssumptions": ["..."],
    "missingInformation": ["Nmin/NPK soil lab analysis", "..."],
    "actionableNextSteps": ["..."],
    "humanReviewNotice": "Confirm with your regional Offizialberatung before purchasing seed."
  },
  "critic": { "verdict": "pass", "hardConstraintsSatisfied": true, "numericalClaimsSupported": true, "objections": [], "requestedRecalculation": { "needed": false, "targetScenarioId": "none", "reason": "..." }, "criticSummary": "..." },
  "validationGate": { "passed": true, "requiresHumanReview": false, "checks": [ { "code": "HARD_CONSTRAINT_FEASIBILITY", "passed": true, "...": "..." } ] },
  "reviewCycles": [ { "cycle": 1, "...": "..." } ],
  "maxCyclesReached": false,
  "requiresHumanReview": false
}
```

*(The decision text is illustrative; the shape is exact.)*

**Example: no API key configured.** The response is still **200** and the deterministic results are included. This was verified against the running server:

```json
{
  "decision": null,
  "critic": null,
  "validationGate": null,
  "requiresHumanReview": true,
  "aiError": {
    "stage": "orchestrator",
    "model": "gemini-4-hydrogen",
    "message": "GEMINI_API_KEY is missing on the server. Configure a valid Gemini API key in Settings > Secrets."
  },
  "timeline": [ "weather_request", "weather_response", "crop_profiles", "simulation", "orchestrator" ]
}
```

**Response 400**: invalid farm. `error` holds the joined validation messages in the requested language.
**Response 500**: unexpected server error: `{ "error": "..." }`.

**Cost and latency.** One Orchestrator call (two turns when the tool is used) plus 2 calls per review cycle, so **3 calls minimum, 6 maximum**. The Decision and Critic calls use high thinking.

```bash
curl -X POST http://localhost:3000/api/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"language":"de","scenarioId":"drought","farm":{ ...same FarmProfile as above... }}'
```

---

## 2. External APIs used

### 2.1 Open-Meteo: DWD ICON forecast

| | |
|---|---|
| Endpoint | `GET https://api.open-meteo.com/v1/dwd-icon` |
| Docs | https://open-meteo.com/en/docs/dwd-api |
| Auth | None (free, non-commercial tier) |
| Used by | `fetchOpenMeteoWeather()` in `src/engine/weather.ts` |
| Parameters | `latitude`, `longitude`, `daily=temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration`, `forecast_days=7`, `timezone=Europe/Berlin` |
| When | Coordinates inside 45–56° N, 4–18° E (the Central European ICON-D2/EU domain) |
| Timeout | 9 s (AbortController) |

### 2.2 Open-Meteo: global forecast (fallback)

| | |
|---|---|
| Endpoint | `GET https://api.open-meteo.com/v1/forecast` |
| Docs | https://open-meteo.com/en/docs |
| Parameters | Same daily variables, `forecast_days=14`, `timezone=auto` |
| When | Coordinates outside the DWD domain box |

### 2.3 Open-Meteo: geocoding

| | |
|---|---|
| Endpoint | `GET https://geocoding-api.open-meteo.com/v1/search` |
| Docs | https://open-meteo.com/en/docs/geocoding-api |
| Parameters | `name`, `count=8`, `language=en\|de`, `format=json` |
| Post-processing | `country_code === 'DE'` results sorted first; coordinates rounded to 4 decimals |

### 2.4 Google Gemini API (via `@google/genai`)

| | |
|---|---|
| SDK | `@google/genai` ^3.3 — `new GoogleGenAI({ apiKey })`, `ai.models.generateContent()` |
| Docs | https://ai.google.dev/gemini-api/docs |
| Auth | `GEMINI_API_KEY` (server-side only) |
| Features used | **Function calling** (`tools.functionDeclarations`, `functionResponse` turn), **structured output** (`responseMimeType: 'application/json'` + `responseSchema` built with `Type`), **system instructions**, **thinking config** (`ThinkingLevel.LOW` for the Orchestrator, `ThinkingLevel.HIGH` for the Decision and Critic agents) |
| Models | Constants in `server/agents.ts` (see README, *Model configuration*) |

### 2.5 Reference data sources (static, cited in `crops.json`)

| Source | Use | Classification |
|---|---|---|
| Statistisches Bundesamt (Destatis), *Feldfrüchte und Grünland* harvest statistics 2024–2025 | National average yields (e.g. wheat 7.83 t/ha, maize 10.05 t/ha, potato 45.02 t/ha) | `verified_source` |
| LTZ Augustenberg (Baden-Württemberg), LfL Bayern | Sowing windows, cultivation guidance | `verified_source` |
| LfL Deckungsbeiträge / KTBL / BLE categories | Structure of illustrative cost and price estimates | `illustrative_estimate` |
| DWD Climate Data Center (30-year station history), on-farm soil lab | Not connected | `missing` |

---

## 3. Programmatic (TypeScript) API

The engine can be used directly, e.g. in tests, scripts or another server.

```ts
import { simulateCrops, validateFarmProfile, normalizePreferenceWeights,
         convertWaterToMmPerHa, convertMmPerHaToTotalM3 } from './src/engine/simulator.ts';
import { fetchOpenMeteoWeather, parseOpenMeteoForecast,
         geocodeLocationOpenMeteo, buildUnavailableWeatherAnalysis } from './src/engine/weather.ts';
import { runDeterministicValidationGate } from './src/engine/validationGate.ts';
import { executeAgenticPipeline, createRealGeminiAdapter,
         type AgentProviderAdapter } from './server/agents.ts';
import { CROP_DATABASE, CLIMATE_SCENARIOS, PRIORITY_WEIGHT_PRESETS,
         DEFAULT_WEATHER_THRESHOLDS, DEFAULT_SAMPLE_FARM, SAMPLE_FARM_PRESETS,
         GERMAN_CITY_PRESETS, resolveScenarioConfig } from './src/engine/presets.ts';
```

| Function | Signature (simplified) | Notes |
|---|---|---|
| `simulateCrops` | `(farm, weather \| null, scenarioId = 'baseline', override?) → SimulationRunOutput` | Pure and synchronous |
| `validateFarmProfile` | `(farm) → FarmValidationResult` | Bilingual issues and missing-data flags |
| `fetchOpenMeteoWeather` | `({latitude, longitude, locationLabel, thresholds?}, fetchImpl = fetch) → Promise<WeatherForecastAnalysis>` | Never throws; returns `unavailable` on failure |
| `parseOpenMeteoForecast` | `(raw, label, thresholds?, providerModel?) → WeatherForecastAnalysis` | Pure parser |
| `geocodeLocationOpenMeteo` | `(query, lang = 'en', fetchImpl = fetch) → Promise<GeocodingCandidate[]>` | Throws on upstream HTTP error |
| `runDeterministicValidationGate` | `(decision, critic, simulation, weather) → ValidationGateResult` | Pure |
| `executeAgenticPipeline` | `({farm, scenarioId?, scenarioOverride?, weatherThresholds?, language?, baselineComparison?, adapter?, fetchImpl?}) → Promise<AgenticEvaluationResponse>` | `adapter` and `fetchImpl` are injectable (used by the tests) |

**Custom AI provider.** Implement `AgentProviderAdapter`:

```ts
interface AgentProviderAdapter {
  runOrchestratorWorkflow(p): Promise<{ summary: string; toolInvoked: boolean }>;
  runDecisionAgent(p): Promise<{ decision: DecisionAgentOutput; scenarioShiftExplanation?: string }>;
  runCriticAgent(p): Promise<CriticAgentOutput>;
}
```

All shared types live in [`src/types/domain.ts`](../src/types/domain.ts).
