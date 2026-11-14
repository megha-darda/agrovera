import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  executeAgenticPipeline,
  MAX_REVIEW_CYCLES,
  type AgentProviderAdapter,
} from '../../server/agents.ts';
import deLocale from '../i18n/locales/de.json' with { type: 'json' };
import enLocale from '../i18n/locales/en.json' with { type: 'json' };
import {
  beginEvaluationRequest,
  createInitialEvaluationTracker,
  invalidateEvaluationOnInputChange,
  receiveEvaluationResponse,
} from './evaluationState.ts';
import {
  CROP_DATABASE,
  DEFAULT_SAMPLE_FARM,
  DEFAULT_WEATHER_THRESHOLDS,
  GERMAN_CITY_PRESETS,
  PRIORITY_WEIGHT_PRESETS,
} from './presets.ts';
import {
  computeProfitPotentialScore,
  computeWaterEfficiencyScore,
  computeWeightedSuitabilityScore,
  normalizePreferenceWeights,
  simulateCrops,
  validateFarmProfile,
} from './simulator.ts';
import { runDeterministicValidationGate } from './validationGate.ts';
import {
  assessWeatherApplicability,
  fetchOpenMeteoWeather,
  parseOpenMeteoForecast,
  type OpenMeteoRawResponse,
} from './weather.ts';
import type {
  CriticAgentOutput,
  DecisionAgentOutput,
  FarmProfile,
} from '../types/domain.ts';
import {
  deriveDashboardState,
  formatCropName,
  formatCurrency,
  formatNumber,
} from '../utils/formatters.ts';

const MOCK_DWD_KARLSRUHE_RAW: OpenMeteoRawResponse = {
  latitude: 49.01,
  longitude: 8.4,
  elevation: 118,
  timezone: 'Europe/Berlin',
  daily: {
    time: [
      '2026-04-14',
      '2026-04-15',
      '2026-04-16',
      '2026-04-17',
      '2026-04-18',
      '2026-04-19',
      '2026-04-20',
    ],
    temperature_2m_max: [18.4, 21.2, 30.5, 31.1, 19.6, 17.8, 18.9],
    temperature_2m_min: [6.2, 7.5, 11.4, 12.1, 5.4, -0.8, 4.3],
    precipitation_sum: [0.0, 0.0, 0.0, 1.8, 0.0, 0.0, 2.2],
    et0_fao_evapotranspiration: [2.8, 3.3, 4.6, 4.8, 2.9, 2.4, 2.7],
  },
};

test('1. Germany primary defaults: Karlsruhe, EUR (€), hectares (ha), m³ irrigation, and Europe/Berlin', () => {
  assert.equal(DEFAULT_SAMPLE_FARM.country, 'Germany');
  assert.ok(DEFAULT_SAMPLE_FARM.locationName.includes('Karlsruhe'));
  assert.equal(DEFAULT_SAMPLE_FARM.currency, 'EUR');
  assert.equal(DEFAULT_SAMPLE_FARM.availableWaterUnit, 'm3_total_season');
  assert.equal(DEFAULT_SAMPLE_FARM.timezone, 'Europe/Berlin');
  assert.equal(DEFAULT_SAMPLE_FARM.latitude, 49.0069);
  assert.equal(DEFAULT_SAMPLE_FARM.longitude, 8.4037);

  const cityIds = GERMAN_CITY_PRESETS.map((c) => c.id);
  for (const expected of [
    'karlsruhe',
    'munich',
    'stuttgart',
    'cottbus',
    'freiburg',
    'berlin',
    'hamburg',
  ]) {
    assert.ok(cityIds.includes(expected), `Missing German preset: ${expected}`);
  }
});

test('2. Farm input validation catches invalid fields and flags missing coordinates in EN & DE without faking values', () => {
  const validCheck = validateFarmProfile(DEFAULT_SAMPLE_FARM);
  assert.equal(validCheck.valid, true);
  assert.equal(validCheck.issues.length, 0);

  const invalidFarm: FarmProfile = {
    ...DEFAULT_SAMPLE_FARM,
    locationName: '',
    areaHa: -2,
    availableWaterValue: -100,
    budgetAmount: -500,
    plantingMonth: 13,
  };
  const invalidCheck = validateFarmProfile(invalidFarm);
  assert.equal(invalidCheck.valid, false);
  assert.equal(invalidCheck.issues.length, 5);
  for (const iss of invalidCheck.issues) {
    assert.ok(iss.messageBilingual.en.length > 5);
    assert.ok(iss.messageBilingual.de.length > 5);
  }

  const missingCoordsFarm: FarmProfile = {
    ...DEFAULT_SAMPLE_FARM,
    latitude: null,
    longitude: null,
  };
  const missingCoordsSim = simulateCrops(missingCoordsFarm, null, 'baseline');
  assert.ok(
    missingCoordsSim.cropResults.every(
      (c) =>
        c.feasibilityStatus === 'uncertain' ||
        c.feasibilityStatus === 'infeasible'
    )
  );
  // Feasible spring crops without coords must be marked 'uncertain', never 'feasible'
  assert.equal(missingCoordsSim.feasibleCropsCount, 0);
});

test('3. DWD ICON / Open-Meteo parsing & error handling never fabricate weather values', async () => {
  const parsed = parseOpenMeteoForecast(
    MOCK_DWD_KARLSRUHE_RAW,
    'Karlsruhe, Baden-Württemberg',
    DEFAULT_WEATHER_THRESHOLDS,
    'dwd-icon'
  );
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.providerModel, 'dwd-icon');
  assert.ok(parsed.source.includes('Deutscher Wetterdienst'));
  assert.equal(parsed.daily.length, 7);
  assert.equal(parsed.summary?.peakMaxTempC, 31.1);
  assert.equal(parsed.summary?.hotDaysCount, 2); // >= 30°C
  assert.equal(parsed.summary?.frostDaysCount, 1); // -0.8 <= 0°C

  const heatInd = parsed.riskIndicators.find((r) => r.id === 'heat');
  const frostInd = parsed.riskIndicators.find((r) => r.id === 'frost');
  const dryInd = parsed.riskIndicators.find((r) => r.id === 'dry_weather');
  assert.equal(heatInd?.triggered, true);
  assert.equal(frostInd?.triggered, true);
  assert.equal(dryInd?.triggered, true); // 4.0 mm < 8 mm

  const failedFetch: typeof fetch = async () =>
    new Response('Bad Gateway', { status: 502, statusText: 'Bad Gateway' });
  const failedWeather = await fetchOpenMeteoWeather(
    {
      latitude: 49.0069,
      longitude: 8.4037,
      locationLabel: 'Karlsruhe',
    },
    failedFetch
  );
  assert.equal(failedWeather.status, 'unavailable');
  assert.equal(failedWeather.daily.length, 0);
  assert.equal(failedWeather.summary, null);
  assert.ok(failedWeather.errorMessage?.includes('502'));
});

test('4. German crop profiles & provenance registry cover Winter Wheat, Barley, Maize, and Potato with explicit classifications', () => {
  assert.equal(CROP_DATABASE.crops.length, 4);
  const ids = CROP_DATABASE.crops.map((c) => c.id).sort();
  assert.deepEqual(ids, ['barley', 'maize', 'potato', 'winter_wheat']);

  for (const crop of CROP_DATABASE.crops) {
    assert.ok(crop.names.en.length > 0 && crop.names.de.length > 0);
    assert.equal(
      crop.indicativeYieldTonsPerHa.classification,
      'verified_source'
    );
    assert.equal(
      crop.inputCostsEurPerHa.classification,
      'illustrative_estimate'
    );
    assert.equal(
      crop.indicativeMarketPriceEurPerTon.classification,
      'illustrative_estimate'
    );
  }

  const classifications = new Set(
    CROP_DATABASE.transparencyRegistry.map((e) => e.classification)
  );
  assert.ok(classifications.has('verified_source'));
  assert.ok(classifications.has('illustrative_estimate'));
  assert.ok(classifications.has('missing'));
});

test('5. German seasonal sowing suitability & m³ irrigation / EUR budget hard constraints work deterministically', () => {
  const weather = parseOpenMeteoForecast(MOCK_DWD_KARLSRUHE_RAW, 'Karlsruhe');

  // April (month 4) in Karlsruhe: Potato, Maize, and Spring Barley are in season & feasible;
  // Winter Wheat requires Oct-Nov sowing and MUST be infeasible ('out_of_season')!
  const aprilSim = simulateCrops(DEFAULT_SAMPLE_FARM, weather, 'baseline');
  const wwApril = aprilSim.cropResults.find(
    (c) => c.cropId === 'winter_wheat'
  )!;
  const potatoApril = aprilSim.cropResults.find((c) => c.cropId === 'potato')!;
  const maizeApril = aprilSim.cropResults.find((c) => c.cropId === 'maize')!;
  const barleyApril = aprilSim.cropResults.find((c) => c.cropId === 'barley')!;

  assert.equal(wwApril.seasonalSuitability, 'out_of_season');
  assert.equal(wwApril.feasibilityStatus, 'infeasible');
  assert.equal(potatoApril.feasibilityStatus, 'feasible');
  assert.equal(maizeApril.feasibilityStatus, 'feasible');
  assert.equal(barleyApril.feasibilityStatus, 'feasible');

  // October (month 10): Winter Wheat and Winter Barley are feasible; Maize and Potato are out of season!
  const octSim = simulateCrops(
    { ...DEFAULT_SAMPLE_FARM, plantingMonth: 10 },
    weather,
    'baseline'
  );
  assert.equal(
    octSim.cropResults.find((c) => c.cropId === 'winter_wheat')!
      .feasibilityStatus,
    'feasible'
  );
  assert.equal(
    octSim.cropResults.find((c) => c.cropId === 'barley')!.feasibilityStatus,
    'feasible'
  );
  assert.equal(
    octSim.cropResults.find((c) => c.cropId === 'maize')!.feasibilityStatus,
    'infeasible'
  );
  assert.equal(
    octSim.cropResults.find((c) => c.cropId === 'potato')!.feasibilityStatus,
    'infeasible'
  );

  // Lowering irrigation volume to 4,000 m³ in April makes Potato (~13,032 m³ needed) and Maize (~7,032 m³ needed) infeasible,
  // while Spring Barley (0 m³ supplemental needed in baseline) stays feasible!
  const lowWaterSim = simulateCrops(
    { ...DEFAULT_SAMPLE_FARM, availableWaterValue: 4000 },
    weather,
    'baseline'
  );
  assert.equal(
    lowWaterSim.cropResults.find((c) => c.cropId === 'potato')!
      .feasibilityStatus,
    'infeasible'
  );
  assert.equal(
    lowWaterSim.cropResults.find((c) => c.cropId === 'maize')!
      .feasibilityStatus,
    'infeasible'
  );
  assert.equal(
    lowWaterSim.cropResults.find((c) => c.cropId === 'barley')!
      .feasibilityStatus,
    'feasible'
  );

  // Lowering EUR budget to €12,000 for 12 ha makes Potato (€37,800) and Maize (€14,160) infeasible, keeping Barley (€8,520) feasible!
  const lowBudgetSim = simulateCrops(
    { ...DEFAULT_SAMPLE_FARM, budgetAmount: 12000 },
    weather,
    'baseline'
  );
  assert.equal(
    lowBudgetSim.cropResults.find((c) => c.cropId === 'potato')!
      .feasibilityStatus,
    'infeasible'
  );
  assert.equal(
    lowBudgetSim.cropResults.find((c) => c.cropId === 'maize')!
      .feasibilityStatus,
    'infeasible'
  );
  assert.equal(
    lowBudgetSim.cropResults.find((c) => c.cropId === 'barley')!
      .feasibilityStatus,
    'feasible'
  );
});

test('6. German climate scenarios & editable scenarioOverride recalculate supplemental m³ demand and rankings', () => {
  const weather = parseOpenMeteoForecast(MOCK_DWD_KARLSRUHE_RAW, 'Karlsruhe');
  const baseSim = simulateCrops(DEFAULT_SAMPLE_FARM, weather, 'baseline');
  const droughtSim = simulateCrops(DEFAULT_SAMPLE_FARM, weather, 'drought');

  // Under Drought (Trockenheit), Potato and Maize supplemental irrigation exceed 19,200 m³ and become infeasible, leaving Barley feasible!
  assert.equal(
    baseSim.cropResults.find((c) => c.cropId === 'potato')!.feasibilityStatus,
    'feasible'
  );
  assert.equal(
    droughtSim.cropResults.find((c) => c.cropId === 'potato')!
      .feasibilityStatus,
    'infeasible'
  );
  assert.equal(
    droughtSim.cropResults.find((c) => c.cropId === 'maize')!.feasibilityStatus,
    'infeasible'
  );
  assert.equal(
    droughtSim.cropResults.find((c) => c.cropId === 'barley')!
      .feasibilityStatus,
    'feasible'
  );

  // Editable scenario override changes deterministic water demand and supplemental m³ for each crop
  const customStressSim = simulateCrops(
    DEFAULT_SAMPLE_FARM,
    weather,
    'baseline',
    {
      waterDemandMultiplier: 1.35,
      seasonalRainfallMultiplier: 0.45,
    }
  );
  const basePotato = baseSim.cropResults.find((c) => c.cropId === 'potato')!;
  const customPotato = customStressSim.cropResults.find(
    (c) => c.cropId === 'potato'
  )!;
  const baseBarley = baseSim.cropResults.find((c) => c.cropId === 'barley')!;
  const customBarley = customStressSim.cropResults.find(
    (c) => c.cropId === 'barley'
  )!;
  assert.ok(
    customPotato.waterEvaluation.scenarioTotalCropDemandMmHa >
      basePotato.waterEvaluation.scenarioTotalCropDemandMmHa
  );
  assert.ok(
    customBarley.waterEvaluation.additionalIrrigationRequiredM3 >
      baseBarley.waterEvaluation.additionalIrrigationRequiredM3
  );
});

test('7. Language switching (EN <-> DE) has 100% locale key parity and NEVER changes deterministic numbers or rankings', () => {
  function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
    const keys: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      const next = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        keys.push(...flattenKeys(v as Record<string, unknown>, next));
      } else {
        keys.push(next);
      }
    }
    return keys.sort();
  }

  const enKeys = flattenKeys(enLocale as Record<string, unknown>);
  const deKeys = flattenKeys(deLocale as Record<string, unknown>);
  assert.deepEqual(
    enKeys,
    deKeys,
    'English and German locale files must have identical translation keys'
  );

  // Locale-aware formatting check
  assert.equal(formatCurrency(42000, 'EUR', 'en'), '€42,000');
  assert.equal(formatCurrency(42000, 'EUR', 'de'), '42.000 €');
  assert.equal(formatNumber(19200, 'en', 0), '19,200');
  assert.equal(formatNumber(19200, 'de', 0), '19.200');
  assert.equal(formatCropName('winter_wheat', 'en'), 'Winter Wheat');
  assert.equal(formatCropName('winter_wheat', 'de'), 'Winterweizen');

  // Verify dashboard derived numbers & crop rankings are identical across EN and DE
  const weather = parseOpenMeteoForecast(MOCK_DWD_KARLSRUHE_RAW, 'Karlsruhe');
  const sim = simulateCrops(DEFAULT_SAMPLE_FARM, weather, 'baseline');
  const dashEn = deriveDashboardState(
    DEFAULT_SAMPLE_FARM,
    sim,
    weather,
    null,
    'en'
  );
  const dashDe = deriveDashboardState(
    DEFAULT_SAMPLE_FARM,
    sim,
    weather,
    null,
    'de'
  );

  assert.equal(dashEn.feasibleCount, dashDe.feasibleCount);
  assert.equal(dashEn.infeasibleCount, dashDe.infeasibleCount);
  assert.equal(
    dashEn.recommendedCrop?.cropId,
    dashDe.recommendedCrop?.cropId
  );
  assert.equal(
    dashEn.recommendedCrop?.scores.weightedSuitability,
    dashDe.recommendedCrop?.scores.weightedSuitability
  );
  assert.notEqual(dashEn.activeHeadline, dashDe.activeHeadline);
});

test('8. Bilingual multi-agent Critic rejection, recalculation, and Cycle 2 self-correction work in both EN and DE', async () => {
  let decisionCalls = 0;
  let criticCalls = 0;

  const mockFetch: typeof fetch = async () =>
    new Response(JSON.stringify(MOCK_DWD_KARLSRUHE_RAW), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const germanSelfCorrectingAdapter: AgentProviderAdapter = {
    async runOrchestratorWorkflow({ scenarioId, executeSimulationTool }) {
      const sim = executeSimulationTool(scenarioId);
      return {
        summary: `4 Kulturen geprüft; ${sim.feasibleCropsCount} machbar.`,
        toolInvoked: true,
      };
    },
    async runDecisionAgent({ cycle }) {
      decisionCalls++;
      // Cycle 1 proposes infeasible 'potato' under drought; Cycle 2 corrects to feasible 'barley'
      const cropId = cycle === 1 ? 'potato' : 'barley';
      const decision: DecisionAgentOutput = {
        recommendedCropId: cropId,
        decisionStatus: 'recommended',
        headline:
          cycle === 1
            ? 'Vorschlag Kartoffel trotz Trockenheit'
            : 'Empfehlung Sommergerste nach Prüfung des Beregnungskontingents',
        executiveSummary: 'Basierend auf den deterministischen Simulationswerten.',
        tradeoffAnalysis: {
          financial: 'Direktkosten innerhalb des 42.000 € Budgets.',
          climateAndEnvironmental: 'Hohe Trockenheitsresilienz im Szenario Trockenheit.',
          waterAndSoilResources: 'Zusatzbewässerung unter 19.200 m³ eingehalten.',
        },
        alternativeComparisons: [
          {
            cropId: 'maize',
            comparisonSummary: 'Überschreitet das verfügbare Beregnungswasser.',
          },
          {
            cropId: 'winter_wheat',
            comparisonSummary: 'Außerhalb des Saatfensters im April.',
          },
          {
            cropId: cycle === 1 ? 'barley' : 'potato',
            comparisonSummary: 'Im Vergleich dokumentiert.',
          },
        ],
        keyAssumptions: ['Destatis-Ertragsreferenz und geschätzte Direktkosten.'],
        missingInformation: ['Aktuelle Nmin-Bodenprobe fehlt.'],
        actionableNextSteps: ['Rücksprache mit der amtlichen Pflanzenbauberatung.'],
        humanReviewNotice:
          'Vor dem Saatgutkauf wird eine Prüfung durch die Landwirtschaftskammer empfohlen.',
      };
      return { decision };
    },
    async runCriticAgent({ decision, simulation }) {
      criticCalls++;
      const chosen = simulation.cropResults.find(
        (c) => c.cropId === decision.recommendedCropId
      );
      const ok = chosen?.feasibilityStatus === 'feasible';
      const critic: CriticAgentOutput = {
        verdict: ok ? 'pass' : 'reject',
        hardConstraintsSatisfied: Boolean(ok),
        alternativesComparedFairly: true,
        forecastUncertaintyCommunicated: true,
        numericalClaimsSupported: true,
        assumptionsConsistent: true,
        moreRobustAlternativeId: ok ? 'none' : 'barley',
        objections: ok
          ? []
          : [
              {
                severity: 'critical',
                category: 'hard_constraint',
                detail:
                  'Kartoffel überschreitet im Szenario Trockenheit das Wasserkontingent von 19.200 m³.',
              },
            ],
        requestedRecalculation: {
          needed: !ok,
          targetScenarioId: !ok ? 'heatwave' : 'none',
          reason: !ok ? 'Gegenprüfung Hitzewelle.' : 'Keine Neuberechnung nötig.',
        },
        criticSummary: ok
          ? 'Gerste erfüllt alle harten Restriktionen.'
          : 'Abgelehnt wegen Überschreitung des Beregnungskontingents.',
      };
      return critic;
    },
  };

  const resDe = await executeAgenticPipeline({
    farm: DEFAULT_SAMPLE_FARM,
    scenarioId: 'drought',
    language: 'de',
    adapter: germanSelfCorrectingAdapter,
    fetchImpl: mockFetch,
  });

  assert.equal(resDe.language, 'de');
  assert.equal(decisionCalls, 2);
  assert.equal(criticCalls, 2);
  assert.equal(resDe.reviewCycles.length, 2);
  assert.equal(resDe.reviewCycles[0].validationGate.passed, false);
  assert.equal(resDe.reviewCycles[1].validationGate.passed, true);
  assert.equal(resDe.decision?.recommendedCropId, 'barley');
});

test('9. Maximum 2-cycle loop limit and deterministic gate independent rejection', async () => {
  let decCount = 0;
  const mockFetch: typeof fetch = async () =>
    new Response(JSON.stringify(MOCK_DWD_KARLSRUHE_RAW), { status: 200 });

  const invalidAdapter: AgentProviderAdapter = {
    async runOrchestratorWorkflow({ scenarioId, executeSimulationTool }) {
      executeSimulationTool(scenarioId);
      return { summary: 'Done.', toolInvoked: true };
    },
    async runDecisionAgent() {
      decCount++;
      return {
        decision: {
          recommendedCropId: 'winter_wheat', // Infeasible in April (out_of_season)!
          decisionStatus: 'recommended',
          headline: 'Invalid out-of-season proposal',
          executiveSummary: 'Test.',
          tradeoffAnalysis: {
            financial: 'Test',
            climateAndEnvironmental: 'Test',
            waterAndSoilResources: 'Test',
          },
          alternativeComparisons: [
            { cropId: 'barley', comparisonSummary: 'Alt 1' },
            { cropId: 'maize', comparisonSummary: 'Alt 2' },
            { cropId: 'potato', comparisonSummary: 'Alt 3' },
          ],
          keyAssumptions: ['Assumption'],
          missingInformation: ['Soil Nmin'],
          actionableNextSteps: ['Consult advisor'],
          humanReviewNotice: 'Consult regional agronomic extension advisor.',
        },
      };
    },
    async runCriticAgent() {
      return {
        verdict: 'reject',
        hardConstraintsSatisfied: false,
        alternativesComparedFairly: true,
        forecastUncertaintyCommunicated: true,
        numericalClaimsSupported: true,
        assumptionsConsistent: true,
        moreRobustAlternativeId: 'barley',
        objections: [
          {
            severity: 'critical',
            category: 'hard_constraint',
            detail: 'Winter wheat cannot be sown in April.',
          },
        ],
        requestedRecalculation: {
          needed: true,
          targetScenarioId: 'baseline',
          reason: 'Out of season.',
        },
        criticSummary: 'Rejected out-of-season winter wheat.',
      };
    },
  };

  const out = await executeAgenticPipeline({
    farm: DEFAULT_SAMPLE_FARM,
    scenarioId: 'baseline',
    adapter: invalidAdapter,
    fetchImpl: mockFetch,
  });

  assert.equal(decCount, MAX_REVIEW_CYCLES);
  assert.equal(out.maxCyclesReached, true);
  assert.equal(out.requiresHumanReview, true);

  // Even if Critic mistakenly passed out-of-season Winter Wheat, deterministic gate MUST reject it
  const gateCheck = runDeterministicValidationGate(
    out.decision!,
    {
      ...out.critic!,
      verdict: 'pass',
      hardConstraintsSatisfied: true,
      numericalClaimsSupported: true,
    },
    out.simulation,
    out.weather
  );
  assert.equal(gateCheck.passed, false);
});

test('10. Complete rebranding & security audit: zero AgriSentinel references and zero client GEMINI_API_KEY exposure', () => {
  const rootDir = process.cwd();
  const filesToInspect: string[] = [
    path.join(rootDir, 'index.html'),
    path.join(rootDir, 'metadata.json'),
    path.join(rootDir, 'server.ts'),
    path.join(rootDir, 'server', 'agents.ts'),
  ];

  function collectDir(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const out: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...collectDir(full));
      } else if (
        (entry.name.endsWith('.ts') ||
          entry.name.endsWith('.tsx') ||
          entry.name.endsWith('.json')) &&
        !entry.name.endsWith('.test.ts')
      ) {
        out.push(full);
      }
    }
    return out;
  }

  const srcFiles = collectDir(path.join(rootDir, 'src'));
  for (const file of [...filesToInspect, ...srcFiles]) {
    const content = fs.readFileSync(file, 'utf8');
    assert.equal(
      content.includes('AgriSentinel'),
      false,
      `Found leftover 'AgriSentinel' branding in ${file}`
    );
  }

  for (const file of srcFiles) {
    if (file.endsWith('.json')) continue;
    const content = fs.readFileSync(file, 'utf8');
    assert.equal(
      content.includes('@google/genai'),
      false,
      `Client file ${file} must never import @google/genai`
    );
    assert.equal(
      content.includes('GEMINI_API_KEY'),
      false,
      `Client file ${file} must never reference GEMINI_API_KEY`
    );
  }
});

test('11. REGRESSION 1: Changing Stuttgart to Cottbus immediately invalidates the Stuttgart recommendation and archives it as outdated', async () => {
  const stuttgartPreset = GERMAN_CITY_PRESETS.find(
    (c) => c.id === 'stuttgart'
  )!;
  const cottbusPreset = GERMAN_CITY_PRESETS.find((c) => c.id === 'cottbus')!;

  const stuttgartFarm: FarmProfile = {
    ...DEFAULT_SAMPLE_FARM,
    locationName: `${stuttgartPreset.cityEn}, ${stuttgartPreset.state}, Germany`,
    regionState: stuttgartPreset.state,
    latitude: stuttgartPreset.latitude,
    longitude: stuttgartPreset.longitude,
    soilType: stuttgartPreset.typicalSoil,
    isSampleProfile: false,
  };

  const cottbusFarm: FarmProfile = {
    ...stuttgartFarm,
    locationName: `${cottbusPreset.cityEn}, ${cottbusPreset.state}, Germany`,
    regionState: cottbusPreset.state,
    latitude: cottbusPreset.latitude,
    longitude: cottbusPreset.longitude,
    soilType: cottbusPreset.typicalSoil,
  };

  const mockFetch: typeof fetch = async () =>
    new Response(JSON.stringify(MOCK_DWD_KARLSRUHE_RAW), { status: 200 });

  const verifiedAdapter: AgentProviderAdapter = {
    async runOrchestratorWorkflow({ scenarioId, executeSimulationTool }) {
      const sim = executeSimulationTool(scenarioId);
      return {
        summary: `Evaluated Stuttgart (${sim.feasibleCropsCount}/4 feasible).`,
        toolInvoked: true,
      };
    },
    async runDecisionAgent({ simulation }) {
      const topId = simulation.topFeasibleCropId ?? 'none';
      return {
        decision: {
          recommendedCropId: topId,
          decisionStatus: topId === 'none' ? 'no_feasible_crop' : 'recommended',
          headline: `Stuttgart verified recommendation: ${topId}`,
          executiveSummary:
            'Grounded in Stuttgart silty soil simulation and current 7-day forecast.',
          tradeoffAnalysis: {
            financial: 'Within €42,000 budget.',
            climateAndEnvironmental:
              '7-day DWD forecast does not cover full growing season.',
            waterAndSoilResources: 'Within 19,200 m³ supplemental irrigation.',
          },
          alternativeComparisons: simulation.cropResults
            .filter((c) => c.cropId !== topId)
            .map((c) => ({
              cropId: c.cropId,
              comparisonSummary: `${c.cropName} evaluated fairly.`,
            })),
          keyAssumptions: ['Destatis yield reference; illustrative EUR costs.'],
          missingInformation: ['Field-specific Nmin lab soil test.'],
          actionableNextSteps: ['Verify seed availability with local advisor.'],
          humanReviewNotice:
            'Consult Offizialberatung / Landwirtschaftskammer before sowing.',
        },
      };
    },
    async runCriticAgent({ simulation }) {
      return {
        verdict: 'pass',
        hardConstraintsSatisfied: simulation.feasibleCropsCount > 0,
        alternativesComparedFairly: true,
        forecastUncertaintyCommunicated: true,
        numericalClaimsSupported: true,
        assumptionsConsistent: true,
        moreRobustAlternativeId: 'none',
        objections: [],
        requestedRecalculation: {
          needed: false,
          targetScenarioId: 'none',
          reason: 'All checks passed.',
        },
        criticSummary: 'Stuttgart recommendation verified.',
      };
    },
  };

  let tracker = createInitialEvaluationTracker(stuttgartFarm, 'baseline');
  const { nextState: inFlightStuttgart, request: reqStuttgart } =
    beginEvaluationRequest(tracker, stuttgartFarm, 'baseline', 'en');
  tracker = inFlightStuttgart;

  const stuttgartEval = await executeAgenticPipeline({
    farm: stuttgartFarm,
    scenarioId: 'baseline',
    language: 'en',
    evaluationId: reqStuttgart.evaluationId,
    adapter: verifiedAdapter,
    fetchImpl: mockFetch,
  });

  const received = receiveEvaluationResponse(
    tracker,
    reqStuttgart,
    stuttgartEval
  );
  assert.equal(received.acceptedAsActive, true);
  tracker = received.nextState;
  assert.ok(tracker.activeEvaluation !== null);
  assert.equal(
    tracker.activeEvaluation?.validationGate?.hasVerifiedRecommendation,
    true
  );

  // Switch farm from Stuttgart to Cottbus -> must immediately invalidate Stuttgart recommendation!
  const afterCottbusSwitch = invalidateEvaluationOnInputChange(
    tracker,
    cottbusFarm,
    'baseline'
  );
  assert.equal(afterCottbusSwitch.activeEvaluation, null);
  assert.equal(afterCottbusSwitch.conditionsChangedSinceLastEvaluation, true);
  assert.equal(afterCottbusSwitch.historicalEvaluations.length, 1);
  assert.equal(
    afterCottbusSwitch.historicalEvaluations[0].evaluationId,
    reqStuttgart.evaluationId
  );
  assert.equal(
    afterCottbusSwitch.historicalEvaluations[0].outdatedReason,
    'farm_or_scenario_changed'
  );
  assert.ok(
    afterCottbusSwitch.historicalEvaluations[0].inputSnapshot.farm.locationName.includes(
      'Stuttgart'
    )
  );
  assert.equal(
    afterCottbusSwitch.historicalEvaluations[0].inputSnapshot.farm.soilType,
    'Silty'
  );

  // Even if someone accidentally passes the old Stuttgart evaluation object into deriveDashboardState with Cottbus farm,
  // deriveDashboardState MUST mark it outdated and NEVER show it as verified!
  const cottbusSim = simulateCrops(cottbusFarm, null, 'baseline');
  const derivedEn = deriveDashboardState(
    cottbusFarm,
    cottbusSim,
    null,
    stuttgartEval,
    'en',
    {
      conditionsChangedSinceLastEvaluation:
        afterCottbusSwitch.conditionsChangedSinceLastEvaluation,
    }
  );
  assert.equal(derivedEn.isEvaluationOutdated, true);
  assert.equal(derivedEn.hasVerifiedRecommendation, false);
  assert.equal(derivedEn.hasAgenticRun, false);
  assert.equal(
    derivedEn.staleBannerMessage,
    'Farm conditions changed — new analysis required'
  );
  assert.equal(
    derivedEn.verificationLabel,
    'Farm conditions changed — new analysis required'
  );
  assert.equal(derivedEn.activeHeadline.includes('Stuttgart'), false);
});

test('12. REGRESSION 2: An old in-flight API response cannot overwrite newer farm state', async () => {
  const stuttgartPreset = GERMAN_CITY_PRESETS.find(
    (c) => c.id === 'stuttgart'
  )!;
  const cottbusPreset = GERMAN_CITY_PRESETS.find((c) => c.id === 'cottbus')!;

  const stuttgartFarm: FarmProfile = {
    ...DEFAULT_SAMPLE_FARM,
    locationName: `${stuttgartPreset.cityEn}, ${stuttgartPreset.state}, Germany`,
    latitude: stuttgartPreset.latitude,
    longitude: stuttgartPreset.longitude,
    soilType: stuttgartPreset.typicalSoil,
  };
  const cottbusFarm: FarmProfile = {
    ...DEFAULT_SAMPLE_FARM,
    locationName: `${cottbusPreset.cityEn}, ${cottbusPreset.state}, Germany`,
    latitude: cottbusPreset.latitude,
    longitude: cottbusPreset.longitude,
    soilType: cottbusPreset.typicalSoil,
  };

  const mockFetch: typeof fetch = async () =>
    new Response(JSON.stringify(MOCK_DWD_KARLSRUHE_RAW), { status: 200 });

  const fastStubAdapter: AgentProviderAdapter = {
    async runOrchestratorWorkflow({ scenarioId, executeSimulationTool }) {
      executeSimulationTool(scenarioId);
      return { summary: 'Stub summary.', toolInvoked: true };
    },
    async runDecisionAgent({ farm, simulation }) {
      const top = simulation.topFeasibleCropId ?? 'barley';
      return {
        decision: {
          recommendedCropId: top,
          decisionStatus: 'recommended',
          headline: `Decision for ${farm.locationName}`,
          executiveSummary: `Summary for ${farm.locationName}`,
          tradeoffAnalysis: {
            financial: 'OK',
            climateAndEnvironmental: '7-day forecast horizon noted.',
            waterAndSoilResources: 'OK',
          },
          alternativeComparisons: simulation.cropResults
            .filter((c) => c.cropId !== top)
            .map((c) => ({ cropId: c.cropId, comparisonSummary: 'Compared.' })),
          keyAssumptions: ['Illustrative EUR costs.'],
          missingInformation: ['Soil Nmin test.'],
          actionableNextSteps: ['Consult advisor.'],
          humanReviewNotice: 'Consult Landwirtschaftskammer advisor.',
        },
      };
    },
    async runCriticAgent() {
      return {
        verdict: 'pass',
        hardConstraintsSatisfied: true,
        alternativesComparedFairly: true,
        forecastUncertaintyCommunicated: true,
        numericalClaimsSupported: true,
        assumptionsConsistent: true,
        moreRobustAlternativeId: 'none',
        objections: [],
        requestedRecalculation: {
          needed: false,
          targetScenarioId: 'none',
          reason: 'OK',
        },
        criticSummary: 'Verified.',
      };
    },
  };

  // 1. Start evaluation request #1 for Stuttgart
  let state = createInitialEvaluationTracker(stuttgartFarm, 'baseline');
  const { nextState: stateReq1, request: reqStuttgart } =
    beginEvaluationRequest(state, stuttgartFarm, 'baseline', 'en');
  state = stateReq1;

  // 2. User switches inputs to Cottbus BEFORE Stuttgart API finishes!
  state = invalidateEvaluationOnInputChange(state, cottbusFarm, 'baseline');
  assert.equal(state.inFlightRequest, null);
  assert.equal(state.conditionsChangedSinceLastEvaluation, true);

  // 3. Delayed Stuttgart response arrives now -> MUST be rejected for active state!
  const delayedStuttgartPayload = await executeAgenticPipeline({
    farm: stuttgartFarm,
    scenarioId: 'baseline',
    evaluationId: reqStuttgart.evaluationId,
    adapter: fastStubAdapter,
    fetchImpl: mockFetch,
  });

  const staleArrival = receiveEvaluationResponse(
    state,
    reqStuttgart,
    delayedStuttgartPayload
  );
  assert.equal(staleArrival.acceptedAsActive, false);
  assert.equal(staleArrival.ignoredReason, 'inputs_changed');
  assert.equal(staleArrival.nextState.activeEvaluation, null);
  assert.equal(
    staleArrival.nextState.conditionsChangedSinceLastEvaluation,
    true
  );
  assert.equal(staleArrival.nextState.historicalEvaluations.length, 1);

  // 4. Now Cottbus runs its own evaluation -> accepted cleanly as active!
  const { nextState: stateReq2, request: reqCottbus } = beginEvaluationRequest(
    staleArrival.nextState,
    cottbusFarm,
    'baseline',
    'en'
  );
  const cottbusPayload = await executeAgenticPipeline({
    farm: cottbusFarm,
    scenarioId: 'baseline',
    evaluationId: reqCottbus.evaluationId,
    adapter: fastStubAdapter,
    fetchImpl: mockFetch,
  });
  const cottbusArrival = receiveEvaluationResponse(
    stateReq2,
    reqCottbus,
    cottbusPayload
  );
  assert.equal(cottbusArrival.acceptedAsActive, true);
  assert.equal(
    cottbusArrival.nextState.conditionsChangedSinceLastEvaluation,
    false
  );
  assert.ok(
    cottbusArrival.nextState.activeEvaluation?.inputSnapshot.farm.locationName.includes(
      'Cottbus'
    )
  );
});

test('13. REGRESSION 3: Drought with zero feasible crops produces no verified recommendation, no hard-constraints-satisfied claim, and exact deterministic remediations', async () => {
  const weather = parseOpenMeteoForecast(MOCK_DWD_KARLSRUHE_RAW, 'Karlsruhe');
  const zeroFeasibleFarm: FarmProfile = {
    ...DEFAULT_SAMPLE_FARM,
    plantingMonth: 4, // April -> Winter Wheat out of season
    availableWaterValue: 0, // 0 m³ -> Barley, Maize, Potato all fail supplemental irrigation under drought!
  };

  const sim = simulateCrops(zeroFeasibleFarm, weather, 'drought');
  assert.equal(sim.feasibleCropsCount, 0);
  assert.equal(sim.topFeasibleCropId, null);
  assert.ok(sim.cropResults.every((c) => c.feasibilityStatus === 'infeasible'));

  // Verify every crop's exclusion constraint and deterministic remediation
  const wwRem = sim.constraintRemediation.find(
    (r) => r.cropId === 'winter_wheat'
  )!;
  const barleyRem = sim.constraintRemediation.find(
    (r) => r.cropId === 'barley'
  )!;
  const maizeRem = sim.constraintRemediation.find((r) => r.cropId === 'maize')!;
  const potatoRem = sim.constraintRemediation.find(
    (r) => r.cropId === 'potato'
  )!;

  assert.equal(wwRem.currentlyFeasible, false);
  assert.ok(wwRem.excludedBy.includes('planting_window'));
  assert.ok(wwRem.requiredValidMonthsLabel !== null);

  for (const springRem of [barleyRem, maizeRem, potatoRem]) {
    assert.equal(springRem.currentlyFeasible, false);
    assert.ok(springRem.excludedBy.includes('irrigation_water'));
    assert.ok(springRem.additionalWaterNeededM3 > 0);
  }

  // Verify dashboard derived state never calls any crop feasible or verified
  const derived = deriveDashboardState(
    zeroFeasibleFarm,
    sim,
    weather,
    null,
    'en'
  );
  assert.equal(derived.recommendedCrop, null);
  assert.equal(derived.hasVerifiedRecommendation, false);
  assert.equal(
    derived.activeHeadline,
    'No feasible crop under current constraints'
  );
  assert.equal(
    derived.verificationLabel.toLowerCase().includes('satisfied'),
    false
  );
  assert.equal(
    derived.verificationLabel.toLowerCase().includes('verified'),
    false
  );

  // Verify full pipeline abstention sets hardConstraintsSatisfied=false and hasVerifiedRecommendation=false
  const mockFetch: typeof fetch = async () =>
    new Response(JSON.stringify(MOCK_DWD_KARLSRUHE_RAW), { status: 200 });

  const abstainingAdapter: AgentProviderAdapter = {
    async runOrchestratorWorkflow({ scenarioId, executeSimulationTool }) {
      executeSimulationTool(scenarioId);
      return { summary: '0/4 feasible under drought.', toolInvoked: true };
    },
    async runDecisionAgent({ simulation }) {
      return {
        decision: {
          recommendedCropId: 'none',
          decisionStatus: 'no_feasible_crop',
          headline: 'No feasible crop under current constraints',
          executiveSummary:
            'All four candidate crops violate at least one hard constraint (April sowing window or 0 m³ irrigation water under drought).',
          tradeoffAnalysis: {
            financial: 'No crop is feasible; direct costs were checked.',
            climateAndEnvironmental:
              '7-day DWD forecast is distinct from hypothetical drought stress.',
            waterAndSoilResources:
              '0 m³ supplemental irrigation cannot cover drought water deficits.',
          },
          alternativeComparisons: simulation.cropResults.map((c) => ({
            cropId: c.cropId,
            comparisonSummary: c.infeasibilityReasons.join(' '),
          })),
          keyAssumptions: ['Hypothetical drought scenario multipliers.'],
          missingInformation: ['On-farm irrigation well capacity.'],
          actionableNextSteps: simulation.constraintRemediation.map(
            (r) => r.deterministicAdjustmentHint.en
          ),
          humanReviewNotice:
            'Consult Offizialberatung / Landwirtschaftskammer before changing farm plan.',
        },
      };
    },
    async runCriticAgent() {
      return {
        verdict: 'review',
        hardConstraintsSatisfied: true, // Even if LLM mistakenly returned true, pipeline MUST clamp it to false!
        alternativesComparedFairly: true,
        forecastUncertaintyCommunicated: true,
        numericalClaimsSupported: true,
        assumptionsConsistent: true,
        moreRobustAlternativeId: 'none',
        objections: [],
        requestedRecalculation: {
          needed: false,
          targetScenarioId: 'none',
          reason: 'Honest abstention.',
        },
        criticSummary: 'Confirmed zero crops pass hard constraints.',
      };
    },
  };

  const evalZero = await executeAgenticPipeline({
    farm: zeroFeasibleFarm,
    scenarioId: 'drought',
    adapter: abstainingAdapter,
    fetchImpl: mockFetch,
  });

  assert.equal(evalZero.decision?.recommendedCropId, 'none');
  assert.equal(evalZero.critic?.hardConstraintsSatisfied, false);
  assert.equal(evalZero.validationGate?.hasVerifiedRecommendation, false);
  assert.equal(
    evalZero.validationGate?.outcomeStatus,
    'valid_abstention_no_feasible_crop'
  );
  assert.equal(evalZero.requiresHumanReview, true);

  const derivedWithEval = deriveDashboardState(
    zeroFeasibleFarm,
    evalZero.simulation,
    evalZero.weather,
    evalZero,
    'en'
  );
  assert.equal(derivedWithEval.recommendedCrop, null);
  assert.equal(derivedWithEval.hasVerifiedRecommendation, false);
  assert.equal(
    derivedWithEval.activeHeadline,
    'No feasible crop under current constraints'
  );

  // Also verify that forcing a crop recommendation when 0 crops are feasible is strictly REJECTED by deterministic gate
  const forcedGate = runDeterministicValidationGate(
    {
      ...evalZero.decision!,
      recommendedCropId: 'barley',
      decisionStatus: 'recommended',
    },
    evalZero.critic!,
    evalZero.simulation,
    evalZero.weather
  );
  assert.equal(forcedGate.passed, false);
  assert.equal(forcedGate.hasVerifiedRecommendation, false);
});

test('14. REGRESSION 4: April planning does NOT consume an unrelated November 7-day forecast as seasonal rainfall or sowing frost, and validation gate flags off-season weather misuse', () => {
  const novStormyFrostyRaw: OpenMeteoRawResponse = {
    latitude: 49.01,
    longitude: 8.4,
    elevation: 118,
    timezone: 'Europe/Berlin',
    daily: {
      time: [
        '2026-11-14',
        '2026-11-15',
        '2026-11-16',
        '2026-11-17',
        '2026-11-18',
        '2026-11-19',
        '2026-11-20',
      ],
      temperature_2m_max: [6.0, 5.2, 4.1, 3.8, 5.0, 6.4, 7.1],
      temperature_2m_min: [-3.2, -4.5, -2.8, -1.9, 0.5, 1.2, 0.8],
      precipitation_sum: [14.0, 28.0, 12.0, 6.0, 4.0, 2.0, 2.0], // 68 mm Nov rain!
      et0_fao_evapotranspiration: [0.6, 0.5, 0.4, 0.5, 0.6, 0.7, 0.7],
    },
  };

  const novDryMildRaw: OpenMeteoRawResponse = {
    ...novStormyFrostyRaw,
    daily: {
      ...novStormyFrostyRaw.daily,
      temperature_2m_max: [14.0, 14.5, 15.0, 14.2, 13.8, 14.1, 14.4],
      temperature_2m_min: [8.5, 9.0, 9.2, 8.8, 8.4, 8.9, 9.1],
      precipitation_sum: [0, 0, 0, 0, 0, 0, 0], // 0 mm Nov rain!
    },
  };

  const novStormyWeather = parseOpenMeteoForecast(
    novStormyFrostyRaw,
    'Karlsruhe'
  );
  const novDryMildWeather = parseOpenMeteoForecast(
    novDryMildRaw,
    'Karlsruhe'
  );

  // Verify applicability classification for April planting (month 4) vs November forecast (month 11)
  const applicability = assessWeatherApplicability(novStormyWeather, 4);
  assert.equal(applicability.status, 'current_field_weather_only');
  assert.equal(applicability.isApplicableToPlantingWindow, false);
  assert.equal(applicability.usedInSeasonalWaterBalance, false);
  assert.equal(applicability.usedInNearTermSowingRisk, false);
  assert.equal(applicability.forecastStartDate, '2026-11-14');
  assert.equal(applicability.forecastEndDate, '2026-11-20');

  const aprilSimWithStormyNov = simulateCrops(
    DEFAULT_SAMPLE_FARM,
    novStormyWeather,
    'baseline'
  );
  const aprilSimWithDryNov = simulateCrops(
    DEFAULT_SAMPLE_FARM,
    novDryMildWeather,
    'baseline'
  );

  for (const crop of aprilSimWithStormyNov.cropResults) {
    // Zero short-term rain credited into seasonal water balance
    assert.equal(crop.waterEvaluation.nearTermSeedbedPrecipCreditMmHa, 0);

    const peer = aprilSimWithDryNov.cropResults.find(
      (c) => c.cropId === crop.cropId
    )!;
    assert.equal(
      crop.waterEvaluation.additionalIrrigationRequiredM3,
      peer.waterEvaluation.additionalIrrigationRequiredM3
    );
    assert.equal(
      crop.riskProfile.frostRiskScore,
      peer.riskProfile.frostRiskScore
    );
    assert.equal(
      crop.financialEvaluation.totalFarmYieldTons.expected,
      peer.financialEvaluation.totalFarmYieldTons.expected
    );
    assert.equal(
      crop.scores.weightedSuitability,
      peer.scores.weightedSuitability
    );
  }

  // Deterministic validation gate MUST flag off-season weather misuse if Decision credits November rain to April seasonal water
  const badDecision: DecisionAgentOutput = {
    recommendedCropId: aprilSimWithStormyNov.topFeasibleCropId!,
    decisionStatus: 'recommended',
    headline: 'Recommended crop for April',
    executiveSummary:
      'The 7-day forecast rain reduces seasonal irrigation requirement for April planting.',
    tradeoffAnalysis: {
      financial: 'Within budget.',
      climateAndEnvironmental:
        'Forecast precipitation credited to seasonal water balance.',
      waterAndSoilResources: 'Adequate water.',
    },
    alternativeComparisons: aprilSimWithStormyNov.cropResults
      .filter((c) => c.cropId !== aprilSimWithStormyNov.topFeasibleCropId)
      .map((c) => ({ cropId: c.cropId, comparisonSummary: 'Compared.' })),
    keyAssumptions: ['Illustrative EUR costs.'],
    missingInformation: ['Soil Nmin test.'],
    actionableNextSteps: ['Consult advisor.'],
    humanReviewNotice: 'Consult Landwirtschaftskammer advisor.',
  };

  const lenientCritic: CriticAgentOutput = {
    verdict: 'pass',
    hardConstraintsSatisfied: true,
    alternativesComparedFairly: true,
    forecastUncertaintyCommunicated: true,
    numericalClaimsSupported: true,
    assumptionsConsistent: true,
    moreRobustAlternativeId: 'none',
    objections: [],
    requestedRecalculation: {
      needed: false,
      targetScenarioId: 'none',
      reason: 'None',
    },
    criticSummary: 'Passed.',
  };

  const gateResult = runDeterministicValidationGate(
    badDecision,
    lenientCritic,
    aprilSimWithStormyNov,
    novStormyWeather
  );
  const weatherCheck = gateResult.checks.find(
    (chk) => chk.code === 'WEATHER_SEASONAL_APPLICABILITY'
  )!;
  assert.equal(weatherCheck.passed, false);
  assert.equal(gateResult.passed, false);
});

test('15. REGRESSION 5: Priority weights normalize to 1.0, keep all components in [0, 100], increase Potato under Maximum Potential Profit without lowering all crops, and never override hard constraints', () => {
  // 1. Unit test weight normalization directly
  for (const preset of Object.values(PRIORITY_WEIGHT_PRESETS)) {
    const norm = normalizePreferenceWeights(preset);
    const sum =
      norm.profit +
      norm.climateResilience +
      norm.waterEfficiency +
      norm.soilMatch;
    assert.ok(Math.abs(sum - 1) <= 1e-6, `Normalized sum ${sum} !== 1`);
  }
  const arbitraryNorm = normalizePreferenceWeights({
    profit: 0.9,
    climateResilience: 0.3,
    waterEfficiency: 0.2,
    soilMatch: 0.1,
  });
  assert.ok(
    Math.abs(
      arbitraryNorm.profit +
        arbitraryNorm.climateResilience +
        arbitraryNorm.waterEfficiency +
        arbitraryNorm.soilMatch -
        1
    ) <= 1e-6
  );

  // 2. Unit test pure component & total suitability helpers directly
  const pPotato = computeProfitPotentialScore(7400, 235);
  const pBarley = computeProfitPotentialScore(690, 97);
  const pLoss = computeProfitPotentialScore(-300, -25);
  assert.ok(pPotato > pBarley && pPotato <= 100);
  assert.ok(pBarley >= 60 && pBarley <= 85);
  assert.ok(pLoss >= 0 && pLoss < 35);

  const wBarley = computeWaterEfficiencyScore(0, 160);
  const wPotato = computeWaterEfficiencyScore(109, 51);
  assert.ok(wBarley > wPotato && wBarley <= 100 && wPotato >= 0);

  const exactWeighted = computeWeightedSuitabilityScore(
    {
      soilCompatibility: 90,
      climateResilience: 80,
      waterEfficiency: 70,
      profitPotential: 95,
    },
    PRIORITY_WEIGHT_PRESETS.max_profit
  );
  const expectedConvex =
    Math.round((95 * 0.55 + 80 * 0.15 + 70 * 0.15 + 90 * 0.15) * 10) / 10;
  assert.equal(exactWeighted, expectedConvex);

  // 3. End-to-end priority mode behavior on Karlsruhe April farm
  const karlsruheWeather = parseOpenMeteoForecast(
    MOCK_DWD_KARLSRUHE_RAW,
    'Karlsruhe'
  );
  const simBalanced = simulateCrops(
    { ...DEFAULT_SAMPLE_FARM, priorityMode: 'balanced' },
    karlsruheWeather,
    'baseline'
  );
  const simMaxProfit = simulateCrops(
    { ...DEFAULT_SAMPLE_FARM, priorityMode: 'max_profit' },
    karlsruheWeather,
    'baseline'
  );
  const simMinWater = simulateCrops(
    { ...DEFAULT_SAMPLE_FARM, priorityMode: 'min_water' },
    karlsruheWeather,
    'baseline'
  );
  const simMinRisk = simulateCrops(
    { ...DEFAULT_SAMPLE_FARM, priorityMode: 'min_climate_risk' },
    karlsruheWeather,
    'baseline'
  );

  for (const run of [simBalanced, simMaxProfit, simMinWater, simMinRisk]) {
    for (const c of run.cropResults) {
      assert.equal(c.scores.preferredCropBonus, 0);
      assert.ok(c.scores.soilCompatibility >= 0 && c.scores.soilCompatibility <= 100);
      assert.ok(c.scores.climateResilience >= 0 && c.scores.climateResilience <= 100);
      assert.ok(c.scores.waterEfficiency >= 0 && c.scores.waterEfficiency <= 100);
      assert.ok(c.scores.profitPotential >= 0 && c.scores.profitPotential <= 100);
      assert.ok(
        c.scores.weightedSuitability >= 0 && c.scores.weightedSuitability <= 100
      );

      const recomputed =
        c.scores.profitPotential * run.weightsNormalized.profit +
        c.scores.climateResilience * run.weightsNormalized.climateResilience +
        c.scores.waterEfficiency * run.weightsNormalized.waterEfficiency +
        c.scores.soilCompatibility * run.weightsNormalized.soilMatch;
      assert.ok(
        Math.abs(c.scores.weightedSuitability - recomputed) <= 0.15,
        `Suitability ${c.scores.weightedSuitability} deviates from convex sum ${recomputed}`
      );
    }
  }

  // Maximum Potential Profit MUST increase Potato's suitability compared to Balanced and rank Potato #1!
  const potatoBal = simBalanced.cropResults.find(
    (c) => c.cropId === 'potato'
  )!;
  const potatoMaxP = simMaxProfit.cropResults.find(
    (c) => c.cropId === 'potato'
  )!;
  assert.ok(
    potatoMaxP.scores.weightedSuitability >
      potatoBal.scores.weightedSuitability,
    `Expected Potato max_profit score (${potatoMaxP.scores.weightedSuitability}) > balanced (${potatoBal.scores.weightedSuitability})`
  );
  assert.equal(simMaxProfit.topFeasibleCropId, 'potato');

  // Minimum Water Usage and Minimum Climate Risk rank Barley #1!
  const barleyBal = simBalanced.cropResults.find(
    (c) => c.cropId === 'barley'
  )!;
  const barleyMinW = simMinWater.cropResults.find(
    (c) => c.cropId === 'barley'
  )!;
  assert.ok(
    barleyMinW.scores.weightedSuitability >
      barleyBal.scores.weightedSuitability
  );
  assert.equal(simMinWater.topFeasibleCropId, 'barley');
  assert.equal(simMinRisk.topFeasibleCropId, 'barley');

  // Hard constraints stay strictly independent of soft scores: Potato infeasible under €12,000 budget even with max_profit!
  const constrainedMaxProfit = simulateCrops(
    { ...DEFAULT_SAMPLE_FARM, priorityMode: 'max_profit', budgetAmount: 12000 },
    karlsruheWeather,
    'baseline'
  );
  const constrainedPotato = constrainedMaxProfit.cropResults.find(
    (c) => c.cropId === 'potato'
  )!;
  assert.equal(constrainedPotato.feasibilityStatus, 'infeasible');
  assert.equal(constrainedMaxProfit.topFeasibleCropId, 'barley');
});

test('16. REGRESSION 6: Existing baseline Karlsruhe farm water-balance and financial calculations remain internally consistent', () => {
  const karlsruheWeather = parseOpenMeteoForecast(
    MOCK_DWD_KARLSRUHE_RAW,
    'Karlsruhe'
  );
  const sim = simulateCrops(DEFAULT_SAMPLE_FARM, karlsruheWeather, 'baseline');

  // 19,200 m³ across 12 ha = 160 mm/ha (1 mm/ha = 10 m³/ha)
  assert.equal(sim.farmSummary.areaHa, 12);
  assert.equal(sim.farmSummary.availableIrrigationTotalM3, 19200);
  assert.equal(sim.farmSummary.availableIrrigationMmHa, 160);
  assert.equal(sim.farmSummary.budgetInSelectedCurrency, 42000);
  assert.equal(sim.feasibleCropsCount, 3); // Potato, Barley, Maize in April; Winter Wheat out of season

  for (const crop of sim.cropResults) {
    const w = crop.waterEvaluation;
    const f = crop.financialEvaluation;

    // Water balance identities
    const expectedAddMm = Math.max(
      0,
      Math.round(
        (w.scenarioTotalCropDemandMmHa - w.estimatedEffectiveSeasonRainMmHa) *
          10
      ) / 10
    );
    assert.ok(Math.abs(w.additionalIrrigationRequiredMmHa - expectedAddMm) <= 0.11);
    assert.equal(
      w.additionalIrrigationRequiredM3,
      Math.round(w.additionalIrrigationRequiredMmHa * 10 * sim.farmSummary.areaHa)
    );
    assert.equal(
      w.irrigationSurplusOrDeficitM3,
      w.availableIrrigationTotalM3 - w.additionalIrrigationRequiredM3
    );

    // Financial identities
    assert.equal(
      f.totalFarmInputCost,
      Math.round(f.inputCostPerHa * sim.farmSummary.areaHa)
    );
    assert.equal(
      f.budgetSurplusOrDeficit,
      Math.round(f.availableFarmBudget - f.totalFarmInputCost)
    );
    assert.equal(
      f.netProfitRange.expected,
      f.grossRevenueRange.expected - f.totalFarmInputCost
    );
    assert.ok(f.netProfitRange.low <= f.netProfitRange.expected);
    assert.ok(f.netProfitRange.expected <= f.netProfitRange.high);
  }
});
