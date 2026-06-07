/**
 * Custom MIME type for palette→canvas block drags. Shared by the drag SOURCE
 * (BlockPalette sets dataTransfer) and the drop TARGET (Canvas reads it) so the
 * two halves of the drag contract can never drift apart.
 */
export const BLOCK_DRAG_MIME = 'application/reddix-block';
