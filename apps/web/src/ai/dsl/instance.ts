import { HandleMap } from './handleMap';

let sharedHandleMap: HandleMap | null = null;

export function getSharedHandleMap(): HandleMap {
  if (!sharedHandleMap) {
    sharedHandleMap = new HandleMap();
  }
  return sharedHandleMap;
}

export function resetSharedHandleMap(): void {
  sharedHandleMap = null;
}
