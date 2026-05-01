export {
  default,
  Engine,
  migrate_document_json,
  needs_migration_json,
  types_compatible_standalone,
} from '../wasm-pkg/cascade_wasm';

export function initThreadPool(num_threads: number): Promise<void>;
export function rayon_num_threads(): number;
