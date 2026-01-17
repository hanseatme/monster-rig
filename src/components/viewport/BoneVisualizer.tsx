import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import { TransformControls, Line } from '@react-three/drei'
import * as THREE from 'three'
import { ThreeEvent } from '@react-three/fiber'
import { useEditorStore } from '../../store'
import type { BoneData } from '../../types'

interface BoneProps {
  bone: BoneData
  isSelected: boolean
  hasKeyframe: boolean
  onClick: (e: ThreeEvent<MouseEvent>) => void
}

function OctahedronBone({ bone, isSelected, hasKeyframe, onClick }: BoneProps) {
  const meshRef = useRef<THREE.Mesh>(null)

  const geometry = useMemo(() => {
    const geo = new THREE.OctahedronGeometry(0.15 * Math.max(0.5, bone.length))
    geo.scale(0.5, 1, 0.5)
    return geo
  }, [bone.length])

  const color = isSelected ? '#ff8c00' : hasKeyframe ? '#ffd700' : '#ffffff'

  return (
    <group position={bone.position} quaternion={new THREE.Quaternion(...bone.rotation)}>
      <mesh
        ref={meshRef}
        geometry={geometry}
        onClick={onClick}
        onPointerOver={(e) => {
          e.stopPropagation()
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          document.body.style.cursor = 'default'
        }}
      >
        <meshStandardMaterial
          color={color}
          emissive={isSelected ? '#ff4400' : '#000000'}
          emissiveIntensity={isSelected ? 0.5 : 0}
          transparent
          opacity={0.9}
        />
      </mesh>
      {/* Bone tip indicator */}
      <mesh position={[0, bone.length, 0]}>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  )
}

function StickBone({ bone, isSelected, hasKeyframe, onClick }: BoneProps) {
  const color = isSelected ? '#ff8c00' : hasKeyframe ? '#ffd700' : '#ffffff'

  return (
    <group position={bone.position} quaternion={new THREE.Quaternion(...bone.rotation)}>
      {/* Joint sphere - clickable */}
      <mesh
        onClick={onClick}
        onPointerOver={(e) => {
          e.stopPropagation()
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          document.body.style.cursor = 'default'
        }}
      >
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={isSelected ? '#ff4400' : '#000000'}
          emissiveIntensity={isSelected ? 0.5 : 0}
        />
      </mesh>
      {/* Bone stick */}
      <mesh position={[0, bone.length / 2, 0]}>
        <cylinderGeometry args={[0.04, 0.04, bone.length, 8]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {/* Tip sphere */}
      <mesh position={[0, bone.length, 0]}>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  )
}

function BoneConnection({ parent, child }: { parent: BoneData; child: BoneData }) {
  // Create fresh points each render - useMemo with array deps doesn't work reliably
  const points = [
    new THREE.Vector3(parent.position[0], parent.position[1], parent.position[2]),
    new THREE.Vector3(child.position[0], child.position[1], child.position[2]),
  ]

  return (
    <Line
      points={points}
      color="#666666"
      lineWidth={2}
    />
  )
}

// Transform controls for selected bone
function BoneTransformControls({ bone }: { bone: BoneData }) {
  const { transformMode, updateBone, pushHistory, riggingOffset } = useEditorStore()
  const targetRef = useRef<THREE.Mesh>(null)
  const isDragging = useRef(false)
  const [ready, setReady] = useState(false)
  const inverseOffset: [number, number, number] = [
    -riggingOffset[0],
    -riggingOffset[1],
    -riggingOffset[2],
  ]

  // Set ready when ref is available
  useEffect(() => {
    if (targetRef.current) {
      setReady(true)
    }
  }, [])

  // Keep target in sync with bone position (when not dragging)
  useEffect(() => {
    if (targetRef.current && !isDragging.current) {
      targetRef.current.position.set(...bone.position)
      targetRef.current.quaternion.set(...bone.rotation)
      targetRef.current.scale.set(...bone.scale)
    }
  }, [bone.position, bone.rotation, bone.scale])

  const handleChange = useCallback(() => {
    if (!targetRef.current) return

    const pos = targetRef.current.position
    const rot = targetRef.current.quaternion
    const scale = targetRef.current.scale

    updateBone(bone.id, {
      position: [pos.x, pos.y, pos.z],
      rotation: [rot.x, rot.y, rot.z, rot.w],
      scale: [scale.x, scale.y, scale.z],
    })
  }, [bone.id, updateBone])

  const handleDragStart = useCallback(() => {
    isDragging.current = true
  }, [])

  const handleDragEnd = useCallback(() => {
    isDragging.current = false
    pushHistory(`Transform bone: ${bone.name}`)
  }, [bone.name, pushHistory])

  // Map our transform mode to TransformControls mode
  const controlMode = transformMode === 'translate' ? 'translate' : transformMode === 'rotate' ? 'rotate' : 'scale'

  return (
    <>
      {/* Invisible target mesh for the transform controls */}
      <mesh
        ref={(ref) => {
          (targetRef as any).current = ref
          if (ref && !ready) setReady(true)
        }}
        position={bone.position}
        quaternion={new THREE.Quaternion(...bone.rotation)}
        scale={bone.scale}
      >
        <sphereGeometry args={[0.001]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {/* Transform controls attached to the target */}
      {ready && targetRef.current && (
        <group position={inverseOffset}>
          <TransformControls
            object={targetRef.current}
            mode={controlMode}
            size={0.8}
            showX
            showY
            showZ
            onObjectChange={handleChange}
            onMouseDown={handleDragStart}
            onMouseUp={handleDragEnd}
          />
        </group>
      )}
    </>
  )
}

export default function BoneVisualizer() {
  const {
    skeleton,
    selection,
    viewportSettings,
    currentAnimationId,
    animations,
    timeline,
    setSelection,
    mode,
  } = useEditorStore()

  const currentAnimation = animations.find((a) => a.id === currentAnimationId)

  // Track bones that have any keyframes in the animation (for visual indicator)
  const bonesWithKeyframes = useMemo(() => {
    if (!currentAnimation) return new Set<string>()

    const boneIds = new Set<string>()
    const currentFrameInt = Math.floor(timeline.currentFrame)
    currentAnimation.tracks.forEach((track) => {
      // Show gold color if bone has a keyframe at current frame, or has any keyframes at all
      const hasKeyframeAtCurrentFrame = track.keyframes.some(
        (kf) => kf.frame === currentFrameInt
      )
      if (hasKeyframeAtCurrentFrame || track.keyframes.length > 0) {
        boneIds.add(track.boneId)
      }
    })
    return boneIds
  }, [currentAnimation, timeline.currentFrame])

  const handleBoneClick = useCallback(
    (boneId: string) => (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation()

      // Handle selection
      if (e.nativeEvent.ctrlKey || e.nativeEvent.metaKey) {
        // Multi-select
        if (selection.ids.includes(boneId)) {
          setSelection({
            type: 'bone',
            ids: selection.ids.filter((id) => id !== boneId),
          })
        } else {
          setSelection({
            type: 'bone',
            ids: [...selection.ids, boneId],
          })
        }
      } else {
        setSelection({ type: 'bone', ids: [boneId] })
      }
    },
    [selection, setSelection]
  )

  const BoneComponent = viewportSettings.boneStyle === 'octahedron' ? OctahedronBone : StickBone

  // Get selected bone for transform controls
  const selectedBone = selection.type === 'bone' && selection.ids.length === 1
    ? skeleton.bones.find((b) => b.id === selection.ids[0])
    : null

  return (
    <group>
      {/* Render bones */}
      {skeleton.bones.map((bone) => (
        <BoneComponent
          key={bone.id}
          bone={bone}
          isSelected={selection.type === 'bone' && selection.ids.includes(bone.id)}
          hasKeyframe={bonesWithKeyframes.has(bone.id)}
          onClick={handleBoneClick(bone.id)}
        />
      ))}

      {/* Render connections */}
      {skeleton.bones
        .filter((bone) => bone.parentId !== null)
        .map((bone) => {
          const parent = skeleton.bones.find((b) => b.id === bone.parentId)
          if (!parent) return null
          return <BoneConnection key={`${parent.id}-${bone.id}`} parent={parent} child={bone} />
        })}

      {/* Transform controls for selected bone */}
      {selectedBone && mode !== 'bone' && (
        <BoneTransformControls bone={selectedBone} />
      )}
    </group>
  )
}
