import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { v4 as uuidv4 } from 'uuid'
import type {
  BoneData,
  SkeletonData,
  WeightMap,
  AnimationClip,
  Keyframe,
  EditorMode,
  TransformMode,
  ViewportSettings,
  TimelineState,
  WeightPaintSettings,
  AutoWeightSettings,
  RestPoseSnapshot,
  Selection,
  HistoryEntry,
  HistoryState,
  MeshNode,
  ProjectData,
  InterpolationType,
  KeyframeProperty,
  AutoBoneSettings,
} from '../types'
import { DEFAULT_AUTO_BONE_SETTINGS, normalizeAutoBoneSettings } from '../utils/autoBoneSettings'

interface EditorStore {
  // Project State
  projectPath: string | null
  modelPath: string | null
  modelHash: string
  isDirty: boolean

  // Skeleton
  skeleton: SkeletonData

  // Weights
  weightMap: WeightMap

  // Animations
  animations: AnimationClip[]
  currentAnimationId: string | null

  // Editor State
  mode: EditorMode
  transformMode: TransformMode
  selection: Selection
  viewportSettings: ViewportSettings
  timeline: TimelineState
  weightPaintSettings: WeightPaintSettings
  autoWeightSettings: AutoWeightSettings
  restPoseSnapshot: RestPoseSnapshot | null
  autoBoneSettings: AutoBoneSettings
  riggingOffset: [number, number, number]

  // Mesh Hierarchy
  meshHierarchy: MeshNode[]

  // History
  history: HistoryEntry[]
  historyIndex: number
  maxHistorySize: number

  // Auto-save
  lastAutoSave: number

  // Actions - Project
  newProject: () => void
  loadProject: (data: ProjectData, filePath: string) => void
  setModelPath: (path: string) => void
  setProjectPath: (path: string) => void
  markDirty: () => void
  markClean: () => void
  getProjectData: () => ProjectData

  // Actions - Skeleton
  addBone: (position: [number, number, number], parentId?: string | null) => string
  updateBone: (id: string, updates: Partial<BoneData>) => void
  updateBoneFromAnimation: (id: string, updates: Partial<BoneData>) => void
  updateBonesFromAnimation: (updates: Record<string, Partial<BoneData>>) => void
  deleteBone: (id: string) => void
  setBoneParent: (boneId: string, parentId: string | null) => void
  mirrorBones: (axis: 'x' | 'y' | 'z') => void
  setRestPoseSnapshot: (snapshot: RestPoseSnapshot | null) => void

  // Actions - Weights
  setWeightMap: (weightMap: WeightMap) => void
  updateMeshWeights: (meshName: string, vertexWeights: [number, number][][]) => void

  // Actions - Animations
  addAnimation: (name?: string) => string
  updateAnimation: (id: string, updates: Partial<AnimationClip>) => void
  deleteAnimation: (id: string) => void
  duplicateAnimation: (id: string) => string
  setCurrentAnimation: (id: string | null) => void

  // Actions - Keyframes
  addKeyframe: (animationId: string, boneId: string, property: KeyframeProperty, frame: number, value: number[], interpolation?: InterpolationType) => void
  updateKeyframe: (animationId: string, boneId: string, property: KeyframeProperty, frame: number, updates: Partial<Keyframe>) => void
  deleteKeyframe: (animationId: string, boneId: string, property: KeyframeProperty, frame: number) => void

  // Actions - Editor State
  setMode: (mode: EditorMode) => void
  setTransformMode: (mode: TransformMode) => void
  setSelection: (selection: Selection) => void
  updateViewportSettings: (settings: Partial<ViewportSettings>) => void
  updateTimeline: (state: Partial<TimelineState>) => void
  updateWeightPaintSettings: (settings: Partial<WeightPaintSettings>) => void
  updateAutoWeightSettings: (settings: Partial<AutoWeightSettings>) => void
  updateAutoBoneSettings: (settings: Partial<AutoBoneSettings>) => void
  setRiggingOffset: (offset: [number, number, number]) => void

  // Actions - Mesh Hierarchy
  setMeshHierarchy: (hierarchy: MeshNode[]) => void
  toggleMeshVisibility: (id: string) => void

  // Actions - History
  pushHistory: (description: string) => void
  undo: () => void
  redo: () => void
  clearHistory: () => void

  // Actions - Auto-save
  updateAutoSaveTime: () => void
}

const createInitialBone = (position: [number, number, number], parentId: string | null = null): BoneData => ({
  id: uuidv4(),
  name: parentId ? `bone_${Date.now()}` : 'root',
  parentId,
  position,
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
  length: 1,
  rotationLimits: {
    x: [-180, 180],
    y: [-180, 180],
    z: [-180, 180],
  },
})

const createInitialAnimation = (name: string = 'idle'): AnimationClip => ({
  id: uuidv4(),
  name,
  fps: 30,
  frameCount: 60,
  tracks: [],
})

const createRestPoseSnapshot = (skeleton: SkeletonData): RestPoseSnapshot => {
  const snapshot: RestPoseSnapshot = {}
  skeleton.bones.forEach((bone) => {
    snapshot[bone.id] = {
      position: [...bone.position] as [number, number, number],
      rotation: [...bone.rotation] as [number, number, number, number],
      scale: [...bone.scale] as [number, number, number],
    }
  })
  return snapshot
}

const getInitialState = () => ({
  projectPath: null,
  modelPath: null,
  modelHash: '',
  isDirty: false,
  skeleton: { bones: [] },
  weightMap: {},
  animations: [],
  currentAnimationId: null,
  mode: 'select' as EditorMode,
  transformMode: 'translate' as TransformMode,
  selection: { type: null, ids: [] },
  viewportSettings: {
    showGrid: true,
    showAxes: true,
    showWireframe: false,
    showBones: true,
    boneStyle: 'octahedron' as const,
    displayMode: 'textured' as const,
    modelOpacity: 1.0,
  },
  timeline: {
    currentFrame: 0,
    isPlaying: false,
    fps: 30,
    frameStart: 0,
    frameEnd: 60,
    loop: true,
  },
  weightPaintSettings: {
    brushSize: 20,
    brushStrength: 0.5,
    brushMode: 'add' as const,
  },
  autoWeightSettings: {
    method: 'envelope' as const,
    falloff: 2.5,
    smoothIterations: 2,
    neighborWeight: 0.6,
  },
  restPoseSnapshot: null,
  autoBoneSettings: { ...DEFAULT_AUTO_BONE_SETTINGS },
  riggingOffset: [0, 0, 0] as [number, number, number],
  meshHierarchy: [],
  history: [],
  historyIndex: -1,
  maxHistorySize: 50,
  lastAutoSave: Date.now(),
})

export const useEditorStore = create<EditorStore>()(
  immer((set, get) => ({
    ...getInitialState(),

    // Project Actions
    newProject: () => {
      set((state) => {
        Object.assign(state, getInitialState())
      })
    },

    loadProject: (data, filePath) => {
      set((state) => {
        state.projectPath = filePath
        state.modelPath = data.modelPath
        state.modelHash = data.modelHash
        state.skeleton = data.skeleton
        state.weightMap = data.weightMap
        state.animations = data.animations
        state.currentAnimationId = data.animations.length > 0 ? data.animations[0].id : null
        state.isDirty = false
        state.history = []
        state.historyIndex = -1
        state.restPoseSnapshot = createRestPoseSnapshot(data.skeleton)
      })
    },

    setModelPath: (path) => {
      set((state) => {
        state.modelPath = path
        state.isDirty = true
      })
    },

    setProjectPath: (path) => {
      set((state) => {
        state.projectPath = path
      })
    },

    markDirty: () => {
      set((state) => {
        state.isDirty = true
      })
    },

    markClean: () => {
      set((state) => {
        state.isDirty = false
      })
    },

    getProjectData: () => {
      const state = get()
      const skeleton = state.restPoseSnapshot
        ? {
            bones: state.skeleton.bones.map((bone) => {
              const rest = state.restPoseSnapshot?.[bone.id]
              if (!rest) return bone
              return {
                ...bone,
                position: rest.position,
                rotation: rest.rotation,
                scale: rest.scale,
              }
            }),
          }
        : state.skeleton

      return {
        version: '1.0',
        modelPath: state.modelPath || '',
        modelHash: state.modelHash,
        skeleton,
        weightMap: state.weightMap,
        animations: state.animations,
      }
    },

    // Skeleton Actions
    addBone: (position, parentId = null) => {
      const bone = createInitialBone(position, parentId)
      set((state) => {
        state.skeleton.bones.push(bone)
        state.isDirty = true
        state.restPoseSnapshot = null
      })
      get().pushHistory(`Add bone: ${bone.name}`)
      return bone.id
    },

    updateBone: (id, updates) => {
      set((state) => {
        const bone = state.skeleton.bones.find((b) => b.id === id)
        if (bone) {
          Object.assign(bone, updates)
          state.isDirty = true
          if ('position' in updates || 'rotation' in updates || 'scale' in updates) {
            state.restPoseSnapshot = null
          }
        }
      })
    },

    updateBoneFromAnimation: (id, updates) => {
      set((state) => {
        const bone = state.skeleton.bones.find((b) => b.id === id)
        if (bone) {
          Object.assign(bone, updates)
        }
      })
    },

    updateBonesFromAnimation: (updates) => {
      set((state) => {
        state.skeleton.bones.forEach((bone) => {
          const update = updates[bone.id]
          if (update) {
            Object.assign(bone, update)
          }
        })
      })
    },

    deleteBone: (id) => {
      const state = get()
      const bone = state.skeleton.bones.find((b) => b.id === id)
      if (!bone) return

      set((state) => {
        // Re-parent children to deleted bone's parent
        state.skeleton.bones.forEach((b) => {
          if (b.parentId === id) {
            b.parentId = bone.parentId
          }
        })
        // Remove the bone
        state.skeleton.bones = state.skeleton.bones.filter((b) => b.id !== id)
        state.isDirty = true
        state.restPoseSnapshot = null

        // Clear selection if deleted
        if (state.selection.ids.includes(id)) {
          state.selection = { type: null, ids: [] }
        }
      })
      get().pushHistory(`Delete bone: ${bone.name}`)
    },

    setBoneParent: (boneId, parentId) => {
      set((state) => {
        const bone = state.skeleton.bones.find((b) => b.id === boneId)
        if (bone) {
          bone.parentId = parentId
          state.isDirty = true
          state.restPoseSnapshot = null
        }
      })
      get().pushHistory('Change bone parent')
    },

    mirrorBones: (axis) => {
      const state = get()
      const selectedBones = state.skeleton.bones.filter((b) =>
        state.selection.ids.includes(b.id)
      )

      if (selectedBones.length === 0) return

      set((state) => {
        selectedBones.forEach((bone) => {
          const mirroredBone = { ...bone }
          mirroredBone.id = uuidv4()

          // Mirror position
          const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
          mirroredBone.position = [...bone.position] as [number, number, number]
          mirroredBone.position[axisIndex] *= -1

          // Update name
          if (bone.name.includes('_left')) {
            mirroredBone.name = bone.name.replace('_left', '_right')
          } else if (bone.name.includes('_right')) {
            mirroredBone.name = bone.name.replace('_right', '_left')
          } else if (bone.name.includes('_l_')) {
            mirroredBone.name = bone.name.replace('_l_', '_r_')
          } else if (bone.name.includes('_r_')) {
            mirroredBone.name = bone.name.replace('_r_', '_l_')
          } else {
            mirroredBone.name = `${bone.name}_mirrored`
          }

          state.skeleton.bones.push(mirroredBone)
        })
        state.isDirty = true
        state.restPoseSnapshot = null
      })
      get().pushHistory(`Mirror bones (${axis}-axis)`)
    },

    setRestPoseSnapshot: (snapshot) => {
      set((state) => {
        state.restPoseSnapshot = snapshot
      })
    },

    // Weight Actions
    setWeightMap: (weightMap) => {
      set((state) => {
        state.weightMap = weightMap
        state.isDirty = true
      })
    },

    updateMeshWeights: (meshName, vertexWeights) => {
      set((state) => {
        state.weightMap[meshName] = { vertexWeights }
        state.isDirty = true
      })
    },

    // Animation Actions
    addAnimation: (name) => {
      const animation = createInitialAnimation(name || `animation_${get().animations.length + 1}`)
      set((state) => {
        state.animations.push(animation)
        state.currentAnimationId = animation.id
        state.isDirty = true
      })
      return animation.id
    },

    updateAnimation: (id, updates) => {
      set((state) => {
        const animation = state.animations.find((a) => a.id === id)
        if (animation) {
          Object.assign(animation, updates)
          state.isDirty = true
        }
      })
    },

    deleteAnimation: (id) => {
      set((state) => {
        state.animations = state.animations.filter((a) => a.id !== id)
        if (state.currentAnimationId === id) {
          state.currentAnimationId = state.animations.length > 0 ? state.animations[0].id : null
        }
        state.isDirty = true
      })
    },

    duplicateAnimation: (id) => {
      const state = get()
      const animation = state.animations.find((a) => a.id === id)
      if (!animation) return ''

      const newAnimation: AnimationClip = {
        ...JSON.parse(JSON.stringify(animation)),
        id: uuidv4(),
        name: `${animation.name}_copy`,
      }

      set((state) => {
        state.animations.push(newAnimation)
        state.currentAnimationId = newAnimation.id
        state.isDirty = true
      })
      return newAnimation.id
    },

    setCurrentAnimation: (id) => {
      set((state) => {
        state.currentAnimationId = id
      })
    },

    // Keyframe Actions
    addKeyframe: (animationId, boneId, property, frame, value, interpolation = 'linear') => {
      set((state) => {
        const animation = state.animations.find((a) => a.id === animationId)
        if (!animation) return

        let track = animation.tracks.find(
          (t) => t.boneId === boneId && t.property === property
        )

        if (!track) {
          track = { boneId, property, keyframes: [] }
          animation.tracks.push(track)
        }

        // Remove existing keyframe at this frame
        track.keyframes = track.keyframes.filter((k) => k.frame !== frame)

        // Add new keyframe
        track.keyframes.push({ frame, value, interpolation })
        track.keyframes.sort((a, b) => a.frame - b.frame)

        state.isDirty = true
      })
      get().pushHistory('Add keyframe')
    },

    updateKeyframe: (animationId, boneId, property, frame, updates) => {
      set((state) => {
        const animation = state.animations.find((a) => a.id === animationId)
        if (!animation) return

        const track = animation.tracks.find(
          (t) => t.boneId === boneId && t.property === property
        )
        if (!track) return

        const keyframe = track.keyframes.find((k) => k.frame === frame)
        if (keyframe) {
          Object.assign(keyframe, updates)
          state.isDirty = true
        }
      })
    },

    deleteKeyframe: (animationId, boneId, property, frame) => {
      set((state) => {
        const animation = state.animations.find((a) => a.id === animationId)
        if (!animation) return

        const track = animation.tracks.find(
          (t) => t.boneId === boneId && t.property === property
        )
        if (!track) return

        track.keyframes = track.keyframes.filter((k) => k.frame !== frame)

        // Remove empty tracks
        if (track.keyframes.length === 0) {
          animation.tracks = animation.tracks.filter((t) => t !== track)
        }

        state.isDirty = true
      })
      get().pushHistory('Delete keyframe')
    },

    // Editor State Actions
    setMode: (mode) => {
      set((state) => {
        const wasAnimate = state.mode === 'animate'
        state.mode = mode

        if (wasAnimate && mode !== 'animate') {
          state.timeline.isPlaying = false
          if (state.restPoseSnapshot) {
            state.skeleton.bones.forEach((bone) => {
              const rest = state.restPoseSnapshot?.[bone.id]
              if (!rest) return
              bone.position = [...rest.position]
              bone.rotation = [...rest.rotation]
              bone.scale = [...rest.scale]
            })
          }
        }
      })
    },

    setTransformMode: (mode) => {
      set((state) => {
        state.transformMode = mode
      })
    },

    setSelection: (selection) => {
      set((state) => {
        state.selection = selection
      })
    },

    updateViewportSettings: (settings) => {
      set((state) => {
        Object.assign(state.viewportSettings, settings)
      })
    },

    updateTimeline: (timelineState) => {
      set((state) => {
        Object.assign(state.timeline, timelineState)
      })
    },

    updateWeightPaintSettings: (settings) => {
      set((state) => {
        Object.assign(state.weightPaintSettings, settings)
      })
    },

    updateAutoWeightSettings: (settings) => {
      set((state) => {
        const next = { ...state.autoWeightSettings, ...settings }
        const falloff = Math.min(6, Math.max(0.1, next.falloff))
        const smoothIterations = Math.min(10, Math.max(0, Math.round(next.smoothIterations)))
        const neighborWeight = Math.min(1, Math.max(0, next.neighborWeight))
        const method = next.method === 'heatmap' || next.method === 'nearest' ? next.method : 'envelope'

        state.autoWeightSettings = {
          method,
          falloff,
          smoothIterations,
          neighborWeight,
        }
      })
    },

    updateAutoBoneSettings: (settings) => {
      set((state) => {
        state.autoBoneSettings = normalizeAutoBoneSettings({
          ...state.autoBoneSettings,
          ...settings,
        })
      })
    },

    setRiggingOffset: (offset) => {
      set((state) => {
        state.riggingOffset = offset
      })
    },

    // Mesh Hierarchy Actions
    setMeshHierarchy: (hierarchy) => {
      set((state) => {
        state.meshHierarchy = hierarchy
      })
    },

    toggleMeshVisibility: (id) => {
      const toggleNode = (nodes: MeshNode[]): boolean => {
        for (const node of nodes) {
          if (node.id === id) {
            node.visible = !node.visible
            return true
          }
          if (toggleNode(node.children)) return true
        }
        return false
      }

      set((state) => {
        toggleNode(state.meshHierarchy)
      })
    },

    // History Actions
    pushHistory: (description) => {
      const state = get()
      const historyState: HistoryState = {
        skeleton: JSON.parse(JSON.stringify(state.skeleton)),
        weightMap: JSON.parse(JSON.stringify(state.weightMap)),
        animations: JSON.parse(JSON.stringify(state.animations)),
      }

      set((state) => {
        // Remove any redo states
        state.history = state.history.slice(0, state.historyIndex + 1)

        // Add new state
        state.history.push({
          state: historyState,
          description,
          timestamp: Date.now(),
        })

        // Limit history size
        if (state.history.length > state.maxHistorySize) {
          state.history.shift()
        } else {
          state.historyIndex++
        }
      })
    },

    undo: () => {
      const state = get()
      if (state.historyIndex < 0) return

      const entry = state.history[state.historyIndex]
      if (!entry) return

      set((s) => {
        s.skeleton = entry.state.skeleton
        s.weightMap = entry.state.weightMap
        s.animations = entry.state.animations
        s.historyIndex--
        s.isDirty = true
      })
    },

    redo: () => {
      const state = get()
      if (state.historyIndex >= state.history.length - 1) return

      const entry = state.history[state.historyIndex + 1]
      if (!entry) return

      set((s) => {
        s.skeleton = entry.state.skeleton
        s.weightMap = entry.state.weightMap
        s.animations = entry.state.animations
        s.historyIndex++
        s.isDirty = true
      })
    },

    clearHistory: () => {
      set((state) => {
        state.history = []
        state.historyIndex = -1
      })
    },

    // Auto-save Actions
    updateAutoSaveTime: () => {
      set((state) => {
        state.lastAutoSave = Date.now()
      })
    },
  }))
)
