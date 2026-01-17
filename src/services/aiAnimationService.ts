import type { BoneData, AnimationClip, AnimationTrack, Keyframe, KeyframeProperty } from '../types'
import * as THREE from 'three'
import { v4 as uuidv4 } from 'uuid'

interface AIGenerationResult {
  success: boolean
  animation?: AnimationClip
  error?: string
}

type Side = 'left' | 'right'

interface RigAnalysis {
  sideAxis: 'x' | 'z'
  frontAxis: 'x' | 'z'
  isHumanoid: boolean
  tPoseLikely: boolean
  groups: {
    pelvis?: BoneData
    chest?: BoneData
    neck?: BoneData
    head?: BoneData
    clavicleLeft?: BoneData
    clavicleRight?: BoneData
    upperArmLeft?: BoneData
    upperArmRight?: BoneData
    lowerArmLeft?: BoneData
    lowerArmRight?: BoneData
    handLeft?: BoneData
    handRight?: BoneData
    upperLegLeft?: BoneData
    upperLegRight?: BoneData
    lowerLegLeft?: BoneData
    lowerLegRight?: BoneData
    footLeft?: BoneData
    footRight?: BoneData
  }
}

// System prompt for animation generation
const SYSTEM_PROMPT = `You are an expert 3D animator. Your task is to generate keyframe animation data for a skeleton rig.

You will receive:
1. A list of bones with their names, parents, rest positions, and rest rotations
2. An animation description/prompt

You must output a JSON object with this exact structure:
{
  "animationName": "string - name for the animation",
  "frameCount": number (total frames, typically 30-120),
  "fps": 30,
  "bones": [
    {
      "boneName": "exact bone name from input",
      "keyframes": [
        {
          "frame": 0,
          "rotation": [x, y, z, w]  // quaternion, use small rotations
        },
        {
          "frame": 15,
          "rotation": [x, y, z, w]
        }
      ]
    }
  ]
}

IMPORTANT RULES:
1. Use ONLY bone names from the provided skeleton
2. Rotations are absolute world-space quaternions [x, y, z, w] and must be normalized
3. Use the provided rest rotation as the neutral pose; apply small deltas around it unless the prompt requests big motion
4. Prefer rotation keys. Only include position or scale keys if explicitly requested
5. Always include frame 0 for every animated bone and keep frames within [0, frameCount - 1]
6. For cyclic animations (walk, idle, breathe), make the last keyframe return close to the first
7. Use 4-12 keyframes per animated bone, spaced to match motion beats
8. Focus on the bones that would naturally move for the described animation
9. Not every bone needs to be animated - only animate relevant bones
10. For locomotion (walk/run/jog), avoid T-pose: include arm swing, relaxed shoulders, and alternating leg motion
11. For humanoids, keep arms slightly lowered/bent unless the prompt explicitly wants a T-pose

Output ONLY the JSON object, no explanation or markdown.`

const normalizeName = (value: string) => value.toLowerCase().replace(/\s+/g, '_')

const isCentralPelvisName = (name: string) => {
  const normalized = normalizeName(name)
  if (!/(pelvis|hips|hip)$/.test(normalized)) return false
  if (/(left|right|_l|_r|\.l|\.r|_left|_right)$/.test(normalized)) return false
  return true
}

const getSide = (name: string): Side | null => {
  const normalized = normalizeName(name)
  if (/(^|_|\.|-)(left|l)(_|\.|-|$)/.test(normalized)) return 'left'
  if (/(^|_|\.|-)(right|r)(_|\.|-|$)/.test(normalized)) return 'right'
  return null
}

const matchesAny = (name: string, patterns: string[]) => {
  return patterns.some((pattern) => name.includes(pattern))
}

const analyzeRig = (bones: BoneData[]): RigAnalysis => {
  const positions = bones.map((bone) => bone.position)
  const xs = positions.map((p) => p[0])
  const zs = positions.map((p) => p[2])
  const spreadX = Math.max(...xs, 0) - Math.min(...xs, 0)
  const spreadZ = Math.max(...zs, 0) - Math.min(...zs, 0)
  const sideAxis: 'x' | 'z' = spreadX >= spreadZ ? 'x' : 'z'
  const frontAxis: 'x' | 'z' = sideAxis === 'x' ? 'z' : 'x'

  const groups: RigAnalysis['groups'] = {}

  const candidates: {
    upperArm: BoneData[]
    lowerArm: BoneData[]
    hand: BoneData[]
    clavicle: BoneData[]
    upperLeg: BoneData[]
    lowerLeg: BoneData[]
    foot: BoneData[]
  } = {
    upperArm: [],
    lowerArm: [],
    hand: [],
    clavicle: [],
    upperLeg: [],
    lowerLeg: [],
    foot: [],
  }

  bones.forEach((bone) => {
    const name = normalizeName(bone.name)
    const side = getSide(name)
    const isLowerArm = matchesAny(name, ['lower_arm', 'lowerarm', 'forearm', 'arm_lower', 'elbow'])
    const isUpperArm = matchesAny(name, ['upper_arm', 'upperarm', 'arm_upper', 'humerus']) ||
      (name.includes('arm') && !isLowerArm && !name.includes('hand') && !name.includes('wrist'))
    const isClavicle = matchesAny(name, ['clavicle', 'collar', 'shoulder'])
    const isHand = matchesAny(name, ['hand', 'wrist'])
    const isLowerLeg = matchesAny(name, ['lower_leg', 'lowerleg', 'calf', 'shin', 'leg_lower'])
    const isUpperLeg = matchesAny(name, ['upper_leg', 'upperleg', 'thigh', 'leg_upper']) ||
      (name.includes('leg') && !isLowerLeg && !name.includes('foot'))
    const isFoot = matchesAny(name, ['foot', 'ankle', 'toe'])

    if (matchesAny(name, ['pelvis', 'hips', 'hip'])) {
      groups.pelvis = groups.pelvis || bone
    }
    if (matchesAny(name, ['chest', 'spine', 'torso'])) {
      groups.chest = groups.chest || bone
    }
    if (matchesAny(name, ['neck'])) {
      groups.neck = groups.neck || bone
    }
    if (matchesAny(name, ['head'])) {
      groups.head = groups.head || bone
    }

    if (isClavicle) candidates.clavicle.push(bone)
    if (isUpperArm) candidates.upperArm.push(bone)
    if (isLowerArm) candidates.lowerArm.push(bone)
    if (isHand) candidates.hand.push(bone)
    if (isUpperLeg) candidates.upperLeg.push(bone)
    if (isLowerLeg) candidates.lowerLeg.push(bone)
    if (isFoot) candidates.foot.push(bone)

    if (side === 'left') {
      if (isClavicle) groups.clavicleLeft = groups.clavicleLeft || bone
      if (isUpperArm) groups.upperArmLeft = groups.upperArmLeft || bone
      if (isLowerArm) groups.lowerArmLeft = groups.lowerArmLeft || bone
      if (isHand) groups.handLeft = groups.handLeft || bone
      if (isUpperLeg) groups.upperLegLeft = groups.upperLegLeft || bone
      if (isLowerLeg) groups.lowerLegLeft = groups.lowerLegLeft || bone
      if (isFoot) groups.footLeft = groups.footLeft || bone
    } else if (side === 'right') {
      if (isClavicle) groups.clavicleRight = groups.clavicleRight || bone
      if (isUpperArm) groups.upperArmRight = groups.upperArmRight || bone
      if (isLowerArm) groups.lowerArmRight = groups.lowerArmRight || bone
      if (isHand) groups.handRight = groups.handRight || bone
      if (isUpperLeg) groups.upperLegRight = groups.upperLegRight || bone
      if (isLowerLeg) groups.lowerLegRight = groups.lowerLegRight || bone
      if (isFoot) groups.footRight = groups.footRight || bone
    }
  })

  const assignBySideAxis = (list: BoneData[], leftKey: keyof RigAnalysis['groups'], rightKey: keyof RigAnalysis['groups']) => {
    if (groups[leftKey] || groups[rightKey] || list.length < 2) return
    const sorted = [...list].sort((a, b) => {
      const aVal = sideAxis === 'x' ? a.position[0] : a.position[2]
      const bVal = sideAxis === 'x' ? b.position[0] : b.position[2]
      return aVal - bVal
    })
    groups[leftKey] = sorted[0]
    groups[rightKey] = sorted[sorted.length - 1]
  }

  assignBySideAxis(candidates.clavicle, 'clavicleLeft', 'clavicleRight')
  assignBySideAxis(candidates.upperArm, 'upperArmLeft', 'upperArmRight')
  assignBySideAxis(candidates.lowerArm, 'lowerArmLeft', 'lowerArmRight')
  assignBySideAxis(candidates.hand, 'handLeft', 'handRight')
  assignBySideAxis(candidates.upperLeg, 'upperLegLeft', 'upperLegRight')
  assignBySideAxis(candidates.lowerLeg, 'lowerLegLeft', 'lowerLegRight')
  assignBySideAxis(candidates.foot, 'footLeft', 'footRight')

  const isHumanoid = Boolean(groups.upperArmLeft || groups.upperArmRight || groups.upperLegLeft || groups.upperLegRight)

  const childMap = new Map<string, BoneData[]>()
  bones.forEach((bone) => {
    if (!bone.parentId) return
    const existing = childMap.get(bone.parentId) || []
    existing.push(bone)
    childMap.set(bone.parentId, existing)
  })

  const armSamples = [groups.upperArmLeft, groups.upperArmRight].filter(Boolean) as BoneData[]
  const tPoseLikely = armSamples.some((arm) => {
    const child = (childMap.get(arm.id) || [])[0]
    if (!child) return false
    const dir = new THREE.Vector3(
      child.position[0] - arm.position[0],
      child.position[1] - arm.position[1],
      child.position[2] - arm.position[2]
    )
    const horizontal = Math.sqrt(dir.x * dir.x + dir.z * dir.z)
    return horizontal > 0.001 && Math.abs(dir.y / horizontal) < 0.2
  })

  return {
    sideAxis,
    frontAxis,
    isHumanoid,
    tPoseLikely,
    groups,
  }
}

const buildRigHints = (analysis: RigAnalysis) => {
  const entries: string[] = [
    `Side axis: ${analysis.sideAxis}, front axis: ${analysis.frontAxis}, up axis: y`,
    `Humanoid rig: ${analysis.isHumanoid ? 'yes' : 'no'}`,
    `Rest pose: ${analysis.tPoseLikely ? 'arms likely horizontal (T-pose)' : 'no strong T-pose detected'}`,
  ]
  const addBone = (label: string, bone?: BoneData) => {
    if (!bone) return
    entries.push(`${label}: ${bone.name}`)
  }
  addBone('pelvis', analysis.groups.pelvis)
  addBone('chest', analysis.groups.chest)
  addBone('neck', analysis.groups.neck)
  addBone('head', analysis.groups.head)
  addBone('clavicle_left', analysis.groups.clavicleLeft)
  addBone('clavicle_right', analysis.groups.clavicleRight)
  addBone('upper_arm_left', analysis.groups.upperArmLeft)
  addBone('upper_arm_right', analysis.groups.upperArmRight)
  addBone('lower_arm_left', analysis.groups.lowerArmLeft)
  addBone('lower_arm_right', analysis.groups.lowerArmRight)
  addBone('hand_left', analysis.groups.handLeft)
  addBone('hand_right', analysis.groups.handRight)
  addBone('upper_leg_left', analysis.groups.upperLegLeft)
  addBone('upper_leg_right', analysis.groups.upperLegRight)
  addBone('lower_leg_left', analysis.groups.lowerLegLeft)
  addBone('lower_leg_right', analysis.groups.lowerLegRight)
  addBone('foot_left', analysis.groups.footLeft)
  addBone('foot_right', analysis.groups.footRight)
  return entries.map((entry) => `- ${entry}`).join('\n')
}

const detectIntent = (prompt: string) => {
  const text = prompt.toLowerCase()
  if (/(walk|run|jog|sprint|stride|step|march|locomot|laufen|renn|jogg|gehen|spazier|laufzyklus|gangzyklus)/.test(text)) {
    return 'locomotion'
  }
  if (/(idle|breathe|breathing|stand|rest|stehen|ruhe|atmen|atmung)/.test(text)) return 'idle'
  return 'other'
}

const lockRootMotion = (tracks: AnimationTrack[], bones: BoneData[]) => {
  const lockedIds = new Set<string>()
  bones.forEach((bone) => {
    if (!bone.parentId) {
      lockedIds.add(bone.id)
    }
    if (isCentralPelvisName(bone.name)) {
      lockedIds.add(bone.id)
    }
  })

  if (lockedIds.size === 0) return tracks
  return tracks.filter((track) => !(track.property === 'position' && lockedIds.has(track.boneId)))
}

const buildMotionHints = (prompt: string, analysis: RigAnalysis) => {
  const intent = detectIntent(prompt)
  if (intent === 'locomotion') {
    return [
      'Locomotion: include alternating leg/arm swing with opposite phase',
      'Keep shoulders relaxed and arms slightly lowered/bent (avoid rigid T-pose)',
      'Add subtle chest/pelvis counter-rotation and vertical bobbing if needed',
    ].join('\n')
  }
  if (intent === 'idle') {
    return [
      'Idle: keep arms relaxed at the sides with slight bend',
      'Use subtle chest/breath motion, small head adjustments',
    ].join('\n')
  }
  if (analysis.tPoseLikely) {
    return [
      'Avoid leaving arms fully horizontal unless explicitly requested',
      'Introduce slight arm relaxation if the pose appears too rigid',
    ].join('\n')
  }
  return 'Focus on natural posing and avoid unnecessary stiffness.'
}

function buildSkeletonDescription(bones: BoneData[]): string {
  if (bones.length === 0) {
    return 'No bones defined yet.'
  }

  const boneList = bones.map(bone => {
    const parentName = bone.parentId
      ? bones.find(b => b.id === bone.parentId)?.name || 'unknown'
      : 'none (root)'
    return `- "${bone.name}" (parent: ${parentName}, position: [${bone.position.map(p => p.toFixed(2)).join(', ')}], rotation: [${bone.rotation.map(r => r.toFixed(3)).join(', ')}], length: ${bone.length.toFixed(2)})`
  }).join('\n')

  return `Skeleton has ${bones.length} bones:\n${boneList}`
}

export function buildAnimationPrompt(bones: BoneData[], prompt: string) {
  const skeletonDescription = buildSkeletonDescription(bones)
  const rigAnalysis = analyzeRig(bones)
  const rigHints = buildRigHints(rigAnalysis)
  const motionHints = buildMotionHints(prompt, rigAnalysis)
  const userMessage = [
    skeletonDescription,
    '',
    'Rig hints:',
    rigHints,
    '',
    'Motion hints:',
    motionHints,
    '',
    `Create an animation for: "${prompt}"`,
  ].join('\n')
  const combined = `SYSTEM:\n${SYSTEM_PROMPT}\n\nUSER:\n${userMessage}`

  return {
    system: SYSTEM_PROMPT,
    user: userMessage,
    combined,
  }
}

function parseAnimationDataFromContent(content: string) {
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('No JSON found in response')
  }
  return JSON.parse(jsonMatch[0])
}

export function parseAnimationResponse(
  responseText: string,
  bones: BoneData[],
  prompt?: string
): AIGenerationResult {
  try {
    const animationData = parseAnimationDataFromContent(responseText)
    const animation = convertToAnimationClip(animationData, bones, prompt)

    if (!animation) {
      return { success: false, error: 'Failed to create animation from AI data' }
    }

    return { success: true, animation }
  } catch (error) {
    console.error('Failed to parse AI response:', error)
    return { success: false, error: 'Failed to parse animation data from AI response' }
  }
}

export async function generateAnimation(
  bones: BoneData[],
  prompt: string,
  apiKey: string,
  onProgress?: (message: string) => void
): Promise<AIGenerationResult> {
  if (!apiKey) {
    return { success: false, error: 'No API key provided' }
  }

  if (bones.length === 0) {
    return { success: false, error: 'No bones in skeleton. Add bones first.' }
  }

  onProgress?.('Preparing skeleton data...')

  const { user: userMessage } = buildAnimationPrompt(bones, prompt)

  onProgress?.('Sending request to OpenAI GPT-5.2 (this may take up to 10 minutes)...')

  try {
    // Create AbortController for timeout (120 seconds for GPT-5.2 with reasoning)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 600000)

    let response: Response
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-5.2',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMessage },
          ],
          reasoning_effort: 'medium',
          max_completion_tokens: 16000,
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error('OpenAI API error response:', errorData)
      const errorMessage = errorData.error?.message || `HTTP ${response.status}`
      return { success: false, error: `OpenAI API error: ${errorMessage}` }
    }

    onProgress?.('Receiving response from GPT-5.2...')

    const data = await response.json()
    console.log('OpenAI API response structure:', Object.keys(data))

    // GPT-5.2 may have different response structures
    // Try multiple paths to find the content
    let content: string | undefined

    // Standard chat completion response
    if (data.choices?.[0]?.message?.content) {
      content = data.choices[0].message.content
    }
    // Alternative: direct output field
    else if (data.output) {
      content = typeof data.output === 'string' ? data.output : JSON.stringify(data.output)
    }
    // Alternative: message field directly
    else if (data.message?.content) {
      content = data.message.content
    }
    // Alternative: response field
    else if (data.response) {
      content = typeof data.response === 'string' ? data.response : JSON.stringify(data.response)
    }

    if (!content) {
      console.error('Could not find content in response. Full response:', JSON.stringify(data, null, 2))
      return { success: false, error: 'No content found in OpenAI response. Check console for details.' }
    }

    console.log('Extracted content length:', content.length)

    onProgress?.('Parsing animation data...')

    const result = parseAnimationResponse(content, bones, prompt)
    if (!result.success) {
      return result
    }

    onProgress?.('Animation generated successfully!')

    return result
  } catch (error) {
    console.error('AI animation generation error:', error)

    // Handle specific error types
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return {
          success: false,
          error: 'Request timed out after 10 minutes. The AI may be overloaded - please try again.',
        }
      }
      return {
        success: false,
        error: `Error: ${error.message}`,
      }
    }

    return {
      success: false,
      error: 'Unknown error occurred',
    }
  }
}

function convertToAnimationClip(
  data: any,
  bones: BoneData[],
  prompt?: string
): AnimationClip | null {
  try {
    const tracks: AnimationTrack[] = []
    const boneNameToId = new Map(bones.map(b => [b.name.toLowerCase(), b.id]))
    const boneById = new Map(bones.map(b => [b.id, b]))
    const rawFps = Number(data.fps)
    const fps = Number.isFinite(rawFps) ? Math.min(120, Math.max(1, rawFps)) : 30
    let frameCount = Number.isFinite(Number(data.frameCount))
      ? Math.max(2, Math.round(Number(data.frameCount)))
      : 60
    let maxFrame = 0

    const normalizeInterpolation = (value: any): Keyframe['interpolation'] => {
      return value === 'step' || value === 'bezier' || value === 'linear' ? value : 'linear'
    }

    const ensureFrameZero = (keyframes: Keyframe[], value: number[]) => {
      if (!keyframes.some((kf) => kf.frame === 0)) {
        keyframes.push({ frame: 0, value, interpolation: 'linear' })
      }
    }

    for (const boneAnim of data.bones || []) {
      const boneId = boneNameToId.get(boneAnim.boneName?.toLowerCase())
      if (!boneId) {
        console.warn(`Bone not found: ${boneAnim.boneName}`)
        continue
      }
      const restBone = boneById.get(boneId)

      // Create rotation track
      const rotationKeyframes: Keyframe[] = []

      for (const kf of boneAnim.keyframes || []) {
        if (kf.rotation && Array.isArray(kf.rotation) && kf.rotation.length === 4) {
          const frame = Math.max(0, Math.round(Number(kf.frame)))
          if (!Number.isFinite(frame)) continue
          maxFrame = Math.max(maxFrame, frame)

          const [x, y, z, w] = kf.rotation.map((v: any) => Number(v))
          if (![x, y, z, w].every(Number.isFinite)) continue
          const len = Math.sqrt(x*x + y*y + z*z + w*w)
          const normalized = len > 0 ? [x/len, y/len, z/len, w/len] : [0, 0, 0, 1]

          rotationKeyframes.push({
            frame,
            value: normalized,
            interpolation: normalizeInterpolation(kf.interpolation),
          })
        }
      }

      if (rotationKeyframes.length > 0) {
        if (restBone) {
          ensureFrameZero(rotationKeyframes, [...restBone.rotation])
        }
        tracks.push({
          boneId,
          property: 'rotation' as KeyframeProperty,
          keyframes: rotationKeyframes.sort((a, b) => a.frame - b.frame),
        })
      }

      // Handle position keyframes if present
      const positionKeyframes: Keyframe[] = []
      for (const kf of boneAnim.keyframes || []) {
        if (kf.position && Array.isArray(kf.position) && kf.position.length === 3) {
          const frame = Math.max(0, Math.round(Number(kf.frame)))
          if (!Number.isFinite(frame)) continue
          maxFrame = Math.max(maxFrame, frame)

          const [x, y, z] = kf.position.map((v: any) => Number(v))
          if (![x, y, z].every(Number.isFinite)) continue
          positionKeyframes.push({
            frame,
            value: [x, y, z],
            interpolation: normalizeInterpolation(kf.interpolation),
          })
        }
      }

      if (positionKeyframes.length > 0) {
        if (restBone) {
          ensureFrameZero(positionKeyframes, [...restBone.position])
        }
        tracks.push({
          boneId,
          property: 'position' as KeyframeProperty,
          keyframes: positionKeyframes.sort((a, b) => a.frame - b.frame),
        })
      }
    }

    if (tracks.length === 0) {
      console.warn('No valid tracks generated')
      return null
    }

    if (maxFrame + 1 > frameCount) {
      frameCount = maxFrame + 1
    }

    const animation: AnimationClip = {
      id: uuidv4(),
      name: data.animationName || 'AI Generated Animation',
      fps,
      frameCount,
      tracks: lockRootMotion(tracks, bones),
    }
    applyMotionFallback(animation, bones, prompt)
    return animation
  } catch (error) {
    console.error('Error converting animation data:', error)
    return null
  }
}

const buildChildMap = (bones: BoneData[]) => {
  const childMap = new Map<string, BoneData[]>()
  bones.forEach((bone) => {
    if (!bone.parentId) return
    const list = childMap.get(bone.parentId) || []
    list.push(bone)
    childMap.set(bone.parentId, list)
  })
  return childMap
}

const hasSignificantRotation = (track: AnimationTrack, restRotation: THREE.Quaternion) => {
  if (track.keyframes.length < 2) return false
  const threshold = THREE.MathUtils.degToRad(12)
  for (const keyframe of track.keyframes) {
    const value = keyframe.value
    if (!Array.isArray(value) || value.length !== 4) continue
    const q = new THREE.Quaternion(value[0], value[1], value[2], value[3])
    const dot = Math.min(1, Math.max(-1, Math.abs(q.dot(restRotation))))
    const angle = 2 * Math.acos(dot)
    if (angle > threshold) return true
  }
  return false
}

const buildArmDownRotation = (bone: BoneData, child: BoneData, downAngle: number) => {
  const dir = new THREE.Vector3(
    child.position[0] - bone.position[0],
    child.position[1] - bone.position[1],
    child.position[2] - bone.position[2]
  )
  if (dir.lengthSq() < 1e-6) return new THREE.Quaternion()
  dir.normalize()

  const horizontal = new THREE.Vector3(dir.x, 0, dir.z)
  if (horizontal.lengthSq() < 1e-6) return new THREE.Quaternion()
  horizontal.normalize()

  const target = new THREE.Vector3()
    .copy(horizontal)
    .multiplyScalar(Math.cos(downAngle))
    .add(new THREE.Vector3(0, -1, 0).multiplyScalar(Math.sin(downAngle)))
    .normalize()

  return new THREE.Quaternion().setFromUnitVectors(dir, target)
}

function applyMotionFallback(animation: AnimationClip, bones: BoneData[], prompt?: string) {
  if (!prompt) return
  if (detectIntent(prompt) !== 'locomotion') return

  const rig = analyzeRig(bones)
  if (!rig.isHumanoid) return

  const childMap = buildChildMap(bones)
  const rotationTracks = new Map<string, AnimationTrack>()
  animation.tracks.forEach((track) => {
    if (track.property === 'rotation') {
      rotationTracks.set(track.boneId, track)
    }
  })

  const frameCount = Math.max(2, animation.frameCount)
  const baseFrames = [
    0,
    Math.round(frameCount * 0.25),
    Math.round(frameCount * 0.5),
    Math.round(frameCount * 0.75),
    frameCount - 1,
  ]
  const frames = Array.from(new Set(baseFrames)).sort((a, b) => a - b)

  const swingAmplitude = THREE.MathUtils.degToRad(25)
  const downAngle = THREE.MathUtils.degToRad(rig.tPoseLikely ? 28 : 20)
  const upAxis = new THREE.Vector3(0, 1, 0)

  const applyArmSwing = (bone: BoneData | undefined, side: Side) => {
    if (!bone) return
    const track = rotationTracks.get(bone.id)
    const restQuat = new THREE.Quaternion(
      bone.rotation[0],
      bone.rotation[1],
      bone.rotation[2],
      bone.rotation[3]
    )
    if (track && hasSignificantRotation(track, restQuat)) return

    const preferredChild = side === 'left' ? rig.groups.lowerArmLeft || rig.groups.handLeft : rig.groups.lowerArmRight || rig.groups.handRight
    const child = preferredChild || (childMap.get(bone.id) || [])[0]
    if (!child) return

    const qDown = buildArmDownRotation(bone, child, downAngle)
    const phaseOffset = side === 'left' ? 0 : Math.PI
    const keyframes: Keyframe[] = frames.map((frame) => {
      const phase = frameCount <= 1 ? 0 : (frame / (frameCount - 1)) * Math.PI * 2
      const swing = Math.sin(phase + phaseOffset) * swingAmplitude
      const qSwing = new THREE.Quaternion().setFromAxisAngle(upAxis, swing)
      const qFinal = qSwing.clone().multiply(qDown).multiply(restQuat).normalize()
      return {
        frame,
        value: [qFinal.x, qFinal.y, qFinal.z, qFinal.w],
        interpolation: 'linear',
      }
    })

    if (track) {
      track.keyframes = keyframes
    } else {
      animation.tracks.push({
        boneId: bone.id,
        property: 'rotation',
        keyframes,
      })
    }
  }

  applyArmSwing(rig.groups.upperArmLeft, 'left')
  applyArmSwing(rig.groups.upperArmRight, 'right')
}

// Check if OpenAI API key is valid by making a minimal request
export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    })
    return response.ok
  } catch {
    return false
  }
}
