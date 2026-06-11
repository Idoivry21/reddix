import { getBlockSpec, getDefaultSettings } from './shared/commandBuilders';
import type { WorkbenchNode } from './flowTypes';

/** Build a fresh canvas node for a block type at the given canvas position. */
export function createBlockNode(
  blockType: string,
  position: { x: number; y: number },
  idSuffix: string | number
): WorkbenchNode {
  const spec = getBlockSpec(blockType);
  return {
    id: `${blockType}-${idSuffix}`,
    blockType,
    label: spec.label,
    x: position.x,
    y: position.y,
    settings: getDefaultSettings(blockType),
    status: 'idle'
  };
}
