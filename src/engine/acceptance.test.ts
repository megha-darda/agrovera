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
  CROP_DATABASE,
  DEFAULT_SAMPLE_FARM,
  DEFAULT_WEATHER_THRESHOLDS,
  GERMAN_CITY_PRESETS,
  PRIORITY_WEIGHT_PRESETS,
} from './presets.ts';
import { simulateCrops, validateFarmProfile } from './simulator.ts';
import { runDeterministicValidationGate } from './validationGate.ts';
import {
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
