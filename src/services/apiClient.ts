import type {
  AgenticEvaluationResponse,
  AppLanguage,
  BaselineReferenceContext,
  ClimateScenarioId,
  FarmProfile,
  GeocodingCandidate,
  ScenarioParametersOverride,
  WeatherForecastAnalysis,
  WeatherThresholds,
} from '../types/domain.ts';

export interface ServerConfigStatus {
  geminiKeyConfigured: boolean;
  models: {
    orchestrator: string;
    decisionAgent: string;
    criticAgent: string;
  };
  weatherSource: string;
}

export async function fetchServerConfigStatus(): Promise<ServerConfigStatus> {
  const response = await fetch('/api/config-status');
  if (!response.ok) {
    throw new Error(`Failed to check server status (HTTP ${response.status})`);
  }
  return (await response.json()) as ServerConfigStatus;
}

export async function searchLocations(
  query: string,
  language: AppLanguage = 'en'
): Promise<GeocodingCandidate[]> {
  const response = await fetch(
    `/api/geocode?q=${encodeURIComponent(query.trim())}&lang=${encodeURIComponent(language)}`
  );
  const data = (await response.json()) as {
    results?: GeocodingCandidate[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || `Geocoding failed (HTTP ${response.status})`);
  }
  return data.results ?? [];
}

export async function fetchLiveWeatherForecast(params: {
  latitude: number;
  longitude: number;
  locationLabel: string;
  thresholds: WeatherThresholds;
}): Promise<WeatherForecastAnalysis> {
  const response = await fetch('/api/weather', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    throw new Error(`Weather API endpoint returned HTTP ${response.status}`);
  }
  return (await response.json()) as WeatherForecastAnalysis;
}

export async function runFullAgenticEvaluation(params: {
  farm: FarmProfile;
  scenarioId: ClimateScenarioId;
  scenarioOverride?: ScenarioParametersOverride;
  weatherThresholds: WeatherThresholds;
  language: AppLanguage;
  baselineComparison?: BaselineReferenceContext;
}): Promise<AgenticEvaluationResponse> {
  const response = await fetch('/api/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = (await response.json()) as AgenticEvaluationResponse & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(
      data.error || `Evaluation pipeline failed (HTTP ${response.status})`
    );
  }

  return data;
}
