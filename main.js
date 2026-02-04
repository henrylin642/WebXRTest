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

// --- CONFIGURATION ---
// Default width is 1.1m (Compensated for optical depth error). User can override via Settings button.
const DEFAULT_WIDTH = 1.1;
window.currentWidth = parseFloat(localStorage.getItem('img_width_meters')) || DEFAULT_WIDTH;

// UI: Settings Button Handler
// Note: DOM might not be ready if script runs too early, but modules are deferred.
const settingsBtn = document.getElementById('settings-btn');
if (settingsBtn) {
  settingsBtn.addEventListener('click', () => {
    const newWidth = prompt(
      `Current Image Width: ${window.currentWidth}m\n\nEnter new width in meters (e.g. 0.55):`,
      window.currentWidth
    );
    if (newWidth) {
      const val = parseFloat(newWidth);
      if (!isNaN(val) && val > 0) {
        localStorage.setItem('img_width_meters', val);
        alert(`Saved! Width set to ${val}m. RELOADING PAGE...`);
        window.location.reload();
      } else {
        alert('Invalid number.');
      }
    }
  });
}

// UI: Snapshot & Gallery Logic
const galleryPhotos = []; // { id, url, status: 'uploading'|'done' }
const snapshotBtn = document.getElementById('snapshot-btn');
const galleryStrip = document.getElementById('gallery-strip');
const previewModal = document.getElementById('photo-preview-modal');
const previewImg = document.getElementById('preview-img');
const closePreview = document.getElementById('close-preview');

if (snapshotBtn) {
  snapshotBtn.addEventListener('click', () => {
    // Flash effect
    snapshotBtn.style.background = 'white';
    setTimeout(() => snapshotBtn.style.background = 'rgba(255,255,255,0.2)', 100);

    // CAPTURE CANVAS
    try {
      // Must have preserveDrawingBuffer: true
      const dataURL = renderer.domElement.toDataURL('image/png');

      // Add to Gallery
      const photoId = Date.now();
      const photoObj = { id: photoId, url: dataURL, status: 'uploading' };
      galleryPhotos.push(photoObj);

      updateGalleryUI();

      // Simulate Cloud Upload
      setTimeout(() => {
        photoObj.status = 'done';
        updateGalleryUI();
      }, 2000); // 2 seconds upload time

    } catch (e) {
      log('Snapshot failed: ' + e);
      alert('Snapshot failed. See debug log.');
    }
  });
}

function updateGalleryUI() {
  if (!galleryStrip) return;
  galleryStrip.innerHTML = '';

  const total = galleryPhotos.length;
  const visiblePhotos = galleryPhotos.slice(-3);
  const hiddenCount = Math.max(0, total - 3);

  if (hiddenCount > 0) {
    const badge = document.createElement('div');
    badge.className = 'gallery-overflow';
    badge.innerText = `+${hiddenCount}`;
    galleryStrip.appendChild(badge);
  }

  visiblePhotos.forEach(photo => {
    const thumb = document.createElement('div');
    thumb.className = 'thumb-item';

    const img = document.createElement('img');
    img.src = photo.url;

    const status = document.createElement('div');
    status.className = 'thumb-status ' + (photo.status === 'uploading' ? 'thumb-uploading' : 'thumb-done');

    thumb.appendChild(img);
    thumb.appendChild(status);

    thumb.addEventListener('click', () => {
      if (previewModal && previewImg) {
        previewImg.src = photo.url;
        previewModal.style.display = 'flex';
      }
    });

    galleryStrip.appendChild(thumb);
  });
}

// Modal Close logic
if (closePreview) {
  closePreview.addEventListener('click', () => {
    previewModal.style.display = 'none';
  });
}
if (previewModal) {
  previewModal.addEventListener('click', (e) => {
    if (e.target === previewModal) previewModal.style.display = 'none';
  });
}

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
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true // Required for screenshot capture
    });
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
    log(`Load Image Tracking... (Width: ${window.currentWidth}m)`);
    const imgBitmap = await createImageBitmap(await (await fetch('/ref_with_led.png')).blob());

    log('Requesting Session...');
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['image-tracking'],
      trackedImages: [
        {
          image: imgBitmap,
          widthInMeters: window.currentWidth
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

    // FIX: Rotate content -90 degrees on X axis.
    // User reported Y axis is perpendicular to poster (Normal).
    // We want Y axis to be Up (along the poster).
    // This rotation aligns standard 3D Y-up with the Poster's Vertical Up.
    sceneManager.worldRoot.rotation.x = -Math.PI / 2;

    // OFFSET: Align Origin with Middle LED
    // The Image Origin is the center of the cropped image.
    // In standard WebXR Image Space (before our rotation):
    // X+ is Right
    // Y+ is Up (Normal to surface)
    // Z+ is Down (Bottom of image)
    // So "Top of Image" is -Z direction.
    // The LED is at the top, approx 25cm from center.
    // We move the content origin to align with that.
    sceneManager.worldRoot.position.z = -0.25;
    // sceneManager.worldRoot.position.y = 0.0; // Reset Y if previously set

    // VISUALIZATION: Add Origin Axes (RGB = XYZ)
    // Size 0.3m
    // const axesHelper = new THREE.AxesHelper(0.3);
    const axesHelper = makeThickAxes(0.3);
    sceneManager.worldRoot.add(axesHelper); // Add to worldRoot so it rotates with it

    // DEBUG: Gravity Arrow (Yellow)
    // Visualizes the World Up vector (0, 1, 0) relative to the content
    // We attach this to the SCENE (World Space) so it stays true to gravity,
    // but we will move it to follow the marker position in the render loop.
    const gravityArrowDir = new THREE.Vector3(0, 1, 0);
    const gravityArrowOrigin = new THREE.Vector3(0, 0, 0); // Will update
    const gravityArrowLength = 0.5;
    const gravityArrowColor = 0xffff00; // Yellow
    window.gravityArrow = new THREE.ArrowHelper(gravityArrowDir, gravityArrowOrigin, gravityArrowLength, gravityArrowColor);
    scene.add(window.gravityArrow);

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
// SLAM Monitor Variables
let lastFrameTime = 0;
let slamStatusDiv = document.getElementById('slam-status');

function render(timestamp, frame) {
  const delta = clock.getDelta();
  sceneManager.update(delta);

  if (frame) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const viewerPose = frame.getViewerPose(referenceSpace);

    // --- SLAM Quality Monitor ---
    if (slamStatusDiv) {
      // 1. Calculate FPS
      const timeDiff = timestamp - lastFrameTime;
      lastFrameTime = timestamp;
      const fps = 1000 / timeDiff;

      // 2. Check Tracking State
      let isEmulated = false;
      if (viewerPose && viewerPose.emulatedPosition) {
        isEmulated = true;
      }

      // 3. Determine Status
      let statusClass = 'slam-good';
      let statusText = `SLAM: Stable (${Math.round(fps)} FPS)`;

      if (isEmulated) {
        statusClass = 'slam-bad';
        statusText = `SLAM: LOST (Drifting!)`;
      } else if (fps < 20) {
        statusClass = 'slam-warn';
        statusText = `SLAM: Unstable (Low FPS: ${Math.round(fps)})`;
      } else if (fps < 30) {
        statusClass = 'slam-warn'; // Mild warning
      }

      // 4. Update UI (Optimize: don't touch DOM every frame if not needed? 
      // For simplicity, we update class and text. Browser handles diffing well enough for text.)
      slamStatusDiv.className = statusClass;
      slamStatusDiv.innerText = statusText;
    }
    // ----------------------------

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

    // --- IMAGE TRACKING UPDATE ---
    // Only update trackingRoot position if NOT locked yet
    if (!window.hasLockedPosition) {

      // UI State Management - Initialize Step 1 if not set
      if (!isImageFound && document.getElementById('step-title')?.innerText !== '步驟 1') {
        updateStepUI(1);
      }

      if (!isImageFound && results && results.length > 0) {
        const result = results[0];
        if (result.trackingState === 'tracked') {
          const trackingRoot = scene.getObjectByName('trackingRoot');
          if (trackingRoot) {
            // Update Gravity Arrow to follow the marker
            if (window.gravityArrow) {
              // Convert trackingRoot global position to arrow position
              // Actually trackingRoot is child of scene, so just copy position
              window.gravityArrow.position.copy(trackingRoot.position);
              window.gravityArrow.visible = trackingRoot.visible;
            }
            trackingRoot.visible = true;

            const referenceSpace = renderer.xr.getReferenceSpace();
            const pose = frame.getPose(result.imageSpace, referenceSpace);
            if (pose) {
              trackingRoot.position.copy(pose.transform.position);

              // GRAVITY ALIGNMENT (Vector-based "Z-Down" Logic)
              // Goal: Force the Image's Z-axis (Bottom) to point strictly DOWN (World 0,-1,0),
              // while preserving the Yaw (Facing direction) derived from the Image's X-axis.

              const rawQuat = pose.transform.orientation;

              // 1. Extract the Right Vector (Local X) from the detected image pose
              const rightVec = new THREE.Vector3(1, 0, 0).applyQuaternion(rawQuat);

              // 2. Project it onto the horizontal plane (World XZ) and normalize
              // This retains the "facing" direction but removes any roll/tilt
              rightVec.y = 0;
              rightVec.normalize();

              // 3. Define the desired Down Vector (Local Z should point to World Down)
              // WebXR Image Space: Z is Bottom of image. We want this to be vertical.
              const downVec = new THREE.Vector3(0, -1, 0); // World Down

              // 4. Calculate the adjusted Normal Vector (Local Y)
              // Y = Cross(Z, X) -> But wait, Right-Hand Rule:
              // X (Right) x Y (Up/Normal) = Z (Forward/Down?)
              // In standard bases: X cross Y = Z.
              // So X cross Z = -Y.
              // Z cross X = Y.
              // Let's verify Image Space: X=Right, Y=Normal, Z=Bottom.
              // X(1,0,0) x Y(0,1,0) = Z(0,0,1). Correct.
              // So Logic: Desired Y (Normal) = Desired Z (Down) cross Desired X (Right)?
              // (0,-1,0) x (1,0,0) = (0, 0, 1) -> World Z (Forward).
              // Looks correct.
              const normalVec = new THREE.Vector3();
              normalVec.crossVectors(downVec, rightVec); // Z x X = Y

              // 5. Construct the Rotation Matrix basis
              const alignMat = new THREE.Matrix4();
              alignMat.makeBasis(rightVec, normalVec, downVec);

              // 6. Apply to trackingRoot
              const alignQuat = new THREE.Quaternion();
              alignQuat.setFromRotationMatrix(alignMat);
              trackingRoot.quaternion.copy(alignQuat);

              // LOCK POSITION
              // Only lock if trackingState is 'tracked' (High quality)
              window.hasLockedPosition = true;
              log('Position LOCKED (Gravity Aligned Z-Down).');
            }

            // State Transition: 1 -> 2
            isImageFound = true;
            updateStepUI(2); // AR 定位完成

            // Auto-hide UI after a few seconds and start experience
            setTimeout(() => {
              updateStepUI(3); // 開始體驗
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
    // -----------------------------
  }

  renderer.render(scene, camera);

  // --- 6DoF DEBUG INFO (ALWAYS RUN) ---
  // Show Camera Position relative to Image (Tracking Root)
  const poseInfo = document.getElementById('pose-info');
  if (poseInfo) {
    const trackingRoot = scene.getObjectByName('trackingRoot');
    // Update logic: If locked, trackingRoot is visible and fixed.
    // If not locked, it might be hidden or moving.
    // We want to show stats whenever trackingRoot is visible.
    if (trackingRoot && trackingRoot.visible) {
      const relPos = new THREE.Vector3();
      relPos.copy(camera.position);
      trackingRoot.worldToLocal(relPos);

      // Calculate Rotation (Relative)
      const relQuat = trackingRoot.quaternion.clone().invert().multiply(camera.quaternion);
      const euler = new THREE.Euler().setFromQuaternion(relQuat);

      const r2d = THREE.MathUtils.radToDeg;

      const x = relPos.x.toFixed(2);
      const y = relPos.y.toFixed(2);
      const z = relPos.z.toFixed(2);
      const dist = relPos.length().toFixed(2);

      const rx = (euler.x * r2d).toFixed(0);
      const ry = (euler.y * r2d).toFixed(0);
      const rz = (euler.z * r2d).toFixed(0);

      let statusText = window.hasLockedPosition ? "LOCKED" : "TRACKING";

      poseInfo.innerText = `STATUS: ${statusText}\nPOS: ${x}, ${y}, ${z}\nROT: ${rx}, ${ry}, ${rz}\nDIST: ${dist}m`;
    } else {
      poseInfo.innerText = "Scanning...";
    }
  }
}

// Helper to make thick axes
function makeThickAxes(size = 0.3, thickness = 0.02) {
  const group = new THREE.Group();

  const matR = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const matG = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  const matB = new THREE.MeshBasicMaterial({ color: 0x0000ff });

  // X Axis
  const geoX = new THREE.BoxGeometry(size, thickness, thickness);
  const meshX = new THREE.Mesh(geoX, matR);
  meshX.position.set(size / 2, 0, 0);
  group.add(meshX);

  // Y Axis
  const geoY = new THREE.BoxGeometry(thickness, size, thickness);
  const meshY = new THREE.Mesh(geoY, matG);
  meshY.position.set(0, size / 2, 0);
  group.add(meshY);

  // Z Axis
  const geoZ = new THREE.BoxGeometry(thickness, thickness, size);
  const meshZ = new THREE.Mesh(geoZ, matB);
  meshZ.position.set(0, 0, size / 2);
  group.add(meshZ);

  return group;
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
      desc.innerText = '定位成功！(已鎖定)';
      break;
    case 3:
      title.innerText = '步驟 3';
      desc.innerText = '開始體驗';
      break;
  }
}
