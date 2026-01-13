# Monster Rigger

A semi-automatic rigging and animation tool for non-humanoid 3D models (GLB/glTF format).

## Features

- **3D Viewport** with orbit controls, grid, and bone visualization
- **Bone Creation** - Manual placement with raycasting or auto-suggest based on mesh geometry
- **Bone Hierarchy** - Drag & drop parent-child relationships
- **Weight Painting** - Automatic weight calculation and manual paint mode
- **Animation System** - Timeline with keyframes, multiple animations per model
- **Project Management** - Save/load .mrig project files
- **GLB Export** - Export rigged and animated models

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

## Build

```bash
npm run build
npm run dist
```

## Keyboard Shortcuts

### Mode Selection
- `Q` - Select Mode
- `B` - Bone Mode
- `P` - Weight Paint Mode
- `A` - Animate Mode

### Transform
- `G` - Move/Grab
- `R` - Rotate
- `S` - Scale

### View
- `W` - Toggle Wireframe
- `F` - Focus on Selected

### Animation
- `K` - Insert Keyframe
- `Space` - Play/Pause
- `Left/Right Arrow` - Previous/Next Frame

### Edit
- `Delete` - Delete Selected
- `Ctrl+Z` - Undo
- `Ctrl+Y` - Redo
- `Ctrl+S` - Save

## Project Format (.mrig)

Projects are saved as JSON files containing:
- Model reference and hash
- Skeleton (bone hierarchy)
- Weight maps
- Animation clips

## Tech Stack

- **Electron** - Desktop application framework
- **React** - UI framework
- **Three.js** - 3D rendering
- **Zustand** - State management
- **Tailwind CSS** - Styling
- **TypeScript** - Type safety
