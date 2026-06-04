import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment';
import GUI from 'lil-gui';
import { WebIO } from '@gltf-transform/core';
import { 
    KHRDracoMeshCompression, 
    KHRMaterialsPBRSpecularGlossiness, 
    KHRMaterialsTransmission, 
    KHRMaterialsVolume, 
    KHRMaterialsClearcoat, 
    KHRMaterialsSheen, 
    KHRMaterialsSpecular, 
    KHRMaterialsIOR, 
    KHRMaterialsIridescence, 
    KHRMaterialsUnlit, 
    KHRTextureTransform,
    KHRMeshQuantization,
    EXTTextureWebP 
} from '@gltf-transform/extensions';
import { draco, dedup, simplify, instance, prune } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';

// --- Scene Setup ---
let scene, camera, renderer, controls, model, environment;
const container = document.getElementById('canvas-container');

// State
let currentModelData = null;
let originalFileSize = 0;
let materials = [];
let materialFolders = new Map();
let copiedMaterial = null;

// Init Scene
function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(5, 5, 5);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.outputEncoding = THREE.sRGBEncoding;
  container.appendChild(renderer.domElement);

  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  window.addEventListener('resize', onWindowResize);
  animate();
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// --- Model Loading ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/'); // Standard CDN path

const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

const objLoader = new OBJLoader();

async function loadModel(file) {
  const url = URL.createObjectURL(file);
  originalFileSize = file.size;
  const fileName = file.name.toLowerCase();
  
  const onProgress = (xhr) => {
    if (xhr.lengthComputable) {
        const percent = (xhr.loaded / xhr.total * 100).toFixed(0);
        console.log(`Loading: ${percent}%`);
    } else {
        console.log(`Loading: ${xhr.loaded} bytes`);
    }
  };
  
  const onError = (error) => {
    console.error('Error loading model:', error);
    alert('Model yüklenirken bir hata oluştu. Lütfen dosya formatını kontrol edin.');
    document.getElementById('upload-overlay').classList.remove('hidden');
  };

  const handleLoadedScene = (loadedScene) => {
    if (model) scene.remove(model);
    
    model = loadedScene;
    scene.add(model);

    // Look for a saved camera
    let savedCamera = null;
    model.traverse((child) => {
      if (child.isCamera) {
        savedCamera = child;
      }
    });

    if (savedCamera) {
      // Use the saved camera's exact position and rotation
      savedCamera.updateMatrixWorld();
      camera.position.setFromMatrixPosition(savedCamera.matrixWorld);
      camera.quaternion.setFromRotationMatrix(savedCamera.matrixWorld);
      if (savedCamera.fov) {
        camera.fov = savedCamera.fov;
        camera.updateProjectionMatrix();
      }
      
      // Calculate a target for OrbitControls that is exactly along the camera's view direction
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      
      const camToCenter = new THREE.Vector3().subVectors(center, camera.position);
      const distance = Math.max(camToCenter.dot(forward), 1.0); // Project onto forward vector
      
      controls.target.copy(camera.position).add(forward.multiplyScalar(distance));
      controls.update();
    } else {
      // First time loading: Center and Scale
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 3 / maxDim;
      
      model.scale.setScalar(scale);
      model.position.sub(center.multiplyScalar(scale));
      
      camera.position.set(5, 5, 5);
      controls.target.set(0,0,0);
      controls.update();
    }

    // UI Updates
    document.getElementById('upload-overlay').classList.add('hidden');
    document.getElementById('side-panel').classList.remove('hidden');
    document.getElementById('stats-panel').classList.remove('hidden');
    
    updateStats(file.name, file.size, model);
    setupGUI(model);
  };

  if (fileName.endsWith('.obj')) {
      objLoader.load(url, handleLoadedScene, onProgress, onError);
  } else {
      loader.load(url, (gltf) => handleLoadedScene(gltf.scene), onProgress, onError);
  }
}

// --- GUI Setup ---
let gui, matGui, sceneGui;

function setupGUI(obj) {
  if (gui) gui.destroy();
  
  gui = new GUI({ container: document.getElementById('scene-gui'), autoPlace: false });
  
  // Scene Controls
  const sceneParams = {
    exposure: renderer.toneMappingExposure,
    background: '#0f172a',
    autoRotate: false
  };
  
  gui.add(sceneParams, 'exposure', 0, 2).onChange(v => renderer.toneMappingExposure = v);
  gui.addColor(sceneParams, 'background').onChange(v => scene.background.set(v));
  gui.add(sceneParams, 'autoRotate').onChange(v => controls.autoRotate = v);

  // Material Editor
  const matContainer = document.getElementById('material-gui');
  matContainer.innerHTML = '';
  const matGuiObj = new GUI({ container: matContainer, autoPlace: false });
  
  materials = [];
  materialFolders.clear();
  obj.traverse(child => {
    if (child.isMesh && child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach(m => materials.push(m));
      } else {
        materials.push(child.material);
      }
    }
  });
  
  // Unique materials only
  const uniqueMaterials = [...new Set(materials)];
  
  uniqueMaterials.forEach((mat, index) => {
    const folder = matGuiObj.addFolder(mat.name || `Material ${index + 1}`);
    
    // Add Copy/Paste actions
    const actions = {
      copy: () => {
        copiedMaterial = mat;
        
        const btn = folder.controllers.find(c => c.property === 'copy').domElement.querySelector('button');
        if (btn) {
          const origText = btn.innerHTML;
          btn.innerHTML = 'Kopyalandı ✓';
          setTimeout(() => btn.innerHTML = origText, 1500);
        }
      },
      paste: () => {
        if (!copiedMaterial) {
          alert('Önce bir materyal kopyalamalısınız.');
          return;
        }
        
        // Preserve identity properties
        const oldName = mat.name;
        const oldUUID = mat.uuid;
        
        mat.copy(copiedMaterial);
        
        mat.name = oldName;
        mat.uuid = oldUUID;
        mat.needsUpdate = true;
        
        // Update GUI
        folder.controllers.forEach(c => {
          if (c.property !== 'copy' && c.property !== 'paste') {
            c.updateDisplay();
          }
        });
        
        const btn = folder.controllers.find(c => c.property === 'paste').domElement.querySelector('button');
        if (btn) {
          const origText = btn.innerHTML;
          btn.innerHTML = 'Yapıştırıldı ✓';
          setTimeout(() => btn.innerHTML = origText, 1500);
        }
      }
    };
    
    folder.add(actions, 'copy').name('📄 Materyali Kopyala');
    folder.add(actions, 'paste').name('📋 Değerleri Yapıştır');

    if (mat.color) folder.addColor(mat, 'color');
    if (mat.emissive) folder.addColor(mat, 'emissive');
    if (mat.roughness !== undefined) folder.add(mat, 'roughness', 0, 1);
    if (mat.metalness !== undefined) folder.add(mat, 'metalness', 0, 1);
    if (mat.transmission !== undefined) folder.add(mat, 'transmission', 0, 1);
    if (mat.thickness !== undefined) folder.add(mat, 'thickness', 0, 5);
    if (mat.opacity !== undefined) folder.add(mat, 'opacity', 0, 1).onChange(() => mat.transparent = mat.opacity < 1);
    
    folder.close();
    materialFolders.set(mat.uuid, folder);
  });
}

function updateStats(name, size, obj) {
  document.getElementById('stat-name').textContent = name;
  document.getElementById('stat-size').textContent = (size / 1024 / 1024).toFixed(2) + ' MB';
  
  let polys = 0;
  obj.traverse(child => {
    if (child.isMesh) {
      polys += child.geometry.attributes.position.count / 3;
    }
  });
  document.getElementById('stat-poly').textContent = Math.round(polys).toLocaleString();
  document.getElementById('stat-draw').textContent = renderer.info.render.calls;
}

// --- Optimization ---
async function exportThreeScene(object, currentCamera, currentTarget) {
    return new Promise((resolve, reject) => {
        // Save original parent
        const parent = object.parent;
        
        // Create an export group
        const exportGroup = new THREE.Scene();
        exportGroup.name = 'ExportScene';
        
        exportGroup.add(object);
        
        // Add a clone of the current camera to save the view
        const camClone = currentCamera.clone();
        camClone.updateMatrixWorld(true);
        exportGroup.add(camClone);
        
        const exporter = new GLTFExporter();
        exporter.parse(
            exportGroup,
            (result) => {
                // Restore the original state
                if (parent) parent.add(object);
                resolve(result);
            },
            (error) => {
                // Restore the original state
                if (parent) parent.add(object);
                reject(error);
            },
            { binary: true }
        );
    });
}

async function optimizeModel() {
  if (!model) return;
  
  const btn = document.getElementById('optimize-btn');
  const spinner = document.getElementById('opt-spinner');
  const text = document.getElementById('opt-text');
  
  btn.disabled = true;
  spinner.style.display = 'block';
  text.textContent = 'Optimizing...';

  try {
    const io = new WebIO()
        .registerExtensions([
            KHRDracoMeshCompression,
            KHRMaterialsPBRSpecularGlossiness,
            KHRMaterialsTransmission,
            KHRMaterialsVolume,
            KHRMaterialsClearcoat,
            KHRMaterialsSheen,
            KHRMaterialsSpecular,
            KHRMaterialsIOR,
            KHRMaterialsIridescence,
            KHRMaterialsUnlit,
            KHRTextureTransform,
            KHRMeshQuantization,
            EXTTextureWebP
        ])
        .registerDependencies({
            'draco3d.decoder': await draco3d.createDecoderModule({
                locateFile: (path) => path.endsWith('.wasm') ? '/draco_decoder_gltf.wasm' : path
            }),
            'draco3d.encoder': await draco3d.createEncoderModule({
                locateFile: (path) => path.endsWith('.wasm') ? '/draco_encoder.wasm' : path
            }),
        });
        
    // 1. Export the CURRENT model from Three.js (includes material edits and baked camera angle)
    const exportedBuffer = await exportThreeScene(model, camera, controls.target);
    
    // 2. Load the exported buffer into gltf-transform
    const gltfDoc = await io.readBinary(new Uint8Array(exportedBuffer));

    // Apply optimization functions
    await gltfDoc.transform(
      dedup(),
      instance(),
      prune(),
      draco({
        method: 'edgebreaker',
        quantizationBits: {
            POSITION: 14,
            NORMAL: 10,
            TEXCOORD: 12,
            COLOR: 8,
            GENERIC: 12,
        }
      })
    );

    const optimizedBinary = await io.writeBinary(gltfDoc);
    
    // Update Stats with optimized size
    const newSize = optimizedBinary.byteLength;
    const ratio = ((1 - newSize / originalFileSize) * 100).toFixed(1);
    
    document.getElementById('stat-size').innerHTML = 
      `<span style="text-decoration: line-through; opacity: 0.5; font-size: 0.8em;">${(originalFileSize/1024/1024).toFixed(2)} MB</span> ` +
      `<span style="color: #22c55e;">${(newSize/1024/1024).toFixed(2)} MB (-${ratio}%)</span>`;

    // Provide Download
    const blob = new Blob([optimizedBinary], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    
    const exportBtn = document.getElementById('export-btn');
    exportBtn.onclick = async (e) => {
      e.preventDefault();
      
      const originalName = document.getElementById('stat-name').textContent || 'model.glb';
      const cleanName = originalName.replace(/\.[^/.]+$/, "").replace(/[^a-z0-9_\-]/gi, '_');
      const defaultName = `optimized_${cleanName}.glb`;
      
      if ('showSaveFilePicker' in window) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: defaultName,
            types: [{
              description: '3D GLB Model',
              accept: { 'model/gltf-binary': ['.glb'] },
            }],
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          return;
        } catch (err) {
          if (err.name !== 'AbortError') {
             console.error('File System API failed, falling back:', err);
          } else {
             return; // User cancelled the save dialog
          }
        }
      }
      
      // Fallback mechanism
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = defaultName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => document.body.removeChild(a), 200);
    };
    
    text.textContent = 'Optimization Done!';
    setTimeout(() => {
        text.textContent = 'Compress & Optimize Again';
        btn.disabled = false;
        spinner.style.display = 'none';
    }, 2000);

  } catch (err) {
    console.error(err);
    text.textContent = 'Error Optimizing';
    btn.disabled = false;
    spinner.style.display = 'none';
  }
}

// --- Event Listeners ---
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) {
    const fileName = file.name.toLowerCase();
    if (fileName.endsWith('.glb') || fileName.endsWith('.gltf') || fileName.endsWith('.obj')) {
      loadModel(file);
    } else {
      alert('Lütfen geçerli bir .glb, .gltf veya .obj dosyası yükleyin.');
    }
  }
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const fileName = file.name.toLowerCase();
    if (fileName.endsWith('.glb') || fileName.endsWith('.gltf') || fileName.endsWith('.obj')) {
      loadModel(file);
    } else {
      alert('Lütfen geçerli bir .glb, .gltf veya .obj dosyası yükleyin.');
    }
  }
});

document.getElementById('optimize-btn').addEventListener('click', optimizeModel);

document.getElementById('new-model-btn').addEventListener('click', () => {
    document.getElementById('upload-overlay').classList.remove('hidden');
    document.getElementById('side-panel').classList.add('hidden');
    document.getElementById('stats-panel').classList.add('hidden');
});

// --- Raycaster for Material Selection ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let pointerDownPosition = new THREE.Vector2();

container.addEventListener('pointerdown', (event) => {
  pointerDownPosition.set(event.clientX, event.clientY);
});

container.addEventListener('pointerup', (event) => {
  if (!model) return;
  
  // Calculate distance moved to distinguish click from drag
  const moveDistance = Math.hypot(event.clientX - pointerDownPosition.x, event.clientY - pointerDownPosition.y);
  if (moveDistance > 5) return; // It was a drag

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ( ( event.clientX - rect.left ) / rect.width ) * 2 - 1;
  mouse.y = - ( ( event.clientY - rect.top ) / rect.height ) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObject(model, true);
  if (intersects.length > 0) {
    const clickedMesh = intersects[0].object;
    const material = clickedMesh.material;
    
    const targetMat = Array.isArray(material) ? material[0] : material;

    if (targetMat && materialFolders.has(targetMat.uuid)) {
      // Close all other folders
      materialFolders.forEach(folder => folder.close());
      
      // Open target folder and scroll to it
      const folder = materialFolders.get(targetMat.uuid);
      folder.open();
      folder.domElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      
      // Visual feedback: briefly highlight the mesh
      if (targetMat.emissive) {
        const origEmissive = targetMat.emissive.clone();
        targetMat.emissive.setHex(0x555555); // Highlight color
        setTimeout(() => {
          targetMat.emissive.copy(origEmissive);
        }, 200);
      }
    }
  }
});

// Init
init();
