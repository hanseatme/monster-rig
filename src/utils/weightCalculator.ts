import * as THREE from 'three'
import type { BoneData } from '../types'

interface WeightCalculationOptions {
  method: 'envelope' | 'heatmap' | 'nearest'
  falloff: number
  normalizeWeights: boolean
}

const defaultOptions: WeightCalculationOptions = {
  method: 'envelope',
  falloff: 2.0,
  normalizeWeights: true,
}

export function calculateAutomaticWeights(
  mesh: THREE.Mesh,
  bones: BoneData[],
  options: Partial<WeightCalculationOptions> = {}
): [number, number][][] {
  const opts = { ...defaultOptions, ...options }
  const geometry = mesh.geometry
  const position = geometry.attributes.position
  const vertexCount = position.count

  const weights: [number, number][][] = []

  for (let i = 0; i < vertexCount; i++) {
    const vertex = new THREE.Vector3(
      position.getX(i),
      position.getY(i),
      position.getZ(i)
    )

    // Transform to world space
    vertex.applyMatrix4(mesh.matrixWorld)

    const vertexWeights = calculateVertexWeights(vertex, bones, opts)
    weights.push(vertexWeights)
  }

  return weights
}

function calculateVertexWeights(
  vertex: THREE.Vector3,
  bones: BoneData[],
  options: WeightCalculationOptions
): [number, number][] {
  const weights: [number, number][] = []

  switch (options.method) {
    case 'envelope':
      weights.push(...calculateEnvelopeWeights(vertex, bones, options.falloff))
      break
    case 'heatmap':
      weights.push(...calculateHeatmapWeights(vertex, bones))
      break
    case 'nearest':
      weights.push(...calculateNearestWeights(vertex, bones))
      break
  }

  if (options.normalizeWeights) {
    return normalizeWeights(weights)
  }

  return weights
}

function calculateEnvelopeWeights(
  vertex: THREE.Vector3,
  bones: BoneData[],
  falloff: number
): [number, number][] {
  const weights: [number, number][] = []

  bones.forEach((bone, index) => {
    const bonePos = new THREE.Vector3(...bone.position)
    const distance = vertex.distanceTo(bonePos)

    // Calculate weight based on inverse distance with falloff
    const envelopeRadius = bone.length * 2 // Envelope size based on bone length
    if (distance < envelopeRadius) {
      const normalizedDist = distance / envelopeRadius
      const weight = Math.pow(1 - normalizedDist, falloff)
      if (weight > 0.001) {
        weights.push([index, weight])
      }
    }
  })

  return weights
}

function calculateHeatmapWeights(
  vertex: THREE.Vector3,
  bones: BoneData[]
): [number, number][] {
  // Simplified heat map - in a real implementation this would use
  // geodesic distances and diffusion equations
  const weights: [number, number][] = []

  bones.forEach((bone, index) => {
    const bonePos = new THREE.Vector3(...bone.position)
    const distance = vertex.distanceTo(bonePos)

    // Heat diffusion approximation
    const sigma = bone.length * 1.5
    const heat = Math.exp(-(distance * distance) / (2 * sigma * sigma))

    if (heat > 0.001) {
      weights.push([index, heat])
    }
  })

  return weights
}

function calculateNearestWeights(
  vertex: THREE.Vector3,
  bones: BoneData[]
): [number, number][] {
  if (bones.length === 0) return []

  let nearestIndex = 0
  let nearestDistance = Infinity

  bones.forEach((bone, index) => {
    const bonePos = new THREE.Vector3(...bone.position)
    const distance = vertex.distanceTo(bonePos)

    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  })

  return [[nearestIndex, 1.0]]
}

function normalizeWeights(weights: [number, number][]): [number, number][] {
  const total = weights.reduce((sum, [, w]) => sum + w, 0)
  if (total === 0) return weights

  return weights.map(([index, weight]) => [index, weight / total])
}

export function smoothWeights(
  weights: [number, number][][],
  adjacency: number[][],
  iterations: number = 1
): [number, number][][] {
  let result = [...weights.map((w) => [...w])]

  for (let iter = 0; iter < iterations; iter++) {
    const newWeights: [number, number][][] = []

    for (let i = 0; i < result.length; i++) {
      const neighbors = adjacency[i] || []
      const neighborWeights: Map<number, number[]> = new Map()

      // Collect all weights from this vertex and neighbors
      const addWeight = (boneIdx: number, weight: number) => {
        if (!neighborWeights.has(boneIdx)) {
          neighborWeights.set(boneIdx, [])
        }
        neighborWeights.get(boneIdx)!.push(weight)
      }

      // Current vertex weights
      result[i].forEach(([boneIdx, weight]) => {
        addWeight(boneIdx, weight)
      })

      // Neighbor weights
      neighbors.forEach((neighborIdx) => {
        result[neighborIdx]?.forEach(([boneIdx, weight]) => {
          addWeight(boneIdx, weight * 0.5) // Neighbors contribute half
        })
      })

      // Average weights
      const averaged: [number, number][] = []
      neighborWeights.forEach((weightList, boneIdx) => {
        const avg = weightList.reduce((a, b) => a + b, 0) / weightList.length
        if (avg > 0.001) {
          averaged.push([boneIdx, avg])
        }
      })

      newWeights.push(normalizeWeights(averaged))
    }

    result = newWeights
  }

  return result
}

export function mirrorWeights(
  weights: [number, number][][],
  vertices: THREE.Vector3[],
  bones: BoneData[],
  axis: 'x' | 'y' | 'z' = 'x'
): [number, number][][] {
  const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  const mirroredWeights = [...weights.map((w) => [...w])]

  // Create a map of bones to their mirrored counterparts
  const boneNameMap = new Map<string, number>()
  bones.forEach((bone, index) => {
    boneNameMap.set(bone.name, index)
  })

  const getMirrorBoneIndex = (boneIndex: number): number => {
    const bone = bones[boneIndex]
    if (!bone) return boneIndex

    let mirrorName = bone.name
    if (mirrorName.includes('_left')) {
      mirrorName = mirrorName.replace('_left', '_right')
    } else if (mirrorName.includes('_right')) {
      mirrorName = mirrorName.replace('_right', '_left')
    } else if (mirrorName.includes('_l_')) {
      mirrorName = mirrorName.replace('_l_', '_r_')
    } else if (mirrorName.includes('_r_')) {
      mirrorName = mirrorName.replace('_r_', '_l_')
    }

    return boneNameMap.get(mirrorName) ?? boneIndex
  }

  // Find matching vertices across the axis
  vertices.forEach((vertex, i) => {
    if (vertex.getComponent(axisIndex) > 0.01) {
      // Find mirrored vertex
      const mirroredPos = vertex.clone()
      mirroredPos.setComponent(axisIndex, -mirroredPos.getComponent(axisIndex))

      let closestIdx = -1
      let closestDist = Infinity

      vertices.forEach((v, j) => {
        if (i === j) return
        const dist = v.distanceTo(mirroredPos)
        if (dist < closestDist && dist < 0.01) {
          closestDist = dist
          closestIdx = j
        }
      })

      if (closestIdx >= 0) {
        // Mirror weights
        mirroredWeights[closestIdx] = weights[i].map(([boneIdx, weight]) => [
          getMirrorBoneIndex(boneIdx),
          weight,
        ])
      }
    }
  })

  return mirroredWeights
}
