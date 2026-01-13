import { useState, useCallback } from 'react'
import { useEditorStore } from '../../store'
import type { BoneData, MeshNode } from '../../types'

function BoneTreeNode({ bone, level }: { bone: BoneData; level: number }) {
  const { selection, setSelection, skeleton, setBoneParent, updateBone, pushHistory } = useEditorStore()
  const [isExpanded, setIsExpanded] = useState(true)
  const [isDragOver, setIsDragOver] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(bone.name)

  const isSelected = selection.type === 'bone' && selection.ids.includes(bone.id)
  const children = skeleton.bones.filter((b) => b.parentId === bone.id)

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (isEditing) return

      if (e.ctrlKey || e.metaKey) {
        // Multi-select
        if (isSelected) {
          setSelection({
            type: 'bone',
            ids: selection.ids.filter((id) => id !== bone.id),
          })
        } else {
          setSelection({
            type: 'bone',
            ids: [...selection.ids, bone.id],
          })
        }
      } else {
        setSelection({ type: 'bone', ids: [bone.id] })
      }
    },
    [bone.id, isSelected, selection.ids, setSelection, isEditing]
  )

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setEditName(bone.name)
    setIsEditing(true)
  }, [bone.name])

  const handleNameSubmit = useCallback(() => {
    if (editName.trim() && editName !== bone.name) {
      updateBone(bone.id, { name: editName.trim() })
      pushHistory(`Rename bone to ${editName.trim()}`)
    }
    setIsEditing(false)
  }, [bone.id, bone.name, editName, updateBone, pushHistory])

  const handleNameKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Only stop propagation for special keys that have meaning outside the input
    if (e.key === 'Enter') {
      e.stopPropagation()
      e.preventDefault()
      handleNameSubmit()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      e.preventDefault()
      setEditName(bone.name)
      setIsEditing(false)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      // Let these keys work normally in the input, but stop propagation
      // to prevent the app's delete handler from firing
      e.stopPropagation()
    }
    // For all other keys (letters, numbers, etc.), don't stop propagation
    // as React's synthetic events handle them correctly
  }, [handleNameSubmit, bone.name])

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      if (isEditing) {
        e.preventDefault()
        return
      }
      e.stopPropagation()
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('bone-id', bone.id)
      console.log('Drag started:', bone.name, bone.id)
    },
    [bone.id, bone.name, isEditing]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only show drop indicator if not dragging onto self
    const draggedBoneId = e.dataTransfer.types.includes('bone-id') ? 'pending' : null
    if (draggedBoneId) {
      setIsDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)
      const draggedBoneId = e.dataTransfer.getData('bone-id')
      console.log('Drop on:', bone.name, 'dragged:', draggedBoneId)
      if (draggedBoneId && draggedBoneId !== bone.id) {
        // Check for circular reference
        let parent: BoneData | undefined = bone
        while (parent) {
          if (parent.id === draggedBoneId) {
            console.log('Circular reference detected, aborting')
            return
          }
          parent = skeleton.bones.find(b => b.id === parent?.parentId)
        }
        console.log('Setting parent:', draggedBoneId, '->', bone.id)
        setBoneParent(draggedBoneId, bone.id)
        pushHistory(`Set ${skeleton.bones.find(b => b.id === draggedBoneId)?.name} parent to ${bone.name}`)
      }
    },
    [bone, skeleton.bones, setBoneParent, pushHistory]
  )

  return (
    <div>
      <div
        className={`tree-item ${isSelected ? 'selected' : ''} ${isDragOver ? 'bg-accent/30' : ''}`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        draggable={!isEditing}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {children.length > 0 && (
          <button
            className="w-4 h-4 flex items-center justify-center text-gray-500 hover:text-white mr-1"
            onClick={(e) => {
              e.stopPropagation()
              setIsExpanded(!isExpanded)
            }}
          >
            {isExpanded ? '▼' : '▶'}
          </button>
        )}
        {children.length === 0 && <span className="w-4 mr-1" />}
        <span className="text-yellow-500 mr-2">🦴</span>
        {isEditing ? (
          <input
            type="text"
            className="flex-1 bg-panel-light border border-accent rounded px-1 text-sm outline-none"
            value={editName}
            onChange={(e) => {
              e.stopPropagation()
              setEditName(e.target.value)
            }}
            onInput={(e) => {
              // Fallback for onChange in case it doesn't fire
              const target = e.target as HTMLInputElement
              if (target.value !== editName) {
                setEditName(target.value)
              }
            }}
            onBlur={handleNameSubmit}
            onKeyDown={handleNameKeyDown}
            onKeyUp={(e) => e.stopPropagation()}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="text-sm truncate" title="Double-click to rename">{bone.name}</span>
        )}
      </div>
      {isExpanded &&
        children.map((child) => (
          <BoneTreeNode key={child.id} bone={child} level={level + 1} />
        ))}
    </div>
  )
}

function MeshTreeNode({ node, level }: { node: MeshNode; level: number }) {
  const { selection, setSelection, toggleMeshVisibility } = useEditorStore()
  const [isExpanded, setIsExpanded] = useState(true)

  const isSelected = selection.type === 'mesh' && selection.ids.includes(node.id)

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      setSelection({ type: 'mesh', ids: [node.id] })
    },
    [node.id, setSelection]
  )

  const getIcon = () => {
    switch (node.type) {
      case 'mesh':
        return '◼'
      case 'group':
        return '📁'
      case 'bone':
        return '🦴'
      default:
        return '•'
    }
  }

  return (
    <div>
      <div
        className={`tree-item ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleClick}
      >
        {node.children.length > 0 && (
          <button
            className="w-4 h-4 flex items-center justify-center text-gray-500 hover:text-white mr-1"
            onClick={(e) => {
              e.stopPropagation()
              setIsExpanded(!isExpanded)
            }}
          >
            {isExpanded ? '▼' : '▶'}
          </button>
        )}
        {node.children.length === 0 && <span className="w-4 mr-1" />}
        <span className="mr-2">{getIcon()}</span>
        <span className={`text-sm truncate flex-1 ${!node.visible ? 'opacity-50' : ''}`}>
          {node.name}
        </span>
        <button
          className="w-4 h-4 text-gray-500 hover:text-white ml-2"
          onClick={(e) => {
            e.stopPropagation()
            toggleMeshVisibility(node.id)
          }}
        >
          {node.visible ? '👁' : '👁‍🗨'}
        </button>
      </div>
      {isExpanded &&
        node.children.map((child) => (
          <MeshTreeNode key={child.id} node={child} level={level + 1} />
        ))}
    </div>
  )
}

export default function HierarchyPanel() {
  const { skeleton, meshHierarchy, addBone, deleteBone, selection, setBoneParent, pushHistory } = useEditorStore()
  const [activeTab, setActiveTab] = useState<'bones' | 'meshes'>('bones')

  const rootBones = skeleton.bones.filter((b) => b.parentId === null)

  const handleAddRootBone = useCallback(() => {
    addBone([0, 0, 0], null)
  }, [addBone])

  const handleDeleteSelected = useCallback(() => {
    if (selection.type === 'bone') {
      selection.ids.forEach((id) => deleteBone(id))
    }
  }, [selection, deleteBone])

  const handleUnparent = useCallback(() => {
    if (selection.type === 'bone') {
      selection.ids.forEach((id) => setBoneParent(id, null))
    }
  }, [selection, setBoneParent])

  const handleDropOnRoot = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const draggedBoneId = e.dataTransfer.getData('bone-id')
      if (draggedBoneId) {
        console.log('Drop on root, making bone root:', draggedBoneId)
        setBoneParent(draggedBoneId, null)
        pushHistory(`Unparented ${skeleton.bones.find(b => b.id === draggedBoneId)?.name}`)
      }
    },
    [setBoneParent, pushHistory, skeleton.bones]
  )

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex border-b border-panel-border">
        <button
          className={`flex-1 px-4 py-2 text-sm ${
            activeTab === 'bones'
              ? 'bg-panel-light text-white border-b-2 border-accent'
              : 'text-gray-500 hover:text-white'
          }`}
          onClick={() => setActiveTab('bones')}
        >
          Bones ({skeleton.bones.length})
        </button>
        <button
          className={`flex-1 px-4 py-2 text-sm ${
            activeTab === 'meshes'
              ? 'bg-panel-light text-white border-b-2 border-accent'
              : 'text-gray-500 hover:text-white'
          }`}
          onClick={() => setActiveTab('meshes')}
        >
          Meshes
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1 p-2 border-b border-panel-border">
        {activeTab === 'bones' && (
          <>
            <button
              className="btn text-xs"
              onClick={handleAddRootBone}
              title="Add Root Bone"
            >
              + Bone
            </button>
            <button
              className="btn text-xs"
              onClick={handleDeleteSelected}
              disabled={selection.type !== 'bone' || selection.ids.length === 0}
              title="Delete Selected"
            >
              Delete
            </button>
            <button
              className="btn text-xs"
              onClick={handleUnparent}
              disabled={selection.type !== 'bone' || selection.ids.length === 0}
              title="Unparent Selected"
            >
              Unparent
            </button>
          </>
        )}
      </div>

      {/* Tree View */}
      <div
        className="flex-1 overflow-auto"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDropOnRoot}
      >
        {activeTab === 'bones' ? (
          skeleton.bones.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              No bones created yet.
              <br />
              Click "+ Bone" or use Bone Mode (B) to add bones.
            </div>
          ) : (
            rootBones.map((bone) => (
              <BoneTreeNode key={bone.id} bone={bone} level={0} />
            ))
          )
        ) : meshHierarchy.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            No model loaded.
            <br />
            Import a GLB/glTF file to see the mesh hierarchy.
          </div>
        ) : (
          meshHierarchy.map((node) => (
            <MeshTreeNode key={node.id} node={node} level={0} />
          ))
        )}
      </div>
    </div>
  )
}
