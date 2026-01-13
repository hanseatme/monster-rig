import { useCallback, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useEditorStore } from '../../store'

export default function SelectionHandler() {
  const { gl, camera } = useThree()
  const { mode, skeleton, selection, setSelection } = useEditorStore()
  const raycaster = useRef(new THREE.Raycaster())

  const handleClick = useCallback(
    (event: MouseEvent) => {
      if (mode !== 'select' && mode !== 'animate') return
      if (event.button !== 0) return

      const rect = gl.domElement.getBoundingClientRect()
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      raycaster.current.setFromCamera(new THREE.Vector2(x, y), camera)

      // Check for bone intersections
      let closestBone: { id: string; distance: number } | null = null

      skeleton.bones.forEach((bone) => {
        const bonePos = new THREE.Vector3(...bone.position)
        const distance = raycaster.current.ray.distanceToPoint(bonePos)

        // Threshold for clicking on a bone
        if (distance < 0.3) {
          const cameraDistance = bonePos.distanceTo(camera.position)
          if (!closestBone || cameraDistance < closestBone.distance) {
            closestBone = { id: bone.id, distance: cameraDistance }
          }
        }
      })

      if (closestBone !== null) {
        const selectedBoneId = (closestBone as { id: string; distance: number }).id
        if (event.ctrlKey || event.metaKey) {
          // Multi-select
          if (selection.ids.includes(selectedBoneId)) {
            setSelection({
              type: 'bone',
              ids: selection.ids.filter((id) => id !== selectedBoneId),
            })
          } else {
            setSelection({
              type: 'bone',
              ids: [...selection.ids, selectedBoneId],
            })
          }
        } else if (event.shiftKey && selection.type === 'bone' && selection.ids.length > 0) {
          // Range select (simplified - just add to selection)
          setSelection({
            type: 'bone',
            ids: [...new Set([...selection.ids, selectedBoneId])],
          })
        } else {
          setSelection({ type: 'bone', ids: [selectedBoneId] })
        }
      } else {
        // Clicked on nothing - clear selection
        setSelection({ type: null, ids: [] })
      }
    },
    [mode, skeleton.bones, selection, setSelection, gl, camera]
  )

  // Attach event listener
  useThree(({ gl }) => {
    const canvas = gl.domElement
    canvas.addEventListener('click', handleClick)
    return () => canvas.removeEventListener('click', handleClick)
  })

  return null
}
