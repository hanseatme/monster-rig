import * as THREE from 'three'
import type { BoneData, AutoBoneSettings } from '../types'
import { v4 as uuidv4 } from 'uuid'
import { normalizeAutoBoneSettings } from './autoBoneSettings'

export interface BoneSuggestion {
  position: [number, number, number]
  name: string
  parentIndex: number | null
  confidence: number
}

interface HeightProfileSample {
  y: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  count: number
}

interface MeshAnalysis {
  center: THREE.Vector3
  boundingBox: THREE.Box3
  extremities: THREE.Vector3[]
  symmetryAxis: 'x' | 'y' | 'z' | null
  size: THREE.Vector3
  heightProfile: HeightProfileSample[]
}

export interface MeshAnalysisSummary {
  center: [number, number, number]
  size: [number, number, number]
  boundingBox: {
    min: [number, number, number]
    max: [number, number, number]
  }
  extremities: [number, number, number][]
  symmetryAxis: 'x' | 'y' | 'z' | null
  heightProfile?: {
    y: number
    width: number
    depth: number
    density: number
  }[]
  humanoidLandmarks?: {
    pelvisY: number
    chestY: number
    shoulderY: number
    neckY: number
    headY: number
    hipWidth: number
    shoulderWidth: number
    footY: number
    handY: number
    sideAxis: 'x' | 'z'
    frontAxis: 'x' | 'z'
    frontAxisSign: 1 | -1
    leftHand?: [number, number, number]
    rightHand?: [number, number, number]
    leftFoot?: [number, number, number]
    rightFoot?: [number, number, number]
    headTip?: [number, number, number]
  }
}

type Axis = 'x' | 'y' | 'z'

const getAxisValue = (vec: THREE.Vector3, axis: Axis) => {
  if (axis === 'x') return vec.x
  if (axis === 'y') return vec.y
  return vec.z
}

const setAxisValue = (vec: THREE.Vector3, axis: Axis, value: number) => {
  if (axis === 'x') vec.x = value
  else if (axis === 'y') vec.y = value
  else vec.z = value
}

const addAxisValue = (vec: THREE.Vector3, axis: Axis, value: number) => {
  if (axis === 'x') vec.x += value
  else if (axis === 'y') vec.y += value
  else vec.z += value
}

const resolveSideAxis = (symmetryAxis: 'x' | 'y' | 'z' | null): 'x' | 'z' => {
  if (symmetryAxis === 'z') return 'z'
  return 'x'
}

const resolveFrontAxis = (sideAxis: 'x' | 'z'): 'x' | 'z' => {
  return sideAxis === 'x' ? 'z' : 'x'
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const addSuggestion = (
  suggestions: BoneSuggestion[],
  position: THREE.Vector3,
  name: string,
  parentIndex: number | null,
  confidence: number
) => {
  suggestions.push({
    position: [position.x, position.y, position.z],
    name,
    parentIndex,
    confidence,
  })
  return suggestions.length - 1
}

function buildHeightProfile(
  vertices: THREE.Vector3[],
  bounds: THREE.Box3,
  segments: number = 24
): HeightProfileSample[] {
  const minY = bounds.min.y
  const maxY = bounds.max.y
  const height = Math.max(0.0001, maxY - minY)
  const step = height / segments
  const center = bounds.getCenter(new THREE.Vector3())

  const samples: HeightProfileSample[] = Array.from({ length: segments }, (_, i) => ({
    y: minY + (i + 0.5) * step,
    minX: Infinity,
    maxX: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
    count: 0,
  }))

  vertices.forEach((vertex) => {
    const idx = clamp(Math.floor((vertex.y - minY) / step), 0, segments - 1)
    const sample = samples[idx]
    sample.count += 1
    sample.minX = Math.min(sample.minX, vertex.x)
    sample.maxX = Math.max(sample.maxX, vertex.x)
    sample.minZ = Math.min(sample.minZ, vertex.z)
    sample.maxZ = Math.max(sample.maxZ, vertex.z)
  })

  samples.forEach((sample) => {
    if (sample.count === 0) {
      sample.minX = center.x
      sample.maxX = center.x
      sample.minZ = center.z
      sample.maxZ = center.z
    }
  })

  return samples
}

function getProfileDimensions(
  sample: HeightProfileSample,
  sideAxis: 'x' | 'z'
) {
  const width = sideAxis === 'x'
    ? sample.maxX - sample.minX
    : sample.maxZ - sample.minZ
  const depth = sideAxis === 'x'
    ? sample.maxZ - sample.minZ
    : sample.maxX - sample.minX
  return { width, depth }
}

function findProfilePeak(
  profile: HeightProfileSample[],
  minY: number,
  height: number,
  rangeStart: number,
  rangeEnd: number,
  sideAxis: 'x' | 'z'
) {
  if (profile.length === 0) return null
  const startY = minY + height * rangeStart
  const endY = minY + height * rangeEnd
  const maxCount = Math.max(...profile.map((sample) => sample.count))
  const minCount = Math.max(3, Math.floor(maxCount * 0.08))

  let best: { sample: HeightProfileSample; score: number } | null = null
  profile.forEach((sample) => {
    if (sample.y < startY || sample.y > endY) return
    if (sample.count < minCount) return
    const { width, depth } = getProfileDimensions(sample, sideAxis)
    const score = width * Math.sqrt(sample.count + 1) + depth * 0.15
    if (!best || score > best.score) {
      best = { sample, score }
    }
  })

  if (!best) return null
  const { width, depth } = getProfileDimensions(best.sample, sideAxis)
  return { y: best.sample.y, width, depth }
}

function findClosestProfileSample(profile: HeightProfileSample[], targetY: number) {
  if (profile.length === 0) return null
  let best = profile[0]
  let bestDist = Math.abs(best.y - targetY)
  for (let i = 1; i < profile.length; i++) {
    const dist = Math.abs(profile[i].y - targetY)
    if (dist < bestDist) {
      best = profile[i]
      bestDist = dist
    }
  }
  return best
}

function pickExtremityBySide(
  extremities: THREE.Vector3[],
  sideAxis: 'x' | 'z',
  center: THREE.Vector3,
  sideSign: number,
  minSideOffset: number
) {
  let best: THREE.Vector3 | null = null
  let bestScore = -Infinity
  extremities.forEach((ext) => {
    const sideOffset = getAxisValue(ext, sideAxis) - getAxisValue(center, sideAxis)
    if (Math.sign(sideOffset) !== sideSign) return
    const absSide = Math.abs(sideOffset)
    if (absSide < minSideOffset) return
    const score = absSide
    if (score > bestScore) {
      bestScore = score
      best = ext
    }
  })
  return best
}

function clampToBounds(pos: THREE.Vector3, bounds: THREE.Box3, margin: number) {
  pos.x = clamp(pos.x, bounds.min.x - margin, bounds.max.x + margin)
  pos.y = clamp(pos.y, bounds.min.y - margin, bounds.max.y + margin)
  pos.z = clamp(pos.z, bounds.min.z - margin, bounds.max.z + margin)
}

function deriveHumanoidLandmarks(
  analysis: MeshAnalysis,
  settings: AutoBoneSettings
) {
  const { boundingBox, size, center, extremities, heightProfile } = analysis
  const minY = boundingBox.min.y
  const height = size.y
  const sideAxis = resolveSideAxis(analysis.symmetryAxis)
  const frontAxis = resolveFrontAxis(sideAxis)
  const profile = heightProfile

  const hipPeak = findProfilePeak(profile, minY, height, 0.25, 0.55, sideAxis)
  const shoulderPeak = findProfilePeak(profile, minY, height, 0.55, 0.85, sideAxis)

  const hipY = hipPeak?.y ?? minY + height * 0.35
  const shoulderY = shoulderPeak?.y ?? minY + height * 0.7
  const chestY = clamp(shoulderY - height * 0.12, hipY + height * 0.08, shoulderY - height * 0.02)

  const headTip = extremities
    .filter((ext) => ext.y > minY + height * 0.75)
    .sort((a, b) => b.y - a.y)[0]
  const headY = headTip ? headTip.y : minY + height * 0.92
  const neckY = clamp(headY - height * 0.08, shoulderY + height * 0.05, headY - height * 0.02)

  const hipSample = findClosestProfileSample(profile, hipY)
  const shoulderSample = findClosestProfileSample(profile, shoulderY)
  const hipWidth = hipSample ? getProfileDimensions(hipSample, sideAxis).width : (sideAxis === 'x' ? size.x : size.z)
  const shoulderWidth = shoulderSample ? getProfileDimensions(shoulderSample, sideAxis).width : (sideAxis === 'x' ? size.x : size.z)

  const frontAxisSign = (() => {
    if (headTip) {
      const offset = getAxisValue(headTip, frontAxis) - getAxisValue(center, frontAxis)
      if (Math.abs(offset) > 0.001) return offset >= 0 ? 1 : -1
    }
    return 1
  })()

  const footY = minY + height * 0.05
  const handY = chestY - height * 0.22

  const bottomExtremities = extremities.filter((ext) => ext.y < minY + height * 0.2)
  const midExtremities = extremities.filter((ext) => ext.y > minY + height * 0.45 && ext.y < minY + height * 0.85)

  const minSideOffset = Math.max(0.001, shoulderWidth * 0.18)
  const leftHand = pickExtremityBySide(midExtremities, sideAxis, center, -1, minSideOffset)
  const rightHand = pickExtremityBySide(midExtremities, sideAxis, center, 1, minSideOffset)
  const leftFoot = pickExtremityBySide(bottomExtremities, sideAxis, center, -1, minSideOffset)
  const rightFoot = pickExtremityBySide(bottomExtremities, sideAxis, center, 1, minSideOffset)

  return {
    pelvisY: hipY - height * 0.04,
    chestY,
    shoulderY,
    neckY,
    headY,
    hipWidth,
    shoulderWidth,
    footY,
    handY,
    sideAxis,
    frontAxis,
    frontAxisSign: frontAxisSign >= 0 ? 1 : -1,
    leftHand: leftHand ? [leftHand.x, leftHand.y, leftHand.z] : undefined,
    rightHand: rightHand ? [rightHand.x, rightHand.y, rightHand.z] : undefined,
    leftFoot: leftFoot ? [leftFoot.x, leftFoot.y, leftFoot.z] : undefined,
    rightFoot: rightFoot ? [rightFoot.x, rightFoot.y, rightFoot.z] : undefined,
    headTip: headTip ? [headTip.x, headTip.y, headTip.z] : undefined,
  }
}

/**
 * Analyze a 3D object (model) to find good bone positions
 * Works with world coordinates after model transformations
 */
export function analyzeModel(
  object: THREE.Object3D,
  options?: Partial<AutoBoneSettings>
): MeshAnalysis {
  const settings = normalizeAutoBoneSettings(options)
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
      symmetryAxis: settings.symmetryAxis === 'auto' ? 'x' : settings.symmetryAxis,
      size,
      heightProfile: buildHeightProfile([], box),
    }
  }

  // Calculate bounding box and center from world vertices
  const boundingBox = new THREE.Box3()
  worldVertices.forEach(v => boundingBox.expandByPoint(v))

  const center = boundingBox.getCenter(new THREE.Vector3())
  const size = boundingBox.getSize(new THREE.Vector3())

  // Find extremities using PCA-like approach
  const extremities = findExtremities(worldVertices, center, size, settings)

  // Detect symmetry axis
  const symmetryAxis = detectSymmetryAxis(worldVertices, center, size, settings.symmetryAxis)

  const heightProfile = buildHeightProfile(worldVertices, boundingBox)

  return {
    center,
    boundingBox,
    extremities,
    symmetryAxis,
    size,
    heightProfile,
  }
}

export function summarizeAnalysis(
  analysis: MeshAnalysis,
  settings?: Partial<AutoBoneSettings>
): MeshAnalysisSummary {
  const normalized = normalizeAutoBoneSettings(settings)
  const profileSummary = analysis.heightProfile.map((sample) => {
    const width = sample.maxX - sample.minX
    const depth = sample.maxZ - sample.minZ
    return {
      y: sample.y,
      width,
      depth,
      density: sample.count,
    }
  })
  const humanoidLandmarks = normalized.rigType === 'humanoid'
    ? deriveHumanoidLandmarks(analysis, normalized)
    : undefined

  return {
    center: [analysis.center.x, analysis.center.y, analysis.center.z],
    size: [analysis.size.x, analysis.size.y, analysis.size.z],
    boundingBox: {
      min: [analysis.boundingBox.min.x, analysis.boundingBox.min.y, analysis.boundingBox.min.z],
      max: [analysis.boundingBox.max.x, analysis.boundingBox.max.y, analysis.boundingBox.max.z],
    },
    extremities: analysis.extremities.map((ext) => [ext.x, ext.y, ext.z]),
    symmetryAxis: analysis.symmetryAxis,
    heightProfile: profileSummary,
    humanoidLandmarks,
  }
}

/**
 * Find extremity points (tips of limbs, tail, head, etc.)
 */
function findExtremities(
  vertices: THREE.Vector3[],
  center: THREE.Vector3,
  size: THREE.Vector3,
  settings: AutoBoneSettings
): THREE.Vector3[] {
  // Use adaptive clustering threshold based on model size
  const avgSize = (size.x + size.y + size.z) / 3
  const clusterThreshold = avgSize * settings.extremityClusterFactor

  // Find vertices far from center
  const withDistance = vertices.map(v => ({
    vertex: v,
    distance: v.distanceTo(center)
  }))

  // Sort by distance (furthest first)
  withDistance.sort((a, b) => b.distance - a.distance)

  // Take top 5% of furthest vertices
  const topCount = Math.max(20, Math.floor(vertices.length * settings.extremityTopPercent))
  const candidates = withDistance.slice(0, topCount).map(d => d.vertex)

  // Cluster the extremities
  const clusters = clusterPoints(candidates, clusterThreshold)

  // Return cluster centers (limited by settings)
  return clusters.slice(0, settings.maxExtremities).map(cluster => {
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
  size: THREE.Vector3,
  axisOverride: AutoBoneSettings['symmetryAxis']
): 'x' | 'y' | 'z' | null {
  if (axisOverride !== 'auto') {
    return axisOverride
  }
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
export function suggestBones(
  analysis: MeshAnalysis,
  options?: Partial<AutoBoneSettings>
): BoneSuggestion[] {
  const settings = normalizeAutoBoneSettings(options)
  if (settings.rigType === 'humanoid') {
    return suggestHumanoidBones(analysis, settings)
  }
  if (settings.rigType === 'quadruped') {
    return suggestQuadrupedBones(analysis, settings)
  }

  const suggestions: BoneSuggestion[] = []
  const { center, extremities, size } = analysis

  // Calculate appropriate bone length based on model size
  const avgSize = (size.x + size.y + size.z) / 3
  const boneSpacing = Math.max(avgSize * settings.boneSpacingFactor, 0.001)

  // 1. Root bone at center (slightly lower for creatures)
  const rootPos = center.clone()
  rootPos.y -= size.y * settings.rootYOffsetFactor

  suggestions.push({
    position: [rootPos.x, rootPos.y, rootPos.z],
    name: 'root',
    parentIndex: null,
    confidence: 1.0,
  })

  // 2. Spine/body bones along the longest axis
  const longestAxis = size.x > size.z ? 'x' : 'z'
  const spineLength = longestAxis === 'x' ? size.x : size.z
  const spineSegments = Math.max(
    settings.spineMinSegments,
    Math.min(settings.spineMaxSegments, Math.ceil(spineLength / boneSpacing))
  )

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
  const limitedExtremities = extremities.slice(0, settings.maxExtremities)
  limitedExtremities.forEach((extremity, extIndex) => {
    const direction = extremity.clone().sub(center)
    const distance = direction.length()

    if (distance < avgSize * settings.extremityMinDistanceFactor) return

    direction.normalize()

    // Determine bone chain name based on direction
    let baseName = ''
    const absY = Math.abs(direction.y)
    const symmetryAxis = analysis.symmetryAxis || 'x'
    const sideAxis = symmetryAxis === 'z' ? 'z' : 'x'
    const frontAxis = symmetryAxis === 'z' ? 'x' : 'z'
    const sideComponent = sideAxis === 'x' ? direction.x : direction.z
    const frontComponent = frontAxis === 'x' ? direction.x : direction.z
    const absSide = Math.abs(sideComponent)
    const absFront = Math.abs(frontComponent)

    if (absY > 0.7) {
      // Vertical
      baseName = direction.y > 0 ? 'head' : 'tail'
    } else if (absSide >= absFront) {
      // Side limb
      baseName = sideComponent > 0 ? 'limb_right' : 'limb_left'
    } else {
      // Front/back limb
      baseName = frontComponent > 0 ? 'limb_front' : 'limb_back'
    }

    // Add index if we have multiple similar limbs
    baseName = `${baseName}_${String(extIndex).padStart(2, '0')}`

    // Create bone chain from root to extremity
    const chainLength = Math.max(
      settings.limbMinSegments,
      Math.min(settings.limbMaxSegments, Math.ceil(distance / boneSpacing))
    )
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

function suggestHumanoidBones(
  analysis: MeshAnalysis,
  settings: AutoBoneSettings
): BoneSuggestion[] {
  const suggestions: BoneSuggestion[] = []
  const { center, size, boundingBox } = analysis
  const minY = boundingBox.min.y
  const height = size.y
  const avgSize = (size.x + size.y + size.z) / 3
  const boneSpacing = Math.max(avgSize * settings.boneSpacingFactor, 0.001)
  const landmarks = deriveHumanoidLandmarks(analysis, settings)
  const sideAxis = landmarks.sideAxis
  const frontAxis = landmarks.frontAxis
  const frontSign = landmarks.frontAxisSign
  const width = sideAxis === 'x' ? size.x : size.z
  const depth = frontAxis === 'x' ? size.x : size.z
  const margin = height * 0.06

  const pelvisY = landmarks.pelvisY
  const rootY = clamp(
    pelvisY - height * settings.rootYOffsetFactor,
    minY + height * 0.02,
    pelvisY - height * 0.02
  )
  const chestY = landmarks.chestY
  const shoulderY = landmarks.shoulderY
  const neckY = landmarks.neckY
  const headY = landmarks.headY

  const rootPos = new THREE.Vector3(center.x, rootY, center.z)
  clampToBounds(rootPos, boundingBox, margin)
  const rootIdx = addSuggestion(suggestions, rootPos, 'root', null, 1.0)

  const pelvisPos = new THREE.Vector3(center.x, pelvisY, center.z)
  clampToBounds(pelvisPos, boundingBox, margin)
  const pelvisIdx = addSuggestion(suggestions, pelvisPos, 'pelvis', rootIdx, 0.95)

  const spineLength = Math.max(0.01, chestY - pelvisY)
  const spineSegments = Math.max(
    settings.spineMinSegments,
    Math.min(settings.spineMaxSegments, Math.ceil(spineLength / boneSpacing))
  )

  let lastSpineIdx = pelvisIdx
  for (let i = 1; i <= spineSegments; i++) {
    const t = i / (spineSegments + 1)
    const pos = new THREE.Vector3(center.x, pelvisY + spineLength * t, center.z)
    const name = i === spineSegments ? 'chest' : `spine_${String(i).padStart(2, '0')}`
    lastSpineIdx = addSuggestion(suggestions, pos, name, lastSpineIdx, 0.95)
  }

  const neckPos = new THREE.Vector3(center.x, neckY, center.z)
  addAxisValue(neckPos, frontAxis, depth * 0.02 * frontSign)
  clampToBounds(neckPos, boundingBox, margin)
  const neckIdx = addSuggestion(suggestions, neckPos, 'neck', lastSpineIdx, 0.95)

  const headPos = landmarks.headTip
    ? new THREE.Vector3(...landmarks.headTip)
    : new THREE.Vector3(center.x, headY, center.z)
  addAxisValue(headPos, frontAxis, depth * 0.08 * frontSign)
  clampToBounds(headPos, boundingBox, margin)
  addSuggestion(suggestions, headPos, 'head', neckIdx, 0.95)

  const shoulderOffset = Math.max(landmarks.shoulderWidth * 0.45, width * 0.25)
  const hipOffset = Math.max(landmarks.hipWidth * 0.35, width * 0.2)
  const armForward = depth * 0.05 * frontSign
  const legForward = depth * 0.03 * frontSign

  const clavicleY = chestY + height * 0.03

  const addArm = (side: 'left' | 'right', sideSign: number) => {
    const claviclePos = new THREE.Vector3(center.x, clavicleY, center.z)
    addAxisValue(claviclePos, sideAxis, shoulderOffset * 0.55 * sideSign)
    addAxisValue(claviclePos, frontAxis, armForward * 0.4)
    clampToBounds(claviclePos, boundingBox, margin)
    const clavicleIdx = addSuggestion(suggestions, claviclePos, `clavicle_${side}`, lastSpineIdx, 0.9)

    const shoulderPos = new THREE.Vector3(center.x, shoulderY, center.z)
    addAxisValue(shoulderPos, sideAxis, shoulderOffset * sideSign)
    addAxisValue(shoulderPos, frontAxis, armForward)
    clampToBounds(shoulderPos, boundingBox, margin)
    const upperIdx = addSuggestion(suggestions, shoulderPos, `upper_arm_${side}`, clavicleIdx, 0.9)

    const fallbackHandY = clamp(landmarks.handY, minY + height * 0.35, shoulderY - height * 0.08)
    const handPos = sideSign < 0 && landmarks.leftHand
      ? new THREE.Vector3(...landmarks.leftHand)
      : sideSign > 0 && landmarks.rightHand
        ? new THREE.Vector3(...landmarks.rightHand)
        : new THREE.Vector3(center.x, fallbackHandY, center.z)

    if (!landmarks.leftHand && sideSign < 0) {
      addAxisValue(handPos, sideAxis, shoulderOffset * 1.55 * sideSign)
      addAxisValue(handPos, frontAxis, armForward + depth * 0.02 * frontSign)
    } else if (!landmarks.rightHand && sideSign > 0) {
      addAxisValue(handPos, sideAxis, shoulderOffset * 1.55 * sideSign)
      addAxisValue(handPos, frontAxis, armForward + depth * 0.02 * frontSign)
    }

    handPos.y = clamp(handPos.y, minY + height * 0.3, shoulderY - height * 0.05)
    clampToBounds(handPos, boundingBox, margin)

    const elbowPos = new THREE.Vector3().lerpVectors(shoulderPos, handPos, 0.5)
    elbowPos.y = clamp(elbowPos.y, minY + height * 0.35, shoulderY - height * 0.1)
    clampToBounds(elbowPos, boundingBox, margin)
    const lowerIdx = addSuggestion(suggestions, elbowPos, `lower_arm_${side}`, upperIdx, 0.85)

    addSuggestion(suggestions, handPos, `hand_${side}`, lowerIdx, 0.8)
  }

  addArm('left', -1)
  addArm('right', 1)

  const addLeg = (side: 'left' | 'right', sideSign: number) => {
    const hipPos = new THREE.Vector3(center.x, pelvisY, center.z)
    addAxisValue(hipPos, sideAxis, hipOffset * sideSign)
    addAxisValue(hipPos, frontAxis, legForward)
    clampToBounds(hipPos, boundingBox, margin)
    const upperIdx = addSuggestion(suggestions, hipPos, `upper_leg_${side}`, pelvisIdx, 0.9)

    const fallbackFootY = clamp(landmarks.footY, minY + height * 0.02, pelvisY - height * 0.15)
    const footPos = sideSign < 0 && landmarks.leftFoot
      ? new THREE.Vector3(...landmarks.leftFoot)
      : sideSign > 0 && landmarks.rightFoot
        ? new THREE.Vector3(...landmarks.rightFoot)
        : new THREE.Vector3(center.x, fallbackFootY, center.z)

    if (!landmarks.leftFoot && sideSign < 0) {
      addAxisValue(footPos, sideAxis, hipOffset * 1.25 * sideSign)
      addAxisValue(footPos, frontAxis, legForward + depth * 0.04 * frontSign)
    } else if (!landmarks.rightFoot && sideSign > 0) {
      addAxisValue(footPos, sideAxis, hipOffset * 1.25 * sideSign)
      addAxisValue(footPos, frontAxis, legForward + depth * 0.04 * frontSign)
    }

    footPos.y = clamp(footPos.y, minY + height * 0.01, pelvisY - height * 0.1)
    clampToBounds(footPos, boundingBox, margin)

    const kneePos = new THREE.Vector3().lerpVectors(hipPos, footPos, 0.5)
    kneePos.y = clamp(kneePos.y, minY + height * 0.15, pelvisY - height * 0.2)
    clampToBounds(kneePos, boundingBox, margin)
    const lowerIdx = addSuggestion(suggestions, kneePos, `lower_leg_${side}`, upperIdx, 0.85)

    addSuggestion(suggestions, footPos, `foot_${side}`, lowerIdx, 0.8)
  }

  addLeg('left', -1)
  addLeg('right', 1)

  return suggestions
}

function suggestQuadrupedBones(
  analysis: MeshAnalysis,
  settings: AutoBoneSettings
): BoneSuggestion[] {
  const suggestions: BoneSuggestion[] = []
  const { center, size, boundingBox } = analysis
  const minY = boundingBox.min.y
  const height = size.y
  const avgSize = (size.x + size.y + size.z) / 3
  const boneSpacing = Math.max(avgSize * settings.boneSpacingFactor, 0.001)
  const sideAxis = resolveSideAxis(analysis.symmetryAxis)
  const frontAxis = resolveFrontAxis(sideAxis)
  const width = sideAxis === 'x' ? size.x : size.z
  const depth = frontAxis === 'x' ? size.x : size.z

  const rootY = minY + height * 0.3 - height * settings.rootYOffsetFactor
  const bodyY = minY + height * 0.45

  const rootPos = new THREE.Vector3(center.x, rootY, center.z)
  const rootIdx = addSuggestion(suggestions, rootPos, 'root', null, 1.0)

  const spineLength = Math.max(0.01, depth * 0.7)
  const spineSegments = Math.max(
    settings.spineMinSegments,
    Math.min(settings.spineMaxSegments, Math.ceil(spineLength / boneSpacing))
  )

  const backPos = new THREE.Vector3(center.x, bodyY, center.z)
  addAxisValue(backPos, frontAxis, -depth * 0.35)
  const frontPos = new THREE.Vector3(center.x, bodyY, center.z)
  addAxisValue(frontPos, frontAxis, depth * 0.35)

  let lastSpineIdx = rootIdx
  for (let i = 1; i <= spineSegments; i++) {
    const t = i / (spineSegments + 1)
    const pos = backPos.clone().lerp(frontPos, t)
    const name = i === spineSegments ? 'chest' : `spine_${String(i).padStart(2, '0')}`
    lastSpineIdx = addSuggestion(suggestions, pos, name, lastSpineIdx, 0.95)
  }

  const neckPos = frontPos.clone()
  setAxisValue(neckPos, 'y', minY + height * 0.6)
  const neckIdx = addSuggestion(suggestions, neckPos, 'neck', lastSpineIdx, 0.95)

  const headPos = frontPos.clone()
  setAxisValue(headPos, 'y', minY + height * 0.75)
  addAxisValue(headPos, frontAxis, depth * 0.12)
  addSuggestion(suggestions, headPos, 'head', neckIdx, 0.9)

  const tailBasePos = backPos.clone()
  setAxisValue(tailBasePos, 'y', minY + height * 0.45)
  const tailBaseIdx = addSuggestion(suggestions, tailBasePos, 'tail_base', rootIdx, 0.85)
  const tailTipPos = tailBasePos.clone()
  addAxisValue(tailTipPos, frontAxis, -depth * 0.15)
  setAxisValue(tailTipPos, 'y', minY + height * 0.4)
  addSuggestion(suggestions, tailTipPos, 'tail_tip', tailBaseIdx, 0.8)

  const legSideOffset = width * 0.3
  const frontLegY = minY + height * 0.42
  const backLegY = minY + height * 0.38
  const footY = minY + height * 0.05

  const addLeg = (prefix: string, frontOffset: number, sideSign: number, hipY: number, parentIdx: number) => {
    const hipPos = new THREE.Vector3(center.x, hipY, center.z)
    addAxisValue(hipPos, frontAxis, frontOffset)
    addAxisValue(hipPos, sideAxis, legSideOffset * sideSign)
    const sideLabel = sideSign > 0 ? 'right' : 'left'
    const upperIdx = addSuggestion(suggestions, hipPos, `${prefix}_leg_${sideLabel}_01`, parentIdx, 0.9)

    const kneePos = hipPos.clone()
    setAxisValue(kneePos, 'y', hipY - height * 0.2)
    const lowerIdx = addSuggestion(suggestions, kneePos, `${prefix}_leg_${sideLabel}_02`, upperIdx, 0.85)

    const footPos = hipPos.clone()
    setAxisValue(footPos, 'y', footY)
    addSuggestion(suggestions, footPos, `${prefix}_leg_${sideLabel}_03`, lowerIdx, 0.8)
  }

  const frontOffset = depth * 0.3
  const backOffset = -depth * 0.3
  addLeg('front', frontOffset, -1, frontLegY, lastSpineIdx)
  addLeg('front', frontOffset, 1, frontLegY, lastSpineIdx)
  addLeg('back', backOffset, -1, backLegY, rootIdx)
  addLeg('back', backOffset, 1, backLegY, rootIdx)

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
