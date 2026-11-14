import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BookOpen,
  CloudSun,
  Cpu,
  GitBranch,
  LayoutDashboard,
  Menu,
  Play,
  Sliders,
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
import { OverviewView } from './components/OverviewView.tsx';
import { ScenarioAnalysisView } from './components/ScenarioAnalysisView.tsx';
import {
  DEFAULT_SAMPLE_FARM,
  DEFAULT_WEATHER_THRESHOLDS,
  PRIORITY_WEIGHT_PRESETS,
} from './engine/presets.ts';
import { simulateCrops, validateFarmProfile } from './engine/simulator.ts';
import { parseOpenMeteoForecast } from './engine/weather.ts';
import { setAppLanguage } from './i18n/index.ts';
import {
  fetchLiveWeatherForecast,
  fetchServerConfigStatus,
  runFullAgenticEvaluation,
  type ServerConfigStatus,
} from './services/apiClient.ts';
import type {
  AgenticEvaluationResponse,
  AppLanguage,
  BaselineReferenceContext,
  ClimateScenarioId,
  FarmProfile,
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
  scenarioOverride?: ScenarioParametersOverride
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
    weights: farm.customWeights ?? null,
    scen: scenarioId,
    over: scenarioOverride ?? null,
  });
}

export default function App() {
  const { t, i18n } = useTranslation();
  const lang: AppLanguage = i18n.language === 'de' ? 'de' : 'en';

  const [activeTab, setActiveTab] = useState<NavigationTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [farm, setFarm] = useState<FarmProfile>(DEFAULT_SAMPLE_FARM);
  const [scenarioId, setScenarioId] = useState<ClimateScenarioId>('baseline');
  const [scenarioOverrides, setScenarioOverrides] = useState<
    Partial<Record<ClimateScenarioId, ScenarioParametersOverride>>
  >({});
  const [weatherThresholds, setWeatherThresholds] = useState<WeatherThresholds>(
    DEFAULT_WEATHER_THRESHOLDS
  );

  const [weather, setWeather] = useState<WeatherForecastAnalysis | null>(null);
  const [isFetchingWeather, setIsFetchingWeather] = useState(false);

  // Cache agentic evaluations by (paramSignature + language) so EN <-> DE never mislabels cached text
  // while immediately restoring localized AI runs if already executed for that language.
  const [evaluationCache, setEvaluationCache] = useState<
    Record<string, AgenticEvaluationResponse>
  >({});
  const [latestEvaluationKey, setLatestEvaluationKey] = useState<string | null>(
    null
  );

  const [isEvaluating, setIsEvaluating] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [configStatus, setConfigStatus] = useState<ServerConfigStatus | null>(
    null
  );

  const activeScenarioOverride = scenarioOverrides[scenarioId];

  // Live deterministic simulation reacts immediately to farm, weather, or scenario updates — language-invariant!
  const simulation: SimulationRunOutput = useMemo(
    () => simulateCrops(farm, weather, scenarioId, activeScenarioOverride),
    [farm, weather, scenarioId, activeScenarioOverride]
  );

  const currentSig = useMemo(
    () => buildParamSignature(farm, scenarioId, activeScenarioOverride),
    [farm, scenarioId, activeScenarioOverride]
  );

  // Prefer exact (sig, lang) evaluation; otherwise fall back to (sig, otherLang) so DecisionCenter can honestly show the stale-language banner; otherwise latestEvaluationKey
  const evaluation: AgenticEvaluationResponse | null = useMemo(() => {
    const exactKey = `${currentSig}::${lang}`;
    if (evaluationCache[exactKey]) return evaluationCache[exactKey];
    const otherLang: AppLanguage = lang === 'de' ? 'en' : 'de';
    const altKey = `${currentSig}::${otherLang}`;
    if (evaluationCache[altKey]) return evaluationCache[altKey];
    if (latestEvaluationKey && evaluationCache[latestEvaluationKey]) {
      return evaluationCache[latestEvaluationKey];
    }
    return null;
  }, [currentSig, evaluationCache, lang, latestEvaluationKey]);

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
          targetOverride
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
        setIsEvaluating(false);
      }
    },
    [baselineSnapshot, lang, weatherThresholds]
  );

  const handleUpdateFarm = (updated: FarmProfile) => {
    const coordsChanged =
      updated.latitude !== farm.latitude ||
      updated.longitude !== farm.longitude;
    setFarm(updated);
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
      customWeights: mode ? undefined : weights,
    }));
  };

  const handleSelectScenarioAndEvaluate = (nextScenario: ClimateScenarioId) => {
    setScenarioId(nextScenario);
    const nextOverride = scenarioOverrides[nextScenario];
    void executePipeline(farm, nextScenario, true, lang, nextOverride);
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
      customWeights: updates.priorityMode
        ? PRIORITY_WEIGHT_PRESETS[updates.priorityMode]
        : prev.customWeights,
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

  const navItems: Array<{
    id: NavigationTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'overview', label: t('nav.overview'), icon: LayoutDashboard },
    { id: 'farm-setup', label: t('nav.farmSetup'), icon: Tractor },
    { id: 'climate', label: t('nav.climate'), icon: CloudSun },
    { id: 'simulator', label: t('nav.simulator'), icon: Sliders },
    { id: 'decision-center', label: t('nav.decisionCenter'), icon: Cpu },
    { id: 'scenarios', label: t('nav.scenarios'), icon: GitBranch },
    { id: 'data-sources', label: t('nav.dataSources'), icon: BookOpen },
  ];

  const activeNavLabel =
    navItems.find((item) => item.id === activeTab)?.label ?? t('nav.overview');

  return (
    <div className="min-h-screen flex bg-[#F8F9F7] text-[#111C16]">
      {/* Desktop Sidebar Navigation */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-[#0F291E] text-[#F1F5F2] border-r border-[#1A3D2E]">
        <div className="px-6 py-5 border-b border-[#1D4232]">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className="text-left cursor-pointer w-full"
          >
            <AgroVeraLogo tagline={t('brand.tagline')} theme="dark" />
          </button>
        </div>

        <nav
          aria-label="Primary Workspace Navigation"
          className="flex-1 px-3 py-5 space-y-1"
        >
          {navItems.map((item) => {
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
        </nav>

        <div className="p-4 m-3 rounded-lg bg-[#153628] border border-[#224E3B] text-xs space-y-1.5">
          <div className="font-semibold text-emerald-200">
            {t('header.activeModels')}
          </div>
          <div className="text-[11px] text-[#C6D6CD] font-mono space-y-0.5">
            <div>{t('header.decisionModel')}</div>
            <div>{t('header.criticModel')}</div>
            <div>{t('header.toolsModel')}</div>
          </div>
          {configStatus && !configStatus.geminiKeyConfigured && (
            <div className="text-[11px] text-amber-300 pt-1">
              {t('header.missingApiKey')}
            </div>
          )}
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 w-72 max-w-[82vw] bg-[#0F291E] text-white flex flex-col justify-between p-4">
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
              <nav aria-label={t('nav.mobileAria')} className="mt-4 space-y-1">
                {navItems.map((item) => {
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
        {/* Top Bar: Breadcrumb on Left, EN | DE Switcher + Primary CTA on Right */}
        <header className="h-14 px-4 sm:px-8 bg-white border-b border-stone-200/90 flex items-center justify-between gap-4 sticky top-0 z-30">
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
              <span className="font-bold text-[#0F291E] whitespace-nowrap">
                AgroVera
              </span>
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

          <div className="flex items-center gap-2.5 shrink-0">
            {/* Bilingual EN | DE Switcher */}
            <div
              role="group"
              aria-label="Language Switcher"
              data-testid="language-switcher"
              className="inline-flex items-center rounded-lg border border-stone-200 bg-stone-100 p-0.5 text-xs font-semibold"
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

            <button
              type="button"
              onClick={() =>
                executePipeline(
                  farm,
                  scenarioId,
                  activeTab === 'scenarios' || evaluation !== null,
                  lang,
                  activeScenarioOverride
                )
              }
              disabled={isEvaluating}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#059669] hover:bg-[#047857] disabled:opacity-60 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isEvaluating ? (
                <Activity className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              {isEvaluating ? t('header.evaluating') : t('header.runAnalysis')}
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
          {activeTab === 'overview' && (
            <OverviewView
              farm={farm}
              weather={weather}
              simulation={simulation}
              evaluation={evaluation}
              isEvaluating={isEvaluating}
              onRunEvaluation={() =>
                executePipeline(
                  farm,
                  scenarioId,
                  evaluation !== null,
                  lang,
                  activeScenarioOverride
                )
              }
              onNavigate={setActiveTab}
            />
          )}

          {activeTab === 'farm-setup' && (
            <FarmSetupView
              farm={farm}
              onUpdateFarm={handleUpdateFarm}
              onRunEvaluation={(overrideFarm) => {
                const target = overrideFarm ?? farm;
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

          {activeTab === 'decision-center' && (
            <DecisionCenterView
              evaluation={evaluation}
              isEvaluating={isEvaluating}
              onRunEvaluation={() =>
                executePipeline(
                  farm,
                  scenarioId,
                  evaluation !== null,
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
              onSelectScenarioAndEvaluate={handleSelectScenarioAndEvaluate}
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
