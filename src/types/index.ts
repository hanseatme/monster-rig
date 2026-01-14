// Bone Types
export interface BoneData {
  id: string
  name: string
  parentId: string | null
  position: [number, number, number]
  rotation: [number, number, number, number] // Quaternion
  scale: [number, number, number]
  length: number
  rotationLimits: {
    x: [number, number]
    y: [number, number]
    z: [number, number]
  }
}

export interface SkeletonData {
  bones: BoneData[]
}

// Weight Painting Types
export interface VertexWeight {
  boneIndex: number
  weight: number
}

export interface MeshWeights {
  meshName: string
  vertexWeights: VertexWeight[][]
}

export interface WeightMap {
  [meshName: string]: {
    vertexWeights: [number, number][][] // [boneIndex, weight][]
  }
}

// Animation Types
export type InterpolationType = 'linear' | 'bezier' | 'step'
export type KeyframeProperty = 'position' | 'rotation' | 'scale'

export interface Keyframe {
  frame: number
  value: number[]
  interpolation: InterpolationType
  tangentIn?: [number, number]
  tangentOut?: [number, number]
}

export interface AnimationTrack {
  boneId: string
  property: KeyframeProperty
  keyframes: Keyframe[]
}

export interface AnimationClip {
  id: string
  name: string
  fps: number
  frameCount: number
  tracks: AnimationTrack[]
}

// Project Types
export interface ProjectData {
  version: string
  modelPath: string
  modelHash: string
  skeleton: SkeletonData
  weightMap: WeightMap
  animations: AnimationClip[]
}

// Editor State Types
export type EditorMode = 'select' | 'bone' | 'weight-paint' | 'animate'
export type TransformMode = 'translate' | 'rotate' | 'scale'
export type DisplayMode = 'textured' | 'solid' | 'wireframe' | 'xray'

export interface ViewportSettings {
  showGrid: boolean
  showAxes: boolean
  showWireframe: boolean
  showBones: boolean
  boneStyle: 'octahedron' | 'stick'
  displayMode: DisplayMode
  modelOpacity: number
}

export interface AutoBoneSettings {
  boneSpacingFactor: number
  rootYOffsetFactor: number
  spineMinSegments: number
  spineMaxSegments: number
  limbMinSegments: number
  limbMaxSegments: number
  extremityClusterFactor: number
  extremityTopPercent: number
  maxExtremities: number
  extremityMinDistanceFactor: number
  symmetryAxis: 'auto' | 'x' | 'y' | 'z'
}

export interface TimelineState {
  currentFrame: number
  isPlaying: boolean
  fps: number
  frameStart: number
  frameEnd: number
  loop: boolean
}

export interface WeightPaintSettings {
  brushSize: number
  brushStrength: number
  brushMode: 'add' | 'subtract' | 'smooth'
}

export interface AutoWeightSettings {
  method: 'envelope' | 'heatmap' | 'nearest'
  falloff: number
  smoothIterations: number
  neighborWeight: number
}

export interface BoneRestPose {
  position: [number, number, number]
  rotation: [number, number, number, number]
  scale: [number, number, number]
}

export type RestPoseSnapshot = Record<string, BoneRestPose>

// Selection Types
export interface Selection {
  type: 'bone' | 'mesh' | 'vertex' | null
  ids: string[]
}

// Undo/Redo Types
export interface HistoryState {
  skeleton: SkeletonData
  weightMap: WeightMap
  animations: AnimationClip[]
}

export interface HistoryEntry {
  state: HistoryState
  description: string
  timestamp: number
}

// Mesh Hierarchy Types
export interface MeshNode {
  id: string
  name: string
  type: 'mesh' | 'group' | 'bone'
  children: MeshNode[]
  visible: boolean
}

// Auto-Save Types
export interface AutoSaveData {
  projectData: ProjectData
  timestamp: number
  filePath: string | null
}
