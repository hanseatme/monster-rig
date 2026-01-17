import { useCallback, useRef, useState, useMemo, useEffect } from 'react'
import { useEditorStore } from '../../store'

// Keyframe selection state
interface SelectedKeyframe {
  boneId: string
  property: 'position' | 'rotation' | 'scale'
  frame: number
}

export default function Timeline() {
  const {
    animations,
    currentAnimationId,
    timeline,
    updateTimeline,
    mode,
    selection,
    skeleton,
    addAnimation,
    deleteAnimation,
    duplicateAnimation,
    setCurrentAnimation,
    setSelection,
    addKeyframe,
    deleteKeyframe,
    updateAnimation,
  } = useEditorStore()

  const timelineRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isRenamingAnimation, setIsRenamingAnimation] = useState(false)
  const [editAnimationName, setEditAnimationName] = useState('')
  const [selectedKeyframes, setSelectedKeyframes] = useState<SelectedKeyframe[]>([])

  const currentAnimation = animations.find((a) => a.id === currentAnimationId)
  const isAnimateMode = mode === 'animate'

  useEffect(() => {
    if (!currentAnimation) return

    const updates: Partial<typeof timeline> = {}
    if (timeline.fps !== currentAnimation.fps) {
      updates.fps = currentAnimation.fps
    }
    if (timeline.frameEnd !== currentAnimation.frameCount) {
      updates.frameEnd = currentAnimation.frameCount
    }

    if (Object.keys(updates).length > 0) {
      updateTimeline(updates)
    }
  }, [currentAnimation, timeline.fps, timeline.frameEnd, updateTimeline])

  // Get all keyframes organized by bone
  const boneKeyframesMap = useMemo(() => {
    if (!currentAnimation) return new Map<string, { frame: number; property: string }[]>()

    const map = new Map<string, { frame: number; property: string }[]>()

    currentAnimation.tracks.forEach((track) => {
      const existing = map.get(track.boneId) || []
      track.keyframes.forEach((kf) => {
        existing.push({
          frame: kf.frame,
          property: track.property,
        })
      })
      map.set(track.boneId, existing)
    })

    return map
  }, [currentAnimation])

  // Get unique keyframe frames for a bone (for diamond display)
  const getUniqueKeyframeFrames = useCallback((boneId: string) => {
    const keyframes = boneKeyframesMap.get(boneId) || []
    const frameSet = new Set(keyframes.map(kf => kf.frame))
    return Array.from(frameSet).sort((a, b) => a - b)
  }, [boneKeyframesMap])

  // Check if a keyframe is selected
  const isKeyframeSelected = useCallback((boneId: string, frame: number) => {
    return selectedKeyframes.some(sk => sk.boneId === boneId && sk.frame === frame)
  }, [selectedKeyframes])

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isAnimateMode || !timelineRef.current || !currentAnimation) return

      const rect = timelineRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const frame = Math.round((x / rect.width) * currentAnimation.frameCount)
      updateTimeline({ currentFrame: Math.max(0, Math.min(frame, currentAnimation.frameCount)) })
    },
    [currentAnimation, updateTimeline, isAnimateMode]
  )

  const handleDrag = useCallback(
    (e: React.MouseEvent) => {
      if (!isAnimateMode || !isDragging || !timelineRef.current || !currentAnimation) return

      const rect = timelineRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const frame = Math.round((x / rect.width) * currentAnimation.frameCount)
      updateTimeline({ currentFrame: Math.max(0, Math.min(frame, currentAnimation.frameCount)) })
    },
    [isDragging, currentAnimation, updateTimeline, isAnimateMode]
  )

  const handlePlayPause = useCallback(() => {
    if (!isAnimateMode) return
    updateTimeline({ isPlaying: !timeline.isPlaying })
  }, [timeline.isPlaying, updateTimeline, isAnimateMode])

  const handleStop = useCallback(() => {
    if (!isAnimateMode) return
    updateTimeline({ isPlaying: false, currentFrame: 0 })
  }, [updateTimeline, isAnimateMode])

  const handlePrevFrame = useCallback(() => {
    if (!isAnimateMode || !currentAnimation) return
    updateTimeline({
      currentFrame: Math.max(0, Math.floor(timeline.currentFrame) - 1),
      isPlaying: false,
    })
  }, [currentAnimation, timeline.currentFrame, updateTimeline, isAnimateMode])

  const handleNextFrame = useCallback(() => {
    if (!isAnimateMode || !currentAnimation) return
    updateTimeline({
      currentFrame: Math.min(currentAnimation.frameCount, Math.floor(timeline.currentFrame) + 1),
      isPlaying: false,
    })
  }, [currentAnimation, timeline.currentFrame, updateTimeline, isAnimateMode])

  const handleInsertKeyframe = useCallback(() => {
    if (!isAnimateMode || !currentAnimation || selection.type !== 'bone') return

    selection.ids.forEach((boneId) => {
      const bone = skeleton.bones.find((b) => b.id === boneId)
      if (!bone) return

      // Insert keyframes for all properties
      addKeyframe(
        currentAnimation.id,
        boneId,
        'position',
        Math.floor(timeline.currentFrame),
        bone.position,
        'linear'
      )
      addKeyframe(
        currentAnimation.id,
        boneId,
        'rotation',
        Math.floor(timeline.currentFrame),
        bone.rotation,
        'linear'
      )
      addKeyframe(
        currentAnimation.id,
        boneId,
        'scale',
        Math.floor(timeline.currentFrame),
        bone.scale,
        'linear'
      )
    })
  }, [currentAnimation, selection, skeleton.bones, timeline.currentFrame, addKeyframe, isAnimateMode])

  const handleDeleteKeyframe = useCallback(() => {
    if (!isAnimateMode || !currentAnimation || selection.type !== 'bone') return

    selection.ids.forEach((boneId) => {
      ;(['position', 'rotation', 'scale'] as const).forEach((property) => {
        deleteKeyframe(currentAnimation.id, boneId, property, Math.floor(timeline.currentFrame))
      })
    })
  }, [currentAnimation, selection, timeline.currentFrame, deleteKeyframe, isAnimateMode])

  const handleAddAnimation = useCallback(() => {
    addAnimation()
  }, [addAnimation])

  // Animation renaming handlers
  const handleStartRenameAnimation = useCallback(() => {
    if (currentAnimation) {
      setEditAnimationName(currentAnimation.name)
      setIsRenamingAnimation(true)
    }
  }, [currentAnimation])

  const handleSubmitRenameAnimation = useCallback(() => {
    if (currentAnimation && editAnimationName.trim()) {
      updateAnimation(currentAnimation.id, { name: editAnimationName.trim() })
    }
    setIsRenamingAnimation(false)
  }, [currentAnimation, editAnimationName, updateAnimation])

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmitRenameAnimation()
    } else if (e.key === 'Escape') {
      setIsRenamingAnimation(false)
    }
  }, [handleSubmitRenameAnimation])

  // Keyframe click handler
  const handleKeyframeClick = useCallback((boneId: string, frame: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isAnimateMode) return

    // Jump to frame
    updateTimeline({ currentFrame: frame })

    // Select the bone
    setSelection({ type: 'bone', ids: [boneId] })

    // Update keyframe selection
    if (e.ctrlKey || e.metaKey) {
      // Toggle selection
      setSelectedKeyframes(prev => {
        const exists = prev.some(sk => sk.boneId === boneId && sk.frame === frame)
        if (exists) {
          return prev.filter(sk => !(sk.boneId === boneId && sk.frame === frame))
        } else {
          // Add all properties at this frame
          const newKeyframes: SelectedKeyframe[] = []
          const keyframes = boneKeyframesMap.get(boneId) || []
          keyframes.forEach(kf => {
            if (kf.frame === frame) {
              newKeyframes.push({ boneId, property: kf.property as 'position' | 'rotation' | 'scale', frame })
            }
          })
          return [...prev, ...newKeyframes]
        }
      })
    } else {
      // Single selection - select all properties at this frame
      const newKeyframes: SelectedKeyframe[] = []
      const keyframes = boneKeyframesMap.get(boneId) || []
      keyframes.forEach(kf => {
        if (kf.frame === frame) {
          newKeyframes.push({ boneId, property: kf.property as 'position' | 'rotation' | 'scale', frame })
        }
      })
      setSelectedKeyframes(newKeyframes)
    }
  }, [updateTimeline, setSelection, boneKeyframesMap, isAnimateMode])

  const handleDeleteAnimation = useCallback(() => {
    if (currentAnimationId && animations.length > 1) {
      deleteAnimation(currentAnimationId)
    }
  }, [currentAnimationId, animations.length, deleteAnimation])

  const handleDuplicateAnimation = useCallback(() => {
    if (currentAnimationId) {
      duplicateAnimation(currentAnimationId)
    }
  }, [currentAnimationId, duplicateAnimation])

  // Frame markers
  const frameMarkers = useMemo(() => {
    if (!currentAnimation) return []

    const markers: number[] = []
    const step = currentAnimation.frameCount <= 60 ? 5 : 10

    for (let i = 0; i <= currentAnimation.frameCount; i += step) {
      markers.push(i)
    }

    return markers
  }, [currentAnimation])

  return (
    <div className="flex flex-col h-full">
      {/* Controls Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-panel-border">
        {/* Left - Playback controls */}
        <div className="flex items-center gap-2">
          <button
            className="btn text-xs"
            onClick={handlePrevFrame}
            title="Previous Frame"
            disabled={!isAnimateMode || !currentAnimation}
          >
            |◀
          </button>
          <button
            className="btn btn-primary text-xs px-4"
            onClick={handlePlayPause}
            disabled={!isAnimateMode || !currentAnimation}
          >
            {timeline.isPlaying ? '⏸' : '▶'}
          </button>
          <button
            className="btn text-xs"
            onClick={handleNextFrame}
            title="Next Frame"
            disabled={!isAnimateMode || !currentAnimation}
          >
            ▶|
          </button>
          <button
            className="btn text-xs"
            onClick={handleStop}
            title="Stop"
            disabled={!isAnimateMode || !currentAnimation}
          >
            ⏹
          </button>

          <div className="w-px h-6 bg-panel-border mx-2" />

          <span className="text-sm text-gray-400">
            Frame:{' '}
            <input
              type="number"
              className="input w-16 text-center"
              value={Math.floor(timeline.currentFrame)}
              onChange={(e) =>
                updateTimeline({ currentFrame: parseInt(e.target.value) || 0 })
              }
              min={0}
              max={currentAnimation?.frameCount || 0}
              disabled={!isAnimateMode || !currentAnimation}
            />
            {currentAnimation && ` / ${currentAnimation.frameCount}`}
          </span>
        </div>

        {/* Center - Animation selector with rename */}
        <div className="flex items-center gap-2">
          <select
            className="input w-32"
            value={currentAnimationId || ''}
            onChange={(e) => setCurrentAnimation(e.target.value || null)}
          >
            {animations.length === 0 && <option value="">No animations</option>}
            {animations.map((anim) => (
              <option key={anim.id} value={anim.id}>
                {anim.name}
              </option>
            ))}
          </select>
          {isRenamingAnimation ? (
            <input
              type="text"
              className="input w-32"
              value={editAnimationName}
              onChange={(e) => setEditAnimationName(e.target.value)}
              onBlur={handleSubmitRenameAnimation}
              onKeyDown={handleRenameKeyDown}
              autoFocus
            />
          ) : (
            <button
              className="btn text-xs"
              onClick={handleStartRenameAnimation}
              disabled={!currentAnimationId}
              title="Rename Animation"
            >
              Rename
            </button>
          )}
          <button className="btn text-xs" onClick={handleAddAnimation} title="New Animation">
            + New
          </button>
          <button
            className="btn text-xs"
            onClick={handleDuplicateAnimation}
            disabled={!currentAnimationId}
            title="Duplicate"
          >
            Copy
          </button>
          <button
            className="btn text-xs"
            onClick={handleDeleteAnimation}
            disabled={!currentAnimationId || animations.length <= 1}
            title="Delete"
          >
            Delete
          </button>
        </div>

        {/* Right - Keyframe controls */}
        <div className="flex items-center gap-2">
          <button
            className="btn text-xs"
            onClick={handleInsertKeyframe}
            disabled={!isAnimateMode || selection.type !== 'bone' || !currentAnimationId}
            title="Insert Keyframe (K)"
          >
            + Key
          </button>
          <button
            className="btn text-xs"
            onClick={handleDeleteKeyframe}
            disabled={!isAnimateMode || selection.type !== 'bone' || !currentAnimationId}
            title="Delete Keyframe"
          >
            - Key
          </button>

          <div className="w-px h-6 bg-panel-border mx-2" />

          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={timeline.loop}
              onChange={(e) => updateTimeline({ loop: e.target.checked })}
              disabled={!isAnimateMode}
            />
            Loop
          </label>
        </div>
      </div>

      {/* Timeline Track */}
      <div className="flex-1 overflow-hidden flex">
        {currentAnimation ? (
          <>
            {/* Bone Labels Column */}
            <div className="w-40 flex-shrink-0 border-r border-panel-border flex flex-col">
              {/* Header */}
              <div className="h-6 border-b border-panel-border px-2 flex items-center">
                <span className="text-xs text-gray-500 font-semibold">Bones</span>
              </div>
              {/* Bone list */}
              <div className="flex-1 overflow-y-auto">
                {skeleton.bones.length === 0 ? (
                  <div className="px-2 py-2 text-xs text-gray-500">No bones</div>
                ) : (
                  skeleton.bones.map((bone) => {
                    const hasKeyframes = boneKeyframesMap.has(bone.id)
                    const isSelected = selection.type === 'bone' && selection.ids.includes(bone.id)
                    return (
                      <div
                        key={bone.id}
                        className={`h-6 px-2 flex items-center cursor-pointer hover:bg-white/5 border-b border-panel-border/50 ${
                          isSelected ? 'bg-accent/20' : ''
                        }`}
                        onClick={() => setSelection({ type: 'bone', ids: [bone.id] })}
                      >
                        <span className="text-yellow-500 mr-1 text-xs">🦴</span>
                        <span className={`text-xs truncate flex-1 ${hasKeyframes ? 'text-white' : 'text-gray-500'}`}>
                          {bone.name}
                        </span>
                        {hasKeyframes && (
                          <span className="text-xs text-yellow-500 ml-1">◆</span>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* Timeline Tracks */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Frame numbers header */}
              <div className="h-6 border-b border-panel-border relative">
                {frameMarkers.map((frame) => (
                  <div
                    key={frame}
                    className="absolute text-xs text-gray-500 top-1/2 -translate-y-1/2"
                    style={{
                      left: `${(frame / currentAnimation.frameCount) * 100}%`,
                      transform: 'translateX(-50%) translateY(-50%)',
                    }}
                  >
                    {frame}
                  </div>
                ))}
              </div>

              {/* Tracks container */}
              <div
                className="flex-1 overflow-y-auto relative"
                ref={timelineRef}
                onMouseDown={(e) => {
                  // Only handle if clicking on background, not on keyframes
                  if ((e.target as HTMLElement).classList.contains('timeline-track-bg')) {
                    setIsDragging(true)
                    handleTimelineClick(e)
                  }
                }}
                onMouseMove={handleDrag}
                onMouseUp={() => setIsDragging(false)}
                onMouseLeave={() => setIsDragging(false)}
              >
                {/* Bone tracks */}
                {skeleton.bones.length === 0 ? (
                  <div
                    className="h-full timeline-track-bg bg-panel relative cursor-pointer"
                    onClick={handleTimelineClick}
                  >
                    {/* Grid lines */}
                    {frameMarkers.map((frame) => (
                      <div
                        key={frame}
                        className="absolute top-0 bottom-0 w-px bg-panel-border/50"
                        style={{ left: `${(frame / currentAnimation.frameCount) * 100}%` }}
                      />
                    ))}
                    {/* Playhead */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-accent z-10 pointer-events-none"
                      style={{
                        left: `${(timeline.currentFrame / currentAnimation.frameCount) * 100}%`,
                      }}
                    >
                      <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-accent" />
                    </div>
                  </div>
                ) : (
                  skeleton.bones.map((bone) => {
                    const keyframeFrames = getUniqueKeyframeFrames(bone.id)
                    const isSelected = selection.type === 'bone' && selection.ids.includes(bone.id)
                    return (
                      <div
                        key={bone.id}
                        className={`h-6 relative border-b border-panel-border/50 timeline-track-bg ${
                          isSelected ? 'bg-accent/10' : 'bg-panel'
                        }`}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).classList.contains('timeline-track-bg')) {
                            handleTimelineClick(e)
                          }
                        }}
                      >
                        {/* Grid lines */}
                        {frameMarkers.map((frame) => (
                          <div
                            key={frame}
                            className="absolute top-0 bottom-0 w-px bg-panel-border/30 pointer-events-none"
                            style={{ left: `${(frame / currentAnimation.frameCount) * 100}%` }}
                          />
                        ))}
                        {/* Keyframes for this bone */}
                        {keyframeFrames.map((frame) => {
                          const isKfSelected = isKeyframeSelected(bone.id, frame)
                          return (
                            <div
                              key={`${bone.id}-${frame}`}
                              className={`absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 cursor-pointer transition-transform hover:scale-125 ${
                                isKfSelected ? 'keyframe-diamond selected' : 'keyframe-diamond'
                              }`}
                              style={{
                                left: `calc(${(frame / currentAnimation.frameCount) * 100}% - 5px)`,
                              }}
                              onClick={(e) => handleKeyframeClick(bone.id, frame, e)}
                              title={`Frame ${frame} - Click to select, Ctrl+Click to multi-select`}
                            />
                          )
                        })}
                      </div>
                    )
                  })
                )}
                {/* Playhead overlay */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-accent z-10 pointer-events-none"
                  style={{
                    left: `${(timeline.currentFrame / currentAnimation.frameCount) * 100}%`,
                  }}
                >
                  <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-accent" />
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            No animation selected. Click "+ New" to create one.
          </div>
        )}
      </div>
    </div>
  )
}
