import {
  type FunctionDeclaration,
  GoogleGenAI,
  ThinkingLevel,
  Type,
} from '@google/genai';
import { CROP_DATABASE } from '../src/engine/presets.ts';
import { simulateCrops } from '../src/engine/simulator.ts';
import { runDeterministicValidationGate } from '../src/engine/validationGate.ts';
import { fetchOpenMeteoWeather } from '../src/engine/weather.ts';
import type {
  AgentTimelineEvent,
  AgenticEvaluationResponse,
  AppLanguage,
  BaselineReferenceContext,
  ClimateScenarioId,
  CriticAgentOutput,
  CropId,
  DecisionAgentOutput,
  FarmProfile,
  ReviewCycleRecord,
  ScenarioParametersOverride,
  SimulationRunOutput,
  WeatherForecastAnalysis,
  WeatherThresholds,
} from '../src/types/domain.ts';

export type { BaselineReferenceContext };

export const MODEL_ORCHESTRATOR = 'gemini-4-hydrogen';
export const MODEL_DECISION_AGENT = 'gemini-4-carbon';
export const MODEL_CRITIC_AGENT = 'gemini-4-carbon';
export const MAX_REVIEW_CYCLES = 2;

export interface AgentProviderAdapter {
  runOrchestratorWorkflow: (params: {
    farm: FarmProfile;
    scenarioId: ClimateScenarioId;
    weather: WeatherForecastAnalysis;
    language: AppLanguage;
    executeSimulationTool: (
      targetScenario: ClimateScenarioId
    ) => SimulationRunOutput;
  }) => Promise<{ summary: string; toolInvoked: boolean }>;

  runDecisionAgent: (params: {
    farm: FarmProfile;
    scenarioId: ClimateScenarioId;
    weather: WeatherForecastAnalysis;
    simulation: SimulationRunOutput;
    orchestratorSummary: string;
    language: AppLanguage;
    cycle: number;
    priorFeedback?: {
      critic: CriticAgentOutput;
      validationFailures: string[];
      recalculatedStressSummary?: string;
    };
    baselineComparison?: BaselineReferenceContext;
  }) => Promise<{
    decision: DecisionAgentOutput;
    scenarioShiftExplanation?: string;
  }>;

  runCriticAgent: (params: {
    farm: FarmProfile;
    scenarioId: ClimateScenarioId;
    weather: WeatherForecastAnalysis;
    simulation: SimulationRunOutput;
    decision: DecisionAgentOutput;
    language: AppLanguage;
    cycle: number;
  }) => Promise<CriticAgentOutput>;
}

function createSharedGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim() === '') {
    throw new Error(
      'GEMINI_API_KEY is missing on the server. Configure a valid Gemini API key in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function localizedCropLabel(id: CropId | 'none', lang: AppLanguage): string {
  if (id === 'none') {
    return lang === 'de' ? 'KEINE KULTUR' : 'NONE';
  }
  const map: Record<CropId, { en: string; de: string }> = {
    winter_wheat: { en: 'Winter Wheat', de: 'Winterweizen' },
    barley: { en: 'Barley', de: 'Gerste' },
    maize: { en: 'Maize', de: 'Mais' },
    potato: { en: 'Potato', de: 'Kartoffel' },
  };
  return map[id]?.[lang] ?? id;
}

const simulateToolDeclaration: FunctionDeclaration = {
  name: 'run_crop_simulation',
  description:
    'Executes the deterministic TypeScript crop simulation engine for German crops (winter_wheat, barley, maize, potato) under a specified climate scenario.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      scenarioId: {
        type: Type.STRING,
        description:
          'Climate scenario identifier: baseline, drought, heatwave, heavy_rainfall, or frost.',
      },
    },
    required: ['scenarioId'],
  },
};

const decisionResponseSchema = {
  type: Type.OBJECT,
  properties: {
    recommendedCropId: {
      type: Type.STRING,
      description:
        "Canonical crop identifier ONLY (never translate this ID): must be one of 'winter_wheat', 'barley', 'maize', 'potato', or 'none' if zero crops satisfy hard constraints.",
    },
    decisionStatus: {
      type: Type.STRING,
      description:
        "Canonical status ONLY: one of 'recommended', 'no_feasible_crop', or 'uncertain_needs_data'.",
    },
    headline: {
      type: Type.STRING,
      description:
        'Concise 1-sentence agronomic recommendation headline written in the requested output language.',
    },
    executiveSummary: {
      type: Type.STRING,
      description:
        'Clear 2-3 sentence rationale grounded strictly in the deterministic simulation numbers and DWD/Open-Meteo forecast indicators, written in the requested output language.',
    },
    tradeoffAnalysis: {
      type: Type.OBJECT,
      properties: {
        financial: {
          type: Type.STRING,
          description:
            'Direct input cost (EUR) vs budget utilization, Destatis yield reference, and illustrative net margin comparison.',
        },
        climateAndEnvironmental: {
          type: Type.STRING,
          description:
            'Near-term DWD ICON / Open-Meteo forecast indicators vs seasonal German climate scenario sensitivity.',
        },
        waterAndSoilResources: {
          type: Type.STRING,
          description:
            'Total crop water demand (mm/ha) vs supplemental irrigation requirement (m³) and soil/sowing-window fit.',
        },
      },
      required: [
        'financial',
        'climateAndEnvironmental',
        'waterAndSoilResources',
      ],
    },
    alternativeComparisons: {
      type: Type.ARRAY,
      description:
        'Explicit trade-off explanations for each non-selected candidate crop (all 3 non-selected crops when 1 is recommended, or all 4 when none is feasible).',
      items: {
        type: Type.OBJECT,
        properties: {
          cropId: {
            type: Type.STRING,
            description:
              "Canonical crop ID ONLY (never translate): 'winter_wheat', 'barley', 'maize', or 'potato'.",
          },
          comparisonSummary: {
            type: Type.STRING,
            description:
              'Why this candidate ranked differently or failed a hard constraint (sowing window, irrigation m³, or EUR budget), in the requested language.',
          },
        },
        required: ['cropId', 'comparisonSummary'],
      },
    },
    keyAssumptions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        'Explicit list of assumptions (Destatis national yield benchmark vs illustrative EUR/ha direct costs, EUR/t prices, and seasonal rainfall beyond the 7-14 day forecast).',
    },
    missingInformation: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        'Important local farm data not provided (e.g., lab Nmin/NPK/pH soil test, cultivar maturity group, irrigation water right permit, local buyer contract).',
    },
    actionableNextSteps: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        '3-4 safe, practical agronomic verification steps without recommending unverified chemical or pesticide treatments.',
    },
    humanReviewNotice: {
      type: Type.STRING,
      description:
        'Mandatory statement advising human agricultural advisory review (e.g., Offizialberatung / Landwirtschaftskammer) before seed purchase or sowing decisions.',
    },
    scenarioShiftExplanation: {
      type: Type.STRING,
      description:
        'If baselineComparison was supplied, explain how and why the recommendation changed or why it remained stable under the modified German climate/resource constraints.',
    },
  },
  required: [
    'recommendedCropId',
    'decisionStatus',
    'headline',
    'executiveSummary',
    'tradeoffAnalysis',
    'alternativeComparisons',
    'keyAssumptions',
    'missingInformation',
    'actionableNextSteps',
    'humanReviewNotice',
  ],
};

const criticResponseSchema = {
  type: Type.OBJECT,
  properties: {
    verdict: {
      type: Type.STRING,
      description:
        "Canonical audit outcome ONLY: 'pass' if sound and well-supported, 'review' if valid but carries thin margins or notable uncertainty, 'reject' if infeasible, out-of-season, unsupported numerically, or unfair.",
    },
    hardConstraintsSatisfied: {
      type: Type.BOOLEAN,
      description:
        'True ONLY if the recommended crop satisfies seasonal sowing window, supplemental irrigation (m³), and EUR budget hard constraints in the deterministic simulation (or recommendedCropId is none when 0 crops are feasible).',
    },
    alternativesComparedFairly: {
      type: Type.BOOLEAN,
      description:
        'True if all alternative candidate crops were accurately and fairly evaluated.',
    },
    forecastUncertaintyCommunicated: {
      type: Type.BOOLEAN,
      description:
        'True if the Decision Agent clearly distinguished the short-term DWD/Open-Meteo forecast (7-14 days) from full-season climate uncertainty.',
    },
    numericalClaimsSupported: {
      type: Type.BOOLEAN,
      description:
        'True if numerical figures match the deterministic simulation output without fabrication.',
    },
    assumptionsConsistent: {
      type: Type.BOOLEAN,
      description:
        'True if water, budget, Destatis yield reference, and illustrative economic assumptions are internally consistent.',
    },
    moreRobustAlternativeId: {
      type: Type.STRING,
      description:
        "Canonical ID ONLY: if another feasible crop is substantially more resilient under climate stress, provide its id ('winter_wheat' | 'barley' | 'maize' | 'potato'), otherwise 'none'.",
    },
    objections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          severity: {
            type: Type.STRING,
            description: "Canonical severity ONLY: 'critical', 'warning', or 'note'.",
          },
          category: {
            type: Type.STRING,
            description:
              "Canonical category ONLY: 'hard_constraint', 'fair_comparison', 'forecast_uncertainty', 'unsupported_numbers', 'assumption_consistency', 'missing_information', or 'climate_robustness'.",
          },
          detail: {
            type: Type.STRING,
            description:
              'Specific audit finding grounded in the data, written in the requested output language.',
          },
        },
        required: ['severity', 'category', 'detail'],
      },
    },
    requestedRecalculation: {
      type: Type.OBJECT,
      properties: {
        needed: {
          type: Type.BOOLEAN,
          description:
            'True ONLY if a scenario stress recalculation is required to resolve a critical objection.',
        },
        targetScenarioId: {
          type: Type.STRING,
          description:
            "Canonical ID ONLY: 'drought', 'heatwave', 'heavy_rainfall', 'frost', 'baseline', or 'none'.",
        },
        reason: {
          type: Type.STRING,
          description:
            'Reason for requesting or not requesting recalculation, written in the requested output language.',
        },
      },
      required: ['needed', 'targetScenarioId', 'reason'],
    },
    criticSummary: {
      type: Type.STRING,
      description:
        'Concise 2-3 sentence independent audit summary written in the requested output language.',
    },
  },
  required: [
    'verdict',
    'hardConstraintsSatisfied',
    'alternativesComparedFairly',
    'forecastUncertaintyCommunicated',
    'numericalClaimsSupported',
    'assumptionsConsistent',
    'moreRobustAlternativeId',
    'objections',
    'requestedRecalculation',
    'criticSummary',
  ],
};

export function createRealGeminiAdapter(): AgentProviderAdapter {
  return {
    async runOrchestratorWorkflow({
      farm,
      scenarioId,
      weather,
      language,
      executeSimulationTool,
    }) {
      const ai = createSharedGenAIClient();
      const langRule =
        language === 'de'
          ? 'Write your 2-sentence operational summary in fluent, professional German (Deutsch) using proper agricultural terminology (z. B. Winterweizen, Gerste, Mais, Kartoffel, Zusatzbewässerung, Saatfenster, Direktkosten).'
          : 'Write your 2-sentence operational summary in clear, concise English.';

      const prompt = `Orchestrate AgroVera agricultural evaluation for ${farm.locationName} (${farm.areaHa} ha, ${farm.soilType} soil, sowingMonth=${farm.plantingMonth}, water=${farm.availableWaterValue} ${farm.availableWaterUnit}, budget=${farm.currency} ${farm.budgetAmount}, priority=${farm.priorityMode}, activeScenario=${scenarioId}, outputLanguage=${language}).
Weather status: ${weather.status} (${weather.source}). ${
        weather.summary && weather.forecastPeriod
          ? `${weather.forecastPeriod.days}-day peak temp=${weather.summary.peakMaxTempC}°C, min temp=${weather.summary.lowestMinTempC}°C, total precip=${weather.summary.totalPrecipMm}mm.`
          : weather.errorMessage ?? ''
      }
First call run_crop_simulation for scenarioId="${scenarioId}", then summarize the key constraint bindings and risk signals in 2 concise sentences for the Decision Agent. ${langRule}`;

      const turn1 = await ai.models.generateContent({
        model: MODEL_ORCHESTRATOR,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          systemInstruction: `You are the AgroVera Lightweight Orchestrator. Invoke the deterministic simulation tool to gather exact German crop feasibility metrics, then provide a concise factual 2-sentence operational brief without inventing any numbers. ${langRule}`,
          tools: [{ functionDeclarations: [simulateToolDeclaration] }],
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });

      const prevContent = turn1.candidates?.[0]?.content;
      const fnCall = prevContent?.parts?.find(
        (p) => p.functionCall?.name === 'run_crop_simulation'
      )?.functionCall;

      if (prevContent && fnCall) {
        const argScenario =
          (fnCall.args?.scenarioId as ClimateScenarioId) || scenarioId;
        const simOut = executeSimulationTool(argScenario);
        const condensedToolResponse = {
          scenarioId: simOut.scenario.id,
          feasibleCropsCount: simOut.feasibleCropsCount,
          topFeasibleCropId: simOut.topFeasibleCropId,
          candidates: simOut.cropResults.map((c) => ({
            cropId: c.cropId,
            cropNameEn: c.cropNames.en,
            cropNameDe: c.cropNames.de,
            seasonalSuitability: c.seasonalSuitability,
            feasibilityStatus: c.feasibilityStatus,
            weightedSuitability: c.scores.weightedSuitability,
            additionalIrrigationRequiredM3:
              c.waterEvaluation.additionalIrrigationRequiredM3,
            availableIrrigationTotalM3:
              c.waterEvaluation.availableIrrigationTotalM3,
            totalCostEurOrLocal: c.financialEvaluation.totalFarmInputCost,
            budget: c.financialEvaluation.availableFarmBudget,
            overallRiskLevel: c.riskProfile.overallRiskLevel,
          })),
        };

        const turn2 = await ai.models.generateContent({
          model: MODEL_ORCHESTRATOR,
          contents: [
            { role: 'user', parts: [{ text: prompt }] },
            prevContent,
            {
              role: 'user',
              parts: [
                {
                  functionResponse: {
                    id: fnCall.id,
                    name: 'run_crop_simulation',
                    response: condensedToolResponse,
                  },
                },
              ],
            },
          ],
          config: {
            systemInstruction: `Summarize the deterministic simulation outcome and DWD/Open-Meteo weather posture in 2 concise sentences. Never fabricate numbers. ${langRule}`,
            tools: [{ functionDeclarations: [simulateToolDeclaration] }],
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        });

        const fallbackSummary =
          language === 'de'
            ? `Deterministische Simulation prüfte 4 Kulturen im Szenario ${simOut.scenario.names.de}; ${simOut.feasibleCropsCount} Kultur(en) erfüllen Saatfenster, Wasser- und Budgetgrenzen.`
            : `Deterministic simulation evaluated 4 German candidate crops under ${simOut.scenario.names.en}; ${simOut.feasibleCropsCount} candidate(s) satisfied sowing-window, water, and budget constraints.`;

        return {
          summary: (turn2.text ?? '').trim() || fallbackSummary,
          toolInvoked: true,
        };
      }

      const fallbackSim = executeSimulationTool(scenarioId);
      const fallbackSummary =
        language === 'de'
          ? `4 Kulturen unter ${fallbackSim.scenario.names.de} geprüft; ${fallbackSim.feasibleCropsCount} erfüllen die harten Restriktionen.`
          : `Evaluated ${fallbackSim.cropResults.length} crops under ${fallbackSim.scenario.names.en}; ${fallbackSim.feasibleCropsCount} satisfied hard constraints.`;

      return {
        summary: (turn1.text ?? '').trim() || fallbackSummary,
        toolInvoked: false,
      };
    },

    async runDecisionAgent({
      farm,
      scenarioId,
      weather,
      simulation,
      orchestratorSummary,
      language,
      cycle,
      priorFeedback,
      baselineComparison,
    }) {
      const ai = createSharedGenAIClient();

      const languageDirective =
        language === 'de'
          ? `OUTPUT LANGUAGE: GERMAN (Deutsch).
- Write ALL human-readable fields (headline, executiveSummary, tradeoffAnalysis.*, alternativeComparisons[*].comparisonSummary, keyAssumptions, missingInformation, actionableNextSteps, humanReviewNotice, scenarioShiftExplanation) in fluent, idiomatic German suitable for German farmers and agronomists (use terms like Winterweizen, Gerste, Mais, Kartoffel, Saatfenster, Zusatzbewässerung, Direktkosten, Deckungsbeitrag, Offizialberatung / Landwirtschaftskammer).
- Keep JSON property names and canonical enum/ID values UNTRANSLATED: recommendedCropId ('winter_wheat' | 'barley' | 'maize' | 'potato' | 'none'), decisionStatus ('recommended' | 'no_feasible_crop' | 'uncertain_needs_data'), and alternativeComparisons[*].cropId.`
          : `OUTPUT LANGUAGE: ENGLISH.
- Write ALL human-readable fields in clear, professional English suitable for European agricultural decision-makers.
- Keep canonical IDs ('winter_wheat' | 'barley' | 'maize' | 'potato' | 'none') exact.`;

      const systemInstruction = `You are the AgroVera Decision Agent powered by Gemini 4 Carbon.
Your role is to help German and European farmers evaluate climate-resilient crop choices using ONLY verified farm inputs, live DWD ICON / Open-Meteo weather metrics, published Destatis yield references, and exact deterministic simulation outputs.

${languageDirective}

STRICT OPERATING RULES:
1. NEVER invent, round away, or alter numerical simulation outputs, Destatis benchmark yields, supplemental irrigation volumes (m³), total crop demand (mm/ha), EUR costs, or weather measurements.
2. HARD CONSTRAINTS ARE NON-NEGOTIABLE: You MUST NOT recommend any crop whose feasibilityStatus is 'infeasible' (whether due to out-of-season sowing month, insufficient supplemental irrigation m³, or insufficient EUR budget). If feasibleCropsCount === 0, you MUST set recommendedCropId to 'none' and decisionStatus to 'no_feasible_crop' (or 'uncertain_needs_data' if coordinates/inputs are missing).
3. Distinguish clearly between:
   - Verified farmer inputs & published Destatis national yield references,
   - Live short-term DWD ICON / Open-Meteo weather forecast (7–14 days — explicitly note it does NOT predict the full growing season),
   - Hypothetical German climate stress scenarios (${scenarioId}),
   - Illustrative farm-management cost (EUR/ha), farmgate price (EUR/t), and supplemental irrigation estimates.
4. Compare ALL non-selected candidate crops fairly in alternativeComparisons (all 3 remaining crops if 1 is recommended; all 4 if 'none' is recommended).
5. SAFETY: Never guarantee yields, farmgate prices, profits, or weather outcomes. Never recommend unverified chemical or pesticide treatments. Always advise human agronomic consultation (Offizialberatung / Landwirtschaftskammer) before seed purchase or sowing.
6. CONCISENESS: Keep every string field crisp and scannable (1–2 sentences per field, 3 short items for arrays).`;

      const payload = {
        requestedOutputLanguage: language,
        reviewCycle: cycle,
        orchestratorBrief: orchestratorSummary,
        farmerProfile: farm,
        activeScenario: simulation.scenario,
        weatherForecastAnalysis: {
          status: weather.status,
          source: weather.source,
          forecastPeriod: weather.forecastPeriod,
          summary: weather.summary,
          riskIndicators: weather.riskIndicators,
          scopeLimitationNotice: weather.scopeLimitationNotice,
          errorMessage: weather.errorMessage,
        },
        deterministicSimulationOutput: {
          feasibleCropsCount: simulation.feasibleCropsCount,
          topFeasibleCropId: simulation.topFeasibleCropId,
          weightsNormalized: simulation.weightsNormalized,
          illustrativeDisclaimer: simulation.illustrativeDisclaimer,
          cropResults: simulation.cropResults,
        },
        priorCycleCorrectionRequired: priorFeedback ?? null,
        baselineComparisonContext: baselineComparison ?? null,
      };

      const response = await ai.models.generateContent({
        model: MODEL_DECISION_AGENT,
        contents: `Evaluate the following structured German farm, DWD/Open-Meteo climate, and deterministic simulation record and produce your verified AgroVera crop decision JSON:\n${JSON.stringify(payload, null, 2)}`,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: decisionResponseSchema,
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText) as DecisionAgentOutput & {
        scenarioShiftExplanation?: string;
      };

      const { scenarioShiftExplanation, ...decision } = parsed;
      return {
        decision,
        scenarioShiftExplanation,
      };
    },

    async runCriticAgent({
      farm,
      scenarioId,
      weather,
      simulation,
      decision,
      language,
      cycle,
    }) {
      const ai = createSharedGenAIClient();

      const languageDirective =
        language === 'de'
          ? `OUTPUT LANGUAGE: GERMAN (Deutsch). Write criticSummary, objections[*].detail, and requestedRecalculation.reason in clear, professional German. Keep canonical enum/ID fields (verdict, moreRobustAlternativeId, objections[*].severity, objections[*].category, requestedRecalculation.targetScenarioId) in exact English.`
          : `OUTPUT LANGUAGE: ENGLISH. Write criticSummary, objections[*].detail, and requestedRecalculation.reason in clear, concise English.`;

      const systemInstruction = `You are the Independent AgroVera Critic Agent powered by Gemini 4 Carbon.
You operate independently from the Decision Agent and must rigorously audit its proposed recommendation against the ground-truth deterministic German crop simulation and DWD/Open-Meteo weather record.

${languageDirective}

AUDIT CHECKLIST:
1. Does recommendedCropId strictly satisfy German sowing-season suitability, supplemental irrigation (m³), and EUR budget constraints (feasibilityStatus !== 'infeasible')? If Decision recommended an infeasible crop, or failed to return 'none' when feasibleCropsCount === 0, you MUST set verdict = 'reject' and hardConstraintsSatisfied = false.
2. Were all alternative candidate crops compared fairly without ignoring higher-scoring or much safer options?
3. Was short-term (7–14 day DWD/Open-Meteo) forecast horizon vs full-season climate uncertainty explicitly communicated?
4. Are all numerical figures in the Decision Agent's text faithful to the deterministic simulation (no fabricated yields, m³ volumes, EUR costs, or weather numbers)?
5. Are supplemental irrigation (m³), total crop demand (mm/ha), Destatis yield references, and illustrative EUR cost/price assumptions internally consistent?
6. Did the Decision Agent identify missing local farm information (e.g., Nmin/NPK soil lab analysis, variety maturity, water permit)?
7. Is a different feasible crop substantially more robust under German climate stress?

Be objective: do NOT fabricate artificial rejections when the Decision Agent's output is accurate and compliant, and do NOT rubber-stamp genuine constraint violations or unsupported numbers. Keep criticSummary and objection details crisp (1–2 sentences each).`;

      const auditInput = {
        requestedOutputLanguage: language,
        reviewCycle: cycle,
        scenarioId,
        farmProfile: farm,
        weatherStatus: {
          status: weather.status,
          source: weather.source,
          forecastPeriod: weather.forecastPeriod,
          summary: weather.summary,
          riskIndicators: weather.riskIndicators,
        },
        groundTruthSimulation: {
          feasibleCropsCount: simulation.feasibleCropsCount,
          topFeasibleCropId: simulation.topFeasibleCropId,
          cropResults: simulation.cropResults,
        },
        decisionAgentProposalToAudit: decision,
      };

      const response = await ai.models.generateContent({
        model: MODEL_CRITIC_AGENT,
        contents: `Perform an independent adversarial audit of the AgroVera Decision Agent's recommendation against the deterministic ground truth:\n${JSON.stringify(auditInput, null, 2)}`,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: criticResponseSchema,
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        },
      });

      const rawText = (response.text ?? '{}').trim();
      return JSON.parse(rawText) as CriticAgentOutput;
    },
  };
}

function makeEventId(prefix: string, index: number): string {
  return `${prefix}-${Date.now()}-${index}`;
}

export async function executeAgenticPipeline(params: {
  farm: FarmProfile;
  scenarioId?: ClimateScenarioId;
  scenarioOverride?: ScenarioParametersOverride;
  weatherThresholds?: WeatherThresholds;
  language?: AppLanguage;
  baselineComparison?: BaselineReferenceContext;
  adapter?: AgentProviderAdapter;
  fetchImpl?: typeof fetch;
}): Promise<AgenticEvaluationResponse> {
  const {
    farm,
    scenarioId = 'baseline',
    scenarioOverride,
    weatherThresholds,
    language = 'en',
    baselineComparison,
    adapter = createRealGeminiAdapter(),
    fetchImpl = fetch,
  } = params;

  const isDe = language === 'de';
  const timeline: AgentTimelineEvent[] = [];
  let stepCounter = 1;
  const pushEvent = (
    event: Omit<AgentTimelineEvent, 'id' | 'timestamp'>
  ): void => {
    timeline.push({
      id: makeEventId(event.stage, stepCounter++),
      timestamp: new Date().toISOString(),
      ...event,
    });
  };

  // 1. Weather API Request & Response
  const weatherStart = Date.now();
  pushEvent({
    stage: 'weather_request',
    actor: isDe ? 'Klimarisiko-Modul' : 'Climate Risk Module',
    status: 'info',
    title: isDe
      ? 'Wetter-API angefragt (DWD ICON / Open-Meteo)'
      : 'Weather API requested (DWD ICON / Open-Meteo)',
    summary:
      farm.latitude !== null && farm.longitude !== null
        ? isDe
          ? `Abruf der aktuellen Kurzfristprognose für ${farm.locationName} (${farm.latitude.toFixed(4)}°, ${farm.longitude.toFixed(4)}°, Zeitzone Europe/Berlin).`
          : `Querying live DWD ICON / Open-Meteo forecast for ${farm.locationName} (${farm.latitude.toFixed(4)}°, ${farm.longitude.toFixed(4)}°, Europe/Berlin).`
        : isDe
          ? `Wetterabruf übersprungen, da keine GPS-Koordinaten für ${farm.locationName || 'Standort'} vorliegen.`
          : `Skipping weather request because farm coordinates are missing for ${farm.locationName || 'unspecified location'}.`,
  });

  const weather =
    farm.latitude !== null && farm.longitude !== null
      ? await fetchOpenMeteoWeather(
          {
            latitude: farm.latitude,
            longitude: farm.longitude,
            locationLabel: farm.locationName,
            thresholds: weatherThresholds,
          },
          fetchImpl
        )
      : await fetchOpenMeteoWeather(
          {
            latitude: Number.NaN,
            longitude: Number.NaN,
            locationLabel: farm.locationName,
            thresholds: weatherThresholds,
          },
          fetchImpl
        );

  const triggeredRisks = weather.riskIndicators.filter((r) => r.triggered);
  pushEvent({
    stage: 'weather_response',
    actor: isDe ? 'DWD / Open-Meteo Parser' : 'DWD / Open-Meteo Forecast Parser',
    status: weather.status === 'ok' ? 'success' : 'warning',
    title:
      weather.status === 'ok'
        ? isDe
          ? 'Wetterdaten empfangen & Risikoindikatoren ausgewertet'
          : 'Weather response received & risk indicators parsed'
        : isDe
          ? 'Wetterprognose nicht verfügbar — Unsicherheit markiert'
          : 'Weather forecast unavailable — uncertainty flagged',
    summary:
      weather.status === 'ok' && weather.summary && weather.forecastPeriod
        ? isDe
          ? `${weather.forecastPeriod.days}-Tage-Prognose (${weather.forecastPeriod.startDate} bis ${weather.forecastPeriod.endDate}): Max. ${weather.summary.peakMaxTempC} °C, Min. ${weather.summary.lowestMinTempC} °C, Niederschlagssumme ${weather.summary.totalPrecipMm} mm. Aktive Warnindikatoren: ${triggeredRisks.length > 0 ? triggeredRisks.map((r) => r.labelBilingual.de).join(', ') : 'Keine'}.`
          : `Parsed ${weather.forecastPeriod.days}-day forecast (${weather.forecastPeriod.startDate} to ${weather.forecastPeriod.endDate}): peak ${weather.summary.peakMaxTempC} °C, min ${weather.summary.lowestMinTempC} °C, cumulative rain ${weather.summary.totalPrecipMm} mm. Triggered near-term alerts: ${triggeredRisks.length > 0 ? triggeredRisks.map((r) => r.labelBilingual.en).join(', ') : 'None'}.`
        : (isDe
            ? weather.errorMessageBilingual?.de
            : weather.errorMessageBilingual?.en) ??
          weather.errorMessage ??
          'Weather forecast could not be retrieved.',
    durationMs: Date.now() - weatherStart,
  });

  // 2. Crop Profiles Loaded
  pushEvent({
    stage: 'crop_profiles',
    actor: isDe ? 'Deutsche Kulturdatenbank' : 'German Crop Knowledge Loader',
    status: 'success',
    title: isDe
      ? 'Deutsche Kulturprofile geladen'
      : 'German crop profiles loaded',
    summary: isDe
      ? `${CROP_DATABASE.crops.length} Kulturen geladen (${CROP_DATABASE.crops.map((c) => c.names.de).join(', ')}) mit Destatis-Ertragsreferenzen (2024–2025), deutschen Saatfenstern sowie Richtwerten für Wasserbedarf und Direktkosten.`
      : `Loaded ${CROP_DATABASE.crops.length} German crop profiles (${CROP_DATABASE.crops.map((c) => c.names.en).join(', ')}) with Destatis yield benchmarks (2024–2025), sowing windows, water balance, and EUR cost assumptions.`,
  });

  // 3. Deterministic Simulation + Gemini 4 Hydrogen Orchestrator
  let primarySimulation: SimulationRunOutput | null = null;
  const simExecutor = (targetScenario: ClimateScenarioId): SimulationRunOutput => {
    const useOverride =
      targetScenario === scenarioId ? scenarioOverride : undefined;
    const sim = simulateCrops(farm, weather, targetScenario, useOverride);
    if (targetScenario === scenarioId || !primarySimulation) {
      primarySimulation = sim;
    }
    return sim;
  };

  let orchestratorSummary = '';
  const orchStart = Date.now();
  try {
    const orchResult = await adapter.runOrchestratorWorkflow({
      farm,
      scenarioId,
      weather,
      language,
      executeSimulationTool: simExecutor,
    });
    orchestratorSummary = orchResult.summary;
    const ensuredSim =
      primarySimulation ??
      simulateCrops(farm, weather, scenarioId, scenarioOverride);
    primarySimulation = ensuredSim;

    pushEvent({
      stage: 'orchestrator',
      actor: isDe ? 'Tool-Orchestrator' : 'Lightweight Orchestrator',
      modelId: MODEL_ORCHESTRATOR,
      status: 'success',
      title: orchResult.toolInvoked
        ? isDe
          ? 'Orchestrator hat Simulations-Tool ausgeführt'
          : 'Orchestrator executed simulation tool workflow'
        : isDe
          ? 'Orchestrator hat Kurzbericht erstellt'
          : 'Orchestrator prepared operational brief',
      summary: orchestratorSummary,
      durationMs: Date.now() - orchStart,
    });
  } catch (err) {
    primarySimulation = simulateCrops(
      farm,
      weather,
      scenarioId,
      scenarioOverride
    );
    const message =
      err instanceof Error ? err.message : 'Unknown Gemini Orchestrator error';

    pushEvent({
      stage: 'simulation',
      actor: isDe
        ? 'Deterministischer Simulator'
        : 'Deterministic Simulation Engine',
      status: 'success',
      title: isDe
        ? 'Deterministische Simulation abgeschlossen'
        : 'Simulation completed deterministically',
      summary: isDe
        ? `4 Kulturen unter '${primarySimulation.scenario.names.de}' geprüft: ${primarySimulation.feasibleCropsCount}/4 machbar. Führende Kultur: ${localizedCropLabel(primarySimulation.topFeasibleCropId ?? 'none', language)}.`
        : `Evaluated 4 crops under '${primarySimulation.scenario.names.en}': ${primarySimulation.feasibleCropsCount}/4 feasible. Top deterministic candidate: ${localizedCropLabel(primarySimulation.topFeasibleCropId ?? 'none', language)}.`,
    });

    pushEvent({
      stage: 'orchestrator',
      actor: isDe ? 'Tool-Orchestrator' : 'Lightweight Orchestrator',
      modelId: MODEL_ORCHESTRATOR,
      status: 'error',
      title: `Model error (${MODEL_ORCHESTRATOR})`,
      summary: message,
      durationMs: Date.now() - orchStart,
    });

    return {
      runId: `run-${Date.now()}`,
      language,
      completedAt: new Date().toISOString(),
      farm,
      scenarioId,
      weather,
      simulation: primarySimulation,
      orchestratorSummary: isDe
        ? 'Orchestrator-Aufruf fehlgeschlagen; deterministische Simulationsergebnisse stehen weiterhin bereit.'
        : 'Orchestrator call failed; deterministic simulation results remain available below.',
      decision: null,
      critic: null,
      validationGate: null,
      reviewCycles: [],
      maxCyclesReached: false,
      requiresHumanReview: true,
      timeline,
      modelsUsed: {
        orchestrator: MODEL_ORCHESTRATOR,
        decisionAgent: MODEL_DECISION_AGENT,
        criticAgent: MODEL_CRITIC_AGENT,
      },
      aiError: {
        stage: 'orchestrator',
        model: MODEL_ORCHESTRATOR,
        message,
      },
    };
  }

  const simulation =
    primarySimulation ??
    simulateCrops(farm, weather, scenarioId, scenarioOverride);

  pushEvent({
    stage: 'simulation',
    actor: isDe
      ? 'Deterministischer Simulator'
      : 'Deterministic Simulation Engine',
    status: simulation.feasibleCropsCount > 0 ? 'success' : 'warning',
    title: isDe ? 'Simulation abgeschlossen' : 'Simulation completed',
    summary: isDe
      ? `${simulation.feasibleCropsCount} von ${simulation.cropResults.length} Kulturen erfüllen Saatfenster, Beregnungswasser (${simulation.farmSummary.availableIrrigationTotalM3.toLocaleString('de-DE')} m³ / ${simulation.farmSummary.availableIrrigationMmHa} mm/ha) und Budget (${simulation.farmSummary.budgetInSelectedCurrency.toLocaleString('de-DE')} ${simulation.farmSummary.currency}) im Szenario ${simulation.scenario.names.de}.`
      : `${simulation.feasibleCropsCount} of ${simulation.cropResults.length} crops satisfied sowing-season, irrigation (${simulation.farmSummary.availableIrrigationTotalM3.toLocaleString('en-US')} m³ / ${simulation.farmSummary.availableIrrigationMmHa} mm/ha), and budget (${simulation.farmSummary.currency} ${simulation.farmSummary.budgetInSelectedCurrency.toLocaleString('en-US')}) constraints under ${simulation.scenario.names.en}.`,
  });

  // 4. Decision Agent + Independent Critic Agent + Deterministic Validation Loop (max 2 cycles)
  const reviewCycles: ReviewCycleRecord[] = [];
  let finalDecision: DecisionAgentOutput | null = null;
  let finalCritic: CriticAgentOutput | null = null;
  let finalValidationGate = null;
  let scenarioShiftExplanation: string | undefined;
  let priorFeedback:
    | {
        critic: CriticAgentOutput;
        validationFailures: string[];
        recalculatedStressSummary?: string;
      }
    | undefined;

  for (let cycle = 1; cycle <= MAX_REVIEW_CYCLES; cycle++) {
    const decStart = Date.now();
    let decisionResult: {
      decision: DecisionAgentOutput;
      scenarioShiftExplanation?: string;
    };
    try {
      decisionResult = await adapter.runDecisionAgent({
        farm,
        scenarioId,
        weather,
        simulation,
        orchestratorSummary,
        language,
        cycle,
        priorFeedback,
        baselineComparison,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown Decision Agent error';
      pushEvent({
        stage: 'decision_agent',
        actor: isDe
          ? 'Gemini Carbon Entscheidungs-Agent'
          : 'Gemini Carbon Decision Agent',
        modelId: MODEL_DECISION_AGENT,
        status: 'error',
        cycle,
        title: `Decision Agent error (${MODEL_DECISION_AGENT})`,
        summary: message,
        durationMs: Date.now() - decStart,
      });
      return {
        runId: `run-${Date.now()}`,
        language,
        completedAt: new Date().toISOString(),
        farm,
        scenarioId,
        weather,
        simulation,
        orchestratorSummary,
        decision: finalDecision,
        critic: finalCritic,
        validationGate: finalValidationGate,
        reviewCycles,
        maxCyclesReached: false,
        requiresHumanReview: true,
        timeline,
        modelsUsed: {
          orchestrator: MODEL_ORCHESTRATOR,
          decisionAgent: MODEL_DECISION_AGENT,
          criticAgent: MODEL_CRITIC_AGENT,
        },
        aiError: {
          stage: 'decision_agent',
          model: MODEL_DECISION_AGENT,
          message,
        },
      };
    }

    const decision = decisionResult.decision;
    if (decisionResult.scenarioShiftExplanation) {
      scenarioShiftExplanation = decisionResult.scenarioShiftExplanation;
    }

    pushEvent({
      stage: 'decision_agent',
      actor: isDe
        ? 'Gemini Carbon Entscheidungs-Agent'
        : 'Gemini Carbon Decision Agent',
      modelId: MODEL_DECISION_AGENT,
      status: 'success',
      cycle,
      title:
        cycle === 1
          ? isDe
            ? 'Entscheidungs-Agent ausgeführt'
            : 'Decision Agent invoked'
          : isDe
            ? `Entscheidungs-Agent überarbeitet (Durchlauf ${cycle})`
            : `Decision Agent reconsidered (Cycle ${cycle})`,
      summary: isDe
        ? `Vorschlag '${localizedCropLabel(decision.recommendedCropId, 'de')}': ${decision.headline}`
        : `Proposed '${localizedCropLabel(decision.recommendedCropId, 'en')}': ${decision.headline}`,
      durationMs: Date.now() - decStart,
    });

    // 4b. Invoke Independent Critic Agent (gemini-4-carbon)
    const critStart = Date.now();
    let critic: CriticAgentOutput;
    try {
      critic = await adapter.runCriticAgent({
        farm,
        scenarioId,
        weather,
        simulation,
        decision,
        language,
        cycle,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown Critic Agent error';
      pushEvent({
        stage: 'critic_agent',
        actor: isDe
          ? 'Gemini Carbon Prüf-Agent'
          : 'Gemini Carbon Critic Agent',
        modelId: MODEL_CRITIC_AGENT,
        status: 'error',
        cycle,
        title: `Critic Agent error (${MODEL_CRITIC_AGENT})`,
        summary: message,
        durationMs: Date.now() - critStart,
      });
      return {
        runId: `run-${Date.now()}`,
        language,
        completedAt: new Date().toISOString(),
        farm,
        scenarioId,
        weather,
        simulation,
        orchestratorSummary,
        decision,
        critic: null,
        validationGate: null,
        reviewCycles,
        maxCyclesReached: false,
        requiresHumanReview: true,
        timeline,
        modelsUsed: {
          orchestrator: MODEL_ORCHESTRATOR,
          decisionAgent: MODEL_DECISION_AGENT,
          criticAgent: MODEL_CRITIC_AGENT,
        },
        aiError: {
          stage: 'critic_agent',
          model: MODEL_CRITIC_AGENT,
          message,
        },
        scenarioShiftExplanation,
      };
    }

    pushEvent({
      stage: 'critic_agent',
      actor: isDe
        ? 'Gemini Carbon Prüf-Agent'
        : 'Gemini Carbon Critic Agent',
      modelId: MODEL_CRITIC_AGENT,
      status:
        critic.verdict === 'pass'
          ? 'success'
          : critic.verdict === 'review'
            ? 'warning'
            : 'error',
      cycle,
      title: isDe
        ? `Gegenprüfung: ${critic.verdict.toUpperCase()} (Durchlauf ${cycle})`
        : `Critic Agent audit: ${critic.verdict.toUpperCase()} (Cycle ${cycle})`,
      summary: critic.criticSummary,
      durationMs: Date.now() - critStart,
    });

    // 4c. Deterministic Validation Gate
    const validationGate = runDeterministicValidationGate(
      decision,
      critic,
      simulation,
      weather
    );

    finalDecision = decision;
    finalCritic = critic;
    finalValidationGate = validationGate;

    pushEvent({
      stage: 'validation_gate',
      actor: isDe
        ? 'Deterministisches Validierungs-Gate'
        : 'Deterministic Validation Gate',
      status: validationGate.passed ? 'success' : 'error',
      cycle,
      title: validationGate.passed
        ? isDe
          ? `Validierung bestanden (Durchlauf ${cycle})`
          : `Validation passed (Cycle ${cycle})`
        : isDe
          ? `Validierung fehlgeschlagen (Durchlauf ${cycle})`
          : `Validation failed (Cycle ${cycle})`,
      summary: validationGate.passed
        ? isDe
          ? `Alle ${validationGate.checks.length} deterministischen Restriktions-, Transparenz- und Prüfkriterien erfüllt.`
          : `All ${validationGate.checks.length} deterministic constraint, disclosure, and Critic audit checks passed.`
        : isDe
          ? `Prüfungsfehler: ${validationGate.failureReasonsBilingual.map((f) => f.de).join(' ')}`
          : `Failed verification: ${validationGate.failureReasons.join(' ')}`,
    });

    let recalculatedStressSimulation: ReviewCycleRecord['recalculatedStressSimulation'];

    if (validationGate.passed) {
      reviewCycles.push({
        cycle,
        decision,
        critic,
        validationGate,
      });
      break;
    }

    if (cycle < MAX_REVIEW_CYCLES) {
      const requestedTarget = critic.requestedRecalculation?.targetScenarioId;
      const targetScenario: ClimateScenarioId =
        critic.requestedRecalculation?.needed &&
        requestedTarget &&
        requestedTarget !== 'none'
          ? requestedTarget
          : scenarioId === 'baseline'
            ? 'drought'
            : 'baseline';

      const stressSim = simulateCrops(farm, weather, targetScenario);
      const recalculatedStressSummary = isDe
        ? `Stresstest-Neuberechnung unter '${stressSim.scenario.names.de}': ${stressSim.feasibleCropsCount}/4 machbar, Top-Kultur = ${localizedCropLabel(stressSim.topFeasibleCropId ?? 'none', 'de')}. Reihung: ${stressSim.cropResults.map((c) => `${c.cropNames.de}(${c.feasibilityStatus}, Index=${c.scores.weightedSuitability})`).join(', ')}.`
        : `Recalculated stress check under '${stressSim.scenario.names.en}': ${stressSim.feasibleCropsCount}/4 feasible, top candidate = ${localizedCropLabel(stressSim.topFeasibleCropId ?? 'none', 'en')}. Rankings: ${stressSim.cropResults.map((c) => `${c.cropNames.en}(${c.feasibilityStatus}, score=${c.scores.weightedSuitability})`).join(', ')}.`;

      recalculatedStressSimulation = {
        scenarioId: targetScenario,
        topFeasibleCropId: stressSim.topFeasibleCropId,
        summary: recalculatedStressSummary,
      };

      pushEvent({
        stage: 'recalculation',
        actor: isDe
          ? 'Deterministischer Simulator'
          : 'Deterministic Simulation Engine',
        status: 'warning',
        cycle,
        title: isDe
          ? `Neuberechnung vor Durchlauf ${cycle + 1}`
          : `Recalculation requested before Cycle ${cycle + 1}`,
        summary: recalculatedStressSummary,
      });

      priorFeedback = {
        critic,
        validationFailures: isDe
          ? validationGate.failureReasonsBilingual.map((f) => f.de)
          : validationGate.failureReasons,
        recalculatedStressSummary,
      };
    }

    reviewCycles.push({
      cycle,
      decision,
      critic,
      validationGate,
      recalculatedStressSimulation,
    });
  }

  const maxCyclesReached =
    reviewCycles.length >= MAX_REVIEW_CYCLES &&
    !(finalValidationGate?.passed ?? false);

  const requiresHumanReview =
    (finalValidationGate?.requiresHumanReview ?? true) || maxCyclesReached;

  pushEvent({
    stage: 'final_recommendation',
    actor: 'AgroVera Decision Pipeline',
    status:
      finalValidationGate?.passed && !requiresHumanReview
        ? 'success'
        : 'warning',
    title: finalValidationGate?.passed
      ? isDe
        ? 'Geprüfte Endempfehlung bereitgestellt'
        : 'Final verified recommendation prepared'
      : isDe
        ? 'Prüfung nicht abgeschlossen — Fachberatung erforderlich'
        : 'Verification unresolved — Human review required',
    summary:
      finalValidationGate?.passed && finalDecision
        ? isDe
          ? `Empfehlung '${localizedCropLabel(finalDecision.recommendedCropId, 'de')}' in ${reviewCycles.length} Prüfschleife(n) bestätigt.${requiresHumanReview ? ' Hinweis auf fachliche Beratung wegen knapper Puffer oder fehlender Schlagdaten.' : ''}`
          : `Recommendation '${localizedCropLabel(finalDecision.recommendedCropId, 'en')}' verified across ${reviewCycles.length} review cycle(s).${requiresHumanReview ? ' Flagged for advisory human review due to thin margins or missing local data.' : ''}`
        : isDe
          ? `Validierung nach maximal ${MAX_REVIEW_CYCLES} Prüfschleifen offen geblieben. Transparente Prüfhinweise werden angezeigt; menschliche Fachberatung erforderlich.`
          : `Validation remained unresolved after maximum ${MAX_REVIEW_CYCLES} review cycles. Displaying transparent audit warnings and requesting human agronomic review.`,
  });

  if (baselineComparison && !scenarioShiftExplanation && finalDecision) {
    const prevCrop = baselineComparison.recommendedCropId;
    const nextCrop = finalDecision.recommendedCropId;
    if (prevCrop === nextCrop) {
      scenarioShiftExplanation = isDe
        ? `Die Empfehlung blieb im Vergleich von Ausgangslage und ${simulation.scenario.names.de} stabil bei '${localizedCropLabel(nextCrop, 'de')}', da Wasser- und Budgetgrenzen weiterhin eingehalten werden.`
        : `Recommendation remained stable at '${localizedCropLabel(nextCrop, 'en')}' across both Baseline and ${simulation.scenario.names.en}, continuing to satisfy hard seasonal, water, and budget limits.`;
    } else {
      const prevInNew = simulation.cropResults.find(
        (c) => c.cropId === prevCrop
      );
      if (isDe) {
        const prevReason =
          prevInNew && prevInNew.feasibilityStatus === 'infeasible'
            ? `die zuvor empfohlene Kultur '${localizedCropLabel(prevCrop, 'de')}' nicht mehr machbar ist (${prevInNew.infeasibilityReasonsBilingual.map((r) => r.de).join(' ')})`
            : `die zuvor empfohlene Kultur '${localizedCropLabel(prevCrop, 'de')}' im Eignungsindex zurückfiel (${prevInNew?.scores.weightedSuitability ?? 'k. A.'})`;
        scenarioShiftExplanation = `Die Empfehlung wechselte von '${localizedCropLabel(prevCrop, 'de')}' zu '${localizedCropLabel(nextCrop, 'de')}', weil ${prevReason} im Szenario ${simulation.scenario.names.de}.`;
      } else {
        const prevReason =
          prevInNew && prevInNew.feasibilityStatus === 'infeasible'
            ? `previously recommended '${localizedCropLabel(prevCrop, 'en')}' became infeasible (${prevInNew.infeasibilityReasons.join(' ')})`
            : `previously recommended '${localizedCropLabel(prevCrop, 'en')}' dropped in suitability (${prevInNew?.scores.weightedSuitability ?? 'N/A'})`;
        scenarioShiftExplanation = `Recommendation shifted from '${localizedCropLabel(prevCrop, 'en')}' to '${localizedCropLabel(nextCrop, 'en')}' because ${prevReason} under ${simulation.scenario.names.en}.`;
      }
    }
  }

  return {
    runId: `run-${Date.now()}`,
    language,
    completedAt: new Date().toISOString(),
    farm,
    scenarioId,
    weather,
    simulation,
    orchestratorSummary,
    decision: finalDecision,
    critic: finalCritic,
    validationGate: finalValidationGate,
    reviewCycles,
    maxCyclesReached,
    requiresHumanReview,
    timeline,
    modelsUsed: {
      orchestrator: MODEL_ORCHESTRATOR,
      decisionAgent: MODEL_DECISION_AGENT,
      criticAgent: MODEL_CRITIC_AGENT,
    },
    scenarioShiftExplanation,
  };
}
