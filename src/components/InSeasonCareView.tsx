import React from 'react';
import {
  Activity,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronRight,
  CloudRain,
  Droplets,
  Info,
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
  formatCurrency,
  formatDateShort,
  formatNumber,
  formatSoilName,
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
    <div className="space-y-7" data-testid="in-season-care-view">
      {/* Page Intro & Reused Farm Context */}
      <section className="bg-white border border-stone-200/90 rounded-xl p-6 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1 max-w-3xl">
          <div className="text-xs font-medium text-emerald-800">
            {t('inSeason.badge')}
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#0F291E]">
            {t('inSeason.title')}
          </h1>
          <p className="text-sm text-stone-600 leading-relaxed">
            {t('inSeason.subtitle', {
              location: farm.locationName,
              area: formatNumber(farm.areaHa, lang, 1),
              soil: formatSoilName(farm.soilType, lang),
              budget: formatCurrency(farm.budgetAmount, farm.currency, lang),
            })}
          </p>
        </div>

        <button
          type="button"
          onClick={onEditFarmSetup}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-stone-300 bg-white hover:bg-stone-50 text-xs font-medium text-stone-800 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <span>{t('inSeason.editFarmContextBtn')}</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </section>

      {/* Section 1: Planted crop, growth stage and remaining water (ONLY the 5 In-Season inputs) */}
      <section className="bg-white border border-stone-200/90 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-3">
          <h2 className="text-base sm:text-lg font-bold text-[#0F291E] flex items-center gap-2">
            <Sprout className="w-4 h-4 text-emerald-800 shrink-0" />
            {t('inSeason.sec1Title')}
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 1. Crop already planted */}
          <div>
            <label
              htmlFor="inseason-crop"
              className="block text-xs font-semibold text-stone-800 mb-1.5"
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

          {/* 2. Planting / sowing date */}
          <div>
            <label
              htmlFor="inseason-planting-date"
              className="block text-xs font-semibold text-stone-800 mb-1.5"
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

          {/* 3. Current growth stage, manually selectable */}
          <div>
            <label
              htmlFor="inseason-growth-stage"
              className="block text-xs font-semibold text-stone-800 mb-1.5"
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

          {/* 4. Irrigation water already used (m³) */}
          <div>
            <label
              htmlFor="inseason-water-used"
              className="block text-xs font-semibold text-stone-800 mb-1.5"
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

        {/* 5. Optional crop-condition notes */}
        <div>
          <label
            htmlFor="inseason-condition-notes"
            className="block text-xs font-semibold text-stone-800 mb-1.5"
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

        {/* Remaining Water & Stage Transparency Strip */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-2">
          <div
            data-testid="remaining-water-card"
            className={`lg:col-span-6 p-4 rounded-xl border ${
              plan.waterBalance.remainingWaterM3 > 0
                ? 'bg-[#F2F7F4] border-[#CDE0D4]'
                : 'bg-amber-50/90 border-amber-200'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#0F291E] flex items-center gap-1.5">
                <Droplets className="w-4 h-4 text-emerald-800 shrink-0" />
                {t('inSeason.waterFormulaHeader')}
              </span>
              <span className="text-lg font-bold font-mono tabular-nums text-[#0F291E]">
                {formatNumber(plan.waterBalance.remainingWaterM3, lang, 0)} m³
              </span>
            </div>
            <p className="text-xs text-stone-700 font-mono tabular-nums mt-1">
              {t('inSeason.waterFormulaDetail', {
                allocated: formatNumber(
                  plan.waterBalance.allocatedWaterM3,
                  lang,
                  0
                ),
                used: formatNumber(plan.waterBalance.waterUsedM3, lang, 0),
                remaining: formatNumber(
                  plan.waterBalance.remainingWaterM3,
                  lang,
                  0
                ),
                mmHa: formatNumber(
                  plan.waterBalance.remainingWaterMmHa,
                  lang,
                  1
                ),
              })}
            </p>
            {plan.waterBalance.allocationExceededByM3 > 0 && (
              <p className="text-xs text-amber-950 font-medium mt-2">
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
          </div>

          <div className="lg:col-span-6 p-4 rounded-xl bg-stone-50 border border-stone-200/90 flex items-start gap-2.5 text-xs text-stone-700">
            <Info className="w-4 h-4 text-emerald-800 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-stone-900">
                {t('inSeason.stageEstimateBadge')}:
              </span>{' '}
              {pickBilingual(plan.stageStatusNote, lang)}
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: This week's weather risks */}
      <section className="bg-white border border-stone-200/90 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-[#0F291E] flex items-center gap-2">
              <CloudRain className="w-4 h-4 text-emerald-800 shrink-0" />
              {t('inSeason.sec2Title')}
            </h2>
            <p className="text-xs text-stone-500 mt-0.5">
              {t('inSeason.sec2HorizonNote')}
            </p>
          </div>

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

        {weather && weather.status === 'ok' && weather.riskIndicators.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {weather.riskIndicators.map((ind) => (
              <div
                key={ind.id}
                className={`p-3.5 rounded-lg border ${
                  ind.triggered
                    ? ind.severity === 'high'
                      ? 'bg-red-50/70 border-red-200'
                      : 'bg-amber-50/70 border-amber-200'
                    : 'bg-stone-50/80 border-stone-200/90'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-stone-900">
                    {pickBilingual(ind.labelBilingual, lang)}
                  </span>
                  <span
                    className={`font-mono font-bold uppercase ${
                      ind.triggered
                        ? ind.severity === 'high'
                          ? 'text-red-700'
                          : 'text-amber-700'
                        : 'text-emerald-800'
                    }`}
                  >
                    {ind.triggered
                      ? t(`common.${ind.severity}`)
                      : t('common.nominal')}
                  </span>
                </div>
                <p className="text-xs text-stone-600 mt-1 leading-snug">
                  {pickBilingual(ind.observedMetricBilingual, lang)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-stone-600">{t('inSeason.noStripData')}</p>
        )}
      </section>

      {/* Section 3: Up to three recommended considerations */}
      <section
        className="bg-white border border-stone-200/90 rounded-xl p-6 space-y-4"
        data-testid="in-season-actions-list"
      >
        <div>
          <h2 className="text-base sm:text-lg font-bold text-[#0F291E]">
            {t('inSeason.sec3Title')}
          </h2>
          <p className="text-xs text-stone-500 mt-0.5">
            {t('inSeason.sec3Sub')}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
          {plan.candidateActions.map((act) => {
            const isAiSelected = activeSelectedIds.has(act.id);
            const priorityLabel =
              act.priority === 'high'
                ? t('inSeason.priorityHigh')
                : act.priority === 'moderate'
                  ? t('inSeason.priorityModerate')
                  : t('inSeason.priorityLow');

            return (
              <article
                key={act.id}
                className={`rounded-xl border p-5 flex flex-col justify-between space-y-4 ${
                  isAiSelected
                    ? 'border-emerald-700 bg-[#F7FAF8]'
                    : 'border-stone-200/90 bg-white'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
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
                    {isAiSelected && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-900">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                        {t('inSeason.aiSelectedTag')}
                      </span>
                    )}
                  </div>

                  <h3 className="text-sm sm:text-base font-bold text-[#0F291E] leading-snug">
                    {pickBilingual(act.title, lang)}
                  </h3>

                  <dl className="space-y-2 text-xs">
                    <div>
                      <dt className="font-semibold text-stone-900 inline">
                        {t('inSeason.fieldRelevantDate')}:{' '}
                      </dt>
                      <dd className="inline font-mono text-stone-700">
                        {act.relevantDate}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-stone-900">
                        {t('inSeason.fieldForecastTrigger')}
                      </dt>
                      <dd className="text-stone-600 leading-relaxed">
                        {pickBilingual(act.forecastTrigger, lang)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-stone-900">
                        {t('inSeason.fieldReason')}
                      </dt>
                      <dd className="text-stone-600 leading-relaxed">
                        {pickBilingual(act.reason, lang)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-stone-900">
                        {t('inSeason.fieldWaterBudget')}
                      </dt>
                      <dd className="text-stone-600 leading-relaxed">
                        {pickBilingual(act.waterOrBudgetConsideration, lang)}
                      </dd>
                    </div>
                    <div className="pt-2 border-t border-stone-100">
                      <dt className="font-semibold text-amber-900">
                        {t('inSeason.fieldUncertainty')}
                      </dt>
                      <dd className="text-stone-600 leading-relaxed">
                        {pickBilingual(act.uncertaintyOrMissing, lang)}
                      </dd>
                    </div>
                  </dl>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Section 4: Seven-day weather strip */}
      <section
        className="bg-white border border-stone-200/90 rounded-xl p-6 space-y-4"
        data-testid="seven-day-weather-strip"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base sm:text-lg font-bold text-[#0F291E] flex items-center gap-2">
            <Calendar className="w-4 h-4 text-emerald-800 shrink-0" />
            {t('inSeason.sec4Title')}
          </h2>
          {plan.sevenDayStrip.length > 0 && (
            <span className="text-xs font-mono tabular-nums text-stone-500">
              {plan.sevenDayStrip[0].date} →{' '}
              {plan.sevenDayStrip[plan.sevenDayStrip.length - 1].date}
            </span>
          )}
        </div>

        {plan.sevenDayStrip.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {plan.sevenDayStrip.map((day) => {
              const flags: Array<{ label: string; tone: string }> = [];
              if (day.isHeat) {
                flags.push({
                  label: t('inSeason.flagHeat'),
                  tone: 'text-red-800 bg-red-50 border-red-200',
                });
              }
              if (day.isFrost) {
                flags.push({
                  label: t('inSeason.flagFrost'),
                  tone: 'text-sky-900 bg-sky-50 border-sky-200',
                });
              }
              if (day.isHeavyRain) {
                flags.push({
                  label: t('inSeason.flagHeavyRain'),
                  tone: 'text-amber-900 bg-amber-50 border-amber-200',
                });
              }
              if (day.isDryDay && !day.isHeavyRain) {
                flags.push({
                  label: t('inSeason.flagDry'),
                  tone: 'text-stone-700 bg-stone-100 border-stone-200',
                });
              }
              if (flags.length === 0) {
                flags.push({
                  label: t('inSeason.flagCalm'),
                  tone: 'text-emerald-800 bg-emerald-50 border-emerald-200',
                });
              }

              return (
                <div
                  key={day.date}
                  className="p-3.5 rounded-lg border border-stone-200/90 bg-stone-50/50 flex flex-col justify-between space-y-2.5"
                >
                  <div>
                    <div className="text-xs font-bold text-[#0F291E]">
                      {formatDateShort(day.date, lang)}
                    </div>
                    <div className="text-[11px] font-mono text-stone-500">
                      {day.date}
                    </div>
                  </div>

                  <div className="space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-stone-500 flex items-center gap-1">
                        <Thermometer className="w-3 h-3" />
                        {t('inSeason.stripMaxMin')}
                      </span>
                      <span className="font-mono tabular-nums font-semibold text-stone-900">
                        {formatNumber(day.tempMaxC, lang, 1)}° /{' '}
                        {formatNumber(day.tempMinC, lang, 1)}°
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-stone-500">
                        {t('inSeason.stripRain')}
                      </span>
                      <span className="font-mono tabular-nums font-semibold text-stone-900">
                        {formatNumber(day.precipMm, lang, 1)} mm
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1 pt-1 border-t border-stone-200/70">
                    {flags.map((f) => (
                      <span
                        key={f.label}
                        className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${f.tone}`}
                      >
                        {f.label}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-stone-600">{t('inSeason.noStripData')}</p>
        )}
      </section>

      {/* Section 5: One Clear Primary Action + Collapsible AI Reasoning & Assumptions */}
      <section className="bg-white border border-stone-200/90 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-[#0F291E]">
              {t('inSeason.sec5Title')}
            </h2>
            <p className="text-xs text-stone-600 mt-0.5">
              {pickBilingual(plan.scopeDisclaimer, lang)}
            </p>
          </div>

          {/* Single Primary CTA on the In-Season Care screen */}
          <button
            type="button"
            onClick={onRunInSeasonEvaluation}
            disabled={isEvaluating}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#0F291E] hover:bg-[#163B2B] disabled:opacity-60 text-white text-sm font-semibold whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isEvaluating ? (
              <Activity className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {isEvaluating
              ? t('inSeason.verifyingAiBtn')
              : evaluation
                ? t('inSeason.reverifyAiBtn')
                : t('inSeason.verifyAiBtn')}
          </button>
        </div>

        {/* Truthful Gemini Progress */}
        {isEvaluating && (
          <div
            role="status"
            className="p-4 rounded-xl bg-[#F2F7F4] border border-[#CDE0D4] space-y-2"
          >
            <div className="flex items-center justify-between gap-3 text-xs font-semibold text-[#0F291E]">
              <span className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-700 animate-spin shrink-0" />
                {progressStageText}
              </span>
              <span className="font-mono tabular-nums text-stone-600">
                {t('progress.elapsed', { sec: elapsedSeconds })}
              </span>
            </div>
          </div>
        )}

        {/* Stale Input / Language Notices */}
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
            className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-950 space-y-1"
          >
            <div className="font-semibold flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-red-700 shrink-0" />
              {evaluation.aiError.model}: {evaluation.aiError.message}
            </div>
          </div>
        )}

        {/* Collapsible AI Reasoning, Critic Audit & Assumptions */}
        <details
          open={Boolean(evaluation?.decision)}
          className="rounded-xl border border-stone-200/90 bg-stone-50/70 p-4 text-xs"
        >
          <summary className="font-semibold text-[#0F291E] cursor-pointer select-none">
            {t('inSeason.aiCollapsibleSummary')}
          </summary>

          <div className="mt-4 space-y-4">
            {evaluation?.decision ? (
              <div className="space-y-3 text-stone-700">
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
                  <div className="p-3.5 rounded-lg bg-white border border-stone-200 space-y-2">
                    <div className="flex items-center justify-between gap-2 font-semibold text-stone-900">
                      <span className="flex items-center gap-1.5">
                        {evaluation.validationGate?.passed ? (
                          <ShieldCheck className="w-4 h-4 text-emerald-700" />
                        ) : (
                          <ShieldAlert className="w-4 h-4 text-amber-700" />
                        )}
                        {t('inSeason.criticVerdictHeader', {
                          verdict: t(`common.${evaluation.critic.verdict}`),
                        })}
                      </span>
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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="font-semibold text-stone-900 mb-1">
                      {t('decisionCenter.assumptionsTitle')}
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-stone-600">
                      {evaluation.decision.keyAssumptions.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="font-semibold text-stone-900 mb-1">
                      {t('decisionCenter.missingInfoTitle')}
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-stone-600">
                      {evaluation.decision.missingObservations.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <p className="text-[11px] text-amber-950 bg-amber-50/90 border border-amber-200 rounded-lg p-2.5">
                  {evaluation.decision.advisoryNotice}
                </p>

                {/* Nested Collapsible Technical Model & Validation Gate Details */}
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
            ) : (
              <div className="space-y-2.5 text-stone-600">
                <p>{t('inSeason.aiEmptyHint')}</p>
                <div>
                  <div className="font-semibold text-stone-800 mb-1">
                    {t('decisionCenter.missingInfoTitle')}
                  </div>
                  <ul className="list-disc list-inside space-y-1">
                    {plan.missingObservations.map((obs, idx) => (
                      <li key={idx}>{pickBilingual(obs, lang)}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </details>
      </section>
    </div>
  );
};
