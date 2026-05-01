import React from 'react';
import {
  Image, Images,
  FileVideo,
  Eye,
  Download,
  FileOutput, FolderOutput,
  SunMedium,
  Palette,
  CircleOff,
  SlidersHorizontal,
  Spline,
  Scale,
  Shuffle,
  Binary,
  Grid2x2,
  Sun,
  Paintbrush,
  SplitSquareVertical,
  Merge,
  Pipette,
  Sparkles,
  CircleDot,
  Maximize2,
  Scan,
  Plus,
  Minus,
  AlignCenter,
  Zap,
  Layers,
  BlendIcon,
  Move,
  Crop,
  FlipHorizontal2,
  RotateCw,
  Scaling,
  Square,
  AudioWaveform,
  Rainbow,
  CheckSquare2,
  Hexagon,
  Circle,
  Lock,
  Unlock,
  ShieldPlus,
  SeparatorVertical,
  Scissors,
  Eraser,
  Shapes,
  ArrowLeftRight,
  Calculator,
  Cpu,
  Filter,
  Box,
  BrainCircuit,
  Film,
} from 'lucide-react';

const ICON_SIZE = 12;

const NODE_ICON_MAP: Record<string, React.ReactElement> = {
  // ── Input ──
  load_image: <Image size={ICON_SIZE} />,
  load_image_sequence: <FileVideo size={ICON_SIZE} />,
  load_video: <Film size={ICON_SIZE} />,

  load_image_batch: <Images size={ICON_SIZE} />,
  // ── Output ──
  viewer: <Eye size={ICON_SIZE} />,
  compare_viewer: <Eye size={ICON_SIZE} />,
  export_image: <Download size={ICON_SIZE} />,
  export_image_sequence: <FileOutput size={ICON_SIZE} />,
  export_video: <FileVideo size={ICON_SIZE} />,

  export_image_batch: <FolderOutput size={ICON_SIZE} />,
  // ── Color ──
  'gpu_kernel::brightness_contrast': <SunMedium size={ICON_SIZE} />,
  'gpu_kernel::hue_saturation': <Palette size={ICON_SIZE} />,
  'gpu_kernel::invert': <CircleOff size={ICON_SIZE} />,
  'gpu_kernel::levels': <SlidersHorizontal size={ICON_SIZE} />,
  curves: <Spline size={ICON_SIZE} />,
  'gpu_kernel::color_balance': <Scale size={ICON_SIZE} />,
  'gpu_kernel::channel_shuffle': <Shuffle size={ICON_SIZE} />,
  'gpu_kernel::threshold': <Binary size={ICON_SIZE} />,
  'gpu_kernel::posterize': <Grid2x2 size={ICON_SIZE} />,
  'gpu_kernel::gamma': <Sun size={ICON_SIZE} />,
  color_ramp: <Paintbrush size={ICON_SIZE} />,
  'gpu_kernel::two_color_map': <Paintbrush size={ICON_SIZE} />,
  color_palette: <Palette size={ICON_SIZE} />,
  separate_hsva: <SplitSquareVertical size={ICON_SIZE} />,
  combine_hsva: <Merge size={ICON_SIZE} />,
  color_convert: <Pipette size={ICON_SIZE} />,
  'gpu_kernel::white_balance': <Pipette size={ICON_SIZE} />,
  'gpu_kernel::exposure': <SunMedium size={ICON_SIZE} />,
  'gpu_kernel::contrast': <SlidersHorizontal size={ICON_SIZE} />,
  'gpu_kernel::luma_adjust': <Sun size={ICON_SIZE} />,
  'gpu_kernel::vibrance': <Sparkles size={ICON_SIZE} />,
  'gpu_kernel::gradient_map': <Rainbow size={ICON_SIZE} />,
  'gpu_kernel::tone_map': <SunMedium size={ICON_SIZE} />,

  // ── Filter ──
  gaussian_blur: <CircleDot size={ICON_SIZE} />,
  sharpen: <Maximize2 size={ICON_SIZE} />,
  'gpu_kernel::edge_detect': <Scan size={ICON_SIZE} />,
  dilate: <Plus size={ICON_SIZE} />,
  erode: <Minus size={ICON_SIZE} />,
  median: <AlignCenter size={ICON_SIZE} />,
  glow: <Zap size={ICON_SIZE} />,
  'gpu_kernel::vignette': <CircleDot size={ICON_SIZE} />,
  'gpu_kernel::lens_distortion': <Circle size={ICON_SIZE} />,

  // ── Composite ──
  'gpu_kernel::blend': <Layers size={ICON_SIZE} />,
  'gpu_kernel::alpha_over': <BlendIcon size={ICON_SIZE} />,

  // ── Transform ──
  resize: <Scaling size={ICON_SIZE} />,
  crop: <Crop size={ICON_SIZE} />,
  flip: <FlipHorizontal2 size={ICON_SIZE} />,
  'gpu_kernel::rotate': <RotateCw size={ICON_SIZE} />,
  translate: <Move size={ICON_SIZE} />,
  'gpu_kernel::transform_2d': <Move size={ICON_SIZE} />,

  // ── Generator ──
  solid_color: <Square size={ICON_SIZE} />,
  noise: <AudioWaveform size={ICON_SIZE} />,
  gradient: <Rainbow size={ICON_SIZE} />,
  checkerboard: <CheckSquare2 size={ICON_SIZE} />,
  rasterize_field: <Hexagon size={ICON_SIZE} />,
  shape: <Shapes size={ICON_SIZE} />,

  // ── Matte ──
  'gpu_kernel::premultiply': <Lock size={ICON_SIZE} />,
  'gpu_kernel::unpremultiply': <Unlock size={ICON_SIZE} />,
  'gpu_kernel::set_alpha': <ShieldPlus size={ICON_SIZE} />,
  'gpu_kernel::extract_channel': <SeparatorVertical size={ICON_SIZE} />,
  chroma_key: <Scissors size={ICON_SIZE} />,
  'gpu_kernel::despill': <Eraser size={ICON_SIZE} />,

  // ── Utility ──
  'gpu_kernel::map_range': <ArrowLeftRight size={ICON_SIZE} />,
  math: <Calculator size={ICON_SIZE} />,

  // ── GPU ──
  gpu_script: <Cpu size={ICON_SIZE} />,

  // ── AI ──
  ai_inpaint: <BrainCircuit size={ICON_SIZE} />,
};

const CATEGORY_ICON_MAP: Record<string, React.ReactElement> = {
  Input: <Image size={ICON_SIZE} />,
  Output: <Eye size={ICON_SIZE} />,
  Color: <Palette size={ICON_SIZE} />,
  Filter: <Filter size={ICON_SIZE} />,
  Composite: <Layers size={ICON_SIZE} />,
  Transform: <Move size={ICON_SIZE} />,
  Generator: <Square size={ICON_SIZE} />,
  Matte: <ShieldPlus size={ICON_SIZE} />,
  GPU: <Cpu size={ICON_SIZE} />,
  Utility: <Calculator size={ICON_SIZE} />,
  AI: <BrainCircuit size={ICON_SIZE} />,
};

const DEFAULT_ICON = <Box size={ICON_SIZE} />;

export const getNodeIcon = (nodeTypeId: string, category?: string): React.ReactElement => {
  return NODE_ICON_MAP[nodeTypeId]
    ?? (category ? CATEGORY_ICON_MAP[category] : undefined)
    ?? DEFAULT_ICON;
};

export const getCategoryIcon = (category: string): React.ReactElement => {
  return CATEGORY_ICON_MAP[category] ?? DEFAULT_ICON;
};
