import React from 'react';
import {
  AlertTriangle,
  CloudRain,
  Info,
  RefreshCw,
  Sliders,
  Thermometer,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DEFAULT_WEATHER_THRESHOLDS } from '../engine/presets.ts';
import { checkForecastSowingAlignment } from '../engine/weather.ts';
import type {
  AppLanguage,
  FarmProfile,
  NavigationTab,
  WeatherForecastAnalysis,
  WeatherThresholds,
} from '../types/domain.ts';
import {
  formatDateShort,
  formatMonthName,
  formatTimeBerlin,
  pickBilingual,
} from '../utils/formatters.ts';

interface ClimateIntelligenceViewProps {
  farm: FarmProfile;
  weather: WeatherForecastAnalysis | null;
  thresholds: WeatherThresholds;
  isFetchingWeather: boolean;
  onUpdateThresholds: (next: WeatherThresholds) => void;
  onRefreshWeather: () => void;
  onNavigate: (tab: NavigationTab) => void;
}

export const ClimateIntelligenceView: React.FC<
  ClimateIntelligenceViewProps
> = ({
  farm,
  weather,
  thresholds,
  isFetchingWeather,
  onUpdateThresholds,
  onRefreshWeather,
  onNavigate,
}) => {
  const { t, i18n } = useTranslation();
  const lang: AppLanguage = i18n.language === 'de' ? 'de' : 'en';

  const weatherAlignment = checkForecastSowingAlignment(
    weather,
    farm.plantingMonth
  );
  const sowingMonthLabel = formatMonthName(farm.plantingMonth, lang);
  const forecastMonthLabel = weatherAlignment.forecastStartMonth
    ? formatMonthName(weatherAlignment.forecastStartMonth, lang)
    : '';

  const dailyData =
    weather?.status === 'ok'
      ? weather.daily.map((d) => ({
          ...d,
          shortDate: formatDateShort(d.date, lang),
        }))
      : [];

  return (
    <div className="space-y-8">
      {/* Header & Source Metadata */}
      <section className="bg-white border border-stone-200/90 rounded-xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500 mb-1.5">
              <span>{t('climate.liveFeedBadge')}</span>
              <span aria-hidden="true">·</span>
              <span>
                {weather?.source ??
                  'Deutscher Wetterdienst (DWD ICON) via Open-Meteo API'}
              </span>
              {weather?.fetchedAt && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {t('climate.updatedAt', {
                      time: formatTimeBerlin(weather.fetchedAt, lang),
                    })}
                  </span>
                </>
              )}
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-[#0F291E]">
              {t('climate.title', { location: farm.locationName })}
            </h1>
            {weather?.coordinates && weather.forecastPeriod && (
              <p className="text-xs text-stone-500 font-mono tabular-nums mt-1">
                {t('climate.coordSummary', {
                  lat: weather.coordinates.latitude.toFixed(4),
                  lon: weather.coordinates.longitude.toFixed(4),
                  elev:
                    typeof weather.coordinates.elevationM === 'number'
                      ? ` · ${weather.coordinates.elevationM} m`
                      : '',
                  start: weather.forecastPeriod.startDate,
                  end: weather.forecastPeriod.endDate,
                  days: weather.forecastPeriod.days,
                })}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onRefreshWeather}
              disabled={isFetchingWeather}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0F291E] hover:bg-[#163B2B] disabled:opacity-60 text-white text-xs sm:text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw
                className={`w-4 h-4 ${isFetchingWeather ? 'animate-spin' : ''}`}
              />
              {isFetchingWeather
                ? t('climate.fetchingBtn')
                : t('climate.refreshBtn')}
            </button>
          </div>
        </div>

        {/* Scientific Forecast Horizon Disclaimer */}
        <div className="mt-5 p-3.5 rounded-lg bg-[#EEF3EF] border border-[#D5E1D8] flex items-start gap-2.5 text-xs text-[#1B3B2B]">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-emerald-800" />
          <div>
            <strong>{t('climate.horizonTitle')}</strong>{' '}
            {weather
              ? pickBilingual(weather.scopeLimitationNotice, lang)
              : t('overview.horizonShortNote')}{' '}
            <button
              type="button"
              onClick={() => onNavigate('scenarios')}
              className="underline font-semibold ml-1 cursor-pointer"
            >
              {t('climate.openScenariosLink')}
            </button>
          </div>
        </div>

        {weather?.status === 'ok' &&
          !weatherAlignment.aligned &&
          forecastMonthLabel && (
            <div className="mt-3 p-3.5 rounded-lg bg-amber-50/90 border border-amber-200 flex items-start gap-2.5 text-xs text-amber-950">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-800" />
              <div>
                {t('climate.seasonalMismatchBanner', {
                  forecastMonth: forecastMonthLabel,
                  sowingMonth: sowingMonthLabel,
                })}
              </div>
            </div>
          )}
      </section>

      {/* Unavailable / Error State */}
      {(!weather || weather.status === 'unavailable') && (
        <section
          role="alert"
          className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-amber-950"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-2">
              <h2 className="text-base font-bold">
                {t('climate.unavailableTitle')}
              </h2>
              <p className="text-sm text-amber-900">
                {weather
                  ? pickBilingual(
                      weather.errorMessageBilingual ?? weather.errorMessage,
                      lang
                    )
                  : t('overview.weatherNotFetched')}
              </p>
              <p className="text-xs text-amber-800">
                {t('climate.unavailableNote')}
              </p>
              <div className="pt-1 flex gap-3">
                <button
                  type="button"
                  onClick={() => onNavigate('farm-setup')}
                  className="px-3.5 py-2 rounded-lg bg-white border border-amber-300 text-xs font-medium text-amber-950 cursor-pointer"
                >
                  {t('climate.checkCoordsBtn')}
                </button>
                <button
                  type="button"
                  onClick={onRefreshWeather}
                  className="px-3.5 py-2 rounded-lg bg-amber-900 text-white text-xs font-medium cursor-pointer"
                >
                  {t('climate.retryBtn')}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Configurable DWD Risk Thresholds */}
      <section className="bg-white border border-stone-200/90 rounded-xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-emerald-800" />
            <h2 className="text-base font-bold text-[#0F291E]">
              {t('climate.thresholdsTitle')}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onUpdateThresholds(DEFAULT_WEATHER_THRESHOLDS)}
            className="text-xs font-medium text-stone-600 hover:text-stone-900 underline cursor-pointer"
          >
            {t('climate.resetThresholdsBtn')}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <div>
            <label
              htmlFor="thresh-heat"
              className="block text-xs font-medium text-stone-700 mb-1"
            >
              {t('climate.threshHeat')}
            </label>
            <input
              id="thresh-heat"
              type="number"
              step="1"
              value={thresholds.heatDayMaxTempC}
              onChange={(e) =>
                onUpdateThresholds({
                  ...thresholds,
                  heatDayMaxTempC: Number(e.target.value),
                })
              }
              className="w-full px-3 py-1.5 rounded-lg border border-stone-300 text-sm font-mono tabular-nums"
            />
          </div>

          <div>
            <label
              htmlFor="thresh-frost"
              className="block text-xs font-medium text-stone-700 mb-1"
            >
              {t('climate.threshFrost')}
            </label>
            <input
              id="thresh-frost"
              type="number"
              step="1"
              value={thresholds.frostDayMinTempC}
              onChange={(e) =>
                onUpdateThresholds({
                  ...thresholds,
                  frostDayMinTempC: Number(e.target.value),
                })
              }
              className="w-full px-3 py-1.5 rounded-lg border border-stone-300 text-sm font-mono tabular-nums"
            />
          </div>

          <div>
            <label
              htmlFor="thresh-dry"
              className="block text-xs font-medium text-stone-700 mb-1"
            >
              {t('climate.threshDry')}
            </label>
            <input
              id="thresh-dry"
              type="number"
              min="0"
              step="2"
              value={thresholds.dryWindowTotalPrecipMm}
              onChange={(e) =>
                onUpdateThresholds({
                  ...thresholds,
                  dryWindowTotalPrecipMm: Number(e.target.value),
                })
              }
              className="w-full px-3 py-1.5 rounded-lg border border-stone-300 text-sm font-mono tabular-nums"
            />
          </div>

          <div>
            <label
              htmlFor="thresh-rain"
              className="block text-xs font-medium text-stone-700 mb-1"
            >
              {t('climate.threshRain')}
            </label>
            <input
              id="thresh-rain"
              type="number"
              min="5"
              step="5"
              value={thresholds.heavyRainDailyMm}
              onChange={(e) =>
                onUpdateThresholds({
                  ...thresholds,
                  heavyRainDailyMm: Number(e.target.value),
                })
              }
              className="w-full px-3 py-1.5 rounded-lg border border-stone-300 text-sm font-mono tabular-nums"
            />
          </div>
        </div>
      </section>

      {/* Four Climate-Risk Evaluation Cards */}
      {weather && weather.status === 'ok' && (
        <>
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {weather.riskIndicators.map((risk) => (
              <div
                key={risk.id}
                className="bg-white border border-stone-200/90 rounded-xl p-5 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 text-xs mb-2">
                    <span className="text-stone-500">
                      {t('climate.thresholdPrefix', {
                        val: risk.thresholdMetric,
                      })}
                    </span>
                    <span
                      className={`font-mono font-semibold uppercase ${
                        risk.severity === 'high'
                          ? 'text-red-700'
                          : risk.severity === 'moderate'
                            ? 'text-amber-700'
                            : 'text-emerald-700'
                      }`}
                    >
                      {risk.triggered
                        ? t('climate.riskTriggered', {
                            severity: t(`common.${risk.severity}`),
                          })
                        : t('climate.riskNominal')}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-[#0F291E]">
                    {pickBilingual(risk.labelBilingual, lang)}
                  </h3>
                  <div className="text-base font-mono tabular-nums font-semibold text-stone-900 mt-1.5">
                    {pickBilingual(risk.observedMetricBilingual, lang)}
                  </div>
                  <p className="text-xs text-stone-600 mt-2 leading-relaxed">
                    {pickBilingual(risk.explanationBilingual, lang)}
                  </p>
                </div>
                <div className="mt-4 pt-2.5 border-t border-stone-100 text-[11px] text-stone-500 font-mono tabular-nums">
                  {t('climate.affectedDays', { count: risk.affectedDays })}
                </div>
              </div>
            ))}
          </section>

          {/* Temperature & Rainfall Forecast Charts */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-stone-200/90 rounded-xl p-6">
              <div className="flex items-center justify-between gap-2 mb-4">
                <div>
                  <h2 className="text-base font-bold text-[#0F291E] flex items-center gap-2">
                    <Thermometer className="w-4 h-4 text-emerald-800" />
                    {t('climate.tempChartTitle')}
                  </h2>
                  <p className="text-xs text-stone-500 mt-0.5">
                    {t('climate.tempChartSub')}
                  </p>
                </div>
              </div>

              <div className="h-64 w-full" data-testid="climate-temp-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={dailyData}
                    margin={{ top: 10, right: 16, left: -8, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#E7E5E4"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="shortDate"
                      tick={{ fill: '#57534E', fontSize: 11 }}
                    />
                    <YAxis
                      tick={{ fill: '#57534E', fontSize: 11 }}
                      unit="°"
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
                    <ReferenceLine
                      y={thresholds.heatDayMaxTempC}
                      stroke="#DC2626"
                      strokeDasharray="4 4"
                      label={{
                        value: t('climate.heatLine', {
                          val: thresholds.heatDayMaxTempC,
                        }),
                        fill: '#DC2626',
                        fontSize: 10,
                      }}
                    />
                    <ReferenceLine
                      y={thresholds.frostDayMinTempC}
                      stroke="#2563EB"
                      strokeDasharray="4 4"
                      label={{
                        value: t('climate.frostLine', {
                          val: thresholds.frostDayMinTempC,
                        }),
                        fill: '#2563EB',
                        fontSize: 10,
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="tempMaxC"
                      name={t('climate.dailyMax')}
                      stroke="#D97706"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="tempMinC"
                      name={t('climate.dailyMin')}
                      stroke="#059669"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white border border-stone-200/90 rounded-xl p-6">
              <div className="flex items-center justify-between gap-2 mb-4">
                <div>
                  <h2 className="text-base font-bold text-[#0F291E] flex items-center gap-2">
                    <CloudRain className="w-4 h-4 text-emerald-800" />
                    {t('climate.rainChartTitle')}
                  </h2>
                  <p className="text-xs text-stone-500 mt-0.5">
                    {t('climate.rainChartSub')}
                  </p>
                </div>
              </div>

              <div className="h-64 w-full" data-testid="climate-rain-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={dailyData}
                    margin={{ top: 10, right: 16, left: -8, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#E7E5E4"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="shortDate"
                      tick={{ fill: '#57534E', fontSize: 11 }}
                    />
                    <YAxis
                      tick={{ fill: '#57534E', fontSize: 11 }}
                      unit="mm"
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
                    <ReferenceLine
                      y={thresholds.heavyRainDailyMm}
                      stroke="#DC2626"
                      strokeDasharray="4 4"
                      label={{
                        value: t('climate.heavyRainLine', {
                          val: thresholds.heavyRainDailyMm,
                        }),
                        fill: '#DC2626',
                        fontSize: 10,
                      }}
                    />
                    <Bar
                      dataKey="precipMm"
                      name={t('climate.precipBar')}
                      fill="#0284C7"
                      radius={[3, 3, 0, 0]}
                    />
                    <Bar
                      dataKey="et0Mm"
                      name={t('climate.et0Bar')}
                      fill="#A8A29E"
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
};
