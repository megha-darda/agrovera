import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  CalendarClock,
  ChevronDown,
  ClipboardList,
  CloudSun,
  Cpu,
  GitBranch,
  History,
  Home,
  Menu,
  Sliders,
  Sprout,
  Tractor,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AgroVeraLogo } from './components/AgroVeraLogo.tsx';
import { ClimateIntelligenceView } from './components/ClimateIntelligenceView.tsx';
import { CropSimulatorView } from './components/CropSimulatorView.tsx';
import { DataSourcesView } from './components/DataSourcesView.tsx';
import { DecisionCenterView } from './components/DecisionCenterView.tsx';
import { FarmSetupView } from './components/FarmSetupView.tsx';
import { HomeView } from './components/HomeView.tsx';
import { InSeasonCareView } from './components/InSeasonCareView.tsx';
import { OverviewView } from './components/OverviewView.tsx';
import { ScenarioAnalysisView } from './components/ScenarioAnalysisView.tsx';
import { DEFAULT_IN_SEASON_INPUTS } from './engine/inSeasonCare.ts';
import {
  DEFAULT_SAMPLE_FARM,
  DEFAULT_WEATHER_THRESHOLDS,
} from './engine/presets.ts';
import {
  normalizePreferenceWeights,
  simulateCrops,
  validateFarmProfile,
} from './engine/simulator.ts';
import { parseOpenMeteoForecast } from './engine/weather.ts';
import { setAppLanguage } from './i18n/index.ts';
import {
  fetchLiveWeatherForecast,
  fetchServerConfigStatus,
  runFullAgenticEvaluation,
  runInSeasonAgenticEvaluation,
  type ServerConfigStatus,
} from './services/apiClient.ts';
import type {
  AgenticEvaluationResponse,
  AppLanguage,
  BaselineReferenceContext,
  ClimateScenarioId,
  FarmerMode,
  FarmProfile,
  InSeasonCareInputs,
  InSeasonEvaluationResponse,
  NavigationTab,
  PreferenceWeights,
  PriorityMode,
  ScenarioParametersOverride,
  SimulationRunOutput,
  WeatherForecastAnalysis,
  WeatherThresholds,
} from './types/domain.ts';
import { formatSoilName } from './utils/formatters.ts';

function buildParamSignature(
  farm: FarmProfile,
  scenarioId: ClimateScenarioId,
  scenarioOverride?: ScenarioParametersOverride,
  weatherThresholds?: WeatherThresholds
): string {
  return JSON.stringify({
    loc: farm.locationName,
    lat: farm.latitude,
    lon: farm.longitude,
    soil: farm.soilType,
    area: farm.areaHa,
    waterVal: farm.availableWaterValue,
    waterUnit: farm.availableWaterUnit,
    budget: farm.budgetAmount,
    curr: farm.currency,
    pref: farm.preferredCrop,
    month: farm.plantingMonth,
    prio: farm.priorityMode,
    weights: normalizePreferenceWeights(farm),
    scen: scenarioId,
    over: scenarioOverride ?? null,
    thresh: weatherThresholds ?? null,
  });
}

function buildInSeasonSignature(
  farm: FarmProfile,
  inputs: InSeasonCareInputs,
  weatherThresholds?: WeatherThresholds
): string {
  return JSON.stringify({
    loc: farm.locationName,
    lat: farm.latitude,
    lon: farm.longitude,
    soil: farm.soilType,
    area: farm.areaHa,
    waterVal: farm.availableWaterValue,
    waterUnit: farm.availableWaterUnit,
    budget: farm.budgetAmount,
    curr: farm.currency,
    crop: inputs.plantedCropId,
    plantDate: inputs.plantingDate,
    stage: inputs.growthStage,
    usedM3: inputs.irrigationUsedM3,
    notes: inputs.conditionNotes.trim(),
    thresh: weatherThresholds ?? null,
  });
}

export default function App() {
  const { t, i18n } = useTranslation();
  const lang: AppLanguage = i18n.language === 'de' ? 'de' : 'en';

  const [farmerMode, setFarmerMode] = useState<FarmerMode>('plan_season');
  const [activeTab, setActiveTab] = useState<NavigationTab>('home');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [farm, setFarm] = useState<FarmProfile>(DEFAULT_SAMPLE_FARM);
  const [inSeasonInputs, setInSeasonInputs] = useState<InSeasonCareInputs>(
    DEFAULT_IN_SEASON_INPUTS
  );
  const [scenarioId, setScenarioId] = useState<ClimateScenarioId>('baseline');
  const [scenarioOverrides, setScenarioOverrides] = useState<
    Partial<Record<ClimateScenarioId, ScenarioParametersOverride>>
  >({});
  const [weatherThresholds, setWeatherThresholds] = useState<WeatherThresholds>(
    DEFAULT_WEATHER_THRESHOLDS
  );

  const [weather, setWeather] = useState<WeatherForecastAnalysis | null>(null);
  const [isFetchingWeather, setIsFetchingWeather] = useState(false);

  // Plan-Season AI cache keyed by (paramSignature + language) — never displays stale recommendations
  const [evaluationCache, setEvaluationCache] = useState<
    Record<string, AgenticEvaluationResponse>
  >({});
  const [latestEvaluationKey, setLatestEvaluationKey] = useState<string | null>(
    null
  );

  // In-Season Care AI cache keyed by (inSeasonSignature + language) — never displays stale advice
  const [inSeasonEvalCache, setInSeasonEvalCache] = useState<
    Record<string, InSeasonEvaluationResponse>
  >({});
  const [latestInSeasonKey, setLatestInSeasonKey] = useState<string | null>(
    null
  );

  // In-flight lock preventing duplicate concurrent Gemini requests
  const geminiInFlightRef = useRef(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isEvaluatingInSeason, setIsEvaluatingInSeason] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [configStatus, setConfigStatus] = useState<ServerConfigStatus | null>(
    null
  );

  // Truthful elapsed timer while any Gemini analysis is running
  useEffect(() => {
    if (!isEvaluating && !isEvaluatingInSeason) {
      setElapsedSeconds(0);
      return;
    }
    setElapsedSeconds(0);
    const id = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [isEvaluating, isEvaluatingInSeason]);

  const activeScenarioOverride = scenarioOverrides[scenarioId];

  // Live deterministic simulation reacts immediately to farm, weather, or scenario updates — language-invariant!
  const simulation: SimulationRunOutput = useMemo(
    () => simulateCrops(farm, weather, scenarioId, activeScenarioOverride),
    [farm, weather, scenarioId, activeScenarioOverride]
  );

  const currentSig = useMemo(
    () =>
      buildParamSignature(
        farm,
        scenarioId,
        activeScenarioOverride,
        weatherThresholds
      ),
    [farm, scenarioId, activeScenarioOverride, weatherThresholds]
  );

  const evaluation: AgenticEvaluationResponse | null = useMemo(() => {
    const exactKey = `${currentSig}::${lang}`;
    if (evaluationCache[exactKey]) return evaluationCache[exactKey];
    const otherLang: AppLanguage = lang === 'de' ? 'en' : 'de';
    const altKey = `${currentSig}::${otherLang}`;
    if (evaluationCache[altKey]) return evaluationCache[altKey];
    return null;
  }, [currentSig, evaluationCache, lang]);

  const staleEvaluation: AgenticEvaluationResponse | null = useMemo(() => {
    if (evaluation) return null;
    if (latestEvaluationKey && evaluationCache[latestEvaluationKey]) {
      return evaluationCache[latestEvaluationKey];
    }
    return null;
  }, [evaluation, evaluationCache, latestEvaluationKey]);

  const currentInSeasonSig = useMemo(
    () => buildInSeasonSignature(farm, inSeasonInputs, weatherThresholds),
    [farm, inSeasonInputs, weatherThresholds]
  );

  const inSeasonEvaluation: InSeasonEvaluationResponse | null = useMemo(() => {
    const exactKey = `${currentInSeasonSig}::${lang}`;
    if (inSeasonEvalCache[exactKey]) return inSeasonEvalCache[exactKey];
    const otherLang: AppLanguage = lang === 'de' ? 'en' : 'de';
    const altKey = `${currentInSeasonSig}::${otherLang}`;
    if (inSeasonEvalCache[altKey]) return inSeasonEvalCache[altKey];
    return null;
  }, [currentInSeasonSig, inSeasonEvalCache, lang]);

  const hasStaleInSeasonEvaluation = Boolean(
    !inSeasonEvaluation &&
      latestInSeasonKey &&
      inSeasonEvalCache[latestInSeasonKey]
  );

  // Baseline reference snapshot for side-by-side Scenario Analysis comparison
  const [baselineSnapshot, setBaselineSnapshot] = useState<{
    farm: FarmProfile;
    scenarioId: ClimateScenarioId;
    simulation: SimulationRunOutput;
    evaluation: AgenticEvaluationResponse | null;
  }>(() => ({
    farm: DEFAULT_SAMPLE_FARM,
    scenarioId: 'baseline',
    simulation: simulateCrops(DEFAULT_SAMPLE_FARM, null, 'baseline'),
    evaluation: null,
  }));

  useEffect(() => {
    fetchServerConfigStatus()
      .then((st) => setConfigStatus(st))
      .catch(() => {
        // Non-blocking
      });
  }, []);

  // Automatically fetch real DWD ICON / Open-Meteo forecast when coordinates change
  const refreshWeather = useCallback(
    async (targetFarm: FarmProfile = farm, thresh = weatherThresholds) => {
      if (targetFarm.latitude === null || targetFarm.longitude === null) {
        setWeather(null);
        return;
      }
      setIsFetchingWeather(true);
      try {
        const live = await fetchLiveWeatherForecast({
          latitude: targetFarm.latitude,
          longitude: targetFarm.longitude,
          locationLabel: targetFarm.locationName,
          thresholds: thresh,
        });
        setWeather(live);
        setBaselineSnapshot((prev) => {
          if (
            prev.evaluation === null &&
            prev.farm.locationName === targetFarm.locationName &&
            prev.scenarioId === 'baseline'
          ) {
            return {
              ...prev,
              simulation: simulateCrops(prev.farm, live, 'baseline'),
            };
          }
          return prev;
        });
      } catch (err) {
        setPipelineError(
          err instanceof Error
            ? err.message
            : 'Weather forecast request failed.'
        );
      } finally {
        setIsFetchingWeather(false);
      }
    },
    [farm, weatherThresholds]
  );

  useEffect(() => {
    void refreshWeather(DEFAULT_SAMPLE_FARM, DEFAULT_WEATHER_THRESHOLDS);
    // Run once on startup for Karlsruhe default coordinates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpdateThresholds = (next: WeatherThresholds) => {
    setWeatherThresholds(next);
    if (weather && weather.status === 'ok' && weather.daily.length > 0) {
      const reparsed = parseOpenMeteoForecast(
        {
          latitude: weather.coordinates?.latitude,
          longitude: weather.coordinates?.longitude,
          elevation: weather.coordinates?.elevationM,
          timezone: weather.coordinates?.timezone,
          daily: {
            time: weather.daily.map((d) => d.date),
            temperature_2m_max: weather.daily.map((d) => d.tempMaxC),
            temperature_2m_min: weather.daily.map((d) => d.tempMinC),
            precipitation_sum: weather.daily.map((d) => d.precipMm),
            et0_fao_evapotranspiration: weather.daily.map((d) => d.et0Mm),
          },
        },
        weather.locationLabel,
        next,
        weather.providerModel
      );
      setWeather(reparsed);
    }
  };

  const executePipeline = useCallback(
    async (
      targetFarm: FarmProfile,
      targetScenario: ClimateScenarioId,
      includeBaselineComparison: boolean,
      targetLang: AppLanguage = lang,
      targetOverride?: ScenarioParametersOverride
    ) => {
      if (geminiInFlightRef.current) {
        return;
      }

      const check = validateFarmProfile(targetFarm);
      if (!check.valid) {
        setPipelineError(
          check.issues
            .map((i) =>
              targetLang === 'de' ? i.messageBilingual.de : i.message
            )
            .join(' ')
        );
        return;
      }

      geminiInFlightRef.current = true;
      setIsEvaluating(true);
      setPipelineError(null);

      let baselineComparison: BaselineReferenceContext | undefined;
      if (includeBaselineComparison) {
        const baseRec =
          baselineSnapshot.evaluation?.decision?.recommendedCropId ??
          baselineSnapshot.simulation.topFeasibleCropId ??
          'none';
        baselineComparison = {
          scenarioId: baselineSnapshot.scenarioId,
          availableWaterM3:
            baselineSnapshot.simulation.farmSummary.availableIrrigationTotalM3,
          availableWaterMmHa:
            baselineSnapshot.simulation.farmSummary.availableIrrigationMmHa,
          budgetAmount: baselineSnapshot.farm.budgetAmount,
          currency: baselineSnapshot.farm.currency,
          priorityMode: baselineSnapshot.farm.priorityMode,
          plantingMonth: baselineSnapshot.farm.plantingMonth,
          recommendedCropId: baseRec,
          topFeasibleCropId: baselineSnapshot.simulation.topFeasibleCropId,
          cropRankings: baselineSnapshot.simulation.cropResults.map((c) => ({
            cropId: c.cropId,
            feasibilityStatus: c.feasibilityStatus,
            score: c.scores.weightedSuitability,
          })),
        };
      }

      try {
        const result = await runFullAgenticEvaluation({
          farm: targetFarm,
          scenarioId: targetScenario,
          scenarioOverride: targetOverride,
          weatherThresholds,
          language: targetLang,
          baselineComparison,
        });
        setWeather(result.weather);

        const sig = buildParamSignature(
          targetFarm,
          targetScenario,
          targetOverride,
          weatherThresholds
        );
        const cacheKey = `${sig}::${targetLang}`;
        setEvaluationCache((prev) => ({
          ...prev,
          [cacheKey]: result,
        }));
        setLatestEvaluationKey(cacheKey);

        if (
          targetScenario === 'baseline' &&
          !targetOverride &&
          baselineSnapshot.evaluation === null
        ) {
          setBaselineSnapshot({
            farm: targetFarm,
            scenarioId: 'baseline',
            simulation: result.simulation,
            evaluation: result,
          });
        }
      } catch (err) {
        setPipelineError(
          err instanceof Error
            ? err.message
            : 'Agentic evaluation request failed.'
        );
      } finally {
        geminiInFlightRef.current = false;
        setIsEvaluating(false);
      }
    },
    [baselineSnapshot, lang, weatherThresholds]
  );

  const executeInSeasonPipeline = useCallback(async () => {
    if (geminiInFlightRef.current) {
      return;
    }

    geminiInFlightRef.current = true;
    setIsEvaluatingInSeason(true);
    setPipelineError(null);

    try {
      const result = await runInSeasonAgenticEvaluation({
        farm,
        inputs: inSeasonInputs,
        weatherThresholds,
        language: lang,
      });
      if (result.weather?.status === 'ok') {
        setWeather(result.weather);
      }

      const sig = buildInSeasonSignature(farm, inSeasonInputs, weatherThresholds);
      const cacheKey = `${sig}::${lang}`;
      setInSeasonEvalCache((prev) => ({
        ...prev,
        [cacheKey]: result,
      }));
      setLatestInSeasonKey(cacheKey);
    } catch (err) {
      setPipelineError(
        err instanceof Error
          ? err.message
          : 'In-season AI evaluation request failed.'
      );
    } finally {
      geminiInFlightRef.current = false;
      setIsEvaluatingInSeason(false);
    }
  }, [farm, inSeasonInputs, lang, weatherThresholds]);

  const handleUpdateFarm = (updated: FarmProfile) => {
    const coordsChanged =
      updated.latitude !== farm.latitude ||
      updated.longitude !== farm.longitude;
    setFarm(updated);
    const weatherForSnap = coordsChanged ? null : weather;
    setBaselineSnapshot({
      farm: updated,
      scenarioId: 'baseline',
      simulation: simulateCrops(updated, weatherForSnap, 'baseline'),
      evaluation: null,
    });
    if (coordsChanged) {
      void refreshWeather(updated, weatherThresholds);
    }
  };

  const handleUpdateWeights = (
    weights: PreferenceWeights,
    mode?: PriorityMode
  ) => {
    setFarm((prev) => ({
      ...prev,
      priorityMode: mode ?? prev.priorityMode,
      customWeights: mode ? null : weights,
    }));
  };

  // Selecting climate scenarios updates deterministic state ONLY — never auto-starts Gemini
  const handleSelectScenario = (nextScenario: ClimateScenarioId) => {
    setScenarioId(nextScenario);
  };

  const handleUpdateScenarioOverride = (
    nextOverride: ScenarioParametersOverride | undefined
  ) => {
    setScenarioOverrides((prev) => {
      const next = { ...prev };
      if (!nextOverride) {
        delete next[scenarioId];
      } else {
        next[scenarioId] = nextOverride;
      }
      return next;
    });
  };

  const handleUpdateScenarioControls = (updates: {
    availableWaterValue?: number;
    budgetAmount?: number;
    priorityMode?: PriorityMode;
  }) => {
    setFarm((prev) => ({
      ...prev,
      availableWaterValue:
        updates.availableWaterValue ?? prev.availableWaterValue,
      budgetAmount: updates.budgetAmount ?? prev.budgetAmount,
      priorityMode: updates.priorityMode ?? prev.priorityMode,
      customWeights: updates.priorityMode ? null : prev.customWeights,
    }));
  };

  const handlePinCurrentAsBaseline = () => {
    setBaselineSnapshot({
      farm,
      scenarioId,
      simulation,
      evaluation,
    });
  };

  const primaryNavItems: Array<{
    id: NavigationTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'home', label: t('nav.home'), icon: Home },
    { id: 'farm-setup', label: t('nav.myFarm'), icon: Tractor },
    { id: 'overview', label: t('nav.myResults'), icon: ClipboardList },
  ];

  const advancedNavItems: Array<{
    id: NavigationTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'climate', label: t('nav.climate'), icon: CloudSun },
    { id: 'simulator', label: t('nav.simulator'), icon: Sliders },
    { id: 'decision-center', label: t('nav.decisionCenter'), icon: Cpu },
    { id: 'scenarios', label: t('nav.scenarios'), icon: GitBranch },
    { id: 'data-sources', label: t('nav.dataSources'), icon: BookOpen },
    { id: 'timeline', label: t('nav.timeline'), icon: History },
  ];

  const isAdvancedTab = advancedNavItems.some((item) => item.id === activeTab);

  const activeNavLabel =
    activeTab === 'overview'
      ? farmerMode === 'in_season'
        ? t('modes.inSeason')
        : t('modes.planSeason')
      : (primaryNavItems.find((item) => item.id === activeTab)?.label ??
        advancedNavItems.find((item) => item.id === activeTab)?.label ??
        t('nav.home'));

  return (
    <div className="min-h-screen flex bg-[#F8F9F7] text-[#111C16]">
      {/* Desktop Sidebar Navigation: Home, My Farm, My Results, Advanced Details (Collapsible) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-[#0F291E] text-[#F1F5F2] border-r border-[#1A3D2E]">
        <div className="px-6 py-5 border-b border-[#1D4232]">
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className="text-left cursor-pointer w-full"
          >
            <AgroVeraLogo tagline={t('brand.tagline')} theme="dark" />
          </button>
        </div>

        <nav
          aria-label={t('nav.workspaceAria')}
          data-testid="primary-sidebar-nav"
          className="flex-1 px-3 py-5 space-y-1.5 overflow-y-auto"
        >
          {primaryNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-[#1D4634] text-white'
                    : 'text-[#C6D6CD] hover:bg-[#163829] hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}

          {/* Collapsible Advanced Details Menu */}
          <details
            open={isAdvancedTab}
            data-testid="advanced-details-menu"
            className="pt-2 mt-2 border-t border-[#1D4232] group"
          >
            <summary className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-lg text-sm font-medium text-[#C6D6CD] hover:bg-[#163829] hover:text-white cursor-pointer select-none list-none">
              <span className="truncate">{t('nav.advancedDetails')}</span>
              <ChevronDown className="w-4 h-4 shrink-0 transition-transform group-open:rotate-180" />
            </summary>

            <div className="mt-1 pl-2 space-y-1">
              {advancedNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-[#1D4634] text-white'
                        : 'text-[#B8CCC0] hover:bg-[#163829] hover:text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate text-left">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </details>
        </nav>

        {configStatus && !configStatus.geminiKeyConfigured && (
          <div className="m-3 rounded-lg bg-[#153628] border border-[#224E3B] text-[11px] text-amber-300 p-3">
            {t('header.missingApiKey')}
          </div>
        )}
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 w-72 max-w-[82vw] bg-[#0F291E] text-white flex flex-col justify-between p-4 overflow-y-auto">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-[#1D4232]">
                <AgroVeraLogo compact theme="dark" />
                <button
                  type="button"
                  aria-label={t('nav.closeMenu')}
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1.5 rounded-lg text-stone-300 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav aria-label={t('nav.mobileAria')} className="mt-4 space-y-1.5">
                {primaryNavItems.map((item) => {
                  const Icon = item.icon;
                  const active = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveTab(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium cursor-pointer ${
                        active
                          ? 'bg-[#1D4634] text-white'
                          : 'text-[#C6D6CD] hover:bg-[#163829]'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}

                <details
                  open={isAdvancedTab}
                  className="pt-2 mt-2 border-t border-[#1D4232] group"
                >
                  <summary className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-lg text-sm font-medium text-[#C6D6CD] hover:bg-[#163829] cursor-pointer select-none list-none">
                    <span>{t('nav.advancedDetails')}</span>
                    <ChevronDown className="w-4 h-4 shrink-0 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="mt-1 pl-2 space-y-1">
                    {advancedNavItems.map((item) => {
                      const Icon = item.icon;
                      const active = activeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setActiveTab(item.id);
                            setMobileMenuOpen(false);
                          }}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer ${
                            active
                              ? 'bg-[#1D4634] text-white'
                              : 'text-[#B8CCC0] hover:bg-[#163829]'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate text-left">
                            {item.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </details>
              </nav>
            </div>
            <div className="text-[11px] text-emerald-200/80 pt-4 border-t border-[#1D4232]">
              {t('brand.tagline')}
            </div>
          </div>
        </div>
      )}

      {/* Main Workspace Canvas */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Clean Top Bar: Page Title + Small Bilingual EN | DE Switcher */}
        <header className="min-h-14 py-2 px-4 sm:px-8 bg-white border-b border-stone-200/90 flex items-center justify-between gap-3 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label={t('nav.openMenu')}
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-lg text-stone-700 hover:bg-stone-100 cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-xs sm:text-sm text-stone-500 truncate">
              <button
                type="button"
                onClick={() => setActiveTab('home')}
                className="font-bold text-[#0F291E] hover:underline whitespace-nowrap cursor-pointer"
              >
                AgroVera
              </button>
              <span aria-hidden="true">/</span>
              <span className="font-medium text-stone-900 whitespace-nowrap">
                {activeNavLabel}
              </span>
              <span className="hidden md:inline" aria-hidden="true">
                ·
              </span>
              <span className="hidden md:inline text-xs text-stone-500 truncate">
                {farm.locationName} ({farm.areaHa} ha{' '}
                {formatSoilName(farm.soilType, lang)})
              </span>
            </div>
          </div>

          {/* Small Bilingual EN | DE Switcher */}
          <div
            role="group"
            aria-label="Language Switcher"
            data-testid="language-switcher"
            className="inline-flex items-center rounded-lg border border-stone-200 bg-stone-100 p-0.5 text-xs font-semibold shrink-0"
          >
            <button
              type="button"
              onClick={() => setAppLanguage('en')}
              aria-pressed={lang === 'en'}
              className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                lang === 'en'
                  ? 'bg-white text-[#0F291E] shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => setAppLanguage('de')}
              aria-pressed={lang === 'de'}
              className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                lang === 'de'
                  ? 'bg-white text-[#0F291E] shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              DE
            </button>
          </div>
        </header>

        {/* Non-blocking Pipeline Error Notice */}
        {pipelineError && (
          <div
            role="alert"
            className="mx-4 sm:mx-8 mt-4 p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900 flex items-center justify-between gap-4"
          >
            <span>
              <strong>{t('header.requestError')}</strong> {pipelineError}
            </span>
            <button
              type="button"
              onClick={() => setPipelineError(null)}
              className="font-semibold underline shrink-0 cursor-pointer"
            >
              {t('header.dismiss')}
            </button>
          </div>
        )}

        {/* Active View Content */}
        <main className="flex-1 px-4 sm:px-8 py-6 sm:py-8 max-w-[1360px] w-full mx-auto">
          {activeTab === 'home' && (
            <HomeView
              farm={farm}
              availableWaterM3={
                simulation.farmSummary.availableIrrigationTotalM3
              }
              onSelectPlanCrop={() => {
                setFarmerMode('plan_season');
                setActiveTab('overview');
              }}
              onSelectProtectCrop={() => {
                setFarmerMode('in_season');
                setActiveTab('overview');
              }}
              onEditFarm={() => setActiveTab('farm-setup')}
            />
          )}

          {activeTab === 'overview' && (
            <div className="space-y-5">
              {/* Mode Switcher inside My Results: Plan My Crop | Protect My Crop */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div
                  role="group"
                  aria-label={t('modes.switcherAria')}
                  data-testid="farmer-mode-switcher"
                  className="inline-flex items-center rounded-xl border border-stone-200 bg-white p-1 text-xs sm:text-sm font-semibold shadow-2xs"
                >
                  <button
                    type="button"
                    onClick={() => setFarmerMode('plan_season')}
                    aria-pressed={farmerMode === 'plan_season'}
                    className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                      farmerMode === 'plan_season'
                        ? 'bg-[#0F291E] text-white'
                        : 'text-stone-700 hover:text-stone-950'
                    }`}
                  >
                    <CalendarClock className="w-4 h-4 shrink-0" />
                    <span>{t('modes.planSeason')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFarmerMode('in_season')}
                    aria-pressed={farmerMode === 'in_season'}
                    className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                      farmerMode === 'in_season'
                        ? 'bg-[#0F291E] text-white'
                        : 'text-stone-700 hover:text-stone-950'
                    }`}
                  >
                    <Sprout className="w-4 h-4 shrink-0" />
                    <span>{t('modes.inSeason')}</span>
                  </button>
                </div>
              </div>

              {farmerMode === 'in_season' ? (
                <InSeasonCareView
                  farm={farm}
                  inputs={inSeasonInputs}
                  weather={weather}
                  isFetchingWeather={isFetchingWeather}
                  evaluation={inSeasonEvaluation}
                  hasStaleEvaluation={hasStaleInSeasonEvaluation}
                  isEvaluating={isEvaluatingInSeason}
                  elapsedSeconds={elapsedSeconds}
                  onUpdateInputs={setInSeasonInputs}
                  onRefreshWeather={() =>
                    refreshWeather(farm, weatherThresholds)
                  }
                  onRunInSeasonEvaluation={() => {
                    void executeInSeasonPipeline();
                  }}
                  onEditFarmSetup={() => setActiveTab('farm-setup')}
                />
              ) : (
                <OverviewView
                  farm={farm}
                  weather={weather}
                  simulation={simulation}
                  evaluation={evaluation}
                  hasStaleEvaluation={Boolean(staleEvaluation)}
                  isEvaluating={isEvaluating}
                  elapsedSeconds={elapsedSeconds}
                  onRunEvaluation={() =>
                    executePipeline(
                      farm,
                      scenarioId,
                      Boolean(evaluation || staleEvaluation),
                      lang,
                      activeScenarioOverride
                    )
                  }
                  onNavigate={setActiveTab}
                />
              )}
            </div>
          )}

          {activeTab === 'farm-setup' && (
            <FarmSetupView
              farm={farm}
              onUpdateFarm={handleUpdateFarm}
              onSaveAndViewResults={() => setActiveTab('overview')}
              onRunEvaluation={(overrideFarm) => {
                const target = overrideFarm ?? farm;
                setFarmerMode('plan_season');
                setActiveTab('overview');
                void executePipeline(
                  target,
                  scenarioId,
                  false,
                  lang,
                  activeScenarioOverride
                );
              }}
              isEvaluating={isEvaluating}
            />
          )}

          {activeTab === 'climate' && (
            <ClimateIntelligenceView
              farm={farm}
              weather={weather}
              thresholds={weatherThresholds}
              isFetchingWeather={isFetchingWeather}
              onUpdateThresholds={handleUpdateThresholds}
              onRefreshWeather={() => refreshWeather(farm, weatherThresholds)}
              onNavigate={setActiveTab}
            />
          )}

          {activeTab === 'simulator' && (
            <CropSimulatorView
              farm={farm}
              simulation={simulation}
              onUpdateWeights={handleUpdateWeights}
              onNavigate={setActiveTab}
            />
          )}

          {(activeTab === 'decision-center' || activeTab === 'timeline') && (
            <DecisionCenterView
              evaluation={evaluation}
              staleEvaluation={staleEvaluation}
              isEvaluating={isEvaluating}
              elapsedSeconds={elapsedSeconds}
              focusTimeline={activeTab === 'timeline'}
              onRunEvaluation={() =>
                executePipeline(
                  farm,
                  scenarioId,
                  Boolean(evaluation || staleEvaluation),
                  lang,
                  activeScenarioOverride
                )
              }
            />
          )}

          {activeTab === 'scenarios' && (
            <ScenarioAnalysisView
              farm={farm}
              scenarioId={scenarioId}
              scenarioOverride={activeScenarioOverride}
              simulation={simulation}
              baselineSnapshot={baselineSnapshot}
              currentEvaluation={evaluation}
              isEvaluating={isEvaluating}
              onSelectScenario={handleSelectScenario}
              onUpdateScenarioOverride={handleUpdateScenarioOverride}
              onUpdateScenarioControls={handleUpdateScenarioControls}
              onRunScenarioEvaluation={() =>
                executePipeline(
                  farm,
                  scenarioId,
                  true,
                  lang,
                  activeScenarioOverride
                )
              }
              onPinCurrentAsBaseline={handlePinCurrentAsBaseline}
            />
          )}

          {activeTab === 'data-sources' && <DataSourcesView />}
        </main>

        {/* Quiet Informational Footer */}
        <footer className="px-4 sm:px-8 py-4 border-t border-stone-200/80 text-xs text-stone-500 flex flex-wrap items-center justify-between gap-2 max-w-[1360px] w-full mx-auto">
          <span>{t('footer.left')}</span>
          <div className="flex flex-wrap items-center gap-3">
            <span>{t('footer.right')}</span>
            <button
              type="button"
              onClick={() => setActiveTab('data-sources')}
              className="font-semibold text-emerald-800 hover:underline cursor-pointer"
            >
              {t('footer.sourcesLink')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
