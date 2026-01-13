import { useCallback, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import { useEditorStore } from '../../store'

export default function BoneCreator() {
  const { camera, gl, scene } = useThree()
  const { addBone, selection } = useEditorStore()
  const [previewPosition, setPreviewPosition] = useState<[number, number, number] | null>(null)
  const raycaster = useRef(new THREE.Raycaster())

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect()
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      raycaster.current.setFromCamera(new THREE.Vector2(x, y), camera)

      // Find meshes to raycast against
      const meshes: THREE.Mesh[] = []
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.visible) {
          meshes.push(obj)
        }
      })

      const intersects = raycaster.current.intersectObjects(meshes, true)

      if (intersects.length > 0) {
        const point = intersects[0].point
        setPreviewPosition([point.x, point.y, point.z])
      } else {
        // Raycast against a plane at y=0
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
        const intersectPoint = new THREE.Vector3()
        raycaster.current.ray.intersectPlane(plane, intersectPoint)
        if (intersectPoint) {
          setPreviewPosition([intersectPoint.x, intersectPoint.y, intersectPoint.z])
        }
      }
    },
    [camera, gl, scene]
  )

  const handleClick = useCallback(
    (event: MouseEvent) => {
      if (event.button !== 0) return // Only left click
      if (!previewPosition) return

      // Use selected bone as parent, or null for root
      const parentId = selection.type === 'bone' && selection.ids.length === 1
        ? selection.ids[0]
        : null

      addBone(previewPosition, parentId)
    },
    [previewPosition, selection, addBone]
  )

  // Attach event listeners
  useThree(({ gl }) => {
    const canvas = gl.domElement

    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('click', handleClick)

    return () => {
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('click', handleClick)
    }
  })

  if (!previewPosition) return null

  return (
    <group position={previewPosition}>
      {/* Preview bone position */}
      <mesh>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshStandardMaterial
          color="#00ff00"
          transparent
          opacity={0.5}
        />
      </mesh>
      {/* Connection line to parent */}
      {selection.type === 'bone' && selection.ids.length === 1 && (
        <LineToParent
          parentId={selection.ids[0]}
          childPosition={previewPosition}
        />
      )}
    </group>
  )
}

function LineToParent({
  parentId,
  childPosition,
}: {
  parentId: string
  childPosition: [number, number, number]
}) {
  const { skeleton } = useEditorStore()
  const parent = skeleton.bones.find((b) => b.id === parentId)

  if (!parent) return null

  const points = [
    new THREE.Vector3(...parent.position),
    new THREE.Vector3(...childPosition),
  ]

  return (
    <Line
      points={points}
      color="#00ff00"
      transparent
      opacity={0.5}
      lineWidth={2}
    />
  )
}
