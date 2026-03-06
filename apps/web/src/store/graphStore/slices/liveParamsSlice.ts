import type { StateCreator } from 'zustand';
import type { GraphState } from '../store';
import type { ParamValue } from '../../types';
import {
  setParamLive as ctrlSetParamLive,
  commitParamEdit,
  setInputDefaultLive as ctrlSetInputDefaultLive,
  commitInputDefault,
} from '../paramController';

// ---------------------------------------------------------------------------
// Slice interface
// ---------------------------------------------------------------------------

export interface LiveParamsSliceActions {
  setParamLive: (nodeId: string, key: string, value: ParamValue) => Promise<void>;
  setParamCommit: (nodeId: string, key: string, value: ParamValue) => Promise<void>;
  setInputDefaultLive: (nodeId: string, portName: string, value: ParamValue) => Promise<void>;
  setInputDefaultCommit: (nodeId: string, portName: string, value: ParamValue) => Promise<void>;
}

export type LiveParamsSlice = LiveParamsSliceActions;

// ---------------------------------------------------------------------------
// Slice creator
// ---------------------------------------------------------------------------

export const createLiveParamsSlice: StateCreator<
  GraphState,
  [['zustand/devtools', never]],
  [],
  LiveParamsSlice
> = (set, get) => {
  return {
    setParamLive: async (nodeId, key, value) => {
      ctrlSetParamLive(nodeId, key, value, get, set);
    },

    setParamCommit: async (nodeId, key, value) => {
      await commitParamEdit(nodeId, key, value, get, set);
    },

    setInputDefaultLive: async (nodeId, portName, value) => {
      ctrlSetInputDefaultLive(nodeId, portName, value, get, set);
    },

    setInputDefaultCommit: async (nodeId, portName, value) => {
      await commitInputDefault(nodeId, portName, value, get, set);
    },
  };
};
