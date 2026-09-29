/**
 * `hashline` domain — `HashlineFeature`: hash-anchored edits assembled as
 * one App-scope Feature unit.
 *
 * Contributes the per-Agent `HashEdit` agent tool through the `features`
 * base-class seam; retracting the unit withdraws it across the scope tree.
 * The pure hash helpers (`hash.ts`) and the Read tool's opt-in `hashline`
 * rendering stay on their static channels — Read is a core tool, and the
 * hash functions are dependency-free. No config surface, no wire
 * vocabulary. Registered into the feature table at import.
 */

import { Feature } from '#/features/feature';
import { registerFeature } from '#/features/featureRegistry';

import { IHashEditTool } from './tools/hash-edit/hash-edit';
import { HashEditTool } from './tools/hash-edit/hashEditTool';

export class HashlineFeature extends Feature {
  static override readonly name = 'hashline';

  constructor() {
    super();
    this.contributeTool(IHashEditTool, HashEditTool, { name: 'HashEdit', domain: 'edit' });
  }
}

registerFeature(HashlineFeature);
