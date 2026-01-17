import { useEffect, useRef, useState } from 'react'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import { useEditorStore } from '../../store'
import type { MeshNode, DisplayMode } from '../../types'
import { setLoadedModel } from '../Toolbar'

function buildHierarchy(object: THREE.Object3D, id: string = '0'): MeshNode {
  const node: MeshNode = {
    id,
    name: object.name || 'Unnamed',
    type: object instanceof THREE.Mesh ? 'mesh' : object instanceof THREE.Bone ? 'bone' : 'group',
    children: [],
    visible: object.visible,
  }

  object.children.forEach((child, index) => {
    node.children.push(buildHierarchy(child, `${id}-${index}`))
  })

  return node
}

// Store original materials for restoration (keyed by mesh uuid)
const originalMaterials = new Map<string, THREE.Material | THREE.Material[]>()

// Solid color for solid mode
const SOLID_COLOR = 0x808080

function applyDisplayMode(
  object: THREE.Object3D,
  displayMode: DisplayMode,
  opacity: number
) {
  object.traverse((child) => {
    // Handle both regular Mesh and SkinnedMesh
    if (!(child instanceof THREE.Mesh)) return

    // Store original materials if not already stored (use uuid for stable key)
    if (!originalMaterials.has(child.uuid)) {
      originalMaterials.set(
        child.uuid,
        Array.isArray(child.material)
          ? child.material.map((m) => m.clone())
          : child.material.clone()
      )
    }

    const originalMats = originalMaterials.get(child.uuid)!

    switch (displayMode) {
      case 'textured':
        // Restore original materials
        if (Array.isArray(originalMats)) {
          child.material = originalMats.map((m) => {
            const mat = m.clone()
            mat.transparent = opacity < 1
            mat.opacity = opacity
            mat.depthWrite = opacity >= 1
            return mat
          })
        } else {
          const mat = originalMats.clone()
          mat.transparent = opacity < 1
          mat.opacity = opacity
          mat.depthWrite = opacity >= 1
          child.material = mat
        }
        break

      case 'solid':
        // Gray solid material
        child.material = new THREE.MeshStandardMaterial({
          color: SOLID_COLOR,
          roughness: 0.7,
          metalness: 0.1,
          transparent: opacity < 1,
          opacity: opacity,
          depthWrite: opacity >= 1,
        })
        break

      case 'wireframe':
        // Wireframe material
        child.material = new THREE.MeshBasicMaterial({
          color: 0x00ff00,
          wireframe: true,
          transparent: opacity < 1,
          opacity: opacity,
        })
        break

      case 'xray':
        // Semi-transparent X-ray effect
        const xrayOpacity = Math.min(opacity, 0.3)
        if (Array.isArray(originalMats)) {
          child.material = originalMats.map((m) => {
            const mat = m.clone()
            mat.transparent = true
            mat.opacity = xrayOpacity
            mat.depthWrite = false
            mat.side = THREE.DoubleSide
            return mat
          })
        } else {
          const mat = originalMats.clone()
          mat.transparent = true
          mat.opacity = xrayOpacity
          mat.depthWrite = false
          mat.side = THREE.DoubleSide
          child.material = mat
        }
        break
    }
  })
}

export default function ModelLoader() {
  const { modelPath, viewportSettings, setMeshHierarchy, setRiggingOffset } = useEditorStore()
  const groupRef = useRef<THREE.Group>(null)
  const displayedModelRef = useRef<THREE.Group | null>(null)
  const [model, setModel] = useState<THREE.Group | null>(null)
  const [_error, setError] = useState<string | null>(null)
  const [_loading, setLoading] = useState(false)

  // Load the model when path changes
  useEffect(() => {
    if (!modelPath) {
      setModel(null)
      displayedModelRef.current = null
      originalMaterials.clear()
      setRiggingOffset([0, 0, 0])
      return
    }

    const loadModel = async () => {
      setLoading(true)
      setError(null)
      originalMaterials.clear()

      try {
        console.log('Loading model from:', modelPath)

        // Read file via Electron IPC
        let arrayBuffer: ArrayBuffer

        if (window.electronAPI) {
          // Electron environment - use IPC to read file
          const data = await window.electronAPI.readFile(modelPath)
          // IPC serializes Buffer to Uint8Array, convert to ArrayBuffer
          if (data instanceof Uint8Array) {
            arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
          } else if (data && typeof data === 'object' && 'data' in data) {
            // Sometimes comes as {type: 'Buffer', data: [...]}
            arrayBuffer = new Uint8Array((data as any).data).buffer
          } else {
            arrayBuffer = data as ArrayBuffer
          }
        } else {
          // Browser environment - try fetch (for development)
          const response = await fetch(modelPath)
          arrayBuffer = await response.arrayBuffer()
        }

        console.log('File loaded, size:', arrayBuffer.byteLength)

        // Parse with GLTFLoader
        const loader = new GLTFLoader()

        loader.parse(
          arrayBuffer,
          '', // path for resolving relative URLs (textures etc.)
          (gltf) => {
            console.log('Model parsed successfully:', gltf)
            const loadedModel = gltf.scene.clone()

            // Center and scale the model
            const box = new THREE.Box3().setFromObject(loadedModel)
            const center = box.getCenter(new THREE.Vector3())
            const size = box.getSize(new THREE.Vector3())
            const maxDim = Math.max(size.x, size.y, size.z)
            const scale = maxDim > 0 ? 5 / maxDim : 1

            loadedModel.position.sub(center)
            loadedModel.scale.multiplyScalar(scale)

            const postBox = new THREE.Box3().setFromObject(loadedModel)
            const offsetY = -postBox.min.y
            setRiggingOffset([0, offsetY, 0])

            // Build mesh hierarchy for the panel
            const hierarchy = buildHierarchy(loadedModel)
            setMeshHierarchy([hierarchy])

            setModel(loadedModel)
            setLoading(false)
          },
          (err) => {
            console.error('Error parsing model:', err)
            setError(err instanceof Error ? err.message : 'Failed to parse model')
            setLoading(false)
          }
        )
      } catch (err) {
        console.error('Error loading model:', err)
        setError(err instanceof Error ? err.message : 'Failed to load model')
        setLoading(false)
      }
    }

    loadModel()
  }, [modelPath, setMeshHierarchy])

  // Create the displayed model ONCE when model changes
  useEffect(() => {
    if (!groupRef.current) return

    // Clear existing content
    groupRef.current.clear()
    displayedModelRef.current = null
    originalMaterials.clear()

    if (model) {
      // Clone the model for display
      const displayedModel = model.clone()

      // Apply initial display mode
      applyDisplayMode(displayedModel, viewportSettings.displayMode, viewportSettings.modelOpacity)

      // Add to scene
      groupRef.current.add(displayedModel)
      displayedModelRef.current = displayedModel

      // Store reference for other components (auto-suggest, export, SkeletonBinding)
      setLoadedModel(displayedModel)
    }
  // NOTE: Only depend on model, NOT on viewportSettings
  // Display mode changes are handled separately without recreating the model
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model])

  // Apply display mode changes IN-PLACE without recreating the model
  useEffect(() => {
    if (!displayedModelRef.current) return

    // Apply display mode to all meshes (including any skinned meshes added by SkeletonBinding)
    applyDisplayMode(
      displayedModelRef.current,
      viewportSettings.displayMode,
      viewportSettings.modelOpacity
    )
  }, [viewportSettings.displayMode, viewportSettings.modelOpacity])

  if (!modelPath) return null

  return <group ref={groupRef} />
}
