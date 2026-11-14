import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CloudRain,
  Compass,
  Droplets,
  Languages,
  Play,
  ShieldAlert,
  ShieldCheck,
  Sprout,
  Wallet,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import heroKarlsruheUrl from '../assets/images/agrovera_karlsruhe_farmland_1794659995413.jpg';
import { checkForecastSowingAlignment } from '../engine/weather.ts';
import type {
  AgenticEvaluationResponse,
  AppLanguage,
  FarmProfile,
  NavigationTab,
  SimulationRunOutput,
  WeatherForecastAnalysis,
} from '../types/domain.ts';
import {
  deriveDashboardState,
  formatClassificationLabel,
  formatCropFeasibilityDetail,
  formatCropName,
  formatCurrency,
  formatMonthName,
  formatNumber,
  formatPriorityLabel,
  formatSoilName,
  pickBilingual,
} from '../utils/formatters.ts';

interface OverviewViewProps {
  farm: FarmProfile;
  weather: WeatherForecastAnalysis | null;
  simulation: SimulationRunOutput;
  evaluation: AgenticEvaluationResponse | null;
  hasStaleEvaluation?: boolean;
  isEvaluating: boolean;
  elapsedSeconds?: number;
  onRunEvaluation: () => void;
  onNavigate: (tab: NavigationTab) => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  farm,
  weather,
  simulation,
  evaluation,
  hasStaleEvaluation = false,
  isEvaluating,
  elapsedSeconds = 0,
  onRunEvaluation,
  onNavigate,
}) => {
  const { t, i18n } = useTranslation();
  const lang: AppLanguage = i18n.language === 'de' ? 'de' : 'en';
  const [imgFailed, setImgFailed] = useState(false);

  const derived = deriveDashboardState(
    farm,
    simulation,
    weather,
    evaluation,
    lang
  );

  const weatherAlignment = checkForecastSowingAlignment(
    weather,
    farm.plantingMonth
  );

  const chartData = simulation.cropResults.map((crop) => ({
    name: pickBilingual(crop.cropNames, lang),
    suitability: crop.scores.weightedSuitability,
    climateRisk: crop.riskProfile.overallRiskScore,
    feasible: crop.feasibilityStatus === 'feasible',
    status: crop.feasibilityStatus,
  }));

  const topCrop = derived.recommendedCrop;
  const scenarioLabel = pickBilingual(simulation.scenario.names, lang);
  const soilLabel = formatSoilName(farm.soilType, lang);
  const monthLabel = formatMonthName(farm.plantingMonth, lang);
  const forecastMonthLabel = weatherAlignment.forecastStartMonth
    ? formatMonthName(weatherAlignment.forecastStartMonth, lang)
    : '';

  return (
    <div className="space-y-8">
      {/* Hero Decision Banner */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-7 bg-white border border-stone-200/90 rounded-xl p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500 mb-3">
              <span className="font-medium text-emerald-800">
                {farm.isSampleProfile
                  ? t('overview.sampleFarmBadge')
                  : t('overview.verifiedFarmerBadge')}
              </span>
              <span aria-hidden="true">·</span>
              <span>{farm.locationName}</span>
              <span aria-hidden="true">·</span>
              <span>{t('overview.plantingIn', { month: monthLabel })}</span>
              <span aria-hidden="true">·</span>
              <span>{scenarioLabel}</span>
            </div>

            <h1
              className="text-2xl sm:text-3xl font-bold text-[#0F291E] leading-tight mb-3"
              style={{ textWrap: 'balance' }}
            >
              {derived.activeHeadline}
            </h1>

            <p className="text-sm sm:text-base text-stone-600 leading-relaxed max-w-2xl">
              {evaluation?.decision?.executiveSummary &&
              derived.isEvaluationLanguageMatched
                ? evaluation.decision.executiveSummary
                : t('overview.defaultSummary', {
                    area: formatNumber(farm.areaHa, lang, 1),
                    soil:
                      lang === 'de' ? soilLabel : soilLabel.toLowerCase(),
                    location: farm.locationName,
                    waterM3: formatNumber(
                      simulation.farmSummary.availableIrrigationTotalM3,
                      lang,
                      0
                    ),
                    waterMm: formatNumber(
                      simulation.farmSummary.availableIrrigationMmHa,
                      lang,
                      1
                    ),
                    budget: formatCurrency(
                      farm.budgetAmount,
                      farm.currency,
                      lang
                    ),
                  })}
            </p>

            {/* Honest language-mismatch notice if user toggled EN <-> DE after an AI run */}
            {evaluation && !derived.isEvaluationLanguageMatched && (
              <div className="mt-4 p-3 rounded-lg bg-amber-50/90 border border-amber-200 text-xs text-amber-950 flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-1.5">
                  <Languages className="w-4 h-4 text-amber-800 shrink-0" />
                  {t('overview.staleLangNotice')}
                </span>
                <button
                  type="button"
                  onClick={onRunEvaluation}
                  disabled={isEvaluating}
                  className="font-semibold text-amber-950 underline cursor-pointer shrink-0"
                >
                  {t('overview.regenerateInLang')}
                </button>
              </div>
            )}

            {/* Honest stale-parameters notice when farm or scenario inputs changed after an AI run */}
            {!evaluation && hasStaleEvaluation && !isEvaluating && (
              <div className="mt-4 p-3 rounded-lg bg-amber-50/90 border border-amber-200 text-xs text-amber-950 flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-800 shrink-0" />
                  {t('overview.staleParamsNotice')}
                </span>
                <button
                  type="button"
                  onClick={onRunEvaluation}
                  disabled={isEvaluating}
                  className="font-semibold text-amber-950 underline cursor-pointer shrink-0"
                >
                  {t('overview.rerunUpdatedBtn')}
                </button>
              </div>
            )}
          </div>

          <div className="mt-6 pt-5 border-t border-stone-100 flex flex-wrap items-center justify-between gap-4">
            <div className="text-xs text-stone-600 flex items-center gap-2">
              {evaluation?.validationGate?.passed ? (
                <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
              ) : (
                <Compass className="w-4 h-4 text-amber-700 shrink-0" />
              )}
              <span>{derived.verificationLabel}</span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onRunEvaluation}
                disabled={isEvaluating}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#0F291E] hover:bg-[#163B2B] disabled:opacity-60 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Play className="w-4 h-4" />
                {isEvaluating
                  ? t('overview.runningBtn')
                  : evaluation
                    ? t('overview.rerunFullBtn')
                    : t('overview.runFullBtn')}
              </button>

              <button
                type="button"
                onClick={() => onNavigate('scenarios')}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-stone-300 bg-white hover:bg-stone-50 text-stone-800 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {t('overview.stressTestBtn')}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Visual Farm Context Card with Zero-Broken-Image Fallback */}
        <div className="lg:col-span-5 relative rounded-xl overflow-hidden border border-stone-200/90 min-h-[260px] bg-gradient-to-br from-[#0F291E] via-[#17402F] to-[#23533D] flex flex-col justify-end">
          {!imgFailed && (
            <img
              src={heroKarlsruheUrl}
              alt="Aerial view of Upper Rhine agricultural fields near Karlsruhe, Baden-Württemberg, Germany"
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className="absolute inset-0 w-full h-full object-cover"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#091A12]/92 via-[#091A12]/55 to-[#091A12]/18" />

          <div className="relative z-10 p-6 text-white space-y-3">
            <div className="text-xs text-emerald-200/90 font-medium">
              {t('overview.activeConstraints')} ·{' '}
              {formatPriorityLabel(farm.priorityMode, lang)}
            </div>
            <div className="grid grid-cols-2 gap-4 pt-1">
              <div>
                <div className="text-xs text-stone-300">
                  {t('overview.landAndSoil')}
                </div>
                <div className="text-lg font-semibold font-mono tabular-nums">
                  {formatNumber(farm.areaHa, lang, 1)} ha · {soilLabel}
                </div>
              </div>
              <div>
                <div className="text-xs text-stone-300">
                  {t('overview.irrigationVolume')}
                </div>
                <div className="text-lg font-semibold font-mono tabular-nums">
                  {formatNumber(
                    simulation.farmSummary.availableIrrigationTotalM3,
                    lang,
                    0
                  )}{' '}
                  m³
                </div>
                <div className="text-[11px] text-stone-300 font-mono tabular-nums">
                  ({formatNumber(
                    simulation.farmSummary.availableIrrigationMmHa,
                    lang,
                    1
                  )}{' '}
                  mm/ha)
                </div>
              </div>
              <div>
                <div className="text-xs text-stone-300">
                  {t('overview.inputBudget')}
                </div>
                <div className="text-lg font-semibold font-mono tabular-nums">
                  {formatCurrency(farm.budgetAmount, farm.currency, lang)}
                </div>
              </div>
              <div>
                <div className="text-xs text-stone-300">
                  {t('overview.feasibleCandidates')}
                </div>
                <div className="text-lg font-semibold font-mono tabular-nums">
                  {t('overview.cropsCount', {
                    feasible: derived.feasibleCount,
                    total: simulation.cropResults.length,
                  })}
                </div>
              </div>
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => onNavigate('farm-setup')}
                className="text-xs font-medium text-emerald-200 hover:text-white underline underline-offset-4 cursor-pointer"
              >
                {t('overview.editProfileLink')}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Truthful Progress Banner during Gemini Analysis */}
      {isEvaluating && (
        <section
          role="status"
          className="bg-[#F2F7F4] border border-[#CDE0D4] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 text-xs font-semibold text-[#0F291E]"
        >
          <span className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-700 animate-ping" />
            {elapsedSeconds < 3
              ? t('progress.planStage1')
              : elapsedSeconds < 7
                ? t('progress.planStage2')
                : elapsedSeconds < 14
                  ? t('progress.planStage3')
                  : t('progress.planStage4')}
          </span>
          <span className="font-mono tabular-nums text-stone-600">
            {t('progress.elapsed', { sec: elapsedSeconds })}
          </span>
        </section>
      )}

      {/* AI Error Banner if model or API key failed */}
      {evaluation?.aiError && (
        <section
          role="alert"
          className="bg-red-50 border border-red-200 rounded-xl p-5 text-red-950"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold">
                {t('overview.aiErrorTitle', {
                  model: evaluation.aiError.model,
                  stage: evaluation.aiError.stage,
                })}
              </h2>
              <p className="text-sm text-red-900">
                {evaluation.aiError.message}
              </p>
              <p className="text-xs text-red-800 pt-1">
                {t('overview.aiErrorNote')}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Provenance & Epistemic Transparency Strip */}
      <section className="bg-[#EEF3EF] border border-[#D5E1D8] rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 text-xs text-[#1B3B2B]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold">{t('overview.provenanceTitle')}</span>
          <span>{t('overview.provVerified')}</span>
          <span aria-hidden="true">·</span>
          <span>{t('overview.provForecast')}</span>
          <span aria-hidden="true">·</span>
          <span>{t('overview.provIllustrative')}</span>
          <span aria-hidden="true">·</span>
          <span>{t('overview.provAi')}</span>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('data-sources')}
          className="text-xs font-semibold text-emerald-900 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
        >
          {t('overview.inspectSourcesBtn')}
        </button>
      </section>

      {/* Top Recommendation + Forecast Summary Split */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-7 bg-white border border-stone-200/90 rounded-xl p-6 flex flex-col justify-between">
          {topCrop ? (
            <>
              <div>
                <div className="flex flex-wrap items-center justify-between gap-4 mb-2">
                  <div className="text-xs text-stone-500">
                    {topCrop.feasibilityStatus === 'feasible'
                      ? t('overview.topFeasibleHeader')
                      : t('overview.topPreliminaryHeader')}{' '}
                    · {pickBilingual(topCrop.category, lang)} ·{' '}
                    {formatClassificationLabel(
                      topCrop.financialEvaluation.yieldClassification,
                      lang
                    )}{' '}
                    (Destatis)
                  </div>
                  <div className="flex items-center gap-2 text-xs font-mono tabular-nums font-semibold">
                    <span
                      className={
                        topCrop.feasibilityStatus === 'feasible'
                          ? 'text-emerald-800'
                          : 'text-amber-700'
                      }
                    >
                      {formatCropFeasibilityDetail(topCrop, lang)}
                    </span>
                    <span className="text-stone-400" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-emerald-800">
                      {t('overview.suitabilityScore', {
                        score: formatNumber(
                          topCrop.scores.weightedSuitability,
                          lang,
                          1
                        ),
                      })}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
                  <div>
                    <h2 className="text-2xl font-bold text-[#0F291E]">
                      {pickBilingual(topCrop.cropNames, lang)}{' '}
                      <span className="text-sm font-normal italic text-stone-500">
                        ({topCrop.scientificName})
                      </span>
                    </h2>
                  </div>
                  <div className="text-xs text-stone-600 font-mono tabular-nums">
                    {t('overview.growingCycle', {
                      min: topCrop.growingDurationDays.min,
                      max: topCrop.growingDurationDays.max,
                      window: pickBilingual(topCrop.plantingWindowLabel, lang),
                    })}
                  </div>
                </div>

                {/* Resource & Financial Metrics Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-4 border-y border-stone-100">
                  <div>
                    <div className="text-xs text-stone-500 flex items-center gap-1.5">
                      <Wallet className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                      {t('overview.netProfitLabel', {
                        area: formatNumber(farm.areaHa, lang, 1),
                      })}
                    </div>
                    <div className="text-lg font-semibold font-mono tabular-nums text-stone-900 mt-1">
                      {formatCurrency(
                        topCrop.financialEvaluation.netProfitRange.expected,
                        farm.currency,
                        lang
                      )}
                    </div>
                    <div className="text-xs text-stone-500 font-mono tabular-nums">
                      {t('overview.rangeFromTo', {
                        low: formatCurrency(
                          topCrop.financialEvaluation.netProfitRange.low,
                          farm.currency,
                          lang
                        ),
                        high: formatCurrency(
                          topCrop.financialEvaluation.netProfitRange.high,
                          farm.currency,
                          lang
                        ),
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-stone-500 flex items-center gap-1.5">
                      <Sprout className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                      {t('overview.inputCostVsBudget')}
                    </div>
                    <div className="text-lg font-semibold font-mono tabular-nums text-stone-900 mt-1">
                      {formatCurrency(
                        topCrop.financialEvaluation.totalFarmInputCost,
                        farm.currency,
                        lang
                      )}
                    </div>
                    <div className="text-xs text-stone-500 font-mono tabular-nums">
                      {t('overview.pctOfBudget', {
                        pct: formatNumber(
                          topCrop.financialEvaluation.budgetUtilizationPct,
                          lang,
                          1
                        ),
                        budget: formatCurrency(
                          farm.budgetAmount,
                          farm.currency,
                          lang
                        ),
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-stone-500 flex items-center gap-1.5">
                      <Droplets className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                      {t('overview.suppIrrigationLabel')}
                    </div>
                    <div className="text-lg font-semibold font-mono tabular-nums text-stone-900 mt-1">
                      {formatNumber(
                        topCrop.waterEvaluation.additionalIrrigationRequiredM3,
                        lang,
                        0
                      )}{' '}
                      /{' '}
                      {formatNumber(
                        topCrop.waterEvaluation.availableIrrigationTotalM3,
                        lang,
                        0
                      )}{' '}
                      m³
                    </div>
                    <div className="text-xs text-stone-500 font-mono tabular-nums">
                      {t('overview.totalCropDemandNote', {
                        demand: formatNumber(
                          topCrop.waterEvaluation.scenarioTotalCropDemandMmHa,
                          lang,
                          0
                        ),
                        margin: `${topCrop.waterEvaluation.irrigationSurplusOrDeficitM3 >= 0 ? '+' : ''}${formatNumber(topCrop.waterEvaluation.irrigationSurplusOrDeficitM3, lang, 0)}`,
                      })}
                    </div>
                  </div>
                </div>

                {/* Alternative Candidates Quick Comparison */}
                <div className="mt-4">
                  <h3 className="text-xs font-semibold text-stone-700 mb-2.5">
                    {t('overview.alternativesHeader', {
                      count: derived.alternativeCrops.length,
                    })}
                  </h3>
                  <div className="divide-y divide-stone-100">
                    {derived.alternativeCrops.map((alt) => {
                      const firstReason = alt.infeasibilityReasonsBilingual[0]
                        ? pickBilingual(
                            alt.infeasibilityReasonsBilingual[0],
                            lang
                          )
                        : null;
                      return (
                        <div
                          key={alt.cropId}
                          className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm"
                        >
                          <div className="min-w-0">
                            <span className="font-medium text-stone-900">
                              {pickBilingual(alt.cropNames, lang)}
                            </span>
                            <span
                              className="text-stone-400 mx-1.5"
                              aria-hidden="true"
                            >
                              ·
                            </span>
                            <span
                              className={`text-xs font-medium ${
                                alt.feasibilityStatus === 'feasible'
                                  ? 'text-emerald-700'
                                  : alt.feasibilityStatus === 'uncertain'
                                    ? 'text-amber-700'
                                    : 'text-red-700'
                              }`}
                            >
                              {formatCropFeasibilityDetail(alt, lang)}
                            </span>
                            {firstReason && (
                              <p className="text-xs text-red-700 mt-0.5 max-w-xl">
                                {firstReason}
                              </p>
                            )}
                          </div>
                          <div className="text-xs font-mono tabular-nums text-stone-600 shrink-0">
                            {t('overview.scoreShort')}{' '}
                            {formatNumber(
                              alt.scores.weightedSuitability,
                              lang,
                              1
                            )}{' '}
                            · {t('overview.costShort')}{' '}
                            {formatCurrency(
                              alt.financialEvaluation.totalFarmInputCost,
                              farm.currency,
                              lang
                            )}{' '}
                            · {t('overview.irrigShort')}{' '}
                            {formatNumber(
                              alt.waterEvaluation
                                .additionalIrrigationRequiredM3,
                              lang,
                              0
                            )}{' '}
                            m³
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-stone-100 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-stone-500">
                  {t('overview.benchmarkDisclaimer')}
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('simulator')}
                  className="text-xs font-semibold text-emerald-800 hover:text-emerald-950 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {t('overview.openSimulatorLink')}
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-amber-800">
                <ShieldAlert className="w-5 h-5 shrink-0" />
                <h2 className="text-lg font-bold">
                  {t('overview.noFeasibleTitle')}
                </h2>
              </div>
              <p className="text-sm text-stone-600">
                {t('overview.noFeasibleDesc', {
                  month: monthLabel,
                  waterM3: formatNumber(
                    simulation.farmSummary.availableIrrigationTotalM3,
                    lang,
                    0
                  ),
                  budget: formatCurrency(
                    farm.budgetAmount,
                    farm.currency,
                    lang
                  ),
                })}
              </p>
              <div className="space-y-2 pt-2">
                {simulation.cropResults.map((c) => (
                  <div
                    key={c.cropId}
                    className="text-xs text-stone-700 py-1.5 border-b border-stone-100"
                  >
                    <strong>{pickBilingual(c.cropNames, lang)}:</strong>{' '}
                    {c.infeasibilityReasonsBilingual
                      .map((r) => pickBilingual(r, lang))
                      .join(' ') ||
                      c.uncertaintyReasonsBilingual
                        .map((u) => pickBilingual(u, lang))
                        .join(' ')}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => onNavigate('farm-setup')}
                className="px-4 py-2 rounded-lg bg-[#0F291E] text-white text-xs font-medium cursor-pointer"
              >
                {t('overview.adjustSetupBtn')}
              </button>
            </div>
          )}
        </div>

        {/* Climate & Forecast Snapshot */}
        <div className="lg:col-span-5 bg-white border border-stone-200/90 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs text-stone-500">
                {t('overview.liveWeatherBadge')}
              </span>
              <CloudRain className="w-4 h-4 text-stone-400" />
            </div>
            <h2 className="text-lg font-bold text-[#0F291E] mb-1">
              {weather?.status === 'ok' && !weatherAlignment.aligned
                ? t('overview.currentWeatherTitle', { month: monthLabel })
                : t('overview.climateCardTitle')}
            </h2>

            {weather &&
            weather.status === 'ok' &&
            weather.summary &&
            weather.forecastPeriod ? (
              <div className="space-y-4 mt-3">
                <div className="text-xs text-stone-500 font-mono tabular-nums">
                  {t('overview.forecastWindow', {
                    start: weather.forecastPeriod.startDate,
                    end: weather.forecastPeriod.endDate,
                    days: weather.forecastPeriod.days,
                  })}
                </div>

                {!weatherAlignment.aligned && forecastMonthLabel && (
                  <div className="p-2.5 rounded-lg bg-amber-50/90 border border-amber-200 text-[11px] text-amber-950 leading-snug">
                    {t('overview.seasonalWeatherMismatchNote', {
                      forecastMonth: forecastMonthLabel,
                      sowingMonth: monthLabel,
                    })}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-3 py-3 border-y border-stone-100">
                  <div>
                    <div className="text-xs text-stone-500">
                      {t('overview.peakHigh')}
                    </div>
                    <div className="text-base font-semibold font-mono tabular-nums text-stone-900">
                      {formatNumber(weather.summary.peakMaxTempC, lang, 1)} °C
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-stone-500">
                      {t('overview.lowestNight')}
                    </div>
                    <div className="text-base font-semibold font-mono tabular-nums text-stone-900">
                      {formatNumber(weather.summary.lowestMinTempC, lang, 1)} °C
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-stone-500">
                      {t('overview.windowRain', {
                        days: weather.forecastPeriod.days,
                      })}
                    </div>
                    <div className="text-base font-semibold font-mono tabular-nums text-stone-900">
                      {formatNumber(weather.summary.totalPrecipMm, lang, 1)} mm
                    </div>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {weather.riskIndicators.map((ind) => (
                    <div
                      key={ind.id}
                      className="flex items-start justify-between gap-3 text-xs"
                    >
                      <div>
                        <span className="font-medium text-stone-800">
                          {pickBilingual(ind.labelBilingual, lang)}
                        </span>
                        <p className="text-stone-500 mt-0.5 leading-snug">
                          {pickBilingual(ind.observedMetricBilingual, lang)} (
                          {t('overview.thresholdLabel', {
                            thresh: ind.thresholdMetric,
                          })}
                          )
                        </p>
                      </div>
                      <span
                        className={`font-mono font-semibold shrink-0 uppercase ${
                          ind.severity === 'high'
                            ? 'text-red-700'
                            : ind.severity === 'moderate'
                              ? 'text-amber-700'
                              : 'text-emerald-700'
                        }`}
                      >
                        {ind.triggered
                          ? t(`common.${ind.severity}`)
                          : t('common.nominal')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="py-6 space-y-3">
                <p className="text-sm text-stone-600">
                  {weather?.errorMessage
                    ? t('overview.weatherUnavailable', {
                        msg: pickBilingual(
                          weather.errorMessageBilingual ?? weather.errorMessage,
                          lang
                        ),
                      })
                    : t('overview.weatherNotFetched')}
                </p>
                <button
                  type="button"
                  onClick={onRunEvaluation}
                  disabled={isEvaluating}
                  className="px-3.5 py-2 rounded-lg border border-stone-300 text-xs font-medium text-stone-800 hover:bg-stone-50 cursor-pointer"
                >
                  {t('overview.fetchWeatherBtn')}
                </button>
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-stone-100 flex items-center justify-between gap-2">
            <span className="text-[11px] text-stone-500">
              {t('overview.horizonShortNote')}
            </span>
            <button
              type="button"
              onClick={() => onNavigate('climate')}
              className="text-xs font-semibold text-emerald-800 hover:text-emerald-950 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {t('overview.climateIntelLink')}
            </button>
          </div>
        </div>
      </section>

      {/* Suitability vs Climate Risk Visualization */}
      <section className="bg-white border border-stone-200/90 rounded-xl p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-5">
          <div>
            <h2 className="text-lg font-bold text-[#0F291E]">
              {t('overview.chartTitle')}
            </h2>
            <p className="text-xs text-stone-500 mt-0.5">
              {t('overview.chartSubtitle', { scenario: scenarioLabel })}
            </p>
          </div>
          <div className="text-xs text-stone-500 font-mono tabular-nums">
            {t('overview.weightsSummary', {
              profit: Math.round(simulation.weightsNormalized.profit * 100),
              resilience: Math.round(
                simulation.weightsNormalized.climateResilience * 100
              ),
              water: Math.round(
                simulation.weightsNormalized.waterEfficiency * 100
              ),
              soil: Math.round(simulation.weightsNormalized.soilMatch * 100),
            })}
          </div>
        </div>

        <div className="h-72 w-full" data-testid="overview-suitability-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 10, right: 20, left: 0, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#E7E5E4"
                vertical={false}
              />
              <XAxis
                dataKey="name"
                tick={{ fill: '#44403C', fontSize: 12 }}
                axisLine={{ stroke: '#D6D3D1' }}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: '#57534E', fontSize: 12 }}
                axisLine={{ stroke: '#D6D3D1' }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#FFFFFF',
                  borderColor: '#D6D3D1',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Bar
                dataKey="suitability"
                name={t('overview.barSuitability')}
                radius={[4, 4, 0, 0]}
              >
                {chartData.map((entry, idx) => (
                  <Cell
                    key={`suit-${idx}`}
                    fill={
                      entry.status === 'feasible'
                        ? '#059669'
                        : entry.status === 'uncertain'
                          ? '#0D9488'
                          : '#A8A29E'
                    }
                  />
                ))}
              </Bar>
              <Bar
                dataKey="climateRisk"
                name={t('overview.barClimateRisk')}
                fill="#D97706"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-stone-500 mt-2">
          {t('overview.chartGrayNote')}
        </p>
      </section>

      {/* Latest Decision Agent, Independent Critic Agent & Actionable Next Steps */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-4 bg-white border border-stone-200/90 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <div className="text-xs text-stone-500 mb-1">
              {t('overview.decisionCardSub')}
            </div>
            <h2 className="text-base font-bold text-[#0F291E] mb-3">
              {t('overview.decisionCardTitle')}
            </h2>

            {evaluation?.decision ? (
              <div className="space-y-3 text-sm text-stone-700">
                <div>
                  <div className="text-xs font-semibold text-stone-900">
                    {t('overview.finTradeoff')}
                  </div>
                  <p className="text-xs text-stone-600 leading-relaxed mt-0.5">
                    {evaluation.decision.tradeoffAnalysis.financial}
                  </p>
                </div>
                <div>
                  <div className="text-xs font-semibold text-stone-900">
                    {t('overview.climTradeoff')}
                  </div>
                  <p className="text-xs text-stone-600 leading-relaxed mt-0.5">
                    {
                      evaluation.decision.tradeoffAnalysis
                        .climateAndEnvironmental
                    }
                  </p>
                </div>
                <div>
                  <div className="text-xs font-semibold text-stone-900">
                    {t('overview.waterTradeoff')}
                  </div>
                  <p className="text-xs text-stone-600 leading-relaxed mt-0.5">
                    {evaluation.decision.tradeoffAnalysis.waterAndSoilResources}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-stone-500">
                {t('overview.decisionEmpty')}
              </p>
            )}
          </div>
          <div className="mt-4 pt-3 border-t border-stone-100">
            <button
              type="button"
              onClick={() => onNavigate('decision-center')}
              className="text-xs font-semibold text-emerald-800 hover:text-emerald-950 cursor-pointer"
            >
              {t('overview.inspectDecisionLink')}
            </button>
          </div>
        </div>

        <div className="lg:col-span-4 bg-white border border-stone-200/90 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <div className="text-xs text-stone-500 mb-1">
              {t('overview.criticCardSub')}
            </div>
            <h2 className="text-base font-bold text-[#0F291E] mb-3">
              {t('overview.criticCardTitle')}
            </h2>

            {evaluation?.critic ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  {evaluation.critic.verdict === 'pass' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                  )}
                  <span className="text-stone-900">
                    {t('overview.criticVerdictLabel', {
                      verdict: t(`common.${evaluation.critic.verdict}`),
                    })}
                    {evaluation.critic.moreRobustAlternativeId !== 'none' &&
                      ` · ${t('overview.robustAltLabel', {
                        crop: formatCropName(
                          evaluation.critic.moreRobustAlternativeId,
                          lang
                        ),
                      })}`}
                  </span>
                </div>
                <p className="text-xs text-stone-600 leading-relaxed">
                  {evaluation.critic.criticSummary}
                </p>
                {evaluation.critic.objections.length > 0 && (
                  <ul className="space-y-1.5 pt-1">
                    {evaluation.critic.objections
                      .slice(0, 3)
                      .map((obj, idx) => (
                        <li key={idx} className="text-xs text-stone-600">
                          <strong className="text-stone-800">
                            [{obj.severity.toUpperCase()}]
                          </strong>{' '}
                          {obj.detail}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-sm text-stone-500">
                {t('overview.criticEmpty')}
              </p>
            )}
          </div>
          <div className="mt-4 pt-3 border-t border-stone-100 text-xs text-stone-500">
            {t('overview.criticFooter')}
          </div>
        </div>

        <div className="lg:col-span-4 bg-white border border-stone-200/90 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <div className="text-xs text-stone-500 mb-1">
              {t('overview.nextStepsSub')}
            </div>
            <h2 className="text-base font-bold text-[#0F291E] mb-3">
              {t('overview.nextStepsTitle')}
            </h2>

            {evaluation?.decision ? (
              <div className="space-y-3">
                <ol className="space-y-2 list-decimal list-inside text-xs text-stone-700 leading-relaxed">
                  {evaluation.decision.actionableNextSteps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
                <p className="text-[11px] text-amber-900 bg-amber-50/80 border border-amber-200/80 rounded-lg p-2.5 leading-snug">
                  {evaluation.decision.humanReviewNotice}
                </p>
              </div>
            ) : (
              <ol className="space-y-2 list-decimal list-inside text-xs text-stone-600 leading-relaxed">
                <li>{t('overview.defaultStep1')}</li>
                <li>{t('overview.defaultStep2')}</li>
                <li>{t('overview.defaultStep3')}</li>
              </ol>
            )}
          </div>
          <div className="mt-4 pt-3 border-t border-stone-100 text-[11px] text-stone-500">
            {t('overview.nextStepsFooter')}
          </div>
        </div>
      </section>
    </div>
  );
};
