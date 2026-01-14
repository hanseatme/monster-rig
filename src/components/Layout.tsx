import { useState, useCallback, useMemo } from 'react'
import HierarchyPanel from './panels/HierarchyPanel'
import Viewport from './viewport/Viewport'
import PropertiesPanel from './panels/PropertiesPanel'
import Timeline from './timeline/Timeline'
import Toolbar from './Toolbar'
import StatusBar from './StatusBar'
import DropZone from './DropZone'
import SettingsDialog from './dialogs/SettingsDialog'
import AIAnimationDialog from './dialogs/AIAnimationDialog'
import AutoBonesDialog from './dialogs/AutoBonesDialog'
import { useEditorStore } from '../store'
import { useElectronEvents } from '../hooks/useElectronEvents'

const MIN_PANEL_WIDTH = 200
const MIN_TIMELINE_HEIGHT = 150

export default function Layout() {
  const { modelPath } = useEditorStore()
  const [leftPanelWidth, setLeftPanelWidth] = useState(250)
  const [rightPanelWidth, setRightPanelWidth] = useState(280)
  const [timelineHeight, setTimelineHeight] = useState(200)

  const [isResizingLeft, setIsResizingLeft] = useState(false)
  const [isResizingRight, setIsResizingRight] = useState(false)
  const [isResizingTimeline, setIsResizingTimeline] = useState(false)

  // Dialog states
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isAIAnimationOpen, setIsAIAnimationOpen] = useState(false)
  const [isAutoBonesOpen, setIsAutoBonesOpen] = useState(false)

  // Expose dialog openers for child components
  const openSettings = useCallback(() => setIsSettingsOpen(true), [])
  const openAIAnimation = useCallback(() => setIsAIAnimationOpen(true), [])

  // Connect to Electron menu events
  const electronCallbacks = useMemo(() => ({
    onOpenSettings: openSettings,
    onOpenAIAnimation: openAIAnimation,
  }), [openSettings, openAIAnimation])
  useElectronEvents(electronCallbacks)

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isResizingLeft) {
        const newWidth = Math.max(MIN_PANEL_WIDTH, e.clientX)
        setLeftPanelWidth(Math.min(newWidth, 400))
      } else if (isResizingRight) {
        const newWidth = Math.max(MIN_PANEL_WIDTH, window.innerWidth - e.clientX)
        setRightPanelWidth(Math.min(newWidth, 400))
      } else if (isResizingTimeline) {
        const newHeight = Math.max(MIN_TIMELINE_HEIGHT, window.innerHeight - e.clientY - 24) // 24 = status bar height
        setTimelineHeight(Math.min(newHeight, 400))
      }
    },
    [isResizingLeft, isResizingRight, isResizingTimeline]
  )

  const handleMouseUp = useCallback(() => {
    setIsResizingLeft(false)
    setIsResizingRight(false)
    setIsResizingTimeline(false)
  }, [])

  return (
    <div
      className="flex flex-col h-screen select-none"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Toolbar */}
      <Toolbar onOpenAutoBones={() => setIsAutoBonesOpen(true)} />

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Hierarchy */}
        <div
          className="panel flex flex-col"
          style={{ width: leftPanelWidth, minWidth: MIN_PANEL_WIDTH }}
        >
          <HierarchyPanel />
        </div>

        {/* Left Resize Handle */}
        <div
          className="resize-handle resize-handle-h h-full"
          onMouseDown={() => setIsResizingLeft(true)}
        />

        {/* Center - Viewport and Timeline */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Viewport */}
          <div className="flex-1 relative min-h-0">
            {modelPath ? <Viewport /> : <DropZone />}
          </div>

          {/* Timeline Resize Handle */}
          <div
            className="resize-handle resize-handle-v w-full"
            onMouseDown={() => setIsResizingTimeline(true)}
          />

          {/* Timeline */}
          <div
            className="panel"
            style={{ height: timelineHeight, minHeight: MIN_TIMELINE_HEIGHT }}
          >
            <Timeline />
          </div>
        </div>

        {/* Right Resize Handle */}
        <div
          className="resize-handle resize-handle-h h-full"
          onMouseDown={() => setIsResizingRight(true)}
        />

        {/* Right Panel - Properties */}
        <div
          className="panel flex flex-col"
          style={{ width: rightPanelWidth, minWidth: MIN_PANEL_WIDTH }}
        >
          <PropertiesPanel />
        </div>
      </div>

      {/* Status Bar */}
      <StatusBar onOpenSettings={openSettings} onOpenAIAnimation={openAIAnimation} />

      {/* Dialogs */}
      <SettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
      <AIAnimationDialog
        isOpen={isAIAnimationOpen}
        onClose={() => setIsAIAnimationOpen(false)}
        onOpenSettings={openSettings}
      />
      <AutoBonesDialog
        isOpen={isAutoBonesOpen}
        onClose={() => setIsAutoBonesOpen(false)}
      />
    </div>
  )
}
