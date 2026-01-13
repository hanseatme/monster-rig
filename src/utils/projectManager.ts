import type { ProjectData, BoneData } from '../types'
import SHA256 from 'crypto-js/sha256'

const PROJECT_VERSION = '1.0'

export async function createNewProject(): Promise<ProjectData> {
  return {
    version: PROJECT_VERSION,
    modelPath: '',
    modelHash: '',
    skeleton: { bones: [] },
    weightMap: {},
    animations: [],
  }
}

export async function loadProjectFromFile(filePath: string): Promise<ProjectData | null> {
  if (!window.electronAPI) return null

  try {
    const content = await window.electronAPI.readFileText(filePath)
    const project = JSON.parse(content) as ProjectData

    // Validate version
    if (!project.version) {
      console.warn('Project has no version, assuming 1.0')
      project.version = '1.0'
    }

    // Validate and migrate if needed
    return migrateProject(project)
  } catch (error) {
    console.error('Failed to load project:', error)
    return null
  }
}

export async function saveProjectToFile(
  project: ProjectData,
  filePath: string
): Promise<boolean> {
  if (!window.electronAPI) return false

  try {
    const jsonContent = JSON.stringify(project, null, 2)
    await window.electronAPI.writeFile(filePath, jsonContent)
    return true
  } catch (error) {
    console.error('Failed to save project:', error)
    return false
  }
}

export async function calculateModelHash(modelPath: string): Promise<string> {
  if (!window.electronAPI) return ''

  try {
    const data = await window.electronAPI.readFile(modelPath)
    // Convert buffer to Uint8Array for hashing
    let bytes: Uint8Array
    if (data instanceof Uint8Array) {
      bytes = data
    } else if (data && typeof data === 'object' && 'data' in data) {
      bytes = new Uint8Array((data as { data: number[] }).data)
    } else {
      bytes = new Uint8Array(data as ArrayBuffer)
    }
    // Convert to base64 for hashing
    const base64 = btoa(
      bytes.reduce((str, byte) => str + String.fromCharCode(byte), '')
    )
    return SHA256(base64).toString()
  } catch (error) {
    console.error('Failed to calculate model hash:', error)
    return ''
  }
}

export async function verifyModelIntegrity(
  modelPath: string,
  expectedHash: string
): Promise<boolean> {
  const currentHash = await calculateModelHash(modelPath)
  return currentHash === expectedHash
}

function migrateProject(project: ProjectData): ProjectData {
  // Handle version migrations here
  switch (project.version) {
    case '1.0':
      // Current version, no migration needed
      break
    default:
      console.warn(`Unknown project version: ${project.version}`)
  }

  return project
}

export function validateProject(project: ProjectData): string[] {
  const errors: string[] = []

  if (!project.version) {
    errors.push('Missing project version')
  }

  if (!project.skeleton) {
    errors.push('Missing skeleton data')
  } else {
    // Validate bones
    const boneIds = new Set(project.skeleton.bones.map((b) => b.id))

    project.skeleton.bones.forEach((bone, index) => {
      if (!bone.id) {
        errors.push(`Bone at index ${index} has no ID`)
      }
      if (!bone.name) {
        errors.push(`Bone ${bone.id} has no name`)
      }
      if (bone.parentId && !boneIds.has(bone.parentId)) {
        errors.push(`Bone ${bone.name} references non-existent parent ${bone.parentId}`)
      }
    })
  }

  // Validate animations
  project.animations?.forEach((anim) => {
    if (!anim.id) {
      errors.push('Animation has no ID')
    }
    if (!anim.name) {
      errors.push(`Animation ${anim.id} has no name`)
    }
    if (anim.frameCount <= 0) {
      errors.push(`Animation ${anim.name} has invalid frame count`)
    }
  })

  return errors
}

export function generateBoneName(
  existingBones: BoneData[],
  parentBone: BoneData | null,
  suggestedPrefix?: string
): string {
  const baseName = suggestedPrefix || (parentBone ? `${parentBone.name}_child` : 'bone')

  let index = 1
  let name = baseName
  const existingNames = new Set(existingBones.map((b) => b.name))

  while (existingNames.has(name)) {
    name = `${baseName}_${String(index).padStart(2, '0')}`
    index++
  }

  return name
}

export function suggestBoneNamePattern(position: [number, number, number]): string {
  const [x, y, z] = position

  // Determine side
  const side = x > 0.1 ? '_right' : x < -0.1 ? '_left' : ''

  // Determine location based on y position
  let location = ''
  if (y > 1.5) {
    location = 'head'
  } else if (y > 0.5) {
    location = 'spine'
  } else if (y > -0.5) {
    location = 'hip'
  } else {
    location = 'leg'
  }

  // Check if it's a limb based on distance from center
  const distanceFromCenter = Math.sqrt(x * x + z * z)
  if (distanceFromCenter > 0.5) {
    if (z > 0) {
      location = 'arm_front'
    } else {
      location = 'arm_back'
    }
  }

  return `${location}${side}`
}
