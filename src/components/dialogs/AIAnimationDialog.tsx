import { useState, useEffect } from 'react'
import { useEditorStore } from '../../store'
import { generateAnimation } from '../../services/aiAnimationService'

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
  const [isGenerating, setIsGenerating] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [hasApiKey, setHasApiKey] = useState(false)

  const { skeleton } = useEditorStore()

  useEffect(() => {
    if (isOpen) {
      checkApiKey()
      setError('')
      setProgress('')
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

  const handleGenerate = async () => {
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

    if (result.success && result.animation) {
      // Add the animation to the store
      useEditorStore.setState((state: any) => ({
        ...state,
        animations: [...state.animations, result.animation!],
        currentAnimationId: result.animation!.id,
        timeline: { ...state.timeline, frameEnd: result.animation!.frameCount },
        isDirty: true,
      }))

      setProgress(`Created: ${result.animation.name}`)

      // Close after a short delay to show success
      setTimeout(() => {
        onClose()
        setPrompt('')
        setProgress('')
      }, 1000)
    } else {
      setError(result.error || 'Failed to generate animation')
      setProgress('')
    }
  }

  const handleExampleClick = (example: string) => {
    setPrompt(example)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
      <div className="bg-panel border border-panel-border rounded-lg shadow-xl w-[600px] max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
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
        <div className="p-4 space-y-4">
          {/* API Key Warning */}
          {!hasApiKey && (
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
              onClick={handleGenerate}
              disabled={isGenerating || !hasApiKey || skeleton.bones.length === 0 || !prompt.trim()}
              className="px-4 py-2 rounded text-sm bg-accent hover:bg-accent/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isGenerating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  ✨ Generate Animation
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
