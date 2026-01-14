import type { BoneData, AnimationClip, AnimationTrack, Keyframe, KeyframeProperty } from '../types'
import { v4 as uuidv4 } from 'uuid'

interface AIGenerationResult {
  success: boolean
  animation?: AnimationClip
  error?: string
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

Output ONLY the JSON object, no explanation or markdown.`

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

  const skeletonDescription = buildSkeletonDescription(bones)
  const userMessage = `${skeletonDescription}\n\nCreate an animation for: "${prompt}"`

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

    // Parse the JSON response
    let animationData: any
    try {
      // Try to extract JSON from the response (in case there's extra text)
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('No JSON found in response')
      }
      animationData = JSON.parse(jsonMatch[0])
    } catch (parseError) {
      console.error('Failed to parse AI response:', content)
      return { success: false, error: 'Failed to parse animation data from AI response' }
    }

    onProgress?.('Creating animation clip...')

    // Convert to our animation format
    const animation = convertToAnimationClip(animationData, bones)

    if (!animation) {
      return { success: false, error: 'Failed to create animation from AI data' }
    }

    onProgress?.('Animation generated successfully!')

    return { success: true, animation }
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
  bones: BoneData[]
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

    return {
      id: uuidv4(),
      name: data.animationName || 'AI Generated Animation',
      fps,
      frameCount,
      tracks,
    }
  } catch (error) {
    console.error('Error converting animation data:', error)
    return null
  }
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
