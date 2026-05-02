import type { NodeSpec } from '../store/types';

export type ExampleSection = 'Getting Started' | 'Custom Effects';

export interface CascadeExample {
  id: string;
  title: string;
  section: ExampleSection;
  description: string;
  tags: string[];
  projectUrl: string;
  thumbnailUrl: string;
  requiredNodeTypes: string[];
}

const publicAsset = (path: string): string => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;

export const CASCADE_EXAMPLES: CascadeExample[] = [
  {
    id: 'photo-grade',
    title: 'Photo Grade',
    section: 'Getting Started',
    description: 'Clean up a photo with Photo Adjust, then shape the final contrast with Curves.',
    tags: ['Photo Adjust', 'Curves', 'Compare'],
    projectUrl: publicAsset('examples/photo-grade.casc'),
    thumbnailUrl: publicAsset('examples/thumbs/photo-grade.webp'),
    requiredNodeTypes: ['load_image', 'group::photo_adjust', 'curves', 'compare_viewer', 'export_image'],
  },
  {
    id: 'pixel-art-palette-grade',
    title: 'Pixel Art Palette Grade',
    section: 'Getting Started',
    description: 'Tone-map a source image, then pixelate it through a custom palette.',
    tags: ['Pixelate', 'Palette', 'Curves'],
    projectUrl: publicAsset('examples/pixel-art-palette-grade.casc'),
    thumbnailUrl: publicAsset('examples/thumbs/pixel-art-palette-grade.webp'),
    requiredNodeTypes: ['load_image', 'curves', 'color_palette', 'gpu_kernel::pixelate', 'viewer', 'export_image'],
  },
  {
    id: 'cinematic-color-ramp',
    title: 'Cinematic Color Ramp',
    section: 'Getting Started',
    description: 'Push an image into a warm-highlight, cool-shadow cinematic ramp.',
    tags: ['Color Ramp', 'Photo Adjust', 'Look'],
    projectUrl: publicAsset('examples/cinematic-color-ramp.casc'),
    thumbnailUrl: publicAsset('examples/thumbs/cinematic-color-ramp.webp'),
    requiredNodeTypes: ['load_image', 'group::photo_adjust', 'color_ramp', 'curves', 'viewer', 'export_image'],
  },
  {
    id: 'noise-texture-lab',
    title: 'Noise Texture Lab',
    section: 'Getting Started',
    description: 'Build a procedural texture from generated noise, rasterization, and a color ramp.',
    tags: ['Noise', 'Procedural', 'Texture'],
    projectUrl: publicAsset('examples/noise-texture-lab.casc'),
    thumbnailUrl: publicAsset('examples/thumbs/noise-texture-lab.webp'),
    requiredNodeTypes: ['noise', 'rasterize_field', 'color_ramp', 'viewer', 'export_image'],
  },
  {
    id: 'halftone-shader',
    title: 'Halftone Shader',
    section: 'Custom Effects',
    description: 'A live GPU Script dot-screen shader with editable dot size, angle, and mix.',
    tags: ['GPU Script', 'Halftone', 'Print'],
    projectUrl: publicAsset('examples/halftone-shader.casc'),
    thumbnailUrl: publicAsset('examples/thumbs/halftone-shader.webp'),
    requiredNodeTypes: ['load_image', 'gpu_script', 'viewer', 'export_image'],
  },
  {
    id: 'crt-scanline-look',
    title: 'CRT / Scanline Look',
    section: 'Custom Effects',
    description: 'A GPU Script display treatment with scanlines, RGB split, and subtle curvature.',
    tags: ['GPU Script', 'CRT', 'Scanlines'],
    projectUrl: publicAsset('examples/crt-scanline-look.casc'),
    thumbnailUrl: publicAsset('examples/thumbs/crt-scanline-look.webp'),
    requiredNodeTypes: ['load_image', 'gpu_script', 'viewer', 'export_image'],
  },
  {
    id: 'glitch-datamosh-look',
    title: 'Glitch / Datamosh Look',
    section: 'Custom Effects',
    description: 'A live shader that offsets blocks and splits color channels for glitch motion.',
    tags: ['GPU Script', 'Glitch', 'Blocks'],
    projectUrl: publicAsset('examples/glitch-datamosh-look.casc'),
    thumbnailUrl: publicAsset('examples/thumbs/glitch-datamosh-look.webp'),
    requiredNodeTypes: ['load_image', 'gpu_script', 'viewer', 'export_image'],
  },
  {
    id: 'duotone-grain',
    title: 'Duotone Grain',
    section: 'Custom Effects',
    description: 'A two-tone GPU Script look with procedural texture and contrast controls.',
    tags: ['GPU Script', 'Duotone', 'Grain'],
    projectUrl: publicAsset('examples/duotone-grain.casc'),
    thumbnailUrl: publicAsset('examples/thumbs/duotone-grain.webp'),
    requiredNodeTypes: ['load_image', 'gpu_script', 'viewer', 'export_image'],
  },
  {
    id: 'abstract-cell-voronoi-poster',
    title: 'Abstract Cell / Voronoi Poster',
    section: 'Custom Effects',
    description: 'A procedural cell shader that turns a photo into a faceted poster.',
    tags: ['GPU Script', 'Voronoi', 'Poster'],
    projectUrl: publicAsset('examples/abstract-cell-voronoi-poster.casc'),
    thumbnailUrl: publicAsset('examples/thumbs/abstract-cell-voronoi-poster.webp'),
    requiredNodeTypes: ['load_image', 'gpu_script', 'viewer', 'export_image'],
  },
];

export const EXAMPLE_SECTIONS: ExampleSection[] = ['Getting Started', 'Custom Effects'];

export const getExampleById = (exampleId: string): CascadeExample | undefined => (
  CASCADE_EXAMPLES.find(example => example.id === exampleId)
);

export const missingRequiredNodeTypes = (
  example: CascadeExample,
  nodeSpecs: Pick<NodeSpec, 'id'>[],
): string[] => {
  const available = new Set(nodeSpecs.map(spec => spec.id));
  return example.requiredNodeTypes.filter(typeId => !available.has(typeId));
};
