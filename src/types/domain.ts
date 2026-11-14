export type AppLanguage = 'en' | 'de';

export interface BilingualText {
  en: string;
  de: string;
}

export type DataClassification =
  | 'verified_source'
  | 'illustrative_estimate'
  | 'missing';

export type SoilType = 'Sandy' | 'Loamy' | 'Clay' | 'Silty';

export type CropId = 'winter_wheat' | 'barley' | 'maize' | 'potato';

export type PriorityMode =
  | 'balanced'
  | 'max_profit'
  | 'min_climate_risk'
  | 'min_water';

export type WaterUnit = 'm3_total_season' | 'mm_per_ha_season';

export type CurrencyCode = 'EUR' | 'USD';

export type ClimateScenarioId =
  | 'baseline'
  | 'drought'
  | 'heatwave'
  | 'heavy_rainfall'
  | 'frost';

export type NavigationTab =
  | 'overview'
  | 'farm-setup'
  | 'climate'
  | 'simulator'
  | 'decision-center'
  | 'scenarios'
  | 'data-sources';

export interface PreferenceWeights {
  profit: number;
  climateResilience: number;
  waterEfficiency: number;
  soilMatch: number;
}

export interface FarmProfile {
  farmName: string;
  country: string;
  regionState?: string;
  locationName: string;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  soilType: SoilType;
  areaHa: number;
  availableWaterValue: number;
  availableWaterUnit: WaterUnit;
  budgetAmount: number;
  currency: CurrencyCode;
  preferredCrop: CropId;
  plantingMonth: number; // 1 = Jan .. 12 = Dec
  priorityMode: PriorityMode;
  customWeights?: PreferenceWeights | null;
  isSampleProfile?: boolean;
}

export interface ValidationIssue {
  field: string;
  message: string;
  messageBilingual: BilingualText;
}

export interface FarmValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  missingUncertaintyFields: string[];
  missingUncertaintyBilingual: BilingualText[];
}

export interface SourceCitation {
  sourceName: string;
  sourceUrl: string;
  publicationYear: string;
  retrievalDate: string;
  classification: DataClassification;
  note: BilingualText;
}

export interface CropKnowledgeEntry {
  id: CropId;
  name: string;
  names: BilingualText;
  scientificName: string;
  category: BilingualText;
  applicableGermanRegions: BilingualText;
  recommendedSoilConditions: BilingualText;
  plantingWindow: {
    optimalMonths: number[];
    shoulderMonths: number[];
    label: BilingualText;
  };
  harvestWindow: {
    months: number[];
    label: BilingualText;
  };
  growingDurationDays: {
    min: number;
    max: number;
  };
  soilCompatibility: Record<SoilType, number>; // 0 - 100
  seasonalWaterMmHa: {
    totalDemandMin: number;
    totalDemandOptimal: number;
    typicalGermanSeasonRainMm: number;
    supplementalIrrigationMin: number;
    supplementalIrrigationOptimal: number;
    waterloggingRainLimit: number;
  };
  inputCostsEurPerHa: {
    seedAndPlanting: number;
    fertilizerAndProtection: number;
    machineryDryingAndIrrigation: number;
    total: number;
    classification: DataClassification;
  };
  indicativeYieldTonsPerHa: {
    destatisNationalAvgTonsHa: number;
    low: number;
    base: number;
    high: number;
    classification: DataClassification;
  };
  indicativeMarketPriceEurPerTon: {
    low: number;
    base: number;
    high: number;
    classification: DataClassification;
  };
  climateSensitivity: {
    heat: number; // 0.0 (resilient) to 1.0 (highly sensitive)
    frost: number;
    drought: number;
    excessRain: number;
    optimalTempRangeC: [number, number];
    heatStressThresholdC: number;
    frostStressThresholdC: number;
  };
  sources: {
    yieldStatistics: SourceCitation;
    cultivationGuidance: SourceCitation;
    economicAssumptions: SourceCitation;
  };
  agronomicNotes: BilingualText[];
}

export interface DataTransparencyEntry {
  id: string;
  category:
    | 'live_weather'
    | 'published_statistics'
    | 'illustrative_economics'
    | 'hypothetical_scenario'
    | 'ai_interpretation'
    | 'unavailable_dataset';
  parameter: BilingualText;
  valueSummary: BilingualText;
  unit: string;
  sourceName: string;
  sourceUrl: string;
  yearOrPeriod: string;
  classification: DataClassification;
  notes: BilingualText;
}

export interface CropKnowledgeDatabase {
  version: string;
  regionFocus: string;
  defaultTimezone: string;
  illustrativeDisclaimer: BilingualText;
  exchangeRatesPerEurIllustrative: Record<CurrencyCode, number>;
  crops: CropKnowledgeEntry[];
  transparencyRegistry: DataTransparencyEntry[];
}

export interface WeatherThresholds {
  heatDayMaxTempC: number;
  frostDayMinTempC: number;
  dryWindowTotalPrecipMm: number;
  heavyRainDailyMm: number;
}

export interface DailyForecastPoint {
  date: string;
  tempMaxC: number;
  tempMinC: number;
  precipMm: number;
  et0Mm: number;
}

export interface ClimateRiskIndicator {
  id: 'heat' | 'frost' | 'dry_weather' | 'heavy_rain';
  label: string;
  labelBilingual: BilingualText;
  severity: 'low' | 'moderate' | 'high';
  triggered: boolean;
  observedMetric: string;
  observedMetricBilingual: BilingualText;
  thresholdMetric: string;
  affectedDays: number;
  explanation: string;
  explanationBilingual: BilingualText;
}

export interface WeatherForecastAnalysis {
  status: 'ok' | 'unavailable';
  providerModel: 'dwd-icon' | 'open-meteo-global';
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  locationLabel: string;
  coordinates: {
    latitude: number;
    longitude: number;
    elevationM?: number;
    timezone?: string;
  } | null;
  forecastPeriod: {
    startDate: string;
    endDate: string;
    days: number;
  } | null;
  thresholdsUsed: WeatherThresholds;
  daily: DailyForecastPoint[];
  summary: {
    avgMaxTempC: number;
    peakMaxTempC: number;
    lowestMinTempC: number;
    totalPrecipMm: number;
    maxDailyPrecipMm: number;
    totalEt0Mm: number;
    hotDaysCount: number;
    frostDaysCount: number;
    heavyRainDaysCount: number;
  } | null;
  riskIndicators: ClimateRiskIndicator[];
  scopeLimitationNotice: BilingualText;
  errorMessage?: string;
  errorMessageBilingual?: BilingualText;
}

export interface ScenarioParametersOverride {
  waterDemandMultiplier?: number;
  seasonalRainfallMultiplier?: number;
  heatFactor?: number;
  frostFactor?: number;
  droughtFactor?: number;
  excessRainFactor?: number;
}

export interface ClimateScenarioConfig {
  id: ClimateScenarioId;
  name: string;
  names: BilingualText;
  isHypotheticalStressTest: boolean;
  labelBadge: BilingualText;
  description: BilingualText;
  waterDemandMultiplier: number;
  seasonalRainfallMultiplier: number; // 1.0 = normal German growing season rain; 0.38 = severe drought
  yieldStressMultipliers: {
    heatFactor: number;
    frostFactor: number;
    droughtFactor: number;
    excessRainFactor: number;
  };
}

export interface CropSimulationResult {
  cropId: CropId;
  cropName: string;
  cropNames: BilingualText;
  scientificName: string;
  category: BilingualText;
  growingDurationDays: { min: number; max: number };
  plantingWindowLabel: BilingualText;
  harvestWindowLabel: BilingualText;
  seasonalSuitability: 'optimal' | 'shoulder' | 'out_of_season';
  feasibilityStatus: 'feasible' | 'infeasible' | 'uncertain';
  infeasibilityReasons: string[];
  infeasibilityReasonsBilingual: BilingualText[];
  uncertaintyReasons: string[];
  uncertaintyReasonsBilingual: BilingualText[];
  waterEvaluation: {
    totalCropDemandMinMmHa: number;
    scenarioTotalCropDemandMmHa: number;
    scenarioOptimalCropDemandMmHa: number;
    estimatedEffectiveSeasonRainMmHa: number;
    nearTermSeedbedPrecipCreditMmHa: number;
    additionalIrrigationRequiredMmHa: number;
    additionalIrrigationOptimalMmHa: number;
    additionalIrrigationRequiredM3: number;
    availableIrrigationMmHa: number;
    availableIrrigationTotalM3: number;
    irrigationSurplusOrDeficitMmHa: number;
    irrigationSurplusOrDeficitM3: number;
    irrigationUtilizationPct: number;
    satisfiesWaterConstraint: boolean;
  };
  financialEvaluation: {
    currency: CurrencyCode;
    exchangeRateFromEur: number;
    inputCostPerHa: number;
    totalFarmInputCost: number;
    availableFarmBudget: number;
    budgetSurplusOrDeficit: number;
    budgetUtilizationPct: number;
    satisfiesBudgetConstraint: boolean;
    destatisBenchmarkTonsPerHa: number;
    yieldTonsPerHa: { low: number; expected: number; high: number };
    totalFarmYieldTons: { low: number; expected: number; high: number };
    grossRevenueRange: { low: number; expected: number; high: number };
    netProfitRange: { low: number; expected: number; high: number };
    expectedRoiPct: number;
    yieldClassification: DataClassification;
    costAndPriceClassification: DataClassification;
  };
  scores: {
    soilCompatibility: number;
    climateResilience: number;
    waterEfficiency: number;
    profitPotential: number;
    preferredCropBonus: number;
    weightedSuitability: number;
  };
  riskProfile: {
    overallRiskLevel: 'low' | 'moderate' | 'high' | 'critical';
    overallRiskScore: number;
    heatRiskScore: number;
    frostRiskScore: number;
    droughtRiskScore: number;
    excessRainRiskScore: number;
    keySensitivities: BilingualText[];
  };
}

export interface SimulationRunOutput {
  evaluatedAt: string;
  scenario: ClimateScenarioConfig;
  weightsNormalized: PreferenceWeights;
  farmSummary: {
    country: string;
    locationName: string;
    plantingMonth: number;
    areaHa: number;
    soilType: SoilType;
    availableIrrigationMmHa: number;
    availableIrrigationTotalM3: number;
    budgetInSelectedCurrency: number;
    budgetInEurEquivalent: number;
    currency: CurrencyCode;
  };
  validation: FarmValidationResult;
  cropResults: CropSimulationResult[];
  feasibleCropsCount: number;
  topFeasibleCropId: CropId | null;
  illustrativeDisclaimer: BilingualText;
}

export interface DecisionAgentOutput {
  recommendedCropId: CropId | 'none';
  decisionStatus: 'recommended' | 'no_feasible_crop' | 'uncertain_needs_data';
  headline: string;
  executiveSummary: string;
  tradeoffAnalysis: {
    financial: string;
    climateAndEnvironmental: string;
    waterAndSoilResources: string;
  };
  alternativeComparisons: Array<{
    cropId: CropId;
    comparisonSummary: string;
  }>;
  keyAssumptions: string[];
  missingInformation: string[];
  actionableNextSteps: string[];
  humanReviewNotice: string;
}

export interface CriticObjection {
  severity: 'critical' | 'warning' | 'note';
  category:
    | 'hard_constraint'
    | 'fair_comparison'
    | 'forecast_uncertainty'
    | 'unsupported_numbers'
    | 'assumption_consistency'
    | 'missing_information'
    | 'climate_robustness';
  detail: string;
}

export interface CriticAgentOutput {
  verdict: 'pass' | 'review' | 'reject';
  hardConstraintsSatisfied: boolean;
  alternativesComparedFairly: boolean;
  forecastUncertaintyCommunicated: boolean;
  numericalClaimsSupported: boolean;
  assumptionsConsistent: boolean;
  moreRobustAlternativeId: CropId | 'none';
  objections: CriticObjection[];
  requestedRecalculation: {
    needed: boolean;
    targetScenarioId: ClimateScenarioId | 'none';
    reason: string;
  };
  criticSummary: string;
}

export interface ValidationCheckItem {
  code: string;
  label: BilingualText;
  passed: boolean;
  detail: BilingualText;
}

export interface ValidationGateResult {
  passed: boolean;
  requiresHumanReview: boolean;
  checks: ValidationCheckItem[];
  failureReasons: string[];
  failureReasonsBilingual: BilingualText[];
}

export interface AgentTimelineEvent {
  id: string;
  timestamp: string;
  stage:
    | 'weather_request'
    | 'weather_response'
    | 'crop_profiles'
    | 'orchestrator'
    | 'simulation'
    | 'decision_agent'
    | 'critic_agent'
    | 'validation_gate'
    | 'recalculation'
    | 'final_recommendation';
  actor: string;
  modelId?: string;
  status: 'info' | 'success' | 'warning' | 'error';
  title: string;
  summary: string;
  cycle?: number;
  durationMs?: number;
}

export interface ReviewCycleRecord {
  cycle: number;
  decision: DecisionAgentOutput;
  critic: CriticAgentOutput;
  validationGate: ValidationGateResult;
  recalculatedStressSimulation?: {
    scenarioId: ClimateScenarioId;
    topFeasibleCropId: CropId | null;
    summary: string;
  };
}

export interface AgenticEvaluationResponse {
  runId: string;
  language: AppLanguage;
  completedAt: string;
  farm: FarmProfile;
  scenarioId: ClimateScenarioId;
  weather: WeatherForecastAnalysis;
  simulation: SimulationRunOutput;
  orchestratorSummary: string;
  decision: DecisionAgentOutput | null;
  critic: CriticAgentOutput | null;
  validationGate: ValidationGateResult | null;
  reviewCycles: ReviewCycleRecord[];
  maxCyclesReached: boolean;
  requiresHumanReview: boolean;
  timeline: AgentTimelineEvent[];
  modelsUsed: {
    orchestrator: string;
    decisionAgent: string;
    criticAgent: string;
  };
  aiError?: {
    stage: string;
    model: string;
    message: string;
  };
  scenarioShiftExplanation?: string;
}

export interface GeocodingCandidate {
  id: number;
  name: string;
  admin1?: string;
  country: string;
  countryCode?: string;
  latitude: number;
  longitude: number;
  elevation?: number;
  timezone?: string;
}

export interface BaselineReferenceContext {
  scenarioId: ClimateScenarioId;
  availableWaterM3: number;
  availableWaterMmHa: number;
  budgetAmount: number;
  currency: string;
  priorityMode: string;
  plantingMonth: number;
  recommendedCropId: CropId | 'none';
  topFeasibleCropId: CropId | null;
  cropRankings: Array<{
    cropId: CropId;
    feasibilityStatus: string;
    score: number;
  }>;
}

export type FarmerMode = 'plan_season' | 'in_season';

export type GrowthStageId =
  | 'emergence'
  | 'vegetative'
  | 'flowering_tuber'
  | 'grain_fill_bulking'
  | 'ripening_harvest'
  | 'unknown';

export interface InSeasonCareInputs {
  plantedCropId: CropId;
  plantingDate: string; // YYYY-MM-DD
  growthStage: GrowthStageId;
  irrigationUsedM3: number;
  conditionNotes: string;
}

export type InSeasonTriggerType =
  | 'frost'
  | 'heavy_rain'
  | 'heat'
  | 'dry_spell'
  | 'humid_canopy'
  | 'routine_check';

export interface InSeasonDayFlag {
  date: string;
  tempMaxC: number;
  tempMinC: number;
  precipMm: number;
  et0Mm: number;
  isHeat: boolean;
  isFrost: boolean;
  isHeavyRain: boolean;
  isDryDay: boolean;
}

export interface InSeasonActionItem {
  id: string;
  triggerType: InSeasonTriggerType;
  priority: 'high' | 'moderate' | 'low';
  title: BilingualText;
  relevantDate: string;
  forecastTrigger: BilingualText;
  reason: BilingualText;
  waterOrBudgetConsideration: BilingualText;
  uncertaintyOrMissing: BilingualText;
}

export interface InSeasonDeterministicPlan {
  evaluatedAt: string;
  plantedCropId: CropId;
  plantedCropNames: BilingualText;
  plantingDate: string;
  daysSincePlanting: number | null;
  selectedGrowthStage: GrowthStageId;
  estimatedStageFromDate: GrowthStageId | null;
  isStageUncertainOrEstimated: boolean;
  stageStatusNote: BilingualText;
  waterBalance: {
    allocatedWaterM3: number;
    waterUsedM3: number;
    remainingWaterM3: number;
    allocationExceededByM3: number;
    remainingWaterMmHa: number;
  };
  sevenDayStrip: InSeasonDayFlag[];
  candidateActions: InSeasonActionItem[];
  missingObservations: BilingualText[];
  scopeDisclaimer: BilingualText;
}

export interface InSeasonDecisionOutput {
  selectedActionIds: string[];
  weeklySummary: string;
  priorityFocus: string;
  keyAssumptions: string[];
  missingObservations: string[];
  advisoryNotice: string;
}

export interface InSeasonCriticOutput {
  verdict: 'pass' | 'review' | 'reject';
  onlyCandidateActionsUsed: boolean;
  waterLimitRespected: boolean;
  growthStageUncertaintyFlagged: boolean;
  missingSoilObservationsFlagged: boolean;
  noUnsupportedClaims: boolean;
  flags: Array<{
    severity: 'critical' | 'warning' | 'note';
    detail: string;
  }>;
  criticSummary: string;
}

export interface InSeasonEvaluationResponse {
  runId: string;
  language: AppLanguage;
  completedAt: string;
  farm: FarmProfile;
  inputs: InSeasonCareInputs;
  weather: WeatherForecastAnalysis;
  plan: InSeasonDeterministicPlan;
  decision: InSeasonDecisionOutput | null;
  critic: InSeasonCriticOutput | null;
  validationGate: ValidationGateResult | null;
  requiresHumanReview: boolean;
  modelsUsed: {
    decisionAgent: string;
    criticAgent: string;
  };
  aiError?: {
    stage: string;
    model: string;
    message: string;
  };
}
