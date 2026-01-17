import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import type { ProjectData, BoneData, AnimationClip as AppAnimationClip } from '../types'
import { calculateAutomaticWeightsForMesh } from './weightCalculator'

interface ExportOptions {
  binary: boolean
  embedAnimations: boolean
  optimizeMeshes: boolean
  autoWeightSettings?: {
    method: 'envelope' | 'heatmap' | 'nearest'
    falloff: number
    smoothIterations: number
    neighborWeight: number
  }
}

export async function exportToGLB(
  scene: THREE.Scene,
  projectData: ProjectData,
  options: ExportOptions = { binary: true, embedAnimations: true, optimizeMeshes: true }
): Promise<ArrayBuffer | string> {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter()

    // Create a fresh export scene
    const exportScene = new THREE.Scene()

    // Clone and prepare the model for export
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && !(child instanceof THREE.SkinnedMesh)) {
        // Clone the mesh
        const meshClone = child.clone()

        // Restore to opaque, fully textured materials for export
        restoreMaterialsForExport(meshClone)

        exportScene.add(meshClone)
      } else if (child instanceof THREE.Group && child.children.length > 0) {
        // Clone groups with their meshes
        const groupClone = new THREE.Group()
        groupClone.name = child.name
        groupClone.position.copy(child.position)
        groupClone.rotation.copy(child.rotation)
        groupClone.scale.copy(child.scale)

        child.traverse((subChild) => {
          if (subChild instanceof THREE.Mesh && !(subChild instanceof THREE.SkinnedMesh)) {
            const meshClone = subChild.clone()
            restoreMaterialsForExport(meshClone)
            groupClone.add(meshClone)
          }
        })

        if (groupClone.children.length > 0) {
          exportScene.add(groupClone)
        }
      }
    })

    // If no bones, just export the scene as-is
    if (projectData.skeleton.bones.length === 0) {
      exporter.parse(
        exportScene,
        (result) => {
          if (result instanceof ArrayBuffer) {
            resolve(result)
          } else {
            resolve(JSON.stringify(result))
          }
        },
        (error) => reject(error),
        { binary: options.binary, animations: [] }
      )
      return
    }

    // Build skeleton from project data
    const { skeleton, rootBone, boneMap } = buildExportSkeleton(projectData.skeleton.bones)

    if (!skeleton || !rootBone) {
      // No valid skeleton, export without skinning
      exporter.parse(
        exportScene,
        (result) => {
          if (result instanceof ArrayBuffer) {
            resolve(result)
          } else {
            resolve(JSON.stringify(result))
          }
        },
        (error) => reject(error),
        { binary: options.binary, animations: [] }
      )
      return
    }

    // Find all meshes and convert them to skinned meshes
    const meshesToConvert: THREE.Mesh[] = []
    exportScene.traverse((child) => {
      if (child instanceof THREE.Mesh && !(child instanceof THREE.SkinnedMesh)) {
        meshesToConvert.push(child)
      }
    })

    // Clear the export scene - we'll add skinned meshes
    while (exportScene.children.length > 0) {
      exportScene.remove(exportScene.children[0])
    }

    // Add the bone hierarchy first
    exportScene.add(rootBone)

    // Convert each mesh to a skinned mesh
    meshesToConvert.forEach((mesh) => {
      const skinnedMesh = createExportSkinnedMesh(
        mesh,
        skeleton,
        rootBone,
        projectData,
        boneMap,
        options.autoWeightSettings
      )
      if (skinnedMesh) {
        exportScene.add(skinnedMesh)
      }
    })

    // Build animations
    const animations: THREE.AnimationClip[] = []

    if (options.embedAnimations && projectData.animations.length > 0) {
      projectData.animations.forEach((animData) => {
        const clip = buildExportAnimation(animData, projectData.skeleton.bones, boneMap)
        if (clip) {
          animations.push(clip)
          console.log(`Built animation "${clip.name}" with ${clip.tracks.length} tracks, duration: ${clip.duration}s`)
        }
      })
    }

    console.log(`Exporting with ${animations.length} animations, ${skeleton.bones.length} bones`)

    // Export
    exporter.parse(
      exportScene,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(result)
        } else {
          resolve(JSON.stringify(result))
        }
      },
      (error) => reject(error),
      {
        binary: options.binary,
        animations,
      }
    )
  })
}

const isCentralRootName = (name: string) => {
  const normalized = name.toLowerCase().replace(/\s+/g, '_')
  if (/(pelvis|hips|hip|root)$/.test(normalized)) {
    if (/(left|right|_l|_r|\.l|\.r|_left|_right)$/.test(normalized)) return false
    return true
  }
  return false
}

/**
 * Restore materials to opaque, fully textured state for export
 */
function restoreMaterialsForExport(mesh: THREE.Mesh) {
  const processMaterial = (mat: THREE.Material): THREE.Material => {
    const clonedMat = mat.clone()

    // Reset transparency to fully opaque
    clonedMat.transparent = false
    clonedMat.opacity = 1.0
    clonedMat.depthWrite = true

    // If it's a basic material (wireframe mode), try to restore to standard
    if (clonedMat instanceof THREE.MeshBasicMaterial && clonedMat.wireframe) {
      // Convert back to standard material
      const standardMat = new THREE.MeshStandardMaterial({
        color: 0x808080,
        roughness: 0.7,
        metalness: 0.1,
      })
      return standardMat
    }

    // Reset side to front only
    clonedMat.side = THREE.FrontSide

    return clonedMat
  }

  if (Array.isArray(mesh.material)) {
    mesh.material = mesh.material.map(processMaterial)
  } else {
    mesh.material = processMaterial(mesh.material)
  }
}

interface ExportSkeletonResult {
  skeleton: THREE.Skeleton | null
  rootBone: THREE.Bone | null
  boneMap: Map<string, THREE.Bone>
}

/**
 * Build skeleton for export with proper hierarchy
 */
function buildExportSkeleton(bones: BoneData[]): ExportSkeletonResult {
  if (bones.length === 0) {
    return { skeleton: null, rootBone: null, boneMap: new Map() }
  }

  const boneMap = new Map<string, THREE.Bone>()
  const threeBones: THREE.Bone[] = []

  // Create all bones first
  bones.forEach((boneData) => {
    const bone = new THREE.Bone()
    bone.name = boneData.name
    boneMap.set(boneData.id, bone)
    threeBones.push(bone)
  })

  // Set up hierarchy and calculate local transforms
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

        // Local position = inverse(parentRot) * (worldPos - parentPos)
        const localPos = worldPos.clone().sub(parentPos)
        localPos.applyQuaternion(parentRot.clone().invert())
        bone.position.copy(localPos)

        // Local rotation = inverse(parentRot) * worldRot
        const localRot = parentRot.clone().invert().multiply(worldRot)
        bone.quaternion.copy(localRot)
      }
    } else {
      // Root bone - use world position directly
      bone.position.copy(worldPos)
      bone.quaternion.copy(worldRot)
    }

    bone.scale.set(...boneData.scale)
  })

  // Find root bone(s)
  const rootBones = bones.filter(b => !b.parentId).map(b => boneMap.get(b.id)!)

  let rootBone: THREE.Bone
  if (rootBones.length === 0) {
    return { skeleton: null, rootBone: null, boneMap }
  } else if (rootBones.length === 1) {
    rootBone = rootBones[0]
  } else {
    // Multiple roots - create a parent bone at origin
    rootBone = new THREE.Bone()
    rootBone.name = 'Armature'
    rootBones.forEach(rb => rootBone.add(rb))
    threeBones.unshift(rootBone)
    boneMap.set('__armature__', rootBone)
  }

  // Update matrix world for all bones
  rootBone.updateMatrixWorld(true)

  const skeleton = new THREE.Skeleton(threeBones)

  return { skeleton, rootBone, boneMap }
}

/**
 * Create a skinned mesh for export
 */
function createExportSkinnedMesh(
  mesh: THREE.Mesh,
  skeleton: THREE.Skeleton,
  _rootBone: THREE.Bone,
  projectData: ProjectData,
  boneMap: Map<string, THREE.Bone>,
  autoWeightSettings?: {
    method: 'envelope' | 'heatmap' | 'nearest'
    falloff: number
    smoothIterations: number
    neighborWeight: number
  }
): THREE.SkinnedMesh | null {
  try {
    const geometry = mesh.geometry.clone()

    // Clone and restore materials for export
    let material: THREE.Material | THREE.Material[]
    if (Array.isArray(mesh.material)) {
      material = mesh.material.map(m => {
        const cloned = m.clone()
        cloned.transparent = false
        cloned.opacity = 1.0
        cloned.depthWrite = true
        return cloned
      })
    } else {
      material = mesh.material.clone()
      material.transparent = false
      material.opacity = 1.0
      material.depthWrite = true
    }

    // Get mesh world matrix for proper vertex position calculation
    mesh.updateMatrixWorld(true)
    const meshWorldMatrix = mesh.matrixWorld.clone()
    const meshWorldPosition = new THREE.Vector3()
    const meshWorldRotation = new THREE.Quaternion()
    const meshWorldScale = new THREE.Vector3()
    meshWorldMatrix.decompose(meshWorldPosition, meshWorldRotation, meshWorldScale)

    // Create bone index map based on skeleton order
    const boneIndexMap = new Map<string, number>()
    skeleton.bones.forEach((bone, index) => {
      // Find the bone ID that matches this bone
      for (const [id, b] of boneMap.entries()) {
        if (b === bone) {
          boneIndexMap.set(id, index)
          break
        }
      }
    })

    // Check if we have weight data for this mesh
    const meshWeights = projectData.weightMap[mesh.name]

    const vertexCount = geometry.attributes.position.count

    const needsAutoWeights = !meshWeights ||
      meshWeights.vertexWeights.length < vertexCount ||
      meshWeights.vertexWeights.some((w) => !w || w.length === 0)

    let autoWeights: [number, number][][] | null = null
    const getAutoWeights = () => {
      if (!autoWeights) {
        const settings = autoWeightSettings || {
          method: 'envelope' as const,
          falloff: 2.5,
          smoothIterations: 2,
          neighborWeight: 0.6,
        }
        autoWeights = calculateAutomaticWeightsForMesh(mesh, projectData.skeleton.bones, {
          method: settings.method,
          falloff: settings.falloff,
          smoothIterations: settings.smoothIterations,
          neighborWeight: settings.neighborWeight,
        })
      }
      return autoWeights
    }

    const mapToSkeletonIndices = (weights: [number, number][]) => {
      return weights.map(([boneIdx, weight]) => {
        const bone = projectData.skeleton.bones[boneIdx]
        const mapped = bone ? boneIndexMap.get(bone.id) ?? boneIdx : boneIdx
        return [mapped, weight] as [number, number]
      })
    }

    // Create skin indices and weights arrays
    const skinIndices: number[] = []
    const skinWeights: number[] = []

    for (let i = 0; i < vertexCount; i++) {
      let weights: [number, number][] = []

      if (meshWeights && meshWeights.vertexWeights[i]) {
        weights = mapToSkeletonIndices(meshWeights.vertexWeights[i])
      } else if (needsAutoWeights) {
        const auto = getAutoWeights()[i] || []
        weights = mapToSkeletonIndices(auto)
      }

      // If no weights defined, bind to nearest bone based on vertex position
      if (weights.length === 0 && projectData.skeleton.bones.length > 0) {
        const pos = new THREE.Vector3()
        pos.fromBufferAttribute(geometry.attributes.position, i)
        pos.applyMatrix4(meshWorldMatrix) // Transform to world space

        // Find nearest bone
        let nearestBoneId: string | null = null
        let nearestDist = Infinity

        projectData.skeleton.bones.forEach((bone) => {
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

      // Sort by weight and take top 4
      const sorted = [...weights].sort((a, b) => b[1] - a[1]).slice(0, 4)

      // Pad to 4 elements
      while (sorted.length < 4) {
        sorted.push([0, 0])
      }

      // Normalize weights
      const total = sorted.reduce((sum, [, w]) => sum + w, 0)
      if (total > 0) {
        sorted.forEach((entry, idx) => {
          sorted[idx] = [entry[0], entry[1] / total]
        })
      } else {
        // Default to first bone if no weights
        sorted[0] = [0, 1]
      }

      // Add to arrays
      sorted.forEach(([boneIdx, weight]) => {
        skinIndices.push(boneIdx)
        skinWeights.push(weight)
      })
    }

    // Set attributes
    geometry.setAttribute(
      'skinIndex',
      new THREE.Uint16BufferAttribute(skinIndices, 4)
    )
    geometry.setAttribute(
      'skinWeight',
      new THREE.Float32BufferAttribute(skinWeights, 4)
    )

    // Create skinned mesh
    const skinnedMesh = new THREE.SkinnedMesh(geometry, material)
    skinnedMesh.name = mesh.name || 'SkinnedMesh'
    skinnedMesh.position.copy(meshWorldPosition)
    skinnedMesh.quaternion.copy(meshWorldRotation)
    skinnedMesh.scale.copy(meshWorldScale)

    // IMPORTANT: Bind to the skeleton (same skeleton instance, not a clone!)
    // The skeleton bones must be in the scene hierarchy for animation to work
    skinnedMesh.bind(skeleton)

    return skinnedMesh
  } catch (error) {
    console.error('Failed to convert mesh to skinned mesh:', error)
    return null
  }
}

/**
 * Build animation clip for export
 *
 * IMPORTANT: The editor stores bones in WORLD space, but GLB expects LOCAL space.
 * We need to convert keyframe values from world to local coordinates.
 *
 * When parent bones are also animated, we must use the parent's ANIMATED position
 * at each keyframe time, not the rest pose.
 *
 * For rotation: localRot = inverse(parentAnimatedRot) * worldRot
 * For position: localPos = inverse(parentAnimatedRot) * (worldPos - parentAnimatedPos)
 */
function buildExportAnimation(
  animData: AppAnimationClip,
  bones: BoneData[],
  boneMap: Map<string, THREE.Bone>
): THREE.AnimationClip | null {
  if (animData.tracks.length === 0) return null

  const tracks: THREE.KeyframeTrack[] = []
  const boneDataMap = new Map(bones.map((b) => [b.id, b]))
  const fps = animData.fps > 0 ? animData.fps : 30

  // Build rest pose map
  const restPoseMap = new Map<string, {
    worldPos: THREE.Vector3,
    worldRot: THREE.Quaternion,
    parentId: string | null
  }>()

  bones.forEach(bone => {
    restPoseMap.set(bone.id, {
      worldPos: new THREE.Vector3(...bone.position),
      worldRot: new THREE.Quaternion(...bone.rotation),
      parentId: bone.parentId
    })
  })

  // Build a lookup for all animation tracks by bone and property
  const trackLookup = new Map<string, Map<string, typeof animData.tracks[0]>>()
  animData.tracks.forEach(track => {
    if (!trackLookup.has(track.boneId)) {
      trackLookup.set(track.boneId, new Map())
    }
    trackLookup.get(track.boneId)!.set(track.property, track)
  })

  // Helper to get animated value at a specific frame (with interpolation)
  const getAnimatedValueAtFrame = (
    boneId: string,
    property: 'position' | 'rotation' | 'scale',
    frame: number
  ): number[] | null => {
    const boneTrack = trackLookup.get(boneId)?.get(property)
    if (!boneTrack || boneTrack.keyframes.length === 0) {
      return null
    }

    const keyframes = [...boneTrack.keyframes].sort((a, b) => a.frame - b.frame)

    // Find surrounding keyframes
    let before = keyframes[0]
    let after = keyframes[keyframes.length - 1]

    for (let i = 0; i < keyframes.length; i++) {
      if (keyframes[i].frame <= frame) {
        before = keyframes[i]
      }
      if (keyframes[i].frame >= frame) {
        after = keyframes[i]
        break
      }
    }

    // If exact match or only one keyframe
    if (before.frame === after.frame || before.frame === frame) {
      return before.value
    }
    if (after.frame === frame) {
      return after.value
    }

    const interpolation = before.interpolation || 'linear'
    if (interpolation === 'step') {
      return before.value
    }

    const t = (frame - before.frame) / (after.frame - before.frame)
    const blend = interpolation === 'bezier' ? t * t * (3 - 2 * t) : t

    if (property === 'rotation') {
      // Slerp for quaternions
      const q1 = new THREE.Quaternion(before.value[0], before.value[1], before.value[2], before.value[3])
      const q2 = new THREE.Quaternion(after.value[0], after.value[1], after.value[2], after.value[3])
      q1.slerp(q2, blend)
      return [q1.x, q1.y, q1.z, q1.w]
    } else {
      // Linear interpolation for position/scale
      return before.value.map((v, i) => v + (after.value[i] - v) * blend)
    }
  }

  // Helper to get parent's world transform at a specific frame
  const getParentWorldTransformAtFrame = (boneId: string, frame: number): {
    pos: THREE.Vector3,
    rot: THREE.Quaternion
  } => {
    const boneRest = restPoseMap.get(boneId)
    if (!boneRest || !boneRest.parentId) {
      return { pos: new THREE.Vector3(), rot: new THREE.Quaternion() }
    }

    const parentId = boneRest.parentId
    const parentRest = restPoseMap.get(parentId)
    if (!parentRest) {
      return { pos: new THREE.Vector3(), rot: new THREE.Quaternion() }
    }

    // Check if parent has animation at this frame
    const parentAnimPos = getAnimatedValueAtFrame(parentId, 'position', frame)
    const parentAnimRot = getAnimatedValueAtFrame(parentId, 'rotation', frame)

    const parentPos = parentAnimPos
      ? new THREE.Vector3(parentAnimPos[0], parentAnimPos[1], parentAnimPos[2])
      : parentRest.worldPos.clone()

    const parentRot = parentAnimRot
      ? new THREE.Quaternion(parentAnimRot[0], parentAnimRot[1], parentAnimRot[2], parentAnimRot[3])
      : parentRest.worldRot.clone()

    return { pos: parentPos, rot: parentRot }
  }

  // Helper to convert world rotation to local rotation at a specific frame
  const worldToLocalRotation = (boneId: string, worldRot: THREE.Quaternion, frame: number): THREE.Quaternion => {
    const boneRest = restPoseMap.get(boneId)
    if (!boneRest || !boneRest.parentId) {
      // Root bone - local = world
      return worldRot.clone()
    }

    const { rot: parentRot } = getParentWorldTransformAtFrame(boneId, frame)

    // localRot = inverse(parentWorldRot) * worldRot
    const invParentRot = parentRot.clone().invert()
    return invParentRot.multiply(worldRot.clone())
  }

  // Helper to convert world position to local position at a specific frame
  const worldToLocalPosition = (boneId: string, worldPos: THREE.Vector3, frame: number): THREE.Vector3 => {
    const boneRest = restPoseMap.get(boneId)
    if (!boneRest || !boneRest.parentId) {
      // Root bone - local = world
      return worldPos.clone()
    }

    const { pos: parentPos, rot: parentRot } = getParentWorldTransformAtFrame(boneId, frame)

    // localPos = inverse(parentWorldRot) * (worldPos - parentWorldPos)
    const offset = worldPos.clone().sub(parentPos)
    const invParentRot = parentRot.clone().invert()
    return offset.applyQuaternion(invParentRot)
  }

  animData.tracks.forEach((track) => {
    const boneData = boneDataMap.get(track.boneId)
    if (!boneData) return
    if (track.property === 'position' && (!boneData.parentId || isCentralRootName(boneData.name))) {
      return
    }

    // Get the actual Three.js bone to use its name
    const threeBone = boneMap.get(track.boneId)
    if (!threeBone) return

    const times: number[] = []
    const values: number[] = []

    // Sort keyframes by frame
    const sortedKeyframes = [...track.keyframes].sort((a, b) => a.frame - b.frame)
    const usesBezier = sortedKeyframes.some((kf) => kf.interpolation === 'bezier')
    const usesStep = sortedKeyframes.some((kf) => kf.interpolation === 'step')
    const shouldBake = usesBezier || usesStep
    const totalFrames = Math.max(1, Math.round(animData.frameCount))
    const frameList = shouldBake
      ? Array.from({ length: totalFrames + 1 }, (_, i) => i)
      : sortedKeyframes.map((kf) => kf.frame)
    const restPose = restPoseMap.get(track.boneId)

    frameList.forEach((frame, idx) => {
      let worldValue: number[] | null = null

      if (shouldBake) {
        worldValue = getAnimatedValueAtFrame(track.boneId, track.property, frame)
        if (!worldValue && restPose) {
          worldValue = track.property === 'rotation'
            ? [restPose.worldRot.x, restPose.worldRot.y, restPose.worldRot.z, restPose.worldRot.w]
            : track.property === 'position'
              ? [restPose.worldPos.x, restPose.worldPos.y, restPose.worldPos.z]
              : [1, 1, 1]
        }
      } else {
        const kf = sortedKeyframes[idx]
        worldValue = kf?.value || null
      }

      if (!worldValue) return

      times.push(frame / fps)

      // Convert world-space values to local-space using parent's state at this frame
      switch (track.property) {
        case 'position': {
          const worldPos = new THREE.Vector3(worldValue[0], worldValue[1], worldValue[2])
          const localPos = worldToLocalPosition(track.boneId, worldPos, frame)
          values.push(localPos.x, localPos.y, localPos.z)
          break
        }
        case 'rotation': {
          const worldRot = new THREE.Quaternion(worldValue[0], worldValue[1], worldValue[2], worldValue[3])
          const localRot = worldToLocalRotation(track.boneId, worldRot, frame)
          values.push(localRot.x, localRot.y, localRot.z, localRot.w)
          break
        }
        case 'scale': {
          values.push(...worldValue)
          break
        }
      }
    })

    if (times.length === 0) return

    let trackName: string
    let TrackType: typeof THREE.KeyframeTrack

    switch (track.property) {
      case 'position':
        trackName = `${threeBone.name}.position`
        TrackType = THREE.VectorKeyframeTrack
        break
      case 'rotation':
        trackName = `${threeBone.name}.quaternion`
        TrackType = THREE.QuaternionKeyframeTrack
        break
      case 'scale':
        trackName = `${threeBone.name}.scale`
        TrackType = THREE.VectorKeyframeTrack
        break
      default:
        return
    }

    try {
      const keyframeTrack = new TrackType(trackName, times, values)
      if (usesStep && !shouldBake) {
        keyframeTrack.setInterpolation(THREE.InterpolateDiscrete)
      }
      tracks.push(keyframeTrack)
      console.log(`  Track: ${trackName}, ${times.length} keyframes (world->local, frame-aware)`)
    } catch (e) {
      console.error(`Failed to create track ${trackName}:`, e)
    }
  })

  if (tracks.length === 0) return null

  const duration = animData.frameCount / fps

  return new THREE.AnimationClip(
    animData.name,
    duration,
    tracks
  )
}

export async function saveGLBToFile(
  data: ArrayBuffer,
  filePath: string
): Promise<boolean> {
  if (!window.electronAPI) return false

  try {
    const uint8Array = new Uint8Array(data)
    // Cast to any to avoid type mismatch - Electron IPC handles Uint8Array properly
    await window.electronAPI.writeFile(filePath, uint8Array as unknown as Buffer)
    return true
  } catch (error) {
    console.error('Failed to save GLB:', error)
    return false
  }
}
