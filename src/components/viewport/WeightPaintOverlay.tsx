import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useEditorStore } from '../../store'

export default function WeightPaintOverlay() {
  const { gl, camera, scene } = useThree()
  const {
    selection,
    skeleton,
    weightPaintSettings,
    weightMap,
    updateMeshWeights
  } = useEditorStore()

  const [isPainting, setIsPainting] = useState(false)
  const raycaster = useRef(new THREE.Raycaster())
  const meshRef = useRef<THREE.Mesh | null>(null)
  const vertexColorsRef = useRef<Float32Array | null>(null)

  // Get the selected bone for painting
  const selectedBoneIndex = useMemo(() => {
    if (selection.type !== 'bone' || selection.ids.length !== 1) return -1
    return skeleton.bones.findIndex((b) => b.id === selection.ids[0])
  }, [selection, skeleton.bones])

  // Find the first mesh in the scene for painting
  useEffect(() => {
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh && !meshRef.current) {
        meshRef.current = obj

        // Initialize vertex colors
        const geometry = obj.geometry
        const vertexCount = geometry.attributes.position.count

        if (!geometry.attributes.color) {
          const colors = new Float32Array(vertexCount * 3)
          colors.fill(0.5) // Initialize with gray
          geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        }

        vertexColorsRef.current = geometry.attributes.color.array as Float32Array

        // Enable vertex colors on material
        if (obj.material instanceof THREE.MeshStandardMaterial) {
          obj.material.vertexColors = true
          obj.material.needsUpdate = true
        }
      }
    })
  }, [scene])

  // Update vertex colors based on weights
  useEffect(() => {
    if (!meshRef.current || selectedBoneIndex < 0 || !vertexColorsRef.current) return

    const mesh = meshRef.current
    const meshName = mesh.name || 'unnamed'
    const weights = weightMap[meshName]?.vertexWeights || []
    const colors = vertexColorsRef.current
    const vertexCount = colors.length / 3

    for (let i = 0; i < vertexCount; i++) {
      const vertexWeights = weights[i] || []
      const boneWeight = vertexWeights.find(([bi]) => bi === selectedBoneIndex)
      const weight = boneWeight ? boneWeight[1] : 0

      // Color from blue (0) to red (1)
      colors[i * 3] = weight // R
      colors[i * 3 + 1] = 0 // G
      colors[i * 3 + 2] = 1 - weight // B
    }

    mesh.geometry.attributes.color.needsUpdate = true
  }, [weightMap, selectedBoneIndex])

  const paint = useCallback(
    (event: PointerEvent) => {
      if (!isPainting || !meshRef.current || selectedBoneIndex < 0) return

      const rect = gl.domElement.getBoundingClientRect()
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      raycaster.current.setFromCamera(new THREE.Vector2(x, y), camera)
      const intersects = raycaster.current.intersectObject(meshRef.current)

      if (intersects.length === 0) return

      const intersect = intersects[0]
      const mesh = meshRef.current
      const meshName = mesh.name || 'unnamed'
      const geometry = mesh.geometry
      const position = geometry.attributes.position
      const vertexCount = position.count

      // Get current weights
      const currentWeights = weightMap[meshName]?.vertexWeights ||
        Array(vertexCount).fill(null).map(() => [] as [number, number][])

      // Find vertices within brush radius
      const hitPoint = intersect.point
      const brushRadius = weightPaintSettings.brushSize / 100 // Convert to world units

      const newWeights = [...currentWeights]

      for (let i = 0; i < vertexCount; i++) {
        const vx = position.getX(i)
        const vy = position.getY(i)
        const vz = position.getZ(i)

        // Transform to world space
        const vertex = new THREE.Vector3(vx, vy, vz)
        vertex.applyMatrix4(mesh.matrixWorld)

        const distance = vertex.distanceTo(hitPoint)
        if (distance > brushRadius) continue

        // Calculate falloff
        const falloff = 1 - (distance / brushRadius)
        const strength = falloff * weightPaintSettings.brushStrength

        // Update weight
        let vertexWeights = [...(newWeights[i] || [])] as [number, number][]
        const existingIdx = vertexWeights.findIndex(([bi]) => bi === selectedBoneIndex)

        if (existingIdx >= 0) {
          let currentWeight = vertexWeights[existingIdx][1]

          switch (weightPaintSettings.brushMode) {
            case 'add':
              currentWeight = Math.min(1, currentWeight + strength)
              break
            case 'subtract':
              currentWeight = Math.max(0, currentWeight - strength)
              break
            case 'smooth':
              // Average with neighbors (simplified)
              currentWeight = currentWeight * 0.9 + 0.5 * 0.1
              break
          }

          vertexWeights[existingIdx] = [selectedBoneIndex, currentWeight]
        } else if (weightPaintSettings.brushMode === 'add') {
          vertexWeights.push([selectedBoneIndex, strength])
        }

        // Normalize weights
        const totalWeight = vertexWeights.reduce((sum, [, w]) => sum + w, 0)
        if (totalWeight > 0) {
          vertexWeights = vertexWeights.map(([bi, w]) => [bi, w / totalWeight] as [number, number])
        }

        newWeights[i] = vertexWeights
      }

      updateMeshWeights(meshName, newWeights)
    },
    [isPainting, gl, camera, selectedBoneIndex, weightPaintSettings, weightMap, updateMeshWeights]
  )

  // Attach painting event listeners
  useEffect(() => {
    const canvas = gl.domElement

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button === 0) setIsPainting(true)
    }
    const handlePointerUp = () => setIsPainting(false)
    const handlePointerMove = (e: PointerEvent) => paint(e)

    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointerup', handlePointerUp)
    canvas.addEventListener('pointermove', handlePointerMove)

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointerup', handlePointerUp)
      canvas.removeEventListener('pointermove', handlePointerMove)
    }
  }, [gl, paint])

  // Show brush cursor
  const [cursorPosition, _setCursorPosition] = useState<THREE.Vector3 | null>(null)

  useFrame(() => {
    // Update cursor position would go here
  })

  if (selectedBoneIndex < 0) {
    return null
  }

  return (
    <>
      {cursorPosition && (
        <mesh position={cursorPosition}>
          <ringGeometry args={[
            weightPaintSettings.brushSize / 100 - 0.01,
            weightPaintSettings.brushSize / 100,
            32
          ]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      )}
    </>
  )
}
