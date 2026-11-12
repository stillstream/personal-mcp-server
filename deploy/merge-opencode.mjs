import { modelConfig } from '../src/instance-config.mjs';

// Project only user-owned model settings into an isolated Gateway runtime profile.
// The user OpenCode config remains the sole authoritative source.
export async function mergeInstanceModels(original, instance, target, container) {
  const profile = await modelConfig(instance, target, container);
  const merged = structuredClone(original);
  for (const key of ['provider', 'model', 'small_model']) {
    if (Object.hasOwn(profile, key)) merged[key] = structuredClone(profile[key]);
    else delete merged[key];
  }
  return merged;
}
