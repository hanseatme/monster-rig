import * as THREE from 'three'
import type { BoneData } from '../types'
import { v4 as uuidv4 } from 'uuid'

interface BoneSuggestion {
  position: [number, number, number]
  name: string
  parentIndex: number | null
  confidence: number
}

interface MeshAnalysis {
  center: THREE.Vector3
  boundingBox: THREE.Box3
  extremities: THREE.Vector3[]
  symmetryAxis: 'x' | 'y' | 'z' | null
  size: THREE.Vector3
}

/**
 * Analyze a 3D object (model) to find good bone positions
 * Works with world coordinates after model transformations
 */
export function analyzeModel(object: THREE.Object3D): MeshAnalysis {
  // Collect all vertices in WORLD coordinates
  const worldVertices: THREE.Vector3[] = []

  object.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      const geometry = child.geometry
      const position = geometry.attributes.position

      if (!position) return

      // Get the world matrix for this mesh
      child.updateWorldMatrix(true, false)
      const worldMatrix = child.matrixWorld

      for (let i = 0; i < position.count; i++) {
        const vertex = new THREE.Vector3(
          position.getX(i),
          position.getY(i),
          position.getZ(i)
        )
        // Transform to world coordinates
        vertex.applyMatrix4(worldMatrix)
        worldVertices.push(vertex)
      }
    }
  })

  if (worldVertices.length === 0) {
    // Fallback: use bounding box
    const box = new THREE.Box3().setFromObject(object)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())

    return {
      center,
      boundingBox: box,
      extremities: [],
      symmetryAxis: 'x',
      size,
    }
  }

  // Calculate bounding box and center from world vertices
  const boundingBox = new THREE.Box3()
  worldVertices.forEach(v => boundingBox.expandByPoint(v))

  const center = boundingBox.getCenter(new THREE.Vector3())
  const size = boundingBox.getSize(new THREE.Vector3())

  // Find extremities using PCA-like approach
  const extremities = findExtremities(worldVertices, center, size)

  // Detect symmetry axis
  const symmetryAxis = detectSymmetryAxis(worldVertices, center, size)

  return {
    center,
    boundingBox,
    extremities,
    symmetryAxis,
    size,
  }
}

/**
 * Find extremity points (tips of limbs, tail, head, etc.)
 */
function findExtremities(
  vertices: THREE.Vector3[],
  center: THREE.Vector3,
  size: THREE.Vector3
): THREE.Vector3[] {
  // Use adaptive clustering threshold based on model size
  const avgSize = (size.x + size.y + size.z) / 3
  const clusterThreshold = avgSize * 0.15

  // Find vertices far from center
  const withDistance = vertices.map(v => ({
    vertex: v,
    distance: v.distanceTo(center)
  }))

  // Sort by distance (furthest first)
  withDistance.sort((a, b) => b.distance - a.distance)

  // Take top 5% of furthest vertices
  const topCount = Math.max(20, Math.floor(vertices.length * 0.05))
  const candidates = withDistance.slice(0, topCount).map(d => d.vertex)

  // Cluster the extremities
  const clusters = clusterPoints(candidates, clusterThreshold)

  // Return cluster centers (max 8 extremities)
  return clusters.slice(0, 8).map(cluster => {
    const clusterCenter = new THREE.Vector3()
    cluster.forEach(p => clusterCenter.add(p))
    return clusterCenter.divideScalar(cluster.length)
  })
}

/**
 * Cluster nearby points together
 */
function clusterPoints(
  points: THREE.Vector3[],
  threshold: number
): THREE.Vector3[][] {
  const clusters: THREE.Vector3[][] = []
  const used = new Set<number>()

  for (let i = 0; i < points.length; i++) {
    if (used.has(i)) continue

    const cluster: THREE.Vector3[] = [points[i]]
    used.add(i)

    for (let j = i + 1; j < points.length; j++) {
      if (used.has(j)) continue

      // Check if point is close to any point in cluster
      const isNearby = cluster.some(p => p.distanceTo(points[j]) < threshold)
      if (isNearby) {
        cluster.push(points[j])
        used.add(j)
      }
    }

    if (cluster.length >= 2) {
      clusters.push(cluster)
    }
  }

  // Sort clusters by size (largest first)
  clusters.sort((a, b) => b.length - a.length)

  return clusters
}

/**
 * Detect the most likely symmetry axis
 */
function detectSymmetryAxis(
  vertices: THREE.Vector3[],
  center: THREE.Vector3,
  size: THREE.Vector3
): 'x' | 'y' | 'z' | null {
  // Sample a subset of vertices for performance
  const sampleSize = Math.min(500, vertices.length)
  const step = Math.max(1, Math.floor(vertices.length / sampleSize))
  const samples = vertices.filter((_, i) => i % step === 0)

  const axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z']
  let bestAxis: 'x' | 'y' | 'z' | null = null
  let bestScore = 0

  // Adaptive tolerance based on model size
  const avgSize = (size.x + size.y + size.z) / 3
  const tolerance = avgSize * 0.05

  for (const axis of axes) {
    let matchCount = 0
    const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2

    for (const vertex of samples) {
      // Create mirrored point
      const mirrored = vertex.clone()
      const centerCoord = center.getComponent(axisIndex)
      const vertexCoord = vertex.getComponent(axisIndex)
      mirrored.setComponent(axisIndex, 2 * centerCoord - vertexCoord)

      // Check if a similar vertex exists
      const hasMatch = samples.some(v => v.distanceTo(mirrored) < tolerance)
      if (hasMatch) matchCount++
    }

    const score = matchCount / samples.length
    if (score > bestScore && score > 0.6) {
      bestScore = score
      bestAxis = axis
    }
  }

  // Default to X-axis for typical creatures
  return bestAxis || 'x'
}

/**
 * Generate bone suggestions based on mesh analysis
 */
export function suggestBones(analysis: MeshAnalysis): BoneSuggestion[] {
  const suggestions: BoneSuggestion[] = []
  const { center, extremities, size } = analysis

  // Calculate appropriate bone length based on model size
  const avgSize = (size.x + size.y + size.z) / 3
  const boneSpacing = avgSize * 0.2 // About 5 bones across the model

  // 1. Root bone at center (slightly lower for creatures)
  const rootPos = center.clone()
  rootPos.y -= size.y * 0.1 // Slightly below center

  suggestions.push({
    position: [rootPos.x, rootPos.y, rootPos.z],
    name: 'root',
    parentIndex: null,
    confidence: 1.0,
  })

  // 2. Spine/body bones along the longest axis
  const longestAxis = size.x > size.z ? 'x' : 'z'
  const spineLength = longestAxis === 'x' ? size.x : size.z
  const spineSegments = Math.max(2, Math.min(5, Math.ceil(spineLength / boneSpacing)))

  let lastSpineIdx = 0
  for (let i = 1; i <= spineSegments; i++) {
    const t = i / (spineSegments + 1) - 0.5 // -0.5 to 0.5
    const pos = center.clone()
    if (longestAxis === 'x') {
      pos.x += t * spineLength * 0.8
    } else {
      pos.z += t * spineLength * 0.8
    }

    const isHead = i === spineSegments
    suggestions.push({
      position: [pos.x, pos.y, pos.z],
      name: isHead ? 'head' : `spine_${String(i).padStart(2, '0')}`,
      parentIndex: lastSpineIdx,
      confidence: 0.9,
    })
    lastSpineIdx = suggestions.length - 1
  }

  // 3. Bones for extremities (limbs, tail, etc.)
  extremities.forEach((extremity, extIndex) => {
    const direction = extremity.clone().sub(center)
    const distance = direction.length()

    if (distance < avgSize * 0.2) return // Skip if too close to center

    direction.normalize()

    // Determine bone chain name based on direction
    let baseName = ''
    const absY = Math.abs(direction.y)
    const absX = Math.abs(direction.x)
    const absZ = Math.abs(direction.z)

    if (absY > 0.7) {
      // Vertical
      baseName = direction.y > 0 ? 'head' : 'tail'
    } else if (absX > absZ) {
      // Side limb
      baseName = direction.x > 0 ? 'limb_right' : 'limb_left'
    } else {
      // Front/back limb
      baseName = direction.z > 0 ? 'limb_front' : 'limb_back'
    }

    // Add index if we have multiple similar limbs
    baseName = `${baseName}_${String(extIndex).padStart(2, '0')}`

    // Create bone chain from root to extremity
    const chainLength = Math.max(2, Math.min(4, Math.ceil(distance / boneSpacing)))
    let parentIdx = 0 // Start from root

    for (let i = 1; i <= chainLength; i++) {
      const t = i / chainLength
      const pos = rootPos.clone().lerp(extremity, t)

      suggestions.push({
        position: [pos.x, pos.y, pos.z],
        name: `${baseName}_${String(i).padStart(2, '0')}`,
        parentIndex: parentIdx,
        confidence: 0.8 - (i - 1) * 0.1,
      })

      parentIdx = suggestions.length - 1
    }
  })

  return suggestions
}

/**
 * Mirror existing bones across an axis
 */
export function suggestMirroredBones(
  bones: BoneData[],
  axis: 'x' | 'y' | 'z' = 'x'
): BoneData[] {
  const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  const mirroredBones: BoneData[] = []
  const threshold = 0.1 // Bones closer to center than this won't be mirrored

  // Create a map of original bone IDs to mirrored bone IDs
  const idMap = new Map<string, string>()

  bones.forEach((bone) => {
    // Skip bones on the center line
    if (Math.abs(bone.position[axisIndex]) < threshold) return

    // Skip if a mirrored bone already exists
    const mirrorName = getMirrorName(bone.name)
    if (bones.some((b) => b.name === mirrorName)) return
    if (mirroredBones.some((b) => b.name === mirrorName)) return

    const newId = uuidv4()
    idMap.set(bone.id, newId)

    // Create mirrored bone
    const mirroredPosition = [...bone.position] as [number, number, number]
    mirroredPosition[axisIndex] *= -1

    const mirroredRotation = [...bone.rotation] as [number, number, number, number]
    // Mirror rotation
    if (axis === 'x') {
      mirroredRotation[1] *= -1
      mirroredRotation[2] *= -1
    } else if (axis === 'y') {
      mirroredRotation[0] *= -1
      mirroredRotation[2] *= -1
    } else {
      mirroredRotation[0] *= -1
      mirroredRotation[1] *= -1
    }

    // Find mirrored parent
    let mirroredParentId = bone.parentId
    if (bone.parentId) {
      const parent = bones.find(b => b.id === bone.parentId)
      if (parent && Math.abs(parent.position[axisIndex]) >= threshold) {
        // Parent should also be mirrored, use the new ID
        mirroredParentId = idMap.get(bone.parentId) || bone.parentId
      }
    }

    mirroredBones.push({
      id: newId,
      name: mirrorName,
      parentId: mirroredParentId,
      position: mirroredPosition,
      rotation: mirroredRotation,
      scale: [...bone.scale] as [number, number, number],
      length: bone.length,
      rotationLimits: {
        x: [...bone.rotationLimits.x] as [number, number],
        y: [...bone.rotationLimits.y] as [number, number],
        z: [...bone.rotationLimits.z] as [number, number],
      },
    })
  })

  return mirroredBones
}

/**
 * Get the mirrored name for a bone
 */
function getMirrorName(name: string): string {
  const replacements: [RegExp | string, string][] = [
    [/_left_/g, '_right_'],
    [/_right_/g, '_left_'],
    [/_left$/g, '_right'],
    [/_right$/g, '_left'],
    [/_l_/g, '_r_'],
    [/_r_/g, '_l_'],
    [/_l$/g, '_r'],
    [/_r$/g, '_l'],
    ['left_', 'right_'],
    ['right_', 'left_'],
  ]

  for (const [pattern, replacement] of replacements) {
    if (typeof pattern === 'string') {
      if (name.includes(pattern)) {
        return name.replace(pattern, replacement)
      }
    } else {
      if (pattern.test(name)) {
        return name.replace(pattern, replacement)
      }
    }
  }

  return `${name}_mirrored`
}

/**
 * Create a bone chain between two points
 */
export function suggestBoneChain(
  startPoint: THREE.Vector3,
  endPoint: THREE.Vector3,
  segmentCount: number,
  baseName: string
): BoneSuggestion[] {
  const suggestions: BoneSuggestion[] = []

  for (let i = 0; i <= segmentCount; i++) {
    const t = i / segmentCount
    const pos = startPoint.clone().lerp(endPoint, t)

    suggestions.push({
      position: [pos.x, pos.y, pos.z],
      name: `${baseName}_${String(i).padStart(2, '0')}`,
      parentIndex: i === 0 ? null : i - 1,
      confidence: 0.9,
    })
  }

  return suggestions
}
