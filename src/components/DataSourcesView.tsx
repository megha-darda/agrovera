import React from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  FileText,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CROP_DATABASE } from '../engine/presets.ts';
import type { AppLanguage, DataClassification } from '../types/domain.ts';
import {
  formatClassificationLabel,
  formatNumber,
  pickBilingual,
} from '../utils/formatters.ts';

export const DataSourcesView: React.FC = () => {
  const { t, i18n } = useTranslation();
  const lang: AppLanguage = i18n.language === 'de' ? 'de' : 'en';

  const renderClassBadge = (classification: DataClassification) => {
    const label = formatClassificationLabel(classification, lang);
    if (classification === 'verified_source') {
      return (
        <span className="inline-flex items-center gap-1 font-semibold text-emerald-800">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          {label}
        </span>
      );
    }
    if (classification === 'illustrative_estimate') {
      return (
        <span className="inline-flex items-center gap-1 font-semibold text-amber-800">
          <FileText className="w-3.5 h-3.5 shrink-0" />
          {label}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-stone-600">
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        {label}
      </span>
    );
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <section className="bg-white border border-stone-200/90 rounded-xl p-6 space-y-4">
        <div>
          <div className="text-xs text-stone-500 mb-1">
            {t('dataSources.badge')}
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#0F291E]">
            {t('dataSources.title')}
          </h1>
          <p className="text-sm text-stone-600 mt-1 max-w-3xl leading-relaxed">
            {t('dataSources.subtitle')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <div className="p-4 rounded-lg bg-[#F2F7F4] border border-[#D5E1D8] space-y-1">
            <div className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              {t('dataSources.classVerifiedTitle')}
            </div>
            <p className="text-xs text-stone-700 leading-relaxed">
              {t('dataSources.classVerifiedDesc')}
            </p>
          </div>

          <div className="p-4 rounded-lg bg-amber-50/70 border border-amber-200/80 space-y-1">
            <div className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-amber-700 shrink-0" />
              {t('dataSources.classIllustrativeTitle')}
            </div>
            <p className="text-xs text-stone-700 leading-relaxed">
              {t('dataSources.classIllustrativeDesc')}
            </p>
          </div>

          <div className="p-4 rounded-lg bg-stone-50 border border-stone-200 space-y-1">
            <div className="text-xs font-bold text-stone-900 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 text-stone-600 shrink-0" />
              {t('dataSources.classMissingTitle')}
            </div>
            <p className="text-xs text-stone-600 leading-relaxed">
              {t('dataSources.classMissingDesc')}
            </p>
          </div>
        </div>
      </section>

      {/* System-Wide Provenance Registry Table */}
      <section className="bg-white border border-stone-200/90 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <BookOpen className="w-4 h-4 text-emerald-800 shrink-0" />
          <h2 className="text-base font-bold text-[#0F291E]">
            {t('dataSources.registryTitle')}
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-stone-200 text-stone-500">
                <th className="py-2.5 pr-4 font-semibold">
                  {t('dataSources.thParam')}
                </th>
                <th className="py-2.5 px-3 font-semibold">
                  {t('dataSources.thValue')}
                </th>
                <th className="py-2.5 px-3 font-semibold">
                  {t('dataSources.thUnit')}
                </th>
                <th className="py-2.5 px-3 font-semibold">
                  {t('dataSources.thSource')}
                </th>
                <th className="py-2.5 px-3 font-semibold">
                  {t('dataSources.thClass')}
                </th>
                <th className="py-2.5 pl-3 font-semibold">
                  {t('dataSources.thNotes')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {CROP_DATABASE.transparencyRegistry.map((entry) => (
                <tr key={entry.id} className="hover:bg-stone-50/70 align-top">
                  <td className="py-3 pr-4 font-semibold text-stone-900">
                    {pickBilingual(entry.parameter, lang)}
                  </td>
                  <td className="py-3 px-3 font-mono text-stone-700">
                    {pickBilingual(entry.valueSummary, lang)}
                  </td>
                  <td className="py-3 px-3 font-mono text-stone-600 whitespace-nowrap">
                    {entry.unit}
                  </td>
                  <td className="py-3 px-3 text-stone-700">
                    <div className="font-medium text-stone-900">
                      {entry.sourceUrl ? (
                        <a
                          href={entry.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-emerald-800 hover:underline"
                        >
                          {entry.sourceName}
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      ) : (
                        entry.sourceName
                      )}
                    </div>
                    <div className="text-[11px] text-stone-500 font-mono mt-0.5">
                      {entry.yearOrPeriod}
                    </div>
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap">
                    {renderClassBadge(entry.classification)}
                  </td>
                  <td className="py-3 pl-3 text-stone-600 leading-relaxed max-w-md">
                    {pickBilingual(entry.notes, lang)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Per-Crop German Citations */}
      <section className="bg-white border border-stone-200/90 rounded-xl p-6 space-y-4">
        <h2 className="text-base font-bold text-[#0F291E]">
          {t('dataSources.cropCitationsTitle')}
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {CROP_DATABASE.crops.map((crop) => (
            <article
              key={crop.id}
              className="border border-stone-200/90 rounded-xl p-5 space-y-3"
            >
              <div className="flex items-baseline justify-between gap-2 border-b border-stone-100 pb-2.5">
                <div>
                  <h3 className="text-base font-bold text-[#0F291E]">
                    {pickBilingual(crop.names, lang)}{' '}
                    <span className="text-xs font-normal italic text-stone-500">
                      ({crop.scientificName})
                    </span>
                  </h3>
                  <p className="text-xs text-stone-500 mt-0.5">
                    {pickBilingual(crop.applicableGermanRegions, lang)}
                  </p>
                </div>
                <span className="text-xs font-mono text-stone-600 shrink-0">
                  ID: {crop.id}
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="font-semibold text-stone-900">
                      {crop.sources.yieldStatistics.sourceName} (
                      {crop.sources.yieldStatistics.publicationYear}):
                    </span>{' '}
                    <span className="text-stone-600">
                      {formatNumber(
                        crop.indicativeYieldTonsPerHa.destatisNationalAvgTonsHa,
                        lang,
                        2
                      )}{' '}
                      t/ha ·{' '}
                      {pickBilingual(crop.sources.yieldStatistics.note, lang)}
                    </span>
                  </div>
                  <div className="shrink-0">
                    {renderClassBadge(
                      crop.sources.yieldStatistics.classification
                    )}
                  </div>
                </div>

                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="font-semibold text-stone-900">
                      {crop.sources.cultivationGuidance.sourceName}:
                    </span>{' '}
                    <span className="text-stone-600">
                      {pickBilingual(
                        crop.sources.cultivationGuidance.note,
                        lang
                      )}
                    </span>
                  </div>
                  <div className="shrink-0">
                    {renderClassBadge(
                      crop.sources.cultivationGuidance.classification
                    )}
                  </div>
                </div>

                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="font-semibold text-stone-900">
                      {crop.sources.economicAssumptions.sourceName}:
                    </span>{' '}
                    <span className="text-stone-600">
                      {formatNumber(crop.inputCostsEurPerHa.total, lang, 0)} €/ha
                      · {formatNumber(crop.indicativeMarketPriceEurPerTon.low, lang, 0)}
                      –
                      {formatNumber(crop.indicativeMarketPriceEurPerTon.high, lang, 0)}{' '}
                      €/t ·{' '}
                      {pickBilingual(
                        crop.sources.economicAssumptions.note,
                        lang
                      )}
                    </span>
                  </div>
                  <div className="shrink-0">
                    {renderClassBadge(
                      crop.sources.economicAssumptions.classification
                    )}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
};
