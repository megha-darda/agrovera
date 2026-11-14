import {
  CURRENCY_SYMBOLS,
  MONTH_NAMES_DE,
  MONTH_NAMES_EN,
} from '../engine/presets.ts';
import type {
  AgenticEvaluationResponse,
  AppLanguage,
  BilingualText,
  CropId,
  CropSimulationResult,
  CurrencyCode,
  DataClassification,
  FarmProfile,
  PriorityMode,
  SimulationRunOutput,
  SoilType,
  WeatherForecastAnalysis,
} from '../types/domain.ts';

export function pickBilingual(
  text: BilingualText | string | undefined | null,
  lang: AppLanguage
): string {
  if (!text) return '';
  if (typeof text === 'string') return text;
  return lang === 'de' ? text.de : text.en;
}

export function formatNumber(
  value: number,
  lang: AppLanguage = 'en',
  maximumFractionDigits = 1
): string {
  if (!Number.isFinite(value)) return '0';
  const locale = lang === 'de' ? 'de-DE' : 'en-US';
  return value.toLocaleString(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
}

export function formatCurrency(
  amount: number,
  currency: CurrencyCode,
  lang: AppLanguage = 'en',
  maximumFractionDigits = 0
): string {
  const locale = lang === 'de' ? 'de-DE' : 'en-US';
  const absFormatted = Math.abs(amount).toLocaleString(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
  const sign = amount < 0 ? '-' : '';
  if (lang === 'de') {
    return `${sign}${absFormatted} ${symbol}`;
  }
  return `${sign}${symbol}${absFormatted}`;
}

export function formatDateShort(
  isoDate: string,
  lang: AppLanguage = 'en'
): string {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length === 3) {
    const [, mm, dd] = parts;
    return lang === 'de' ? `${dd}.${mm}.` : `${mm}-${dd}`;
  }
  return isoDate;
}

export function formatTimeBerlin(
  isoTimestamp: string,
  lang: AppLanguage = 'en'
): string {
  try {
    const d = new Date(isoTimestamp);
    return d.toLocaleTimeString(lang === 'de' ? 'de-DE' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Europe/Berlin',
    });
  } catch {
    return isoTimestamp;
  }
}

export function formatCropName(
  cropId: CropId | 'none' | null | undefined,
  lang: AppLanguage = 'en'
): string {
  if (!cropId || cropId === 'none') {
    return lang === 'de' ? 'Keine machbare Kultur' : 'No Feasible Crop';
  }
  const map: Record<CropId, BilingualText> = {
    winter_wheat: { en: 'Winter Wheat', de: 'Winterweizen' },
    barley: { en: 'Barley', de: 'Gerste' },
    maize: { en: 'Maize', de: 'Mais' },
    potato: { en: 'Potato', de: 'Kartoffel' },
  };
  return map[cropId] ? pickBilingual(map[cropId], lang) : cropId;
}

export function formatSoilName(
  soil: SoilType,
  lang: AppLanguage = 'en'
): string {
  const map: Record<SoilType, BilingualText> = {
    Loamy: { en: 'Loamy', de: 'Lehm' },
    Sandy: { en: 'Sandy', de: 'Sand' },
    Clay: { en: 'Clay', de: 'Ton' },
    Silty: { en: 'Silty', de: 'Schluff' },
  };
  return pickBilingual(map[soil], lang);
}

export function formatPriorityLabel(
  mode: PriorityMode,
  lang: AppLanguage = 'en'
): string {
  const labels: Record<PriorityMode, BilingualText> = {
    balanced: { en: 'Balanced Outcome', de: 'Ausgewogenes Gesamtergebnis' },
    max_profit: {
      en: 'Maximum Potential Profit',
      de: 'Maximaler Deckungsbeitrag',
    },
    min_climate_risk: {
      en: 'Minimum Climate Risk',
      de: 'Minimales Klimarisiko',
    },
    min_water: { en: 'Minimum Water Usage', de: 'Minimaler Wasserbedarf' },
  };
  return pickBilingual(labels[mode], lang);
}

export function formatMonthName(
  month: number,
  lang: AppLanguage = 'en'
): string {
  const idx = Math.max(0, Math.min(11, month - 1));
  return lang === 'de'
    ? MONTH_NAMES_DE[idx] ?? 'Unbekannt'
    : MONTH_NAMES_EN[idx] ?? 'Unknown';
}

export function formatFeasibilityLabel(
  status: CropSimulationResult['feasibilityStatus'],
  lang: AppLanguage = 'en'
): string {
  if (status === 'feasible') return lang === 'de' ? 'Machbar' : 'Feasible';
  if (status === 'uncertain') return lang === 'de' ? 'Unsicher' : 'Uncertain';
  return lang === 'de' ? 'Nicht machbar' : 'Infeasible';
}

export function formatRiskLevelLabel(
  level: CropSimulationResult['riskProfile']['overallRiskLevel'],
  lang: AppLanguage = 'en'
): string {
  const map: Record<typeof level, BilingualText> = {
    low: { en: 'LOW', de: 'NIEDRIG' },
    moderate: { en: 'MODERATE', de: 'MITTEL' },
    high: { en: 'HIGH', de: 'HOCH' },
    critical: { en: 'CRITICAL', de: 'KRITISCH' },
  };
  return pickBilingual(map[level], lang);
}

export function formatClassificationLabel(
  classification: DataClassification,
  lang: AppLanguage = 'en'
): string {
  const map: Record<DataClassification, BilingualText> = {
    verified_source: { en: 'Verified Source', de: 'Verifizierte Quelle' },
    illustrative_estimate: {
      en: 'Illustrative Estimate',
      de: 'Modellannahme',
    },
    missing: { en: 'Missing', de: 'Fehlend' },
  };
  return pickBilingual(map[classification], lang);
}

export interface DashboardDerivedState {
  hasAgenticRun: boolean;
  isEvaluationLanguageMatched: boolean;
  recommendedCrop: CropSimulationResult | null;
  alternativeCrops: CropSimulationResult[];
  feasibleCount: number;
  infeasibleCount: number;
  uncertainCount: number;
  activeHeadline: string;
  verificationLabel: string;
  requiresHumanReview: boolean;
  weatherAvailable: boolean;
  triggeredWeatherRisksCount: number;
}

/**
 * Pure state-derivation function mapping real simulation, weather,
 * and multi-agent outputs into Overview & Dashboard view state.
 */
export function deriveDashboardState(
  farm: FarmProfile,
  simulation: SimulationRunOutput,
  weather: WeatherForecastAnalysis | null,
  evaluation: AgenticEvaluationResponse | null,
  lang: AppLanguage = 'en'
): DashboardDerivedState {
  const feasibleCount = simulation.cropResults.filter(
    (c) => c.feasibilityStatus === 'feasible'
  ).length;
  const infeasibleCount = simulation.cropResults.filter(
    (c) => c.feasibilityStatus === 'infeasible'
  ).length;
  const uncertainCount = simulation.cropResults.filter(
    (c) => c.feasibilityStatus === 'uncertain'
  ).length;

  const targetCropId: CropId | 'none' | null = evaluation?.decision
    ? evaluation.decision.recommendedCropId
    : simulation.topFeasibleCropId ??
      (uncertainCount > 0 && feasibleCount === 0
        ? simulation.cropResults[0]?.cropId ?? null
        : null);

  const recommendedCrop =
    targetCropId && targetCropId !== 'none'
      ? simulation.cropResults.find((c) => c.cropId === targetCropId) ?? null
      : null;

  const alternativeCrops = simulation.cropResults.filter(
    (c) => c.cropId !== recommendedCrop?.cropId
  );

  const isEvaluationLanguageMatched = evaluation
    ? evaluation.language === lang
    : true;

  let verificationLabel =
    lang === 'de'
      ? 'Deterministische Vorschau · KI-Analyse zur Gegenprüfung starten'
      : 'Deterministic Preview Only · Run AI Agents to Verify';

  if (evaluation) {
    if (evaluation.aiError) {
      verificationLabel =
        lang === 'de'
          ? `KI-Pipeline-Fehler (${evaluation.aiError.model}) · Deterministische Berechnung aktiv`
          : `AI Pipeline Error (${evaluation.aiError.model}) · Deterministic Fallback Active`;
    } else if (
      evaluation.validationGate?.passed &&
      !evaluation.requiresHumanReview
    ) {
      verificationLabel =
        lang === 'de'
          ? `Geprüft durch Carbon-Prüfer & Code-Gate (${evaluation.reviewCycles.length} Durchlauf)`
          : `Verified by Carbon Critic & Deterministic Gate (${evaluation.reviewCycles.length} cycle${evaluation.reviewCycles.length === 1 ? '' : 's'})`;
    } else if (
      evaluation.validationGate?.passed &&
      evaluation.requiresHumanReview
    ) {
      verificationLabel =
        lang === 'de'
          ? 'Harte Grenzen erfüllt · Fachberatung empfohlen'
          : 'Passed Hard Constraints · Advisory Human Review Flagged';
    } else {
      verificationLabel =
        lang === 'de'
          ? 'Validierung offen · Menschliche Fachprüfung erforderlich'
          : 'Validation Unresolved · Mandatory Human Agronomic Review';
    }
  } else if (!weather) {
    verificationLabel =
      lang === 'de'
        ? 'DWD-/Open-Meteo-Wetterabruf läuft · Vorläufige Reihung'
        : 'Retrieving Live DWD/Open-Meteo Forecast · Preliminary Ranking';
  }

  const cropDisplay = recommendedCrop
    ? pickBilingual(recommendedCrop.cropNames, lang)
    : '';
  const soilDisplay = formatSoilName(farm.soilType, lang);
  const areaFormatted = formatNumber(farm.areaHa, lang, 1);
  const scoreFormatted = recommendedCrop
    ? formatNumber(recommendedCrop.scores.weightedSuitability, lang, 1)
    : '0';

  const activeHeadline =
    evaluation?.decision?.headline && isEvaluationLanguageMatched
      ? evaluation.decision.headline
      : recommendedCrop && recommendedCrop.feasibilityStatus === 'feasible'
        ? lang === 'de'
          ? `${cropDisplay} führt die deterministische Anbaueignung (${scoreFormatted}/100) für ${areaFormatted} ha ${soilDisplay}boden an.`
          : `${cropDisplay} leads deterministic suitability (${scoreFormatted}/100) for ${areaFormatted} ha ${soilDisplay.toLowerCase()} soil.`
        : recommendedCrop && recommendedCrop.feasibilityStatus === 'uncertain'
          ? lang === 'de'
            ? `${cropDisplay} führt die vorläufige Ressourcenprüfung (${scoreFormatted}/100) an — Wetterprüfung ausstehend.`
            : `${cropDisplay} leads preliminary resource fit (${scoreFormatted}/100) — awaiting live weather verification.`
          : lang === 'de'
            ? 'Keine Kandidatenkultur erfüllt aktuell alle harten Saatzeit-, Wasser- und Budgetgrenzen.'
            : 'No candidate crop satisfies all current hard sowing-season, water, and budget constraints.';

  const triggeredWeatherRisksCount =
    weather?.status === 'ok'
      ? weather.riskIndicators.filter((r) => r.triggered).length
      : 0;

  return {
    hasAgenticRun: Boolean(
      evaluation && !evaluation.aiError && evaluation.decision
    ),
    isEvaluationLanguageMatched,
    recommendedCrop,
    alternativeCrops,
    feasibleCount,
    infeasibleCount,
    uncertainCount,
    activeHeadline,
    verificationLabel,
    requiresHumanReview: evaluation?.requiresHumanReview ?? true,
    weatherAvailable: weather?.status === 'ok',
    triggeredWeatherRisksCount,
  };
}
