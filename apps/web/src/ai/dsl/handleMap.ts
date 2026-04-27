const HANDLE_ALIASES: Record<string, string> = {
  load_image: 'load',
  load_image_sequence: 'seq',
  viewer: 'viewer',
  export_image: 'export',
  export_image_sequence: 'export_seq',
  gaussian_blur: 'blur',
  'gpu_kernel::brightness_contrast': 'grade',
  'gpu_kernel::hue_saturation': 'huesat',
  'gpu_kernel::color_balance': 'balance',
  'gpu_kernel::alpha_over': 'over',
  'gpu_kernel::blend': 'blend',
  solid_color: 'solid',
  'gpu_kernel::channel_shuffle': 'shuffle',
  'gpu_kernel::extract_channel': 'extract',
  'gpu_kernel::pixelate': 'pixelate',
};

const HANDLE_REGEX = /^[a-z][a-z0-9_]*$/;

const normalizePrefix = (prefix: string): string => {
  const cleaned = prefix.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+/, '');
  if (cleaned.length === 0 || !/^[a-z]/.test(cleaned)) {
    return 'node';
  }
  return cleaned;
};

const getPrefixForType = (typeId: string): string => {
  // gpu_script typeIds are uuid-based (gpu_script::uuid); always use 'gpu'
  if (typeId.startsWith('gpu_script')) return 'gpu';
  if (typeId in HANDLE_ALIASES) {
    return HANDLE_ALIASES[typeId];
  }
  // For namespaced types like 'gpu_kernel::pixelate', use the part after '::'
  const baseName = typeId.includes('::') ? typeId.split('::').pop() ?? typeId : typeId;
  const firstWord = baseName.split('_')[0] ?? 'node';
  return normalizePrefix(firstWord);
};

const parseHandleSuffix = (handle: string): { prefix: string; suffix: number } | null => {
  const match = handle.match(/^([a-z][a-z0-9_]*?)(\d+)$/);
  if (!match) return null;
  return { prefix: match[1], suffix: Number(match[2]) };
};

export class HandleMap {
  private nodeIdToHandle: Map<string, string>;
  private handleToNodeId: Map<string, string>;
  private usedPrefixes: Map<string, number>;

  constructor() {
    this.nodeIdToHandle = new Map();
    this.handleToNodeId = new Map();
    this.usedPrefixes = new Map();
  }

  getOrCreate(nodeId: string, typeId: string): string {
    return this.getOrCreateWithBase(nodeId, getPrefixForType(typeId));
  }

  getOrCreateWithBase(nodeId: string, base: string): string {
    const existing = this.nodeIdToHandle.get(nodeId);
    if (existing) return existing;

    const prefix = normalizePrefix(base);
    const nextSuffix = this.usedPrefixes.get(prefix) ?? 1;
    let suffix = nextSuffix;
    let handle = `${prefix}${suffix}`;

    while (this.handleToNodeId.has(handle) || !HANDLE_REGEX.test(handle)) {
      suffix += 1;
      handle = `${prefix}${suffix}`;
    }

    this.usedPrefixes.set(prefix, suffix + 1);
    this.set(handle, nodeId);
    return handle;
  }

  getHandle(nodeId: string): string | undefined {
    return this.nodeIdToHandle.get(nodeId);
  }

  getNodeId(handle: string): string | undefined {
    return this.handleToNodeId.get(handle);
  }

  set(handle: string, nodeId: string): void {
    if (!HANDLE_REGEX.test(handle)) {
      throw new Error(`Invalid handle: ${handle}`);
    }

    const existingNodeId = this.handleToNodeId.get(handle);
    if (existingNodeId && existingNodeId !== nodeId) {
      this.nodeIdToHandle.delete(existingNodeId);
    }

    const existingHandle = this.nodeIdToHandle.get(nodeId);
    if (existingHandle && existingHandle !== handle) {
      this.handleToNodeId.delete(existingHandle);
    }

    this.handleToNodeId.set(handle, nodeId);
    this.nodeIdToHandle.set(nodeId, handle);

    const parsed = parseHandleSuffix(handle);
    if (parsed) {
      const current = this.usedPrefixes.get(parsed.prefix) ?? 1;
      if (parsed.suffix >= current) {
        this.usedPrefixes.set(parsed.prefix, parsed.suffix + 1);
      }
    }
  }

  removeByNodeId(nodeId: string): void {
    const handle = this.nodeIdToHandle.get(nodeId);
    if (!handle) return;
    this.nodeIdToHandle.delete(nodeId);
    this.handleToNodeId.delete(handle);
  }

  removeByHandle(handle: string): void {
    const nodeId = this.handleToNodeId.get(handle);
    if (!nodeId) return;
    this.handleToNodeId.delete(handle);
    this.nodeIdToHandle.delete(nodeId);
  }

  hasHandle(handle: string): boolean {
    return this.handleToNodeId.has(handle);
  }

  hasNodeId(nodeId: string): boolean {
    return this.nodeIdToHandle.has(nodeId);
  }

  entries(): [string, string][] {
    return Array.from(this.handleToNodeId.entries());
  }

  clear(): void {
    this.nodeIdToHandle.clear();
    this.handleToNodeId.clear();
    this.usedPrefixes.clear();
  }
}
