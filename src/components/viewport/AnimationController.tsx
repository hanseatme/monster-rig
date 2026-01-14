import { useRef, useCallback, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useEditorStore } from '../../store'
import type { Keyframe, BoneData } from '../../types'

function interpolateValue(
  keyframes: Keyframe[],
  frame: number,
  property: 'position' | 'rotation' | 'scale'
): number[] | null {
  if (keyframes.length === 0) return null

  // Sort keyframes by frame (should already be sorted, but ensure)
  const sortedKf = [...keyframes].sort((a, b) => a.frame - b.frame)

  // Find surrounding keyframes
  let prevKf: Keyframe | null = null
  let nextKf: Keyframe | null = null

  for (const kf of sortedKf) {
    if (kf.frame <= frame) {
      prevKf = kf
    }
    if (kf.frame >= frame && !nextKf) {
      nextKf = kf
    }
  }

  // Exact match
  if (prevKf && prevKf.frame === frame) {
    return prevKf.value
  }

  // Before first keyframe
  if (!prevKf) {
    return nextKf?.value || null
  }

  // After last keyframe
  if (!nextKf) {
    return prevKf.value
  }

  // Interpolate between keyframes
  const t = (frame - prevKf.frame) / (nextKf.frame - prevKf.frame)
  const interpolation = prevKf.interpolation

  if (interpolation === 'step') {
    return prevKf.value
  }

  const blend = interpolation === 'bezier' ? t * t * (3 - 2 * t) : t

  if (property === 'rotation') {
    const q1 = new THREE.Quaternion(prevKf.value[0], prevKf.value[1], prevKf.value[2], prevKf.value[3])
    const q2 = new THREE.Quaternion(nextKf!.value[0], nextKf!.value[1], nextKf!.value[2], nextKf!.value[3])
    q1.slerp(q2, blend)
    return [q1.x, q1.y, q1.z, q1.w]
  }

  return prevKf.value.map((v, i) => v + (nextKf!.value[i] - v) * blend)
}

// Store rest pose for FK calculations
interface RestPose {
  [boneId: string]: {
    position: [number, number, number]
    rotation: [number, number, number, number]
    localOffset: THREE.Vector3 // offset from parent in parent's local space
    localRotation: THREE.Quaternion // rotation relative to parent in rest pose
  }
}

// Calculate local offset from parent (used for FK)
function calculateLocalOffset(
  bone: BoneData,
  parentBone: BoneData | undefined
): THREE.Vector3 {
  if (!parentBone) {
    return new THREE.Vector3(bone.position[0], bone.position[1], bone.position[2])
  }

  // Calculate offset in world space
  const worldOffset = new THREE.Vector3(
    bone.position[0] - parentBone.position[0],
    bone.position[1] - parentBone.position[1],
    bone.position[2] - parentBone.position[2]
  )

  // Transform to parent's local space (inverse of parent rotation)
  const parentRotation = new THREE.Quaternion(
    parentBone.rotation[0],
    parentBone.rotation[1],
    parentBone.rotation[2],
    parentBone.rotation[3]
  )
  const inverseParentRotation = parentRotation.clone().invert()
  worldOffset.applyQuaternion(inverseParentRotation)

  return worldOffset
}

function calculateLocalRotation(
  bone: BoneData,
  parentBone: BoneData | undefined
): THREE.Quaternion {
  const boneRotation = new THREE.Quaternion(
    bone.rotation[0],
    bone.rotation[1],
    bone.rotation[2],
    bone.rotation[3]
  )

  if (!parentBone) {
    return boneRotation
  }

  const parentRotation = new THREE.Quaternion(
    parentBone.rotation[0],
    parentBone.rotation[1],
    parentBone.rotation[2],
    parentBone.rotation[3]
  )

  const inverseParentRotation = parentRotation.clone().invert()
  return inverseParentRotation.multiply(boneRotation)
}

// Apply Forward Kinematics - propagate parent rotations to children
function applyForwardKinematics(
  bones: BoneData[],
  restPose: RestPose,
  updateBone: (id: string, data: Partial<BoneData>) => void,
  animatedPositionIds: Set<string>,
  animatedRotationIds: Set<string>
) {
  // Build parent-children map
  const childrenMap = new Map<string | null, BoneData[]>()
  const currentTransforms = new Map<string, { position: THREE.Vector3; rotation: THREE.Quaternion }>()
  bones.forEach(bone => {
    const children = childrenMap.get(bone.parentId) || []
    children.push(bone)
    childrenMap.set(bone.parentId, children)
    currentTransforms.set(bone.id, {
      position: new THREE.Vector3(...bone.position),
      rotation: new THREE.Quaternion(...bone.rotation),
    })
  })

  // Process from root to leaves (BFS)
  const rootBones = childrenMap.get(null) || []
  const queue: BoneData[] = [...rootBones]

  while (queue.length > 0) {
    const bone = queue.shift()!
    const children = childrenMap.get(bone.id) || []

    // For each child, update its position based on parent's rotation
    for (const child of children) {
      const parentRest = restPose[bone.id]
      const childRest = restPose[child.id]

      if (parentRest && childRest) {
        const parentTransform = currentTransforms.get(bone.id)
        if (!parentTransform) continue

        const parentPos = parentTransform.position
        const parentRot = parentTransform.rotation

        if (!animatedPositionIds.has(child.id)) {
          // Calculate child's new world position
          const localOffset = childRest.localOffset.clone()
          localOffset.applyQuaternion(parentRot)

          const newChildPos = parentPos.clone().add(localOffset)
          const existing = currentTransforms.get(child.id)
          currentTransforms.set(child.id, {
            position: newChildPos.clone(),
            rotation: existing?.rotation || new THREE.Quaternion(),
          })

          updateBone(child.id, {
            position: [newChildPos.x, newChildPos.y, newChildPos.z]
          })
        }

        if (!animatedRotationIds.has(child.id)) {
          const newChildRot = parentRot.clone().multiply(childRest.localRotation)
          const existing = currentTransforms.get(child.id)
          currentTransforms.set(child.id, {
            position: existing?.position || new THREE.Vector3(),
            rotation: newChildRot.clone(),
          })
          updateBone(child.id, {
            rotation: [newChildRot.x, newChildRot.y, newChildRot.z, newChildRot.w]
          })
        }
      }

      queue.push(child)
    }
  }
}

export default function AnimationController() {
  const lastFrameRef = useRef<number>(-1)
  const isPlayingRef = useRef<boolean>(false)
  const restPoseRef = useRef<RestPose>({})
  const hasInitializedRef = useRef<boolean>(false)

  // Initialize rest pose when animation starts or skeleton changes
  const initializeRestPose = useCallback(() => {
    const { skeleton } = useEditorStore.getState()
    const restPose: RestPose = {}

    skeleton.bones.forEach(bone => {
      const parent = bone.parentId
        ? skeleton.bones.find(b => b.id === bone.parentId)
        : undefined

      restPose[bone.id] = {
        position: [...bone.position] as [number, number, number],
        rotation: [...bone.rotation] as [number, number, number, number],
        localOffset: calculateLocalOffset(bone, parent),
        localRotation: calculateLocalRotation(bone, parent)
      }
    })

    restPoseRef.current = restPose
    hasInitializedRef.current = true
  }, [])

  // Apply animation to bones for a given frame
  const applyAnimation = useCallback((frame: number) => {
    const state = useEditorStore.getState()
    const { animations, currentAnimationId, skeleton, updateBone } = state

    const currentAnimation = animations.find((a) => a.id === currentAnimationId)
    if (!currentAnimation) return

    // Only apply if we have tracks to animate
    if (currentAnimation.tracks.length === 0) return

    // Initialize rest pose if not done yet
    if (!hasInitializedRef.current) {
      initializeRestPose()
    }

    // First pass: apply direct animation values (rotations)
    const animatedPositionIds = new Set<string>()
    const animatedRotationIds = new Set<string>()

    currentAnimation.tracks.forEach((track) => {
      const bone = skeleton.bones.find((b) => b.id === track.boneId)
      if (!bone) return

      // Skip if track has no keyframes
      if (track.keyframes.length === 0) return

      const value = interpolateValue(track.keyframes, frame, track.property)
      if (!value) return

      switch (track.property) {
        case 'position':
          updateBone(bone.id, { position: value as [number, number, number] })
          animatedPositionIds.add(bone.id)
          break
        case 'rotation':
          updateBone(bone.id, { rotation: value as [number, number, number, number] })
          animatedRotationIds.add(bone.id)
          break
        case 'scale':
          updateBone(bone.id, { scale: value as [number, number, number] })
          break
      }
    })

    // Second pass: apply Forward Kinematics to update child positions
    if ((animatedPositionIds.size > 0 || animatedRotationIds.size > 0) &&
        Object.keys(restPoseRef.current).length > 0) {
      // Get fresh skeleton state after rotation updates
      const freshState = useEditorStore.getState()
      applyForwardKinematics(
        freshState.skeleton.bones,
        restPoseRef.current,
        updateBone,
        animatedPositionIds,
        animatedRotationIds
      )
    }
  }, [initializeRestPose])

  // Reset rest pose when animation changes
  const prevAnimationIdRef = useRef<string | null>(null)
  const prevIsPlayingRef = useRef<boolean>(false)

  useEffect(() => {
    const unsubscribe = useEditorStore.subscribe((state) => {
      // Check if animation changed
      if (state.currentAnimationId !== prevAnimationIdRef.current) {
        prevAnimationIdRef.current = state.currentAnimationId
        hasInitializedRef.current = false
      }

      // Check if playback just started
      if (state.timeline.isPlaying && !prevIsPlayingRef.current) {
        initializeRestPose()
      }
      prevIsPlayingRef.current = state.timeline.isPlaying
    })
    return unsubscribe
  }, [initializeRestPose])

  // Handle playback using useFrame
  useFrame((_, delta) => {
    const state = useEditorStore.getState()
    const { timeline, animations, currentAnimationId, updateTimeline } = state

    const currentAnimation = animations.find((a) => a.id === currentAnimationId)

    // Track playing state
    isPlayingRef.current = timeline.isPlaying

    // Handle playback frame advancement
    if (timeline.isPlaying && currentAnimation) {
      // Calculate new frame
      const frameDelta = delta * timeline.fps
      let newFrame = timeline.currentFrame + frameDelta

      // Handle looping
      if (newFrame >= currentAnimation.frameCount) {
        if (timeline.loop) {
          newFrame = newFrame % currentAnimation.frameCount
        } else {
          newFrame = currentAnimation.frameCount
          updateTimeline({ isPlaying: false })
        }
      }

      updateTimeline({ currentFrame: newFrame })

      // Apply animation for this frame
      applyAnimation(newFrame)
      lastFrameRef.current = newFrame
    } else if (currentAnimation) {
      // Not playing - check if frame changed (timeline scrubbing)
      const currentFrame = timeline.currentFrame

      // Apply animation when frame changes (from scrubbing or starting)
      if (Math.abs(currentFrame - lastFrameRef.current) > 0.01) {
        applyAnimation(currentFrame)
        lastFrameRef.current = currentFrame
      }
    }
  })

  return null
}
