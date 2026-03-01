/**
 * Side-channel for passing image Files to ImageInputNode when a load_image
 * node is created from a canvas drop or clipboard paste. The canvas writes
 * the File here keyed by node ID; ImageInputNode consumes it on mount.
 */
export const pendingImageFiles = new Map<string, File>();
