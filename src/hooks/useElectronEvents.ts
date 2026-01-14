import { useEffect, useCallback } from 'react'
import * as THREE from 'three'
import { useEditorStore } from '../store'
import type { ProjectData } from '../types'
import { getLoadedModel } from '../components/Toolbar'
import { exportToGLB } from '../utils/glbExporter'
import { calculateAutomaticWeightsForMesh } from '../utils/weightCalculator'

interface ElectronEventCallbacks {
  onOpenSettings?: () => void
  onOpenAIAnimation?: () => void
}

export function useElectronEvents(callbacks?: ElectronEventCallbacks) {
  const {
    newProject,
    loadProject,
    setModelPath,
    setProjectPath,
    getProjectData,
    markClean,
    undo,
    redo,
    setMode,
    mirrorBones,
    addAnimation,
  } = useEditorStore()

  // Save project to file
  const saveProject = useCallback(
    async (filePath: string) => {
      if (!window.electronAPI) return

      try {
        const projectData = getProjectData()
        const jsonData = JSON.stringify(projectData, null, 2)
        await window.electronAPI.writeFile(filePath, jsonData)
        setProjectPath(filePath)
        markClean()
        console.log('Project saved to', filePath)
      } catch (error) {
        console.error('Failed to save project:', error)
        alert('Failed to save project: ' + (error as Error).message)
      }
    },
    [getProjectData, setProjectPath, markClean]
  )

  // Export as GLB
  const exportGLB = useCallback(
    async (filePath: string) => {
      if (!window.electronAPI) {
        alert('GLB export requires the desktop app')
        return
      }

      const loadedModel = getLoadedModel()
      if (!loadedModel) {
        alert('No model loaded. Please load a model first.')
        return
      }

      try {
        // Create a scene with the loaded model
        const exportScene = new THREE.Scene()
        const modelClone = loadedModel.clone()
        exportScene.add(modelClone)

        // Get project data for skeleton and animations
        const projectData = getProjectData()
        const { autoWeightSettings } = useEditorStore.getState()

        console.log('Exporting GLB with:', {
          bonesCount: projectData.skeleton.bones.length,
          animationsCount: projectData.animations.length
        })

        // Export to GLB
        const glbData = await exportToGLB(exportScene, projectData, {
          binary: true,
          embedAnimations: true,
          optimizeMeshes: true,
          autoWeightSettings,
        })

        if (!(glbData instanceof ArrayBuffer)) {
          throw new Error('Expected binary GLB data')
        }

        // Write to file using Electron
        const uint8Array = new Uint8Array(glbData)
        // Cast to Buffer for TypeScript - Electron IPC handles Uint8Array properly
        await window.electronAPI.writeFile(filePath, uint8Array as unknown as Buffer)

        console.log('GLB exported successfully to:', filePath)
        alert(`GLB exported successfully!\n\nFile: ${filePath}\nBones: ${projectData.skeleton.bones.length}\nAnimations: ${projectData.animations.length}`)
      } catch (error) {
        console.error('GLB export failed:', error)
        alert('Failed to export GLB: ' + (error instanceof Error ? error.message : 'Unknown error'))
      }
    },
    [getProjectData]
  )

  // Calculate weights automatically
  const calculateWeights = useCallback(() => {
    const { skeleton, setWeightMap, pushHistory, autoWeightSettings } = useEditorStore.getState()
    const loadedModel = getLoadedModel()

    if (!loadedModel) {
      alert('No model loaded. Please load a model first.')
      return
    }

    if (skeleton.bones.length === 0) {
      alert('Please create at least one bone first')
      return
    }

    const newWeightMap: ProjectData['weightMap'] = {}
    let meshCount = 0

    loadedModel.updateMatrixWorld(true)
    loadedModel.traverse((child) => {
      if (child instanceof THREE.Mesh && !(child instanceof THREE.SkinnedMesh)) {
        const weights = calculateAutomaticWeightsForMesh(child, skeleton.bones, {
          method: autoWeightSettings.method,
          falloff: autoWeightSettings.falloff,
          smoothIterations: autoWeightSettings.smoothIterations,
          neighborWeight: autoWeightSettings.neighborWeight,
        })
        const meshName = child.name || `mesh_${meshCount + 1}`
        newWeightMap[meshName] = { vertexWeights: weights }
        meshCount += 1
      }
    })

    if (meshCount === 0) {
      alert('No meshes found for weight calculation.')
      return
    }

    setWeightMap(newWeightMap)
    pushHistory(`Auto weights (${meshCount} meshes)`)
    alert(`Auto weights calculated for ${meshCount} mesh${meshCount === 1 ? '' : 'es'}.`)
  }, [])

  useEffect(() => {
    if (!window.electronAPI) {
      console.log('Electron API not available (running in browser)')
      return
    }

    // Menu events
    window.electronAPI.onNewProject(() => {
      if (useEditorStore.getState().isDirty) {
        if (!confirm('Unsaved changes will be lost. Continue?')) return
      }
      newProject()
    })

    window.electronAPI.onSave(async () => {
      const { projectPath } = useEditorStore.getState()
      if (projectPath) {
        await saveProject(projectPath)
      } else {
        const filePath = await window.electronAPI?.saveProjectDialog()
        if (filePath) {
          await saveProject(filePath)
        }
      }
    })

    window.electronAPI.onUndo(() => undo())
    window.electronAPI.onRedo(() => redo())

    window.electronAPI.onDelete(() => {
      const { selection, deleteBone } = useEditorStore.getState()
      if (selection.type === 'bone') {
        selection.ids.forEach((id) => deleteBone(id))
      }
    })

    window.electronAPI.onToggleWireframe(() => {
      const { viewportSettings, updateViewportSettings } = useEditorStore.getState()
      updateViewportSettings({ showWireframe: !viewportSettings.showWireframe })
    })

    window.electronAPI.onToggleGrid(() => {
      const { viewportSettings, updateViewportSettings } = useEditorStore.getState()
      updateViewportSettings({ showGrid: !viewportSettings.showGrid })
    })

    window.electronAPI.onToggleBones(() => {
      const { viewportSettings, updateViewportSettings } = useEditorStore.getState()
      updateViewportSettings({ showBones: !viewportSettings.showBones })
    })

    window.electronAPI.onFocusSelected(() => {
      // TODO: Implement camera focus on selection
    })

    window.electronAPI.onAddBone(() => {
      setMode('bone')
    })

    window.electronAPI.onAutoSuggestBones(() => {
      alert('Auto-suggest would analyze mesh geometry to suggest bone positions')
    })

    window.electronAPI.onMirrorBones(() => {
      const { selection } = useEditorStore.getState()
      if (selection.type === 'bone' && selection.ids.length > 0) {
        mirrorBones('x')
      } else {
        alert('Please select bones to mirror')
      }
    })

    window.electronAPI.onCalculateWeights(calculateWeights)

    window.electronAPI.onWeightPaintMode(() => {
      setMode('weight-paint')
    })

    window.electronAPI.onNewAnimation(() => {
      addAnimation()
    })

    window.electronAPI.onInsertKeyframe(() => {
      const { selection, skeleton, currentAnimationId, timeline, addKeyframe } =
        useEditorStore.getState()

      if (!currentAnimationId || selection.type !== 'bone') return

      selection.ids.forEach((boneId) => {
        const bone = skeleton.bones.find((b) => b.id === boneId)
        if (bone) {
          addKeyframe(
            currentAnimationId,
            boneId,
            'position',
            Math.floor(timeline.currentFrame),
            bone.position
          )
          addKeyframe(
            currentAnimationId,
            boneId,
            'rotation',
            Math.floor(timeline.currentFrame),
            bone.rotation
          )
          addKeyframe(
            currentAnimationId,
            boneId,
            'scale',
            Math.floor(timeline.currentFrame),
            bone.scale
          )
        }
      })
    })

    window.electronAPI.onDeleteKeyframe(() => {
      const { selection, currentAnimationId, timeline, deleteKeyframe } =
        useEditorStore.getState()

      if (!currentAnimationId || selection.type !== 'bone') return

      selection.ids.forEach((boneId) => {
        ;(['position', 'rotation', 'scale'] as const).forEach((property) => {
          deleteKeyframe(currentAnimationId, boneId, property, Math.floor(timeline.currentFrame))
        })
      })
    })

    window.electronAPI.onPlayPause(() => {
      const { timeline, updateTimeline } = useEditorStore.getState()
      updateTimeline({ isPlaying: !timeline.isPlaying })
    })

    window.electronAPI.onShowShortcuts(() => {
      alert(`Keyboard Shortcuts:

Mode Selection:
  Q - Select Mode
  B - Bone Mode
  P - Weight Paint Mode
  A - Animate Mode

Transform:
  G - Move/Grab
  R - Rotate
  S - Scale

View:
  W - Toggle Wireframe
  F - Focus on Selected

Animation:
  K - Insert Keyframe
  Space - Play/Pause
  ← / → - Previous/Next Frame

Edit:
  Delete - Delete Selected
  Ctrl+Z - Undo
  Ctrl+Y - Redo
  Ctrl+S - Save`)
    })

    window.electronAPI.onShowAbout(() => {
      alert(`Monster Rigger v1.0

A semi-automatic rigging and animation tool
for non-humanoid 3D models.

Built with Electron, React, and Three.js.`)
    })

    // Settings and AI Animation events
    if (callbacks?.onOpenSettings) {
      window.electronAPI.onShowSettings(callbacks.onOpenSettings)
    }
    if (callbacks?.onOpenAIAnimation) {
      window.electronAPI.onAIGenerateAnimation(callbacks.onOpenAIAnimation)
    }

    // File events
    window.electronAPI.onProjectOpened(async ({ filePath, content }) => {
      try {
        const projectData = JSON.parse(content) as ProjectData
        loadProject(projectData, filePath)
      } catch (error) {
        console.error('Failed to load project:', error)
        alert('Failed to load project: Invalid file format')
      }
    })

    window.electronAPI.onModelImported(({ filePath }) => {
      setModelPath(filePath)
    })

    window.electronAPI.onSaveAs(async ({ filePath }) => {
      await saveProject(filePath)
    })

    window.electronAPI.onExportGLB(async ({ filePath }) => {
      await exportGLB(filePath)
    })

    return () => {
      window.electronAPI?.removeAllListeners()
    }
  }, [
    newProject,
    loadProject,
    setModelPath,
    saveProject,
    exportGLB,
    undo,
    redo,
    setMode,
    mirrorBones,
    addAnimation,
    calculateWeights,
    callbacks,
  ])
}
