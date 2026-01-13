# Claude Code Prompt: Monster Rigger Tool

## Projektbeschreibung

Erstelle ein Windows Desktop-Tool namens **"Monster Rigger"** zum semi-automatischen Riggen und Animieren von nicht-humanoiden 3D-Modellen (GLB/glTF-Format). Das Tool richtet sich an Game-Entwickler, die Monsterfiguren für Videospiele vorbereiten müssen.

---

## Technologie-Stack

- **Framework:** Electron (für native Windows-App)
- **3D-Engine:** Three.js mit GLTFLoader/GLTFExporter
- **UI:** React + Tailwind CSS (oder alternativ: Vue + Vuetify)
- **State Management:** Zustand oder Redux
- **Dateiformat für Projekte:** JSON-basiertes Projektformat (.mrig) das Rig, Bones und Animationen enthält
- **Build:** electron-builder für Windows .exe

---

## Kernfunktionen

### 1. Modell-Import & Viewport

- GLB/glTF-Dateien per Drag & Drop oder File-Dialog laden
- 3D-Viewport mit:
  - Orbit Controls (Rotation, Zoom, Pan)
  - Grid und Achsen-Anzeige
  - Wireframe-Toggle
  - Bone-Visualisierung (als Oktaeder oder Sticks)
- Modell-Hierarchie als Tree-View anzeigen (Meshes, existierende Bones)

### 2. Semi-automatisches Rigging-System

#### 2.1 Bone-Erstellung
- **Manueller Modus:** Klick im Viewport platziert neuen Bone an 3D-Position (Raycasting auf Mesh-Oberfläche)
- **Auto-Suggest:** Basierend auf Mesh-Geometrie Vorschläge für Bone-Positionen:
  - Extremitäten-Erkennung (längliche Mesh-Teile → Bone-Ketten vorschlagen)
  - Symmetrie-Erkennung (wenn linke Seite gerigged → rechte Seite spiegeln)
  - Schwerpunkt-Analyse für Root-Bone-Vorschlag

#### 2.2 Bone-Hierarchie
- Bones per Drag & Drop in Hierarchie anordnen
- Parent-Child-Beziehungen visuell im Viewport anzeigen (Linien zwischen Bones)
- Bone-Eigenschaften editierbar:
  - Name (z.B. "tentacle_01", "jaw_upper", "wing_left_tip")
  - Rotation Limits (Min/Max für X, Y, Z)
  - Bone Length

#### 2.3 Weight Painting
- Automatische Weight-Berechnung basierend auf Bone-Positionen (Heat Map / Envelope-basiert)
- Manueller Weight-Paint-Modus:
  - Brush mit einstellbarer Größe und Stärke
  - Add/Subtract/Smooth-Modi
  - Vertex-Gruppen-Anzeige mit Farbkodierung
- Weight-Normalisierung (sicherstellen, dass alle Weights pro Vertex = 1.0)

### 3. Animations-System

#### 3.1 Animations-Editor
- Timeline mit:
  - Keyframe-Anzeige (Diamant-Symbole)
  - Scrubbing (Frame-für-Frame-Vorschau)
  - Play/Pause/Loop-Controls
  - FPS-Einstellung (24, 30, 60)
  - Frame-Range-Definition (Start/End)

#### 3.2 Keyframe-Workflow
- Bone auswählen → Position/Rotation ändern → Keyframe setzen (Taste "K" oder Button)
- Keyframe-Typen:
  - Location
  - Rotation (Quaternion intern, Euler für UI)
  - Scale
- Interpolation zwischen Keyframes:
  - Linear
  - Bezier (mit Tangent-Handles)
  - Step (kein Interpolieren)

#### 3.3 Animations-Verwaltung
- Mehrere Animationen pro Modell (z.B. "idle", "walk", "attack_bite", "death")
- Animations-Liste mit:
  - Name (editierbar)
  - Dauer in Frames/Sekunden
  - Preview-Thumbnail (optional)
  - Duplicate/Delete-Buttons
- Animation-Blending-Preview (optional, für Übergänge)

### 4. Projekt-Management

#### 4.1 Projektformat (.mrig)
```json
{
  "version": "1.0",
  "modelPath": "relative/path/to/model.glb",
  "modelHash": "sha256-hash-for-integrity",
  "skeleton": {
    "bones": [
      {
        "id": "uuid",
        "name": "root",
        "parentId": null,
        "position": [0, 0, 0],
        "rotation": [0, 0, 0, 1],
        "rotationLimits": {
          "x": [-180, 180],
          "y": [-180, 180],
          "z": [-180, 180]
        }
      }
    ]
  },
  "weightMap": {
    "meshName": {
      "vertexWeights": [[boneIndex, weight], ...]
    }
  },
  "animations": [
    {
      "id": "uuid",
      "name": "idle",
      "fps": 30,
      "frameCount": 60,
      "tracks": [
        {
          "boneId": "uuid",
          "property": "rotation",
          "keyframes": [
            { "frame": 0, "value": [0, 0, 0, 1], "interpolation": "bezier" }
          ]
        }
      ]
    }
  ]
}
```

#### 4.2 Datei-Operationen
- **Neu:** Leeres Projekt erstellen
- **Öffnen:** .mrig-Datei laden (fragt nach GLB wenn Pfad ungültig)
- **Speichern / Speichern unter:** Projekt als .mrig
- **Export:** 
  - GLB mit eingebettetem Rig und allen Animationen
  - Separate Animations-Dateien (.gltf-Animation)
- **Import Animation:** Animation aus anderer .mrig oder .gltf übernehmen

### 5. UI/UX-Design

#### Layout (3-Panel)
```
┌─────────────────────────────────────────────────────────────┐
│  Menu Bar: File | Edit | View | Rig | Animation | Help      │
├──────────────┬──────────────────────────┬───────────────────┤
│              │                          │                   │
│  Hierarchy   │     3D Viewport          │   Properties      │
│  Panel       │                          │   Panel           │
│              │                          │                   │
│  - Bones     │   [3D Scene mit Modell]  │   - Bone Props    │
│  - Meshes    │                          │   - Transform     │
│              │                          │   - Weights       │
│              │                          │                   │
├──────────────┴──────────────────────────┴───────────────────┤
│  Timeline / Animation Editor                                 │
│  [|◀ ▶ ■|]  ──●────────●─────────●──────────  [Frame: 24]   │
│  Animations: [idle ▼] [+ New] [Duplicate] [Delete]          │
└─────────────────────────────────────────────────────────────┘
```

#### Keyboard Shortcuts
- `G` - Grab/Move Bone
- `R` - Rotate Bone
- `S` - Scale Bone
- `K` - Insert Keyframe
- `Delete` - Delete selected
- `Ctrl+Z/Y` - Undo/Redo
- `Space` - Play/Pause Animation
- `Ctrl+S` - Save Project
- `F` - Focus on selected

#### Visual Feedback
- Ausgewählte Bones: Orange Highlight
- Keyframe gesetzt: Gelber Punkt am Bone
- Weight-Einfluss: Blau (0%) → Rot (100%) Gradient
- Bone-Verbindungen: Weiße Linien, dicker bei Parent

---

## Technische Anforderungen

### Performance
- Modelle bis 100k Polygone flüssig darstellen
- Mindestens 60 FPS im Viewport
- Lazy Loading für große Projekte

### Robustheit
- Auto-Save alle 2 Minuten
- Crash-Recovery (letzten Stand wiederherstellen)
- Undo-History mit mindestens 50 Schritten

### Kompatibilität
- Windows 10/11 (64-bit)
- Export kompatibel mit:
  - Unity (getestet mit Import)
  - Unreal Engine
  - Godot
  - Three.js/Babylon.js

---

## Entwicklungs-Phasen

### Phase 1: Grundgerüst
1. Electron + React Projekt aufsetzen
2. Three.js Viewport mit GLB-Loader
3. Basis-UI-Layout mit Panels

### Phase 2: Rigging
4. Bone-Erstellung und -Visualisierung
5. Bone-Hierarchie-Management
6. Automatische Weight-Berechnung
7. Weight-Paint-Modus

### Phase 3: Animation
8. Timeline-Komponente
9. Keyframe-System
10. Animations-Verwaltung (CRUD)
11. Playback-Engine

### Phase 4: Projekt-Management
12. .mrig Speichern/Laden
13. GLB-Export mit Animationen
14. Undo/Redo-System

### Phase 5: Polish
15. Keyboard Shortcuts
16. Auto-Save & Recovery
17. Performance-Optimierung
18. Installer erstellen

---

## Zusätzliche Hinweise

- **Keine humanoiden Presets:** Das Tool soll explizit für nicht-humanoide Kreaturen sein (Tentakel, multiple Gliedmaßen, asymmetrische Formen)
- **Bone-Naming-Conventions:** Vorschläge für Namens-Patterns (z.B. "limb_front_left_01", "spine_segment_03")
- **Preview-Qualität:** Einfaches Lighting im Viewport (Ambient + Directional), keine komplexen Shader nötig
- **Lokalisierung:** Englische UI, aber Struktur für i18n vorbereiten

---

## Beispiel-Workflow für den Benutzer

1. **Import:** Monster-GLB aus Blender/Maya laden
2. **Root setzen:** Klick auf Körpermitte → Root-Bone erstellen
3. **Extremitäten:** Auto-Suggest aktivieren → Tool erkennt 6 Tentakel → Bone-Ketten werden vorgeschlagen
4. **Verfeinern:** Manuell Bones für Kiefer und Augen hinzufügen
5. **Weights:** Auto-Calculate → visuelle Prüfung → Feintuning per Paint
6. **Animation "idle":** 60 Frames, subtile Tentakel-Bewegung, Atem-Simulation
7. **Animation "attack":** 30 Frames, schnelle Tentakel-Schläge
8. **Export:** GLB mit beiden Animationen für Unity

---

## Starte mit Phase 1 und zeige mir nach jedem Schritt den Fortschritt. Frage nach, wenn Entscheidungen zu treffen sind (z.B. React vs Vue, Styling-Ansatz, etc.).
