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
let isImageFound = false; // State for Image Tracking UI

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
    const imgBitmap = await createImageBitmap(await (await fetch('/ref.png')).blob());

    log('Requesting Session...');
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['image-tracking'],
      trackedImages: [
        {
          image: imgBitmap,
          widthInMeters: 0.5 // Updated to 50cm based on user input
        }
      ],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: document.getElementById('ar-overlay-root') }
    });

    log('Session created. Scanning for image...');

    // Load scene
    sceneManager.loadSceneConfig('scene.json');

    // --- FEATURE CHECK ---
    // Verify if Image Tracking is actually running
    // Note: enabledFeatures is an array of strings
    let isTrackingEnabled = false;
    // Check various properties just in case
    if (session.enabledFeatures) {
      // Convert to array if it is not (some browsers use DOMStringList)
      const features = Array.from(session.enabledFeatures);
      log(`Enabled Features: ${features.join(', ')}`);
      if (features.includes('image-tracking')) isTrackingEnabled = true;
    }

    if (!isTrackingEnabled) {
      alert('CRITICAL WARNING: "image-tracking" feature was requested but NOT enabled by the browser. \n\nCheck:\n1. Update Google Play Services for AR\n2. Chrome Flags > WebXR Image Tracking');
      log('CRITICAL: Image Tracking feature MISSING!');
    } else {
      log('SUCCESS: Image Tracking is ACTIVE.');
    }
    // ---------------------

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

    // Force UI to show immediately
    log('Starting AR UI...');
    updateStepUI(1);

  } catch (e) {
    error('Error requesting session: ' + e.message);
    alert('AR Error: ' + e.message);
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onSelect() {
  // Interaction Logic
  const target = sceneManager.raycast(controller);
  if (target) {
    log(`Clicked on: ${sceneManager.getObjectName(target)}`);

    // Trigger Touch Event (ID: 1)
    sceneManager.triggerEvent(target.userData.id, 1);
  }
}

function animate() {
  renderer.setAnimationLoop(render);
}

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

    // --- DEBUG SECTION ---
    // Log tracking status every 60 frames (approx 1 sec) or on state change
    if (!window.frameCounter) window.frameCounter = 0;
    window.frameCounter++;

    if (window.frameCounter % 60 === 0) {
      if (results.length === 0) {
        log(`Scanning... No image detected yet.`);
      } else {
        const r = results[0];
        log(`Image found! State: ${r.trackingState} (Space: ${r.imageSpace ? 'OK' : 'Null'})`);
      }
    }
    // ---------------------

    // UI State Management - Initialize Step 1 if not set
    if (!isImageFound && document.getElementById('step-title')?.innerText !== '步驟 1') {
      updateStepUI(1);
    }

    if (!isImageFound && results && results.length > 0) {
      const result = results[0];
      if (result.trackingState === 'tracked') {
        const trackingRoot = scene.getObjectByName('trackingRoot');
        if (trackingRoot) {
          trackingRoot.visible = true;

          const referenceSpace = renderer.xr.getReferenceSpace();
          const pose = frame.getPose(result.imageSpace, referenceSpace);
          if (pose) {
            trackingRoot.position.copy(pose.transform.position);
            trackingRoot.quaternion.copy(pose.transform.orientation);
          }

          // State Transition: 1 -> 2
          isImageFound = true;
          updateStepUI(2); // AR 定位完成

          // Auto-hide UI after a few seconds and start experience
          setTimeout(() => {
            updateStepUI(3); // 開始體驗
            // Optional: Hide UI completely after some time
            setTimeout(() => {
              const uiContainer = document.getElementById('step-instructions-container');
              if (uiContainer) uiContainer.style.display = 'none';
            }, 3000);
          }, 2000);
        }
      }
    } else if (isImageFound) {
      const results = frame.getImageTrackingResults();
      if (results && results.length > 0) {
        const result = results[0];
        if (result.trackingState === 'tracked') {
          const trackingRoot = scene.getObjectByName('trackingRoot');
          const referenceSpace = renderer.xr.getReferenceSpace();
          const pose = frame.getPose(result.imageSpace, referenceSpace);
          if (trackingRoot && pose) {
            trackingRoot.position.copy(pose.transform.position);
            trackingRoot.quaternion.copy(pose.transform.orientation);
          }
        }
      }
    }
  }

  renderer.render(scene, camera);
}

function updateStepUI(step) {
  const container = document.getElementById('step-instructions-container');
  const title = document.getElementById('step-title');
  const desc = document.getElementById('step-desc');

  if (!container || !title || !desc) return;

  container.style.display = 'block';

  switch (step) {
    case 1:
      title.innerText = '步驟 1';
      desc.innerText = '請將鏡頭對準海報圖片進行掃描';
      break;
    case 2:
      title.innerText = '步驟 2';
      desc.innerText = 'AR 定位完成！';
      break;
    case 3:
      title.innerText = '步驟 3';
      desc.innerText = '開始體驗';
      break;
  }
}
