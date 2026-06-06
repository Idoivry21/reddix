import { getBlockSpec, getDefaultSettings } from './shared/commandBuilders';
import type { WorkbenchNode, WorkbenchNodeData } from './flowTypes';

/** Build a fresh canvas node for a block type at the given flow position. */
export function createBlockNode(
  blockType: string,
  position: { x: number; y: number },
  idSuffix: string | number
): WorkbenchNode {
  const spec = getBlockSpec(blockType);
  return {
    id: `${blockType}-${idSuffix}`,
    type: 'workbenchBlock',
    position,
    data: {
      blockType,
      label: spec.label,
      settings: getDefaultSettings(blockType),
      status: 'idle'
    } satisfies WorkbenchNodeData
  };
}
