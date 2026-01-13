import { useEffect, useRef } from 'react'
import { useEditorStore } from '../store'

const AUTO_SAVE_INTERVAL = 2 * 60 * 1000 // 2 minutes

export function useAutoSave() {
  const {
    isDirty,
    projectPath,
    getProjectData,
    updateAutoSaveTime,
  } = useEditorStore()

  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const performAutoSave = async () => {
      if (!isDirty) return

      try {
        const projectData = getProjectData()
        const autoSaveData = {
          projectData,
          timestamp: Date.now(),
          filePath: projectPath,
        }

        // Save to localStorage as backup
        localStorage.setItem('monster-rigger-autosave', JSON.stringify(autoSaveData))

        // If we have a project path and electron API, save to file
        if (projectPath && window.electronAPI) {
          const jsonData = JSON.stringify(projectData, null, 2)
          const backupPath = projectPath.replace('.mrig', '.mrig.bak')
          await window.electronAPI.writeFile(backupPath, jsonData)
        }

        updateAutoSaveTime()
        console.log('Auto-saved at', new Date().toLocaleTimeString())
      } catch (error) {
        console.error('Auto-save failed:', error)
      }
    }

    // Set up interval
    intervalRef.current = setInterval(performAutoSave, AUTO_SAVE_INTERVAL)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [isDirty, projectPath, getProjectData, updateAutoSaveTime])

  // Check for crash recovery on mount
  useEffect(() => {
    const checkRecovery = async () => {
      try {
        const savedData = localStorage.getItem('monster-rigger-autosave')
        if (!savedData) return

        const autoSave = JSON.parse(savedData)
        const timeSinceAutoSave = Date.now() - autoSave.timestamp

        // If auto-save is less than 5 minutes old and we don't have a project loaded
        if (timeSinceAutoSave < 5 * 60 * 1000 && !projectPath) {
          const shouldRecover = window.confirm(
            'A recent auto-save was found. Would you like to recover it?'
          )

          if (shouldRecover) {
            const { loadProject } = useEditorStore.getState()
            loadProject(autoSave.projectData, autoSave.filePath || '')
          }
        }

        // Clear the auto-save after handling
        localStorage.removeItem('monster-rigger-autosave')
      } catch (error) {
        console.error('Recovery check failed:', error)
      }
    }

    checkRecovery()
  }, [])
}
