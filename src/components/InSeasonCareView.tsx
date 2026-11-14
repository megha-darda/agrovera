import React from 'react';
import {
  Activity,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Droplets,
  Languages,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sprout,
  Thermometer,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  buildInSeasonCarePlan,
  GROWTH_STAGE_LABELS,
} from '../engine/inSeasonCare.ts';
import type {
  AppLanguage,
  CropId,
  FarmProfile,
  GrowthStageId,
  InSeasonCareInputs,
  InSeasonEvaluationResponse,
  WeatherForecastAnalysis,
} from '../types/domain.ts';
import {
  formatCropName,
  formatDateShort,
  formatNumber,
  pickBilingual,
} from '../utils/formatters.ts';

interface InSeasonCareViewProps {
  farm: FarmProfile;
  inputs: InSeasonCareInputs;
  weather: WeatherForecastAnalysis | null;
  isFetchingWeather: boolean;
  evaluation: InSeasonEvaluationResponse | null;
  hasStaleEvaluation: boolean;
  isEvaluating: boolean;
  elapsedSeconds: number;
  onUpdateInputs: (next: InSeasonCareInputs) => void;
  onRefreshWeather: () => void;
  onRunInSeasonEvaluation: () => void;
  onEditFarmSetup: () => void;
}

const CROP_IDS: CropId[] = ['winter_wheat', 'barley', 'maize', 'potato'];

const STAGE_IDS: GrowthStageId[] = [
  'emergence',
  'vegetative',
  'flowering_tuber',
  'grain_fill_bulking',
  'ripening_harvest',
  'unknown',
];

function extractShortReason(text: string): string {
  const cleaned = text.trim();
  if (!cleaned) return '';
  const match = cleaned.match(/^.+?[.!?](?:\s|$)/);
  return match ? match[0].trim() : cleaned;
}

export const InSeasonCareView: React.FC<InSeasonCareViewProps> = ({
  farm,
  inputs,
  weather,
  isFetchingWeather,
  evaluation,
  hasStaleEvaluation,
  isEvaluating,
  elapsedSeconds,
  onUpdateInputs,
  onRefreshWeather,
  onRunInSeasonEvaluation,
  onEditFarmSetup,
}) => {
  const { t, i18n } = useTranslation();
  const lang: AppLanguage = i18n.language === 'de' ? 'de' : 'en';

  const plan = React.useMemo(
    () => buildInSeasonCarePlan(farm, inputs, weather),
    [farm, inputs, weather]
  );

  const isLangMatched = Boolean(evaluation) && evaluation?.language === lang;
  const activeSelectedIds = new Set(
    isLangMatched && evaluation?.decision?.selectedActionIds
      ? evaluation.decision.selectedActionIds
      : []
  );

  const progressStageText =
    elapsedSeconds < 3
      ? t('progress.inSeasonStage1')
      : elapsedSeconds < 8
        ? t('progress.inSeasonStage2')
        : t('progress.inSeasonStage3');

  return (
    <div className="space-y-5" data-testid="in-season-care-view">
      {/* Top Bar Summary: Planted Crop, Growth Stage, Remaining Water + Collapsible Input Editor */}
      <section className="bg-white border border-stone-200/90 rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* 1. Planted Crop */}
          <div className="p-3.5 rounded-lg bg-stone-50/80 border border-stone-200/80">
            <div className="text-xs text-stone-500 flex items-center gap-1.5">
              <Sprout className="w-3.5 h-3.5 text-emerald-800 shrink-0" />
              <span>{t('protectFlow.topPlantedCrop')}</span>
            </div>
            <div className="text-lg font-bold text-[#0F291E] mt-0.5">
              {formatCropName(inputs.plantedCropId, lang)}
            </div>
            <div className="text-xs text-stone-500 truncate">
              {farm.locationName} ({formatNumber(farm.areaHa, lang, 1)} ha)
            </div>
          </div>

          {/* 2. Growth Stage */}
          <div className="p-3.5 rounded-lg bg-stone-50/80 border border-stone-200/80">
            <div className="text-xs text-stone-500">
              {t('protectFlow.topGrowthStage')}
            </div>
            <div className="text-base sm:text-lg font-bold text-[#0F291E] mt-0.5 leading-snug">
              {pickBilingual(GROWTH_STAGE_LABELS[inputs.growthStage], lang)}
            </div>
            <div className="text-xs text-stone-500 font-mono">
              {inputs.plantingDate}
            </div>
          </div>

          {/* 3. Remaining Water */}
          <div
            data-testid="remaining-water-card"
            className={`p-3.5 rounded-lg border ${
              plan.waterBalance.remainingWaterM3 > 0
                ? 'bg-[#F2F7F4] border-[#CDE0D4]'
                : 'bg-amber-50/90 border-amber-200'
            }`}
          >
            <div className="text-xs text-[#0F291E] font-medium flex items-center gap-1.5">
              <Droplets className="w-3.5 h-3.5 text-emerald-800 shrink-0" />
              <span>{t('protectFlow.topRemainingWater')}</span>
            </div>
            <div className="text-lg font-bold font-mono tabular-nums text-[#0F291E] mt-0.5">
              {formatNumber(plan.waterBalance.remainingWaterM3, lang, 0)} m³
            </div>
            <div className="text-xs text-stone-600 font-mono tabular-nums">
              {t('protectFlow.ofAllocated', {
                allocated: formatNumber(
                  plan.waterBalance.allocatedWaterM3,
                  lang,
                  0
                ),
                used: formatNumber(plan.waterBalance.waterUsedM3, lang, 0),
              })}
            </div>
          </div>
        </div>

        {plan.waterBalance.allocationExceededByM3 > 0 && (
          <p className="text-xs text-amber-950 bg-amber-50 border border-amber-200 rounded-lg p-3">
            {t('inSeason.waterOverUsedWarning', {
              used: formatNumber(plan.waterBalance.waterUsedM3, lang, 0),
              allocated: formatNumber(
                plan.waterBalance.allocatedWaterM3,
                lang,
                0
              ),
              exceeded: formatNumber(
                plan.waterBalance.allocationExceededByM3,
                lang,
                0
              ),
            })}
          </p>
        )}

        {/* Expandable Planted-Crop Inputs (Preserves all 5 fields cleanly without clutter) */}
        <details className="pt-2 border-t border-stone-100 text-xs">
          <summary className="font-semibold text-emerald-900 cursor-pointer select-none">
            {t('protectFlow.editInputsToggle')}
          </summary>

          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div>
                <label
                  htmlFor="inseason-crop"
                  className="block text-xs font-semibold text-stone-800 mb-1"
                >
                  {t('inSeason.plantedCropLabel')}
                </label>
                <select
                  id="inseason-crop"
                  value={inputs.plantedCropId}
                  onChange={(e) =>
                    onUpdateInputs({
                      ...inputs,
                      plantedCropId: e.target.value as CropId,
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-stone-300 text-sm text-stone-900 bg-white"
                >
                  {CROP_IDS.map((cid) => (
                    <option key={cid} value={cid}>
                      {formatCropName(cid, lang)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="inseason-planting-date"
                  className="block text-xs font-semibold text-stone-800 mb-1"
                >
                  {t('inSeason.plantingDateLabel')}
                </label>
                <input
                  id="inseason-planting-date"
                  type="date"
                  value={inputs.plantingDate}
                  onChange={(e) =>
                    onUpdateInputs({
                      ...inputs,
                      plantingDate: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-stone-300 text-sm font-mono text-stone-900 bg-white"
                />
              </div>

              <div>
                <label
                  htmlFor="inseason-growth-stage"
                  className="block text-xs font-semibold text-stone-800 mb-1"
                >
                  {t('inSeason.growthStageLabel')}
                </label>
                <select
                  id="inseason-growth-stage"
                  value={inputs.growthStage}
                  onChange={(e) =>
                    onUpdateInputs({
                      ...inputs,
                      growthStage: e.target.value as GrowthStageId,
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-stone-300 text-sm text-stone-900 bg-white"
                >
                  {STAGE_IDS.map((sid) => (
                    <option key={sid} value={sid}>
                      {pickBilingual(GROWTH_STAGE_LABELS[sid], lang)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="inseason-water-used"
                  className="block text-xs font-semibold text-stone-800 mb-1"
                >
                  {t('inSeason.waterUsedLabel')}
                </label>
                <input
                  id="inseason-water-used"
                  type="number"
                  min="0"
                  step="100"
                  value={inputs.irrigationUsedM3}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    onUpdateInputs({
                      ...inputs,
                      irrigationUsedM3: Number.isFinite(raw)
                        ? Math.max(0, Math.round(raw))
                        : 0,
                    });
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-stone-300 text-sm font-mono tabular-nums text-stone-900 bg-white"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex-1 min-w-[240px]">
                <label
                  htmlFor="inseason-condition-notes"
                  className="block text-xs font-semibold text-stone-800 mb-1"
                >
                  {t('inSeason.conditionNotesLabel')}
                </label>
                <input
                  id="inseason-condition-notes"
                  type="text"
                  value={inputs.conditionNotes}
                  onChange={(e) =>
                    onUpdateInputs({
                      ...inputs,
                      conditionNotes: e.target.value,
                    })
                  }
                  placeholder={t('inSeason.conditionNotesPlaceholder')}
                  className="w-full px-3 py-2 rounded-lg border border-stone-300 text-sm text-stone-900 bg-white"
                />
              </div>

              <button
                type="button"
                onClick={onEditFarmSetup}
                className="px-3.5 py-2 rounded-lg border border-stone-300 bg-white hover:bg-stone-50 text-xs font-semibold text-stone-800 whitespace-nowrap cursor-pointer"
              >
                {t('inSeason.editFarmContextBtn')}
              </button>
            </div>
          </div>
        </details>
      </section>

      {/* Main Action Section: "What should I do this week?" + Visible AI Verify Button + Critic Verdict */}
      <section
        className="bg-white border border-stone-200/90 rounded-xl p-5 sm:p-6 space-y-4"
        data-testid="in-season-actions-list"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-[#0F291E]">
              {t('protectFlow.whatToDoTitle')}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Critic Verdict near the actions */}
            {evaluation?.critic && !evaluation.aiError && (
              <span
                data-testid="in-season-critic-verdict"
                className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                  evaluation.validationGate?.passed
                    ? 'text-emerald-800'
                    : 'text-amber-800'
                }`}
              >
                {evaluation.validationGate?.passed ? (
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                ) : (
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                )}
                {t('protectFlow.criticBadge', {
                  verdict: t(`common.${evaluation.critic.verdict}`),
                })}
              </span>
            )}

            {/* Visible AI Verification Button */}
            <button
              type="button"
              onClick={onRunInSeasonEvaluation}
              disabled={isEvaluating}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0F291E] hover:bg-[#163B2B] disabled:opacity-60 text-white text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isEvaluating ? (
                <Activity className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              {isEvaluating
                ? t('protectFlow.verifyingAiBtn')
                : evaluation
                  ? t('protectFlow.reverifyAiBtn')
                  : t('protectFlow.verifyAiBtn')}
            </button>
          </div>
        </div>

        {/* Real Progress & Honest Stale/Error Notices */}
        {isEvaluating && (
          <div
            role="status"
            className="p-3.5 rounded-xl bg-[#F2F7F4] border border-[#CDE0D4] flex items-center justify-between gap-3 text-xs font-semibold text-[#0F291E]"
          >
            <span className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-700 animate-spin shrink-0" />
              {progressStageText}
            </span>
            <span className="font-mono tabular-nums text-stone-600">
              {t('progress.elapsed', { sec: elapsedSeconds })}
            </span>
          </div>
        )}

        {!evaluation && hasStaleEvaluation && !isEvaluating && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-800 shrink-0" />
            <span>{t('inSeason.staleInputsNotice')}</span>
          </div>
        )}

        {evaluation && !isLangMatched && !isEvaluating && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950 flex items-center gap-2">
            <Languages className="w-4 h-4 text-amber-800 shrink-0" />
            <span>{t('inSeason.staleLangNotice')}</span>
          </div>
        )}

        {evaluation?.aiError && (
          <div
            role="alert"
            className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-950 flex items-center gap-2"
          >
            <ShieldAlert className="w-4 h-4 text-red-700 shrink-0" />
            <span className="font-medium">{evaluation.aiError.message}</span>
          </div>
        )}

        {/* Up to 3 Compact Action Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
          {plan.candidateActions.map((act) => {
            const isAiSelected = activeSelectedIds.has(act.id);
            const priorityLabel =
              act.priority === 'high'
                ? t('inSeason.priorityHigh')
                : act.priority === 'moderate'
                  ? t('inSeason.priorityModerate')
                  : t('inSeason.priorityLow');
            const fullReason = pickBilingual(act.reason, lang);
            const shortReason = extractShortReason(fullReason);

            return (
              <article
                key={act.id}
                className={`rounded-xl border p-4 flex flex-col justify-between space-y-3 ${
                  isAiSelected
                    ? 'border-emerald-700 bg-[#F7FAF8]'
                    : 'border-stone-200/90 bg-white'
                }`}
              >
                <div className="space-y-2">
                  {/* Priority + Relevant Date */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`font-semibold ${
                          act.priority === 'high'
                            ? 'text-red-700'
                            : act.priority === 'moderate'
                              ? 'text-amber-800'
                              : 'text-emerald-800'
                        }`}
                      >
                        {priorityLabel}
                      </span>
                      <span className="text-stone-400" aria-hidden="true">
                        ·
                      </span>
                      <span className="font-mono text-stone-600">
                        {act.relevantDate}
                      </span>
                    </div>

                    {isAiSelected && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-900">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                        {t('inSeason.aiSelectedTag')}
                      </span>
                    )}
                  </div>

                  {/* Action Title */}
                  <h2 className="text-sm sm:text-base font-bold text-[#0F291E] leading-snug">
                    {pickBilingual(act.title, lang)}
                  </h2>

                  {/* One Short Reason */}
                  <p className="text-xs text-stone-600 leading-relaxed">
                    {shortReason}
                  </p>
                </div>

                {/* Expandable Details */}
                <details className="pt-2.5 border-t border-stone-100 text-xs">
                  <summary className="font-semibold text-emerald-900 cursor-pointer select-none">
                    {t('protectFlow.expandCardToggle')}
                  </summary>

                  <dl className="mt-2.5 space-y-2 text-stone-600">
                    <div>
                      <dt className="font-semibold text-stone-900">
                        {t('inSeason.fieldForecastTrigger')}
                      </dt>
                      <dd className="leading-relaxed">
                        {pickBilingual(act.forecastTrigger, lang)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-stone-900">
                        {t('inSeason.fieldWaterBudget')}
                      </dt>
                      <dd className="leading-relaxed">
                        {pickBilingual(act.waterOrBudgetConsideration, lang)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-amber-900">
                        {t('inSeason.fieldUncertainty')}
                      </dt>
                      <dd className="leading-relaxed">
                        {pickBilingual(act.uncertaintyOrMissing, lang)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-stone-900">
                        {t('protectFlow.agronomicAssumptionsLabel')}
                      </dt>
                      <dd className="leading-relaxed">
                        {pickBilingual(plan.stageStatusNote, lang)}{' '}
                        {pickBilingual(plan.scopeDisclaimer, lang)}
                      </dd>
                    </div>
                  </dl>
                </details>
              </article>
            );
          })}
        </div>

        {/* Secondary Collapsible AI Summary & Critic Notes (Closed by default to avoid long scrolling) */}
        {evaluation?.decision && (
          <details className="rounded-xl border border-stone-200/90 bg-stone-50/70 p-3.5 text-xs">
            <summary className="font-semibold text-[#0F291E] cursor-pointer select-none">
              {t('protectFlow.aiDetailsToggle')}
            </summary>

            <div className="mt-3 space-y-3 text-stone-700">
              <p className="text-sm text-stone-800 leading-relaxed">
                {evaluation.decision.weeklySummary}
              </p>
              <div>
                <strong className="text-stone-900">
                  {t('inSeason.priorityFocusLabel')}
                </strong>{' '}
                {evaluation.decision.priorityFocus}
              </div>

              {evaluation.critic && (
                <div className="p-3 rounded-lg bg-white border border-stone-200 space-y-1.5">
                  <div className="font-semibold text-stone-900">
                    {t('inSeason.criticVerdictHeader', {
                      verdict: t(`common.${evaluation.critic.verdict}`),
                    })}
                  </div>
                  <p className="text-stone-600 leading-relaxed">
                    {evaluation.critic.criticSummary}
                  </p>
                  {evaluation.critic.flags.length > 0 && (
                    <ul className="list-disc list-inside space-y-1 text-stone-600">
                      {evaluation.critic.flags.map((fl, idx) => (
                        <li key={idx}>
                          <strong className="uppercase text-stone-800">
                            [{fl.severity}]
                          </strong>{' '}
                          {fl.detail}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="font-semibold text-stone-900 mb-1">
                    {t('decisionCenter.assumptionsTitle')}
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 text-stone-600">
                    {evaluation.decision.keyAssumptions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="font-semibold text-stone-900 mb-1">
                    {t('decisionCenter.missingInfoTitle')}
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 text-stone-600">
                    {evaluation.decision.missingObservations.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <details className="pt-2 border-t border-stone-200/80">
                <summary className="font-medium text-stone-600 cursor-pointer select-none">
                  {t('inSeason.techDetailsSummary')}
                </summary>
                <div className="mt-2 space-y-1 font-mono text-[11px] text-stone-500">
                  <div>
                    Decision: {evaluation.modelsUsed.decisionAgent} · Critic:{' '}
                    {evaluation.modelsUsed.criticAgent} · Run:{' '}
                    {evaluation.runId}
                  </div>
                  {evaluation.validationGate?.checks.map((chk) => (
                    <div key={chk.code}>
                      [{chk.passed ? 'PASS' : 'FAIL'}] {chk.code}:{' '}
                      {pickBilingual(chk.detail, lang)}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          </details>
        )}
      </section>

      {/* Compact Horizontal Seven-Day Weather Strip */}
      <section
        className="bg-white border border-stone-200/90 rounded-xl p-5 space-y-3"
        data-testid="seven-day-weather-strip"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm sm:text-base font-bold text-[#0F291E] flex items-center gap-2">
            <Calendar className="w-4 h-4 text-emerald-800 shrink-0" />
            {t('protectFlow.sevenDayTitle')}
          </h2>

          <button
            type="button"
            onClick={onRefreshWeather}
            disabled={isFetchingWeather}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-300 bg-white hover:bg-stone-50 disabled:opacity-60 text-xs font-medium text-stone-800 cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isFetchingWeather ? 'animate-spin' : ''}`}
            />
            {isFetchingWeather
              ? t('inSeason.refreshingForecastBtn')
              : t('inSeason.refreshForecastBtn')}
          </button>
        </div>

        {plan.sevenDayStrip.length > 0 ? (
          <div className="grid grid-flow-col auto-cols-[minmax(126px,1fr)] overflow-x-auto lg:grid-cols-7 gap-2.5 pb-1">
            {plan.sevenDayStrip.map((day) => {
              let flagLabel = t('inSeason.flagCalm');
              let flagTone = 'text-emerald-800';
              if (day.isFrost) {
                flagLabel = t('inSeason.flagFrost');
                flagTone = 'text-sky-800';
              } else if (day.isHeat) {
                flagLabel = t('inSeason.flagHeat');
                flagTone = 'text-red-700';
              } else if (day.isHeavyRain) {
                flagLabel = t('inSeason.flagHeavyRain');
                flagTone = 'text-amber-800';
              } else if (day.isDryDay) {
                flagLabel = t('inSeason.flagDry');
                flagTone = 'text-stone-600';
              }

              return (
                <div
                  key={day.date}
                  className="p-3 rounded-lg border border-stone-200/90 bg-stone-50/50 flex flex-col justify-between space-y-1.5"
                >
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="text-xs font-bold text-[#0F291E]">
                      {formatDateShort(day.date, lang)}
                    </span>
                    <span className={`text-[11px] font-semibold ${flagTone}`}>
                      {flagLabel}
                    </span>
                  </div>

                  <div className="text-xs font-mono tabular-nums font-semibold text-stone-900 flex items-center gap-1">
                    <Thermometer className="w-3 h-3 text-stone-400 shrink-0" />
                    <span>
                      {formatNumber(day.tempMaxC, lang, 0)}° /{' '}
                      {formatNumber(day.tempMinC, lang, 0)}°
                    </span>
                  </div>

                  <div className="text-[11px] font-mono tabular-nums text-stone-600">
                    {t('inSeason.stripRain')}:{' '}
                    {formatNumber(day.precipMm, lang, 1)} mm
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-stone-600">{t('inSeason.noStripData')}</p>
        )}
      </section>
    </div>
  );
};
