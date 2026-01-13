import { useEffect } from 'react'
import { useEditorStore } from './store'
import Layout from './components/Layout'
import { useAutoSave } from './hooks/useAutoSave'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'

function App() {
  const { isDirty, projectPath } = useEditorStore()

  // Initialize hooks
  useAutoSave()
  useKeyboardShortcuts()

  // Update window title
  useEffect(() => {
    const title = projectPath
      ? `Monster Rigger - ${projectPath.split(/[/\\]/).pop()}${isDirty ? ' *' : ''}`
      : `Monster Rigger${isDirty ? ' *' : ''}`
    document.title = title
  }, [isDirty, projectPath])

  // Warn before closing with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  return <Layout />
}

export default App
