import { useEffect, useRef, useCallback } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useEditorStore } from '../../store'
import { getLoadedModel } from '../Toolbar'
import type { BoneData } from '../../types'
import { calculateAutomaticWeightsForMesh } from '../../utils/weightCalculator'

/**
 * This component handles real-time skeletal deformation.
 * It only activates in 'animate' mode or when animation is playing.
 * In rigging modes (select, bone, weight-paint), bones can be positioned
 * without deforming the mesh.
 */
export default function SkeletonBinding() {
  const skinnedMeshesRef = useRef<THREE.SkinnedMesh[]>([])
  const originalMeshesRef = useRef<THREE.Mesh[]>([])
  const lastStructureHashRef = useRef<string>('')
  const lastAutoWeightHashRef = useRef<string>('')
  const isActiveRef = useRef<boolean>(false)
  const restPoseRef = useRef<Map<string, { position: [number, number, number], rotation: [number, number, number, number] }>>(new Map())

  // Store the rest pose when we first create skinned meshes
  const storeRestPose = useCallback((bones: BoneData[]) => {
    const restPose = new Map<string, { position: [number, number, number], rotation: [number, number, number, number] }>()
    bones.forEach(bone => {
      restPose.set(bone.id, {
        position: [...bone.position] as [number, number, number],
        rotation: [...bone.rotation] as [number, number, number, number]
      })
    })
    restPoseRef.current = restPose
  }, [])

  const cleanupSkinnedMeshes = useCallback(() => {
    // Show original meshes again
    originalMeshesRef.current.forEach(mesh => {
      mesh.visible = true
    })
    originalMeshesRef.current = []

    // Remove skinned meshes
    skinnedMeshesRef.current.forEach(sm => {
      if (sm.parent) {
        sm.parent.remove(sm)
      }
      sm.geometry.dispose()
      if (sm.skeleton) {
        sm.skeleton.dispose()
      }
    })
    skinnedMeshesRef.current = []
    lastStructureHashRef.current = ''
    lastAutoWeightHashRef.current = ''
  }, [])

  const rebuildSkinnedMeshes = useCallback((
    bones: BoneData[],
    weightMap: Record<string, { vertexWeights: [number, number][][] }>,
    autoWeightSettings: {
      method: 'envelope' | 'heatmap' | 'nearest'
      falloff: number
      smoothIterations: number
      neighborWeight: number
    }
  ) => {
    const loadedModel = getLoadedModel()
    if (!loadedModel || bones.length === 0) {
      cleanupSkinnedMeshes()
      return
    }

    const structureHash = bones.map(b => `${b.id}:${b.parentId}`).join('|')
    const autoWeightHash = `${autoWeightSettings.method}:${autoWeightSettings.falloff}:${autoWeightSettings.smoothIterations}:${autoWeightSettings.neighborWeight}`
    if (structureHash === lastStructureHashRef.current &&
        autoWeightHash === lastAutoWeightHashRef.current &&
        skinnedMeshesRef.current.length > 0) {
      return // Already built for this structure
    }

    // Clean up old skinned meshes first
    cleanupSkinnedMeshes()

    lastStructureHashRef.current = structureHash
    lastAutoWeightHashRef.current = autoWeightHash

    // Store rest pose for this skeleton
    storeRestPose(bones)

    // Build skeleton from rest pose
    const { skeleton, rootBone, boneIndexMap } = buildThreeSkeleton(bones)
    if (!skeleton || !rootBone) return

    // Find all meshes and store references
    const meshes: THREE.Mesh[] = []
    loadedModel.traverse((child) => {
      if (child instanceof THREE.Mesh && !(child instanceof THREE.SkinnedMesh)) {
        meshes.push(child)
      }
    })

    originalMeshesRef.current = meshes

    // Convert each mesh to skinned mesh
    meshes.forEach((mesh) => {
      const skinnedMesh = createSkinnedMesh(
        mesh,
        skeleton,
        rootBone,
        bones,
        weightMap,
        boneIndexMap,
        autoWeightSettings
      )

      if (skinnedMesh && mesh.parent) {
        // Hide original mesh
        mesh.visible = false
        mesh.parent.add(skinnedMesh)
        skinnedMeshesRef.current.push(skinnedMesh)
      }
    })

    console.log(`Created ${skinnedMeshesRef.current.length} skinned meshes with ${bones.length} bones`)
  }, [cleanupSkinnedMeshes, storeRestPose])

  // Subscribe to mode and playback changes
  useEffect(() => {
    const checkShouldBeActive = () => {
      const state = useEditorStore.getState()
      // Active in animate mode OR when animation is playing
      return state.mode === 'animate' || state.timeline.isPlaying
    }

    const handleStateChange = () => {
      const shouldBeActive = checkShouldBeActive()
      const { skeleton, weightMap, autoWeightSettings } = useEditorStore.getState()

      if (shouldBeActive && !isActiveRef.current) {
        // Transitioning to active state
        isActiveRef.current = true
        if (skeleton.bones.length > 0) {
          rebuildSkinnedMeshes(skeleton.bones, weightMap, autoWeightSettings)
        }
      } else if (!shouldBeActive && isActiveRef.current) {
        // Transitioning to inactive state
        isActiveRef.current = false
        cleanupSkinnedMeshes()
      }
    }

    // Initial check
    handleStateChange()

    const unsubscribe = useEditorStore.subscribe((state, prevState) => {
      // Check for mode change or playback change
      if (state.mode !== prevState.mode ||
          state.timeline.isPlaying !== prevState.timeline.isPlaying) {
        handleStateChange()
      }

      // If active, check for bone structure changes
      if (isActiveRef.current) {
        const bones = state.skeleton.bones
        const prevBones = prevState.skeleton.bones

        // Check if bone structure changed (added/removed/reparented)
        const structureHash = bones.map(b => `${b.id}:${b.parentId}`).join('|')
        const prevStructureHash = prevBones.map(b => `${b.id}:${b.parentId}`).join('|')

        const autoWeightHash = `${state.autoWeightSettings.method}:${state.autoWeightSettings.falloff}:${state.autoWeightSettings.smoothIterations}:${state.autoWeightSettings.neighborWeight}`

        if (structureHash !== prevStructureHash || autoWeightHash !== lastAutoWeightHashRef.current) {
          rebuildSkinnedMeshes(bones, state.weightMap, state.autoWeightSettings)
        }
      }
    })

    return () => {
      unsubscribe()
      cleanupSkinnedMeshes()
    }
  }, [rebuildSkinnedMeshes, cleanupSkinnedMeshes])

  // Update bone transforms every frame (only when active)
  useFrame(() => {
    if (!isActiveRef.current || skinnedMeshesRef.current.length === 0) return

    const { skeleton: editorSkeleton } = useEditorStore.getState()
    if (editorSkeleton.bones.length === 0) return

    // Update each skinned mesh's skeleton with current bone transforms
    skinnedMeshesRef.current.forEach(skinnedMesh => {
      if (!skinnedMesh.skeleton) return
      skinnedMesh.updateMatrixWorld(true)
      updateBoneTransforms(
        skinnedMesh.skeleton,
        editorSkeleton.bones,
        restPoseRef.current,
        skinnedMesh.matrixWorld
      )
    })
  })

  return null
}

interface SkeletonResult {
  skeleton: THREE.Skeleton | null
  rootBone: THREE.Bone | null
  boneIndexMap: Map<string, number>
}

function buildThreeSkeleton(bones: BoneData[]): SkeletonResult {
  if (bones.length === 0) {
    return { skeleton: null, rootBone: null, boneIndexMap: new Map() }
  }

  const boneMap = new Map<string, THREE.Bone>()
  const boneIndexMap = new Map<string, number>()
  const threeBones: THREE.Bone[] = []

  // Create all bones first
  bones.forEach((boneData, index) => {
    const bone = new THREE.Bone()
    bone.name = boneData.name
    bone.userData.editorId = boneData.id
    boneMap.set(boneData.id, bone)
    boneIndexMap.set(boneData.id, index)
    threeBones.push(bone)
  })

  // Set up hierarchy and transforms (using rest pose positions)
  bones.forEach((boneData) => {
    const bone = boneMap.get(boneData.id)!
    const worldPos = new THREE.Vector3(...boneData.position)
    const worldRot = new THREE.Quaternion(...boneData.rotation)

    if (boneData.parentId) {
      const parent = boneMap.get(boneData.parentId)
      if (parent) {
        parent.add(bone)

        // Calculate local position relative to parent
        const parentData = bones.find(b => b.id === boneData.parentId)!
        const parentPos = new THREE.Vector3(...parentData.position)
        const parentRot = new THREE.Quaternion(...parentData.rotation)

        const localPos = worldPos.clone().sub(parentPos)
        localPos.applyQuaternion(parentRot.clone().invert())
        bone.position.copy(localPos)

        const localRot = parentRot.clone().invert().multiply(worldRot)
        bone.quaternion.copy(localRot)
      }
    } else {
      bone.position.copy(worldPos)
      bone.quaternion.copy(worldRot)
    }

    bone.scale.set(...boneData.scale)
  })

  // Find root bones
  const rootBones = bones.filter(b => !b.parentId).map(b => boneMap.get(b.id)!)

  let rootBone: THREE.Bone
  if (rootBones.length === 0) {
    return { skeleton: null, rootBone: null, boneIndexMap }
  } else if (rootBones.length === 1) {
    rootBone = rootBones[0]
  } else {
    rootBone = new THREE.Bone()
    rootBone.name = 'Root'
    rootBone.userData.editorId = '__root__'
    rootBones.forEach(rb => rootBone.add(rb))
    threeBones.unshift(rootBone)
    // Shift indices
    const newMap = new Map<string, number>()
    boneIndexMap.forEach((idx, id) => newMap.set(id, idx + 1))
    boneIndexMap.clear()
    newMap.forEach((idx, id) => boneIndexMap.set(id, idx))
  }

  rootBone.updateMatrixWorld(true)

  const skeleton = new THREE.Skeleton(threeBones)
  return { skeleton, rootBone, boneIndexMap }
}

function createSkinnedMesh(
  mesh: THREE.Mesh,
  _skeleton: THREE.Skeleton,
  rootBone: THREE.Bone,
  editorBones: BoneData[],
  weightMap: Record<string, { vertexWeights: [number, number][][] }>,
  boneIndexMap: Map<string, number>,
  autoWeightSettings: {
    method: 'envelope' | 'heatmap' | 'nearest'
    falloff: number
    smoothIterations: number
    neighborWeight: number
  }
): THREE.SkinnedMesh | null {
  try {
    const geometry = mesh.geometry.clone()

    // Clone materials properly
    const material = Array.isArray(mesh.material)
      ? mesh.material.map(m => m.clone())
      : mesh.material.clone()

    // Get mesh's world matrix for vertex position calculation
    mesh.updateMatrixWorld(true)
    const meshWorldMatrix = mesh.matrixWorld.clone()

    const meshWeights = weightMap[mesh.name]
    const vertexCount = geometry.attributes.position.count

    const needsAutoWeights = !meshWeights ||
      meshWeights.vertexWeights.length < vertexCount ||
      meshWeights.vertexWeights.some((w) => !w || w.length === 0)

    let autoWeights: [number, number][][] | null = null
    const getAutoWeights = () => {
      if (!autoWeights) {
        autoWeights = calculateAutomaticWeightsForMesh(mesh, editorBones, {
          method: autoWeightSettings.method,
          falloff: autoWeightSettings.falloff,
          smoothIterations: autoWeightSettings.smoothIterations,
          neighborWeight: autoWeightSettings.neighborWeight,
        })
      }
      return autoWeights
    }

    const mapToSkeletonIndices = (weights: [number, number][]) => {
      return weights.map(([boneIdx, weight]) => {
        const bone = editorBones[boneIdx]
        const mapped = bone ? boneIndexMap.get(bone.id) ?? boneIdx : boneIdx
        return [mapped, weight] as [number, number]
      })
    }

    const skinIndices: number[] = []
    const skinWeights: number[] = []

    for (let i = 0; i < vertexCount; i++) {
      let weights: [number, number][] = []

      if (meshWeights && meshWeights.vertexWeights[i]?.length) {
        weights = mapToSkeletonIndices(meshWeights.vertexWeights[i])
      } else if (needsAutoWeights) {
        const auto = getAutoWeights()[i] || []
        weights = mapToSkeletonIndices(auto)
      }

      // Auto-weight to nearest bone if no weights defined
      if (weights.length === 0 && editorBones.length > 0) {
        const pos = new THREE.Vector3()
        pos.fromBufferAttribute(geometry.attributes.position, i)
        pos.applyMatrix4(meshWorldMatrix)

        let nearestBoneId: string | null = null
        let nearestDist = Infinity

        editorBones.forEach((bone) => {
          const bonePos = new THREE.Vector3(...bone.position)
          const dist = pos.distanceTo(bonePos)
          if (dist < nearestDist) {
            nearestDist = dist
            nearestBoneId = bone.id
          }
        })

        if (nearestBoneId) {
          const boneIdx = boneIndexMap.get(nearestBoneId) ?? 0
          weights = [[boneIdx, 1.0]]
        }
      }

      // Take top 4 weights
      const sorted = [...weights].sort((a, b) => b[1] - a[1]).slice(0, 4)
      while (sorted.length < 4) sorted.push([0, 0])

      // Normalize
      const total = sorted.reduce((sum, [, w]) => sum + w, 0)
      if (total > 0) {
        sorted.forEach((entry, idx) => {
          sorted[idx] = [entry[0], entry[1] / total]
        })
      } else {
        sorted[0] = [0, 1]
      }

      sorted.forEach(([boneIdx, weight]) => {
        skinIndices.push(boneIdx)
        skinWeights.push(weight)
      })
    }

    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4))
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4))

    const skinnedMesh = new THREE.SkinnedMesh(geometry, material)
    skinnedMesh.name = mesh.name + '_skinned'

    // IMPORTANT: Copy the exact transform from the original mesh
    // This ensures the skinned mesh is at the same position/scale as the original
    skinnedMesh.position.copy(mesh.position)
    skinnedMesh.rotation.copy(mesh.rotation)
    skinnedMesh.scale.copy(mesh.scale)
    skinnedMesh.frustumCulled = false

    // Clone the bone hierarchy for this mesh
    const clonedRoot = cloneBoneHierarchy(rootBone)
    skinnedMesh.add(clonedRoot)

    // Create skeleton from cloned bones
    const clonedBones: THREE.Bone[] = []
    clonedRoot.traverse((child) => {
      if (child instanceof THREE.Bone) {
        clonedBones.push(child)
      }
    })

    const clonedSkeleton = new THREE.Skeleton(clonedBones)
    skinnedMesh.bind(clonedSkeleton)

    return skinnedMesh
  } catch (error) {
    console.error('Failed to create skinned mesh:', error)
    return null
  }
}

function cloneBoneHierarchy(bone: THREE.Bone): THREE.Bone {
  const clone = new THREE.Bone()
  clone.name = bone.name
  clone.userData = { ...bone.userData }
  clone.position.copy(bone.position)
  clone.quaternion.copy(bone.quaternion)
  clone.scale.copy(bone.scale)

  bone.children.forEach(child => {
    if (child instanceof THREE.Bone) {
      clone.add(cloneBoneHierarchy(child))
    }
  })

  return clone
}

function updateBoneTransforms(
  skeleton: THREE.Skeleton,
  editorBones: BoneData[],
  restPose: Map<string, { position: [number, number, number], rotation: [number, number, number, number] }>,
  meshWorldMatrix: THREE.Matrix4
) {
  const meshWorldInverse = meshWorldMatrix.clone().invert()
  const meshWorldRotation = new THREE.Quaternion().setFromRotationMatrix(meshWorldMatrix)
  const meshWorldRotationInv = meshWorldRotation.clone().invert()

  editorBones.forEach((editorBone) => {
    const threeBone = skeleton.bones.find(b => b.userData.editorId === editorBone.id)
    if (!threeBone) return

    const rest = restPose.get(editorBone.id)

    // For root bones, apply current position/rotation directly
    if (!editorBone.parentId) {
      if (rest) {
        const currentPos = new THREE.Vector3(...editorBone.position)
        const currentRot = new THREE.Quaternion(...editorBone.rotation)

        const localPos = currentPos.applyMatrix4(meshWorldInverse)
        const localRot = meshWorldRotationInv.clone().multiply(currentRot)

        // Apply current position and rotation (mesh-local)
        threeBone.position.copy(localPos)
        threeBone.quaternion.copy(localRot)
      } else {
        const currentPos = new THREE.Vector3(...editorBone.position).applyMatrix4(meshWorldInverse)
        const currentRot = new THREE.Quaternion(...editorBone.rotation)
        const localRot = meshWorldRotationInv.clone().multiply(currentRot)
        threeBone.position.copy(currentPos)
        threeBone.quaternion.copy(localRot)
      }
    } else {
      // For child bones, calculate local transform relative to current parent
      const parentData = editorBones.find(b => b.id === editorBone.parentId)
      if (parentData) {
        const worldPos = new THREE.Vector3(...editorBone.position)
        const worldRot = new THREE.Quaternion(...editorBone.rotation)
        const parentPos = new THREE.Vector3(...parentData.position)
        const parentRot = new THREE.Quaternion(...parentData.rotation)

        const localPos = worldPos.clone().sub(parentPos)
        localPos.applyQuaternion(parentRot.clone().invert())
        threeBone.position.copy(localPos)

        const localRot = parentRot.clone().invert().multiply(worldRot)
        threeBone.quaternion.copy(localRot)
      }
    }

    threeBone.scale.set(...editorBone.scale)
  })

  // Update matrices for the whole skeleton
  if (skeleton.bones.length > 0) {
    // Find root bones and update from there
    skeleton.bones.forEach(bone => {
      if (!bone.parent || !(bone.parent instanceof THREE.Bone)) {
        bone.updateMatrixWorld(true)
      }
    })
  }
}
