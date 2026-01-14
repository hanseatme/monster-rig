import type { AutoBoneSettings } from '../types'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const clampInt = (value: number, min: number, max: number) => Math.round(clamp(value, min, max))

export const DEFAULT_AUTO_BONE_SETTINGS: AutoBoneSettings = {
  rigType: 'auto',
  boneSpacingFactor: 0.2,
  rootYOffsetFactor: 0.1,
  spineMinSegments: 2,
  spineMaxSegments: 5,
  limbMinSegments: 2,
  limbMaxSegments: 4,
  extremityClusterFactor: 0.15,
  extremityTopPercent: 0.05,
  maxExtremities: 8,
  extremityMinDistanceFactor: 0.2,
  symmetryAxis: 'auto',
}

export function normalizeAutoBoneSettings(
  overrides?: Partial<AutoBoneSettings>
): AutoBoneSettings {
  const merged = { ...DEFAULT_AUTO_BONE_SETTINGS, ...(overrides || {}) }

  const spineMin = clampInt(merged.spineMinSegments, 1, 12)
  const spineMax = clampInt(merged.spineMaxSegments, spineMin, 16)
  const limbMin = clampInt(merged.limbMinSegments, 1, 8)
  const limbMax = clampInt(merged.limbMaxSegments, limbMin, 10)

  const symmetryAxis =
    merged.symmetryAxis === 'x' || merged.symmetryAxis === 'y' || merged.symmetryAxis === 'z'
      ? merged.symmetryAxis
      : 'auto'

  const rigType =
    merged.rigType === 'humanoid' || merged.rigType === 'quadruped'
      ? merged.rigType
      : 'auto'

  return {
    rigType,
    boneSpacingFactor: clamp(merged.boneSpacingFactor, 0.05, 0.6),
    rootYOffsetFactor: clamp(merged.rootYOffsetFactor, -0.3, 0.3),
    spineMinSegments: spineMin,
    spineMaxSegments: spineMax,
    limbMinSegments: limbMin,
    limbMaxSegments: limbMax,
    extremityClusterFactor: clamp(merged.extremityClusterFactor, 0.05, 0.4),
    extremityTopPercent: clamp(merged.extremityTopPercent, 0.01, 0.2),
    maxExtremities: clampInt(merged.maxExtremities, 2, 16),
    extremityMinDistanceFactor: clamp(merged.extremityMinDistanceFactor, 0.05, 0.5),
    symmetryAxis,
  }
}
