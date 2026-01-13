import { useRef, useCallback, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useEditorStore } from '../../store'
import type { Keyframe, BoneData } from '../../types'

function interpolateValue(
  keyframes: Keyframe[],
  frame: number
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

  switch (interpolation) {
    case 'step':
      return prevKf.value

    case 'linear':
      return prevKf.value.map((v, i) => v + (nextKf!.value[i] - v) * t)

    case 'bezier':
      // Simplified bezier - use smooth step
      const smoothT = t * t * (3 - 2 * t)
      return prevKf.value.map((v, i) => v + (nextKf!.value[i] - v) * smoothT)

    default:
      return prevKf.value
  }
}

// Store rest pose for FK calculations
interface RestPose {
  [boneId: string]: {
    position: [number, number, number]
    rotation: [number, number, number, number]
    localOffset: THREE.Vector3 // offset from parent in parent's local space
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

// Apply Forward Kinematics - propagate parent rotations to children
function applyForwardKinematics(
  bones: BoneData[],
  restPose: RestPose,
  updateBone: (id: string, data: Partial<BoneData>) => void
) {
  // Build parent-children map
  const childrenMap = new Map<string | null, BoneData[]>()
  bones.forEach(bone => {
    const children = childrenMap.get(bone.parentId) || []
    children.push(bone)
    childrenMap.set(bone.parentId, children)
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
        // Get current parent position and rotation
        const currentBone = bones.find(b => b.id === bone.id)
        if (!currentBone) continue

        const parentPos = new THREE.Vector3(...currentBone.position)
        const parentRot = new THREE.Quaternion(...currentBone.rotation)

        // Calculate child's new world position
        const localOffset = childRest.localOffset.clone()
        localOffset.applyQuaternion(parentRot)

        const newChildPos = parentPos.clone().add(localOffset)

        updateBone(child.id, {
          position: [newChildPos.x, newChildPos.y, newChildPos.z]
        })
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
        localOffset: calculateLocalOffset(bone, parent)
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
    const animatedBoneIds = new Set<string>()

    currentAnimation.tracks.forEach((track) => {
      const bone = skeleton.bones.find((b) => b.id === track.boneId)
      if (!bone) return

      // Skip if track has no keyframes
      if (track.keyframes.length === 0) return

      const value = interpolateValue(track.keyframes, frame)
      if (!value) return

      switch (track.property) {
        case 'position':
          updateBone(bone.id, { position: value as [number, number, number] })
          break
        case 'rotation':
          updateBone(bone.id, { rotation: value as [number, number, number, number] })
          animatedBoneIds.add(bone.id)
          break
        case 'scale':
          updateBone(bone.id, { scale: value as [number, number, number] })
          break
      }
    })

    // Second pass: apply Forward Kinematics to update child positions
    if (animatedBoneIds.size > 0 && Object.keys(restPoseRef.current).length > 0) {
      // Get fresh skeleton state after rotation updates
      const freshState = useEditorStore.getState()
      applyForwardKinematics(
        freshState.skeleton.bones,
        restPoseRef.current,
        updateBone
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
