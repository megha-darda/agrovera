import React from 'react';
import {
  ArrowRight,
  CheckCircle2,
  GitCompare,
  Info,
  Pin,
  Play,
  RotateCcw,
  ShieldAlert,
  Sliders,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  CLIMATE_SCENARIOS,
  resolveScenarioConfig,
} from '../engine/presets.ts';
import type {
  AgenticEvaluationResponse,
  AppLanguage,
  ClimateScenarioId,
  FarmProfile,
  PriorityMode,
  ScenarioParametersOverride,
  SimulationRunOutput,
} from '../types/domain.ts';
import {
  formatCropName,
  formatCurrency,
  formatFeasibilityLabel,
  formatNumber,
  formatPriorityLabel,
  pickBilingual,
} from '../utils/formatters.ts';

interface ScenarioAnalysisViewProps {
  farm: FarmProfile;
  scenarioId: ClimateScenarioId;
  scenarioOverride?: ScenarioParametersOverride;
  simulation: SimulationRunOutput;
  baselineSnapshot: {
    farm: FarmProfile;
    scenarioId: ClimateScenarioId;
    simulation: SimulationRunOutput;
    evaluation: AgenticEvaluationResponse | null;
  };
  currentEvaluation: AgenticEvaluationResponse | null;
  isEvaluating: boolean;
  onSelectScenarioAndEvaluate: (nextScenario: ClimateScenarioId) => void;
  onUpdateScenarioOverride: (
    nextOverride: ScenarioParametersOverride | undefined
  ) => void;
  onUpdateScenarioControls: (updates: {
    availableWaterValue?: number;
    budgetAmount?: number;
    priorityMode?: PriorityMode;
  }) => void;
  onRunScenarioEvaluation: () => void;
  onPinCurrentAsBaseline: () => void;
}

const SCENARIO_ORDER: ClimateScenarioId[] = [
  'baseline',
  'drought',
  'heatwave',
  'heavy_rainfall',
  'frost',
];

export const ScenarioAnalysisView: React.FC<ScenarioAnalysisViewProps> = ({
  farm,
  scenarioId,
  scenarioOverride,
  simulation,
  baselineSnapshot,
  currentEvaluation,
  isEvaluating,
  onSelectScenarioAndEvaluate,
  onUpdateScenarioOverride,
  onUpdateScenarioControls,
  onRunScenarioEvaluation,
  onPinCurrentAsBaseline,
}) => {
  const { t, i18n } = useTranslation();
  const lang: AppLanguage = i18n.language === 'de' ? 'de' : 'en';

  const resolvedScenario = resolveScenarioConfig(scenarioId, scenarioOverride);

  const baseRecommendedId =
    baselineSnapshot.evaluation?.decision?.recommendedCropId ??
    baselineSnapshot.simulation.topFeasibleCropId ??
    'none';

  const isSyncedWithAgents =
    Boolean(currentEvaluation) &&
    currentEvaluation?.scenarioId === scenarioId &&
    currentEvaluation?.farm.availableWaterValue === farm.availableWaterValue &&
    currentEvaluation?.farm.budgetAmount === farm.budgetAmount &&
    currentEvaluation?.farm.priorityMode === farm.priorityMode &&
    currentEvaluation?.language === lang &&
    !scenarioOverride;

  const revisedRecommendedId =
    isSyncedWithAgents && currentEvaluation?.decision
      ? currentEvaluation.decision.recommendedCropId
      : simulation.topFeasibleCropId ?? 'none';

  const recommendationChanged = baseRecommendedId !== revisedRecommendedId;

  const baseScenarioLabel = pickBilingual(
    CLIMATE_SCENARIOS[baselineSnapshot.scenarioId].names,
    lang
  );
  const activeScenarioLabel = pickBilingual(resolvedScenario.names, lang);

  return (
    <div className="space-y-8">
      {/* Header & Hypothetical Stress-Test Labeling */}
      <section className="bg-white border border-stone-200/90 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs text-stone-500 mb-1">
              {t('scenarios.badge')}
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-[#0F291E]">
              {t('scenarios.title')}
            </h1>
            <p className="text-sm text-stone-600 mt-0.5 max-w-3xl">
              {t('scenarios.subtitle')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onPinCurrentAsBaseline}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-stone-300 bg-white hover:bg-stone-50 text-xs font-medium text-stone-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Pin className="w-3.5 h-3.5" />
              {t('scenarios.pinBaselineBtn')}
            </button>
            <button
              type="button"
              onClick={onRunScenarioEvaluation}
              disabled={isEvaluating}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#0F291E] hover:bg-[#163B2B] disabled:opacity-60 text-white text-xs sm:text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Play className="w-4 h-4" />
              {isEvaluating
                ? t('scenarios.evaluatingScenarioBtn')
                : t('scenarios.evalScenarioBtn')}
            </button>
          </div>
        </div>

        {/* Scenario Selector Tabs */}
        <div className="space-y-3">
          <div className="text-xs font-semibold text-stone-800">
            {t('scenarios.step1Label')}
          </div>
          <div
            role="group"
            aria-label="Climate scenario stress tests"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3"
          >
            {SCENARIO_ORDER.map((id) => {
              const cfg = CLIMATE_SCENARIOS[id];
              const selected = scenarioId === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelectScenarioAndEvaluate(id)}
                  disabled={isEvaluating}
                  className={`text-left p-3.5 rounded-lg border transition-colors cursor-pointer ${
                    selected
                      ? 'border-emerald-700 bg-[#F2F7F4]'
                      : 'border-stone-200 hover:border-stone-300 bg-white'
                  }`}
                >
                  <div className="text-[11px] font-medium text-stone-500">
                    {cfg.isHypotheticalStressTest
                      ? t('scenarios.stressBadge')
                      : t('scenarios.baselineBadge')}
                  </div>
                  <div className="text-sm font-bold text-[#0F291E] mt-0.5">
                    {pickBilingual(cfg.names, lang)}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-stone-600 mt-1">
                    {t('scenarios.scenarioCardMeta', {
                      et: cfg.waterDemandMultiplier.toFixed(2),
                      rain: cfg.seasonalRainfallMultiplier.toFixed(2),
                    })}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="p-3.5 rounded-lg bg-[#EEF3EF] border border-[#D5E1D8] flex items-start gap-2.5 text-xs text-[#1B3B2B]">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-emerald-800" />
            <div>
              <strong>
                {activeScenarioLabel} (
                {pickBilingual(resolvedScenario.labelBadge, lang)}):
              </strong>{' '}
              {pickBilingual(resolvedScenario.description, lang)}
            </div>
          </div>
        </div>

        {/* Editable Scenario Stress Parameters */}
        <div className="pt-3 border-t border-stone-100 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-stone-800 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-emerald-800" />
              {t('scenarios.customParamsTitle')}
            </span>
            <button
              type="button"
              onClick={() => onUpdateScenarioOverride(undefined)}
              className="inline-flex items-center gap-1 text-xs font-medium text-stone-600 hover:text-stone-900 underline cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              {t('scenarios.resetScenarioParamsBtn')}
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-xs">
            <div>
              <label
                htmlFor="param-et-mult"
                className="block font-medium text-stone-600 mb-1"
              >
                {t('scenarios.paramWaterMult')}
              </label>
              <input
                id="param-et-mult"
                type="number"
                min="0.7"
                max="1.6"
                step="0.02"
                value={resolvedScenario.waterDemandMultiplier}
                onChange={(e) =>
                  onUpdateScenarioOverride({
                    ...scenarioOverride,
                    waterDemandMultiplier: Number(e.target.value),
                  })
                }
                className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 font-mono tabular-nums"
              />
            </div>

            <div>
              <label
                htmlFor="param-rain-mult"
                className="block font-medium text-stone-600 mb-1"
              >
                {t('scenarios.paramRainMult')}
              </label>
              <input
                id="param-rain-mult"
                type="number"
                min="0.2"
                max="2.2"
                step="0.05"
                value={resolvedScenario.seasonalRainfallMultiplier}
                onChange={(e) =>
                  onUpdateScenarioOverride({
                    ...scenarioOverride,
                    seasonalRainfallMultiplier: Number(e.target.value),
                  })
                }
                className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 font-mono tabular-nums"
              />
            </div>

            <div>
              <label
                htmlFor="param-drought"
                className="block font-medium text-stone-600 mb-1"
              >
                {t('scenarios.paramDrought')}
              </label>
              <input
                id="param-drought"
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={resolvedScenario.yieldStressMultipliers.droughtFactor}
                onChange={(e) =>
                  onUpdateScenarioOverride({
                    ...scenarioOverride,
                    droughtFactor: Number(e.target.value),
                  })
                }
                className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 font-mono tabular-nums"
              />
            </div>

            <div>
              <label
                htmlFor="param-heat"
                className="block font-medium text-stone-600 mb-1"
              >
                {t('scenarios.paramHeat')}
              </label>
              <input
                id="param-heat"
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={resolvedScenario.yieldStressMultipliers.heatFactor}
                onChange={(e) =>
                  onUpdateScenarioOverride({
                    ...scenarioOverride,
                    heatFactor: Number(e.target.value),
                  })
                }
                className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 font-mono tabular-nums"
              />
            </div>

            <div>
              <label
                htmlFor="param-frost"
                className="block font-medium text-stone-600 mb-1"
              >
                {t('scenarios.paramFrost')}
              </label>
              <input
                id="param-frost"
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={resolvedScenario.yieldStressMultipliers.frostFactor}
                onChange={(e) =>
                  onUpdateScenarioOverride({
                    ...scenarioOverride,
                    frostFactor: Number(e.target.value),
                  })
                }
                className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 font-mono tabular-nums"
              />
            </div>

            <div>
              <label
                htmlFor="param-rain-excess"
                className="block font-medium text-stone-600 mb-1"
              >
                {t('scenarios.paramExcessRain')}
              </label>
              <input
                id="param-rain-excess"
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={resolvedScenario.yieldStressMultipliers.excessRainFactor}
                onChange={(e) =>
                  onUpdateScenarioOverride({
                    ...scenarioOverride,
                    excessRainFactor: Number(e.target.value),
                  })
                }
                className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 font-mono tabular-nums"
              />
            </div>
          </div>
        </div>

        {/* Resource & Priority Interactive Controls */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-3 border-t border-stone-100">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label
                htmlFor="scenario-water-input"
                className="font-semibold text-stone-800"
              >
                {t('scenarios.step2Water', {
                  unit:
                    farm.availableWaterUnit === 'mm_per_ha_season'
                      ? 'mm/ha'
                      : 'm³',
                })}
              </label>
              <span className="font-mono tabular-nums font-semibold text-emerald-800">
                {formatNumber(
                  simulation.farmSummary.availableIrrigationTotalM3,
                  lang,
                  0
                )}{' '}
                m³ (
                {formatNumber(
                  simulation.farmSummary.availableIrrigationMmHa,
                  lang,
                  1
                )}{' '}
                mm/ha)
              </span>
            </div>
            <div className="flex items-center gap-3">
              <input
                aria-label="Available water slider"
                type="range"
                min={farm.availableWaterUnit === 'mm_per_ha_season' ? 0 : 0}
                max={
                  farm.availableWaterUnit === 'mm_per_ha_season' ? 500 : 50000
                }
                step={farm.availableWaterUnit === 'mm_per_ha_season' ? 10 : 500}
                value={Math.min(
                  farm.availableWaterUnit === 'mm_per_ha_season' ? 500 : 50000,
                  farm.availableWaterValue
                )}
                onChange={(e) =>
                  onUpdateScenarioControls({
                    availableWaterValue: Number(e.target.value),
                  })
                }
                className="flex-1 accent-emerald-700 cursor-pointer"
              />
              <input
                id="scenario-water-input"
                type="number"
                min="0"
                step="250"
                value={farm.availableWaterValue}
                onChange={(e) =>
                  onUpdateScenarioControls({
                    availableWaterValue: Math.max(0, Number(e.target.value)),
                  })
                }
                className="w-28 px-2.5 py-1.5 rounded-lg border border-stone-300 text-xs font-mono tabular-nums text-right"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label
                htmlFor="scenario-budget-input"
                className="font-semibold text-stone-800"
              >
                {t('scenarios.step3Budget', { currency: farm.currency })}
              </label>
              <span className="font-mono tabular-nums font-semibold text-emerald-800">
                {formatCurrency(farm.budgetAmount, farm.currency, lang)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <input
                aria-label="Farming budget slider"
                type="range"
                min="4000"
                max="80000"
                step="1000"
                value={Math.min(80000, farm.budgetAmount)}
                onChange={(e) =>
                  onUpdateScenarioControls({
                    budgetAmount: Number(e.target.value),
                  })
                }
                className="flex-1 accent-emerald-700 cursor-pointer"
              />
              <input
                id="scenario-budget-input"
                type="number"
                min="0"
                step="500"
                value={farm.budgetAmount}
                onChange={(e) =>
                  onUpdateScenarioControls({
                    budgetAmount: Math.max(0, Number(e.target.value)),
                  })
                }
                className="w-28 px-2.5 py-1.5 rounded-lg border border-stone-300 text-xs font-mono tabular-nums text-right"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="scenario-priority-select"
              className="block text-xs font-semibold text-stone-800"
            >
              {t('scenarios.step4Priority')}
            </label>
            <select
              id="scenario-priority-select"
              value={farm.priorityMode}
              onChange={(e) => {
                const mode = e.target.value as PriorityMode;
                onUpdateScenarioControls({ priorityMode: mode });
              }}
              className="w-full px-3 py-2 rounded-lg border border-stone-300 text-xs sm:text-sm text-stone-900 bg-white"
            >
              <option value="balanced">{t('priorities.balanced')}</option>
              <option value="max_profit">{t('priorities.max_profit')}</option>
              <option value="min_climate_risk">
                {t('priorities.min_climate_risk')}
              </option>
              <option value="min_water">{t('priorities.min_water')}</option>
            </select>
          </div>
        </div>
      </section>

      {/* Side-by-Side Original vs Revised Recommendation Comparison */}
      <section className="space-y-4" data-testid="scenario-comparison-panel">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-[#0F291E] flex items-center gap-2">
            <GitCompare className="w-5 h-5 text-emerald-800" />
            {t('scenarios.sideBySideTitle')}
          </h2>
          {!isSyncedWithAgents && !isEvaluating && (
            <button
              type="button"
              onClick={onRunScenarioEvaluation}
              className="text-xs font-semibold text-amber-800 hover:text-amber-950 underline cursor-pointer"
            >
              {t('scenarios.unsyncedPrompt')}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Reference Baseline Column */}
          <div className="lg:col-span-5 bg-white border border-stone-200/90 rounded-xl p-6 flex flex-col justify-between">
            <div>
              <div className="text-xs text-stone-500 mb-1">
                {t('scenarios.refSnapshotLabel', {
                  scenario: baseScenarioLabel,
                })}
              </div>
              <h3 className="text-xl font-bold text-stone-900">
                {formatCropName(baseRecommendedId, lang)}
              </h3>
              <div className="text-xs text-stone-500 font-mono tabular-nums mt-1">
                {formatNumber(
                  baselineSnapshot.simulation.farmSummary
                    .availableIrrigationTotalM3,
                  lang,
                  0
                )}{' '}
                m³ ·{' '}
                {formatCurrency(
                  baselineSnapshot.farm.budgetAmount,
                  baselineSnapshot.farm.currency,
                  lang
                )}{' '}
                · {formatPriorityLabel(baselineSnapshot.farm.priorityMode, lang)}
              </div>

              <div className="mt-4 pt-4 border-t border-stone-100 space-y-2">
                {baselineSnapshot.simulation.cropResults.map((c, i) => (
                  <div
                    key={c.cropId}
                    className="flex items-center justify-between text-xs py-1"
                  >
                    <span className="font-medium text-stone-800">
                      #{i + 1} {pickBilingual(c.cropNames, lang)}
                    </span>
                    <span className="font-mono tabular-nums text-stone-600">
                      {formatFeasibilityLabel(c.feasibilityStatus, lang)} ·{' '}
                      {formatNumber(c.scores.weightedSuitability, lang, 1)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-stone-100 text-xs text-stone-500">
              {t('scenarios.feasibleSummary', {
                count: baselineSnapshot.simulation.feasibleCropsCount,
              })}
            </div>
          </div>

          {/* Center Delta Indicator */}
          <div className="lg:col-span-2 flex flex-col items-center justify-center bg-[#EEF3EF] border border-[#D5E1D8] rounded-xl p-4 text-center">
            <ArrowRight className="w-6 h-6 text-emerald-800 mb-2 hidden lg:block" />
            <div className="text-xs font-bold text-[#0F291E]">
              {recommendationChanged
                ? t('scenarios.deltaShifted')
                : t('scenarios.deltaStable')}
            </div>
            <p className="text-[11px] text-stone-600 mt-1">
              {recommendationChanged
                ? `${formatCropName(baseRecommendedId, lang)} → ${formatCropName(revisedRecommendedId, lang)}`
                : t('scenarios.remainsTop', {
                    crop: formatCropName(revisedRecommendedId, lang),
                  })}
            </p>
          </div>

          {/* Revised Active Scenario Column */}
          <div className="lg:col-span-5 bg-white border border-emerald-700 rounded-xl p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 text-xs mb-1">
                <span className="text-emerald-800 font-medium">
                  {t('scenarios.revisedScenarioLabel', {
                    scenario: activeScenarioLabel,
                  })}
                </span>
                <span className="font-mono text-stone-500">
                  {isSyncedWithAgents
                    ? t('scenarios.aiVerifiedTag')
                    : t('scenarios.detPreviewTag')}
                </span>
              </div>
              <h3 className="text-xl font-bold text-[#0F291E]">
                {formatCropName(revisedRecommendedId, lang)}
              </h3>
              <div className="text-xs text-stone-500 font-mono tabular-nums mt-1">
                {formatNumber(
                  simulation.farmSummary.availableIrrigationTotalM3,
                  lang,
                  0
                )}{' '}
                m³ · {formatCurrency(farm.budgetAmount, farm.currency, lang)} ·{' '}
                {formatPriorityLabel(farm.priorityMode, lang)}
              </div>

              <div className="mt-4 pt-4 border-t border-stone-100 space-y-2">
                {simulation.cropResults.map((c, i) => (
                  <div
                    key={c.cropId}
                    className="flex items-center justify-between text-xs py-1"
                  >
                    <span className="font-medium text-stone-900">
                      #{i + 1} {pickBilingual(c.cropNames, lang)}
                    </span>
                    <span
                      className={`font-mono tabular-nums ${
                        c.feasibilityStatus === 'feasible'
                          ? 'text-emerald-800 font-medium'
                          : 'text-red-700'
                      }`}
                    >
                      {formatFeasibilityLabel(c.feasibilityStatus, lang)} ·{' '}
                      {formatNumber(c.scores.weightedSuitability, lang, 1)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-stone-100 flex items-center justify-between text-xs">
              <span className="text-stone-600">
                {t('scenarios.feasibleSummary', {
                  count: simulation.feasibleCropsCount,
                })}
              </span>
              {isSyncedWithAgents && currentEvaluation?.critic && (
                <span className="inline-flex items-center gap-1 font-medium text-emerald-800">
                  {currentEvaluation.validationGate?.passed ? (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  ) : (
                    <ShieldAlert className="w-3.5 h-3.5 text-amber-700" />
                  )}
                  {t('scenarios.criticShort', {
                    verdict: t(`common.${currentEvaluation.critic.verdict}`),
                  })}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Explanation of Why Recommendation Changed or Remained Stable */}
        <div className="bg-white border border-stone-200/90 rounded-xl p-6 space-y-2">
          <div className="text-xs font-semibold text-emerald-800">
            {recommendationChanged
              ? t('scenarios.whyChangedTitle')
              : t('scenarios.whyStableTitle')}
          </div>
          <p className="text-sm text-stone-700 leading-relaxed">
            {isSyncedWithAgents && currentEvaluation?.scenarioShiftExplanation
              ? currentEvaluation.scenarioShiftExplanation
              : recommendationChanged
                ? (() => {
                    const prevInRevised = simulation.cropResults.find(
                      (c) => c.cropId === baseRecommendedId
                    );
                    if (
                      prevInRevised &&
                      prevInRevised.feasibilityStatus === 'infeasible'
                    ) {
                      return t('scenarios.detShiftedInfeasible', {
                        prevCrop: pickBilingual(prevInRevised.cropNames, lang),
                        scenario: activeScenarioLabel,
                        reason: prevInRevised.infeasibilityReasonsBilingual
                          .map((r) => pickBilingual(r, lang))
                          .join(' '),
                        nextCrop: formatCropName(revisedRecommendedId, lang),
                      });
                    }
                    return t('scenarios.detShiftedScore', {
                      scenario: activeScenarioLabel,
                      nextCrop: formatCropName(revisedRecommendedId, lang),
                      prevCrop: formatCropName(baseRecommendedId, lang),
                    });
                  })()
                : t('scenarios.detStable', {
                    crop: formatCropName(revisedRecommendedId, lang),
                    scenario: activeScenarioLabel,
                  })}
          </p>
        </div>
      </section>
    </div>
  );
};
