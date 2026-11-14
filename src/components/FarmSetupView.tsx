import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Check,
  MapPin,
  Play,
  RotateCcw,
  Search,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  CROP_DATABASE,
  GERMAN_CITY_PRESETS,
  MONTH_NAMES_DE,
  MONTH_NAMES_EN,
  SAMPLE_FARM_PRESETS,
  type GermanCityPreset,
} from '../engine/presets.ts';
import {
  convertMmPerHaToTotalM3,
  convertWaterToMmPerHa,
  validateFarmProfile,
} from '../engine/simulator.ts';
import { searchLocations } from '../services/apiClient.ts';
import type {
  AppLanguage,
  CropId,
  CurrencyCode,
  FarmProfile,
  GeocodingCandidate,
  PriorityMode,
  SoilType,
  WaterUnit,
} from '../types/domain.ts';
import { formatNumber, pickBilingual } from '../utils/formatters.ts';

interface FarmSetupViewProps {
  farm: FarmProfile;
  onUpdateFarm: (updated: FarmProfile) => void;
  onRunEvaluation: (overrideFarm?: FarmProfile) => void;
  isEvaluating: boolean;
}

export const FarmSetupView: React.FC<FarmSetupViewProps> = ({
  farm,
  onUpdateFarm,
  onRunEvaluation,
  isEvaluating,
}) => {
  const { t, i18n } = useTranslation();
  const lang: AppLanguage = i18n.language === 'de' ? 'de' : 'en';

  const [draft, setDraft] = useState<FarmProfile>(farm);
  const [geoQuery, setGeoQuery] = useState(farm.locationName);
  const [geoResults, setGeoResults] = useState<GeocodingCandidate[]>([]);
  const [isSearchingGeo, setIsSearchingGeo] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [saveBanner, setSaveBanner] = useState<string | null>(null);

  useEffect(() => {
    setDraft(farm);
    setGeoQuery(farm.locationName);
  }, [farm]);

  const validation = validateFarmProfile(draft);
  const computedMmHa = convertWaterToMmPerHa(
    draft.availableWaterValue,
    draft.availableWaterUnit,
    draft.areaHa
  );
  const computedTotalM3 =
    draft.availableWaterUnit === 'm3_total_season' &&
    Number.isFinite(draft.availableWaterValue)
      ? Math.round(Math.max(0, draft.availableWaterValue))
      : convertMmPerHaToTotalM3(computedMmHa, draft.areaHa);

  const monthNames = lang === 'de' ? MONTH_NAMES_DE : MONTH_NAMES_EN;

  const handleLoadSample = (presetProfile: FarmProfile) => {
    const copy = { ...presetProfile };
    setDraft(copy);
    setGeoQuery(copy.locationName);
    setGeoResults([]);
    onUpdateFarm(copy);
    setSaveBanner(t('farmSetup.loadedPresetBanner', { name: copy.farmName }));
  };

  const handleSelectGermanCity = (city: GermanCityPreset) => {
    const cityName = lang === 'de' ? city.cityDe : city.cityEn;
    const countryLabel = lang === 'de' ? 'Deutschland' : 'Germany';
    const label = `${cityName}, ${city.state}, ${countryLabel}`;
    const updated: FarmProfile = {
      ...draft,
      country: 'Germany',
      regionState: city.state,
      locationName: label,
      latitude: city.latitude,
      longitude: city.longitude,
      timezone: 'Europe/Berlin',
      soilType: city.typicalSoil,
      isSampleProfile: false,
    };
    setDraft(updated);
    setGeoQuery(label);
    setGeoResults([]);
    setGeoError(null);
    onUpdateFarm(updated);
    setSaveBanner(t('farmSetup.savedBanner'));
  };

  const handleGeocodeSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (geoQuery.trim().length < 2) {
      setGeoError(t('farmSetup.geoMinChars'));
      return;
    }
    setIsSearchingGeo(true);
    setGeoError(null);
    try {
      const candidates = await searchLocations(geoQuery, lang);
      setGeoResults(candidates);
      if (candidates.length === 0) {
        setGeoError(t('farmSetup.geoNoResults'));
      }
    } catch (err) {
      setGeoError(
        err instanceof Error ? err.message : 'Geocoding lookup failed.'
      );
    } finally {
      setIsSearchingGeo(false);
    }
  };

  const handleSelectGeoCandidate = (cand: GeocodingCandidate) => {
    const label = [cand.name, cand.admin1, cand.country]
      .filter(Boolean)
      .join(', ');
    const updated: FarmProfile = {
      ...draft,
      country: cand.country || 'Germany',
      regionState: cand.admin1,
      locationName: label,
      latitude: cand.latitude,
      longitude: cand.longitude,
      timezone: cand.timezone || 'Europe/Berlin',
      isSampleProfile: false,
    };
    setDraft(updated);
    setGeoQuery(label);
    setGeoResults([]);
    onUpdateFarm(updated);
    setSaveBanner(t('farmSetup.savedBanner'));
  };

  const handleSaveProfile = (runAgentsAfterSave: boolean) => {
    const check = validateFarmProfile(draft);
    if (!check.valid) {
      setSaveBanner(null);
      return;
    }
    onUpdateFarm(draft);
    setSaveBanner(t('farmSetup.savedBanner'));
    if (runAgentsAfterSave) {
      onRunEvaluation(draft);
    }
  };

  return (
    <div className="space-y-8">
      {/* Sample Demonstration Farm Loader */}
      <section className="bg-white border border-stone-200/90 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-[#0F291E]">
              {t('farmSetup.title')}
            </h1>
            <p className="text-sm text-stone-600 mt-0.5">
              {t('farmSetup.subtitle')}
            </p>
          </div>
          <span className="text-xs text-stone-500">
            {t('farmSetup.hardConstraintNote')}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {SAMPLE_FARM_PRESETS.map((preset) => {
            const isSelected =
              draft.locationName === preset.profile.locationName &&
              draft.plantingMonth === preset.profile.plantingMonth &&
              draft.areaHa === preset.profile.areaHa &&
              draft.availableWaterValue === preset.profile.availableWaterValue;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleLoadSample(preset.profile)}
                className={`text-left p-4 rounded-lg border transition-colors cursor-pointer ${
                  isSelected
                    ? 'border-emerald-700 bg-[#F2F7F4]'
                    : 'border-stone-200 hover:border-stone-300 bg-stone-50/50'
                }`}
              >
                <div className="text-xs font-medium text-emerald-800 mb-1">
                  {pickBilingual(preset.badge, lang)}
                </div>
                <div className="text-sm font-semibold text-stone-900">
                  {preset.profile.locationName}
                </div>
                <p className="text-xs text-stone-600 mt-1 leading-relaxed">
                  {pickBilingual(preset.summary, lang)}
                </p>
              </button>
            );
          })}
        </div>

        {/* Quick-Select German Cities */}
        <div className="pt-3 border-t border-stone-100 space-y-2">
          <div className="text-xs font-semibold text-stone-700">
            {t('farmSetup.quickCitiesLabel')}
          </div>
          <div className="flex flex-wrap gap-2">
            {GERMAN_CITY_PRESETS.map((city) => {
              const cityLabel = lang === 'de' ? city.cityDe : city.cityEn;
              const isCityActive =
                draft.latitude === city.latitude &&
                draft.longitude === city.longitude;
              return (
                <button
                  key={city.id}
                  type="button"
                  onClick={() => handleSelectGermanCity(city)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                    isCityActive
                      ? 'border-emerald-700 bg-[#F2F7F4] text-emerald-950'
                      : 'border-stone-200 bg-white hover:bg-stone-50 text-stone-700'
                  }`}
                >
                  <MapPin className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                  <span>{cityLabel}</span>
                  <span className="text-[11px] font-mono text-stone-500">
                    ({city.latitude.toFixed(2)}°, {city.longitude.toFixed(2)}°)
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Main Farm Profile Form */}
      <section className="bg-white border border-stone-200/90 rounded-xl p-6 sm:p-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-stone-100">
          <div>
            <h2 className="text-lg font-bold text-[#0F291E]">
              {t('farmSetup.fieldParamsTitle')}
            </h2>
            <p className="text-xs text-stone-500 mt-0.5">
              {t('farmSetup.fieldParamsSub')}
            </p>
          </div>
          {saveBanner && (
            <div className="text-xs text-emerald-800 font-medium flex items-center gap-1.5">
              <Check className="w-4 h-4" />
              {saveBanner}
            </div>
          )}
        </div>

        {/* Location & Geocoding */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 space-y-2">
            <label
              htmlFor="farm-location-search"
              className="block text-xs font-semibold text-stone-800"
            >
              {t('farmSetup.locationLabel')}
            </label>
            <div className="flex gap-2">
              <input
                id="farm-location-search"
                type="text"
                value={geoQuery}
                onChange={(e) => {
                  setGeoQuery(e.target.value);
                  setDraft((prev) => ({
                    ...prev,
                    locationName: e.target.value,
                    isSampleProfile: false,
                  }));
                }}
                placeholder={t('farmSetup.locationPlaceholder')}
                className="flex-1 px-3.5 py-2 rounded-lg border border-stone-300 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
              />
              <button
                type="button"
                onClick={() => handleGeocodeSearch()}
                disabled={isSearchingGeo}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-stone-300 bg-stone-50 hover:bg-stone-100 text-xs font-medium text-stone-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Search className="w-3.5 h-3.5" />
                {isSearchingGeo
                  ? t('farmSetup.searchingBtn')
                  : t('farmSetup.lookupBtn')}
              </button>
            </div>
            {geoError && <p className="text-xs text-amber-800">{geoError}</p>}

            {geoResults.length > 0 && (
              <div className="border border-stone-200 rounded-lg divide-y divide-stone-100 bg-white max-h-48 overflow-y-auto">
                {geoResults.map((cand) => (
                  <button
                    key={cand.id}
                    type="button"
                    onClick={() => handleSelectGeoCandidate(cand)}
                    className="w-full px-3.5 py-2 text-left hover:bg-emerald-50/60 flex items-center justify-between gap-2 text-xs cursor-pointer"
                  >
                    <span className="font-medium text-stone-900 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      {[cand.name, cand.admin1, cand.country]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                    <span className="font-mono tabular-nums text-stone-500 shrink-0">
                      {cand.latitude}°, {cand.longitude}°
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-3 space-y-2">
            <label
              htmlFor="farm-latitude"
              className="block text-xs font-semibold text-stone-800"
            >
              {t('farmSetup.latLabel')}
            </label>
            <input
              id="farm-latitude"
              type="number"
              step="0.0001"
              value={draft.latitude ?? ''}
              onChange={(e) => {
                const raw = e.target.value;
                setDraft((prev) => ({
                  ...prev,
                  latitude: raw === '' ? null : Number(raw),
                  isSampleProfile: false,
                }));
              }}
              placeholder="49.0069"
              className="w-full px-3.5 py-2 rounded-lg border border-stone-300 text-sm font-mono tabular-nums text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
            />
          </div>

          <div className="lg:col-span-3 space-y-2">
            <label
              htmlFor="farm-longitude"
              className="block text-xs font-semibold text-stone-800"
            >
              {t('farmSetup.lonLabel')}
            </label>
            <input
              id="farm-longitude"
              type="number"
              step="0.0001"
              value={draft.longitude ?? ''}
              onChange={(e) => {
                const raw = e.target.value;
                setDraft((prev) => ({
                  ...prev,
                  longitude: raw === '' ? null : Number(raw),
                  isSampleProfile: false,
                }));
              }}
              placeholder="8.4037"
              className="w-full px-3.5 py-2 rounded-lg border border-stone-300 text-sm font-mono tabular-nums text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
            />
          </div>
        </div>

        {/* Soil, Land Area, Planting Month, Preferred Crop */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 pt-2">
          <div className="space-y-2">
            <label
              htmlFor="farm-soil-type"
              className="block text-xs font-semibold text-stone-800"
            >
              {t('farmSetup.soilLabel')}
            </label>
            <select
              id="farm-soil-type"
              value={draft.soilType}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  soilType: e.target.value as SoilType,
                  isSampleProfile: false,
                }))
              }
              className="w-full px-3.5 py-2 rounded-lg border border-stone-300 text-sm text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
            >
              <option value="Loamy">{t('soils.LoamyDesc')}</option>
              <option value="Sandy">{t('soils.SandyDesc')}</option>
              <option value="Clay">{t('soils.ClayDesc')}</option>
              <option value="Silty">{t('soils.SiltyDesc')}</option>
            </select>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="farm-area-ha"
              className="block text-xs font-semibold text-stone-800"
            >
              {t('farmSetup.areaLabel')}
            </label>
            <input
              id="farm-area-ha"
              type="number"
              min="0.1"
              step="0.5"
              value={Number.isNaN(draft.areaHa) ? '' : draft.areaHa}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  areaHa:
                    e.target.value === '' ? Number.NaN : Number(e.target.value),
                  isSampleProfile: false,
                }))
              }
              className="w-full px-3.5 py-2 rounded-lg border border-stone-300 text-sm font-mono tabular-nums text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="farm-planting-month"
              className="block text-xs font-semibold text-stone-800"
            >
              {t('farmSetup.plantingMonthLabel')}
            </label>
            <select
              id="farm-planting-month"
              value={draft.plantingMonth}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  plantingMonth: Number(e.target.value),
                  isSampleProfile: false,
                }))
              }
              className="w-full px-3.5 py-2 rounded-lg border border-stone-300 text-sm text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
            >
              {monthNames.map((m, idx) => (
                <option key={idx + 1} value={idx + 1}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="farm-preferred-crop"
              className="block text-xs font-semibold text-stone-800"
            >
              {t('farmSetup.preferredCropLabel')}
            </label>
            <select
              id="farm-preferred-crop"
              value={draft.preferredCrop}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  preferredCrop: e.target.value as CropId,
                  isSampleProfile: false,
                }))
              }
              className="w-full px-3.5 py-2 rounded-lg border border-stone-300 text-sm text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
            >
              {CROP_DATABASE.crops.map((c) => (
                <option key={c.id} value={c.id}>
                  {pickBilingual(c.names, lang)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Hard Resource Constraints: Irrigation Water (m³) & Farming Budget (€) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
          <div className="lg:col-span-6 space-y-2">
            <label
              htmlFor="farm-water-value"
              className="block text-xs font-semibold text-stone-800"
            >
              {t('farmSetup.waterLabel')}
            </label>
            <div className="flex gap-2">
              <input
                id="farm-water-value"
                type="number"
                min="0"
                step="100"
                value={
                  Number.isNaN(draft.availableWaterValue)
                    ? ''
                    : draft.availableWaterValue
                }
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    availableWaterValue:
                      e.target.value === ''
                        ? Number.NaN
                        : Number(e.target.value),
                    isSampleProfile: false,
                  }))
                }
                className="w-36 sm:w-44 px-3.5 py-2 rounded-lg border border-stone-300 text-sm font-mono tabular-nums text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
              />
              <select
                aria-label="Irrigation water unit and time period"
                value={draft.availableWaterUnit}
                onChange={(e) => {
                  const nextUnit = e.target.value as WaterUnit;
                  let convertedVal = draft.availableWaterValue;
                  if (
                    Number.isFinite(draft.availableWaterValue) &&
                    Number.isFinite(draft.areaHa) &&
                    draft.areaHa > 0
                  ) {
                    if (
                      draft.availableWaterUnit === 'mm_per_ha_season' &&
                      nextUnit === 'm3_total_season'
                    ) {
                      convertedVal = convertMmPerHaToTotalM3(
                        draft.availableWaterValue,
                        draft.areaHa
                      );
                    } else if (
                      draft.availableWaterUnit === 'm3_total_season' &&
                      nextUnit === 'mm_per_ha_season'
                    ) {
                      convertedVal = convertWaterToMmPerHa(
                        draft.availableWaterValue,
                        'm3_total_season',
                        draft.areaHa
                      );
                    }
                  }
                  setDraft((prev) => ({
                    ...prev,
                    availableWaterUnit: nextUnit,
                    availableWaterValue: convertedVal,
                    isSampleProfile: false,
                  }));
                }}
                className="flex-1 px-3 py-2 rounded-lg border border-stone-300 text-xs sm:text-sm text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
              >
                <option value="m3_total_season">
                  {t('farmSetup.waterUnitM3')}
                </option>
                <option value="mm_per_ha_season">
                  {t('farmSetup.waterUnitMm')}
                </option>
              </select>
            </div>
            <p className="text-xs text-stone-500 font-mono tabular-nums">
              {t('farmSetup.waterEquiv', {
                m3: formatNumber(computedTotalM3, lang, 0),
                area: formatNumber(draft.areaHa || 0, lang, 1),
                mm: formatNumber(computedMmHa, lang, 1),
              })}
            </p>
          </div>

          <div className="lg:col-span-6 space-y-2">
            <label
              htmlFor="farm-budget-amount"
              className="block text-xs font-semibold text-stone-800"
            >
              {t('farmSetup.budgetLabel')}
            </label>
            <div className="flex gap-2">
              <select
                aria-label="Farming budget currency"
                value={draft.currency}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    currency: e.target.value as CurrencyCode,
                    isSampleProfile: false,
                  }))
                }
                className="w-28 px-3 py-2 rounded-lg border border-stone-300 text-sm font-mono text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
              >
                <option value="EUR">EUR (€)</option>
                <option value="USD">USD ($)</option>
              </select>
              <input
                id="farm-budget-amount"
                type="number"
                min="0"
                step="500"
                value={
                  Number.isNaN(draft.budgetAmount) ? '' : draft.budgetAmount
                }
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    budgetAmount:
                      e.target.value === ''
                        ? Number.NaN
                        : Number(e.target.value),
                    isSampleProfile: false,
                  }))
                }
                className="flex-1 px-3.5 py-2 rounded-lg border border-stone-300 text-sm font-mono tabular-nums text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
              />
            </div>
            <p className="text-xs text-stone-500 font-mono tabular-nums">
              {t('farmSetup.budgetNote', {
                area: formatNumber(draft.areaHa || 0, lang, 1),
              })}
            </p>
          </div>
        </div>

        {/* Farmer Priority Selector */}
        <div className="pt-2 space-y-2.5">
          <span className="block text-xs font-semibold text-stone-800">
            {t('farmSetup.priorityLabel')}
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {(
              [
                'balanced',
                'max_profit',
                'min_climate_risk',
                'min_water',
              ] as PriorityMode[]
            ).map((id) => {
              const active = draft.priorityMode === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      priorityMode: id,
                      customWeights: null,
                      isSampleProfile: false,
                    }))
                  }
                  className={`text-left p-3.5 rounded-lg border transition-colors cursor-pointer ${
                    active
                      ? 'border-emerald-700 bg-[#F2F7F4]'
                      : 'border-stone-200 hover:border-stone-300 bg-white'
                  }`}
                >
                  <div className="text-xs font-semibold text-stone-900">
                    {t(`priorities.${id}`)}
                  </div>
                  <p className="text-[11px] text-stone-600 mt-1 leading-relaxed">
                    {t(`priorities.${id}Desc`)}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Validation Feedback */}
        {(!validation.valid ||
          validation.missingUncertaintyBilingual.length > 0) && (
          <div
            role="alert"
            className={`p-4 rounded-lg border text-xs space-y-1.5 ${
              !validation.valid
                ? 'bg-red-50 border-red-200 text-red-900'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            <div className="font-semibold flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {!validation.valid
                ? t('farmSetup.validationErrorHeader')
                : t('farmSetup.missingCoordHeader')}
            </div>
            <ul className="list-disc list-inside space-y-0.5">
              {validation.issues.map((iss, idx) => (
                <li key={`err-${idx}`}>
                  {pickBilingual(iss.messageBilingual, lang)}
                </li>
              ))}
              {validation.missingUncertaintyBilingual.map((msg, idx) => (
                <li key={`unc-${idx}`}>{pickBilingual(msg, lang)}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Form Actions */}
        <div className="pt-4 border-t border-stone-100 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => handleLoadSample(SAMPLE_FARM_PRESETS[0].profile)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-stone-300 text-xs font-medium text-stone-700 hover:bg-stone-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {t('farmSetup.resetSampleBtn')}
          </button>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => handleSaveProfile(false)}
              disabled={!validation.valid}
              className="px-4 py-2.5 rounded-lg border border-stone-300 bg-white hover:bg-stone-50 disabled:opacity-50 text-xs sm:text-sm font-medium text-stone-900 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {t('farmSetup.updateSimBtn')}
            </button>
            <button
              type="button"
              onClick={() => handleSaveProfile(true)}
              disabled={!validation.valid || isEvaluating}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#0F291E] hover:bg-[#163B2B] disabled:opacity-50 text-white text-xs sm:text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Play className="w-4 h-4" />
              {isEvaluating
                ? t('overview.runningBtn')
                : t('farmSetup.saveAndRunBtn')}
            </button>
          </div>
        </div>
      </section>

      {/* Transparent German Crop Knowledge Base Inspector */}
      <section className="bg-white border border-stone-200/90 rounded-xl p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-emerald-800 shrink-0" />
            <h2 className="text-base font-bold text-[#0F291E]">
              {t('farmSetup.kbTitle')}
            </h2>
          </div>
          <span className="text-xs text-stone-500">
            {t('farmSetup.kbSourceTag', { version: CROP_DATABASE.version })}
          </span>
        </div>

        <p className="text-xs text-stone-600 mb-4 leading-relaxed">
          {pickBilingual(CROP_DATABASE.illustrativeDisclaimer, lang)}
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-stone-200 text-stone-500">
                <th className="py-2.5 pr-4 font-semibold">
                  {t('farmSetup.colCrop')}
                </th>
                <th className="py-2.5 px-3 font-semibold">
                  {t('farmSetup.colWindow')}
                </th>
                <th className="py-2.5 px-3 font-semibold text-right">
                  {t('farmSetup.colWater')}
                </th>
                <th className="py-2.5 px-3 font-semibold text-right">
                  {t('farmSetup.colCost')}
                </th>
                <th className="py-2.5 px-3 font-semibold text-right">
                  {t('farmSetup.colYield')}
                </th>
                <th className="py-2.5 px-3 font-semibold text-right">
                  {t('farmSetup.colPrice')}
                </th>
                <th className="py-2.5 pl-3 font-semibold">
                  {t('farmSetup.colSoil')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {CROP_DATABASE.crops.map((crop) => (
                <tr key={crop.id} className="hover:bg-stone-50/70">
                  <td className="py-3 pr-4">
                    <div className="font-semibold text-stone-900">
                      {pickBilingual(crop.names, lang)}
                    </div>
                    <div className="text-[11px] italic text-stone-500">
                      {crop.scientificName}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-stone-700">
                    {pickBilingual(crop.plantingWindow.label, lang)}
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-stone-700">
                    {crop.seasonalWaterMmHa.totalDemandMin}–
                    {crop.seasonalWaterMmHa.totalDemandOptimal} /{' '}
                    {crop.seasonalWaterMmHa.typicalGermanSeasonRainMm}
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-stone-700">
                    {formatNumber(crop.inputCostsEurPerHa.total, lang, 0)} €
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-stone-700">
                    <span className="font-semibold text-emerald-800">
                      {formatNumber(
                        crop.indicativeYieldTonsPerHa.destatisNationalAvgTonsHa,
                        lang,
                        2
                      )}
                    </span>{' '}
                    ({formatNumber(crop.indicativeYieldTonsPerHa.low, lang, 1)}–
                    {formatNumber(crop.indicativeYieldTonsPerHa.high, lang, 1)})
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-stone-700">
                    {formatNumber(
                      crop.indicativeMarketPriceEurPerTon.low,
                      lang,
                      0
                    )}
                    –
                    {formatNumber(
                      crop.indicativeMarketPriceEurPerTon.high,
                      lang,
                      0
                    )}{' '}
                    €
                  </td>
                  <td className="py-3 pl-3 font-mono tabular-nums text-stone-600">
                    {crop.soilCompatibility.Loamy} /{' '}
                    {crop.soilCompatibility.Sandy} /{' '}
                    {crop.soilCompatibility.Clay} /{' '}
                    {crop.soilCompatibility.Silty}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
