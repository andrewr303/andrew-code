/**
 * `fusion` domain — exact-version model and effort selection.
 *
 * Resolves configured aliases through `kosong/model` without choosing a
 * similarly named version or silently clamping an explicitly requested effort.
 */
import type { IModelCatalog, Model } from '#/kosong/model/catalog';
import { fusionError } from './fusionTeam';
import { Error2, ErrorCodes } from '#/errors';

export class FusionModelMissingError extends Error2 {
  constructor(requested: string) {
    super(ErrorCodes.VALIDATION_FAILED, `Fusion: model "${requested}" is not configured. Configure this exact model or a [fusion] alias.`);
  }
}

function identity(value: string): string {
  return value.toLowerCase().replace(/^.*\//, '').replace(/^claude[- ]/, '').replaceAll(/[^a-z0-9]/g, '');
}
export async function resolveFusionModel(catalog: IModelCatalog, requested: string, effort: string): Promise<Model> {
  let exact: Model | undefined;
  try {
    exact = catalog.get(requested);
  } catch {
    exact = undefined;
  }
  if (exact !== undefined) return validateEffort(exact, effort);
  const candidates = new Set(catalog.findByName(requested));
  const wanted = identity(requested);
  for (const item of await catalog.listModels()) {
    if (item.model === requested || identity(item.model) === wanted || (item.display_name !== undefined && identity(item.display_name) === wanted)) candidates.add(item.model);
    let model: Model;
    try {
      model = catalog.get(item.model);
    } catch {
      continue;
    }
    if ([model.id, model.name, model.displayName, ...model.aliases].some((name) => name !== undefined && identity(name) === wanted)) {
      candidates.add(model.id);
    }
  }
  if (candidates.size === 0) throw new FusionModelMissingError(requested);
  if (candidates.size !== 1) {
    throw fusionError(`model "${requested}" is ambiguous (${[...candidates].join(', ')}). Set an exact catalog alias in [fusion].`);
  }
  return validateEffort(catalog.get([...candidates][0]!), effort);
}
function validateEffort(model: Model, effort: string): Model {
  if (!model.supportEfforts?.includes(effort)) {
    throw fusionError(`model "${model.id}" does not declare support for effort "${effort}" (supported: ${model.supportEfforts?.join(', ') ?? 'none'}). Configure a supported effort explicitly.`);
  }
  return model;
}
