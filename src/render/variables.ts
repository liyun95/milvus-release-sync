export type VariablesPlanInput = {
  variablesJson: string;
  releaseVersion: string;
  sdkValues: Record<string, string>;
  releaseTemplates: Record<string, string>;
};

export function planVariables(
  input: VariablesPlanInput
): { after: string; changedKeys: string[] } {
  const parsed = JSON.parse(input.variablesJson) as unknown;
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new TypeError('Variables.json must contain a JSON object.');
  }

  const variables = parsed as Record<string, unknown>;
  const desired: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(input.releaseTemplates).map(([key, template]) => [
        key,
        template.replaceAll('{version}', input.releaseVersion)
      ])
    ),
    ...input.sdkValues
  };
  const changedKeys: string[] = [];

  for (const key of Object.keys(variables)) {
    if (Object.hasOwn(desired, key) && variables[key] !== desired[key]) {
      variables[key] = desired[key];
      changedKeys.push(key);
    }
  }

  for (const [key, value] of Object.entries(desired)) {
    if (!Object.hasOwn(variables, key)) {
      variables[key] = value;
      changedKeys.push(key);
    }
  }

  return {
    after: JSON.stringify(variables, null, 2) + '\n',
    changedKeys
  };
}
