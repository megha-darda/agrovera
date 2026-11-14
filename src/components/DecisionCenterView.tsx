import React from 'react';
import {
  Activity,
  CheckCircle2,
  Cpu,
  Languages,
  Play,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  AgenticEvaluationResponse,
  AppLanguage,
} from '../types/domain.ts';
import {
  formatCropName,
  formatTimeBerlin,
  pickBilingual,
} from '../utils/formatters.ts';

interface DecisionCenterViewProps {
  evaluation: AgenticEvaluationResponse | null;
  isEvaluating: boolean;
  onRunEvaluation: () => void;
}

export const DecisionCenterView: React.FC<DecisionCenterViewProps> = ({
  evaluation,
  isEvaluating,
  onRunEvaluation,
}) => {
  const { t, i18n } = useTranslation();
  const lang: AppLanguage = i18n.language === 'de' ? 'de' : 'en';

  const isLangMismatch =
    Boolean(evaluation) && evaluation?.language !== lang;

  const langDisplayName = (l: AppLanguage) =>
    l === 'de'
      ? lang === 'de'
        ? 'Deutsch'
        : 'German'
      : lang === 'de'
        ? 'Englisch'
        : 'English';

  return (
    <div className="space-y-8">
      {/* Header */}
      <section className="bg-white border border-stone-200/90 rounded-xl p-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500 mb-1">
            <span>{t('decisionCenter.archBadge')}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">
              Orchestrator: gemini-4-hydrogen · Decision: gemini-4-carbon ·
              Critic: gemini-4-carbon
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#0F291E]">
            {t('decisionCenter.title')}
          </h1>
          <p className="text-sm text-stone-600 mt-0.5 max-w-3xl">
            {t('decisionCenter.subtitle')}
          </p>
        </div>

        <button
          type="button"
          onClick={onRunEvaluation}
          disabled={isEvaluating}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#0F291E] hover:bg-[#163B2B] disabled:opacity-60 text-white text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Play className="w-4 h-4" />
          {isEvaluating
            ? t('decisionCenter.executingBtn')
            : evaluation
              ? t('decisionCenter.rerunBtn')
              : t('decisionCenter.executeBtn')}
        </button>
      </section>

      {!evaluation && !isEvaluating && (
        <section className="bg-white border border-stone-200/90 rounded-xl p-8 text-center space-y-4">
          <Cpu className="w-8 h-8 text-emerald-800 mx-auto" />
          <h2 className="text-lg font-bold text-[#0F291E]">
            {t('decisionCenter.emptyTitle')}
          </h2>
          <p className="text-sm text-stone-600 max-w-xl mx-auto">
            {t('decisionCenter.emptyDesc')}
          </p>
          <button
            type="button"
            onClick={onRunEvaluation}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#0F291E] text-white text-sm font-medium cursor-pointer"
          >
            <Play className="w-4 h-4" />
            {t('decisionCenter.runFirstBtn')}
          </button>
        </section>
      )}

      {isEvaluating && (
        <section className="bg-white border border-stone-200/90 rounded-xl p-6 space-y-3">
          <div className="flex items-center gap-2.5 text-sm font-semibold text-[#0F291E]">
            <Activity className="w-4 h-4 text-emerald-700 animate-spin" />
            <span>{t('decisionCenter.loadingBanner')}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2">
            {[
              t('decisionCenter.step1'),
              t('decisionCenter.step2'),
              t('decisionCenter.step3'),
              t('decisionCenter.step4'),
            ].map((step) => (
              <div
                key={step}
                className="p-3 rounded-lg bg-stone-50 border border-stone-200 text-xs text-stone-600 animate-pulse"
              >
                {step}
              </div>
            ))}
          </div>
        </section>
      )}

      {evaluation && (
        <>
          {/* Honest Stale-Language Banner if user switched UI language after AI execution */}
          {isLangMismatch && !isEvaluating && (
            <section className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-amber-950 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-start gap-3 max-w-3xl">
                <Languages className="w-5 h-5 text-amber-800 shrink-0 mt-0.5" />
                <p className="text-xs leading-relaxed">
                  {t('decisionCenter.staleLangBanner', {
                    evalLang: langDisplayName(evaluation.language),
                    uiLang: langDisplayName(lang),
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={onRunEvaluation}
                className="px-4 py-2 rounded-lg bg-[#0F291E] text-white text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
              >
                {t('decisionCenter.rerunInActiveLangBtn', {
                  uiLang: langDisplayName(lang),
                })}
              </button>
            </section>
          )}

          {/* Human Review Banner if unresolved or advisory */}
          {evaluation.requiresHumanReview && (
            <section
              role="status"
              className={`rounded-xl p-5 border ${
                evaluation.validationGate?.passed
                  ? 'bg-amber-50/90 border-amber-200 text-amber-950'
                  : 'bg-red-50 border-red-200 text-red-950'
              }`}
            >
              <div className="flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h2 className="text-sm font-bold">
                    {evaluation.validationGate?.passed
                      ? t('decisionCenter.advisoryBannerTitle')
                      : t('decisionCenter.failedBannerTitle', {
                          cycles: evaluation.reviewCycles.length,
                        })}
                  </h2>
                  <p className="text-xs leading-relaxed">
                    {evaluation.aiError
                      ? `${evaluation.aiError.model}: ${evaluation.aiError.message}`
                      : evaluation.validationGate?.passed
                        ? t('decisionCenter.advisoryBannerDesc')
                        : evaluation.validationGate?.failureReasonsBilingual
                            .map((f) => pickBilingual(f, lang))
                            .join(' ')}
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* Decision Agent & Independent Critic Side-by-Side */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Decision Agent Output */}
            <div className="lg:col-span-6 bg-white border border-stone-200/90 rounded-xl p-6 space-y-5">
              <div className="border-b border-stone-100 pb-4">
                <div className="text-xs text-stone-500 font-mono mb-1">
                  {t('decisionCenter.decisionHeaderSub', {
                    model: evaluation.modelsUsed.decisionAgent,
                  })}
                </div>
                <h2 className="text-lg font-bold text-[#0F291E]">
                  {evaluation.decision
                    ? t('decisionCenter.recommendedPrefix', {
                        crop: formatCropName(
                          evaluation.decision.recommendedCropId,
                          lang
                        ),
                      })
                    : t('decisionCenter.decisionUnavailable')}
                </h2>
                {evaluation.decision && (
                  <p className="text-sm text-stone-700 mt-1.5 leading-relaxed">
                    {evaluation.decision.executiveSummary}
                  </p>
                )}
              </div>

              {evaluation.decision && (
                <>
                  <div className="space-y-3 text-xs">
                    <div>
                      <span className="font-semibold text-stone-900">
                        {t('decisionCenter.finOptLabel')}
                      </span>{' '}
                      <span className="text-stone-600">
                        {evaluation.decision.tradeoffAnalysis.financial}
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-stone-900">
                        {t('decisionCenter.climContextLabel')}
                      </span>{' '}
                      <span className="text-stone-600">
                        {
                          evaluation.decision.tradeoffAnalysis
                            .climateAndEnvironmental
                        }
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-stone-900">
                        {t('decisionCenter.waterSoilLabel')}
                      </span>{' '}
                      <span className="text-stone-600">
                        {
                          evaluation.decision.tradeoffAnalysis
                            .waterAndSoilResources
                        }
                      </span>
                    </div>
                  </div>

                  {/* Why Not Alternatives */}
                  <div className="pt-3 border-t border-stone-100 space-y-2">
                    <h3 className="text-xs font-semibold text-stone-900">
                      {t('decisionCenter.altTradeoffsTitle')}
                    </h3>
                    {evaluation.decision.alternativeComparisons.map(
                      (alt, idx) => (
                        <div key={idx} className="text-xs text-stone-600">
                          <strong className="text-stone-800">
                            {formatCropName(alt.cropId, lang)}:
                          </strong>{' '}
                          {alt.comparisonSummary}
                        </div>
                      )
                    )}
                  </div>

                  {/* Assumptions & Missing Information */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-stone-100 text-xs">
                    <div>
                      <h3 className="font-semibold text-stone-900 mb-1.5">
                        {t('decisionCenter.assumptionsTitle')}
                      </h3>
                      <ul className="list-disc list-inside space-y-1 text-stone-600">
                        {evaluation.decision.keyAssumptions.map((a, i) => (
                          <li key={i}>{a}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h3 className="font-semibold text-stone-900 mb-1.5">
                        {t('decisionCenter.missingInfoTitle')}
                      </h3>
                      <ul className="list-disc list-inside space-y-1 text-stone-600">
                        {evaluation.decision.missingInformation.map((m, i) => (
                          <li key={i}>{m}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Critic Agent + Deterministic Validation Gate */}
            <div className="lg:col-span-6 bg-white border border-stone-200/90 rounded-xl p-6 space-y-5">
              <div className="border-b border-stone-100 pb-4">
                <div className="text-xs text-stone-500 font-mono mb-1">
                  {t('decisionCenter.criticHeaderSub', {
                    model: evaluation.modelsUsed.criticAgent,
                  })}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-bold text-[#0F291E]">
                    {t('decisionCenter.criticAuditPrefix', {
                      verdict: evaluation.critic
                        ? t(`common.${evaluation.critic.verdict}`)
                        : 'N/A',
                    })}
                  </h2>
                  <span className="text-xs font-mono tabular-nums text-stone-600">
                    {t('decisionCenter.cyclesCount', {
                      count: evaluation.reviewCycles.length,
                    })}
                  </span>
                </div>
                {evaluation.critic && (
                  <p className="text-sm text-stone-700 mt-1.5 leading-relaxed">
                    {evaluation.critic.criticSummary}
                  </p>
                )}
              </div>

              {evaluation.critic && (
                <>
                  {/* Critic Boolean Audit Checks */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                    {[
                      {
                        label: t('decisionCenter.chkHard'),
                        ok: evaluation.critic.hardConstraintsSatisfied,
                      },
                      {
                        label: t('decisionCenter.chkFair'),
                        ok: evaluation.critic.alternativesComparedFairly,
                      },
                      {
                        label: t('decisionCenter.chkHorizon'),
                        ok: evaluation.critic.forecastUncertaintyCommunicated,
                      },
                      {
                        label: t('decisionCenter.chkNumbers'),
                        ok: evaluation.critic.numericalClaimsSupported,
                      },
                      {
                        label: t('decisionCenter.chkConsistent'),
                        ok: evaluation.critic.assumptionsConsistent,
                      },
                    ].map((chk) => (
                      <div
                        key={chk.label}
                        className="flex items-center gap-2 text-stone-700"
                      >
                        {chk.ok ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-700 shrink-0" />
                        )}
                        <span>{chk.label}</span>
                      </div>
                    ))}
                  </div>

                  {/* Critic Objections */}
                  {evaluation.critic.objections.length > 0 && (
                    <div className="pt-3 border-t border-stone-100 space-y-2">
                      <h3 className="text-xs font-semibold text-stone-900">
                        {t('decisionCenter.objectionsTitle')}
                      </h3>
                      {evaluation.critic.objections.map((obj, i) => (
                        <div
                          key={i}
                          className="text-xs text-stone-700 bg-stone-50 border border-stone-200/80 rounded-lg p-2.5"
                        >
                          <span className="font-mono font-semibold text-stone-900">
                            [{obj.severity.toUpperCase()} · {obj.category}]
                          </span>{' '}
                          {obj.detail}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Deterministic Application Validation Gate */}
              {evaluation.validationGate && (
                <div className="pt-3 border-t border-stone-100 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-stone-900 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-800" />
                      {t('decisionCenter.codeGateTitle')}
                    </h3>
                    <span
                      className={`text-xs font-mono font-semibold ${
                        evaluation.validationGate.passed
                          ? 'text-emerald-800'
                          : 'text-red-700'
                      }`}
                    >
                      {evaluation.validationGate.passed
                        ? t('decisionCenter.gatePassed')
                        : t('decisionCenter.gateFailed')}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {evaluation.validationGate.checks.map((chk) => (
                      <div
                        key={chk.code}
                        className="flex items-start justify-between gap-3 text-xs py-1 border-b border-stone-100 last:border-b-0"
                      >
                        <div>
                          <span className="font-medium text-stone-800">
                            {pickBilingual(chk.label, lang)}
                          </span>
                          <p className="text-[11px] text-stone-500">
                            {pickBilingual(chk.detail, lang)}
                          </p>
                        </div>
                        <span
                          className={`font-mono font-semibold shrink-0 ${
                            chk.passed ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {chk.passed ? t('common.pass') : t('common.fail')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Visual Explainable Agent Activity Timeline */}
          <section
            className="bg-white border border-stone-200/90 rounded-xl p-6"
            data-testid="agent-activity-timeline"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-5">
              <div>
                <h2 className="text-base font-bold text-[#0F291E]">
                  {t('decisionCenter.timelineTitle', {
                    count: evaluation.timeline.length,
                  })}
                </h2>
                <p className="text-xs text-stone-500 mt-0.5">
                  {t('decisionCenter.timelineSub')}
                </p>
              </div>
              <span className="text-xs font-mono tabular-nums text-stone-500">
                {t('decisionCenter.runIdLabel', { id: evaluation.runId })}
              </span>
            </div>

            <ol className="relative border-l border-stone-200 ml-3 space-y-5">
              {evaluation.timeline.map((ev) => (
                <li key={ev.id} className="ml-5">
                  <span
                    className={`absolute -left-2 flex items-center justify-center w-4 h-4 rounded-full ring-4 ring-white ${
                      ev.status === 'success'
                        ? 'bg-emerald-700'
                        : ev.status === 'warning'
                          ? 'bg-amber-600'
                          : ev.status === 'error'
                            ? 'bg-red-700'
                            : 'bg-stone-500'
                    }`}
                  />
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-stone-900">
                        {ev.title}
                      </span>
                      <span className="text-xs text-stone-500">
                        · {ev.actor}
                        {ev.modelId ? ` (${ev.modelId})` : ''}
                      </span>
                    </div>
                    <div className="text-xs font-mono tabular-nums text-stone-400">
                      {typeof ev.durationMs === 'number'
                        ? `${ev.durationMs} ms · `
                        : ''}
                      {formatTimeBerlin(ev.timestamp, lang)}
                    </div>
                  </div>
                  <p className="text-xs text-stone-600 mt-1 leading-relaxed">
                    {ev.summary}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
};
