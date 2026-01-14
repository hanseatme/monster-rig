import { useState, useEffect, useMemo } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useEditorStore } from '../../store'
import { analyzeModel, suggestBones, summarizeAnalysis, type BoneSuggestion } from '../../utils/boneAutoSuggest'
import { getLoadedModel } from '../Toolbar'
import { generateAIBoneSuggestions } from '../../services/aiBoneService'

interface AutoBonesDialogProps {
  isOpen: boolean
  onClose: () => void
}

interface EditableSuggestion extends BoneSuggestion {
  id: string
  enabled: boolean
}

const formatVec = (value: [number, number, number]) =>
  value.map((v) => v.toFixed(2)).join(', ')

export default function AutoBonesDialog({ isOpen, onClose }: AutoBonesDialogProps) {
  const {
    skeleton,
    autoBoneSettings,
    updateAutoBoneSettings,
  } = useEditorStore()

  const [suggestions, setSuggestions] = useState<EditableSuggestion[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [useAI, setUseAI] = useState(false)
  const [aiHint, setAiHint] = useState('')
  const [hasApiKey, setHasApiKey] = useState(false)
  const [defaultBoneLength, setDefaultBoneLength] = useState(1)

  useEffect(() => {
    if (isOpen) {
      setError('')
      setProgress('')
      checkApiKey()
    }
  }, [isOpen])

  useEffect(() => {
    if (!hasApiKey && useAI) {
      setUseAI(false)
    }
  }, [hasApiKey, useAI])

  const checkApiKey = async () => {
    if (!window.electronAPI) {
      setHasApiKey(false)
      return
    }
    const has = await window.electronAPI.hasApiKey('openai')
    setHasApiKey(has)
  }

  const handleGenerate = async () => {
    const loadedModel = getLoadedModel()
    if (!loadedModel) {
      setError('Please load a model first.')
      setProgress('')
      return
    }

    setIsGenerating(true)
    setError('')
    setProgress('Analyzing model...')

    const analysis = analyzeModel(loadedModel, autoBoneSettings)
    const summary = summarizeAnalysis(analysis)
    const avgSize = (analysis.size.x + analysis.size.y + analysis.size.z) / 3
    setDefaultBoneLength(Math.max(avgSize * autoBoneSettings.boneSpacingFactor, 0.1))

    const baseSuggestions = suggestBones(analysis, autoBoneSettings)
    if (baseSuggestions.length === 0) {
      setError('Could not generate bone suggestions for this model.')
      setProgress('')
      setIsGenerating(false)
      return
    }
    let finalSuggestions = baseSuggestions

    if (useAI) {
      if (!window.electronAPI) {
        setError('AI bone generation requires the desktop app.')
        setProgress('')
        setIsGenerating(false)
        return
      }
      const apiKey = await window.electronAPI.getApiKey('openai')
      if (!apiKey) {
        setError('No API key configured. Open Settings to add one.')
        setProgress('')
        setIsGenerating(false)
        return
      }

      setProgress('Requesting AI refinement...')
      const result = await generateAIBoneSuggestions(
        summary,
        baseSuggestions,
        apiKey,
        aiHint,
        (msg) => setProgress(msg)
      )
      if (result.success && result.suggestions) {
        finalSuggestions = result.suggestions
      } else {
        setError(result.error || 'AI refinement failed. Using baseline suggestions.')
      }
    }

    const editable = finalSuggestions.map((suggestion) => ({
      ...suggestion,
      id: uuidv4(),
      enabled: true,
    }))

    setSuggestions(editable)
    setProgress(`Generated ${editable.length} suggestions.`)
    setIsGenerating(false)
  }

  const handleApply = () => {
    if (suggestions.length === 0) {
      setError('Generate suggestions first.')
      return
    }

    if (skeleton.bones.length > 0) {
      if (!confirm('This will add bones to the existing skeleton. Continue?')) {
        return
      }
    }

    const enabledCount = suggestions.filter((s) => s.enabled).length
    if (enabledCount === 0) {
      setError('No bones selected.')
      return
    }

    const { addBone, updateBone } = useEditorStore.getState()
    const indexMap = new Map<number, number>()
    const boneIdMap = new Map<number, string>()

    let nextIndex = 0
    suggestions.forEach((s, index) => {
      if (s.enabled) {
        indexMap.set(index, nextIndex)
        nextIndex += 1
      }
    })

    const childrenMap = new Map<number, number[]>()
    suggestions.forEach((s, index) => {
      if (s.parentIndex !== null) {
        const children = childrenMap.get(s.parentIndex) || []
        children.push(index)
        childrenMap.set(s.parentIndex, children)
      }
    })

    const getEnabledParentIndex = (parentIndex: number | null): number | null => {
      let current = parentIndex
      while (current !== null) {
        const mapped = indexMap.get(current)
        if (mapped !== undefined) return mapped
        current = suggestions[current]?.parentIndex ?? null
      }
      return null
    }

    const distance = (a: [number, number, number], b: [number, number, number]) => {
      const dx = a[0] - b[0]
      const dy = a[1] - b[1]
      const dz = a[2] - b[2]
      return Math.sqrt(dx * dx + dy * dy + dz * dz)
    }

    suggestions.forEach((suggestion, index) => {
      if (!suggestion.enabled) return

      const mappedParent = getEnabledParentIndex(suggestion.parentIndex)
      const parentId = mappedParent !== null ? boneIdMap.get(mappedParent) || null : null

      const boneId = addBone(suggestion.position, parentId)
      const newIndex = indexMap.get(index) ?? 0
      boneIdMap.set(newIndex, boneId)

      let length = defaultBoneLength
      const children = (childrenMap.get(index) || []).filter((childIdx) => suggestions[childIdx].enabled)
      if (children.length > 0) {
        length = distance(suggestion.position, suggestions[children[0]].position)
      } else if (suggestion.parentIndex !== null) {
        length = distance(suggestion.position, suggestions[suggestion.parentIndex].position)
      }

      updateBone(boneId, { name: suggestion.name, length: Math.max(0.05, length) })
    })

    setProgress(`Created ${enabledCount} bones.`)
    setTimeout(() => {
      setSuggestions([])
      onClose()
      setProgress('')
    }, 600)
  }

  const summary = useMemo(() => {
    const enabled = suggestions.filter((s) => s.enabled).length
    return { total: suggestions.length, enabled }
  }, [suggestions])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
      <div className="bg-panel border border-panel-border rounded-lg shadow-xl w-[720px] max-h-[85vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-panel-border">
          <h2 className="text-lg font-semibold">Auto Bones</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors text-xl leading-none"
            disabled={isGenerating}
          >
            x
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto max-h-[70vh]">
          <div className="text-sm text-gray-400">
            Skeleton: {skeleton.bones.length} bones
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <label className="text-xs text-gray-500">Bone spacing factor</label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0.05"
                  max="0.6"
                  step="0.01"
                  value={autoBoneSettings.boneSpacingFactor}
                  onChange={(e) => updateAutoBoneSettings({ boneSpacingFactor: parseFloat(e.target.value) })}
                  className="flex-1"
                />
                <span className="text-xs text-gray-400 w-10 text-right">
                  {autoBoneSettings.boneSpacingFactor.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-xs text-gray-500">Root Y offset factor</label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="-0.3"
                  max="0.3"
                  step="0.01"
                  value={autoBoneSettings.rootYOffsetFactor}
                  onChange={(e) => updateAutoBoneSettings({ rootYOffsetFactor: parseFloat(e.target.value) })}
                  className="flex-1"
                />
                <span className="text-xs text-gray-400 w-10 text-right">
                  {autoBoneSettings.rootYOffsetFactor.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-gray-500">Spine segments (min / max)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="12"
                  value={autoBoneSettings.spineMinSegments}
                  onChange={(e) => {
                    const value = parseInt(e.target.value, 10)
                    if (Number.isFinite(value)) {
                      updateAutoBoneSettings({ spineMinSegments: value })
                    }
                  }}
                  className="input w-16 text-xs"
                />
                <input
                  type="number"
                  min="1"
                  max="16"
                  value={autoBoneSettings.spineMaxSegments}
                  onChange={(e) => {
                    const value = parseInt(e.target.value, 10)
                    if (Number.isFinite(value)) {
                      updateAutoBoneSettings({ spineMaxSegments: value })
                    }
                  }}
                  className="input w-16 text-xs"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-gray-500">Limb segments (min / max)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="8"
                  value={autoBoneSettings.limbMinSegments}
                  onChange={(e) => {
                    const value = parseInt(e.target.value, 10)
                    if (Number.isFinite(value)) {
                      updateAutoBoneSettings({ limbMinSegments: value })
                    }
                  }}
                  className="input w-16 text-xs"
                />
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={autoBoneSettings.limbMaxSegments}
                  onChange={(e) => {
                    const value = parseInt(e.target.value, 10)
                    if (Number.isFinite(value)) {
                      updateAutoBoneSettings({ limbMaxSegments: value })
                    }
                  }}
                  className="input w-16 text-xs"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-gray-500">Extremity clustering</label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0.05"
                  max="0.4"
                  step="0.01"
                  value={autoBoneSettings.extremityClusterFactor}
                  onChange={(e) => updateAutoBoneSettings({ extremityClusterFactor: parseFloat(e.target.value) })}
                  className="flex-1"
                />
                <span className="text-xs text-gray-400 w-10 text-right">
                  {autoBoneSettings.extremityClusterFactor.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-gray-500">Extremity top percent</label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0.01"
                  max="0.2"
                  step="0.01"
                  value={autoBoneSettings.extremityTopPercent}
                  onChange={(e) => updateAutoBoneSettings({ extremityTopPercent: parseFloat(e.target.value) })}
                  className="flex-1"
                />
                <span className="text-xs text-gray-400 w-10 text-right">
                  {autoBoneSettings.extremityTopPercent.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-gray-500">Max extremities</label>
              <input
                type="number"
                min="2"
                max="16"
                value={autoBoneSettings.maxExtremities}
                onChange={(e) => {
                  const value = parseInt(e.target.value, 10)
                  if (Number.isFinite(value)) {
                    updateAutoBoneSettings({ maxExtremities: value })
                  }
                }}
                className="input w-20 text-xs"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-gray-500">Min extremity distance</label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0.05"
                  max="0.5"
                  step="0.01"
                  value={autoBoneSettings.extremityMinDistanceFactor}
                  onChange={(e) => updateAutoBoneSettings({ extremityMinDistanceFactor: parseFloat(e.target.value) })}
                  className="flex-1"
                />
                <span className="text-xs text-gray-400 w-10 text-right">
                  {autoBoneSettings.extremityMinDistanceFactor.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-gray-500">Symmetry axis</label>
              <select
                className="input text-xs w-full"
                value={autoBoneSettings.symmetryAxis}
                onChange={(e) => updateAutoBoneSettings({ symmetryAxis: e.target.value as 'auto' | 'x' | 'y' | 'z' })}
              >
                <option value="auto">Auto</option>
                <option value="x">X</option>
                <option value="y">Y</option>
                <option value="z">Z</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-gray-500">AI refinement (optional)</label>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={useAI}
                onChange={(e) => setUseAI(e.target.checked)}
                disabled={!hasApiKey}
              />
              <span className="text-xs text-gray-400">
                Use GPT-5.2 to improve bone placement and naming
              </span>
            </div>
            {!hasApiKey && (
              <div className="text-xs text-yellow-500">
                OpenAI API key is not configured. AI refinement is disabled.
              </div>
            )}
            {useAI && (
              <textarea
                value={aiHint}
                onChange={(e) => setAiHint(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                className="input text-xs w-full h-20 resize-none"
                placeholder="Optional hint: creature type, limb count, naming preferences..."
              />
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="px-3 py-2 rounded text-xs bg-green-600 hover:bg-green-500 transition-colors disabled:opacity-50"
            >
              {isGenerating ? 'Generating...' : 'Generate Suggestions'}
            </button>
            {suggestions.length > 0 && (
              <span className="text-xs text-gray-400">
                {summary.enabled} enabled of {summary.total}
              </span>
            )}
          </div>

          {suggestions.length > 0 && (
            <div className="border border-panel-border rounded p-2 max-h-56 overflow-y-auto space-y-2">
              {suggestions.map((suggestion, index) => (
                <div key={suggestion.id} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={suggestion.enabled}
                    onChange={(e) => {
                      setSuggestions((prev) =>
                        prev.map((s, i) => (i === index ? { ...s, enabled: e.target.checked } : s))
                      )
                    }}
                  />
                  <input
                    type="text"
                    value={suggestion.name}
                    onChange={(e) => {
                      const name = e.target.value
                      setSuggestions((prev) =>
                        prev.map((s, i) => (i === index ? { ...s, name } : s))
                      )
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="input text-xs w-40"
                  />
                  <span className="text-gray-500">
                    parent: {suggestion.parentIndex !== null ? suggestions[suggestion.parentIndex]?.name || 'none' : 'none'}
                  </span>
                  <span className="text-gray-500">
                    pos: {formatVec(suggestion.position)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {progress && (
            <div className="text-xs text-blue-400">{progress}</div>
          )}

          {error && (
            <div className="text-xs text-red-400">{error}</div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-panel-border">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-sm bg-panel-border hover:bg-gray-600 transition-colors"
            disabled={isGenerating}
          >
            Close
          </button>
          <button
            onClick={handleApply}
            className="px-4 py-2 rounded text-sm bg-accent hover:bg-accent/80 transition-colors"
            disabled={isGenerating || suggestions.length === 0}
          >
            Apply Bones
          </button>
        </div>
      </div>
    </div>
  )
}
