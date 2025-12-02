import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'; // Useful for cloning if needed, but maybe not now.

export class SceneManager {
    constructor(scene, camera, logFn) {
        this.scene = scene;
        this.camera = camera; // Need camera for face_me logic
        this.log = logFn || console.log;
        this.objects = [];
        this.worldRoot = new THREE.Group();
        this.scene.add(this.worldRoot);

        this.textureLoader = new THREE.TextureLoader();
        this.gltfLoader = new GLTFLoader();

        this.tweens = []; // Active animations

        // Loading UI
        this.loadingScreen = document.getElementById('loading-screen');
        this.progressFill = document.getElementById('progress-fill');
        this.progressText = document.getElementById('progress-text');
        this.totalObjectsToLoad = 0;
        this.loadedObjectsCount = 0;

        // Iframe UI
        this.iframeOverlay = document.getElementById('iframe-overlay');
        this.webIframe = document.getElementById('web-iframe');
        this.closeIframeBtn = document.getElementById('close-iframe');

        if (this.closeIframeBtn) {
            this.closeIframeBtn.addEventListener('click', () => {
                this.closeIframe();
            });
        }
    }

    closeIframe() {
        if (this.iframeOverlay) {
            this.iframeOverlay.style.display = 'none';
            if (this.webIframe) this.webIframe.src = ''; // Stop loading
        }
    }

    updateLoadingProgress() {
        if (this.totalObjectsToLoad === 0) return;

        this.loadedObjectsCount++;
        const percent = Math.floor((this.loadedObjectsCount / this.totalObjectsToLoad) * 100);

        if (this.progressFill) this.progressFill.style.width = `${percent}%`;
        if (this.progressText) this.progressText.innerText = `${percent}%`;

        if (this.loadedObjectsCount >= this.totalObjectsToLoad) {
            this.log('All assets loaded.');
            setTimeout(() => {
                if (this.loadingScreen) this.loadingScreen.style.display = 'none';
            }, 500); // Small delay for smooth finish
        }
    }

    // Load JSON
    async loadSceneConfig(url) {
        try {
            const response = await fetch(url);
            const data = await response.json();
            this.log('Scene JSON loaded');

            // Handle different JSON structures
            let objectsToSpawn = [];
            if (data.ar_objects && Array.isArray(data.ar_objects)) {
                objectsToSpawn = data.ar_objects;
            } else if (Array.isArray(data)) {
                objectsToSpawn = data;
            } else {
                objectsToSpawn = [data];
            }

            this.spawnObjects(objectsToSpawn);

        } catch (e) {
            this.log('Error loading scene config: ' + e.message);
            console.error(e);
        }
    }

    spawnObjects(objectList) {
        // Filter valid objects first to know total count
        const validObjects = objectList.filter(obj => {
            const type = obj.model?.type;
            if (type === 5 && obj.model?.texture?.url) return true;
            if (type === 8 && (obj.model?.android_texture?.url || obj.model?.ios_texture?.url)) return true;
            if (type === 9 && obj.model?.texture?.url) return true;
            return false;
        });

        this.totalObjectsToLoad = validObjects.length;
        this.loadedObjectsCount = 0;

        if (this.totalObjectsToLoad > 0) {
            if (this.loadingScreen) this.loadingScreen.style.display = 'flex';
            this.log(`Starting load for ${this.totalObjectsToLoad} objects...`);
        } else {
            if (this.loadingScreen) this.loadingScreen.style.display = 'none';
        }

        objectList.forEach(objData => {
            const type = objData.model?.type;
            const id = objData.id || 'unknown';

            if (type === 5) {
                // Type 5: Image Plane
                if (objData.model?.texture?.url) {
                    this.createImageObject(objData);
                }
            } else if (type === 8) {
                // Type 8: GLB Model
                const url = objData.model?.android_texture?.url || objData.model?.ios_texture?.url;
                if (url) {
                    this.createGLBObject(objData, url);
                }
            } else if (type === 9) {
                // Type 9: Video Plane
                if (objData.model?.texture?.url) {
                    this.createVideoObject(objData);
                }
            } else {
                this.log(`Skipping object ${id}: Unknown type ${type} or invalid structure`);
            }
        });
    }

    createImageObject(data) {
        const url = data.model.texture.url;

        // Load Texture
        this.textureLoader.load(
            url,
            (texture) => {
                // Create Plane
                // Normalize dimensions: Largest side = 1, other side scales proportionally
                const imgWidth = texture.image.width;
                const imgHeight = texture.image.height;

                let geometryWidth = 1;
                let geometryHeight = 1;

                if (imgWidth >= imgHeight) {
                    geometryWidth = 1;
                    geometryHeight = imgHeight / imgWidth;
                } else {
                    geometryHeight = 1;
                    geometryWidth = imgWidth / imgHeight;
                }

                const geometry = new THREE.PlaneGeometry(geometryWidth, geometryHeight);

                const material = new THREE.MeshBasicMaterial({
                    map: texture,
                    transparent: true,
                    side: data.model.fields?.is_double_sided ? THREE.DoubleSide : THREE.FrontSide,
                    alphaTest: 0.5
                });

                const mesh = new THREE.Mesh(geometry, material);
                this.setupObject(mesh, data);
                this.log(`Created Image Object ${data.id}`);
                this.updateLoadingProgress();
            },
            undefined,
            (err) => {
                this.log(`Error loading texture for ${data.id}: ${err}`);
                this.updateLoadingProgress(); // Still count as processed even if error
            }
        );
    }

    createVideoObject(data) {
        const url = data.model.texture.url;
        const fields = data.model.fields || {};

        // Create Video Element
        const video = document.createElement('video');
        video.src = url;
        video.crossOrigin = 'anonymous';
        video.loop = fields.is_loop_play || false;
        video.muted = true; // Auto-play requires muted usually
        video.playsInline = true;

        if (fields.is_play) {
            video.play().catch(e => this.log(`Video autoplay failed: ${e.message}`));
        }

        const texture = new THREE.VideoTexture(video);

        // We don't know video dimensions until metadata loaded, 
        // but we can default to 16:9 or wait.
        // For simplicity, let's assume 16:9 or update later. 
        // Better: use a default 1x1 and update scale when metadata loads?
        // Or just use 16:9 (1.77 : 1) as a safe bet for videos.
        const geometry = new THREE.PlaneGeometry(1.77, 1);

        const material = new THREE.MeshBasicMaterial({
            map: texture,
            side: fields.is_double_sided ? THREE.DoubleSide : THREE.FrontSide,
            transparent: true
        });

        const mesh = new THREE.Mesh(geometry, material);
        this.setupObject(mesh, data);
        this.log(`Created Video Object ${data.id}`);
        this.updateLoadingProgress();
    }

    createGLBObject(data, url) {
        this.gltfLoader.load(
            url,
            (gltf) => {
                const model = gltf.scene;
                const fields = data.model.fields || {};

                // Apply scaling from fields if needed, but usually zoom handles it.
                // Some GLBs might need normalization. For now, just add it.

                this.setupObject(model, data);

                // Handle animations
                if (gltf.animations && gltf.animations.length > 0) {
                    const mixer = new THREE.AnimationMixer(model);
                    model.userData.mixer = mixer;
                    model.userData.animations = gltf.animations; // Store for later access

                    // Determine clip to play
                    // If start_frame/end_frame/fps are provided, we might need to subclip
                    const startFrame = fields.start_frame;
                    const endFrame = fields.end_frame;
                    const fps = fields.fps || 25; // Default 25 if not specified?
                    const speed = fields.animation_speed || 1;

                    if (startFrame !== null && endFrame !== null && fps) {
                        // Specific frame range logic (simplified for now to just play first clip with speed)
                        // Ideally we should subclip here.
                        let clip = gltf.animations[0];
                        const action = mixer.clipAction(clip);
                        action.timeScale = speed;
                        action.play();
                    } else {
                        // Play ALL animations
                        this.log(`Playing all ${gltf.animations.length} animations for ${data.id}`);
                        gltf.animations.forEach((clip, index) => {
                            const action = mixer.clipAction(clip);
                            action.timeScale = speed;
                            action.reset(); // Ensure it starts from beginning
                            action.play();
                            // this.log(`Playing clip ${index}: ${clip.name}`);
                        });
                    }
                }

                this.log(`Created GLB Object ${data.id}`);
                this.updateLoadingProgress();
            },
            undefined,
            (err) => {
                this.log(`Error loading GLB for ${data.id}: ${err}`);
                this.updateLoadingProgress(); // Still count as processed even if error
            }
        );
    }

    setupObject(mesh, data) {
        const fields = data.model.fields || {};

        // Apply Transforms
        if (data.location) {
            mesh.position.set(
                data.location.x || 0,
                data.location.y || 0,
                data.location.z || 0
            );

            mesh.rotation.set(
                THREE.MathUtils.degToRad(data.location.rotate_x || 0),
                THREE.MathUtils.degToRad(data.location.rotate_y || 0),
                THREE.MathUtils.degToRad(data.location.rotate_z || 0)
            );
        }

        // Zoom (Scale)
        if (data.zoom) {
            mesh.scale.set(
                data.zoom.x || 1,
                data.zoom.y || 1,
                data.zoom.z || 1
            );
        }

        // Apply Initial Transparency
        if (data.transparency !== undefined && data.transparency !== null) {
            this.setObjectOpacity(mesh, data.transparency);
        }

        // Visibility & Metadata
        const isHidden = fields.is_hidden || false;

        mesh.userData = {
            id: data.id,
            name: data.name || '',
            face_me: fields.face_me || false,
            events: data.events || [],

            // Visibility Logic
            desiredVisibility: !isHidden, // Track what the logic *wants*
            visible_distance: fields.is_ignore ? Infinity : (fields.visible_distance || 20),
            is_ignore: fields.is_ignore || false
        };

        // Set initial visibility
        mesh.visible = mesh.userData.desiredVisibility;

        this.worldRoot.add(mesh);
        this.objects.push(mesh);
    }

    getObjectName(obj) {
        if (!obj) return 'Unknown';
        const id = obj.userData.id;
        const name = obj.userData.name;
        return name ? `${id}-${name}` : `${id}`;
    }

    setObjectOpacity(obj, opacity) {
        obj.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material.transparent = true;
                child.material.opacity = opacity;
                // If opacity is 0, we might want to set visible = false to optimize, 
                // but for fade-in animations we keep it visible.
                // child.visible = opacity > 0; 
            }
        });
    }

    update(delta) {
        const cameraPos = this.camera.position;

        this.objects.forEach(obj => {
            // 1. Face Me Logic
            if (obj.userData.face_me) {
                obj.lookAt(cameraPos);
            }

            // 2. Animation Mixer Update (GLB)
            if (obj.userData.mixer) {
                obj.userData.mixer.update(delta);
            }

            // 3. Visibility Distance Logic
            // Only apply if desiredVisibility is true (i.e., not hidden by action)
            if (obj.userData.desiredVisibility) {
                const dist = obj.position.distanceTo(cameraPos);
                if (dist > obj.userData.visible_distance) {
                    obj.visible = false;
                } else {
                    obj.visible = true;
                }
            } else {
                // If hidden by action, stay hidden
                obj.visible = false;
            }
        });

        // 4. Update Tweens
        for (let i = this.tweens.length - 1; i >= 0; i--) {
            const tween = this.tweens[i];
            tween.elapsed += delta;
            const progress = Math.min(tween.elapsed / tween.duration, 1);

            // Linear easing for now
            const value = tween.start + (tween.end - tween.start) * progress;
            tween.onUpdate(value);

            if (progress >= 1) {
                if (tween.onComplete) tween.onComplete();
                this.tweens.splice(i, 1);
            }
        }
    }

    raycast(controller) {
        const tempMatrix = new THREE.Matrix4();
        tempMatrix.identity().extractRotation(controller.matrixWorld);

        const raycaster = new THREE.Raycaster();
        raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

        const intersects = raycaster.intersectObjects(this.worldRoot.children, true); // Recursive for GLB

        if (intersects.length > 0) {
            // Traverse up to find the root object we manage
            // Also check if the object or any parent is invisible
            for (let i = 0; i < intersects.length; i++) {
                let target = intersects[i].object;
                let visible = true;

                // 1. Check Opacity (Transparency)
                // If opacity is low, treat as invisible/pass-through
                if (target.material && target.material.transparent && target.material.opacity < 0.1) {
                    continue;
                }

                // 2. Check visibility up the chain
                let current = target;
                while (current && current !== this.worldRoot) {
                    if (!current.visible) {
                        visible = false;
                        break;
                    }
                    current = current.parent;
                }

                if (!visible) continue; // Skip invisible objects

                // Find root object
                while (target.parent && target.parent !== this.worldRoot) {
                    target = target.parent;
                }
                return target; // Found visible target
            }
        }
        return null;
    }

    // --- Interaction System ---

    triggerEvent(objId, eventType) {
        const obj = this.objects.find(o => o.userData.id === objId);
        if (!obj) return;

        const events = obj.userData.events;
        if (!events) return;

        // Find events matching the type (e.g., 1 = Touch)
        const matchingEvents = events.filter(e => e.id === eventType);

        matchingEvents.forEach(evt => {
            this.log(`Event ${eventType} triggered on object ${this.getObjectName(obj)}`);
            if (evt.actions && evt.actions.length > 0) {
                this.executeActionSequence(evt.actions, obj);
            }
        });
    }

    executeActionSequence(actions, triggerObj) {
        // 1. Group actions
        const groups = {};
        const noGroupActions = [];

        actions.forEach(action => {
            const g = action.values?.group;
            if (g !== undefined && g !== null && g > 0) {
                if (!groups[g]) groups[g] = [];
                groups[g].push(action);
            } else {
                noGroupActions.push(action);
            }
        });

        // 2. Sort group keys
        const sortedKeys = Object.keys(groups).map(Number).sort((a, b) => a - b);

        // 3. Execute sequentially
        let accumulatedDelay = 0;

        sortedKeys.forEach(key => {
            const groupActions = groups[key];

            // Schedule this group
            setTimeout(() => {
                this.log(`Executing Group ${key}`);
                groupActions.forEach(action => this.executeAction(action, triggerObj));
            }, accumulatedDelay * 1000);

            // Calculate max duration in this group to delay the NEXT group
            let maxDuration = 0;
            groupActions.forEach(action => {
                const duration = (action.values?.time || 0) + (action.values?.delay_time || 0);
                if (duration > maxDuration) maxDuration = duration;
            });

            accumulatedDelay += maxDuration;
        });

        // 4. Execute "no group" actions last
        if (noGroupActions.length > 0) {
            setTimeout(() => {
                this.log(`Executing No-Group Actions`);
                noGroupActions.forEach(action => this.executeAction(action, triggerObj));
            }, accumulatedDelay * 1000);
        }
    }

    executeAction(action, triggerObj) {
        const values = action.values || {};
        const targetId = values.obj_id;

        // If obj_id is -1 or missing, it might refer to "self" or "group", 
        // but for now we assume explicit IDs or handle specific logic.
        // We need to find the target object(s).

        let targets = [];
        if (targetId && targetId !== -1) {
            const t = this.objects.find(o => o.userData.id === targetId);
            if (t) targets.push(t);
        } else {
            // If obj_id is null, undefined, or -1, it applies to the trigger object (Self)
            if (triggerObj) {
                targets.push(triggerObj);
            }
            // Note: Our current data structure puts 'group' on the object root, 
            // but we haven't explicitly stored it in userData yet. 
            // Let's assume we might need to add it to setupObject if we want group support.
            // For this MVP, we focus on explicit obj_id.
        }

        if (targets.length === 0) {
            // Fallback: if no target specified, maybe it applies to the object that triggered it?
            // But executeAction doesn't know the trigger source easily unless passed.
            // For now, log warning if no target found for ID-based actions.
            if ([19, 35, 36].includes(action.id)) {
                // this.log(`Action ${action.id}: No target found for ID ${targetId}`);
            }
        }

        switch (action.id) {
            case 3: // Move (Relative)
                targets.forEach(target => {
                    const duration = values.time || 1.0;
                    const dx = values.direction_x || 0;
                    const dy = values.direction_y || 0;
                    const dz = values.direction_z || 0;

                    const startPos = target.position.clone();
                    const endPos = startPos.clone().add(new THREE.Vector3(dx, dy, dz));

                    this.log(`Action: Move object ${this.getObjectName(target)} by (${dx}, ${dy}, ${dz}) in ${duration}s`);

                    this.tweens.push({
                        start: 0,
                        end: 1,
                        duration: duration,
                        elapsed: 0,
                        onUpdate: (val) => {
                            target.position.lerpVectors(startPos, endPos, val);
                        }
                    });
                });
                break;

            case 6: // Play Video
                // Note: This requires the object to already have a video texture or we swap it.
                // For now, we check if the map is a VideoTexture.
                targets.forEach(target => {
                    let videoFound = false;
                    target.traverse(c => {
                        if (c.isMesh && c.material && c.material.map && c.material.map.isVideoTexture) {
                            const video = c.material.map.image;
                            if (video.paused) {
                                video.play();
                                this.log(`Action: Play video on ${this.getObjectName(target)}`);
                            } else {
                                video.pause();
                                this.log(`Action: Pause video on ${this.getObjectName(target)}`);
                            }
                            videoFound = true;
                        }
                    });
                    if (!videoFound) {
                        this.log(`Action: No video texture found on ${this.getObjectName(target)}`);
                    }
                });
                break;

            case 7: // Show Hidden Node
            case 36: // Enable
                targets.forEach(target => {
                    this.log(`Action: Show/Enable object ${this.getObjectName(target)}`);
                    target.userData.desiredVisibility = true; // Update desired state
                    // Actual visibility will be updated in next update loop based on distance
                });
                break;

            case 8: // Open Web
                if (values.url) {
                    this.log(`Action: Open Web ${values.url}`);
                    // window.open(values.url, '_blank'); // Old way

                    // New way: Open in iframe overlay
                    if (this.iframeOverlay && this.webIframe) {
                        this.webIframe.src = values.url;
                        this.iframeOverlay.style.display = 'flex';
                    } else {
                        // Fallback if elements missing
                        window.open(values.url, '_blank');
                    }
                }
                break;

            case 9: // Hidden Node
            case 35: // Disable
                targets.forEach(target => {
                    this.log(`Action: Hide/Disable object ${this.getObjectName(target)}`);
                    target.userData.desiredVisibility = false; // Update desired state
                    target.visible = false; // Force hide immediately
                });
                break;

            case 10: // Animate Speed
                targets.forEach(target => {
                    const speed = values.animation_speed !== undefined ? values.animation_speed : 1;
                    if (target.userData.mixer) {
                        target.userData.mixer.timeScale = speed;
                        this.log(`Action: Set animation speed to ${speed} for ${this.getObjectName(target)}`);
                    }
                });
                break;

            case 11: // Animate Control (Range)
                targets.forEach(target => {
                    const startFrame = values.start_frame || 0;
                    const endFrame = values.end_frame || 100;
                    const fps = values.fps || 25;
                    const startTime = startFrame / fps;
                    const duration = (endFrame - startFrame) / fps;

                    if (target.userData.mixer) {
                        // Stop all existing actions
                        target.userData.mixer.stopAllAction();

                        // Play ALL clips found in userData.animations or fallback to mixer root
                        const clips = target.userData.animations || [];

                        if (clips.length > 0) {
                            clips.forEach(clip => {
                                const action = target.userData.mixer.clipAction(clip);
                                action.reset();
                                action.time = startTime;
                                action.timeScale = 1;
                                action.play();

                                // Schedule stop
                                setTimeout(() => {
                                    action.paused = true;
                                }, duration * 1000);
                            });
                            this.log(`Action: Play ${clips.length} animations frames ${startFrame}-${endFrame} (${duration}s) on ${this.getObjectName(target)}`);
                        } else {
                            // Fallback if no animations array (shouldn't happen with new createGLBObject)
                            this.log(`Action: No animations found on ${this.getObjectName(target)}`);
                        }
                    }
                });
                break;

            case 13: // Rotate By
                targets.forEach(target => {
                    const duration = values.time || 1.0;
                    const dx = THREE.MathUtils.degToRad(values.direction_x || 0);
                    const dy = THREE.MathUtils.degToRad(values.direction_y || 0);
                    const dz = THREE.MathUtils.degToRad(values.direction_z || 0);

                    const startRot = target.quaternion.clone();
                    const deltaRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(dx, dy, dz, 'XYZ'));
                    const endRot = startRot.clone().multiply(deltaRot);

                    this.log(`Action: Rotate object ${this.getObjectName(target)} by (${values.direction_x}, ${values.direction_y}, ${values.direction_z}) in ${duration}s`);

                    this.tweens.push({
                        start: 0,
                        end: 1,
                        duration: duration,
                        elapsed: 0,
                        onUpdate: (val) => {
                            target.quaternion.slerpQuaternions(startRot, endRot, val);
                        }
                    });
                });
                break;

            case 15: // Scale
                targets.forEach(target => {
                    const duration = values.time || 0.5;
                    const s = values.scale !== undefined ? values.scale : 1;

                    const startScale = target.scale.clone();
                    const endScale = startScale.clone().multiplyScalar(s); // Relative scale? Or absolute? 
                    // "Scale object 3 times" usually means multiply. "Scale to 3" means absolute.
                    // Given "Scale object 3 times" description, I assume multiply.
                    // But "scale: 3" parameter looks like absolute or factor. 
                    // Let's assume it's a target scale factor relative to *current* or *initial*?
                    // Usually "Scale to" is safer. But "Scale 3 times" implies * 3.
                    // Let's implement as "Multiply current scale by X".

                    this.log(`Action: Scale object ${this.getObjectName(target)} by ${s}x in ${duration}s`);

                    this.tweens.push({
                        start: 0,
                        end: 1,
                        duration: duration,
                        elapsed: 0,
                        onUpdate: (val) => {
                            target.scale.lerpVectors(startScale, endScale, val);
                        }
                    });
                });
                break;

            case 19: // Fade Opacity To
                targets.forEach(target => {
                    const endOpacity = values.transparency !== undefined ? values.transparency : 1;
                    const duration = values.time || 0.5;
                    this.log(`Action: Fade object ${this.getObjectName(target)} to ${endOpacity} in ${duration}s`);

                    // Get current opacity from first mesh child
                    let startOpacity = 1;
                    target.traverse(c => {
                        if (c.isMesh && c.material) startOpacity = c.material.opacity;
                    });

                    this.tweens.push({
                        start: startOpacity,
                        end: endOpacity,
                        duration: duration,
                        elapsed: 0,
                        onUpdate: (val) => this.setObjectOpacity(target, val)
                    });
                });
                break;

            default:
                this.log(`Action ${action.id} not implemented yet.`);
                break;
        }
    }
}
