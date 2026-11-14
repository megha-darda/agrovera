import { CROP_DATABASE } from './presets.ts';
import { convertMmPerHaToTotalM3, convertWaterToMmPerHa } from './simulator.ts';
import type {
  BilingualText,
  CropKnowledgeEntry,
  FarmProfile,
  GrowthStageId,
  InSeasonActionItem,
  InSeasonCareInputs,
  InSeasonCriticOutput,
  InSeasonDayFlag,
  InSeasonDecisionOutput,
  InSeasonDeterministicPlan,
  ValidationCheckItem,
  ValidationGateResult,
  WeatherForecastAnalysis,
} from '../types/domain.ts';

export const GROWTH_STAGE_LABELS: Record<GrowthStageId, BilingualText> = {
  emergence: {
    en: 'Emergence & Early Establishment (BBCH 09–19)',
    de: 'Feldaufgang & Jugendentwicklung (BBCH 09–19)',
  },
  vegetative: {
    en: 'Vegetative Growth / Tillering / Canopy (BBCH 20–39)',
    de: 'Bestockung / Schossen / Reihenschluss (BBCH 20–39)',
  },
  flowering_tuber: {
    en: 'Heading / Flowering / Tuber Initiation (BBCH 50–69)',
    de: 'Ährenschieben / Blüte / Knollenansatz (BBCH 50–69)',
  },
  grain_fill_bulking: {
    en: 'Grain Filling / Tuber Bulking (BBCH 70–85)',
    de: 'Kornfüllung / Knollenwachstum (BBCH 70–85)',
  },
  ripening_harvest: {
    en: 'Ripening & Pre-Harvest Maturity (BBCH 86–99)',
    de: 'Abreife & Erntevorbereitung (BBCH 86–99)',
  },
  unknown: {
    en: 'Not Yet Assessed in Field (Uncertain Stage)',
    de: 'Im Bestand noch nicht bonitiert (Unsicheres Stadium)',
  },
};

export const DEFAULT_IN_SEASON_INPUTS: InSeasonCareInputs = {
  plantedCropId: 'winter_wheat',
  plantingDate: '2026-10-14',
  growthStage: 'emergence',
  irrigationUsedM3: 1800,
  conditionNotes: '',
};

function computeDaysSincePlanting(
  plantingDate: string,
  referenceIsoDate?: string
): number | null {
  if (!plantingDate || !/^\d{4}-\d{2}-\d{2}$/.test(plantingDate)) {
    return null;
  }
  const plantedMs = Date.parse(`${plantingDate}T00:00:00Z`);
  const refStr =
    referenceIsoDate && /^\d{4}-\d{2}-\d{2}$/.test(referenceIsoDate)
      ? `${referenceIsoDate}T00:00:00Z`
      : new Date().toISOString();
  const refMs = Date.parse(refStr);
  if (Number.isNaN(plantedMs) || Number.isNaN(refMs)) {
    return null;
  }
  const diffDays = Math.floor((refMs - plantedMs) / (1000 * 60 * 60 * 24));
  return diffDays >= 0 ? diffDays : null;
}

function estimateCalendarStage(
  crop: CropKnowledgeEntry,
  daysSincePlanting: number | null
): GrowthStageId | null {
  if (daysSincePlanting === null) return null;
  const midpointDuration =
    (crop.growingDurationDays.min + crop.growingDurationDays.max) / 2;
  if (midpointDuration <= 0) return null;
  const progress = daysSincePlanting / midpointDuration;
  if (progress < 0.14) return 'emergence';
  if (progress < 0.48) return 'vegetative';
  if (progress < 0.68) return 'flowering_tuber';
  if (progress < 0.88) return 'grain_fill_bulking';
  return 'ripening_harvest';
}

/**
 * Deterministic In-Season Care helper.
 * Computes remaining irrigation water (never negative), builds a 7-day weather strip,
 * and identifies up to three grounded near-term crop-care considerations.
 */
export function buildInSeasonCarePlan(
  farm: FarmProfile,
  inputs: InSeasonCareInputs,
  weather: WeatherForecastAnalysis | null
): InSeasonDeterministicPlan {
  const crop =
    CROP_DATABASE.crops.find((c) => c.id === inputs.plantedCropId) ??
    CROP_DATABASE.crops[0];

  // 1. Remaining irrigation water = Available irrigation water - Water already used (never negative!)
  const allocatedMmHa = convertWaterToMmPerHa(
    farm.availableWaterValue,
    farm.availableWaterUnit,
    farm.areaHa
  );
  const allocatedWaterM3 =
    farm.availableWaterUnit === 'm3_total_season' &&
    Number.isFinite(farm.availableWaterValue)
      ? Math.round(Math.max(0, farm.availableWaterValue))
      : convertMmPerHaToTotalM3(allocatedMmHa, farm.areaHa);

  const sanitizedUsedM3 = Number.isFinite(inputs.irrigationUsedM3)
    ? Math.max(0, Math.round(inputs.irrigationUsedM3))
    : 0;

  const remainingWaterM3 = Math.max(0, allocatedWaterM3 - sanitizedUsedM3);
  const allocationExceededByM3 = Math.max(
    0,
    sanitizedUsedM3 - allocatedWaterM3
  );
  const remainingWaterMmHa =
    farm.areaHa > 0
      ? Number((remainingWaterM3 / (farm.areaHa * 10)).toFixed(1))
      : 0;

  // 2. Growth stage handling (always use farmer-selected value; clearly label any calendar estimate)
  const refDate = weather?.daily?.[0]?.date;
  const daysSincePlanting = computeDaysSincePlanting(
    inputs.plantingDate,
    refDate
  );
  const estimatedStageFromDate = estimateCalendarStage(crop, daysSincePlanting);
  const isStageUncertainOrEstimated =
    inputs.growthStage === 'unknown' ||
    daysSincePlanting === null ||
    (estimatedStageFromDate !== null &&
      estimatedStageFromDate !== inputs.growthStage);

  const stageLabelEn = GROWTH_STAGE_LABELS[inputs.growthStage].en;
  const stageLabelDe = GROWTH_STAGE_LABELS[inputs.growthStage].de;
  const estLabelEn = estimatedStageFromDate
    ? GROWTH_STAGE_LABELS[estimatedStageFromDate].en
    : null;
  const estLabelDe = estimatedStageFromDate
    ? GROWTH_STAGE_LABELS[estimatedStageFromDate].de
    : null;

  const stageStatusNote: BilingualText =
    inputs.growthStage === 'unknown'
      ? {
          en: estLabelEn
            ? `Growth stage marked uncertain by farmer. Illustrative calendar estimate (${daysSincePlanting} days after sowing): ${estLabelEn} — verify BBCH stage in the field.`
            : 'Growth stage not yet assessed in the field; verify actual BBCH stage before acting.',
          de: estLabelDe
            ? `Entwicklungsstadium als unsicher markiert. Unverbindliche Kalenderschätzung (${daysSincePlanting} Tage nach Saat): ${estLabelDe} — bitte BBCH-Stadium im Feld prüfen.`
            : 'Entwicklungsstadium noch nicht bonitiert; bitte tatsächliches BBCH-Stadium im Bestand prüfen.',
        }
      : estimatedStageFromDate && estimatedStageFromDate !== inputs.growthStage
        ? {
            en: `Using farmer-selected stage (${stageLabelEn}). Note: calendar elapsed time (${daysSincePlanting}d) would illustratively suggest '${estLabelEn}' — local thermal time governs true development.`,
            de: `Verwendet wird das vom Betrieb gewählte Stadium (${stageLabelDe}). Hinweis: Nach Kalendertagen (${daysSincePlanting} Tg.) läge rechnerisch „${estLabelDe}“ nahe — maßgeblich ist die reale Feldbonitur.`,
          }
        : {
            en: `Using farmer-selected stage: ${stageLabelEn}${daysSincePlanting !== null ? ` (${daysSincePlanting} days since sowing)` : ''}.`,
            de: `Verwendet wird das gewählte Stadium: ${stageLabelDe}${daysSincePlanting !== null ? ` (${daysSincePlanting} Tage seit Aussaat)` : ''}.`,
          };

  // 3. Seven-day weather strip & risk detection
  const thresholds = weather?.thresholdsUsed ?? {
    heatDayMaxTempC: 30,
    frostDayMinTempC: 0,
    dryWindowTotalPrecipMm: 10,
    heavyRainDailyMm: 20,
  };

  const sevenDaysRaw =
    weather?.status === 'ok' ? weather.daily.slice(0, 7) : [];

  const heatCutoffC = Math.min(
    thresholds.heatDayMaxTempC,
    crop.climateSensitivity.heatStressThresholdC
  );
  const frostCutoffC = Math.max(
    thresholds.frostDayMinTempC,
    crop.climateSensitivity.frostStressThresholdC
  );

  const sevenDayStrip: InSeasonDayFlag[] = sevenDaysRaw.map((d) => ({
    date: d.date,
    tempMaxC: d.tempMaxC,
    tempMinC: d.tempMinC,
    precipMm: d.precipMm,
    et0Mm: d.et0Mm,
    isHeat: d.tempMaxC >= heatCutoffC,
    isFrost: d.tempMinC <= thresholds.frostDayMinTempC,
    isHeavyRain: d.precipMm >= thresholds.heavyRainDailyMm,
    isDryDay: d.precipMm < 0.5,
  }));

  const missingObservations: BilingualText[] = [
    {
      en: 'Measured root-zone soil moisture (spade test or tensiometer/sensor reading) is not connected.',
      de: 'Gemessene Bodenfeuchte im Wurzelraum (Spatenprobe oder Sensorwert) liegt nicht vor.',
    },
    {
      en: 'In-field scouting observations (stand density, drainage outlets, leaf wetness/lesions) require visual inspection.',
      de: 'Vor-Ort-Boniturdaten (Bestandesdichte, Dränageabfluss, Blattgesundheit) erfordern eine Feldkontrolle.',
    },
  ];
  if (isStageUncertainOrEstimated) {
    missingObservations.push({
      en: 'Exact BBCH crop growth stage carries uncertainty and should be confirmed in the field.',
      de: 'Das genaue BBCH-Entwicklungsstadium ist mit Unsicherheit behaftet und sollte im Schlag bestätigt werden.',
    });
  }
  if (!inputs.conditionNotes.trim()) {
    missingObservations.push({
      en: 'No recent farmer crop-condition notes entered.',
      de: 'Keine aktuellen Bestandesnotizen hinterlegt.',
    });
  }

  const waterContextEn =
    remainingWaterM3 > 0
      ? `Remaining irrigation reserve: ${remainingWaterM3.toLocaleString('en-US')} m³ (${remainingWaterMmHa} mm/ha across ${farm.areaHa} ha; ${sanitizedUsedM3.toLocaleString('en-US')} m³ used of ${allocatedWaterM3.toLocaleString('en-US')} m³). Seasonal budget: ${farm.currency} ${farm.budgetAmount.toLocaleString('en-US')}.`
      : allocationExceededByM3 > 0
        ? `0 m³ remaining irrigation water (used ${sanitizedUsedM3.toLocaleString('en-US')} m³, exceeding ${allocatedWaterM3.toLocaleString('en-US')} m³ allocation by ${allocationExceededByM3.toLocaleString('en-US')} m³). Do NOT schedule additional irrigation from this allocation.`
        : `0 m³ remaining irrigation water (${sanitizedUsedM3.toLocaleString('en-US')} m³ used of ${allocatedWaterM3.toLocaleString('en-US')} m³). No irrigation volume available.`;

  const waterContextDe =
    remainingWaterM3 > 0
      ? `Verbleibendes Beregnungswasser: ${remainingWaterM3.toLocaleString('de-DE')} m³ (${remainingWaterMmHa} mm/ha auf ${farm.areaHa} ha; ${sanitizedUsedM3.toLocaleString('de-DE')} m³ von ${allocatedWaterM3.toLocaleString('de-DE')} m³ genutzt). Saisonbudget: ${farm.budgetAmount.toLocaleString('de-DE')} ${farm.currency}.`
      : allocationExceededByM3 > 0
        ? `0 m³ verbleibendes Beregnungswasser (${sanitizedUsedM3.toLocaleString('de-DE')} m³ verbraucht; Kontingent von ${allocatedWaterM3.toLocaleString('de-DE')} m³ um ${allocationExceededByM3.toLocaleString('de-DE')} m³ überschritten). Keine weitere Bewässerung aus diesem Kontingent einplanen.`
        : `0 m³ verbleibendes Beregnungswasser (${sanitizedUsedM3.toLocaleString('de-DE')} m³ von ${allocatedWaterM3.toLocaleString('de-DE')} m³ genutzt). Kein Zusatzwasser verfügbar.`;

  const candidateActions: InSeasonActionItem[] = [];

  if (sevenDayStrip.length === 0) {
    candidateActions.push({
      id: 'act_verify_forecast_and_moisture',
      triggerType: 'routine_check',
      priority: 'moderate',
      title: {
        en: 'Retrieve live 7-day forecast and check topsoil moisture manually',
        de: 'Aktuelle 7-Tage-Prognose abrufen und Bodenfeuchte im Bestand prüfen',
      },
      relevantDate: inputs.plantingDate || 'Next 7 days',
      forecastTrigger: {
        en: 'Live 7-day DWD ICON / Open-Meteo weather strip is currently unavailable.',
        de: 'Die aktuelle 7-Tage-DWD-ICON-/Open-Meteo-Wetterreihe ist derzeit nicht verfügbar.',
      },
      reason: {
        en: `Without near-term temperature and rainfall data for ${farm.locationName}, ${crop.names.en} (${stageLabelEn}) requires direct on-field inspection.`,
        de: `Ohne aktuelle Kurzfristdaten für ${farm.locationName} erfordert ${crop.names.de} (${stageLabelDe}) eine direkte Kontrolle im Schlag.`,
      },
      waterOrBudgetConsideration: {
        en: waterContextEn,
        de: waterContextDe,
      },
      uncertaintyOrMissing: {
        en: '7-day forecast feed unavailable and in-field soil moisture is unmeasured.',
        de: '7-Tage-Wetterdaten nicht geladen; gemessene Bodenfeuchte liegt nicht vor.',
      },
    });
  } else {
    const windowLabel = `${sevenDayStrip[0].date} – ${sevenDayStrip[sevenDayStrip.length - 1].date}`;
    const total7dRain = Number(
      sevenDayStrip.reduce((s, d) => s + d.precipMm, 0).toFixed(1)
    );

    // Candidate A: Frost exposure check
    const frostDays = sevenDayStrip.filter(
      (d) => d.tempMinC <= thresholds.frostDayMinTempC || d.tempMinC <= frostCutoffC
    );
    if (frostDays.length > 0) {
      const coldest = frostDays.reduce((min, d) =>
        d.tempMinC < min.tempMinC ? d : min
      );
      const cropFrostVulnerable =
        crop.id === 'potato' ||
        crop.id === 'maize' ||
        inputs.growthStage === 'emergence' ||
        inputs.growthStage === 'flowering_tuber' ||
        coldest.tempMinC <= crop.climateSensitivity.frostStressThresholdC;

      candidateActions.push({
        id: 'act_frost_monitor',
        triggerType: 'frost',
        priority: cropFrostVulnerable ? 'high' : 'moderate',
        title: {
          en: `Monitor ${crop.names.en} stand around forecast frost exposure`,
          de: `${crop.names.de}-Bestand vor und nach gemeldetem Nachtfrost kontrollieren`,
        },
        relevantDate: coldest.date,
        forecastTrigger: {
          en: `Forecast night minimum ${coldest.tempMinC} °C on ${coldest.date} (${frostDays.length} night(s) ≤ ${thresholds.frostDayMinTempC} °C).`,
          de: `Vorhergesagtes Nachtminimum ${coldest.tempMinC} °C am ${coldest.date} (${frostDays.length} Nacht/Nächte ≤ ${thresholds.frostDayMinTempC} °C).`,
        },
        reason: {
          en: cropFrostVulnerable
            ? `${crop.names.en} at '${stageLabelEn}' is sensitive to freezing temperatures (crop threshold ${crop.climateSensitivity.frostStressThresholdC} °C); inspect emerged tissue and avoid mechanical disturbance on frosted mornings.`
            : `${crop.names.en} tolerates moderate cold better than spring row crops, but sub-zero nights warrant checking soil heaving and leaf tips on ${farm.soilType.toLowerCase()} soil.`,
          de: cropFrostVulnerable
            ? `${crop.names.de} im Stadium „${stageLabelDe}“ reagiert empfindlich auf Frost (Kulturschwelle ${crop.climateSensitivity.frostStressThresholdC} °C); Blattmasse prüfen und gefrorene Bestände morgens nicht befahren.`
            : `${crop.names.de} besitzt eine höhere Kältetoleranz, dennoch sollten Auffrieren und Blattspitzen auf ${farm.soilType}-Boden nach Frostnächten kontrolliert werden.`,
        },
        waterOrBudgetConsideration: {
          en: `${waterContextEn} Avoid unnecessary field passes to protect operating budget.`,
          de: `${waterContextDe} Unnötige Überfahrten bei Frost vermeiden, um Bestand und Budget zu schonen.`,
        },
        uncertaintyOrMissing: {
          en: 'Canopy-level microclimate in low-lying field pockets may be 1–3 °C colder than grid forecast; growth stage & stand vigor unverified by sensor.',
          de: 'Senkenlagen im Schlag können 1–3 °C kälter ausfallen als die Rasterprognose; lokale Bestandesdichte vor Ort prüfen.',
        },
      });
    }

    // Candidate B: Heavy rainfall / drainage inspection
    const heavyRainDays = sevenDayStrip.filter(
      (d) => d.precipMm >= thresholds.heavyRainDailyMm || d.precipMm >= 15
    );
    if (heavyRainDays.length > 0 || total7dRain >= 35) {
      const wettest = sevenDayStrip.reduce((max, d) =>
        d.precipMm > max.precipMm ? d : max
      );
      candidateActions.push({
        id: 'act_drainage_inspect',
        triggerType: 'heavy_rain',
        priority:
          wettest.precipMm >= thresholds.heavyRainDailyMm ||
          farm.soilType === 'Clay'
            ? 'high'
            : 'moderate',
        title: {
          en: 'Inspect field drainage, headlands, and trafficability before heavy rain',
          de: 'Wasserabfluss, Vorgewende und Befahrbarkeit vor Niederschlagsspitzen prüfen',
        },
        relevantDate: wettest.date,
        forecastTrigger: {
          en: `Peak daily rain ${wettest.precipMm} mm on ${wettest.date} (7-day total: ${total7dRain} mm).`,
          de: `Tagesspitze ${wettest.precipMm} mm am ${wettest.date} (7-Tage-Summe: ${total7dRain} mm).`,
        },
        reason: {
          en: `Concentrated rainfall on ${farm.soilType.toLowerCase()} soil can cause surface ponding, ridge erosion (especially in ${crop.names.en}), or wheel-rut compaction if driven wet.`,
          de: `Kräftige Niederschläge auf ${farm.soilType}-Boden erhöhen das Risiko von Verschlämmung, Staunässe, Dammerosion sowie Bodenschadverdichtung bei Nässebefahrung.`,
        },
        waterOrBudgetConsideration: {
          en: `Natural rainfall (${total7dRain} mm over 7d) conserves your ${remainingWaterM3.toLocaleString('en-US')} m³ irrigation reserve; pause any planned irrigation.`,
          de: `Der gemeldete Niederschlag (${total7dRain} mm in 7 Tg.) schont Ihr Restkontingent von ${remainingWaterM3.toLocaleString('de-DE')} m³; keine Zusatzberegnung einplanen.`,
        },
        uncertaintyOrMissing: {
          en: 'Local convective shower intensity, field slope, and tile-drain outlet condition are not observed in this app.',
          de: 'Lokale Schauerintensität, Hangneigung und Zustand der Dränageausläufe sind in der App nicht erfasst.',
        },
      });
    }

    // Candidate C: Heat stress soil-moisture check
    const hotDays = sevenDayStrip.filter((d) => d.tempMaxC >= heatCutoffC);
    if (hotDays.length > 0) {
      const hottest = hotDays.reduce((max, d) =>
        d.tempMaxC > max.tempMaxC ? d : max
      );
      candidateActions.push({
        id: 'act_heat_moisture_check',
        triggerType: 'heat',
        priority:
          inputs.growthStage === 'flowering_tuber' ||
          inputs.growthStage === 'grain_fill_bulking'
            ? 'high'
            : 'moderate',
        title: {
          en: 'Check root-zone soil moisture ahead of forecast heat peak',
          de: 'Wurzelraum-Bodenfeuchte vor gemeldeter Hitzespitze kontrollieren',
        },
        relevantDate: hottest.date,
        forecastTrigger: {
          en: `Forecast maximum ${hottest.tempMaxC} °C on ${hottest.date} (${hotDays.length} day(s) ≥ ${heatCutoffC} °C).`,
          de: `Vorhergesagtes Maximum ${hottest.tempMaxC} °C am ${hottest.date} (${hotDays.length} Tag(e) ≥ ${heatCutoffC} °C).`,
        },
        reason: {
          en: `High air temperatures accelerate evapotranspiration in ${crop.names.en} during '${stageLabelEn}'. Verify actual topsoil and root-zone moisture before heat onset.`,
          de: `Hohe Temperaturen steigern den Verdunstungsanspruch bei ${crop.names.de} im Stadium „${stageLabelDe}“ deutlich. Prüfen Sie vorab die nutzbare Bodenfeuchte.`,
        },
        waterOrBudgetConsideration: {
          en:
            remainingWaterM3 > 0
              ? `${waterContextEn} Only irrigate if on-field soil check confirms deficit and within your ${remainingWaterM3.toLocaleString('en-US')} m³ cap.`
              : `${waterContextEn} Focus on moisture-conserving field management since 0 m³ irrigation reserve remains.`,
          de:
            remainingWaterM3 > 0
              ? `${waterContextDe} Eine Wassergabe nur nach bestätigter Bodenfeuchteprüfung und strikt innerhalb der ${remainingWaterM3.toLocaleString('de-DE')} m³ Restmenge erwägen.`
              : `${waterContextDe} Keine Beregnung möglich (0 m³ Restmenge); Fokus auf bodenschonende Feuchtesicherung.`,
        },
        uncertaintyOrMissing: {
          en: 'Actual plant-available soil water (% nFK) and irrigation system energy cost per m³ are not measured here.',
          de: 'Aktuelle nutzbare Feldkapazität (% nFK) und variable Beregnungskosten je m³ sind vor Ort zu prüfen.',
        },
      });
    }

    // Candidate D: Short-term dry weather review
    if (total7dRain < thresholds.dryWindowTotalPrecipMm) {
      candidateActions.push({
        id: 'act_dry_water_review',
        triggerType: 'dry_spell',
        priority:
          remainingWaterM3 === 0 ||
          inputs.growthStage === 'flowering_tuber' ||
          inputs.growthStage === 'emergence'
            ? 'high'
            : 'moderate',
        title: {
          en:
            remainingWaterM3 > 0
              ? 'Review irrigation readiness and inspect soil moisture during dry 7-day spell'
              : 'Inspect soil moisture closely — dry 7-day window with 0 m³ irrigation left',
          de:
            remainingWaterM3 > 0
              ? 'Beregnungsverfügbarkeit und Bodenfeuchte in trockener 7-Tage-Phase prüfen'
              : 'Bodenfeuchte engmaschig prüfen — trockene 7 Tage bei 0 m³ Wasserreserve',
        },
        relevantDate: windowLabel,
        forecastTrigger: {
          en: `Cumulative 7-day rainfall is ${total7dRain} mm (below ${thresholds.dryWindowTotalPrecipMm} mm dry-window threshold).`,
          de: `7-Tage-Niederschlagssumme beträgt nur ${total7dRain} mm (unter der Trockenschwelle von ${thresholds.dryWindowTotalPrecipMm} mm).`,
        },
        reason: {
          en: `${crop.names.en} (${stageLabelEn}) on ${farm.soilType.toLowerCase()} soil receives minimal natural replenishment this week; check root-zone moisture depth with a spade or probe.`,
          de: `${crop.names.de} (${stageLabelDe}) erhält auf ${farm.soilType}-Boden in dieser Woche kaum natürlichen Niederschlag; Durchwurzelungstiefe und Restfeuchte prüfen.`,
        },
        waterOrBudgetConsideration: {
          en: waterContextEn,
          de: waterContextDe,
        },
        uncertaintyOrMissing: {
          en: '7-day forecast does not predict full-season drought; stored winter/subsoil moisture is unknown without a field sample.',
          de: 'Die 7-Tage-Prognose erlaubt keine Aussage über die Gesamtsaison; reale Unterbodenfeuchte ist ohne Feldprobe unbekannt.',
        },
      });
    }

    // Candidate E: Humid canopy scouting (when persistent damp mild weather occurs)
    const humidMildDays = sevenDayStrip.filter(
      (d) => d.precipMm >= 2.0 && d.tempMaxC >= 11 && d.tempMaxC <= 25
    );
    if (humidMildDays.length >= 3 && candidateActions.length < 3) {
      candidateActions.push({
        id: 'act_humid_canopy_scout',
        triggerType: 'humid_canopy',
        priority: crop.id === 'potato' || crop.id === 'winter_wheat' ? 'moderate' : 'low',
        title: {
          en: `Scout ${crop.names.en} canopy during persistent damp weather`,
          de: `${crop.names.de}-Bestand bei anhaltend feuchter Witterung bonitieren`,
        },
        relevantDate: humidMildDays[0].date,
        forecastTrigger: {
          en: `${humidMildDays.length} of 7 days show ≥ 2 mm rain with mild temperatures (11–25 °C).`,
          de: `${humidMildDays.length} von 7 Tagen zeigen ≥ 2 mm Regen bei milden 11–25 °C.`,
        },
        reason: {
          en: `Repeated leaf-wetness periods can favor canopy stress in ${crop.names.en}. Conduct a visual field walk and check regional official advisory bulletins (Warndienst) before any intervention.`,
          de: `Wiederholte Blattnässephasen erfordern erhöhte Aufmerksamkeit im ${crop.names.de}-Bestand. Führen Sie eine Sichtkontrolle durch und beachten Sie den amtlichen Pflanzenschutz-Warndienst.`,
        },
        waterOrBudgetConsideration: {
          en: `Field scouting requires labor only and preserves your ${farm.currency} ${farm.budgetAmount.toLocaleString('en-US')} budget.`,
          de: `Eine Feldbonitur verursacht keine Mittelkosten und schont Ihr Budget (${farm.budgetAmount.toLocaleString('de-DE')} ${farm.currency}).`,
        },
        uncertaintyOrMissing: {
          en: 'Leaf wetness duration, cultivar resistance rating, and actual field symptoms are not observed; no disease diagnosis is made.',
          de: 'Blattnässedauer, Sortenresistenz und reale Symptome sind unbekannt; es erfolgt ausdrücklich keine Krankheitsdiagnose.',
        },
      });
    }

    // Ensure at least one grounded field check if weather is completely benign
    if (candidateActions.length === 0) {
      candidateActions.push({
        id: 'act_routine_stage_check',
        triggerType: 'routine_check',
        priority: 'low',
        title: {
          en: `Verify ${crop.names.en} growth stage and topsoil condition during calm 7-day window`,
          de: `BBCH-Stadium und Bodenzustand von ${crop.names.de} im ruhigen 7-Tage-Fenster prüfen`,
        },
        relevantDate: windowLabel,
        forecastTrigger: {
          en: `No extreme heat, frost, heavy rain, or acute dry trigger in ${windowLabel} (${total7dRain} mm rain).`,
          de: `Keine Hitze-, Frost-, Starkregen- oder Trockenwarnung im Zeitraum ${windowLabel} (${total7dRain} mm Regen).`,
        },
        reason: {
          en: `Moderate weather over the next 7 days provides a good window to confirm '${stageLabelEn}' stand uniformity on ${farm.areaHa} ha ${farm.soilType.toLowerCase()} soil.`,
          de: `Die ausgeglichene 7-Tage-Witterung eignet sich zur Kontrolle der Bestandesentwicklung (${stageLabelDe}) auf ${farm.areaHa} ha ${farm.soilType}-Boden.`,
        },
        waterOrBudgetConsideration: {
          en: waterContextEn,
          de: waterContextDe,
        },
        uncertaintyOrMissing: {
          en: isStageUncertainOrEstimated
            ? 'Growth stage has uncertainty; confirm actual BBCH stage and topsoil moisture in the field.'
            : 'In-field soil moisture and nutrient status (Nmin) are not connected.',
          de: isStageUncertainOrEstimated
            ? 'Entwicklungsstadium unsicher; bitte reales BBCH-Stadium und Bodenfeuchte vor Ort bestätigen.'
            : 'Lokale Bodenfeuchte- und Nmin-Messwerte sind nicht angebunden.',
        },
      });
    }
  }

  const priorityRank: Record<InSeasonActionItem['priority'], number> = {
    high: 0,
    moderate: 1,
    low: 2,
  };

  const topThreeActions = [...candidateActions]
    .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority])
    .slice(0, 3);

  return {
    evaluatedAt: new Date().toISOString(),
    plantedCropId: crop.id,
    plantedCropNames: crop.names,
    plantingDate: inputs.plantingDate,
    daysSincePlanting,
    selectedGrowthStage: inputs.growthStage,
    estimatedStageFromDate,
    isStageUncertainOrEstimated,
    stageStatusNote,
    waterBalance: {
      allocatedWaterM3,
      waterUsedM3: sanitizedUsedM3,
      remainingWaterM3,
      allocationExceededByM3,
      remainingWaterMmHa,
    },
    sevenDayStrip,
    candidateActions: topThreeActions,
    missingObservations,
    scopeDisclaimer: {
      en: '7-day DWD ICON / Open-Meteo weather supports near-term field checks only and is never treated as a full-season prediction. AgroVera never recommends changing an already-planted crop or applying unverified chemical/irrigation doses.',
      de: 'Die 7-Tage-Prognose (DWD ICON / Open-Meteo) dient ausschließlich kurzfristigen Bestandeskontrollen und ist keine Saisonvorhersage. AgroVera empfiehlt keinen Kulturwechsel nach der Saat und keine ungeprüften Pflanzenschutz- oder Wassermengen.',
    },
  };
}

/**
 * Deterministic validation gate for In-Season Care AI outputs.
 */
export function validateInSeasonAgentOutput(
  decision: InSeasonDecisionOutput,
  critic: InSeasonCriticOutput,
  plan: InSeasonDeterministicPlan
): ValidationGateResult {
  const checks: ValidationCheckItem[] = [];
  const failureReasonsBilingual: BilingualText[] = [];

  const validIds = new Set(plan.candidateActions.map((a) => a.id));
  const selectedIds = Array.isArray(decision.selectedActionIds)
    ? decision.selectedActionIds
    : [];
  const allSelectedValid =
    selectedIds.length > 0 &&
    selectedIds.length <= 3 &&
    selectedIds.every((id) => validIds.has(id));

  checks.push({
    code: 'CANDIDATE_ACTIONS_ONLY',
    label: {
      en: 'Decision Agent selected only deterministic candidate actions (≤ 3)',
      de: 'Entscheidungs-Agent wählte ausschließlich deterministische Maßnahmen (≤ 3)',
    },
    passed: allSelectedValid,
    detail: {
      en: allSelectedValid
        ? `Selected ${selectedIds.length} verified action ID(s): ${selectedIds.join(', ')}.`
        : `Invalid or empty action IDs returned: ${selectedIds.join(', ') || 'none'}.`,
      de: allSelectedValid
        ? `${selectedIds.length} geprüfte Maßnahmen-ID(s) gewählt: ${selectedIds.join(', ')}.`
        : `Ungültige oder leere Maßnahmen-IDs: ${selectedIds.join(', ') || 'keine'}.`,
    },
  });
  if (!allSelectedValid) {
    failureReasonsBilingual.push({
      en: 'Decision Agent referenced action IDs outside the deterministic candidate set.',
      de: 'Der Entscheidungs-Agent wählte Maßnahmen außerhalb der deterministischen Kandidatenliste.',
    });
  }

  const waterOk =
    plan.waterBalance.remainingWaterM3 >= 0 && critic.waterLimitRespected;
  checks.push({
    code: 'REMAINING_WATER_RESPECTED',
    label: {
      en: 'Remaining irrigation water cap respected (never negative or exceeded)',
      de: 'Verbleibendes Beregnungslimit eingehalten (keine Überschreitung)',
    },
    passed: waterOk,
    detail: {
      en: `Remaining allocation: ${plan.waterBalance.remainingWaterM3.toLocaleString('en-US')} m³ (waterLimitRespected=${critic.waterLimitRespected}).`,
      de: `Restkontingent: ${plan.waterBalance.remainingWaterM3.toLocaleString('de-DE')} m³ (Wasserlimit eingehalten=${critic.waterLimitRespected}).`,
    },
  });
  if (!waterOk) {
    failureReasonsBilingual.push({
      en: 'Critic flagged a remaining-irrigation constraint issue.',
      de: 'Der Prüf-Agent meldete einen Verstoß gegen das verbleibende Wasserkontingent.',
    });
  }

  const disclosuresOk =
    Array.isArray(decision.missingObservations) &&
    decision.missingObservations.length > 0 &&
    typeof decision.advisoryNotice === 'string' &&
    decision.advisoryNotice.trim().length >= 10;

  checks.push({
    code: 'MISSING_OBSERVATIONS_DISCLOSED',
    label: {
      en: 'Missing field observations and 7-day forecast scope disclosed',
      de: 'Fehlende Feldbeobachtungen und 7-Tage-Prognosegrenze benannt',
    },
    passed: disclosuresOk,
    detail: {
      en: disclosuresOk
        ? `${decision.missingObservations.length} missing observation(s) and advisory notice included.`
        : 'Missing field-observation disclosures or advisory notice.',
      de: disclosuresOk
        ? `${decision.missingObservations.length} fehlende Beobachtung(en) und Fachhinweis dokumentiert.`
        : 'Angaben zu fehlenden Feldbeobachtungen oder Beratungshinweis unvollständig.',
    },
  });
  if (!disclosuresOk) {
    failureReasonsBilingual.push({
      en: 'Decision Agent omitted missing field observations or advisory notice.',
      de: 'Fehlende Feldbeobachtungen oder Fachhinweis wurden ausgelassen.',
    });
  }

  const criticOk =
    critic.verdict !== 'reject' &&
    critic.onlyCandidateActionsUsed &&
    critic.noUnsupportedClaims;

  checks.push({
    code: 'IN_SEASON_CRITIC_AUDIT',
    label: {
      en: 'Independent Critic audit cleared (no unsupported yield/chemical/water claims)',
      de: 'Unabhängige Gegenprüfung bestanden (keine unbelegten Aussagen)',
    },
    passed: criticOk,
    detail: {
      en: `Critic verdict: ${critic.verdict.toUpperCase()} (noUnsupportedClaims=${critic.noUnsupportedClaims}).`,
      de: `Prüfurteil: ${critic.verdict.toUpperCase()} (keine unbelegten Aussagen=${critic.noUnsupportedClaims}).`,
    },
  });
  if (!criticOk) {
    failureReasonsBilingual.push({
      en: `Critic rejected in-season output: ${critic.criticSummary}`,
      de: `Prüf-Agent lehnte Ausgabe ab: ${critic.criticSummary}`,
    });
  }

  const passed = failureReasonsBilingual.length === 0;
  return {
    passed,
    requiresHumanReview:
      !passed ||
      critic.verdict === 'review' ||
      plan.isStageUncertainOrEstimated ||
      plan.waterBalance.remainingWaterM3 === 0,
    checks,
    failureReasons: failureReasonsBilingual.map((f) => f.en),
    failureReasonsBilingual,
  };
}
