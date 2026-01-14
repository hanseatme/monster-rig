import { useState, useCallback, useEffect } from 'react'
import { useEditorStore } from '../../store'
import type { BoneData } from '../../types'

function NumberInput({
  value,
  onChange,
  min: _min,
  max: _max,
  step: _step = 0.1,
  label,
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  label?: string
}) {
  // Note: _min, _max, _step are reserved for future input validation
  const [localValue, setLocalValue] = useState(value.toFixed(3))

  useEffect(() => {
    setLocalValue(value.toFixed(3))
  }, [value])

  const handleBlur = () => {
    const num = parseFloat(localValue)
    if (!isNaN(num)) {
      onChange(num)
    } else {
      setLocalValue(value.toFixed(3))
    }
  }

  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-xs text-gray-500 w-4">{label}</span>}
      <input
        type="text"
        className="input flex-1 text-xs text-center"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => e.key === 'Enter' && handleBlur()}
      />
    </div>
  )
}

function Vector3Input({
  value,
  onChange,
  labels = ['X', 'Y', 'Z'],
}: {
  value: [number, number, number]
  onChange: (value: [number, number, number]) => void
  labels?: [string, string, string]
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {labels.map((label, i) => (
        <NumberInput
          key={label}
          label={label}
          value={value[i]}
          onChange={(v) => {
            const newValue = [...value] as [number, number, number]
            newValue[i] = v
            onChange(newValue)
          }}
        />
      ))}
    </div>
  )
}

function RotationLimitInput({
  value,
  onChange,
  label,
}: {
  value: [number, number]
  onChange: (value: [number, number]) => void
  label: string
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 w-4">{label}</span>
      <NumberInput
        value={value[0]}
        onChange={(v) => onChange([v, value[1]])}
        min={-180}
        max={180}
      />
      <span className="text-xs text-gray-500">to</span>
      <NumberInput
        value={value[1]}
        onChange={(v) => onChange([value[0], v])}
        min={-180}
        max={180}
      />
    </div>
  )
}

function BoneProperties({ bone }: { bone: BoneData }) {
  const { updateBone, pushHistory, skeleton, setBoneParent } = useEditorStore()
  const [localName, setLocalName] = useState(bone.name)

  useEffect(() => {
    setLocalName(bone.name)
  }, [bone.name])

  const handleNameChange = useCallback(() => {
    if (localName !== bone.name) {
      updateBone(bone.id, { name: localName })
      pushHistory(`Rename bone to ${localName}`)
    }
  }, [bone.id, bone.name, localName, updateBone, pushHistory])

  // Get all potential parent bones (excluding self and descendants)
  const getDescendantIds = (boneId: string): string[] => {
    const children = skeleton.bones.filter(b => b.parentId === boneId)
    return children.flatMap(child => [child.id, ...getDescendantIds(child.id)])
  }
  const descendantIds = getDescendantIds(bone.id)
  const availableParents = skeleton.bones.filter(b =>
    b.id !== bone.id && !descendantIds.includes(b.id)
  )

  const handleParentChange = useCallback((newParentId: string | null) => {
    const oldParent = skeleton.bones.find(b => b.id === bone.parentId)
    const newParent = skeleton.bones.find(b => b.id === newParentId)
    setBoneParent(bone.id, newParentId)
    pushHistory(`Changed ${bone.name} parent from ${oldParent?.name || 'none'} to ${newParent?.name || 'none'}`)
  }, [bone.id, bone.name, bone.parentId, skeleton.bones, setBoneParent, pushHistory])

  return (
    <div className="space-y-4">
      {/* Name */}
      <div>
        <label className="panel-header block mb-2">Name</label>
        <input
          type="text"
          className="input w-full"
          value={localName}
          onChange={(e) => setLocalName(e.target.value)}
          onBlur={handleNameChange}
          onKeyDown={(e) => e.key === 'Enter' && handleNameChange()}
        />
      </div>

      {/* Parent Bone */}
      <div>
        <label className="panel-header block mb-2">Parent Bone</label>
        <select
          className="input w-full"
          value={bone.parentId || ''}
          onChange={(e) => handleParentChange(e.target.value || null)}
        >
          <option value="">-- No Parent (Root) --</option>
          {availableParents.map(parent => (
            <option key={parent.id} value={parent.id}>
              {parent.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-500 mt-1">
          You can also drag bones in the Hierarchy panel to change parents
        </p>
      </div>

      {/* Position */}
      <div>
        <label className="panel-header block mb-2">Position</label>
        <Vector3Input
          value={bone.position}
          onChange={(position) => updateBone(bone.id, { position })}
        />
      </div>

      {/* Rotation (Euler display) */}
      <div>
        <label className="panel-header block mb-2">Rotation (Degrees)</label>
        <Vector3Input
          value={quaternionToEuler(bone.rotation)}
          onChange={(euler) => updateBone(bone.id, { rotation: eulerToQuaternion(euler) })}
        />
      </div>

      {/* Scale */}
      <div>
        <label className="panel-header block mb-2">Scale</label>
        <Vector3Input
          value={bone.scale}
          onChange={(scale) => updateBone(bone.id, { scale })}
        />
      </div>

      {/* Length */}
      <div>
        <label className="panel-header block mb-2">Bone Length</label>
        <NumberInput
          value={bone.length}
          onChange={(length) => updateBone(bone.id, { length })}
          min={0.01}
          step={0.1}
        />
      </div>

      {/* Rotation Limits */}
      <div>
        <label className="panel-header block mb-2">Rotation Limits</label>
        <div className="space-y-2">
          <RotationLimitInput
            label="X"
            value={bone.rotationLimits.x}
            onChange={(x) =>
              updateBone(bone.id, {
                rotationLimits: { ...bone.rotationLimits, x },
              })
            }
          />
          <RotationLimitInput
            label="Y"
            value={bone.rotationLimits.y}
            onChange={(y) =>
              updateBone(bone.id, {
                rotationLimits: { ...bone.rotationLimits, y },
              })
            }
          />
          <RotationLimitInput
            label="Z"
            value={bone.rotationLimits.z}
            onChange={(z) =>
              updateBone(bone.id, {
                rotationLimits: { ...bone.rotationLimits, z },
              })
            }
          />
        </div>
      </div>
    </div>
  )
}

function WeightPaintProperties() {
  const {
    weightPaintSettings,
    updateWeightPaintSettings,
    autoWeightSettings,
    updateAutoWeightSettings,
  } = useEditorStore()

  return (
    <div className="space-y-4">
      {/* Brush Size */}
      <div>
        <label className="panel-header block mb-2">
          Brush Size: {weightPaintSettings.brushSize}
        </label>
        <input
          type="range"
          className="w-full"
          min={1}
          max={100}
          value={weightPaintSettings.brushSize}
          onChange={(e) =>
            updateWeightPaintSettings({ brushSize: parseInt(e.target.value) })
          }
        />
      </div>

      {/* Brush Strength */}
      <div>
        <label className="panel-header block mb-2">
          Brush Strength: {(weightPaintSettings.brushStrength * 100).toFixed(0)}%
        </label>
        <input
          type="range"
          className="w-full"
          min={1}
          max={100}
          value={weightPaintSettings.brushStrength * 100}
          onChange={(e) =>
            updateWeightPaintSettings({
              brushStrength: parseInt(e.target.value) / 100,
            })
          }
        />
      </div>

      {/* Brush Mode */}
      <div>
        <label className="panel-header block mb-2">Brush Mode</label>
        <div className="flex gap-2">
          {(['add', 'subtract', 'smooth'] as const).map((mode) => (
            <button
              key={mode}
              className={`btn flex-1 text-xs capitalize ${
                weightPaintSettings.brushMode === mode ? 'btn-primary' : ''
              }`}
              onClick={() => updateWeightPaintSettings({ brushMode: mode })}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Weight Gradient Legend */}
      <div>
        <label className="panel-header block mb-2">Weight Legend</label>
        <div className="h-4 weight-gradient rounded" />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>

      {/* Auto Weights */}
      <div className="space-y-3">
        <label className="panel-header block">Auto Weights</label>

        <div className="space-y-1">
          <span className="text-xs text-gray-500">Method</span>
          <select
            className="input w-full"
            value={autoWeightSettings.method}
            onChange={(e) =>
              updateAutoWeightSettings({
                method: e.target.value as 'envelope' | 'heatmap' | 'nearest',
              })
            }
            onKeyDown={(e) => e.stopPropagation()}
          >
            <option value="envelope">Envelope</option>
            <option value="heatmap">Heatmap</option>
            <option value="nearest">Nearest</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-gray-500">
            Falloff: {autoWeightSettings.falloff.toFixed(2)}
          </label>
          <input
            type="range"
            className="w-full"
            min={0.1}
            max={6}
            step={0.1}
            value={autoWeightSettings.falloff}
            onChange={(e) =>
              updateAutoWeightSettings({ falloff: parseFloat(e.target.value) })
            }
          />
        </div>

        <div>
          <label className="text-xs text-gray-500">
            Smooth Iterations: {autoWeightSettings.smoothIterations}
          </label>
          <input
            type="range"
            className="w-full"
            min={0}
            max={10}
            step={1}
            value={autoWeightSettings.smoothIterations}
            onChange={(e) =>
              updateAutoWeightSettings({
                smoothIterations: parseInt(e.target.value, 10),
              })
            }
          />
        </div>

        <div>
          <label className="text-xs text-gray-500">
            Neighbor Weight: {(autoWeightSettings.neighborWeight * 100).toFixed(0)}%
          </label>
          <input
            type="range"
            className="w-full"
            min={0}
            max={1}
            step={0.05}
            value={autoWeightSettings.neighborWeight}
            onChange={(e) =>
              updateAutoWeightSettings({
                neighborWeight: parseFloat(e.target.value),
              })
            }
          />
        </div>
      </div>
    </div>
  )
}

function AnimationProperties() {
  const { currentAnimationId, animations, updateAnimation, timeline, updateTimeline } =
    useEditorStore()

  const animation = animations.find((a) => a.id === currentAnimationId)
  if (!animation) return null

  return (
    <div className="space-y-4">
      {/* Animation Name */}
      <div>
        <label className="panel-header block mb-2">Animation Name</label>
        <input
          type="text"
          className="input w-full"
          value={animation.name}
          onChange={(e) =>
            updateAnimation(animation.id, { name: e.target.value })
          }
        />
      </div>

      {/* FPS */}
      <div>
        <label className="panel-header block mb-2">FPS</label>
        <select
          className="input w-full"
          value={animation.fps}
          onChange={(e) => {
            const fps = parseInt(e.target.value)
            updateAnimation(animation.id, { fps })
            updateTimeline({ fps })
          }}
        >
          <option value={24}>24 FPS</option>
          <option value={30}>30 FPS</option>
          <option value={60}>60 FPS</option>
        </select>
      </div>

      {/* Frame Count */}
      <div>
        <label className="panel-header block mb-2">Frame Count</label>
        <NumberInput
          value={animation.frameCount}
          onChange={(frameCount) => {
            updateAnimation(animation.id, { frameCount: Math.floor(frameCount) })
            updateTimeline({ frameEnd: Math.floor(frameCount) })
          }}
          min={1}
          step={1}
        />
      </div>

      {/* Duration */}
      <div>
        <label className="panel-header block mb-2">Duration</label>
        <span className="text-sm">
          {(animation.frameCount / animation.fps).toFixed(2)}s
        </span>
      </div>

      {/* Loop */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={timeline.loop}
            onChange={(e) => updateTimeline({ loop: e.target.checked })}
          />
          <span className="text-sm">Loop Animation</span>
        </label>
      </div>
    </div>
  )
}

// Utility functions for rotation conversion
function quaternionToEuler(q: [number, number, number, number]): [number, number, number] {
  const [x, y, z, w] = q

  // Roll (X-axis rotation)
  const sinr_cosp = 2 * (w * x + y * z)
  const cosr_cosp = 1 - 2 * (x * x + y * y)
  const roll = Math.atan2(sinr_cosp, cosr_cosp)

  // Pitch (Y-axis rotation)
  const sinp = 2 * (w * y - z * x)
  let pitch: number
  if (Math.abs(sinp) >= 1) {
    pitch = (Math.PI / 2) * Math.sign(sinp)
  } else {
    pitch = Math.asin(sinp)
  }

  // Yaw (Z-axis rotation)
  const siny_cosp = 2 * (w * z + x * y)
  const cosy_cosp = 1 - 2 * (y * y + z * z)
  const yaw = Math.atan2(siny_cosp, cosy_cosp)

  return [
    (roll * 180) / Math.PI,
    (pitch * 180) / Math.PI,
    (yaw * 180) / Math.PI,
  ]
}

function eulerToQuaternion(euler: [number, number, number]): [number, number, number, number] {
  const [roll, pitch, yaw] = euler.map((e) => (e * Math.PI) / 180)

  const cr = Math.cos(roll * 0.5)
  const sr = Math.sin(roll * 0.5)
  const cp = Math.cos(pitch * 0.5)
  const sp = Math.sin(pitch * 0.5)
  const cy = Math.cos(yaw * 0.5)
  const sy = Math.sin(yaw * 0.5)

  return [
    sr * cp * cy - cr * sp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
    cr * cp * cy + sr * sp * sy,
  ]
}

export default function PropertiesPanel() {
  const { mode, selection, skeleton } = useEditorStore()

  const selectedBone = skeleton.bones.find((b) => selection.ids.includes(b.id))

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">Properties</div>

      <div className="flex-1 overflow-auto p-4">
        {mode === 'weight-paint' ? (
          <WeightPaintProperties />
        ) : mode === 'animate' ? (
          <AnimationProperties />
        ) : selection.type === 'bone' && selectedBone ? (
          <BoneProperties bone={selectedBone} />
        ) : (
          <div className="text-center text-gray-500 text-sm mt-8">
            Select a bone to view its properties
          </div>
        )}
      </div>
    </div>
  )
}
