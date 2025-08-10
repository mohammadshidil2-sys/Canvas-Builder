// app.js - 3D builder game (Three.js) - mobile-friendly
(() => {
  const GRID_SIZE = 1.0;
  const GRID_EXTENT = 50;
  const GROUND_Y = 0;

  const canvas = document.getElementById('three-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  // clamp DPR for mobile performance
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x88aaff, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 2000);
  camera.position.set(10, 12, 10);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.minDistance = 5;
  controls.maxDistance = 100;
  controls.maxPolarAngle = Math.PI * 0.495;

  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(5, 10, 7);
  scene.add(dir);
  scene.add(new THREE.AmbientLight(0x404040, 0.8));

  const grid = new THREE.GridHelper(GRID_EXTENT * 2, GRID_EXTENT * 2, 0x666666, 0x333333);
  grid.position.y = GROUND_Y - 0.001;
  scene.add(grid);

  const groundMat = new THREE.MeshBasicMaterial({ color: 0x226644 });
  const groundGeom = new THREE.PlaneGeometry(GRID_EXTENT*2, GRID_EXTENT*2);
  const ground = new THREE.Mesh(groundGeom, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_Y - 0.002;
  scene.add(ground);

  function createHouseMesh() {
    const boxGeo = new THREE.BoxGeometry(1.0, 1.0, 1.0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffaa66 });
    const box = new THREE.Mesh(boxGeo, mat);
    const roofGeo = new THREE.ConeGeometry(0.8, 0.6, 4);
    const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color: 0x884422 }));
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 0.8;
    const group = new THREE.Group();
    group.add(box);
    group.add(roof);
    return group;
  }

  function createTowerMesh() {
    const g = new THREE.CylinderGeometry(0.4, 0.5, 2.0, 12);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8899ff });
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.y = 1.0;
    return mesh;
  }

  function createWallMesh() {
    const g = new THREE.BoxGeometry(1.0, 0.6, 0.2);
    const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc });
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.y = 0.3;
    return mesh;
  }

  const prefabs = {
    house: { make: createHouseMesh, snap: new THREE.Vector3(1,1,1) },
    tower: { make: createTowerMesh, snap: new THREE.Vector3(1,2,1) },
    wall:  { make: createWallMesh, snap: new THREE.Vector3(1,1,0.25) }
  };

  const entities = [];
  let nextId = 1;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  let currentPrefab = 'house';
  let ghost = null;
  let ghostRotation = 0;
  let selectedEntity = null;

  function makeGhost(prefabName) {
    if (ghost) { scene.remove(ghost); ghost = null; }
    const p = prefabs[prefabName];
    ghost = p.make();
    ghost.traverse(n=>{ if(n.material){ n.material = n.material.clone(); n.material.opacity = 0.6; n.material.transparent = true; }});
    scene.add(ghost);
  }

  makeGhost(currentPrefab);

  function worldToCell(worldX, worldZ) {
    const cx = Math.round(worldX / GRID_SIZE);
    const cz = Math.round(worldZ / GRID_SIZE);
    return { cx, cz };
  }
  function cellToWorld(cx, cz) {
    return { x: cx * GRID_SIZE, z: cz * GRID_SIZE };
  }

  document.querySelectorAll('.prefab').forEach(btn=>{
    btn.addEventListener('click', ()=> {
      currentPrefab = btn.dataset.prefab;
      makeGhost(currentPrefab);
    });
  });

  document.getElementById('rotateLeft').addEventListener('click', ()=> { ghostRotation -= Math.PI/2; });
  document.getElementById('rotateRight').addEventListener('click', ()=> { ghostRotation += Math.PI/2; });
  document.getElementById('deleteSelected').addEventListener('click', ()=> {
    if(selectedEntity) { removeEntityById(selectedEntity.id); selectedEntity = null; }
  });
  document.getElementById('undoBtn').addEventListener('click', ()=> {
    const e = entities.pop();
    if(e) { scene.remove(e.mesh); }
  });
  document.getElementById('saveBtn').addEventListener('click', ()=> {
    saveToLocal();
    alert('Saved to localStorage');
  });
  document.getElementById('downloadBtn').addEventListener('click', ()=> { downloadJSON(); });
  document.getElementById('loadBtn').addEventListener('click', ()=> { document.getElementById('fileInput').click(); });
  document.getElementById('fileInput').addEventListener('change', (ev)=>{
    const f = ev.target.files[0];
    if(!f) return;
    const r = new FileReader();
    r.onload = function() {
      try { loadFromJSON(JSON.parse(r.result)); } catch(e) { alert('Invalid JSON'); }
    };
    r.readAsText(f);
  });

  const meshes = ()=>entities.map(e=>e.mesh);

  function updatePointerFromEvent(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    let clientX, clientY;
    if (event.touches && event.touches[0]) { clientX = event.touches[0].clientX; clientY = event.touches[0].clientY; }
    else { clientX = event.clientX; clientY = event.clientY; }
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  function placeOrSelectFromPointer() {
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(meshes(), true);
    if(hits.length>0) {
      const hit = hits[0];
      const ent = entities.find(e=>e.mesh===hit.object || hit.object.parent===e.mesh);
      if(ent) { selectedEntity = ent; highlightEntity(ent); return; }
    }
    const groundHits = raycaster.intersectObject(ground, true);
    if(groundHits.length>0) {
      const p = groundHits[0].point;
      const {cx, cz} = worldToCell(p.x, p.z);
      const w = cellToWorld(cx, cz);
      if(ghost) { ghost.position.set(w.x, GROUND_Y, w.z); ghost.rotation.y = ghostRotation; }
      const mesh = prefabs[currentPrefab].make();
      mesh.position.set(w.x, GROUND_Y, w.z);
      mesh.rotation.y = ghostRotation;
      scene.add(mesh);
      const ent = { id: nextId++, prefab: currentPrefab, mesh, cx, cz, rotY: ghostRotation };
      entities.push(ent);
      selectedEntity = ent;
      saveToLocal();
    }
  }

  function highlightEntity(ent) {
    entities.forEach(e=>e.mesh.traverse(n=>{ if(n.material){ if(n.material.emissive) n.material.emissive.setHex(0x000000); } }));
    if(ent && ent.mesh) {
      ent.mesh.traverse(n=>{ if(n.material) { if(n.material.emissive) n.material.emissive.setHex(0x333333); }});
      ent.mesh.scale.set(1.02,1.02,1.02);
    }
  }

  function removeEntityById(id) {
    const idx = entities.findIndex(e=>e.id===id);
    if(idx>=0) { scene.remove(entities[idx].mesh); entities.splice(idx,1); saveToLocal(); }
  }

  function buildSaveObject() {
    return { entities: entities.map(e=>({ id: e.id, prefab: e.prefab, cx: e.cx, cz: e.cz, rotY: e.rotY })) };
  }
  function saveToLocal() { localStorage.setItem('canvas_builder_save', JSON.stringify(buildSaveObject())); }
  function loadFromLocal() { const s = localStorage.getItem('canvas_builder_save'); if(s) loadFromJSON(JSON.parse(s)); }
  function downloadJSON() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(buildSaveObject(), null, 2));
    const a = document.createElement('a'); a.href = dataStr; a.download = 'city.json'; document.body.appendChild(a); a.click(); a.remove();
  }
  function loadFromJSON(obj) {
    entities.forEach(e=>scene.remove(e.mesh));
    entities.length = 0;
    nextId = 1;
    if(!obj || !Array.isArray(obj.entities)) return;
    obj.entities.forEach(it=>{
      const mesh = prefabs[it.prefab].make();
      const pos = cellToWorld(it.cx, it.cz);
      mesh.position.set(pos.x, GROUND_Y, pos.z);
      mesh.rotation.y = it.rotY || 0;
      scene.add(mesh);
      entities.push({ id: it.id || nextId++, prefab: it.prefab, mesh, cx: it.cx, cz: it.cz, rotY: it.rotY || 0 });
      nextId = Math.max(nextId, (it.id||0)+1);
    });
    saveToLocal();
  }

  let pointerDown = false;
  renderer.domElement.addEventListener('pointerdown', (ev) => { pointerDown = true; updatePointerFromEvent(ev); });
  renderer.domElement.addEventListener('pointerup', (ev) => { updatePointerFromEvent(ev); if(pointerDown) placeOrSelectFromPointer(); pointerDown = false; });
  // keep last pointer for ghost update
  window.addEventListener('pointermove', (ev)=> { updatePointerFromEvent(ev); });

  window.addEventListener('keydown', (ev) => {
    if(ev.key === 'q') ghostRotation -= Math.PI/2;
    if(ev.key === 'e') ghostRotation += Math.PI/2;
    if(ev.key === 'Delete' || ev.key === 'Backspace') { if(selectedEntity) removeEntityById(selectedEntity.id); }
    if(ev.key === 's' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); saveToLocal(); alert('Saved'); }
  });

  window.addEventListener('resize', onWindowResize);
  function onWindowResize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }

  loadFromLocal();

  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    try {
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(ground, true);
      if(hits.length>0 && ghost) {
        const p = hits[0].point;
        const {cx, cz} = worldToCell(p.x, p.z);
        const w = cellToWorld(cx, cz);
        ghost.position.set(w.x, GROUND_Y, w.z);
        ghost.rotation.y = ghostRotation;
      }
    } catch(e){}
    controls.update();
    renderer.render(scene, camera);
  }
  animate();
})();
