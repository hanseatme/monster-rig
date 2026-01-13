import { useEditorStore } from '../store'

interface StatusBarProps {
  onOpenSettings?: () => void
  onOpenAIAnimation?: () => void
}

export default function StatusBar({ onOpenSettings, onOpenAIAnimation }: StatusBarProps) {
  const {
    mode,
    selection,
    skeleton,
    animations,
    currentAnimationId,
    timeline,
    modelPath,
    isDirty,
  } = useEditorStore()

  const currentAnimation = animations.find((a) => a.id === currentAnimationId)

  return (
    <div className="flex items-center justify-between px-4 py-1 bg-panel border-t border-panel-border text-xs text-gray-400">
      {/* Left side - Status info */}
      <div className="flex items-center gap-4">
        {/* Mode */}
        <span className="flex items-center gap-1">
          <span className="text-gray-500">Mode:</span>
          <span className="text-white capitalize">{mode.replace('-', ' ')}</span>
        </span>

        {/* Selection */}
        <span className="flex items-center gap-1">
          <span className="text-gray-500">Selected:</span>
          <span className="text-white">
            {selection.ids.length > 0
              ? `${selection.ids.length} ${selection.type}${selection.ids.length > 1 ? 's' : ''}`
              : 'None'}
          </span>
        </span>

        {/* Bone count */}
        <span className="flex items-center gap-1">
          <span className="text-gray-500">Bones:</span>
          <span className="text-white">{skeleton.bones.length}</span>
        </span>
      </div>

      {/* Center - Animation info */}
      <div className="flex items-center gap-4">
        {currentAnimation && (
          <>
            <span className="flex items-center gap-1">
              <span className="text-gray-500">Animation:</span>
              <span className="text-white">{currentAnimation.name}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-gray-500">Frame:</span>
              <span className="text-white">
                {timeline.currentFrame} / {currentAnimation.frameCount}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-gray-500">FPS:</span>
              <span className="text-white">{currentAnimation.fps}</span>
            </span>
          </>
        )}
      </div>

      {/* Right side - File info and actions */}
      <div className="flex items-center gap-4">
        {/* AI Animation Button */}
        {modelPath && skeleton.bones.length > 0 && onOpenAIAnimation && (
          <button
            onClick={onOpenAIAnimation}
            className="px-2 py-0.5 rounded text-xs bg-purple-600 hover:bg-purple-500 text-white transition-colors flex items-center gap-1"
            title="Generate animation with AI"
          >
            🤖 AI Animate
          </button>
        )}

        {modelPath && (
          <span className="flex items-center gap-1 max-w-xs truncate">
            <span className="text-gray-500">Model:</span>
            <span className="text-white truncate">{modelPath.split(/[/\\]/).pop()}</span>
          </span>
        )}
        {isDirty && (
          <span className="text-yellow-500">Unsaved changes</span>
        )}

        {/* Settings Button */}
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="px-2 py-0.5 rounded text-xs bg-panel-border hover:bg-gray-600 transition-colors"
            title="Settings"
          >
            ⚙️
          </button>
        )}
      </div>
    </div>
  )
}
