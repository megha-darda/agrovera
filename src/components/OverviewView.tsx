import React from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Droplets,
  Languages,
  MapPin,
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

function extractFirstSentence(text: string): string {
  const cleaned = text.trim();
  if (!cleaned) return '';
  const match = cleaned.match(/^.+?[.!?](?:\s|$)/);
  return match ? match[0].trim() : cleaned;
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

  // One-sentence reasoning first
  const oneSentenceReason = React.useMemo(() => {
    if (
      evaluation?.decision?.executiveSummary &&
      derived.isEvaluationLanguageMatched
    ) {
      return extractFirstSentence(evaluation.decision.executiveSummary);
    }
    if (!topCrop) {
      return t('planFlow.noneFeasibleReason', {
        month: monthLabel,
        waterM3: formatNumber(
          simulation.farmSummary.availableIrrigationTotalM3,
          lang,
          0
        ),
        budget: formatCurrency(farm.budgetAmount, farm.currency, lang),
      });
    }
    const cropName = pickBilingual(topCrop.cropNames, lang);
    const scoreStr = formatNumber(topCrop.scores.weightedSuitability, lang, 1);
    if (topCrop.feasibilityStatus === 'feasible') {
      return t('planFlow.oneSentenceFallbackFeasible', {
        crop: cropName,
        score: scoreStr,
        area: formatNumber(farm.areaHa, lang, 1),
        soil: lang === 'de' ? soilLabel : soilLabel.toLowerCase(),
        month: monthLabel,
        waterM3: formatNumber(
          simulation.farmSummary.availableIrrigationTotalM3,
          lang,
          0
        ),
        budget: formatCurrency(farm.budgetAmount, farm.currency, lang),
      });
    }
    return t('planFlow.oneSentenceFallbackUncertain', {
      crop: cropName,
      score: scoreStr,
    });
  }, [
    derived.isEvaluationLanguageMatched,
    evaluation?.decision?.executiveSummary,
    farm.areaHa,
    farm.budgetAmount,
    farm.currency,
    lang,
    monthLabel,
    simulation.farmSummary.availableIrrigationTotalM3,
    soilLabel,
    t,
    topCrop,
  ]);

  const criticBadgeText = React.useMemo(() => {
    if (!evaluation || evaluation.aiError) return null;
    if (evaluation.validationGate?.passed && !evaluation.requiresHumanReview) {
      return {
        tone: 'text-emerald-800',
        icon: ShieldCheck,
        label: t('planFlow.criticPassedBadge'),
      };
    }
    if (evaluation.validationGate?.passed && evaluation.requiresHumanReview) {
      return {
        tone: 'text-amber-800',
        icon: AlertTriangle,
        label: t('planFlow.criticAdvisoryBadge'),
      };
    }
    return {
      tone: 'text-red-700',
      icon: ShieldAlert,
      label: t('planFlow.criticFailedBadge'),
    };
  }, [evaluation, t]);

  return (
    <div className="space-y-4" data-testid="plan-my-crop-view">
      {/* Compact Page Intro */}
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h1 className="text-lg sm:text-xl font-bold text-[#0F291E]">
            {t('planFlow.pageTitle')}
          </h1>
          <span className="text-xs sm:text-sm text-stone-500">
            {t('planFlow.pageSubtitle')}
          </span>
        </div>
        {simulation.scenario.id !== 'baseline' && (
          <span className="text-xs font-medium text-amber-800">
            {scenarioLabel}
          </span>
        )}
      </header>

      {/* STEP 1 — My Farm */}
      <section
        className="bg-white border border-stone-200/90 rounded-xl p-4 sm:p-5 space-y-3"
        data-testid="plan-step-1"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base sm:text-lg font-bold text-[#0F291E]">
            {t('planFlow.step1Title')}
          </h2>
          <button
            type="button"
            onClick={() => onNavigate('farm-setup')}
            className="px-3.5 py-1.5 rounded-lg border border-stone-300 bg-white hover:bg-stone-50 text-xs font-semibold text-stone-800 cursor-pointer"
          >
            {t('planFlow.editFarmBtn')}
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 pt-1 border-t border-stone-100">
          <div>
            <div className="text-xs text-stone-500 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-stone-400 shrink-0" />
              <span>{farm.country}</span>
            </div>
            <div className="text-sm font-semibold text-stone-900 mt-0.5 truncate">
              {farm.locationName}
            </div>
          </div>

          <div>
            <div className="text-xs text-stone-500">
              {t('planFlow.landSoil')}
            </div>
            <div className="text-sm font-semibold font-mono tabular-nums text-stone-900 mt-0.5">
              {formatNumber(farm.areaHa, lang, 1)} ha · {soilLabel}
            </div>
          </div>

          <div>
            <div className="text-xs text-stone-500">
              {t('planFlow.sowingMonth')}
            </div>
            <div className="text-sm font-semibold text-stone-900 mt-0.5">
              {monthLabel}
            </div>
          </div>

          <div>
            <div className="text-xs text-stone-500">
              {t('planFlow.waterReserve')}
            </div>
            <div className="text-sm font-semibold font-mono tabular-nums text-stone-900 mt-0.5">
              {formatNumber(
                simulation.farmSummary.availableIrrigationTotalM3,
                lang,
                0
              )}{' '}
              m³
            </div>
          </div>

          <div>
            <div className="text-xs text-stone-500">
              {t('planFlow.seasonBudget')}
            </div>
            <div className="text-sm font-semibold font-mono tabular-nums text-stone-900 mt-0.5">
              {formatCurrency(farm.budgetAmount, farm.currency, lang)}
            </div>
            <div className="text-[11px] text-stone-500 truncate">
              {formatPriorityLabel(farm.priorityMode, lang)}
            </div>
          </div>
        </div>
      </section>

      {/* STEP 2 — Crop Comparison */}
      <section
        className="bg-white border border-stone-200/90 rounded-xl p-4 sm:p-5 space-y-3"
        data-testid="plan-step-2"
      >
        <div>
          <h2 className="text-base sm:text-lg font-bold text-[#0F291E]">
            {t('planFlow.step2Title')}
          </h2>
          <p className="text-xs text-stone-500 mt-0.5">
            {t('planFlow.step2Sub')}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-xs text-stone-500">
                <th className="py-2.5 pr-4 font-semibold">
                  {t('planFlow.colCrop')}
                </th>
                <th className="py-2.5 px-3 font-semibold">
                  {t('planFlow.colStatus')}
                </th>
                <th className="py-2.5 px-3 font-semibold text-right">
                  {t('planFlow.colScore')}
                </th>
                <th className="py-2.5 px-3 font-semibold text-right">
                  {t('planFlow.colMargin')}
                </th>
                <th className="py-2.5 px-3 font-semibold text-right">
                  {t('planFlow.colWater')}
                </th>
                <th className="py-2.5 pl-3 font-semibold text-right">
                  {t('planFlow.colCost')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {simulation.cropResults.map((crop) => {
                const isRecommended =
                  topCrop && crop.cropId === topCrop.cropId;
                const firstInfeasibleReason = crop
                  .infeasibilityReasonsBilingual[0]
                  ? pickBilingual(crop.infeasibilityReasonsBilingual[0], lang)
                  : null;

                return (
                  <tr
                    key={crop.cropId}
                    className={
                      isRecommended ? 'bg-[#F5FAF7]' : 'hover:bg-stone-50/70'
                    }
                  >
                    <td className="py-2 pr-4 align-top">
                      <div className="font-semibold text-stone-900">
                        {pickBilingual(crop.cropNames, lang)}
                      </div>
                      <div className="text-[11px] text-stone-500">
                        {pickBilingual(crop.plantingWindowLabel, lang)}
                      </div>
                    </td>

                    <td className="py-2 px-3 align-top">
                      <span
                        className={`text-xs font-semibold ${
                          crop.feasibilityStatus === 'feasible'
                            ? 'text-emerald-800'
                            : crop.feasibilityStatus === 'uncertain'
                              ? 'text-amber-800'
                              : 'text-red-700'
                        }`}
                      >
                        {formatCropFeasibilityDetail(crop, lang)}
                      </span>
                      {firstInfeasibleReason && (
                        <p className="text-[11px] text-stone-600 mt-0.5 max-w-md leading-snug">
                          {firstInfeasibleReason}
                        </p>
                      )}
                    </td>

                    <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-stone-900 align-top whitespace-nowrap">
                      {formatNumber(crop.scores.weightedSuitability, lang, 1)}
                      <span className="text-xs font-normal text-stone-400">
                        /100
                      </span>
                    </td>

                    <td className="py-2 px-3 text-right font-mono tabular-nums text-stone-800 align-top whitespace-nowrap">
                      {formatCurrency(
                        crop.financialEvaluation.netProfitRange.expected,
                        farm.currency,
                        lang
                      )}
                    </td>

                    <td className="py-2 px-3 text-right font-mono tabular-nums text-stone-800 align-top whitespace-nowrap">
                      {formatNumber(
                        crop.waterEvaluation.additionalIrrigationRequiredM3,
                        lang,
                        0
                      )}{' '}
                      m³
                    </td>

                    <td className="py-2 pl-3 text-right font-mono tabular-nums text-stone-800 align-top whitespace-nowrap">
                      {formatCurrency(
                        crop.financialEvaluation.totalFarmInputCost,
                        farm.currency,
                        lang
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Secondary Collapsible Suitability Chart & Simulator Links */}
        <details className="rounded-lg border border-stone-200/90 bg-stone-50/60 p-4 text-xs">
          <summary className="font-semibold text-[#0F291E] cursor-pointer select-none">
            {t('planFlow.calcDetailsToggle')}
          </summary>
          <div className="mt-4 space-y-4">
            <div className="h-64 w-full" data-testid="overview-suitability-chart">
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
            <p className="text-xs text-stone-500">
              {t('overview.chartGrayNote')}
            </p>
            <div className="pt-2 border-t border-stone-200/80 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => onNavigate('simulator')}
                className="font-semibold text-emerald-800 hover:underline cursor-pointer"
              >
                {t('planFlow.openSimulatorBtn')}
              </button>
              <button
                type="button"
                onClick={() => onNavigate('scenarios')}
                className="font-semibold text-emerald-800 hover:underline cursor-pointer"
              >
                {t('planFlow.openScenariosBtn')}
              </button>
            </div>
          </div>
        </details>
      </section>

      {/* STEP 3 — Recommendation and AI Review */}
      <section
        className="bg-white border border-stone-200/90 rounded-xl p-4 sm:p-5 space-y-4"
        data-testid="plan-step-3"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5 max-w-2xl">
            <div className="text-xs font-semibold text-emerald-800">
              {t('planFlow.step3Title')}
            </div>

            {topCrop ? (
              <>
                <div className="text-xs text-stone-500">
                  {topCrop.feasibilityStatus === 'feasible'
                    ? t('planFlow.recommendedLabel')
                    : t('planFlow.preliminaryLabel')}
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold text-[#0F291E]">
                  {pickBilingual(topCrop.cropNames, lang)}
                </h2>
              </>
            ) : (
              <div className="flex items-center gap-2 text-amber-800 pt-1">
                <ShieldAlert className="w-5 h-5 shrink-0" />
                <h2 className="text-xl sm:text-2xl font-bold">
                  {t('planFlow.noneFeasibleLabel')}
                </h2>
              </div>
            )}

            {/* One-sentence reasoning first */}
            <p
              className="text-sm sm:text-base text-stone-700 leading-relaxed pt-1"
              data-testid="plan-one-sentence-reason"
            >
              {oneSentenceReason}
            </p>
          </div>

          <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
            <button
              type="button"
              onClick={onRunEvaluation}
              disabled={isEvaluating}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#0F291E] hover:bg-[#163B2B] disabled:opacity-60 text-white text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
            >
              {isEvaluating ? (
                <Activity className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              {isEvaluating
                ? t('planFlow.runningAiBtn')
                : evaluation
                  ? t('planFlow.rerunAiReviewBtn')
                  : t('planFlow.runAiReviewBtn')}
            </button>

            {criticBadgeText ? (
              <div
                className={`inline-flex items-center gap-1.5 text-xs font-semibold ${criticBadgeText.tone}`}
              >
                <criticBadgeText.icon className="w-4 h-4 shrink-0" />
                <span>{criticBadgeText.label}</span>
              </div>
            ) : (
              <div className="text-xs text-stone-500">
                {t('planFlow.notYetAiReviewed')}
              </div>
            )}
          </div>
        </div>

        {/* Key Numbers for Recommended Crop (or Adjust Farm CTA when none feasible) */}
        {topCrop ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-4 border-y border-stone-100">
            <div>
              <div className="text-xs text-stone-500 flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                {t('overview.netProfitLabel', {
                  area: formatNumber(farm.areaHa, lang, 1),
                })}
              </div>
              <div className="text-lg font-semibold font-mono tabular-nums text-stone-900 mt-0.5">
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
              <div className="text-lg font-semibold font-mono tabular-nums text-stone-900 mt-0.5">
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
              <div className="text-lg font-semibold font-mono tabular-nums text-stone-900 mt-0.5">
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
            </div>
          </div>
        ) : (
          <div className="pt-1">
            <button
              type="button"
              onClick={() => onNavigate('farm-setup')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-stone-300 bg-white hover:bg-stone-50 text-xs font-semibold text-stone-800 cursor-pointer"
            >
              <span>{t('overview.adjustSetupBtn')}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Real Progress Banner while AI Review is Running */}
        {isEvaluating && (
          <div
            role="status"
            className="bg-[#F2F7F4] border border-[#CDE0D4] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 text-xs font-semibold text-[#0F291E]"
          >
            <span className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-700 animate-spin shrink-0" />
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
          </div>
        )}

        {/* Honest Stale / Language / Error Notices */}
        {evaluation && !derived.isEvaluationLanguageMatched && !isEvaluating && (
          <div className="p-3 rounded-lg bg-amber-50/90 border border-amber-200 text-xs text-amber-950 flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-1.5">
              <Languages className="w-4 h-4 text-amber-800 shrink-0" />
              {t('overview.staleLangNotice')}
            </span>
            <button
              type="button"
              onClick={onRunEvaluation}
              className="font-semibold text-amber-950 underline cursor-pointer shrink-0"
            >
              {t('overview.regenerateInLang')}
            </button>
          </div>
        )}

        {!evaluation && hasStaleEvaluation && !isEvaluating && (
          <div className="p-3 rounded-lg bg-amber-50/90 border border-amber-200 text-xs text-amber-950 flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-800 shrink-0" />
              {t('overview.staleParamsNotice')}
            </span>
            <button
              type="button"
              onClick={onRunEvaluation}
              className="font-semibold text-amber-950 underline cursor-pointer shrink-0"
            >
              {t('overview.rerunUpdatedBtn')}
            </button>
          </div>
        )}

        {evaluation?.aiError && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-950 flex items-start gap-2.5"
          >
            <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">{evaluation.aiError.message}</div>
              <div className="text-red-800 mt-0.5">
                {t('overview.aiErrorNote')}
              </div>
            </div>
          </div>
        )}

        {/* Collapsible 1: Detailed AI Reasoning, Trade-Offs & Next Steps */}
        <details className="rounded-xl border border-stone-200/90 bg-stone-50/60 p-4 text-xs">
          <summary className="font-semibold text-[#0F291E] cursor-pointer select-none">
            {t('planFlow.detailsReasoningToggle')}
          </summary>

          <div className="mt-4 space-y-4 text-stone-700">
            {evaluation?.decision ? (
              <>
                <p className="text-sm text-stone-800 leading-relaxed">
                  {evaluation.decision.executiveSummary}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-stone-200/80">
                  <div>
                    <div className="font-semibold text-stone-900">
                      {t('overview.finTradeoff')}
                    </div>
                    <p className="text-stone-600 leading-relaxed mt-1">
                      {evaluation.decision.tradeoffAnalysis.financial}
                    </p>
                  </div>
                  <div>
                    <div className="font-semibold text-stone-900">
                      {t('overview.climTradeoff')}
                    </div>
                    <p className="text-stone-600 leading-relaxed mt-1">
                      {
                        evaluation.decision.tradeoffAnalysis
                          .climateAndEnvironmental
                      }
                    </p>
                  </div>
                  <div>
                    <div className="font-semibold text-stone-900">
                      {t('overview.waterTradeoff')}
                    </div>
                    <p className="text-stone-600 leading-relaxed mt-1">
                      {
                        evaluation.decision.tradeoffAnalysis
                          .waterAndSoilResources
                      }
                    </p>
                  </div>
                </div>

                {evaluation.critic && (
                  <div className="p-3.5 rounded-lg bg-white border border-stone-200 space-y-2">
                    <div className="flex items-center gap-2 font-semibold text-stone-900">
                      {evaluation.critic.verdict === 'pass' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                      )}
                      <span>
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
                    <p className="text-stone-600 leading-relaxed">
                      {evaluation.critic.criticSummary}
                    </p>
                  </div>
                )}

                <div className="pt-2 border-t border-stone-200/80 space-y-2">
                  <div className="font-semibold text-stone-900">
                    {t('overview.nextStepsTitle')}
                  </div>
                  <ol className="list-decimal list-inside space-y-1 text-stone-700">
                    {evaluation.decision.actionableNextSteps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                  <p className="text-[11px] text-amber-950 bg-amber-50/80 border border-amber-200 rounded-lg p-2.5">
                    {evaluation.decision.humanReviewNotice}
                  </p>
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <p className="text-stone-600">{t('overview.decisionEmpty')}</p>
                <ol className="list-decimal list-inside space-y-1 text-stone-600">
                  <li>{t('overview.defaultStep1')}</li>
                  <li>{t('overview.defaultStep2')}</li>
                  <li>{t('overview.defaultStep3')}</li>
                </ol>
              </div>
            )}

            <div className="pt-2 border-t border-stone-200/80 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => onNavigate('decision-center')}
                className="font-semibold text-emerald-800 hover:underline cursor-pointer"
              >
                {t('overview.inspectDecisionLink')}
              </button>
              <button
                type="button"
                onClick={() => onNavigate('timeline')}
                className="font-semibold text-emerald-800 hover:underline cursor-pointer"
              >
                {t('nav.timeline')} →
              </button>
            </div>
          </div>
        </details>

        {/* Collapsible 2: Assumptions, Weather Notes & Citations */}
        <details className="rounded-xl border border-stone-200/90 bg-stone-50/60 p-4 text-xs">
          <summary className="font-semibold text-[#0F291E] cursor-pointer select-none">
            {t('planFlow.detailsAssumptionsToggle')}
          </summary>

          <div className="mt-4 space-y-3 text-stone-600">
            {weather &&
              weather.status === 'ok' &&
              weather.summary &&
              weather.forecastPeriod && (
                <div className="p-3 rounded-lg bg-white border border-stone-200 space-y-1.5">
                  <div className="font-semibold text-stone-900">
                    {t('overview.liveWeatherBadge')} (
                    {weather.forecastPeriod.startDate} →{' '}
                    {weather.forecastPeriod.endDate})
                  </div>
                  <div className="font-mono tabular-nums text-stone-700">
                    {t('overview.peakHigh')}:{' '}
                    {formatNumber(weather.summary.peakMaxTempC, lang, 1)} °C ·{' '}
                    {t('overview.lowestNight')}:{' '}
                    {formatNumber(weather.summary.lowestMinTempC, lang, 1)} °C ·{' '}
                    {t('overview.windowRain', {
                      days: weather.forecastPeriod.days,
                    })}
                    : {formatNumber(weather.summary.totalPrecipMm, lang, 1)} mm
                  </div>
                  {!weatherAlignment.aligned && forecastMonthLabel && (
                    <p className="text-amber-900 pt-1">
                      {t('overview.seasonalWeatherMismatchNote', {
                        forecastMonth: forecastMonthLabel,
                        sowingMonth: monthLabel,
                      })}
                    </p>
                  )}
                </div>
              )}

            {evaluation?.decision && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="font-semibold text-stone-900 mb-1">
                    {t('decisionCenter.assumptionsTitle')}
                  </div>
                  <ul className="list-disc list-inside space-y-1">
                    {evaluation.decision.keyAssumptions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="font-semibold text-stone-900 mb-1">
                    {t('decisionCenter.missingInfoTitle')}
                  </div>
                  <ul className="list-disc list-inside space-y-1">
                    {evaluation.decision.missingInformation.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <p className="leading-relaxed">
              {t('overview.benchmarkDisclaimer')}
            </p>

            <div className="pt-2 border-t border-stone-200/80 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => onNavigate('data-sources')}
                className="font-semibold text-emerald-800 hover:underline cursor-pointer"
              >
                {t('overview.inspectSourcesBtn')}
              </button>
              <button
                type="button"
                onClick={() => onNavigate('climate')}
                className="font-semibold text-emerald-800 hover:underline cursor-pointer"
              >
                {t('overview.climateIntelLink')}
              </button>
            </div>
          </div>
        </details>
      </section>
    </div>
  );
};
