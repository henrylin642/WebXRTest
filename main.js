import * as THREE from 'three';
import { SceneManager } from './SceneManager.js';

// --- Debug Console Setup ---
const debugConsole = document.getElementById('debug-console');
function log(message) {
  console.log(message);
  if (debugConsole) {
    debugConsole.innerText += message + '\n';
    debugConsole.scrollTop = debugConsole.scrollHeight;
  }
}
function error(message) {
  console.error(message);
  if (debugConsole) {
    debugConsole.innerText += '[ERROR] ' + message + '\n';
    debugConsole.scrollTop = debugConsole.scrollHeight;
  }
}

window.onerror = function (msg, url, lineNo, columnNo, error) {
  log(`Global Error: ${msg} at line ${lineNo}`);
  return false;
};

log('Initializing App (User JSON Mode)...');

let container;
let camera, scene, renderer;
let controller;
let sceneManager;
const clock = new THREE.Clock();

init();
animate();

function init() {
  container = document.createElement('div');
  document.body.appendChild(container);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

  // Lighting
  const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
  hemisphereLight.position.set(0.5, 1, 0.25);
  scene.add(hemisphereLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
  directionalLight.position.set(0, 10, 0);
  scene.add(directionalLight);

  const ambientLight = new THREE.AmbientLight(0x404040, 1); // Soft white light
  scene.add(ambientLight);

  // Renderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local'); // Origin = Start Position
    container.appendChild(renderer.domElement);
    log('Renderer created');
  } catch (e) {
    error('Renderer init failed: ' + e.message);
    return;
  }

  // Initialize SceneManager
  sceneManager = new SceneManager(scene, camera, log);

  // AR Button Logic
  const arButton = document.getElementById('ar-button');
  if (arButton) {
    arButton.addEventListener('click', onARButtonClick);
    log('AR Button ready.');
  }

  // Controller
  controller = renderer.xr.getController(0);
  controller.addEventListener('select', onSelect);
  scene.add(controller);

  window.addEventListener('resize', onWindowResize);
}

async function onARButtonClick() {
  if (!window.isSecureContext) {
    alert('WebXR requires HTTPS (Secure Context).');
    return;
  }

  if (!navigator.xr) {
    alert('WebXR not supported in this browser.\nOn iOS, use "WebXR Viewer" app.\nOn Android, use Chrome.');
    return;
  }

  const isSupported = await navigator.xr.isSessionSupported('immersive-ar');
  if (!isSupported) {
    alert('ARCore/ARKit not supported or enabled on this device.');
    return;
  }

  try {
    log('Load Image Tracking...');
    const imgBitmap = await createImageBitmap(await (await fetch('/ref.jpg')).blob());

    log('Requesting Session...');
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['image-tracking'],
      trackedImages: [
        {
          image: imgBitmap,
          widthInMeters: 0.6 // 假設海報寬度為 60公分，請根據實際尺寸調整
        }
      ],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: document.getElementById('ar-overlay-root') }
    });

    log('Session created. Scanning for image...');

    // Load scene
    sceneManager.loadSceneConfig('scene.json');

    // Create a root container for Image Tracking adjustments
    // We will move THIS container, not the camera
    const trackingRoot = new THREE.Group();
    trackingRoot.name = 'trackingRoot';
    scene.add(trackingRoot);

    // Move all existing sceneManager objects into trackingRoot
    // Note: SceneManager adds to 'scene' by default in its constructor or logic.
    // We will override SceneManager's root or just manually move them.
    // For now, let's assume we hack SceneManager or just reparent its content.
    // Better way: SceneManager should probably append to a passed root.
    // Let's just create a quick fix: reparent sceneManager.worldRoot
    trackingRoot.add(sceneManager.worldRoot);

    // Turn off auto-update matrix until we find the image?
    // trackingRoot.visible = false; // Optional: hide until found

    session.addEventListener('end', () => {
      log('Session ended');
      document.getElementById('ar-button').style.display = 'block';
      while (sceneManager.worldRoot.children.length > 0) {
        sceneManager.worldRoot.remove(sceneManager.worldRoot.children[0]);
      }
      sceneManager.objects = [];
      scene.remove(trackingRoot); // Clean up
    });

    await renderer.xr.setSession(session);
    document.getElementById('ar-button').style.display = 'none';

  } catch (e) {
    error('Error requesting session: ' + e.message);
    alert('AR Error: ' + e.message);
  }
}

// ... existing resize code ...

// Render loop needs access to 'frame' to get image results
// We need to modify animate/render to handle this.
// But wait, 'animate' calls 'render' which is set as animation loop.
// The 'render' function receives (timestamp, frame).

// Let's rewrite the render function to handle image tracking results
function render(timestamp, frame) {
  const delta = clock.getDelta();
  sceneManager.update(delta);

  if (frame) {
    const results = frame.getImageTrackingResults();
    if (results && results.length > 0) {
      const result = results[0];
      const referenceSpace = renderer.xr.getReferenceSpace(); // Getting current ref space
      const pose = frame.getPose(result.imageSpace, referenceSpace);

      if (pose) {
        // Found the image!
        // result.trackingState can be 'tracked' or 'emulated'
        if (result.trackingState === 'tracked') {
          const trackingRoot = scene.getObjectByName('trackingRoot');
          if (trackingRoot) {
            trackingRoot.visible = true;
            // Set position/rotation of the root to match the image
            trackingRoot.position.copy(pose.transform.position);
            trackingRoot.quaternion.copy(pose.transform.orientation);

            // Optional: Rotate 90 deg? It depends on how the image is defined vs world.
            // Usually Image Y is up, -Z is normal.
          }
        }
      }
    }
  }

  renderer.render(scene, camera);
}
