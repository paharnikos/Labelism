export type AnnotationType = 'bbox' | 'polygon' | 'polyline' | 'keypoint';

export type ToolMode = 'select' | 'bbox' | 'polygon' | 'polyline' | 'keypoint' | 'pan';

export type SplitType = 'train' | 'val' | 'test';

export type ReviewStatus = 'unlabeled' | 'in_progress' | 'labeled' | 'verified';

export type ViewTab = 'annotate' | 'dataset' | 'analytics' | 'export' | 'help';

export type CaptionStyle = 'descriptive' | 'concise' | 'technical';

export interface Point {
  x: number;
  y: number;
}

export interface LabelObject {
  id: string;
  classId: string;
  name: string;
  color: string;
  hotkey?: string; // '1'..'9'
  visible: boolean;
}

export interface LabelClass {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  objects: LabelObject[];
}

export interface AnnotationAttributes {
  occluded: boolean;
  truncated: boolean;
  crowd: boolean;
}

interface BaseAnnotation {
  id: string;
  type: AnnotationType;
  classId: string;
  objectId: string;
  visible: boolean;
  locked: boolean;
  attributes: AnnotationAttributes;
  note?: string;
  source?: 'manual' | 'ai_suggestion';
  confidence?: number;
}

export interface BBoxAnnotation extends BaseAnnotation {
  type: 'bbox';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PolygonAnnotation extends BaseAnnotation {
  type: 'polygon';
  points: Point[];
}

export interface PolylineAnnotation extends BaseAnnotation {
  type: 'polyline';
  points: Point[];
}

export interface KeypointAnnotation extends BaseAnnotation {
  type: 'keypoint';
  x: number;
  y: number;
}

export type Annotation =
  | BBoxAnnotation
  | PolygonAnnotation
  | PolylineAnnotation
  | KeypointAnnotation;

export interface DatasetImage {
  id: string;
  projectId: string;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  split: SplitType;
  status: ReviewStatus;
  caption: string;
  shortCaption: string;
  tags: string[];
  annotations: Annotation[];
  /** Fallback static path for pre-seeded assets if blob not yet persisted */
  seedUrl?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  classes: LabelClass[];
  activeImageId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ImageDisplaySettings {
  brightness: number; // 50..200 (%)
  contrast: number; // 50..200 (%)
  saturation: number; // 0..200 (%)
  maskOpacity: number; // 0.05..0.65
  showLabels: boolean;
  showClassPrefix: boolean; // true => "Clothes / Dress", false => "Dress"
  showCrosshair: boolean;
}

export interface AIDetectionResult {
  className: string;
  objectName: string;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] 0..1000
  confidence: number;
}

export interface AICaptionResult {
  caption: string;
  shortCaption: string;
  tags: string[];
}

export interface ToastMessage {
  id: string;
  text: string;
  tone: 'info' | 'success' | 'error';
}

export type AIProviderId = 'gemini' | 'openrouter' | 'nanogpt' | 'custom';

export interface AIProviderSelection {
  provider: AIProviderId;
  model: string;
}

export interface AIProviderInfo {
  id: AIProviderId;
  name: string;
  endpointDisplay: string;
  configured: boolean;
  requiredEnvVars: string[];
  defaultModel: string;
  recommendedModels: Array<{ id: string; label: string }>;
}

