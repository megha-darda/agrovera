import {
  CROP_DATABASE,
  MONTH_NAMES_DE,
  MONTH_NAMES_EN,
  PRIORITY_WEIGHT_PRESETS,
  resolveScenarioConfig,
} from './presets.ts';
import { checkForecastSowingAlignment } from './weather.ts';
import type {
  BilingualText,
  ClimateScenarioConfig,
  ClimateScenarioId,
  CropKnowledgeEntry,
  CropSimulationResult,
  FarmProfile,
  FarmValidationResult,
  PreferenceWeights,
  ScenarioParametersOverride,
  SimulationRunOutput,
  ValidationIssue,
  WaterUnit,
  WeatherForecastAnalysis,
} from '../types/domain.ts';

/**
 * Physical hydrological conversion:
 * 1 mm of water depth across 1 hectare (10,000 m²) = 10 m³ of water.
 */
export function convertWaterToMmPerHa(
  value: number,
  unit: WaterUnit,
  areaHa: number
): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (unit === 'mm_per_ha_season') {
    return Number(value.toFixed(1));
  }
  if (!Number.isFinite(areaHa) || areaHa <= 0) return 0;
  return Number((value / (areaHa * 10)).toFixed(1));
}

export function convertMmPerHaToTotalM3(mmPerHa: number, areaHa: number): number {
  if (!Number.isFinite(mmPerHa) || !Number.isFinite(areaHa) || areaHa <= 0) {
    return 0;
  }
  return Math.round(mmPerHa * areaHa * 10);
}

export function validateFarmProfile(farm: FarmProfile): FarmValidationResult {
  const issues: ValidationIssue[] = [];
  const missingUncertaintyFields: string[] = [];
  const missingUncertaintyBilingual: BilingualText[] = [];

  if (!farm.locationName || farm.locationName.trim().length < 2) {
    issues.push({
      field: 'locationName',
      message: 'Enter a farm municipality, town, or German region.',
      messageBilingual: {
        en: 'Enter a farm municipality, town, or German region.',
        de: 'Bitte geben Sie einen Ort, eine Gemeinde oder eine Region ein.',
      },
    });
  }

  if (
    farm.latitude === null ||
    farm.longitude === null ||
    Number.isNaN(farm.latitude) ||
    Number.isNaN(farm.longitude)
  ) {
    const enMsg =
      'Farm GPS coordinates (latitude/longitude) are missing; localized DWD weather verification cannot be completed.';
    missingUncertaintyFields.push(enMsg);
    missingUncertaintyBilingual.push({
      en: enMsg,
      de: 'GPS-Koordinaten (Breiten-/Längengrad) fehlen; die standortbezogene DWD-Wetterprüfung ist unvollständig.',
    });
  } else {
    if (farm.latitude < -90 || farm.latitude > 90) {
      issues.push({
        field: 'latitude',
        message: 'Latitude must be between -90° and 90°.',
        messageBilingual: {
          en: 'Latitude must be between -90° and 90°.',
          de: 'Der Breitengrad muss zwischen -90° und 90° liegen.',
        },
      });
    }
    if (farm.longitude < -180 || farm.longitude > 180) {
      issues.push({
        field: 'longitude',
        message: 'Longitude must be between -180° and 180°.',
        messageBilingual: {
          en: 'Longitude must be between -180° and 180°.',
          de: 'Der Längengrad muss zwischen -180° und 180° liegen.',
        },
      });
    }
  }

  if (
    typeof farm.areaHa !== 'number' ||
    Number.isNaN(farm.areaHa) ||
    farm.areaHa <= 0 ||
    farm.areaHa > 10000
  ) {
    issues.push({
      field: 'areaHa',
      message: 'Land area must be greater than 0 ha and up to 10,000 ha.',
      messageBilingual: {
        en: 'Land area must be greater than 0 ha and up to 10,000 ha.',
        de: 'Die Ackerfläche muss größer als 0 ha und maximal 10.000 ha sein.',
      },
    });
  }

  if (
    typeof farm.availableWaterValue !== 'number' ||
    Number.isNaN(farm.availableWaterValue) ||
    farm.availableWaterValue < 0
  ) {
    issues.push({
      field: 'availableWaterValue',
      message: 'Available irrigation water must be zero or a positive volume.',
      messageBilingual: {
        en: 'Available irrigation water must be zero or a positive volume.',
        de: 'Das verfügbare Beregnungswasser muss null oder ein positiver Wert sein.',
      },
    });
  }

  if (
    typeof farm.budgetAmount !== 'number' ||
    Number.isNaN(farm.budgetAmount) ||
    farm.budgetAmount < 0
  ) {
    issues.push({
      field: 'budgetAmount',
      message: 'Farming budget must be zero or a positive amount.',
      messageBilingual: {
        en: 'Farming budget must be zero or a positive amount.',
        de: 'Das Anbaubudget muss null oder ein positiver Betrag sein.',
      },
    });
  }

  if (
    typeof farm.plantingMonth !== 'number' ||
    !Number.isInteger(farm.plantingMonth) ||
    farm.plantingMonth < 1 ||
    farm.plantingMonth > 12
  ) {
    issues.push({
      field: 'plantingMonth',
      message: 'Planned planting month must be between 1 (January) and 12 (December).',
      messageBilingual: {
        en: 'Planned planting month must be between 1 (January) and 12 (December).',
        de: 'Der geplante Aussaatmonat muss zwischen 1 (Januar) und 12 (Dezember) liegen.',
      },
    });
  }

  const validSoils = ['Sandy', 'Loamy', 'Clay', 'Silty'];
  if (!validSoils.includes(farm.soilType)) {
    issues.push({
      field: 'soilType',
      message: 'Soil type must be Sandy, Loamy, Clay, or Silty.',
      messageBilingual: {
        en: 'Soil type must be Sandy, Loamy, Clay, or Silty.',
        de: 'Die Bodenart muss Sand, Lehm, Ton oder Schluff sein.',
      },
    });
  }

  return {
    valid: issues.length === 0,
    issues,
    missingUncertaintyFields,
    missingUncertaintyBilingual,
  };
}

export function normalizePreferenceWeights(
  farm: FarmProfile
): PreferenceWeights {
  const raw = farm.customWeights ?? PRIORITY_WEIGHT_PRESETS[farm.priorityMode];
  const p = Math.max(0, raw.profit);
  const c = Math.max(0, raw.climateResilience);
  const w = Math.max(0, raw.waterEfficiency);
  const s = Math.max(0, raw.soilMatch);
  const total = p + c + w + s;

  if (total <= 0) {
    return PRIORITY_WEIGHT_PRESETS.balanced;
  }

  return {
    profit: Number((p / total).toFixed(4)),
    climateResilience: Number((c / total).toFixed(4)),
    waterEfficiency: Number((w / total).toFixed(4)),
    soilMatch: Number((s / total).toFixed(4)),
  };
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

function evaluateSingleCrop(
  crop: CropKnowledgeEntry,
  farm: FarmProfile,
  weather: WeatherForecastAnalysis | null,
  scenario: ClimateScenarioConfig,
  weights: PreferenceWeights,
  validation: FarmValidationResult,
  maxExpectedProfitAcrossCropsPerHaEur: number
): CropSimulationResult {
  const exchangeRate =
    CROP_DATABASE.exchangeRatesPerEurIllustrative[farm.currency] ?? 1;

  // 1. Seasonal Planting Appropriateness (German phenology check)
  const isOptimalMonth = crop.plantingWindow.optimalMonths.includes(
    farm.plantingMonth
  );
  const isShoulderMonth = crop.plantingWindow.shoulderMonths.includes(
    farm.plantingMonth
  );
  const seasonalSuitability: 'optimal' | 'shoulder' | 'out_of_season' =
    isOptimalMonth
      ? 'optimal'
      : isShoulderMonth
        ? 'shoulder'
        : 'out_of_season';

  const monthEn = MONTH_NAMES_EN[farm.plantingMonth - 1] ?? 'Selected month';
  const monthDe = MONTH_NAMES_DE[farm.plantingMonth - 1] ?? 'Gewählter Monat';

  // 2. Total Crop Water Demand vs. Additional Supplemental Irrigation Requirement
  const availableIrrigationMmHa = convertWaterToMmPerHa(
    farm.availableWaterValue,
    farm.availableWaterUnit,
    farm.areaHa
  );
  const availableIrrigationTotalM3 =
    farm.availableWaterUnit === 'm3_total_season' && Number.isFinite(farm.availableWaterValue)
      ? Math.round(Math.max(0, farm.availableWaterValue))
      : convertMmPerHaToTotalM3(availableIrrigationMmHa, farm.areaHa);

  const weatherAlignment = checkForecastSowingAlignment(
    weather,
    farm.plantingMonth
  );
  const useNearTermSowingWeather =
    Boolean(weather && weather.status === 'ok' && weather.summary) &&
    weatherAlignment.aligned;

  // Strictly separate short-term seedbed forecast moisture (only applied when forecast covers the planned sowing month!)
  const nearTermSeedbedPrecipCreditMmHa =
    useNearTermSowingWeather && weather?.summary
      ? Number(Math.min(12, weather.summary.totalPrecipMm * 0.35).toFixed(1))
      : 0;

  // Regional growing-season precipitation adjusted by scenario multiplier
  const estimatedEffectiveSeasonRainMmHa = Number(
    (
      crop.seasonalWaterMmHa.typicalGermanSeasonRainMm *
      scenario.seasonalRainfallMultiplier
    ).toFixed(1)
  );

  const totalCropDemandMinMmHa = crop.seasonalWaterMmHa.totalDemandMin;
  const scenarioTotalCropDemandMmHa = Math.round(
    totalCropDemandMinMmHa * scenario.waterDemandMultiplier
  );
  const scenarioOptimalCropDemandMmHa = Math.round(
    crop.seasonalWaterMmHa.totalDemandOptimal * scenario.waterDemandMultiplier
  );

  // Additional supplemental irrigation needed beyond natural growing-season rain
  const additionalIrrigationRequiredMmHa = Number(
    Math.max(
      0,
      scenarioTotalCropDemandMmHa -
        estimatedEffectiveSeasonRainMmHa -
        nearTermSeedbedPrecipCreditMmHa
    ).toFixed(1)
  );

  const additionalIrrigationOptimalMmHa = Number(
    Math.max(
      0,
      scenarioOptimalCropDemandMmHa -
        estimatedEffectiveSeasonRainMmHa -
        nearTermSeedbedPrecipCreditMmHa
    ).toFixed(1)
  );

  const additionalIrrigationRequiredM3 = convertMmPerHaToTotalM3(
    additionalIrrigationRequiredMmHa,
    farm.areaHa
  );

  const irrigationSurplusOrDeficitM3 =
    availableIrrigationTotalM3 - additionalIrrigationRequiredM3;
  const irrigationSurplusOrDeficitMmHa = Number(
    (availableIrrigationMmHa - additionalIrrigationRequiredMmHa).toFixed(1)
  );

  const uncontrolledSeasonRainMmHa =
    estimatedEffectiveSeasonRainMmHa +
    (useNearTermSowingWeather && weather?.summary
      ? weather.summary.totalPrecipMm
      : 0);

  const waterloggingExceeded =
    uncontrolledSeasonRainMmHa > crop.seasonalWaterMmHa.waterloggingRainLimit &&
    (farm.soilType === 'Clay' || crop.climateSensitivity.excessRain >= 0.8);

  const satisfiesWaterConstraint =
    availableIrrigationTotalM3 >= additionalIrrigationRequiredM3 &&
    !waterloggingExceeded;

  const irrigationUtilizationPct =
    availableIrrigationTotalM3 > 0
      ? Number(
          (
            (additionalIrrigationRequiredM3 / availableIrrigationTotalM3) *
            100
          ).toFixed(1)
        )
      : additionalIrrigationRequiredM3 > 0
        ? 999
        : 0;

  // 3. Financial Hard Constraint (EUR base)
  const inputCostPerHa = Number(
    (crop.inputCostsEurPerHa.total * exchangeRate).toFixed(2)
  );
  const totalFarmInputCost = Number((inputCostPerHa * farm.areaHa).toFixed(2));
  const availableFarmBudget = Number(farm.budgetAmount.toFixed(2));
  const budgetSurplusOrDeficit = Number(
    (availableFarmBudget - totalFarmInputCost).toFixed(2)
  );
  const satisfiesBudgetConstraint = availableFarmBudget >= totalFarmInputCost;
  const budgetUtilizationPct =
    availableFarmBudget > 0
      ? Number(((totalFarmInputCost / availableFarmBudget) * 100).toFixed(1))
      : totalFarmInputCost > 0
        ? 999
        : 0;

  // 4. Near-Term Forecast Signals + Seasonal Stress Multipliers
  let nearTermHeatSignal = 0;
  let nearTermFrostSignal = 0;
  let nearTermDrySignal = 0;
  let nearTermRainSignal = 0;

  if (useNearTermSowingWeather && weather && weather.summary) {
    if (
      weather.summary.peakMaxTempC >=
      crop.climateSensitivity.heatStressThresholdC
    ) {
      nearTermHeatSignal = clamp(
        (weather.summary.peakMaxTempC -
          crop.climateSensitivity.heatStressThresholdC +
          weather.summary.hotDaysCount * 1.5) /
          12,
        0.15,
        1
      );
    }
    if (
      weather.summary.lowestMinTempC <=
      crop.climateSensitivity.frostStressThresholdC
    ) {
      nearTermFrostSignal = clamp(
        (crop.climateSensitivity.frostStressThresholdC -
          weather.summary.lowestMinTempC +
          weather.summary.frostDaysCount * 2) /
          10,
        0.2,
        1
      );
    }
    if (
      weather.summary.totalPrecipMm <
      weather.thresholdsUsed.dryWindowTotalPrecipMm
    ) {
      nearTermDrySignal = 0.3;
    }
    if (weather.summary.heavyRainDaysCount > 0) {
      nearTermRainSignal = clamp(
        weather.summary.heavyRainDaysCount * 0.35,
        0.25,
        1
      );
    }
  }

  const heatHazard = clamp(
    Math.max(
      nearTermHeatSignal * 0.65,
      scenario.yieldStressMultipliers.heatFactor
    ),
    0,
    1
  );
  const frostHazard = clamp(
    Math.max(
      nearTermFrostSignal * 0.75,
      scenario.yieldStressMultipliers.frostFactor
    ),
    0,
    1
  );
  const droughtHazard = clamp(
    Math.max(
      nearTermDrySignal * 0.35,
      scenario.yieldStressMultipliers.droughtFactor
    ),
    0,
    1
  );
  const excessRainHazard = clamp(
    Math.max(
      nearTermRainSignal * 0.6,
      scenario.yieldStressMultipliers.excessRainFactor
    ),
    0,
    1
  );

  const heatRiskScore = Math.round(heatHazard * crop.climateSensitivity.heat * 100);
  const frostRiskScore = Math.round(
    frostHazard * crop.climateSensitivity.frost * 100
  );
  const droughtRiskScore = Math.round(
    droughtHazard * crop.climateSensitivity.drought * 100
  );
  const excessRainRiskScore = Math.round(
    excessRainHazard * crop.climateSensitivity.excessRain * 100
  );

  const peakHazardScore = Math.max(
    heatRiskScore,
    frostRiskScore,
    droughtRiskScore,
    excessRainRiskScore
  );
  const meanHazardScore =
    (heatRiskScore + frostRiskScore + droughtRiskScore + excessRainRiskScore) / 4;
  const overallRiskScore = Math.round(
    clamp(peakHazardScore * 0.68 + meanHazardScore * 0.32, 0, 100)
  );

  const overallRiskLevel: 'low' | 'moderate' | 'high' | 'critical' =
    overallRiskScore >= 70
      ? 'critical'
      : overallRiskScore >= 48
        ? 'high'
        : overallRiskScore >= 25
          ? 'moderate'
          : 'low';

  const climateResilience = clamp(100 - overallRiskScore, 0, 100);

  // 5. Soil & Regional Latitude Adjustment
  // Warm-season grain maize receives a mild coolness adjustment in northern Germany (lat > 52°) vs Upper Rhine (lat ~48-49°)
  const isNorthernSite =
    typeof farm.latitude === 'number' && farm.latitude > 51.8;
  const regionalTempFactor =
    crop.id === 'maize' && isNorthernSite ? 0.93 : 1.0;

  const soilCompatibility = crop.soilCompatibility[farm.soilType] ?? 60;
  const plantingTimingFactor =
    seasonalSuitability === 'optimal'
      ? 1.0
      : seasonalSuitability === 'shoulder'
        ? 0.88
        : 0.45;

  const totalWaterAvailableForCropMmHa =
    estimatedEffectiveSeasonRainMmHa +
    nearTermSeedbedPrecipCreditMmHa +
    availableIrrigationMmHa;
  const waterAdequacyRatio =
    scenarioOptimalCropDemandMmHa > 0
      ? clamp(
          totalWaterAvailableForCropMmHa / scenarioOptimalCropDemandMmHa,
          0.45,
          1.05
        )
      : 1;

  const soilYieldFactor = clamp(0.68 + (soilCompatibility / 100) * 0.36, 0.6, 1.05);
  const climateYieldFactor = clamp(1 - (overallRiskScore / 100) * 0.46, 0.42, 1.0);
  const compositeYieldMultiplier = clamp(
    soilYieldFactor *
      Math.min(1.03, waterAdequacyRatio) *
      climateYieldFactor *
      plantingTimingFactor *
      regionalTempFactor,
    0.35,
    1.08
  );

  const yieldLowHa = Number(
    (crop.indicativeYieldTonsPerHa.low * compositeYieldMultiplier).toFixed(2)
  );
  const yieldExpectedHa = Number(
    (crop.indicativeYieldTonsPerHa.base * compositeYieldMultiplier).toFixed(2)
  );
  const yieldHighHa = Number(
    (
      crop.indicativeYieldTonsPerHa.high *
      Math.min(1.05, compositeYieldMultiplier * 1.06)
    ).toFixed(2)
  );

  const totalYieldLow = Number((yieldLowHa * farm.areaHa).toFixed(2));
  const totalYieldExpected = Number((yieldExpectedHa * farm.areaHa).toFixed(2));
  const totalYieldHigh = Number((yieldHighHa * farm.areaHa).toFixed(2));

  const priceLowLocal = crop.indicativeMarketPriceEurPerTon.low * exchangeRate;
  const priceBaseLocal = crop.indicativeMarketPriceEurPerTon.base * exchangeRate;
  const priceHighLocal = crop.indicativeMarketPriceEurPerTon.high * exchangeRate;

  const grossRevLow = Number((totalYieldLow * priceLowLocal).toFixed(2));
  const grossRevExpected = Number(
    (totalYieldExpected * priceBaseLocal).toFixed(2)
  );
  const grossRevHigh = Number((totalYieldHigh * priceHighLocal).toFixed(2));

  const netProfitLow = Number((grossRevLow - totalFarmInputCost).toFixed(2));
  const netProfitExpected = Number(
    (grossRevExpected - totalFarmInputCost).toFixed(2)
  );
  const netProfitHigh = Number((grossRevHigh - totalFarmInputCost).toFixed(2));

  const expectedRoiPct =
    totalFarmInputCost > 0
      ? Number(((netProfitExpected / totalFarmInputCost) * 100).toFixed(1))
      : 0;

  // Water efficiency score: rewards low supplemental irrigation demand + comfortable m³ margin
  const intrinsicWaterScore = clamp(
    ((260 - additionalIrrigationRequiredMmHa) / 260) * 100,
    8,
    100
  );
  const marginBonus =
    irrigationSurplusOrDeficitMmHa >= 0
      ? clamp((irrigationSurplusOrDeficitMmHa / 180) * 18, 0, 18)
      : -25;
  const waterEfficiency = Math.round(
    clamp(intrinsicWaterScore * 0.84 + marginBonus, 0, 100)
  );

  const expectedNetProfitPerHaEur =
    farm.areaHa > 0 ? netProfitExpected / exchangeRate / farm.areaHa : 0;
  let profitPotential = 0;
  if (expectedNetProfitPerHaEur > 0) {
    const marginScore = clamp(
      (Math.log1p(expectedNetProfitPerHaEur / 250) /
        Math.log1p(Math.max(1500, maxExpectedProfitAcrossCropsPerHaEur) / 250)) *
        100,
      0,
      100
    );
    const roiScore = clamp((expectedRoiPct / 140) * 100, 0, 100);
    profitPotential = Math.round(
      clamp(marginScore * 0.55 + roiScore * 0.45, 0, 100)
    );
  }

  const preferredCropBonus = 0;

  // Hard constraints check (Seasonal Planting Window + Irrigation m³ + Budget € + Soil Viability)
  const infeasibilityReasonsBilingual: BilingualText[] = [];

  if (seasonalSuitability === 'out_of_season') {
    infeasibilityReasonsBilingual.push({
      en: `Out of planting season in ${monthEn}: ${crop.names.en} requires sowing in ${crop.plantingWindow.label.en}.`,
      de: `Außerhalb des Saatfensters im ${monthDe}: ${crop.names.de} erfordert eine Aussaat im Zeitraum ${crop.plantingWindow.label.de}.`,
    });
  }

  if (!satisfiesWaterConstraint) {
    if (waterloggingExceeded) {
      infeasibilityReasonsBilingual.push({
        en: `Waterlogging hazard: seasonal precipitation (${uncontrolledSeasonRainMmHa.toFixed(0)} mm/ha) exceeds ${crop.names.en} drainage tolerance on ${farm.soilType.toLowerCase()} soil.`,
        de: `Staunässegefahr: Der saisonale Niederschlag (${uncontrolledSeasonRainMmHa.toFixed(0)} mm/ha) überschreitet die Staunässetoleranz von ${crop.names.de}.`,
      });
    } else {
      infeasibilityReasonsBilingual.push({
        en: `Insufficient supplemental irrigation: requires ${additionalIrrigationRequiredM3.toLocaleString('en-US')} m³ (${additionalIrrigationRequiredMmHa} mm/ha) beyond seasonal rain, exceeding available ${availableIrrigationTotalM3.toLocaleString('en-US')} m³ by ${Math.abs(irrigationSurplusOrDeficitM3).toLocaleString('en-US')} m³.`,
        de: `Unzureichendes Beregnungswasser: Es werden ${additionalIrrigationRequiredM3.toLocaleString('de-DE')} m³ (${additionalIrrigationRequiredMmHa} mm/ha) Zusatzbewässerung benötigt, verfügbar sind ${availableIrrigationTotalM3.toLocaleString('de-DE')} m³ (Defizit: ${Math.abs(irrigationSurplusOrDeficitM3).toLocaleString('de-DE')} m³).`,
      });
    }
  }

  if (!satisfiesBudgetConstraint) {
    infeasibilityReasonsBilingual.push({
      en: `Exceeds farming budget: requires ${farm.currency} ${totalFarmInputCost.toLocaleString('en-US')} for ${farm.areaHa} ha, exceeding budget of ${farm.currency} ${availableFarmBudget.toLocaleString('en-US')} by ${farm.currency} ${Math.abs(budgetSurplusOrDeficit).toLocaleString('en-US')}.`,
      de: `Überschreitet das Anbaubudget: Direktkosten von ${totalFarmInputCost.toLocaleString('de-DE')} ${farm.currency} für ${farm.areaHa} ha übersteigen das Budget von ${availableFarmBudget.toLocaleString('de-DE')} ${farm.currency} um ${Math.abs(budgetSurplusOrDeficit).toLocaleString('de-DE')} ${farm.currency}.`,
    });
  }

  if (soilCompatibility < 40) {
    infeasibilityReasonsBilingual.push({
      en: `Incompatible soil: ${farm.soilType} soil rating (${soilCompatibility}/100) is below minimum viability (40/100).`,
      de: `Ungeeigneter Boden: Die Bodeneignung (${soilCompatibility}/100) liegt unter dem pflanzenbaulichen Mindestwert (40/100).`,
    });
  }

  const baseWeighted =
    weights.profit * profitPotential +
    weights.climateResilience * climateResilience +
    weights.waterEfficiency * waterEfficiency +
    weights.soilMatch * soilCompatibility;

  let adjustedWeighted = baseWeighted;
  if (infeasibilityReasonsBilingual.length > 0) {
    adjustedWeighted =
      seasonalSuitability === 'out_of_season'
        ? Math.min(42, baseWeighted * 0.45)
        : Math.min(48, baseWeighted * 0.58);
  } else if (seasonalSuitability === 'shoulder') {
    adjustedWeighted = baseWeighted * 0.93;
  }

  const weightedSuitability = Number(clamp(adjustedWeighted, 0, 100).toFixed(1));

  const infeasibilityReasons = infeasibilityReasonsBilingual.map((r) => r.en);

  const uncertaintyReasonsBilingual: BilingualText[] = [
    ...validation.missingUncertaintyBilingual,
  ];
  if (!weather || weather.status === 'unavailable') {
    uncertaintyReasonsBilingual.push({
      en:
        weather?.errorMessageBilingual?.en ??
        'Live DWD/Open-Meteo weather forecast was unavailable; near-term seedbed risk could not be verified.',
      de:
        weather?.errorMessageBilingual?.de ??
        'Die aktuelle DWD-/Open-Meteo-Wetterprognose war nicht verfügbar; kurzfristige Bestellrisiken konnten nicht geprüft werden.',
    });
  }
  if (!validation.valid) {
    uncertaintyReasonsBilingual.push(
      ...validation.issues.map((iss) => iss.messageBilingual)
    );
  }

  const uncertaintyReasons = uncertaintyReasonsBilingual.map((u) => u.en);

  let feasibilityStatus: 'feasible' | 'infeasible' | 'uncertain' = 'feasible';
  if (infeasibilityReasonsBilingual.length > 0) {
    feasibilityStatus = 'infeasible';
  } else if (
    !validation.valid ||
    validation.missingUncertaintyBilingual.length > 0 ||
    !weather ||
    weather.status === 'unavailable'
  ) {
    feasibilityStatus = 'uncertain';
  }

  const keySensitivities: BilingualText[] = [];
  if (seasonalSuitability === 'shoulder') {
    keySensitivities.push({
      en: `Shoulder sowing month (${monthEn}): slight yield discount applied`,
      de: `Rand-Aussaatmonat (${monthDe}): leichter Ertragsabschlag berücksichtigt`,
    });
  }
  if (heatRiskScore >= 35) {
    keySensitivities.push({
      en: `Heat stress exposure ${heatRiskScore}/100`,
      de: `Hitzestress-Belastung ${heatRiskScore}/100`,
    });
  }
  if (frostRiskScore >= 35) {
    keySensitivities.push({
      en: `Late-frost sensitivity ${frostRiskScore}/100`,
      de: `Spätfrost-Empfindlichkeit ${frostRiskScore}/100`,
    });
  }
  if (droughtRiskScore >= 35) {
    keySensitivities.push({
      en: `Drought sensitivity ${droughtRiskScore}/100`,
      de: `Trockenstress-Risiko ${droughtRiskScore}/100`,
    });
  }
  if (excessRainRiskScore >= 35) {
    keySensitivities.push({
      en: `Starkregen / waterlogging sensitivity ${excessRainRiskScore}/100`,
      de: `Starkregen- & Staunässerisiko ${excessRainRiskScore}/100`,
    });
  }
  if (keySensitivities.length === 0) {
    keySensitivities.push({
      en: 'Low climate-stress exposure under active German parameters',
      de: 'Geringe Klimastress-Belastung unter den aktiven Parametern',
    });
  }

  return {
    cropId: crop.id,
    cropName: crop.names.en,
    cropNames: crop.names,
    scientificName: crop.scientificName,
    category: crop.category,
    growingDurationDays: crop.growingDurationDays,
    plantingWindowLabel: crop.plantingWindow.label,
    harvestWindowLabel: crop.harvestWindow.label,
    seasonalSuitability,
    feasibilityStatus,
    infeasibilityReasons,
    infeasibilityReasonsBilingual,
    uncertaintyReasons,
    uncertaintyReasonsBilingual,
    waterEvaluation: {
      totalCropDemandMinMmHa,
      scenarioTotalCropDemandMmHa,
      scenarioOptimalCropDemandMmHa,
      estimatedEffectiveSeasonRainMmHa,
      nearTermSeedbedPrecipCreditMmHa,
      additionalIrrigationRequiredMmHa,
      additionalIrrigationOptimalMmHa,
      additionalIrrigationRequiredM3,
      availableIrrigationMmHa,
      availableIrrigationTotalM3,
      irrigationSurplusOrDeficitMmHa,
      irrigationSurplusOrDeficitM3,
      irrigationUtilizationPct,
      satisfiesWaterConstraint,
    },
    financialEvaluation: {
      currency: farm.currency,
      exchangeRateFromEur: exchangeRate,
      inputCostPerHa,
      totalFarmInputCost,
      availableFarmBudget,
      budgetSurplusOrDeficit,
      budgetUtilizationPct,
      satisfiesBudgetConstraint,
      destatisBenchmarkTonsPerHa:
        crop.indicativeYieldTonsPerHa.destatisNationalAvgTonsHa,
      yieldTonsPerHa: {
        low: yieldLowHa,
        expected: yieldExpectedHa,
        high: yieldHighHa,
      },
      totalFarmYieldTons: {
        low: totalYieldLow,
        expected: totalYieldExpected,
        high: totalYieldHigh,
      },
      grossRevenueRange: {
        low: grossRevLow,
        expected: grossRevExpected,
        high: grossRevHigh,
      },
      netProfitRange: {
        low: netProfitLow,
        expected: netProfitExpected,
        high: netProfitHigh,
      },
      expectedRoiPct,
      yieldClassification: crop.indicativeYieldTonsPerHa.classification,
      costAndPriceClassification: crop.inputCostsEurPerHa.classification,
    },
    scores: {
      soilCompatibility,
      climateResilience,
      waterEfficiency,
      profitPotential,
      preferredCropBonus,
      weightedSuitability,
    },
    riskProfile: {
      overallRiskLevel,
      overallRiskScore,
      heatRiskScore,
      frostRiskScore,
      droughtRiskScore,
      excessRainRiskScore,
      keySensitivities,
    },
  };
}

export function simulateCrops(
  farm: FarmProfile,
  weather: WeatherForecastAnalysis | null,
  scenarioId: ClimateScenarioId = 'baseline',
  scenarioOverride?: ScenarioParametersOverride
): SimulationRunOutput {
  const validation = validateFarmProfile(farm);
  const weightsNormalized = normalizePreferenceWeights(farm);
  const scenario = resolveScenarioConfig(scenarioId, scenarioOverride);
  const exchangeRate =
    CROP_DATABASE.exchangeRatesPerEurIllustrative[farm.currency] ?? 1;

  const ceilingProfitsEurHa = CROP_DATABASE.crops.map((c) => {
    const baseGross =
      c.indicativeYieldTonsPerHa.base * c.indicativeMarketPriceEurPerTon.base;
    return Math.max(150, baseGross - c.inputCostsEurPerHa.total);
  });
  const maxExpectedProfitAcrossCropsPerHaEur = Math.max(...ceilingProfitsEurHa);

  const rawResults = CROP_DATABASE.crops.map((crop) =>
    evaluateSingleCrop(
      crop,
      farm,
      weather,
      scenario,
      weightsNormalized,
      validation,
      maxExpectedProfitAcrossCropsPerHaEur
    )
  );

  const statusOrder: Record<CropSimulationResult['feasibilityStatus'], number> = {
    feasible: 0,
    uncertain: 1,
    infeasible: 2,
  };

  const cropResults = [...rawResults].sort((a, b) => {
    const orderDiff =
      statusOrder[a.feasibilityStatus] - statusOrder[b.feasibilityStatus];
    if (orderDiff !== 0) return orderDiff;
    const scoreDiff =
      b.scores.weightedSuitability - a.scores.weightedSuitability;
    if (scoreDiff !== 0) return scoreDiff;
    const aPref = a.cropId === farm.preferredCrop ? 1 : 0;
    const bPref = b.cropId === farm.preferredCrop ? 1 : 0;
    return bPref - aPref;
  });

  const feasibleCrops = cropResults.filter(
    (r) => r.feasibilityStatus === 'feasible'
  );
  const availableIrrigationMmHa = convertWaterToMmPerHa(
    farm.availableWaterValue,
    farm.availableWaterUnit,
    farm.areaHa
  );
  const availableIrrigationTotalM3 =
    farm.availableWaterUnit === 'm3_total_season' && Number.isFinite(farm.availableWaterValue)
      ? Math.round(Math.max(0, farm.availableWaterValue))
      : convertMmPerHaToTotalM3(availableIrrigationMmHa, farm.areaHa);

  return {
    evaluatedAt: new Date().toISOString(),
    scenario,
    weightsNormalized,
    farmSummary: {
      country: farm.country || 'Germany',
      locationName: farm.locationName,
      plantingMonth: farm.plantingMonth,
      areaHa: farm.areaHa,
      soilType: farm.soilType,
      availableIrrigationMmHa,
      availableIrrigationTotalM3,
      budgetInSelectedCurrency: farm.budgetAmount,
      budgetInEurEquivalent: Number(
        (farm.budgetAmount / exchangeRate).toFixed(2)
      ),
      currency: farm.currency,
    },
    validation,
    cropResults,
    feasibleCropsCount: feasibleCrops.length,
    topFeasibleCropId: feasibleCrops.length > 0 ? feasibleCrops[0].cropId : null,
    illustrativeDisclaimer: CROP_DATABASE.illustrativeDisclaimer,
  };
}
