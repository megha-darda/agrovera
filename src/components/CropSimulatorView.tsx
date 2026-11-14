import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PRIORITY_WEIGHT_PRESETS } from '../engine/presets.ts';
import type {
  AppLanguage,
  FarmProfile,
  NavigationTab,
  PreferenceWeights,
  PriorityMode,
  SimulationRunOutput,
} from '../types/domain.ts';
import {
  formatCropFeasibilityDetail,
  formatCurrency,
  formatMonthName,
  formatNumber,
  formatRiskLevelLabel,
  formatSoilName,
  pickBilingual,
} from '../utils/formatters.ts';

interface CropSimulatorViewProps {
  farm: FarmProfile;
  simulation: SimulationRunOutput;
  onUpdateWeights: (weights: PreferenceWeights, mode?: PriorityMode) => void;
  onNavigate?: (tab: NavigationTab) => void;
}

export const CropSimulatorView: React.FC<CropSimulatorViewProps> = ({
  farm,
  simulation,
  onUpdateWeights,
  onNavigate,
}) => {
  const { t, i18n } = useTranslation();
  const lang: AppLanguage = i18n.language === 'de' ? 'de' : 'en';
  const [filterFeasibleOnly, setFilterFeasibleOnly] = useState(false);

  const rawWeights =
    farm.customWeights ?? PRIORITY_WEIGHT_PRESETS[farm.priorityMode];

  const handleSliderChange = (key: keyof PreferenceWeights, val: number) => {
    onUpdateWeights({
      ...rawWeights,
      [key]: val,
    });
  };

  const displayedRows = filterFeasibleOnly
    ? simulation.cropResults.filter((c) => c.feasibilityStatus === 'feasible')
    : simulation.cropResults;

  const monthLabel = formatMonthName(farm.plantingMonth, lang);
  const soilLabel = formatSoilName(farm.soilType, lang);
  const scenarioLabel = pickBilingual(simulation.scenario.names, lang);

  const renderSeasonalLabel = (
    suit: 'optimal' | 'shoulder' | 'out_of_season'
  ) => {
    if (suit === 'optimal') return t('common.optimalSeason');
    if (suit === 'shoulder') return t('common.shoulderSeason');
    return t('common.outOfSeason');
  };

  return (
    <div className="space-y-8">
      {/* Header & Adjustable Preference Weights */}
      <section className="bg-white border border-stone-200/90 rounded-xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
          <div>
            <div className="text-xs text-stone-500 mb-1">
              {t('simulator.engineBadge')}
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-[#0F291E]">
              {t('simulator.title')}
            </h1>
            <p className="text-sm text-stone-600 mt-0.5 max-w-3xl">
              {t('simulator.subtitle')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-stone-100 rounded-lg">
            {(
              [
                'balanced',
                'max_profit',
                'min_climate_risk',
                'min_water',
              ] as PriorityMode[]
            ).map((presetId) => (
              <button
                key={presetId}
                type="button"
                onClick={() =>
                  onUpdateWeights(PRIORITY_WEIGHT_PRESETS[presetId], presetId)
                }
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  farm.priorityMode === presetId && !farm.customWeights
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                {t(`priorities.${presetId}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Adjustable Weight Sliders */}
        <div className="pt-4 border-t border-stone-100">
          <div className="flex items-center justify-between gap-2 text-xs font-semibold text-stone-800 mb-3">
            <span className="flex items-center gap-2">
              <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-800" />
              {t('simulator.weightsHeader')}
            </span>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('data-sources')}
                className="text-xs font-semibold text-emerald-800 hover:underline cursor-pointer"
              >
                {t('overview.inspectSourcesBtn')}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {(
              [
                {
                  key: 'profit',
                  label: t('simulator.wProfit'),
                  norm: simulation.weightsNormalized.profit,
                },
                {
                  key: 'climateResilience',
                  label: t('simulator.wResilience'),
                  norm: simulation.weightsNormalized.climateResilience,
                },
                {
                  key: 'waterEfficiency',
                  label: t('simulator.wWater'),
                  norm: simulation.weightsNormalized.waterEfficiency,
                },
                {
                  key: 'soilMatch',
                  label: t('simulator.wSoil'),
                  norm: simulation.weightsNormalized.soilMatch,
                },
              ] as Array<{
                key: keyof PreferenceWeights;
                label: string;
                norm: number;
              }>
            ).map((item) => (
              <div key={item.key} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label
                    htmlFor={`weight-${item.key}`}
                    className="font-medium text-stone-700"
                  >
                    {item.label}
                  </label>
                  <span className="font-mono tabular-nums font-semibold text-emerald-800">
                    {Math.round(item.norm * 100)}%
                  </span>
                </div>
                <input
                  id={`weight-${item.key}`}
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.05"
                  value={rawWeights[item.key]}
                  onChange={(e) =>
                    handleSliderChange(item.key, Number(e.target.value))
                  }
                  className="w-full accent-emerald-700 cursor-pointer"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Four Candidate Crop Comparison Cards */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
        {simulation.cropResults.map((crop, index) => {
          const isFeasible = crop.feasibilityStatus === 'feasible';
          const isUncertain = crop.feasibilityStatus === 'uncertain';
          const isTopFeasible =
            isFeasible && simulation.topFeasibleCropId === crop.cropId;

          const reasonList = crop.infeasibilityReasonsBilingual.map((r) =>
            pickBilingual(r, lang)
          );
          const uncertList = crop.uncertaintyReasonsBilingual.map((u) =>
            pickBilingual(u, lang)
          );

          return (
            <article
              key={crop.cropId}
              data-testid={`crop-card-${crop.cropId}`}
              className={`bg-white rounded-xl p-5 border flex flex-col justify-between ${
                isTopFeasible
                  ? 'border-emerald-700'
                  : isFeasible
                    ? 'border-stone-200/90'
                    : 'border-stone-200/80 bg-stone-50/40'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2 text-xs mb-2">
                  <span className="text-stone-500 font-mono tabular-nums truncate">
                    {t('simulator.rankLabel', { rank: index + 1 })} ·{' '}
                    {pickBilingual(crop.category, lang)}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 font-semibold uppercase shrink-0 ${
                      isFeasible
                        ? 'text-emerald-800'
                        : isUncertain
                          ? 'text-amber-700'
                          : 'text-red-700'
                    }`}
                  >
                    {isFeasible ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : isUncertain ? (
                      <AlertCircle className="w-3.5 h-3.5" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5" />
                    )}
                    {formatCropFeasibilityDetail(crop, lang)}
                  </span>
                </div>

                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-lg font-bold text-[#0F291E]">
                    {pickBilingual(crop.cropNames, lang)}
                  </h2>
                  <div className="text-right shrink-0">
                    <span className="text-xl font-bold font-mono tabular-nums text-stone-900">
                      {formatNumber(crop.scores.weightedSuitability, lang, 1)}
                    </span>
                    <span className="text-xs text-stone-500 font-mono">
                      /100
                    </span>
                  </div>
                </div>
                <div className="text-xs italic text-stone-500 mb-3">
                  {crop.scientificName} · {crop.growingDurationDays.min}–
                  {crop.growingDurationDays.max} {t('common.days')}
                </div>

                {/* Hard Constraints Check */}
                <div className="space-y-2 py-3 border-y border-stone-100 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-stone-500">
                      {t('simulator.sowingSuitability', { month: monthLabel })}
                    </span>
                    <span
                      className={`font-medium text-right ${
                        crop.seasonalSuitability === 'out_of_season'
                          ? 'text-red-700 font-semibold'
                          : crop.seasonalSuitability === 'shoulder'
                            ? 'text-amber-700'
                            : 'text-emerald-800'
                      }`}
                    >
                      {renderSeasonalLabel(crop.seasonalSuitability)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-stone-500">
                      {t('simulator.totalCropDemand')}
                    </span>
                    <span className="font-mono tabular-nums text-stone-800">
                      {formatNumber(
                        crop.waterEvaluation.scenarioTotalCropDemandMmHa,
                        lang,
                        0
                      )}{' '}
                      mm/ha
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-stone-500">
                      {t('simulator.suppIrrigNeeded')}
                    </span>
                    <span
                      className={`font-mono tabular-nums font-medium ${
                        crop.waterEvaluation.satisfiesWaterConstraint
                          ? 'text-stone-900'
                          : 'text-red-700 font-semibold'
                      }`}
                    >
                      {formatNumber(
                        crop.waterEvaluation.additionalIrrigationRequiredM3,
                        lang,
                        0
                      )}{' '}
                      /{' '}
                      {formatNumber(
                        crop.waterEvaluation.availableIrrigationTotalM3,
                        lang,
                        0
                      )}{' '}
                      m³
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-stone-500">
                      {t('simulator.totalCostBudget')}
                    </span>
                    <span
                      className={`font-mono tabular-nums font-medium ${
                        crop.financialEvaluation.satisfiesBudgetConstraint
                          ? 'text-stone-900'
                          : 'text-red-700 font-semibold'
                      }`}
                    >
                      {formatCurrency(
                        crop.financialEvaluation.totalFarmInputCost,
                        farm.currency,
                        lang
                      )}{' '}
                      /{' '}
                      {formatCurrency(
                        crop.financialEvaluation.availableFarmBudget,
                        farm.currency,
                        lang
                      )}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-stone-500">
                      {t('simulator.expectedYield', {
                        area: formatNumber(farm.areaHa, lang, 1),
                      })}
                    </span>
                    <span className="font-mono tabular-nums text-stone-900">
                      {formatNumber(
                        crop.financialEvaluation.totalFarmYieldTons.expected,
                        lang,
                        1
                      )}{' '}
                      t
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-stone-500">
                      {t('simulator.netMargin')}
                    </span>
                    <span className="font-mono tabular-nums font-semibold text-stone-900">
                      {formatCurrency(
                        crop.financialEvaluation.netProfitRange.expected,
                        farm.currency,
                        lang
                      )}
                    </span>
                  </div>
                </div>

                {/* Component Scores Breakdown */}
                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-stone-600 font-mono tabular-nums">
                  <div>
                    {t('simulator.scoreSoil')}: {crop.scores.soilCompatibility}
                    /100
                  </div>
                  <div>
                    {t('simulator.scoreResilience')}:{' '}
                    {crop.scores.climateResilience}/100
                  </div>
                  <div>
                    {t('simulator.scoreWater')}: {crop.scores.waterEfficiency}
                    /100
                  </div>
                  <div>
                    {t('simulator.scoreProfit')}: {crop.scores.profitPotential}
                    /100
                  </div>
                </div>

                {/* Constraint Violation or Sensitivity Note */}
                {reasonList.length > 0 ? (
                  <div className="mt-3 p-2.5 rounded-lg bg-red-50 border border-red-200 text-[11px] text-red-900 leading-snug">
                    {reasonList.join(' ')}
                  </div>
                ) : uncertList.length > 0 ? (
                  <div className="mt-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 leading-snug">
                    {uncertList[0]}
                  </div>
                ) : (
                  <div className="mt-3 text-[11px] text-stone-500 leading-snug">
                    {t('simulator.riskLevelPrefix')}{' '}
                    <strong className="text-stone-800">
                      {formatRiskLevelLabel(
                        crop.riskProfile.overallRiskLevel,
                        lang
                      )}
                    </strong>{' '}
                    ·{' '}
                    {pickBilingual(
                      crop.riskProfile.keySensitivities[0],
                      lang
                    )}
                  </div>
                )}
              </div>

              <div className="mt-4 pt-2.5 border-t border-stone-100 text-[11px] text-stone-400">
                {t('simulator.cardFooter', { soil: soilLabel })}
              </div>
            </article>
          );
        })}
      </section>

      {/* Interactive Detailed Comparison Table */}
      <section className="bg-white border border-stone-200/90 rounded-xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-bold text-[#0F291E]">
              {t('simulator.matrixTitle', { scenario: scenarioLabel })}
            </h2>
            <p className="text-xs text-stone-500 mt-0.5">
              {t('simulator.matrixSub', {
                area: formatNumber(farm.areaHa, lang, 1),
              })}
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-stone-100 rounded-lg">
            <button
              type="button"
              onClick={() => setFilterFeasibleOnly(false)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                !filterFeasibleOnly
                  ? 'bg-white text-stone-900 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              {t('simulator.allCandidatesBtn')}
            </button>
            <button
              type="button"
              onClick={() => setFilterFeasibleOnly(true)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                filterFeasibleOnly
                  ? 'bg-white text-stone-900 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              {t('simulator.feasibleOnlyBtn', {
                count: simulation.feasibleCropsCount,
              })}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-stone-200 text-stone-500">
                <th className="py-2.5 pr-3 font-semibold">
                  {t('simulator.thCrop')}
                </th>
                <th className="py-2.5 px-3 font-semibold">
                  {t('simulator.thSeason')}
                </th>
                <th className="py-2.5 px-3 font-semibold">
                  {t('simulator.thFeasibility')}
                </th>
                <th className="py-2.5 px-3 font-semibold text-right">
                  {t('simulator.thSuitability')}
                </th>
                <th className="py-2.5 px-3 font-semibold text-right">
                  {t('simulator.thTotalDemand')}
                </th>
                <th className="py-2.5 px-3 font-semibold text-right">
                  {t('simulator.thSuppIrrig')}
                </th>
                <th className="py-2.5 px-3 font-semibold text-right">
                  {t('simulator.thIrrigMargin')}
                </th>
                <th className="py-2.5 px-3 font-semibold text-right">
                  {t('simulator.thCost')}
                </th>
                <th className="py-2.5 px-3 font-semibold text-right">
                  {t('simulator.thProfit')}
                </th>
                <th className="py-2.5 pl-3 font-semibold">
                  {t('simulator.thRisk')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {displayedRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="py-6 text-center text-stone-500 text-xs"
                  >
                    {t('simulator.noFeasibleRow')}
                  </td>
                </tr>
              ) : (
                displayedRows.map((row) => (
                  <tr key={row.cropId} className="hover:bg-stone-50/70">
                    <td className="py-3 pr-3 font-semibold text-stone-900">
                      {pickBilingual(row.cropNames, lang)}
                    </td>
                    <td className="py-3 px-3 text-stone-700">
                      {renderSeasonalLabel(row.seasonalSuitability)}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`font-semibold uppercase ${
                          row.feasibilityStatus === 'feasible'
                            ? 'text-emerald-800'
                            : row.feasibilityStatus === 'uncertain'
                              ? 'text-amber-700'
                              : 'text-red-700'
                        }`}
                      >
                        {formatCropFeasibilityDetail(row, lang)}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-stone-900">
                      {formatNumber(row.scores.weightedSuitability, lang, 1)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-stone-700">
                      {formatNumber(
                        row.waterEvaluation.scenarioTotalCropDemandMmHa,
                        lang,
                        0
                      )}{' '}
                      mm (
                      {formatNumber(
                        row.waterEvaluation.estimatedEffectiveSeasonRainMmHa,
                        lang,
                        0
                      )}{' '}
                      mm)
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-stone-700">
                      {formatNumber(
                        row.waterEvaluation.additionalIrrigationRequiredM3,
                        lang,
                        0
                      )}{' '}
                      m³ (
                      {formatNumber(
                        row.waterEvaluation.additionalIrrigationRequiredMmHa,
                        lang,
                        0
                      )}{' '}
                      mm/ha)
                    </td>
                    <td
                      className={`py-3 px-3 text-right font-mono tabular-nums ${
                        row.waterEvaluation.irrigationSurplusOrDeficitM3 >= 0
                          ? 'text-emerald-800'
                          : 'text-red-700 font-semibold'
                      }`}
                    >
                      {row.waterEvaluation.irrigationSurplusOrDeficitM3 >= 0
                        ? '+'
                        : ''}
                      {formatNumber(
                        row.waterEvaluation.irrigationSurplusOrDeficitM3,
                        lang,
                        0
                      )}{' '}
                      m³
                    </td>
                    <td
                      className={`py-3 px-3 text-right font-mono tabular-nums ${
                        row.financialEvaluation.satisfiesBudgetConstraint
                          ? 'text-stone-800'
                          : 'text-red-700 font-semibold'
                      }`}
                    >
                      {formatCurrency(
                        row.financialEvaluation.totalFarmInputCost,
                        farm.currency,
                        lang
                      )}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-stone-800">
                      {formatCurrency(
                        row.financialEvaluation.netProfitRange.low,
                        farm.currency,
                        lang
                      )}{' '}
                      –{' '}
                      {formatCurrency(
                        row.financialEvaluation.netProfitRange.high,
                        farm.currency,
                        lang
                      )}
                    </td>
                    <td className="py-3 pl-3">
                      <span className="font-mono tabular-nums text-stone-700">
                        {formatRiskLevelLabel(
                          row.riskProfile.overallRiskLevel,
                          lang
                        )}{' '}
                        ({row.riskProfile.overallRiskScore}/100)
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
