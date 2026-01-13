import { useState, useEffect } from 'react'
import { validateApiKey } from '../../services/aiAnimationService'

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
}

export default function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const [openaiKey, setOpenaiKey] = useState('')
  const [hasStoredKey, setHasStoredKey] = useState(false)
  const [isValidating, setIsValidating] = useState(false)
  const [validationStatus, setValidationStatus] = useState<'none' | 'valid' | 'invalid'>('none')
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (isOpen) {
      loadStoredKey()
    }
  }, [isOpen])

  const loadStoredKey = async () => {
    if (!window.electronAPI) return

    const hasKey = await window.electronAPI.hasApiKey('openai')
    setHasStoredKey(hasKey)
    if (hasKey) {
      // Show masked key indicator
      setOpenaiKey('••••••••••••••••••••••••••••••••')
    } else {
      setOpenaiKey('')
    }
    setValidationStatus('none')
    setMessage('')
  }

  const handleValidate = async () => {
    if (!openaiKey || openaiKey.startsWith('•')) {
      // If using stored key, get the actual key
      if (!window.electronAPI) return
      const actualKey = await window.electronAPI.getApiKey('openai')
      if (!actualKey) {
        setMessage('No API key stored')
        return
      }
      setIsValidating(true)
      const isValid = await validateApiKey(actualKey)
      setIsValidating(false)
      setValidationStatus(isValid ? 'valid' : 'invalid')
      setMessage(isValid ? 'API key is valid!' : 'API key is invalid')
    } else {
      setIsValidating(true)
      const isValid = await validateApiKey(openaiKey)
      setIsValidating(false)
      setValidationStatus(isValid ? 'valid' : 'invalid')
      setMessage(isValid ? 'API key is valid!' : 'API key is invalid')
    }
  }

  const handleSave = async () => {
    if (!window.electronAPI) {
      setMessage('Electron API not available')
      return
    }

    // Don't save if showing masked key
    if (openaiKey.startsWith('•')) {
      setMessage('Key already saved')
      return
    }

    if (!openaiKey.trim()) {
      setMessage('Please enter an API key')
      return
    }

    setIsSaving(true)
    setMessage('')

    // Validate before saving
    const isValid = await validateApiKey(openaiKey)
    if (!isValid) {
      setMessage('Invalid API key. Please check and try again.')
      setIsSaving(false)
      return
    }

    const success = await window.electronAPI.setApiKey('openai', openaiKey.trim())
    setIsSaving(false)

    if (success) {
      setHasStoredKey(true)
      setOpenaiKey('••••••••••••••••••••••••••••••••')
      setValidationStatus('valid')
      setMessage('API key saved successfully!')
    } else {
      setMessage('Failed to save API key')
    }
  }

  const handleDelete = async () => {
    if (!window.electronAPI) return

    if (!confirm('Delete stored API key?')) return

    await window.electronAPI.deleteApiKey('openai')
    setHasStoredKey(false)
    setOpenaiKey('')
    setValidationStatus('none')
    setMessage('API key deleted')
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
      <div className="bg-panel border border-panel-border rounded-lg shadow-xl w-[500px] max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-panel-border">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-6">
          {/* Warning if not in Electron */}
          {!window.electronAPI && (
            <div className="p-3 bg-yellow-900/30 border border-yellow-700/50 rounded text-sm">
              <div className="flex items-center gap-2">
                <span>⚠️</span>
                <span>Settings require the desktop app. Please run Monster Rigger as a desktop application.</span>
              </div>
            </div>
          )}

          {/* OpenAI API Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-300">OpenAI API Key</h3>
            <p className="text-xs text-gray-500">
              Required for AI-powered animation generation. Get your key from{' '}
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                platform.openai.com/api-keys
              </a>
            </p>

            <div className="flex gap-2">
              <input
                type="password"
                value={openaiKey.startsWith('•') ? '' : openaiKey}
                onChange={(e) => {
                  setOpenaiKey(e.target.value)
                  setValidationStatus('none')
                }}
                onFocus={() => {
                  // Clear masked key when user focuses the field
                  if (openaiKey.startsWith('•')) {
                    setOpenaiKey('')
                    setValidationStatus('none')
                    setMessage('')
                  }
                }}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder={hasStoredKey && openaiKey.startsWith('•') ? '(Key saved - click to enter new)' : 'sk-...'}
                className="flex-1 input text-sm"
                disabled={isSaving || isValidating || !window.electronAPI}
              />
              {hasStoredKey && openaiKey.startsWith('•') && (
                <span className="px-3 py-1.5 text-xs text-green-400 flex items-center">
                  ✓ Saved
                </span>
              )}
            </div>

            {/* Validation Status */}
            {validationStatus !== 'none' && (
              <div className={`text-xs ${validationStatus === 'valid' ? 'text-green-400' : 'text-red-400'}`}>
                {validationStatus === 'valid' ? '✓ Key is valid' : '✗ Key is invalid'}
              </div>
            )}

            {/* Message */}
            {message && (
              <div className="text-xs text-gray-400">{message}</div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={handleValidate}
                disabled={isValidating || (!openaiKey && !hasStoredKey)}
                className="px-3 py-1.5 rounded text-xs bg-panel-border hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isValidating ? 'Validating...' : 'Validate'}
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving || isValidating || openaiKey.startsWith('•') || !openaiKey.trim()}
                className="px-3 py-1.5 rounded text-xs bg-green-600 hover:bg-green-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? 'Saving...' : 'Save Key'}
              </button>
              {hasStoredKey && (
                <button
                  onClick={handleDelete}
                  disabled={isSaving || isValidating}
                  className="px-3 py-1.5 rounded text-xs bg-red-600 hover:bg-red-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Delete
                </button>
              )}
            </div>
          </div>

          {/* Info Section */}
          <div className="p-3 bg-blue-900/20 border border-blue-800/30 rounded text-xs text-gray-300">
            <strong>About AI Animation Generation:</strong>
            <ul className="mt-1 ml-4 list-disc space-y-1">
              <li>Uses GPT-5.2 to generate natural bone animations from text descriptions</li>
              <li>Generates keyframe-based animations from natural language prompts</li>
              <li>API key is stored securely and encrypted on your device</li>
              <li>Standard OpenAI API usage fees apply</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end px-4 py-3 border-t border-panel-border">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-sm bg-accent hover:bg-accent/80 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
