import type { BoneSuggestion, MeshAnalysisSummary } from '../utils/boneAutoSuggest'
import type { AutoBoneSettings } from '../types'

interface AIBoneGenerationResult {
  success: boolean
  suggestions?: BoneSuggestion[]
  error?: string
}

const SYSTEM_PROMPT = `You are an expert rigger. Your task is to propose a clean, well-named bone layout for a 3D creature model.

You will receive a model summary, rig settings, and a baseline auto-suggest list. Improve naming and placement if needed, but keep the bone count reasonable.

Return ONLY a JSON object with this exact structure:
{
  "bones": [
    {
      "name": "string",
      "position": [x, y, z],
      "parentIndex": number | null
    }
  ]
}

Rules:
1. Use unique, ASCII-friendly names (letters, numbers, underscores).
2. Parent indices refer to the index in the returned array.
3. Keep positions within the model bounding box, unless a slight extension is required.
4. Preserve a sensible hierarchy: root first, then pelvis/spine, then neck/head, then limbs.
5. If rigType is "humanoid", use classic humanoid naming (root, pelvis, spine_01.., chest, neck, head, clavicle_left/right, upper_arm_left/right, lower_arm_left/right, hand_left/right, upper_leg_left/right, lower_leg_left/right, foot_left/right).
6. If humanoidLandmarks are provided, align bones to those heights/widths and keep symmetry.
7. If unsure, stay close to the baseline suggestions.
8. Output JSON only.`

function sanitizeName(name: string, index: number, used: Map<string, number>): string {
  const base = name.trim().replace(/\s+/g, '_') || `bone_${String(index + 1).padStart(2, '0')}`
  const count = used.get(base) || 0
  used.set(base, count + 1)
  if (count === 0) return base
  return `${base}_${String(count + 1).padStart(2, '0')}`
}

function parseSuggestions(raw: any): BoneSuggestion[] | null {
  if (!Array.isArray(raw)) return null
  if (raw.length === 0 || raw.length > 128) return null

  const usedNames = new Map<string, number>()
  const parsed: BoneSuggestion[] = []

  raw.forEach((bone, index) => {
    const position = Array.isArray(bone?.position) ? bone.position : null
    if (!position || position.length !== 3) return
    const [x, y, z] = position.map((v: any) => Number(v))
    if (![x, y, z].every(Number.isFinite)) return

    const rawName = typeof bone?.name === 'string' ? bone.name : ''
    const name = sanitizeName(rawName, index, usedNames)

    const parentIndex = Number.isFinite(bone?.parentIndex)
      ? Math.trunc(Number(bone.parentIndex))
      : null

    parsed.push({
      name,
      position: [x, y, z],
      parentIndex: parentIndex !== null && parentIndex >= 0 ? parentIndex : null,
      confidence: 0.85,
    })
  })

  if (parsed.length === 0) return null

  // Fix invalid parent indices after parse
  parsed.forEach((bone, index) => {
    if (bone.parentIndex === null) return
    if (bone.parentIndex >= parsed.length || bone.parentIndex === index) {
      bone.parentIndex = null
    }
  })

  return parsed
}

export async function generateAIBoneSuggestions(
  analysis: MeshAnalysisSummary,
  baseSuggestions: BoneSuggestion[],
  apiKey: string,
  settings: AutoBoneSettings,
  hint?: string,
  onProgress?: (message: string) => void
): Promise<AIBoneGenerationResult> {
  if (!apiKey) {
    return { success: false, error: 'No API key provided' }
  }

  onProgress?.('Preparing model summary...')

  const payload = {
    modelSummary: analysis,
    rigSettings: settings,
    baselineSuggestions: baseSuggestions.map((s, index) => ({
      index,
      name: s.name,
      position: s.position,
      parentIndex: s.parentIndex,
    })),
    hint: hint?.trim() || 'none',
  }

  const userMessage = JSON.stringify(payload, null, 2)

  onProgress?.('Requesting GPT-5.2 bone refinement...')

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 120000)

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
          reasoning_effort: 'low',
          max_completion_tokens: 4000,
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage = errorData.error?.message || `HTTP ${response.status}`
      return { success: false, error: `OpenAI API error: ${errorMessage}` }
    }

    const data = await response.json()
    let content: string | undefined

    if (data.choices?.[0]?.message?.content) {
      content = data.choices[0].message.content
    } else if (data.output) {
      content = typeof data.output === 'string' ? data.output : JSON.stringify(data.output)
    } else if (data.message?.content) {
      content = data.message.content
    } else if (data.response) {
      content = typeof data.response === 'string' ? data.response : JSON.stringify(data.response)
    }

    if (!content) {
      return { success: false, error: 'No content found in OpenAI response' }
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { success: false, error: 'No JSON found in AI response' }
    }

    const parsed = JSON.parse(jsonMatch[0])
    const suggestions = parseSuggestions(parsed.bones || parsed.suggestions || parsed.boneSuggestions)

    if (!suggestions) {
      return { success: false, error: 'Invalid bone suggestions from AI' }
    }

    return { success: true, suggestions }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { success: false, error: 'AI request timed out. Please try again.' }
    }
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}
