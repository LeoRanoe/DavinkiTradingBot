export type ResearchSplit = "DEVELOPMENT" | "VALIDATION" | "HOLDOUT";
export type ChronologicalSplit<T> = { development: T[]; validation: T[]; holdout: T[] };

/** Time-series split only: inputs retain chronological order and are never shuffled. */
export function splitChronologically<T>(rows: T[], developmentRatio = 0.6, validationRatio = 0.2): ChronologicalSplit<T> {
  if (developmentRatio <= 0 || validationRatio <= 0 || developmentRatio + validationRatio >= 1) throw new Error("Splits must leave a non-empty holdout proportion.");
  const developmentEnd = Math.floor(rows.length * developmentRatio);
  const validationEnd = developmentEnd + Math.floor(rows.length * validationRatio);
  return { development: rows.slice(0, developmentEnd), validation: rows.slice(developmentEnd, validationEnd), holdout: rows.slice(validationEnd) };
}

export type ExperimentDraft = { baseStrategyVersionId: string; experimentalVersionLabel: string; changedParameters: Record<string, unknown>; hypothesisId: string; developmentRange: [number, number]; validationRange: [number, number]; holdoutRange: [number, number] };

export function validateExperimentDraft(draft: ExperimentDraft): ExperimentDraft {
  if (draft.experimentalVersionLabel.toLowerCase() === "v1") throw new Error("V1 is immutable; experiments require a new version label.");
  if (!Object.keys(draft.changedParameters).length) throw new Error("An experiment must record a concrete parameter change.");
  const [dStart, dEnd] = draft.developmentRange; const [vStart, vEnd] = draft.validationRange; const [hStart, hEnd] = draft.holdoutRange;
  if (!(dStart < dEnd && dEnd <= vStart && vStart < vEnd && vEnd <= hStart && hStart < hEnd)) throw new Error("Research ranges must be chronological and non-overlapping.");
  return draft;
}

export function walkForwardWindows<T>(rows: T[], developmentSize: number, validationSize: number): Array<{ development: T[]; validation: T[] }> {
  if (developmentSize <= 0 || validationSize <= 0) throw new Error("Window sizes must be positive.");
  const windows: Array<{ development: T[]; validation: T[] }> = [];
  for (let start = 0; start + developmentSize + validationSize <= rows.length; start += validationSize) windows.push({ development: rows.slice(start, start + developmentSize), validation: rows.slice(start + developmentSize, start + developmentSize + validationSize) });
  return windows;
}
