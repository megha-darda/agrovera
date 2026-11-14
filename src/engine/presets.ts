import cropDbRaw from '../data/crops.json' with { type: 'json' };
import type {
  BilingualText,
  ClimateScenarioConfig,
  ClimateScenarioId,
  CropKnowledgeDatabase,
  CurrencyCode,
  FarmProfile,
  PreferenceWeights,
  PriorityMode,
  ScenarioParametersOverride,
  WeatherThresholds,
} from '../types/domain.ts';

export const CROP_DATABASE: CropKnowledgeDatabase =
  cropDbRaw as unknown as CropKnowledgeDatabase;

export const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  EUR: '€',
  USD: '$',
};

export const MONTH_NAMES_EN: string[] = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const MONTH_NAMES_DE: string[] = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

/**
 * Official Deutscher Wetterdienst (DWD) meteorological indicator conventions:
 * - Heißer Tag (Hot day): Tmax >= 30°C
 * - Frosttag (Frost day): Tmin <= 0°C
 * - Starkregen (Heavy daily rain): >= 25 mm/24h
 */
export const DEFAULT_WEATHER_THRESHOLDS: WeatherThresholds = {
  heatDayMaxTempC: 30,
  frostDayMinTempC: 0,
  dryWindowTotalPrecipMm: 8,
  heavyRainDailyMm: 25,
};

export const PRIORITY_WEIGHT_PRESETS: Record<PriorityMode, PreferenceWeights> = {
  balanced: {
    profit: 0.30,
    climateResilience: 0.30,
    waterEfficiency: 0.20,
    soilMatch: 0.20,
  },
  max_profit: {
    profit: 0.55,
    climateResilience: 0.15,
    waterEfficiency: 0.15,
    soilMatch: 0.15,
  },
  min_climate_risk: {
    profit: 0.15,
    climateResilience: 0.55,
    waterEfficiency: 0.15,
    soilMatch: 0.15,
  },
  min_water: {
    profit: 0.15,
    climateResilience: 0.20,
    waterEfficiency: 0.50,
    soilMatch: 0.15,
  },
};

export const CLIMATE_SCENARIOS: Record<ClimateScenarioId, ClimateScenarioConfig> = {
  baseline: {
    id: 'baseline',
    name: 'Baseline',
    names: {
      en: 'Baseline',
      de: 'Ausgangssituation',
    },
    isHypotheticalStressTest: false,
    labelBadge: {
      en: 'Hypothetical Normal-Season Baseline + Live Near-Term Forecast',
      de: 'Normale Saison-Referenz + aktuelle Kurzfristprognose',
    },
    description: {
      en: 'Combines live DWD/Open-Meteo planting-window observations with typical German growing-season rainfall (1.00×) and normal crop evapotranspiration (1.00×).',
      de: 'Verbindet aktuelle DWD-/Open-Meteo-Wetterdaten für das Bestellfenster mit durchschnittlichen deutschen Vegetationsniederschlägen (1,00×) und normalem Wasserbedarf (1,00×).',
    },
    waterDemandMultiplier: 1.0,
    seasonalRainfallMultiplier: 1.0,
    yieldStressMultipliers: {
      heatFactor: 0.08,
      frostFactor: 0.05,
      droughtFactor: 0.08,
      excessRainFactor: 0.05,
    },
  },
  drought: {
    id: 'drought',
    name: 'Drought',
    names: {
      en: 'Drought',
      de: 'Trockenheit',
    },
    isHypotheticalStressTest: true,
    labelBadge: {
      en: 'Hypothetical Stress Test · Spring/Summer Soil Drought',
      de: 'Hypothetischer Stresstest · Frühjahrs- & Sommertrockenheit',
    },
    description: {
      en: 'Simulates a 2018/2022-style German spring-summer precipitation deficit (0.65× seasonal rain) and +14% crop evapotranspiration, sharply elevating supplemental irrigation demand.',
      de: 'Simuliert ein ausgeprägtes Niederschlagsdefizit (0,65× Saisonregen analog Dürrejahren) bei +14 % Verdunstungsanspruch und prüft die Grenzen des Beregnungskontingents.',
    },
    waterDemandMultiplier: 1.14,
    seasonalRainfallMultiplier: 0.65,
    yieldStressMultipliers: {
      heatFactor: 0.35,
      frostFactor: 0.0,
      droughtFactor: 0.82,
      excessRainFactor: 0.0,
    },
  },
  heatwave: {
    id: 'heatwave',
    name: 'Heatwave',
    names: {
      en: 'Heatwave',
      de: 'Hitzewelle',
    },
    isHypotheticalStressTest: true,
    labelBadge: {
      en: 'Hypothetical Stress Test · Upper Rhine >35°C Heat',
      de: 'Hypothetischer Stresstest · Hitzewelle (>35 °C)',
    },
    description: {
      en: 'Simulates prolonged >35°C heat episodes in June–August (+16% crop water demand, 0.78× effective rain), stressing potato tuber bulking and cereal grain filling.',
      de: 'Simuliert anhaltende Hitzeperioden über 35 °C im Sommer (+16 % Wasserbedarf, 0,78× nutzbarer Regen) mit Hitzestress für Kartoffeldämme und Kornfüllung.',
    },
    waterDemandMultiplier: 1.16,
    seasonalRainfallMultiplier: 0.78,
    yieldStressMultipliers: {
      heatFactor: 0.88,
      frostFactor: 0.0,
      droughtFactor: 0.45,
      excessRainFactor: 0.0,
    },
  },
  heavy_rainfall: {
    id: 'heavy_rainfall',
    name: 'Heavy Rainfall',
    names: {
      en: 'Heavy Rainfall',
      de: 'Starkregen',
    },
    isHypotheticalStressTest: true,
    labelBadge: {
      en: 'Hypothetical Stress Test · Starkregen & Waterlogging',
      de: 'Hypothetischer Stresstest · Starkregen & Staunässe',
    },
    description: {
      en: 'Simulates persistent convective storms and wet harvest conditions (1.68× seasonal rainfall), testing root hypoxia, cereal lodging, and potato blight/waterlogging limits.',
      de: 'Simuliert wiederholte Starkregenereignisse und Staunässe (1,68× Saisonregen) zur Prüfung von Lagergefahr bei Getreide sowie Fäulnis- und Befahrbarkeitsrisiken bei Kartoffeln.',
    },
    waterDemandMultiplier: 0.9,
    seasonalRainfallMultiplier: 1.68,
    yieldStressMultipliers: {
      heatFactor: 0.04,
      frostFactor: 0.0,
      droughtFactor: 0.0,
      excessRainFactor: 0.88,
    },
  },
  frost: {
    id: 'frost',
    name: 'Late Frost',
    names: {
      en: 'Late Frost',
      de: 'Spätfrost',
    },
    isHypotheticalStressTest: true,
    labelBadge: {
      en: 'Hypothetical Stress Test · May Eisheiligen Late Frost',
      de: 'Hypothetischer Stresstest · Spätfrost (Eisheiligen)',
    },
    description: {
      en: 'Simulates radiative sub-zero nights (-3°C) after spring emergence in April/May, penalizing frost-sensitive young maize and potato shoots far more than winter-hardy cereals.',
      de: 'Simuliert nächtliche Spätfröste (-3 °C) nach dem Feldaufgang im April/Mai, wodurch aufgelaufener Mais und Kartoffelstauden deutlich stärker geschädigt werden als Getreide.',
    },
    waterDemandMultiplier: 0.96,
    seasonalRainfallMultiplier: 0.95,
    yieldStressMultipliers: {
      heatFactor: 0.0,
      frostFactor: 0.9,
      droughtFactor: 0.08,
      excessRainFactor: 0.08,
    },
  },
};

export function resolveScenarioConfig(
  scenarioId: ClimateScenarioId,
  override?: ScenarioParametersOverride
): ClimateScenarioConfig {
  const base = CLIMATE_SCENARIOS[scenarioId] ?? CLIMATE_SCENARIOS.baseline;
  if (!override) return base;
  return {
    ...base,
    isHypotheticalStressTest: true,
    waterDemandMultiplier:
      override.waterDemandMultiplier ?? base.waterDemandMultiplier,
    seasonalRainfallMultiplier:
      override.seasonalRainfallMultiplier ?? base.seasonalRainfallMultiplier,
    yieldStressMultipliers: {
      heatFactor: override.heatFactor ?? base.yieldStressMultipliers.heatFactor,
      frostFactor:
        override.frostFactor ?? base.yieldStressMultipliers.frostFactor,
      droughtFactor:
        override.droughtFactor ?? base.yieldStressMultipliers.droughtFactor,
      excessRainFactor:
        override.excessRainFactor ??
        base.yieldStressMultipliers.excessRainFactor,
    },
  };
}

export interface GermanCityPreset {
  id: string;
  cityEn: string;
  cityDe: string;
  state: string;
  latitude: number;
  longitude: number;
  typicalSoil: FarmProfile['soilType'];
}

export const GERMAN_CITY_PRESETS: GermanCityPreset[] = [
  {
    id: 'karlsruhe',
    cityEn: 'Karlsruhe',
    cityDe: 'Karlsruhe',
    state: 'Baden-Württemberg',
    latitude: 49.0069,
    longitude: 8.4037,
    typicalSoil: 'Loamy',
  },
  {
    id: 'munich',
    cityEn: 'Munich',
    cityDe: 'München',
    state: 'Bayern',
    latitude: 48.1351,
    longitude: 11.582,
    typicalSoil: 'Loamy',
  },
  {
    id: 'stuttgart',
    cityEn: 'Stuttgart',
    cityDe: 'Stuttgart',
    state: 'Baden-Württemberg',
    latitude: 48.7758,
    longitude: 9.1829,
    typicalSoil: 'Silty',
  },
  {
    id: 'freiburg',
    cityEn: 'Freiburg im Breisgau',
    cityDe: 'Freiburg im Breisgau',
    state: 'Baden-Württemberg',
    latitude: 47.999,
    longitude: 7.8421,
    typicalSoil: 'Loamy',
  },
  {
    id: 'berlin',
    cityEn: 'Berlin',
    cityDe: 'Berlin',
    state: 'Berlin / Brandenburg',
    latitude: 52.52,
    longitude: 13.405,
    typicalSoil: 'Sandy',
  },
  {
    id: 'hamburg',
    cityEn: 'Hamburg',
    cityDe: 'Hamburg',
    state: 'Hamburg',
    latitude: 53.5511,
    longitude: 9.9937,
    typicalSoil: 'Silty',
  },
];

export interface SampleFarmPreset {
  id: string;
  badge: BilingualText;
  summary: BilingualText;
  profile: FarmProfile;
}

export const SAMPLE_FARM_PRESETS: SampleFarmPreset[] = [
  {
    id: 'karlsruhe-spring',
    badge: {
      en: 'Default Demo · Karlsruhe Spring Sowing (April)',
      de: 'Standard-Demo · Karlsruhe Frühjahrsbestellung (April)',
    },
    summary: {
      en: '12.0 ha loamy field in Karlsruhe, Baden-Württemberg with 19,200 m³ irrigation water and €42,000 budget — Potato, Maize & Spring Barley compete.',
      de: '12,0 ha Lehmstandort in Karlsruhe mit 19.200 m³ Beregnungswasser und 42.000 € Budget — Kartoffel, Körnermais und Sommergerste im Vergleich.',
    },
    profile: {
      farmName: 'Rheinebene Ackerbau Karlsruhe (Demo)',
      country: 'Germany',
      regionState: 'Baden-Württemberg',
      locationName: 'Karlsruhe, Baden-Württemberg, Germany',
      latitude: 49.0069,
      longitude: 8.4037,
      timezone: 'Europe/Berlin',
      soilType: 'Loamy',
      areaHa: 12.0,
      availableWaterValue: 19200,
      availableWaterUnit: 'm3_total_season',
      budgetAmount: 42000,
      currency: 'EUR',
      preferredCrop: 'maize',
      plantingMonth: 4,
      priorityMode: 'balanced',
      isSampleProfile: true,
    },
  },
  {
    id: 'karlsruhe-autumn',
    badge: {
      en: 'Autumn Sowing · Karlsruhe Winter Cereals (October)',
      de: 'Herbstaussaat · Karlsruhe Wintergetreide (Oktober)',
    },
    summary: {
      en: '15.0 ha Kraichgau/Karlsruhe silty-loam plot in October with 6,000 m³ reserve irrigation and €16,000 budget — tests Winter Wheat vs. Winter Barley.',
      de: '15,0 ha Schlufflehm bei Karlsruhe im Oktober mit 6.000 m³ Wasserreserve und 16.000 € Budget — Vergleich Winterweizen vs. Wintergerste.',
    },
    profile: {
      farmName: 'Kraichgau Wintergetreide-Betrieb (Demo)',
      country: 'Germany',
      regionState: 'Baden-Württemberg',
      locationName: 'Karlsruhe, Baden-Württemberg, Germany',
      latitude: 49.0069,
      longitude: 8.4037,
      timezone: 'Europe/Berlin',
      soilType: 'Silty',
      areaHa: 15.0,
      availableWaterValue: 6000,
      availableWaterUnit: 'm3_total_season',
      budgetAmount: 16000,
      currency: 'EUR',
      preferredCrop: 'winter_wheat',
      plantingMonth: 10,
      priorityMode: 'balanced',
      isSampleProfile: true,
    },
  },
  {
    id: 'brandenburg-sandy',
    badge: {
      en: 'Dry Sandy Site · Berlin / Brandenburg (March)',
      de: 'Trockenstandort · Berlin / Brandenburg (März)',
    },
    summary: {
      en: '20.0 ha sandy soil near Berlin with tight 8,000 m³ irrigation permit and €22,000 budget — tests drought sensitivity & capital limits.',
      de: '20,0 ha Sandboden im Raum Berlin mit knappem 8.000 m³ Wasserkontingent und 22.000 € Budget — Fokus auf Wassereffizienz & Risiko.',
    },
    profile: {
      farmName: 'Märkischer Sandboden-Betrieb (Demo)',
      country: 'Germany',
      regionState: 'Berlin / Brandenburg',
      locationName: 'Berlin, Germany',
      latitude: 52.52,
      longitude: 13.405,
      timezone: 'Europe/Berlin',
      soilType: 'Sandy',
      areaHa: 20.0,
      availableWaterValue: 8000,
      availableWaterUnit: 'm3_total_season',
      budgetAmount: 22000,
      currency: 'EUR',
      preferredCrop: 'barley',
      plantingMonth: 3,
      priorityMode: 'min_climate_risk',
      isSampleProfile: true,
    },
  },
];

export const DEFAULT_SAMPLE_FARM: FarmProfile = {
  ...SAMPLE_FARM_PRESETS[0].profile,
};
