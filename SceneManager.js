import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
        objectList.forEach(objData => {
            const type = objData.model?.type;
            const id = objData.id || 'unknown';

            if (type === 5) {
                // Type 5: Image Plane
                if (objData.model?.texture?.url) {
                    this.createImageObject(objData);
                } else {
                    this.log(`Object ${id} (Type 5) missing texture URL`);
                }
            } else if (type === 8) {
                // Type 8: GLB Model
                // Check ios_texture or android_texture for URL
                const url = objData.model?.android_texture?.url || objData.model?.ios_texture?.url;
                if (url) {
                    this.createGLBObject(objData, url);
                } else {
                    this.log(`Object ${id} (Type 8) missing GLB URL`);
                }
            } else {
                this.log(`Skipping object ${id}: Unknown type ${type} or invalid structure`);
                console.warn('Skipped object data:', objData);
            }
        });
        this.log(`Processed ${objectList.length} items. Active objects: ${this.objects.length}`);
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
            },
            undefined,
            (err) => {
                this.log(`Error loading image for ${data.id}: ${err}`);
            }
        );
    }

    createGLBObject(data, url) {
        this.gltfLoader.load(
            url,
            (gltf) => {
                const model = gltf.scene;

                // Apply scaling from fields if needed, but usually zoom handles it.
                // Some GLBs might need normalization. For now, just add it.

                this.setupObject(model, data);

                // Handle animations if present
                if (gltf.animations && gltf.animations.length > 0) {
                    const mixer = new THREE.AnimationMixer(model);
                    gltf.animations.forEach((clip) => {
                        mixer.clipAction(clip).play();
                    });
                    model.userData.mixer = mixer;
                }

                this.log(`Created GLB Object ${data.id}`);
            },
            undefined,
            (err) => {
                this.log(`Error loading GLB for ${data.id}: ${err}`);
            }
        );
    }

    setupObject(mesh, data) {
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

        // Metadata
        mesh.userData = {
            id: data.id,
            face_me: data.model.fields?.face_me || false,
            // Store original rotation for face_me calculation if needed
        };

        this.worldRoot.add(mesh);
        this.objects.push(mesh);
    }

    update(delta) {
        this.objects.forEach(obj => {
            // Face Me Logic
            if (obj.userData.face_me) {
                obj.lookAt(this.camera.position);
            }

            // Animation Mixer Update
            if (obj.userData.mixer) {
                obj.userData.mixer.update(delta);
            }
        });
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
            let target = intersects[0].object;
            while (target.parent && target.parent !== this.worldRoot) {
                target = target.parent;
            }
            return target; // This should be the object in this.objects
        }
        return null;
    }
}
