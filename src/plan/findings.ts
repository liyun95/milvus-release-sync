import type { Finding } from '../core/types.js';

type FindingDetails = Record<string, unknown> | undefined;

function finding(
  severity: Finding['severity'],
  code: string,
  message: string,
  details?: FindingDetails
): Finding {
  return details === undefined
    ? { severity, code, message }
    : { severity, code, message, details };
}

export function plannedChange(
  code: string,
  message: string,
  details?: FindingDetails
): Finding {
  return finding('planned_change', code, message, details);
}

export function warning(code: string, message: string, details?: FindingDetails): Finding {
  return finding('warning', code, message, details);
}

export function blocker(code: string, message: string, details?: FindingDetails): Finding {
  return finding('blocker', code, message, details);
}
