import type { Annotation, DatasetImage, LabelClass, Project } from '../types/annotation';
import { deriveObjectColor, generateId, readImageDimensions } from './geometry';

export interface TaxonomyPreset {
  id: string;
  name: string;
  description: string;
  classes: Array<{
    name: string;
    color: string;
    objects: Array<{ name: string; hotkey?: string }>;
  }>;
}

export const TAXONOMY_PRESETS: TaxonomyPreset[] = [
  {
    id: 'apparel_human',
    name: 'Apparel & Human Parsing',
    description: 'Body parts, garments, accessories, and structural seam/lane guides.',
    classes: [
      {
        name: 'Body',
        color: '#38BDF8',
        objects: [
          { name: 'Face', hotkey: '1' },
          { name: 'Hand', hotkey: '2' },
          { name: 'Arm' },
        ],
      },
      {
        name: 'Clothes',
        color: '#34D399',
        objects: [
          { name: 'Dress', hotkey: '3' },
          { name: 'Jacket', hotkey: '4' },
          { name: 'Trousers', hotkey: '5' },
          { name: 'Footwear', hotkey: '6' },
        ],
      },
      {
        name: 'Accessories',
        color: '#FBBF24',
        objects: [
          { name: 'Handbag', hotkey: '7' },
          { name: 'Eyewear', hotkey: '8' },
        ],
      },
      {
        name: 'Structure',
        color: '#F472B6',
        objects: [
          { name: 'Seam Line', hotkey: '9' },
          { name: 'Crosswalk Line' },
          { name: 'Vehicle' },
        ],
      },
    ],
  },
  {
    id: 'autonomous_mobility',
    name: 'Autonomous Mobility & Street',
    description: 'Vehicles, vulnerable road users, signage, and lane markings.',
    classes: [
      {
        name: 'Vehicle',
        color: '#38BDF8',
        objects: [
          { name: 'Car', hotkey: '1' },
          { name: 'Truck', hotkey: '2' },
          { name: 'Bicycle', hotkey: '3' },
          { name: 'Tram' },
        ],
      },
      {
        name: 'Person',
        color: '#34D399',
        objects: [
          { name: 'Pedestrian', hotkey: '4' },
          { name: 'Cyclist', hotkey: '5' },
        ],
      },
      {
        name: 'Road',
        color: '#FBBF24',
        objects: [
          { name: 'Lane Line', hotkey: '6' },
          { name: 'Crosswalk', hotkey: '7' },
          { name: 'Traffic Light', hotkey: '8' },
        ],
      },
    ],
  },
  {
    id: 'general_vision',
    name: 'General Object & Scene',
    description: 'Clean starter hierarchy for people, indoor items, and outdoor objects.',
    classes: [
      {
        name: 'Subject',
        color: '#38BDF8',
        objects: [
          { name: 'Person', hotkey: '1' },
          { name: 'Animal', hotkey: '2' },
        ],
      },
      {
        name: 'Object',
        color: '#A78BFA',
        objects: [
          { name: 'Product', hotkey: '3' },
          { name: 'Tool', hotkey: '4' },
          { name: 'Furniture', hotkey: '5' },
        ],
      },
      {
        name: 'Region',
        color: '#FB923C',
        objects: [
          { name: 'Boundary Line', hotkey: '6' },
          { name: 'Landmark Point', hotkey: '7' },
        ],
      },
    ],
  },
  {
    id: 'blank',
    name: 'Blank Custom Taxonomy',
    description: 'Start with one editable Class and Object and build your own tree.',
    classes: [
      {
        name: 'Primary',
        color: '#38BDF8',
        objects: [{ name: 'Target', hotkey: '1' }],
      },
    ],
  },
];

export function buildClassesFromPreset(presetId: string): LabelClass[] {
  const preset = TAXONOMY_PRESETS.find((p) => p.id === presetId) ?? TAXONOMY_PRESETS[0];
  return preset.classes.map((cls) => {
    const classId = generateId('cls');
    return {
      id: classId,
      name: cls.name,
      color: cls.color,
      visible: true,
      objects: cls.objects.map((obj, idx) => ({
        id: generateId('obj'),
        classId,
        name: obj.name,
        color: deriveObjectColor(cls.color, idx),
        hotkey: obj.hotkey,
        visible: true,
      })),
    };
  });
}

const SAMPLE_ASSETS = {
  studioDress: '/src/assets/images/sample_studio_dress_portrait_1795503308027.jpg',
  streetwear: '/src/assets/images/sample_streetwear_jacket_1795503308703.jpg',
  tailoringHands: '/src/assets/images/sample_tailoring_hands_1795503307622.jpg',
  crosswalk: '/src/assets/images/sample_urban_crosswalk_1795503307794.jpg',
};

const defaultAttrs = { occluded: false, truncated: false, crowd: false };

function findIds(classes: LabelClass[], className: string, objectName: string) {
  const cls = classes.find((c) => c.name === className) ?? classes[0];
  const obj = cls.objects.find((o) => o.name === objectName) ?? cls.objects[0];
  return { classId: cls.id, objectId: obj.id };
}

export async function createStarterProjectAndImages(): Promise<{
  project: Project;
  images: DatasetImage[];
}> {
  const now = Date.now();
  const projectId = generateId('proj');
  const classes = buildClassesFromPreset('apparel_human');

  const safeDims = async (url: string) => {
    try {
      return await readImageDimensions(url);
    } catch {
      return { width: 1200, height: 900 };
    }
  };

  const [d1, d2, d3, d4] = await Promise.all([
    safeDims(SAMPLE_ASSETS.studioDress),
    safeDims(SAMPLE_ASSETS.streetwear),
    safeDims(SAMPLE_ASSETS.tailoringHands),
    safeDims(SAMPLE_ASSETS.crosswalk),
  ]);

  const px = (n: number, total: number) => Math.round(n * total);

  const img1Id = generateId('img');
  const img1Annotations: Annotation[] = [
    {
      id: generateId('ann'),
      type: 'bbox',
      ...findIds(classes, 'Body', 'Face'),
      x: px(0.468, d1.width),
      y: px(0.088, d1.height),
      width: px(0.072, d1.width),
      height: px(0.125, d1.height),
      visible: true,
      locked: false,
      attributes: { ...defaultAttrs },
      source: 'manual',
    },
    {
      id: generateId('ann'),
      type: 'bbox',
      ...findIds(classes, 'Body', 'Hand'),
      x: px(0.415, d1.width),
      y: px(0.505, d1.height),
      width: px(0.045, d1.width),
      height: px(0.078, d1.height),
      visible: true,
      locked: false,
      attributes: { ...defaultAttrs },
      note: 'Right hand holding bag handle',
      source: 'manual',
    },
    {
      id: generateId('ann'),
      type: 'bbox',
      ...findIds(classes, 'Body', 'Hand'),
      x: px(0.556, d1.width),
      y: px(0.502, d1.height),
      width: px(0.04, d1.width),
      height: px(0.088, d1.height),
      visible: true,
      locked: false,
      attributes: { ...defaultAttrs },
      note: 'Left hand relaxed at side',
      source: 'manual',
    },
    {
      id: generateId('ann'),
      type: 'polygon',
      ...findIds(classes, 'Clothes', 'Dress'),
      points: [
        { x: px(0.436, d1.width), y: px(0.236, d1.height) },
        { x: px(0.506, d1.width), y: px(0.238, d1.height) },
        { x: px(0.574, d1.width), y: px(0.24, d1.height) },
        { x: px(0.594, d1.width), y: px(0.51, d1.height) },
        { x: px(0.558, d1.width), y: px(0.412, d1.height) },
        { x: px(0.588, d1.width), y: px(0.778, d1.height) },
        { x: px(0.416, d1.width), y: px(0.774, d1.height) },
        { x: px(0.43, d1.width), y: px(0.525, d1.height) },
        { x: px(0.45, d1.width), y: px(0.405, d1.height) },
        { x: px(0.418, d1.width), y: px(0.508, d1.height) },
      ],
      visible: true,
      locked: false,
      attributes: { ...defaultAttrs },
      note: 'Full silhouette segmentation of midi wool dress',
      source: 'manual',
    },
    {
      id: generateId('ann'),
      type: 'bbox',
      ...findIds(classes, 'Accessories', 'Handbag'),
      x: px(0.372, d1.width),
      y: px(0.562, d1.height),
      width: px(0.122, d1.width),
      height: px(0.184, d1.height),
      visible: true,
      locked: false,
      attributes: { ...defaultAttrs },
      source: 'manual',
    },
    {
      id: generateId('ann'),
      type: 'bbox',
      ...findIds(classes, 'Clothes', 'Footwear'),
      x: px(0.464, d1.width),
      y: px(0.838, d1.height),
      width: px(0.052, d1.width),
      height: px(0.122, d1.height),
      visible: true,
      locked: false,
      attributes: { ...defaultAttrs },
      source: 'manual',
    },
    {
      id: generateId('ann'),
      type: 'bbox',
      ...findIds(classes, 'Clothes', 'Footwear'),
      x: px(0.552, d1.width),
      y: px(0.844, d1.height),
      width: px(0.08, d1.width),
      height: px(0.118, d1.height),
      visible: true,
      locked: false,
      attributes: { ...defaultAttrs },
      source: 'manual',
    },
  ];

  const img2Id = generateId('img');
  const img2Annotations: Annotation[] = [
    {
      id: generateId('ann'),
      type: 'bbox',
      ...findIds(classes, 'Body', 'Face'),
      x: px(0.478, d2.width),
      y: px(0.205, d2.height),
      width: px(0.068, d2.width),
      height: px(0.095, d2.height),
      visible: true,
      locked: false,
      attributes: { ...defaultAttrs },
      source: 'manual',
    },
    {
      id: generateId('ann'),
      type: 'bbox',
      ...findIds(classes, 'Accessories', 'Eyewear'),
      x: px(0.495, d2.width),
      y: px(0.236, d2.height),
      width: px(0.048, d2.width),
      height: px(0.032, d2.height),
      visible: true,
      locked: false,
      attributes: { ...defaultAttrs },
      source: 'manual',
    },
    {
      id: generateId('ann'),
      type: 'polygon',
      ...findIds(classes, 'Clothes', 'Jacket'),
      points: [
        { x: px(0.482, d2.width), y: px(0.295, d2.height) },
        { x: px(0.436, d2.width), y: px(0.332, d2.height) },
        { x: px(0.425, d2.width), y: px(0.576, d2.height) },
        { x: px(0.464, d2.width), y: px(0.576, d2.height) },
        { x: px(0.526, d2.width), y: px(0.584, d2.height) },
        { x: px(0.556, d2.width), y: px(0.49, d2.height) },
        { x: px(0.594, d2.width), y: px(0.552, d2.height) },
        { x: px(0.55, d2.width), y: px(0.34, d2.height) },
      ],
      visible: true,
      locked: false,
      attributes: { ...defaultAttrs },
      source: 'manual',
    },
    {
      id: generateId('ann'),
      type: 'bbox',
      ...findIds(classes, 'Accessories', 'Handbag'),
      x: px(0.402, d2.width),
      y: px(0.474, d2.height),
      width: px(0.078, d2.width),
      height: px(0.116, d2.height),
      visible: true,
      locked: false,
      attributes: { ...defaultAttrs, occluded: true },
      source: 'manual',
    },
    {
      id: generateId('ann'),
      type: 'bbox',
      ...findIds(classes, 'Clothes', 'Trousers'),
      x: px(0.418, d2.width),
      y: px(0.535, d2.height),
      width: px(0.155, d2.width),
      height: px(0.326, d2.height),
      visible: true,
      locked: false,
      attributes: { ...defaultAttrs },
      source: 'manual',
    },
    {
      id: generateId('ann'),
      type: 'bbox',
      ...findIds(classes, 'Body', 'Hand'),
      x: px(0.57, d2.width),
      y: px(0.548, d2.height),
      width: px(0.032, d2.width),
      height: px(0.042, d2.height),
      visible: true,
      locked: false,
      attributes: { ...defaultAttrs },
      source: 'manual',
    },
  ];

  const img3Id = generateId('img');
  const img3Annotations: Annotation[] = [
    {
      id: generateId('ann'),
      type: 'bbox',
      ...findIds(classes, 'Body', 'Hand'),
      x: px(0.708, d3.width),
      y: px(0.368, d3.height),
      width: px(0.175, d3.width),
      height: px(0.202, d3.height),
      visible: true,
      locked: false,
      attributes: { ...defaultAttrs },
      note: 'Right hand gripping shears',
      source: 'manual',
    },
    {
      id: generateId('ann'),
      type: 'bbox',
      ...findIds(classes, 'Body', 'Hand'),
      x: px(0.512, d3.width),
      y: px(0.65, d3.height),
      width: px(0.235, d3.width),
      height: px(0.175, d3.height),
      visible: true,
      locked: false,
      attributes: { ...defaultAttrs },
      note: 'Left hand stabilizing sleeve wool',
      source: 'manual',
    },
    {
      id: generateId('ann'),
      type: 'polygon',
      ...findIds(classes, 'Clothes', 'Jacket'),
      points: [
        { x: px(0.195, d3.width), y: px(0.256, d3.height) },
        { x: px(0.455, d3.width), y: px(0.162, d3.height) },
        { x: px(0.745, d3.width), y: px(0.238, d3.height) },
        { x: px(0.955, d3.width), y: px(0.332, d3.height) },
        { x: px(0.935, d3.width), y: px(0.785, d3.height) },
        { x: px(0.648, d3.width), y: px(0.985, d3.height) },
        { x: px(0.365, d3.width), y: px(0.79, d3.height) },
        { x: px(0.155, d3.width), y: px(0.495, d3.height) },
      ],
      visible: true,
      locked: false,
      attributes: { ...defaultAttrs },
      source: 'manual',
    },
    {
      id: generateId('ann'),
      type: 'polyline',
      ...findIds(classes, 'Structure', 'Seam Line'),
      points: [
        { x: px(0.176, d3.width), y: px(0.422, d3.height) },
        { x: px(0.312, d3.width), y: px(0.565, d3.height) },
        { x: px(0.45, d3.width), y: px(0.702, d3.height) },
        { x: px(0.582, d3.width), y: px(0.822, d3.height) },
      ],
      visible: true,
      locked: false,
      attributes: { ...defaultAttrs },
      note: 'Primary tailor chalk sleeve seam',
      source: 'manual',
    },
    {
      id: generateId('ann'),
      type: 'polyline',
      ...findIds(classes, 'Structure', 'Seam Line'),
      points: [
        { x: px(0.282, d3.width), y: px(0.438, d3.height) },
        { x: px(0.382, d3.width), y: px(0.486, d3.height) },
        { x: px(0.468, d3.width), y: px(0.602, d3.height) },
        { x: px(0.388, d3.width), y: px(0.688, d3.height) },
      ],
      visible: true,
      locked: false,
      attributes: { ...defaultAttrs },
      note: 'Cross-seam chalk reference',
      source: 'manual',
    },
  ];

  const img4Id = generateId('img');
  const img4Annotations: Annotation[] = [
    {
      id: generateId('ann'),
      type: 'bbox',
      ...findIds(classes, 'Structure', 'Vehicle'),
      x: px(0.044, d4.width),
      y: px(0.468, d4.height),
      width: px(0.328, d4.width),
      height: px(0.196, d4.height),
      visible: true,
      locked: false,
      attributes: { ...defaultAttrs },
      source: 'manual',
    },
    {
      id: generateId('ann'),
      type: 'bbox',
      ...findIds(classes, 'Clothes', 'Jacket'),
      x: px(0.44, d4.width),
      y: px(0.485, d4.height),
      width: px(0.078, d4.width),
      height: px(0.175, d4.height),
      visible: true,
      locked: false,
      attributes: { ...defaultAttrs },
      source: 'manual',
    },
    {
      id: generateId('ann'),
      type: 'bbox',
      ...findIds(classes, 'Clothes', 'Jacket'),
      x: px(0.538, d4.width),
      y: px(0.464, d4.height),
      width: px(0.095, d4.width),
      height: px(0.198, d4.height),
      visible: true,
      locked: false,
      attributes: { ...defaultAttrs },
      source: 'manual',
    },
    {
      id: generateId('ann'),
      type: 'bbox',
      ...findIds(classes, 'Accessories', 'Handbag'),
      x: px(0.6, d4.width),
      y: px(0.615, d4.height),
      width: px(0.048, d4.width),
      height: px(0.105, d4.height),
      visible: true,
      locked: false,
      attributes: { ...defaultAttrs },
      source: 'manual',
    },
    {
      id: generateId('ann'),
      type: 'polyline',
      ...findIds(classes, 'Structure', 'Crosswalk Line'),
      points: [
        { x: px(0.198, d4.width), y: px(0.77, d4.height) },
        { x: px(0.538, d4.width), y: px(0.835, d4.height) },
        { x: px(0.916, d4.width), y: px(0.912, d4.height) },
      ],
      visible: true,
      locked: false,
      attributes: { ...defaultAttrs },
      note: 'Leading crosswalk boundary line',
      source: 'manual',
    },
  ];

  const images: DatasetImage[] = [
    {
      id: img1Id,
      projectId,
      fileName: 'studio_midi_dress_001.jpg',
      mimeType: 'image/jpeg',
      width: d1.width,
      height: d1.height,
      split: 'train',
      status: 'verified',
      caption:
        'Full-length studio portrait of a woman standing centered against a matte gray seamless backdrop, wearing a structured olive-emerald long-sleeve midi dress and black leather ankle boots while holding a structured tan leather handbag in her right hand.',
      shortCaption: 'Woman in olive midi dress holding tan leather handbag in studio',
      tags: ['studio-lighting', 'full-body', 'midi-dress', 'handbag', 'front-view'],
      annotations: img1Annotations,
      seedUrl: SAMPLE_ASSETS.studioDress,
      createdAt: now - 4000,
      updatedAt: now - 4000,
    },
    {
      id: img2Id,
      projectId,
      fileName: 'plaza_utility_jacket_002.jpg',
      mimeType: 'image/jpeg',
      width: d2.width,
      height: d2.height,
      split: 'train',
      status: 'labeled',
      caption:
        'Full-body daytime street photograph of a person walking across a minimalist concrete plaza wearing a charcoal utility jacket over a cream knit sweater, dark tailored trousers, white leather sneakers, dark sunglasses, and a canvas crossbody bag.',
      shortCaption: 'Person walking in charcoal utility jacket and sneakers across concrete plaza',
      tags: ['outdoor', 'overcast', 'walking-pose', 'outerwear', 'streetwear'],
      annotations: img2Annotations,
      seedUrl: SAMPLE_ASSETS.streetwear,
      createdAt: now - 3000,
      updatedAt: now - 3000,
    },
    {
      id: img3Id,
      projectId,
      fileName: 'tailor_wool_coat_hands_003.jpg',
      mimeType: 'image/jpeg',
      width: d3.width,
      height: d3.height,
      split: 'val',
      status: 'verified',
      caption:
        'Overhead close-up documentary photograph of a tailor working with both hands on a navy wool blazer laid flat on an oak drafting table, using fabric shears alongside crisp white tailor chalk seam lines marked across the sleeve.',
      shortCaption: 'Tailor hands marking and cutting navy wool blazer with chalk seams',
      tags: ['overhead', 'hand-detail', 'tailoring', 'chalk-seams', 'close-up'],
      annotations: img3Annotations,
      seedUrl: SAMPLE_ASSETS.tailoringHands,
      createdAt: now - 2000,
      updatedAt: now - 2000,
    },
    {
      id: img4Id,
      projectId,
      fileName: 'european_crosswalk_004.jpg',
      mimeType: 'image/jpeg',
      width: d4.width,
      height: d4.height,
      split: 'test',
      status: 'in_progress',
      caption:
        'Wide-angle daytime street scene at a European intersection showing two pedestrians in beige and olive trench coats carrying leather bags across painted white zebra crossing stripes while a silver compact hatchback waits at the stop line.',
      shortCaption: 'Two pedestrians in trench coats crossing city crosswalk beside waiting car',
      tags: ['urban', 'crosswalk', 'pedestrians', 'trench-coat', 'vehicle'],
      annotations: img4Annotations,
      seedUrl: SAMPLE_ASSETS.crosswalk,
      createdAt: now - 1000,
      updatedAt: now - 1000,
    },
  ];

  const project: Project = {
    id: projectId,
    name: 'Apparel & Human Parsing',
    description:
      'Hierarchical Class → Object sample dataset featuring bounding boxes, polygon segmentations, structural polylines, and VLM captions.',
    classes,
    activeImageId: img1Id,
    createdAt: now,
    updatedAt: now,
  };

  return { project, images };
}
