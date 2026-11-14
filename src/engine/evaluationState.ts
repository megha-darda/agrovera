import type {
  AgenticEvaluationResponse,
  AppLanguage,
  ClimateScenarioId,
  EvaluationInputSnapshot,
  FarmProfile,
  ScenarioParametersOverride,
} from '../types/domain.ts';

export function cloneFarmProfile(farm: FarmProfile): FarmProfile {
  return {
    ...farm,
    customWeights: farm.customWeights ? { ...farm.customWeights } : undefined,
  };
}

export function cloneScenarioOverride(
  override?: ScenarioParametersOverride | null
): ScenarioParametersOverride | null {
  if (!override) return null;
  return { ...override };
}

/**
 * Deterministic canonical signature covering every input that affects
 * crop feasibility, weather lookup, scoring weights, or climate scenario.
 */
export function buildEvaluationSignature(
  farm: FarmProfile,
  scenarioId: ClimateScenarioId,
  scenarioOverride?: ScenarioParametersOverride | null
): string {
  return JSON.stringify({
    country: farm.country,
    loc: farm.locationName.trim(),
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
    weights: farm.customWeights
      ? {
          p: farm.customWeights.profit,
          c: farm.customWeights.climateResilience,
          w: farm.customWeights.waterEfficiency,
          s: farm.customWeights.soilMatch,
        }
      : null,
    scen: scenarioId,
    over: scenarioOverride
      ? {
          wd: scenarioOverride.waterDemandMultiplier ?? null,
          sr: scenarioOverride.seasonalRainfallMultiplier ?? null,
          hf: scenarioOverride.heatFactor ?? null,
          ff: scenarioOverride.frostFactor ?? null,
          df: scenarioOverride.droughtFactor ?? null,
          ef: scenarioOverride.excessRainFactor ?? null,
        }
      : null,
  });
}

export function createEvaluationInputSnapshot(
  farm: FarmProfile,
  scenarioId: ClimateScenarioId,
  scenarioOverride?: ScenarioParametersOverride | null,
  capturedAt: string = new Date().toISOString()
): EvaluationInputSnapshot {
  return {
    capturedAt,
    farm: cloneFarmProfile(farm),
    scenarioId,
    scenarioOverride: cloneScenarioOverride(scenarioOverride),
  };
}

export interface HistoricalEvaluationEntry {
  evaluationId: string;
  inputSignature: string;
  inputSnapshot: EvaluationInputSnapshot;
  markedOutdatedAt: string;
  outdatedReason: 'farm_or_scenario_changed' | 'superseded_by_new_run';
  response: AgenticEvaluationResponse;
}

export interface InFlightEvaluationRequest {
  requestSeq: number;
  evaluationId: string;
  inputSignature: string;
  inputSnapshot: EvaluationInputSnapshot;
  language: AppLanguage;
  startedAt: string;
}

export interface EvaluationTrackerState {
  activeInputSignature: string;
  activeEvaluation: AgenticEvaluationResponse | null;
  inFlightRequest: InFlightEvaluationRequest | null;
  nextRequestSeq: number;
  conditionsChangedSinceLastEvaluation: boolean;
  historicalEvaluations: HistoricalEvaluationEntry[];
}

export function createInitialEvaluationTracker(
  initialFarm: FarmProfile,
  initialScenarioId: ClimateScenarioId = 'baseline',
  initialOverride?: ScenarioParametersOverride | null
): EvaluationTrackerState {
  return {
    activeInputSignature: buildEvaluationSignature(
      initialFarm,
      initialScenarioId,
      initialOverride
    ),
    activeEvaluation: null,
    inFlightRequest: null,
    nextRequestSeq: 1,
    conditionsChangedSinceLastEvaluation: false,
    historicalEvaluations: [],
  };
}

function archiveEvaluationIfPresent(
  history: HistoricalEvaluationEntry[],
  evalToArchive: AgenticEvaluationResponse | null,
  reason: HistoricalEvaluationEntry['outdatedReason'],
  nowIso: string
): HistoricalEvaluationEntry[] {
  if (!evalToArchive) return history;
  const alreadyArchived = history.some(
    (h) => h.evaluationId === evalToArchive.evaluationId
  );
  if (alreadyArchived) return history;

  const entry: HistoricalEvaluationEntry = {
    evaluationId: evalToArchive.evaluationId,
    inputSignature: evalToArchive.inputSignature,
    inputSnapshot: {
      capturedAt: evalToArchive.inputSnapshot.capturedAt,
      farm: cloneFarmProfile(evalToArchive.inputSnapshot.farm),
      scenarioId: evalToArchive.inputSnapshot.scenarioId,
      scenarioOverride: cloneScenarioOverride(
        evalToArchive.inputSnapshot.scenarioOverride
      ),
    },
    markedOutdatedAt: nowIso,
    outdatedReason: reason,
    response: evalToArchive,
  };
  return [entry, ...history].slice(0, 6);
}

/**
 * Invoked immediately whenever location, coordinates, soil, area, planting month,
 * water, budget, priorities, or climate scenario/overrides change.
 * Immediately marks any prior active AI recommendation as outdated and archives it
 * for historical comparison only.
 */
export function invalidateEvaluationOnInputChange(
  state: EvaluationTrackerState,
  nextFarm: FarmProfile,
  nextScenarioId: ClimateScenarioId,
  nextOverride?: ScenarioParametersOverride | null,
  nowIso: string = new Date().toISOString()
): EvaluationTrackerState {
  const nextSig = buildEvaluationSignature(
    nextFarm,
    nextScenarioId,
    nextOverride
  );
  if (nextSig === state.activeInputSignature) {
    return state;
  }

  const hadPriorOrInFlight =
    state.activeEvaluation !== null ||
    state.inFlightRequest !== null ||
    state.conditionsChangedSinceLastEvaluation;

  const nextHistory = archiveEvaluationIfPresent(
    state.historicalEvaluations,
    state.activeEvaluation,
    'farm_or_scenario_changed',
    nowIso
  );

  // Any in-flight request for an older signature is invalidated immediately
  const stillMatchingInFlight =
    state.inFlightRequest && state.inFlightRequest.inputSignature === nextSig
      ? state.inFlightRequest
      : null;

  return {
    ...state,
    activeInputSignature: nextSig,
    activeEvaluation: null,
    inFlightRequest: stillMatchingInFlight,
    conditionsChangedSinceLastEvaluation: hadPriorOrInFlight,
    historicalEvaluations: nextHistory,
  };
}

/**
 * Registers a new outgoing AI evaluation request with an immutable input snapshot
 * and monotonic sequence number.
 */
export function beginEvaluationRequest(
  state: EvaluationTrackerState,
  farm: FarmProfile,
  scenarioId: ClimateScenarioId,
  language: AppLanguage,
  scenarioOverride?: ScenarioParametersOverride | null,
  nowIso: string = new Date().toISOString()
): {
  nextState: EvaluationTrackerState;
  request: InFlightEvaluationRequest;
} {
  const seq = state.nextRequestSeq;
  const sig = buildEvaluationSignature(farm, scenarioId, scenarioOverride);
  const snapshot = createEvaluationInputSnapshot(
    farm,
    scenarioId,
    scenarioOverride,
    nowIso
  );
  const evaluationId = `eval-${Date.now()}-${seq}`;

  const request: InFlightEvaluationRequest = {
    requestSeq: seq,
    evaluationId,
    inputSignature: sig,
    inputSnapshot: snapshot,
    language,
    startedAt: nowIso,
  };

  const syncedBase =
    sig !== state.activeInputSignature
      ? invalidateEvaluationOnInputChange(
          state,
          farm,
          scenarioId,
          scenarioOverride,
          nowIso
        )
      : state;

  return {
    request,
    nextState: {
      ...syncedBase,
      activeInputSignature: sig,
      inFlightRequest: request,
      nextRequestSeq: seq + 1,
    },
  };
}

/**
 * Handles an arriving API evaluation response.
 * Strictly ignores responses from older evaluations if the farm/scenario inputs
 * changed while the request was in flight or if a newer request superseded it.
 */
export function receiveEvaluationResponse(
  state: EvaluationTrackerState,
  request: InFlightEvaluationRequest,
  rawResponse: AgenticEvaluationResponse,
  nowIso: string = new Date().toISOString()
): {
  nextState: EvaluationTrackerState;
  acceptedAsActive: boolean;
  ignoredReason?: 'inputs_changed' | 'superseded_by_newer_request';
} {
  const stampedResponse: AgenticEvaluationResponse = {
    ...rawResponse,
    evaluationId: rawResponse.evaluationId || request.evaluationId,
    inputSignature: request.inputSignature,
    inputSnapshot: request.inputSnapshot,
    farm: cloneFarmProfile(request.inputSnapshot.farm),
    scenarioId: request.inputSnapshot.scenarioId,
  };

  // Reject for active state if current inputs no longer match the request's immutable snapshot
  if (request.inputSignature !== state.activeInputSignature) {
    const archivedHistory = archiveEvaluationIfPresent(
      state.historicalEvaluations,
      stampedResponse,
      'farm_or_scenario_changed',
      nowIso
    );
    return {
      acceptedAsActive: false,
      ignoredReason: 'inputs_changed',
      nextState: {
        ...state,
        historicalEvaluations: archivedHistory,
      },
    };
  }

  // Reject if a newer evaluation request was started after this one
  if (
    state.inFlightRequest &&
    request.requestSeq < state.inFlightRequest.requestSeq
  ) {
    return {
      acceptedAsActive: false,
      ignoredReason: 'superseded_by_newer_request',
      nextState: state,
    };
  }

  const nextHistory = archiveEvaluationIfPresent(
    state.historicalEvaluations,
    state.activeEvaluation,
    'superseded_by_new_run',
    nowIso
  );

  return {
    acceptedAsActive: true,
    nextState: {
      ...state,
      activeEvaluation: stampedResponse,
      inFlightRequest:
        state.inFlightRequest?.requestSeq === request.requestSeq
          ? null
          : state.inFlightRequest,
      conditionsChangedSinceLastEvaluation: false,
      historicalEvaluations: nextHistory,
    },
  };
}

export function failEvaluationRequest(
  state: EvaluationTrackerState,
  request: InFlightEvaluationRequest
): EvaluationTrackerState {
  if (state.inFlightRequest?.requestSeq !== request.requestSeq) {
    return state;
  }
  return {
    ...state,
    inFlightRequest: null,
  };
}
