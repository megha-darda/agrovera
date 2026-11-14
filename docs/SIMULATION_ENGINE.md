# AgroVera — Deterministic Simulation Engine

Source: [`src/engine/simulator.ts`](../src/engine/simulator.ts), [`src/engine/presets.ts`](../src/engine/presets.ts), [`src/data/crops.json`](../src/data/crops.json).

The engine is a **pure, synchronous, language-independent** function:

```ts
simulateCrops(farm, weather | null, scenarioId = 'baseline', scenarioOverride?) → SimulationRunOutput
```

It evaluates all four candidate crops for one farm under one climate scenario. It is the single source of every number shown in the UI and passed to the AI agents.

---

## 1. Inputs

| Input | Source |
|---|---|
| Farm profile (location, coordinates, soil, area, water, budget, currency, sowing month, preferred crop, priority mode, custom weights) | User (Farm Setup) |
| Weather summary (7–14 days) | Open-Meteo DWD ICON (may be `null` or `unavailable`) |
| Crop parameters | `crops.json` |
| Scenario multipliers | `CLIMATE_SCENARIOS` + optional user override |
| Priority weights | `PRIORITY_WEIGHT_PRESETS` or `customWeights` |

## 2. Crop parameters (`crops.json`)

| Crop | Optimal sowing months | Shoulder months | Destatis yield (t/ha) | Yield low / base / high | Input cost €/ha | Price €/t low / base / high | Demand min / opt (mm) | Typical season rain (mm) | Waterlogging limit (mm) | Soil fit L / Si / C / Sa |
|---|---|---|---|---|---|---|---|---|---|---|
| Winter Wheat | Oct, Nov | Sep, Dec | 7.83 | 6.1 / 7.83 / 9.2 | 880 | 185 / 215 / 250 | 410 / 490 | 415 | 720 | 96 / 92 / 80 / 54 |
| Barley | Mar, Apr, Sep, Oct | Feb | 7.44 | 5.4 / 6.9 / 8.1 | 710 | 175 / 210 / 255 | 330 / 410 | 345 | 640 | 92 / 88 / 72 / 74 |
| Maize | Apr, May | — | 10.05 | 7.6 / 10.05 / 12.2 | 1,180 | 190 / 220 / 255 | 470 / 560 | 410 | 820 | 94 / 90 / 70 / 68 |
| Potato | Mar, Apr | May | 45.02 | 33.0 / 45.02 / 53.0 | 3,150 | 175 / 235 / 300 | 480 / 570 | 370 | 610 | 94 / 82 / 42 / 88 |

L = Loamy, Si = Silty, C = Clay, Sa = Sandy. Barley covers both spring (Mar–Apr) and winter (Sep–Oct) sowing.

Each crop also carries `climateSensitivity` (heat, frost, drought, excessRain in 0–1, plus heat/frost stress thresholds in °C), bilingual agronomic notes, and **source citations with classification**: yields are `verified_source` (Destatis); costs and prices are `illustrative_estimate`.

---

## 3. Algorithm per crop

### 3.1 Seasonal suitability

```
optimal        if plantingMonth ∈ optimalMonths
shoulder       if plantingMonth ∈ shoulderMonths
out_of_season  otherwise                      → hard constraint violation
```

### 3.2 Water balance

Unit conversion: **1 mm over 1 ha = 10 m³**.

```
availableIrrigationMmHa   = m3 / (areaHa × 10)            (or the given mm/ha)
availableIrrigationM3     = given m³                      (or mmHa × areaHa × 10)

seedbedCredit             = min(12, forecastTotalPrecip × 0.35)   if weather ok, else 0
effectiveSeasonRain       = typicalGermanSeasonRainMm × scenario.seasonalRainfallMultiplier
scenarioDemandMin         = round(totalDemandMin × scenario.waterDemandMultiplier)
scenarioDemandOptimal     = round(totalDemandOptimal × scenario.waterDemandMultiplier)

additionalIrrigationMmHa  = max(0, scenarioDemandMin − effectiveSeasonRain − seedbedCredit)
additionalIrrigationM3    = additionalIrrigationMmHa × areaHa × 10

waterlogging              = (effectiveSeasonRain + forecastTotalPrecip) > waterloggingRainLimit
                            AND (soil = Clay OR crop.excessRain sensitivity ≥ 0.8)

satisfiesWaterConstraint  = availableIrrigationM3 ≥ additionalIrrigationM3 AND NOT waterlogging
```

The short-term forecast credit is **capped at 12 mm** so a rainy week is never extrapolated into a wet season. That separation between *total seasonal crop demand (mm/ha)* and *supplemental irrigation required from farm reserves (m³)* is deliberate.

### 3.3 Budget

```
inputCostPerHa      = crop.inputCostsEurPerHa.total × exchangeRate   (EUR 1.00, USD 1.08 illustrative)
totalFarmInputCost  = inputCostPerHa × areaHa
satisfiesBudget     = budgetAmount ≥ totalFarmInputCost
```

### 3.4 Climate risk

Near-term signals from the forecast (all 0 when weather is unavailable):

| Signal | Condition | Value |
|---|---|---|
| heat | peak Tmax ≥ crop heat threshold | clamp((peak − threshold + hotDays × 1.5) / 12, 0.15, 1) |
| frost | lowest Tmin ≤ crop frost threshold | clamp((threshold − lowest + frostDays × 2) / 10, 0.2, 1) |
| dry | total precip < dry threshold | 0.3 |
| rain | heavy-rain days > 0 | clamp(heavyDays × 0.35, 0.25, 1) |

Each hazard combines the near-term signal with the scenario's stress factor:

```
heatHazard   = max(heatSignal × 0.65,  scenario.heatFactor)
frostHazard  = max(frostSignal × 0.75, scenario.frostFactor)
droughtHaz.  = max(drySignal × 0.35,   scenario.droughtFactor)
excessRain   = max(rainSignal × 0.60,  scenario.excessRainFactor)

riskScore_i  = round(hazard_i × crop.sensitivity_i × 100)           (i ∈ heat, frost, drought, excessRain)
overallRisk  = round(0.68 × max(riskScore_i) + 0.32 × mean(riskScore_i))
level        = critical ≥ 70 · high ≥ 48 · moderate ≥ 25 · low
climateResilience = 100 − overallRisk
```

Weighting the *peak* hazard at 68 % means one severe exposure (e.g. late frost on potatoes) dominates instead of being averaged away.

### 3.5 Yield, revenue, profit

```
soilYieldFactor     = clamp(0.68 + soilCompatibility/100 × 0.36, 0.60, 1.05)
waterAdequacy       = clamp((effectiveSeasonRain + seedbedCredit + availableIrrigationMmHa) / scenarioDemandOptimal, 0.45, 1.05)
climateYieldFactor  = clamp(1 − overallRisk/100 × 0.46, 0.42, 1.0)
timingFactor        = 1.0 optimal · 0.88 shoulder · 0.45 out_of_season
regionalTempFactor  = 0.93 for maize north of 51.8° N, else 1.0

multiplier          = clamp(soil × min(1.03, water) × climate × timing × regional, 0.35, 1.08)

yieldLow/Expected   = crop.low/base yield × multiplier
yieldHigh           = crop.high yield × min(1.05, multiplier × 1.06)
revenue             = totalYield × price (low/base/high)
netProfit           = revenue − totalFarmInputCost
ROI %               = netProfitExpected / totalFarmInputCost × 100
```

### 3.6 Sub-scores (0–100)

| Score | Formula |
|---|---|
| `soilCompatibility` | From the crop's soil table |
| `climateResilience` | 100 − overallRisk |
| `waterEfficiency` | clamp(0.84 × clamp((260 − additionalIrrigationMmHa)/260 × 100, 8, 100) + marginBonus, 0, 100), where marginBonus = up to +18 for surplus water, −25 if in deficit |
| `profitPotential` | expected net profit per ha (EUR) ÷ highest "ceiling" profit per ha across all crops (base yield × base price − cost, min 150) × 100 |

### 3.7 Weighted suitability index

```
weightedSuitability = clamp( w_profit × profitPotential
                           + w_climate × climateResilience
                           + w_water × waterEfficiency
                           + w_soil × soilCompatibility
                           + (preferredCrop ? 3 : 0), 0, 100)
```

Priority presets (normalised to sum 1):

| Mode | Profit | Climate resilience | Water efficiency | Soil match |
|---|---|---|---|---|
| `balanced` | 0.30 | 0.30 | 0.20 | 0.20 |
| `max_profit` | 0.55 | 0.15 | 0.15 | 0.15 |
| `min_climate_risk` | 0.15 | 0.55 | 0.15 | 0.15 |
| `min_water` | 0.15 | 0.20 | 0.50 | 0.15 |

`customWeights` override the preset. Negative values clamp to 0; all-zero falls back to `balanced`.

### 3.8 Feasibility status

A crop is **infeasible** if any hard constraint fails, each recorded with a bilingual, number-specific reason:

1. sowing month `out_of_season`;
2. supplemental irrigation required > available m³, **or** waterlogging hazard;
3. total input cost > budget;
4. soil compatibility < 40 / 100.

Otherwise it is **uncertain** if the farm input is invalid, coordinates are missing, or weather is unavailable. If none of that applies, it is **feasible**.

### 3.9 Ranking

Results are sorted by status (`feasible` < `uncertain` < `infeasible`), then by `weightedSuitability` descending. `topFeasibleCropId` is the first `feasible` crop, or `null`.

A low-scoring feasible crop always ranks above a high-scoring infeasible one. Constraints come before preferences.

---

## 4. Climate scenarios

| ID | Name (EN / DE) | Water demand × | Season rain × | Heat | Frost | Drought | Excess rain | Represents |
|---|---|---|---|---|---|---|---|---|
| `baseline` | Baseline / Ausgangssituation | 1.00 | 1.00 | 0.08 | 0.05 | 0.08 | 0.05 | Normal German season + live forecast |
| `drought` | Drought / Trockenheit | 1.14 | 0.65 | 0.35 | 0.00 | 0.82 | 0.00 | 2018/2022-style spring–summer deficit |
| `heatwave` | Heatwave / Hitzewelle | 1.16 | 0.78 | 0.88 | 0.00 | 0.45 | 0.00 | Prolonged > 35 °C episodes, Jun–Aug |
| `heavy_rainfall` | Heavy Rainfall / Starkregen | 0.90 | 1.68 | 0.04 | 0.00 | 0.00 | 0.88 | Convective storms, waterlogging, lodging |
| `frost` | Late Frost / Spätfrost | 0.96 | 0.95 | 0.00 | 0.90 | 0.08 | 0.08 | Eisheiligen-type −3 °C nights after emergence |

Every scenario except `baseline` is labelled a **hypothetical stress test** in the UI. Users can override any multiplier or factor (`ScenarioParametersOverride`); doing so also marks the scenario as hypothetical.

---

## 5. Input validation (`validateFarmProfile`)

| Field | Rule | On failure |
|---|---|---|
| `locationName` | ≥ 2 characters | issue (invalid) |
| `latitude` / `longitude` | null or NaN | **uncertainty flag** (not an error) |
| | out of ±90 / ±180 | issue |
| `areaHa` | 0 < x ≤ 10,000 | issue |
| `availableWaterValue` | ≥ 0 | issue |
| `budgetAmount` | ≥ 0 | issue |
| `plantingMonth` | integer 1–12 | issue |
| `soilType` | Sandy / Loamy / Clay / Silty | issue |

All messages are bilingual (`messageBilingual.en/.de`).

---

## 6. Worked example (default demo farm)

12 ha loamy soil, Karlsruhe, 19,200 m³ (= 160 mm/ha), €42,000, April sowing, balanced, *baseline*, no weather loaded. This is the actual engine output:

| Crop | Status | Suitability | Irrigation needed | Input cost | Why |
|---|---|---|---|---|---|
| Potato | uncertain | 84.3 | 13,200 m³ (110 mm/ha) | €37,800 | All constraints met; weather not yet verified |
| Barley | uncertain | 70.5 | — | €8,520 | All constraints met; weather not yet verified |
| Maize | uncertain | 69.5 | — | €14,160 | All constraints met; weather not yet verified |
| Winter Wheat | **infeasible** | 68.0 | — | €10,560 | Out of planting season in April |

Once the live forecast loads, the `uncertain` crops become `feasible` (unless the forecast triggers a constraint) and the seedbed credit slightly reduces irrigation demand.

Under **Drought** with the same farm, irrigation demand rises sharply: Winter Wheat 23,664 m³, Maize 32,340 m³, Potato 36,780 m³ (all above the 19,200 m³ available). **Barley (18,204 m³) is the only crop that still fits.** The recommendation therefore shifts from Potato to Barley, which Scenario Analysis explains.

---

## 7. Determinism guarantees

- No randomness, no clock-dependent logic (apart from the `evaluatedAt` timestamp), no network calls.
- Identical inputs → identical outputs on client and server.
- Language has no influence on any number or ranking (test #7).
- All rounding is explicit (`toFixed` / `Math.round`) at defined points.
