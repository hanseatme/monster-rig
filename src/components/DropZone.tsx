import { useState, useCallback } from 'react'
import { useEditorStore } from '../store'

export default function DropZone() {
  const [isDragging, setIsDragging] = useState(false)
  const { setModelPath } = useEditorStore()

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)

      const files = Array.from(e.dataTransfer.files)
      const modelFile = files.find(
        (f) => f.name.endsWith('.glb') || f.name.endsWith('.gltf')
      )

      if (modelFile) {
        // In Electron, we can get the file path
        const filePath = (modelFile as any).path
        if (filePath) {
          setModelPath(filePath)
        }
      }
    },
    [setModelPath]
  )

  const handleBrowse = useCallback(async () => {
    if (window.electronAPI) {
      const filePath = await window.electronAPI.openModelDialog()
      if (filePath) {
        setModelPath(filePath)
      }
    }
  }, [setModelPath])

  return (
    <div
      className={`flex-1 flex items-center justify-center ${
        isDragging ? 'drop-zone active' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="text-center">
        <div className="text-6xl mb-4 opacity-30">🐉</div>
        <h2 className="text-xl font-semibold mb-2 text-gray-300">
          Monster Rigger
        </h2>
        <p className="text-gray-500 mb-4">
          Drag and drop a GLB/glTF file here
        </p>
        <p className="text-gray-600 text-sm mb-4">or</p>
        <button
          className="btn btn-primary"
          onClick={handleBrowse}
        >
          Browse Files
        </button>
        <p className="text-gray-600 text-xs mt-4">
          Supported formats: .glb, .gltf
        </p>
      </div>
    </div>
  )
}
