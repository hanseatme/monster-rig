import { useState, useEffect, useMemo } from 'react'
import { useEditorStore } from '../../store'
import { generateAnimation, buildAnimationPrompt, parseAnimationResponse } from '../../services/aiAnimationService'

interface AIAnimationDialogProps {
  isOpen: boolean
  onClose: () => void
  onOpenSettings: () => void
}

const EXAMPLE_PROMPTS = [
  'Idle breathing animation - subtle chest movement',
  'Walk cycle - 4 steps with arm swing',
  'Look around - head turns left, center, right',
  'Attack stance - prepare to strike',
  'Wave hello - raise and wave right arm',
  'Jump - crouch, leap, land',
  'Shake/shiver - quick trembling motion',
  'Nod yes - head moves up and down',
]

export default function AIAnimationDialog({ isOpen, onClose, onOpenSettings }: AIAnimationDialogProps) {
  const [prompt, setPrompt] = useState('')
  const [generationMode, setGenerationMode] = useState<'api' | 'manual'>('api')
  const [manualResponse, setManualResponse] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [hasApiKey, setHasApiKey] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')

  const { skeleton } = useEditorStore()

  const promptPayload = useMemo(() => {
    const trimmed = prompt.trim()
    if (!trimmed) return null
    return buildAnimationPrompt(skeleton.bones, trimmed)
  }, [prompt, skeleton.bones])

  useEffect(() => {
    if (isOpen) {
      checkApiKey()
      setError('')
      setProgress('')
      setCopyStatus('')
    }
  }, [isOpen])

  const checkApiKey = async () => {
    if (!window.electronAPI) {
      setHasApiKey(false)
      return
    }
    const has = await window.electronAPI.hasApiKey('openai')
    setHasApiKey(has)
  }

  const applyAnimationResult = (result: { success: boolean; animation?: any; error?: string }) => {
    if (result.success && result.animation) {
      useEditorStore.setState((state: any) => ({
        ...state,
        animations: [...state.animations, result.animation!],
        currentAnimationId: result.animation!.id,
        timeline: { ...state.timeline, frameEnd: result.animation!.frameCount },
        isDirty: true,
      }))

      setProgress(`Created: ${result.animation.name}`)

      setTimeout(() => {
        onClose()
        setPrompt('')
        setManualResponse('')
        setProgress('')
      }, 1000)
      return
    }

    setError(result.error || 'Failed to generate animation')
    setProgress('')
  }

  const handleGenerateApi = async () => {
    if (!prompt.trim()) {
      setError('Please enter an animation description')
      return
    }

    if (skeleton.bones.length === 0) {
      setError('No bones in skeleton. Add bones first.')
      return
    }

    if (!window.electronAPI) {
      setError('Electron API not available')
      return
    }

    const apiKey = await window.electronAPI.getApiKey('openai')
    if (!apiKey) {
      setError('No API key configured. Please add your OpenAI API key in Settings.')
      return
    }

    setIsGenerating(true)
    setError('')
    setProgress('Starting...')

    const result = await generateAnimation(
      skeleton.bones,
      prompt.trim(),
      apiKey,
      (msg) => setProgress(msg)
    )

    setIsGenerating(false)
    applyAnimationResult(result)
  }

  const handleProcessManual = () => {
    if (!prompt.trim()) {
      setError('Please enter an animation description')
      return
    }

    if (skeleton.bones.length === 0) {
      setError('No bones in skeleton. Add bones first.')
      return
    }

    if (!manualResponse.trim()) {
      setError('Please paste the AI response to continue')
      return
    }

    setIsGenerating(true)
    setError('')
    setProgress('Parsing response...')

    const result = parseAnimationResponse(manualResponse.trim(), skeleton.bones)

    setIsGenerating(false)
    applyAnimationResult(result)
  }

  const handleCopyPrompt = async () => {
    if (!promptPayload?.combined) {
      setError('Please enter a prompt to build the external AI prompt')
      return
    }

    try {
      await navigator.clipboard.writeText(promptPayload.combined)
      setCopyStatus('Prompt copied')
      setTimeout(() => setCopyStatus(''), 1200)
    } catch (copyError) {
      console.error('Failed to copy prompt:', copyError)
      setError('Failed to copy prompt to clipboard')
    }
  }

  const handleExampleClick = (example: string) => {
    setPrompt(example)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
      <div className="bg-panel border border-panel-border rounded-lg shadow-xl w-[600px] max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-panel-border">
          <div className="flex items-center gap-2">
            <span className="text-lg">🤖</span>
            <div>
              <h2 className="text-lg font-semibold">AI Animation Generator</h2>
              <span className="text-xs text-gray-500">Powered by GPT-5.2</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors text-xl leading-none"
            disabled={isGenerating}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0">
          {/* Mode Selection */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-400">Mode:</span>
            <button
              onClick={() => setGenerationMode('api')}
              className={`px-2 py-1 rounded transition-colors ${generationMode === 'api' ? 'bg-accent text-white' : 'bg-panel-border text-gray-300 hover:text-white'}`}
              disabled={isGenerating}
            >
              API
            </button>
            <button
              onClick={() => setGenerationMode('manual')}
              className={`px-2 py-1 rounded transition-colors ${generationMode === 'manual' ? 'bg-accent text-white' : 'bg-panel-border text-gray-300 hover:text-white'}`}
              disabled={isGenerating}
            >
              Manual
            </button>
          </div>

          {/* API Key Warning */}
          {!hasApiKey && generationMode === 'api' && (
            <div className="p-3 bg-yellow-900/30 border border-yellow-700/50 rounded text-sm">
              <div className="flex items-center gap-2">
                <span>⚠️</span>
                <span>OpenAI API key not configured.</span>
                <button
                  onClick={onOpenSettings}
                  className="text-accent hover:underline"
                >
                  Open Settings
                </button>
              </div>
            </div>
          )}

          {/* Skeleton Info */}
          <div className="text-sm text-gray-400">
            Skeleton: {skeleton.bones.length} bones
            {skeleton.bones.length === 0 && (
              <span className="text-yellow-500 ml-2">
                (Add bones first using Auto Bones or manual placement)
              </span>
            )}
          </div>

          {/* Prompt Input */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Animation Description</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Describe the animation you want to create..."
              className="w-full h-32 input text-sm resize-none"
              disabled={isGenerating}
              autoFocus
            />
          </div>

          {generationMode === 'manual' && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Prompt for External AI</label>
                <textarea
                  value={promptPayload?.combined || ''}
                  readOnly
                  placeholder="Enter a description above to generate the prompt."
                  className="w-full h-32 input text-xs resize-none bg-panel-border/50"
                />
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <button
                    onClick={handleCopyPrompt}
                    className="px-2 py-1 rounded bg-panel-border hover:bg-gray-600 transition-colors"
                    disabled={isGenerating || !promptPayload}
                  >
                    Copy Prompt
                  </button>
                  {copyStatus && <span>{copyStatus}</span>}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Paste AI Response</label>
                <textarea
                  value={manualResponse}
                  onChange={(e) => setManualResponse(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder="Paste the JSON response from the AI here."
                  className="w-full h-32 input text-sm resize-none"
                  disabled={isGenerating}
                />
              </div>
            </>
          )}

          {/* Example Prompts */}
          <div className="space-y-2">
            <label className="text-xs text-gray-500">Examples (click to use):</label>
            <div className="flex flex-wrap gap-1">
              {EXAMPLE_PROMPTS.map((example, i) => (
                <button
                  key={i}
                  onClick={() => handleExampleClick(example)}
                  className="px-2 py-1 text-xs bg-panel-border hover:bg-gray-600 rounded transition-colors"
                  disabled={isGenerating}
                >
                  {example.split(' - ')[0]}
                </button>
              ))}
            </div>
          </div>

          {/* Progress */}
          {progress && (
            <div className="p-3 bg-blue-900/20 border border-blue-800/30 rounded text-sm flex items-center gap-2">
              {isGenerating && (
                <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              )}
              <span>{progress}</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-900/20 border border-red-800/30 rounded text-sm text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center px-4 py-3 border-t border-panel-border">
          <button
            onClick={onOpenSettings}
            className="px-3 py-1.5 rounded text-xs text-gray-400 hover:text-white transition-colors"
          >
            ⚙️ Settings
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={isGenerating}
              className="px-4 py-2 rounded text-sm bg-panel-border hover:bg-gray-600 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={generationMode === 'api' ? handleGenerateApi : handleProcessManual}
              disabled={
                isGenerating ||
                skeleton.bones.length === 0 ||
                !prompt.trim() ||
                (generationMode === 'api' && !hasApiKey) ||
                (generationMode === 'manual' && !manualResponse.trim())
              }
              className="px-4 py-2 rounded text-sm bg-accent hover:bg-accent/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isGenerating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {generationMode === 'api' ? 'Generating...' : 'Processing...'}
                </>
              ) : (
                <>
                  {generationMode === 'api' ? 'Generate Animation' : 'Process Response'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
