import { DEFAULT_WEATHER_THRESHOLDS } from './presets.ts';
import type {
  BilingualText,
  ClimateRiskIndicator,
  DailyForecastPoint,
  GeocodingCandidate,
  WeatherForecastAnalysis,
  WeatherThresholds,
} from '../types/domain.ts';

const SCOPE_LIMITATION_NOTICE: BilingualText = {
  en: 'Near-term meteorological forecast only (7–14 days via Deutscher Wetterdienst ICON / Open-Meteo). Short-term weather forecasts guide immediate seedbed preparation and frost/downpour timing, and DO NOT predict rainfall or temperatures across an entire growing season. Use Scenario Analysis for hypothetical seasonal stress tests.',
  de: 'Ausschließlich kurzfristige Wettervorhersage (7–14 Tage über Deutscher Wetterdienst ICON / Open-Meteo). Kurzfristprognosen dienen der unmittelbaren Saatbett- und Bestellplanung, erlauben jedoch KEINE Aussage über den gesamten Vegetationsverlauf. Nutzen Sie die Szenarioanalyse für saisonale Stresstests.',
};

export interface OpenMeteoRawResponse {
  latitude?: number;
  longitude?: number;
  elevation?: number;
  timezone?: string;
  daily?: {
    time?: string[];
    temperature_2m_max?: Array<number | null>;
    temperature_2m_min?: Array<number | null>;
    precipitation_sum?: Array<number | null>;
    et0_fao_evapotranspiration?: Array<number | null>;
  };
}

function isCentralEuropeDwdDomain(lat: number, lon: number): boolean {
  return lat >= 45.0 && lat <= 56.0 && lon >= 4.0 && lon <= 18.0;
}

export function buildUnavailableWeatherAnalysis(
  locationLabel: string,
  coordinates: { latitude: number; longitude: number } | null,
  thresholds: WeatherThresholds = DEFAULT_WEATHER_THRESHOLDS,
  errorMessage: string = 'Weather forecast service unavailable.',
  errorMessageDe?: string
): WeatherForecastAnalysis {
  return {
    status: 'unavailable',
    providerModel: 'dwd-icon',
    source: 'Deutscher Wetterdienst (DWD ICON) via Open-Meteo API',
    sourceUrl: 'https://open-meteo.com/en/docs/dwd-api',
    fetchedAt: new Date().toISOString(),
    locationLabel: locationLabel || 'Unspecified Location',
    coordinates,
    forecastPeriod: null,
    thresholdsUsed: thresholds,
    daily: [],
    summary: null,
    riskIndicators: [],
    scopeLimitationNotice: SCOPE_LIMITATION_NOTICE,
    errorMessage,
    errorMessageBilingual: {
      en: errorMessage,
      de:
        errorMessageDe ??
        `Wetterdienst nicht erreichbar: ${errorMessage}`,
    },
  };
}

export function parseOpenMeteoForecast(
  raw: OpenMeteoRawResponse,
  locationLabel: string,
  thresholds: WeatherThresholds = DEFAULT_WEATHER_THRESHOLDS,
  providerModel: 'dwd-icon' | 'open-meteo-global' = 'dwd-icon'
): WeatherForecastAnalysis {
  const times = raw?.daily?.time;
  const maxTemps = raw?.daily?.temperature_2m_max;
  const minTemps = raw?.daily?.temperature_2m_min;
  const precips = raw?.daily?.precipitation_sum;
  const et0s = raw?.daily?.et0_fao_evapotranspiration;

  const sourceLabel =
    providerModel === 'dwd-icon'
      ? 'Deutscher Wetterdienst (DWD ICON) via Open-Meteo API'
      : 'Open-Meteo Global Forecast API';
  const sourceUrl =
    providerModel === 'dwd-icon'
      ? 'https://open-meteo.com/en/docs/dwd-api'
      : 'https://open-meteo.com/en/docs';

  if (
    !Array.isArray(times) ||
    times.length === 0 ||
    !Array.isArray(maxTemps) ||
    !Array.isArray(minTemps) ||
    !Array.isArray(precips)
  ) {
    return buildUnavailableWeatherAnalysis(
      locationLabel,
      typeof raw?.latitude === 'number' && typeof raw?.longitude === 'number'
        ? { latitude: raw.latitude, longitude: raw.longitude }
        : null,
      thresholds,
      'Weather API response lacked complete daily temperature or precipitation arrays.',
      'Die Wetter-API-Antwort enthielt unvollständige Tagesreihen für Temperatur oder Niederschlag.'
    );
  }

  const daily: DailyForecastPoint[] = [];
  for (let i = 0; i < times.length; i++) {
    const tMax = maxTemps[i];
    const tMin = minTemps[i];
    const precip = precips[i];
    const et0 = Array.isArray(et0s) ? et0s[i] : 0;

    if (
      typeof tMax !== 'number' ||
      Number.isNaN(tMax) ||
      typeof tMin !== 'number' ||
      Number.isNaN(tMin) ||
      typeof precip !== 'number' ||
      Number.isNaN(precip)
    ) {
      continue;
    }

    daily.push({
      date: times[i],
      tempMaxC: Number(tMax.toFixed(1)),
      tempMinC: Number(tMin.toFixed(1)),
      precipMm: Number(precip.toFixed(1)),
      et0Mm:
        typeof et0 === 'number' && !Number.isNaN(et0)
          ? Number(et0.toFixed(1))
          : 0,
    });
  }

  if (daily.length === 0) {
    return buildUnavailableWeatherAnalysis(
      locationLabel,
      typeof raw?.latitude === 'number' && typeof raw?.longitude === 'number'
        ? { latitude: raw.latitude, longitude: raw.longitude }
        : null,
      thresholds,
      'No valid numeric daily weather observations returned for these coordinates.',
      'Für diese Koordinaten wurden keine gültigen numerischen Wetterwerte geliefert.'
    );
  }

  const avgMaxTempC = Number(
    (daily.reduce((sum, d) => sum + d.tempMaxC, 0) / daily.length).toFixed(1)
  );
  const peakMaxTempC = Number(
    Math.max(...daily.map((d) => d.tempMaxC)).toFixed(1)
  );
  const lowestMinTempC = Number(
    Math.min(...daily.map((d) => d.tempMinC)).toFixed(1)
  );
  const totalPrecipMm = Number(
    daily.reduce((sum, d) => sum + d.precipMm, 0).toFixed(1)
  );
  const maxDailyPrecipMm = Number(
    Math.max(...daily.map((d) => d.precipMm)).toFixed(1)
  );
  const totalEt0Mm = Number(
    daily.reduce((sum, d) => sum + d.et0Mm, 0).toFixed(1)
  );

  const hotDaysCount = daily.filter(
    (d) => d.tempMaxC >= thresholds.heatDayMaxTempC
  ).length;
  const frostDaysCount = daily.filter(
    (d) => d.tempMinC <= thresholds.frostDayMinTempC
  ).length;
  const heavyRainDaysCount = daily.filter(
    (d) => d.precipMm >= thresholds.heavyRainDailyMm
  ).length;
  const isDryWindow = totalPrecipMm < thresholds.dryWindowTotalPrecipMm;

  const riskIndicators: ClimateRiskIndicator[] = [
    {
      id: 'heat',
      label: 'Near-Term Heat Stress',
      labelBilingual: {
        en: 'Near-Term Heat Stress (DWD Hot Days)',
        de: 'Kurzfristiger Hitzestress (Heiße Tage)',
      },
      severity:
        hotDaysCount >= 3 || peakMaxTempC >= thresholds.heatDayMaxTempC + 4
          ? 'high'
          : hotDaysCount >= 1
            ? 'moderate'
            : 'low',
      triggered: hotDaysCount > 0,
      observedMetric: `Peak ${peakMaxTempC} °C (${hotDaysCount}d ≥ ${thresholds.heatDayMaxTempC} °C)`,
      observedMetricBilingual: {
        en: `Peak ${peakMaxTempC} °C (${hotDaysCount}d ≥ ${thresholds.heatDayMaxTempC} °C)`,
        de: `Max. ${peakMaxTempC} °C (${hotDaysCount} Tg. ≥ ${thresholds.heatDayMaxTempC} °C)`,
      },
      thresholdMetric: `≥ ${thresholds.heatDayMaxTempC} °C`,
      affectedDays: hotDaysCount,
      explanation:
        hotDaysCount > 0
          ? `${hotDaysCount} forecast day(s) reach or exceed ${thresholds.heatDayMaxTempC} °C, elevating crop transpiration and seedbed moisture loss.`
          : `All ${daily.length} forecast days stay below ${thresholds.heatDayMaxTempC} °C (peak ${peakMaxTempC} °C).`,
      explanationBilingual: {
        en:
          hotDaysCount > 0
            ? `${hotDaysCount} forecast day(s) reach or exceed ${thresholds.heatDayMaxTempC} °C, elevating crop transpiration and seedbed moisture loss.`
            : `All ${daily.length} forecast days stay below ${thresholds.heatDayMaxTempC} °C (peak ${peakMaxTempC} °C).`,
        de:
          hotDaysCount > 0
            ? `${hotDaysCount} Vorhersagetag(e) erreichen oder überschreiten ${thresholds.heatDayMaxTempC} °C und erhöhen Verdunstungsanspruch sowie Keimwasserverlust.`
            : `Alle ${daily.length} Vorhersagetage bleiben unter der Hitzeschwelle von ${thresholds.heatDayMaxTempC} °C (Spitze ${peakMaxTempC} °C).`,
      },
    },
    {
      id: 'frost',
      label: 'Near-Term Frost Risk',
      labelBilingual: {
        en: 'Near-Term Frost Exposure (Frosttage)',
        de: 'Kurzfristiges Frostrisiko (Frosttage)',
      },
      severity:
        lowestMinTempC <= -3 || frostDaysCount >= 3
          ? 'high'
          : frostDaysCount >= 1
            ? 'moderate'
            : 'low',
      triggered: frostDaysCount > 0,
      observedMetric: `Min ${lowestMinTempC} °C (${frostDaysCount}d ≤ ${thresholds.frostDayMinTempC} °C)`,
      observedMetricBilingual: {
        en: `Min ${lowestMinTempC} °C (${frostDaysCount}d ≤ ${thresholds.frostDayMinTempC} °C)`,
        de: `Min. ${lowestMinTempC} °C (${frostDaysCount} Tg. ≤ ${thresholds.frostDayMinTempC} °C)`,
      },
      thresholdMetric: `≤ ${thresholds.frostDayMinTempC} °C`,
      affectedDays: frostDaysCount,
      explanation:
        frostDaysCount > 0
          ? `${frostDaysCount} night(s) drop to or below ${thresholds.frostDayMinTempC} °C (lowest ${lowestMinTempC} °C), posing frost injury risk for emerged spring crops.`
          : `Nighttime minimums remain above ${thresholds.frostDayMinTempC} °C (lowest ${lowestMinTempC} °C).`,
      explanationBilingual: {
        en:
          frostDaysCount > 0
            ? `${frostDaysCount} night(s) drop to or below ${thresholds.frostDayMinTempC} °C (lowest ${lowestMinTempC} °C), posing frost injury risk for emerged spring crops.`
            : `Nighttime minimums remain above ${thresholds.frostDayMinTempC} °C (lowest ${lowestMinTempC} °C).`,
        de:
          frostDaysCount > 0
            ? `An ${frostDaysCount} Nacht/Nächten sinkt das Minimum auf oder unter ${thresholds.frostDayMinTempC} °C (Tiefstwert ${lowestMinTempC} °C) — Frostgefahr für empfindliche Sommerungen.`
            : `Die nächtlichen Tiefstwerte bleiben über ${thresholds.frostDayMinTempC} °C (Minimum ${lowestMinTempC} °C).`,
      },
    },
    {
      id: 'dry_weather',
      label: 'Near-Term Dry Seedbed Window',
      labelBilingual: {
        en: 'Near-Term Dry Seedbed Window',
        de: 'Trockenes Bestellfenster (Niederschlagsdefizit)',
      },
      severity:
        totalPrecipMm < thresholds.dryWindowTotalPrecipMm * 0.35
          ? 'high'
          : isDryWindow
            ? 'moderate'
            : 'low',
      triggered: isDryWindow,
      observedMetric: `${totalPrecipMm} mm in ${daily.length}d`,
      observedMetricBilingual: {
        en: `${totalPrecipMm} mm in ${daily.length} days`,
        de: `${totalPrecipMm} mm in ${daily.length} Tagen`,
      },
      thresholdMetric: `< ${thresholds.dryWindowTotalPrecipMm} mm`,
      affectedDays: daily.filter((d) => d.precipMm < 1.0).length,
      explanation: isDryWindow
        ? `Cumulative ${daily.length}-day precipitation is ${totalPrecipMm} mm (< ${thresholds.dryWindowTotalPrecipMm} mm); germination depends on topsoil moisture reserves.`
        : `Forecast totals ${totalPrecipMm} mm over ${daily.length} days, providing adequate near-term topsoil moisture.`,
      explanationBilingual: {
        en: isDryWindow
          ? `Cumulative ${daily.length}-day precipitation is ${totalPrecipMm} mm (< ${thresholds.dryWindowTotalPrecipMm} mm); germination depends on topsoil moisture reserves.`
          : `Forecast totals ${totalPrecipMm} mm over ${daily.length} days, providing adequate near-term topsoil moisture.`,
        de: isDryWindow
          ? `Die Niederschlagssumme über ${daily.length} Tage beträgt nur ${totalPrecipMm} mm (< ${thresholds.dryWindowTotalPrecipMm} mm); der Feldaufgang hängt von der Restbodenfeuchte ab.`
          : `Die Vorhersage zeigt ${totalPrecipMm} mm über ${daily.length} Tage und unterstützt eine ausreichende Keimfeuchte im Oberboden.`,
      },
    },
    {
      id: 'heavy_rain',
      label: 'Near-Term Heavy Rainfall (Starkregen)',
      labelBilingual: {
        en: 'Near-Term Heavy Rainfall (Starkregen)',
        de: 'Kurzfristiges Starkregenrisiko',
      },
      severity:
        maxDailyPrecipMm >= thresholds.heavyRainDailyMm * 1.4 ||
        heavyRainDaysCount >= 2
          ? 'high'
          : heavyRainDaysCount >= 1
            ? 'moderate'
            : 'low',
      triggered: heavyRainDaysCount > 0,
      observedMetric: `Max ${maxDailyPrecipMm} mm/d (${heavyRainDaysCount}d ≥ ${thresholds.heavyRainDailyMm} mm)`,
      observedMetricBilingual: {
        en: `Max ${maxDailyPrecipMm} mm/d (${heavyRainDaysCount}d ≥ ${thresholds.heavyRainDailyMm} mm)`,
        de: `Max. ${maxDailyPrecipMm} mm/d (${heavyRainDaysCount} Tg. ≥ ${thresholds.heavyRainDailyMm} mm)`,
      },
      thresholdMetric: `≥ ${thresholds.heavyRainDailyMm} mm/d`,
      affectedDays: heavyRainDaysCount,
      explanation:
        heavyRainDaysCount > 0
          ? `${heavyRainDaysCount} day(s) reach ≥ ${thresholds.heavyRainDailyMm} mm/d, risking soil crusting, erosion, and limited field trafficability.`
          : `Peak daily rain is ${maxDailyPrecipMm} mm/d, below the ${thresholds.heavyRainDailyMm} mm Starkregen threshold.`,
      explanationBilingual: {
        en:
          heavyRainDaysCount > 0
            ? `${heavyRainDaysCount} day(s) reach ≥ ${thresholds.heavyRainDailyMm} mm/d, risking soil crusting, erosion, and limited field trafficability.`
            : `Peak daily rain is ${maxDailyPrecipMm} mm/d, below the ${thresholds.heavyRainDailyMm} mm Starkregen threshold.`,
        de:
          heavyRainDaysCount > 0
            ? `${heavyRainDaysCount} Tag(e) erreichen ≥ ${thresholds.heavyRainDailyMm} mm/d — Gefahr von Verschlämmung, Erosion und eingeschränkter Befahrbarkeit.`
            : `Das Tagesmaximum liegt bei ${maxDailyPrecipMm} mm/d und bleibt unter der Starkregenschwelle von ${thresholds.heavyRainDailyMm} mm.`,
      },
    },
  ];

  return {
    status: 'ok',
    providerModel,
    source: sourceLabel,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    locationLabel,
    coordinates: {
      latitude: typeof raw.latitude === 'number' ? raw.latitude : 0,
      longitude: typeof raw.longitude === 'number' ? raw.longitude : 0,
      elevationM: raw.elevation,
      timezone: raw.timezone || 'Europe/Berlin',
    },
    forecastPeriod: {
      startDate: daily[0].date,
      endDate: daily[daily.length - 1].date,
      days: daily.length,
    },
    thresholdsUsed: thresholds,
    daily,
    summary: {
      avgMaxTempC,
      peakMaxTempC,
      lowestMinTempC,
      totalPrecipMm,
      maxDailyPrecipMm,
      totalEt0Mm,
      hotDaysCount,
      frostDaysCount,
      heavyRainDaysCount,
    },
    riskIndicators,
    scopeLimitationNotice: SCOPE_LIMITATION_NOTICE,
  };
}

export async function fetchOpenMeteoWeather(
  params: {
    latitude: number;
    longitude: number;
    locationLabel: string;
    thresholds?: WeatherThresholds;
  },
  fetchImpl: typeof fetch = fetch
): Promise<WeatherForecastAnalysis> {
  const thresholds = params.thresholds ?? DEFAULT_WEATHER_THRESHOLDS;
  const { latitude, longitude, locationLabel } = params;

  if (
    typeof latitude !== 'number' ||
    Number.isNaN(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== 'number' ||
    Number.isNaN(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return buildUnavailableWeatherAnalysis(
      locationLabel,
      null,
      thresholds,
      'Valid latitude (-90 to 90) and longitude (-180 to 180) coordinates are required to retrieve real weather forecasts.',
      'Gültige Breiten- (-90 bis 90) und Längengrade (-180 bis 180) sind für den Abruf realer Wetterdaten erforderlich.'
    );
  }

  const useDwdIcon = isCentralEuropeDwdDomain(latitude, longitude);
  const endpoint = useDwdIcon
    ? 'https://api.open-meteo.com/v1/dwd-icon'
    : 'https://api.open-meteo.com/v1/forecast';

  const url = new URL(endpoint);
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set(
    'daily',
    'temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration'
  );
  url.searchParams.set('forecast_days', useDwdIcon ? '7' : '14');
  url.searchParams.set('timezone', useDwdIcon ? 'Europe/Berlin' : 'auto');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    const response = await fetchImpl(url.toString(), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);

    if (!response.ok) {
      return buildUnavailableWeatherAnalysis(
        locationLabel,
        { latitude, longitude },
        thresholds,
        `Weather API returned HTTP ${response.status} (${response.statusText || 'Forecast request failed'}).`,
        `Wetter-API meldete HTTP ${response.status} (${response.statusText || 'Anfrage fehlgeschlagen'}).`
      );
    }

    const json = (await response.json()) as OpenMeteoRawResponse;
    return parseOpenMeteoForecast(
      json,
      locationLabel,
      thresholds,
      useDwdIcon ? 'dwd-icon' : 'open-meteo-global'
    );
  } catch (err) {
    const message =
      err instanceof Error
        ? `Weather API network error: ${err.message}`
        : 'Weather request failed due to an unknown network error.';
    return buildUnavailableWeatherAnalysis(
      locationLabel,
      { latitude, longitude },
      thresholds,
      message,
      `Netzwerkfehler beim Wetterabruf: ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`
    );
  }
}

export async function geocodeLocationOpenMeteo(
  query: string,
  language: 'en' | 'de' = 'en',
  fetchImpl: typeof fetch = fetch
): Promise<GeocodingCandidate[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return [];
  }

  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', trimmed);
  url.searchParams.set('count', '8');
  url.searchParams.set('language', language);
  url.searchParams.set('format', 'json');

  const response = await fetchImpl(url.toString(), {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Geocoding API returned HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    results?: Array<{
      id: number;
      name: string;
      admin1?: string;
      country?: string;
      country_code?: string;
      latitude: number;
      longitude: number;
      elevation?: number;
      timezone?: string;
    }>;
  };

  if (!Array.isArray(data.results)) {
    return [];
  }

  // Prioritize German results at the top when matching, while keeping all valid hits selectable
  const sorted = [...data.results].sort((a, b) => {
    const aDe = a.country_code === 'DE' ? 0 : 1;
    const bDe = b.country_code === 'DE' ? 0 : 1;
    return aDe - bDe;
  });

  return sorted.map((item) => ({
    id: item.id,
    name: item.name,
    admin1: item.admin1,
    country: item.country ?? '',
    countryCode: item.country_code,
    latitude: Number(item.latitude.toFixed(4)),
    longitude: Number(item.longitude.toFixed(4)),
    elevation: item.elevation,
    timezone: item.timezone ?? 'Europe/Berlin',
  }));
}
