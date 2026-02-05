# WebXR Hit-Test 定位模式遷移指南

本文件旨在指導如何將現有的 **WebXR Image Tracking** 專案，轉換為相容性更高的 **Hit-Test (瞄準點擊)** 定位模式。此方案可解決部分 Android 設備因 `WebXR Incubations` 旗標未開啟導致無法使用的問題。

## 1. 核心概念差異

| 特性 | Image Tracking (現有) | Hit-Test (新方案) |
| :--- | :--- | :--- |
| **定位方式** | 攝影機辨識海報特徵圖，自動鎖定 | 使用者手動操作「瞄準圈」，對準海報點擊定位 |
| **使用者操作** | 無需操作，看海報即可 | 需上下左右移動手機掃描平面，並點擊確認 |
| **相容性** | 低 (需 ARCore + Image Tracking Feature) | **極高** (所有支援 AR 的 Android 手機皆可) |
| **精確度** | 自動對齊海報中心，非常精準 | 依賴使用者點擊的位置，可能有人為誤差 |
| **互動感** | 魔法感強 (自動出現) |儀式感強 (放置確認) |

---

## 2. 實作步驟詳解

### 步驟一：修改 Session 請求參數 (main.js)

移除 `image-tracking` 需求，改為請求 `hit-test`。這能確保所有手機都能成功啟動 AR。

```javascript
/* main.js - onARButtonClick */

const sessionInit = {
  // 核心改變：只要求最基本的 AR 功能
  requiredFeatures: ['local', 'hit-test'], 
  optionalFeatures: ['dom-overlay', 'camera-access'], // 相機與 UI 為可選
  domOverlay: { root: document.body }
};

// 不再需要 trackedImages 設定
// sessionInit.trackedImages = [...]; // 移除這段

const session = await navigator.xr.requestSession('immersive-ar', sessionInit);
```

### 步驟二：建立瞄準圈 (Reticle)

在 `init()` 階段，我們需要創建一個視覺化的「準心」，讓使用者知道 AR 偵測到了哪裡。

```javascript
/* main.js - init() */

let reticle;

function initReticle() {
  // 建立一個簡單的圓環
  const ringGeometry = new THREE.RingGeometry(0.1, 0.11, 32).rotateX(-Math.PI / 2);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  reticle = new THREE.Mesh(ringGeometry, ringMaterial);
  
  // 預設隱藏，直到偵測到平面
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);
}
```

### 步驟三：在 Render Loop 中進行 Hit-Test

這是在每一幀 (Frame) 中執行的邏輯。程式會不斷從螢幕中心發射射線，偵測是否有平面。

```javascript
/* main.js - render() */

let hitTestSource = null;
let hitTestSourceRequested = false;

function render(timestamp, frame) {
  // ... 其他原本的邏輯 ...

  if (frame) {
    const session = renderer.xr.getSession();
    
    // 1. 初始化 Hit Test Source (只做一次)
    if (hitTestSourceRequested === false) {
      session.requestReferenceSpace('viewer').then((referenceSpace) => {
        session.requestHitTestSource({ space: referenceSpace }).then((source) => {
          hitTestSource = source;
        });
      });
      session.requestHitTestSourceForTransientInput({ profile: 'generic-touchscreen' }).then((source) => {
        // 觸控 Hit Test (可選)
      });
      hitTestSourceRequested = true;
    }

    // 2. 執行 Hit Test
    if (hitTestSource) {
      const hitTestResults = frame.getHitTestResults(hitTestSource);

      if (hitTestResults.length > 0) {
        // 偵測到平面！
        const hit = hitTestResults[0];
        const referenceSpace = renderer.xr.getReferenceSpace();
        const pose = hit.getPose(referenceSpace);

        // 讓瞄準圈吸附在平面上
        reticle.visible = true;
        reticle.matrix.fromArray(pose.transform.matrix);
      } else {
        // 沒偵測到平面 (例如對著天空或純色牆壁)
        reticle.visible = false;
      }
    }
  }
}
```

### 步驟四：處理點擊鎖定 (OnSelect)

當使用者看見瞄準圈貼在海報上並點擊螢幕時，這就是「確認放置」的時刻。

```javascript
/* main.js - onSelect() */

function onSelect() {
  if (reticle.visible) {
    // 1. 取得瞄準圈當下的位置與旋轉
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    position.setFromMatrixPosition(reticle.matrix);
    quaternion.setFromRotationMatrix(reticle.matrix);

    // 2. 將整個場景根節點 (worldRoot) 移過去
    sceneManager.worldRoot.position.copy(position);
    sceneManager.worldRoot.quaternion.copy(quaternion);

    // 3. 關鍵校正：垂直對齊
    // Hit-Test 的 Y 軸通常是平面的法向量 (垂直於牆面)。
    // 但 Z 軸的旋轉可能是隨機的。我們通常希望物體「垂直朝上」。
    // 這裡可能需要根據海報是「貼在牆上」還是「鋪在地上」做不同的旋轉補償。
    
    // 針對垂直海報 (Wall Mode)：
    // 預設 Reticle 貼在牆上時，Z 軸是指向法線 (遠離牆面)。
    // 我們可能需要將內容轉 90 度或是對齊重力。
    // sceneManager.worldRoot.rotateX(-Math.PI / 2); // 視模型座標系而定

    // 4. 鎖定並開始體驗
    reticle.visible = false; // 隱藏準心
    hitTestSource = null;    // 停止偵測以節省效能
    
    // 顯示 UI，開始動畫
    setARUIVisible(true); 
    console.log("AR Scene Placed!");
  }
}
```

---

## 3. UX 流程設計

為了讓使用者順利完成定位，不僅是代碼，UI 提示也需要修改：

1.  **初始提示**：「請左右緩慢移動手機，掃描海報所在的牆面」。
2.  **偵測到平面後**：「看見白圈了嗎？請將白圈對準 **海報正中央**」。
    *   *建議在海報上印一個明顯的「AR定位點」圖示，讓使用者知道要瞄準哪裡。*
3.  **鎖定後**：「點擊螢幕放置場景」。

## 4. 進階技巧：固定距離放置

如果不希望使用者太靠近牆壁，可以在 `onSelect` 邏輯中加入距離判斷，或是強制將物體生成在距離牆面 10cm 的位置，避免模型穿模到牆壁裡。

```javascript
// 將物體沿著法線方向推出 10cm
sceneManager.worldRoot.translateZ(0.1); 
```

這份指南涵蓋了遷移到 Hit-Test 模式所需的所有關鍵技術點。
