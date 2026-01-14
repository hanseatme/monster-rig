import { useCallback } from 'react'
import { useEditorStore } from '../store'
import type { EditorMode, TransformMode, DisplayMode } from '../types'
import * as THREE from 'three'

const modeButtons: { mode: EditorMode; icon: string; label: string }[] = [
  { mode: 'select', icon: '↖', label: 'Select' },
  { mode: 'bone', icon: '🦴', label: 'Bone Mode' },
  { mode: 'weight-paint', icon: '🎨', label: 'Weight Paint' },
  { mode: 'animate', icon: '▶', label: 'Animate' },
]

const transformButtons: { mode: TransformMode; icon: string; label: string }[] = [
  { mode: 'translate', icon: '↔', label: 'Move' },
  { mode: 'rotate', icon: '↻', label: 'Rotate' },
  { mode: 'scale', icon: '⤢', label: 'Scale' },
]

const displayModes: { mode: DisplayMode; icon: string; label: string }[] = [
  { mode: 'textured', icon: '🖼', label: 'Textured' },
  { mode: 'solid', icon: '⬛', label: 'Solid' },
  { mode: 'wireframe', icon: '🔲', label: 'Wireframe' },
  { mode: 'xray', icon: '👁', label: 'X-Ray' },
]

// Store reference to the loaded model for auto-suggest
let loadedModelRef: THREE.Object3D | null = null

export function setLoadedModel(model: THREE.Object3D | null) {
  loadedModelRef = model
}

export function getLoadedModel(): THREE.Object3D | null {
  return loadedModelRef
}

export default function Toolbar({ onOpenAutoBones }: { onOpenAutoBones?: () => void }) {
  const {
    mode,
    setMode,
    transformMode,
    setTransformMode,
    viewportSettings,
    updateViewportSettings,
    modelPath,
  } = useEditorStore()

  const handleAutoSuggest = useCallback(() => {
    if (onOpenAutoBones) {
      onOpenAutoBones()
      return
    }
    alert('Auto Bones dialog is not available.')
  }, [onOpenAutoBones])

  const handleClearBones = useCallback(() => {
    const { skeleton, deleteBone } = useEditorStore.getState()
    if (skeleton.bones.length === 0) return

    if (confirm(`Delete all ${skeleton.bones.length} bones?`)) {
      // Delete all bones (copy array since we're modifying it)
      const boneIds = skeleton.bones.map(b => b.id)
      boneIds.forEach(id => deleteBone(id))
    }
  }, [])

  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-panel border-b border-panel-border overflow-x-auto">
      {/* Mode Selection */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <span className="text-xs text-gray-500 mr-2">Mode:</span>
        {modeButtons.map((btn) => (
          <button
            key={btn.mode}
            className={`px-3 py-1.5 rounded text-sm transition-colors ${
              mode === btn.mode
                ? 'bg-accent text-white'
                : 'bg-panel-border hover:bg-gray-600'
            }`}
            onClick={() => setMode(btn.mode)}
            title={btn.label}
          >
            {btn.icon}
          </button>
        ))}
      </div>

      {/* Separator */}
      <div className="w-px h-6 bg-panel-border flex-shrink-0" />

      {/* Transform Tools */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <span className="text-xs text-gray-500 mr-2">Transform:</span>
        {transformButtons.map((btn) => (
          <button
            key={btn.mode}
            className={`px-3 py-1.5 rounded text-sm transition-colors ${
              transformMode === btn.mode
                ? 'bg-accent text-white'
                : 'bg-panel-border hover:bg-gray-600'
            }`}
            onClick={() => setTransformMode(btn.mode)}
            title={btn.label}
          >
            {btn.icon}
          </button>
        ))}
      </div>

      {/* Separator */}
      <div className="w-px h-6 bg-panel-border flex-shrink-0" />

      {/* Rigging Tools */}
      {modelPath && (
        <>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-gray-500 mr-1">Rig:</span>
            <button
              className="px-2 py-1 rounded text-xs bg-green-600 hover:bg-green-500 transition-colors"
              onClick={handleAutoSuggest}
              title="Auto-suggest bone positions based on mesh analysis"
            >
              Auto Bones
            </button>
            <button
              className="px-2 py-1 rounded text-xs bg-panel-border hover:bg-gray-600 transition-colors"
              onClick={handleClearBones}
              title="Delete all bones"
            >
              Clear Bones
            </button>
          </div>

          {/* Separator */}
          <div className="w-px h-6 bg-panel-border flex-shrink-0" />
        </>
      )}

      {/* Display Mode */}
      {modelPath && (
        <>
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="text-xs text-gray-500 mr-2">Display:</span>
            {displayModes.map((dm) => (
              <button
                key={dm.mode}
                className={`px-2 py-1 rounded text-xs transition-colors ${
                  viewportSettings.displayMode === dm.mode
                    ? 'bg-accent text-white'
                    : 'bg-panel-border hover:bg-gray-600'
                }`}
                onClick={() => updateViewportSettings({ displayMode: dm.mode })}
                title={dm.label}
              >
                {dm.icon}
              </button>
            ))}
          </div>

          {/* Opacity Slider */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-gray-500">Opacity:</span>
            <input
              type="range"
              min="0"
              max="100"
              value={viewportSettings.modelOpacity * 100}
              onChange={(e) =>
                updateViewportSettings({ modelOpacity: parseInt(e.target.value) / 100 })
              }
              className="w-20 h-1 cursor-pointer"
              title={`Model Opacity: ${Math.round(viewportSettings.modelOpacity * 100)}%`}
            />
            <span className="text-xs text-gray-400 w-8">
              {Math.round(viewportSettings.modelOpacity * 100)}%
            </span>
          </div>

          {/* Separator */}
          <div className="w-px h-6 bg-panel-border flex-shrink-0" />
        </>
      )}

      {/* View Options */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-xs text-gray-500 mr-1">View:</span>
        <button
          className={`px-2 py-1 rounded text-xs transition-colors ${
            viewportSettings.showGrid
              ? 'bg-accent text-white'
              : 'bg-panel-border hover:bg-gray-600'
          }`}
          onClick={() => updateViewportSettings({ showGrid: !viewportSettings.showGrid })}
          title="Toggle Grid"
        >
          Grid
        </button>
        <button
          className={`px-2 py-1 rounded text-xs transition-colors ${
            viewportSettings.showBones
              ? 'bg-accent text-white'
              : 'bg-panel-border hover:bg-gray-600'
          }`}
          onClick={() => updateViewportSettings({ showBones: !viewportSettings.showBones })}
          title="Toggle Bones"
        >
          Bones
        </button>
        <button
          className={`px-2 py-1 rounded text-xs transition-colors ${
            viewportSettings.showAxes
              ? 'bg-accent text-white'
              : 'bg-panel-border hover:bg-gray-600'
          }`}
          onClick={() => updateViewportSettings({ showAxes: !viewportSettings.showAxes })}
          title="Toggle Axes"
        >
          Axes
        </button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bone Style Toggle */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-xs text-gray-500">Bone Style:</span>
        <select
          className="input text-xs"
          value={viewportSettings.boneStyle}
          onChange={(e) => updateViewportSettings({ boneStyle: e.target.value as 'octahedron' | 'stick' })}
        >
          <option value="octahedron">Octahedron</option>
          <option value="stick">Stick</option>
        </select>
      </div>
    </div>
  )
}
