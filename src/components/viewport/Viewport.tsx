import { Canvas } from '@react-three/fiber'
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from '@react-three/drei'
import { Suspense } from 'react'
import { useEditorStore } from '../../store'
import ModelLoader from './ModelLoader'
import BoneVisualizer from './BoneVisualizer'
import BoneCreator from './BoneCreator'
import WeightPaintOverlay from './WeightPaintOverlay'
import AnimationController from './AnimationController'
import SelectionHandler from './SelectionHandler'
import SkeletonBinding from './SkeletonBinding'

function ViewportContent() {
  const { viewportSettings, mode, riggingOffset } = useEditorStore()
  const riggingOffsetValue = riggingOffset

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
      <directionalLight position={[-10, -10, -5]} intensity={0.3} />

      {/* Grid */}
      {viewportSettings.showGrid && (
        <Grid
          args={[20, 20]}
          cellSize={1}
          cellThickness={0.5}
          cellColor="#3c3c3c"
          sectionSize={5}
          sectionThickness={1}
          sectionColor="#505050"
          fadeDistance={50}
          fadeStrength={1}
          infiniteGrid
        />
      )}

      {/* Axes Helper */}
      {viewportSettings.showAxes && (
        <axesHelper args={[5]} />
      )}

      <group position={riggingOffsetValue}>
        {/* Model */}
        <Suspense fallback={null}>
          <ModelLoader />
        </Suspense>

        {/* Skeleton Binding - connects bones to mesh for real-time deformation */}
        <SkeletonBinding />

        {/* Bone Visualization */}
        {viewportSettings.showBones && <BoneVisualizer />}

        {/* Mode-specific components */}
        {mode === 'bone' && <BoneCreator />}
        {mode === 'weight-paint' && <WeightPaintOverlay />}
      </group>

      {/* Animation Controller - always active for playback */}
      <AnimationController />

      {/* Selection */}
      <SelectionHandler />

      {/* Controls */}
      <OrbitControls
        makeDefault
        enablePan
        enableZoom
        enableRotate
        minDistance={1}
        maxDistance={100}
      />

      {/* Gizmo */}
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport
          axisColors={['#ff3333', '#33ff33', '#3333ff']}
          labelColor="white"
        />
      </GizmoHelper>
    </>
  )
}

export default function Viewport() {
  return (
    <div className="w-full h-full" style={{ backgroundColor: '#1a1a1a' }}>
      <Canvas
        camera={{
          position: [5, 5, 5],
          fov: 50,
          near: 0.1,
          far: 1000,
        }}
        shadows
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        style={{ width: '100%', height: '100%' }}
      >
        <color attach="background" args={['#1a1a1a']} />
        <ViewportContent />
      </Canvas>
    </div>
  )
}
