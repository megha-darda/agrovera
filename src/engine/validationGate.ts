import type {
  BilingualText,
  CriticAgentOutput,
  DecisionAgentOutput,
  SimulationRunOutput,
  ValidationCheckItem,
  ValidationGateResult,
  WeatherForecastAnalysis,
} from '../types/domain.ts';

/**
 * Deterministic application-level verification gate executed after
 * both the Decision Agent and independent Critic Agent complete.
 */
export function runDeterministicValidationGate(
  decision: DecisionAgentOutput,
  critic: CriticAgentOutput,
  simulation: SimulationRunOutput,
  weather: WeatherForecastAnalysis
): ValidationGateResult {
  const checks: ValidationCheckItem[] = [];
  const failureReasonsBilingual: BilingualText[] = [];

  const feasibleIds = new Set(
    simulation.cropResults
      .filter((c) => c.feasibilityStatus === 'feasible')
      .map((c) => c.cropId)
  );
  const uncertainIds = new Set(
    simulation.cropResults
      .filter((c) => c.feasibilityStatus === 'uncertain')
      .map((c) => c.cropId)
  );

  const chosenCrop =
    decision.recommendedCropId !== 'none'
      ? simulation.cropResults.find(
          (c) => c.cropId === decision.recommendedCropId
        ) ?? null
      : null;

  // 1. Hard Constraint & Feasibility Gate
  if (decision.recommendedCropId === 'none') {
    const noFeasibleJustified =
      feasibleIds.size === 0 || simulation.validation.valid === false;
    checks.push({
      code: 'NO_FEASIBLE_CONSISTENCY',
      label: {
        en: 'No-crop outcome matches feasibility state',
        de: 'Verzicht auf Kulturempfehlung entspricht Machbarkeitsstatus',
      },
      passed: noFeasibleJustified,
      detail: {
        en: noFeasibleJustified
          ? 'Decision rightly abstained when zero candidates are verified feasible.'
          : `Decision returned 'none' despite ${feasibleIds.size} feasible crop(s) existing.`,
        de: noFeasibleJustified
          ? 'Korrekte Zurückhaltung, da keine Kultur alle harten Restriktionen erfüllt.'
          : `'none' gewählt, obwohl ${feasibleIds.size} machbare Kultur(en) verfügbar sind.`,
      },
    });
    if (!noFeasibleJustified) {
      failureReasonsBilingual.push({
        en: `Decision abstained ('none') despite ${feasibleIds.size} feasible crop(s) satisfying all constraints.`,
        de: `Entscheidungs-Agent wählte 'none', obwohl ${feasibleIds.size} machbare Kultur(en) vorliegen.`,
      });
    }
  } else if (!chosenCrop) {
    checks.push({
      code: 'VALID_CANDIDATE_ID',
      label: {
        en: 'Recommended crop exists in German candidate set',
        de: 'Empfohlene Kultur ist im Kandidatensatz enthalten',
      },
      passed: false,
      detail: {
        en: `Recommended crop '${decision.recommendedCropId}' is not one of the four configured candidates.`,
        de: `Empfohlene Kultur '${decision.recommendedCropId}' gehört nicht zu den vier konfigurierten Kulturen.`,
      },
    });
    failureReasonsBilingual.push({
      en: `Recommended crop '${decision.recommendedCropId}' does not exist in simulation results.`,
      de: `Empfohlene Kultur '${decision.recommendedCropId}' existiert nicht im Simulationsergebnis.`,
    });
  } else {
    const isNotInfeasible = chosenCrop.feasibilityStatus !== 'infeasible';
    checks.push({
      code: 'HARD_CONSTRAINT_FEASIBILITY',
      label: {
        en: 'Recommended crop satisfies seasonal, water, and budget feasibility',
        de: 'Empfohlene Kultur erfüllt Saatzeit-, Wasser- und Budgetgrenzen',
      },
      passed: isNotInfeasible,
      detail: {
        en: isNotInfeasible
          ? `${chosenCrop.cropNames.en} status is '${chosenCrop.feasibilityStatus}'.`
          : `${chosenCrop.cropNames.en} is INFEASIBLE (${chosenCrop.infeasibilityReasons.join(' ')}).`,
        de: isNotInfeasible
          ? `Status von ${chosenCrop.cropNames.de}: '${chosenCrop.feasibilityStatus}'.`
          : `${chosenCrop.cropNames.de} ist NICHT MACHBAR (${chosenCrop.infeasibilityReasonsBilingual.map((r) => r.de).join(' ')}).`,
      },
    });
    if (!isNotInfeasible) {
      failureReasonsBilingual.push({
        en: `Decision Agent recommended infeasible crop '${chosenCrop.cropNames.en}': ${chosenCrop.infeasibilityReasons.join(' ')}`,
        de: `Entscheidungs-Agent empfahl nicht machbare Kultur '${chosenCrop.cropNames.de}': ${chosenCrop.infeasibilityReasonsBilingual.map((r) => r.de).join(' ')}`,
      });
    }

    // Explicit Supplemental Irrigation Constraint Check
    const waterOk = chosenCrop.waterEvaluation.satisfiesWaterConstraint;
    checks.push({
      code: 'WATER_HARD_CONSTRAINT',
      label: {
        en: 'Supplemental irrigation requirement within farm water volume (m³)',
        de: 'Zusatzbewässerungsbedarf innerhalb des verfügbaren Wasservolumens (m³)',
      },
      passed: waterOk,
      detail: {
        en: waterOk
          ? `${chosenCrop.cropNames.en} requires ${chosenCrop.waterEvaluation.additionalIrrigationRequiredM3.toLocaleString('en-US')} m³ vs ${chosenCrop.waterEvaluation.availableIrrigationTotalM3.toLocaleString('en-US')} m³ available.`
          : `${chosenCrop.cropNames.en} violates irrigation limit (${chosenCrop.waterEvaluation.additionalIrrigationRequiredM3} m³ > ${chosenCrop.waterEvaluation.availableIrrigationTotalM3} m³).`,
        de: waterOk
          ? `${chosenCrop.cropNames.de} benötigt ${chosenCrop.waterEvaluation.additionalIrrigationRequiredM3.toLocaleString('de-DE')} m³ gegenüber ${chosenCrop.waterEvaluation.availableIrrigationTotalM3.toLocaleString('de-DE')} m³ verfügbar.`
          : `${chosenCrop.cropNames.de} überschreitet das Wasserkontingent (${chosenCrop.waterEvaluation.additionalIrrigationRequiredM3} m³ > ${chosenCrop.waterEvaluation.availableIrrigationTotalM3} m³).`,
      },
    });
    if (!waterOk) {
      failureReasonsBilingual.push({
        en: `Irrigation constraint violation for ${chosenCrop.cropNames.en}.`,
        de: `Verletzung der Bewässerungsgrenze bei ${chosenCrop.cropNames.de}.`,
      });
    }

    // Explicit Budget Hard Constraint Check
    const budgetOk = chosenCrop.financialEvaluation.satisfiesBudgetConstraint;
    checks.push({
      code: 'BUDGET_HARD_CONSTRAINT',
      label: {
        en: 'Total farm input cost within available budget',
        de: 'Gesamte Direktkosten innerhalb des Anbaubudgets',
      },
      passed: budgetOk,
      detail: {
        en: budgetOk
          ? `${chosenCrop.cropNames.en} costs ${chosenCrop.financialEvaluation.currency} ${chosenCrop.financialEvaluation.totalFarmInputCost.toLocaleString('en-US')} vs ${chosenCrop.financialEvaluation.currency} ${chosenCrop.financialEvaluation.availableFarmBudget.toLocaleString('en-US')} budget.`
          : `${chosenCrop.cropNames.en} violates budget constraint (${chosenCrop.financialEvaluation.totalFarmInputCost} > ${chosenCrop.financialEvaluation.availableFarmBudget}).`,
        de: budgetOk
          ? `${chosenCrop.cropNames.de} kostet ${chosenCrop.financialEvaluation.totalFarmInputCost.toLocaleString('de-DE')} ${chosenCrop.financialEvaluation.currency} bei ${chosenCrop.financialEvaluation.availableFarmBudget.toLocaleString('de-DE')} ${chosenCrop.financialEvaluation.currency} Budget.`
          : `${chosenCrop.cropNames.de} überschreitet das Anbaubudget (${chosenCrop.financialEvaluation.totalFarmInputCost} > ${chosenCrop.financialEvaluation.availableFarmBudget}).`,
      },
    });
    if (!budgetOk) {
      failureReasonsBilingual.push({
        en: `Budget constraint violation for ${chosenCrop.cropNames.en}.`,
        de: `Verletzung der Budgetgrenze bei ${chosenCrop.cropNames.de}.`,
      });
    }

    // Seasonal Planting Check
    const seasonOk = chosenCrop.seasonalSuitability !== 'out_of_season';
    checks.push({
      code: 'SEASONAL_PLANTING_WINDOW',
      label: {
        en: 'Crop is seasonally appropriate for planned sowing month',
        de: 'Kultur passt zeitlich zum geplanten Aussaatmonat',
      },
      passed: seasonOk,
      detail: {
        en: seasonOk
          ? `${chosenCrop.cropNames.en} planting window (${chosenCrop.plantingWindowLabel.en}) is compatible.`
          : `${chosenCrop.cropNames.en} is out of season (${chosenCrop.plantingWindowLabel.en}).`,
        de: seasonOk
          ? `Saatfenster von ${chosenCrop.cropNames.de} (${chosenCrop.plantingWindowLabel.de}) ist eingehalten.`
          : `${chosenCrop.cropNames.de} liegt außerhalb des Saatfensters (${chosenCrop.plantingWindowLabel.de}).`,
      },
    });
    if (!seasonOk) {
      failureReasonsBilingual.push({
        en: `Seasonal planting violation for ${chosenCrop.cropNames.en}.`,
        de: `Verletzung des Aussaatzeitraums bei ${chosenCrop.cropNames.de}.`,
      });
    }

    if (chosenCrop.feasibilityStatus === 'uncertain' && feasibleIds.size > 0) {
      checks.push({
        code: 'PREFER_VERIFIED_FEASIBLE',
        label: {
          en: 'Verified feasible crop prioritized over uncertain crop',
          de: 'Geprüft machbare Kultur gegenüber unsicherer Kultur bevorzugt',
        },
        passed: false,
        detail: {
          en: `${chosenCrop.cropNames.en} is uncertain while verified feasible options exist.`,
          de: `${chosenCrop.cropNames.de} ist unsicher, obwohl geprüfte Alternativen vorliegen.`,
        },
      });
      failureReasonsBilingual.push({
        en: `Recommended uncertain crop '${chosenCrop.cropNames.en}' when verified feasible crops exist.`,
        de: `Unsichere Kultur '${chosenCrop.cropNames.de}' empfohlen, obwohl machbare Kulturen existieren.`,
      });
    }
  }

  // 2. Alternative Comparison Completeness
  const comparedCount = decision.alternativeComparisons?.length ?? 0;
  const alternativesAddressed =
    decision.recommendedCropId === 'none'
      ? comparedCount >= 2
      : comparedCount >= 3;
  checks.push({
    code: 'ALTERNATIVES_COMPARED',
    label: {
      en: 'Alternative candidate crops explicitly compared',
      de: 'Alle Alternativkulturen nachvollziehbar verglichen',
    },
    passed: alternativesAddressed,
    detail: {
      en: `${comparedCount} alternative crop trade-off comparison(s) documented.`,
      de: `${comparedCount} Alternativkulturen im Abwägungsvergleich dokumentiert.`,
    },
  });
  if (!alternativesAddressed) {
    failureReasonsBilingual.push({
      en: 'Decision Agent did not compare all alternative crop candidates.',
      de: 'Der Entscheidungs-Agent hat nicht alle Alternativkulturen verglichen.',
    });
  }

  // 3. Assumptions, Uncertainty & Human Review Disclosures
  const disclosuresPresent =
    Array.isArray(decision.keyAssumptions) &&
    decision.keyAssumptions.length > 0 &&
    Array.isArray(decision.missingInformation) &&
    decision.missingInformation.length > 0 &&
    typeof decision.humanReviewNotice === 'string' &&
    decision.humanReviewNotice.trim().length >= 12;

  checks.push({
    code: 'UNCERTAINTY_AND_SAFETY_DISCLOSURE',
    label: {
      en: 'Assumptions, missing data, and human-review notice included',
      de: 'Annahmen, fehlende Ortsdaten und Fachberatungshinweis dokumentiert',
    },
    passed: disclosuresPresent,
    detail: {
      en: disclosuresPresent
        ? `${decision.keyAssumptions.length} assumption(s), ${decision.missingInformation.length} missing-info item(s), and human review notice verified.`
        : 'Missing explicit assumptions, missing-information disclosures, or human-review requirement.',
      de: disclosuresPresent
        ? `${decision.keyAssumptions.length} Annahme(n), ${decision.missingInformation.length} Datenlücke(n) und Beratungshinweis vorhanden.`
        : 'Pflichtangaben zu Annahmen, fehlenden Daten oder menschlicher Fachprüfung fehlen.',
    },
  });
  if (!disclosuresPresent) {
    failureReasonsBilingual.push({
      en: 'Decision Agent omitted required assumptions, missing information, or human-review notice.',
      de: 'Pflichtangaben zu Annahmen, Datenlücken oder Fachberatung fehlen.',
    });
  }

  // 4. Independent Critic Agent Verdict Check
  const criticAccepted =
    critic.verdict !== 'reject' &&
    critic.hardConstraintsSatisfied &&
    critic.numericalClaimsSupported;

  checks.push({
    code: 'INDEPENDENT_CRITIC_VERDICT',
    label: {
      en: 'Independent Gemini Carbon Critic audit cleared',
      de: 'Unabhängige Gemini-Carbon-Gegenprüfung bestanden',
    },
    passed: criticAccepted,
    detail: {
      en: `Critic verdict: ${critic.verdict.toUpperCase()} (hardConstraints=${critic.hardConstraintsSatisfied}, supportedNumbers=${critic.numericalClaimsSupported}).`,
      de: `Prüfergebnis: ${critic.verdict.toUpperCase()} (Restriktionen=${critic.hardConstraintsSatisfied}, Zahlenbeleg=${critic.numericalClaimsSupported}).`,
    },
  });
  if (!criticAccepted) {
    const criticalObjs = critic.objections
      .filter((o) => o.severity === 'critical' || o.severity === 'warning')
      .map((o) => o.detail)
      .join(' | ');
    failureReasonsBilingual.push({
      en: `Critic Agent flagged recommendation (${critic.verdict}): ${criticalObjs || critic.criticSummary}`,
      de: `Prüf-Agent beanstandete Empfehlung (${critic.verdict}): ${criticalObjs || critic.criticSummary}`,
    });
  }

  const failureReasons = failureReasonsBilingual.map((f) => f.en);
  const passed = failureReasonsBilingual.length === 0;

  const requiresHumanReview =
    !passed ||
    critic.verdict === 'review' ||
    weather.status === 'unavailable' ||
    feasibleIds.size === 0 ||
    (chosenCrop !== null && uncertainIds.has(chosenCrop.cropId));

  return {
    passed,
    requiresHumanReview,
    checks,
    failureReasons,
    failureReasonsBilingual,
  };
}
