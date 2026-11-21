import {
  ACESFilmicToneMapping, AnimationMixer, Box3, DirectionalLight, GLTFLoader,
  Group, HemisphereLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer,
} from './vendor/three-avatar.mjs';

function release(figure) {
  const resources = new Set();
  figure.traverse(node => {
    if (!node.isMesh) return;
    resources.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      resources.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) resources.add(value);
      }
    }
  });
  for (const resource of resources) resource.dispose();
}

// The photo remains in the DOM while the optional GLB loads or if WebGL fails.
export async function mountAvatar(frame, path, signal) {
  const url = new URL(path, import.meta.url);
  const response = await fetch(url, { signal });
  if (!response.ok) throw Error('Could not load avatar');
  const { scene: figure, animations } = await new GLTFLoader().parseAsync(
    await response.arrayBuffer(), new URL('.', url).href,
  );
  if (signal.aborted) {
    release(figure);
    return null;
  }

  let renderer;
  try {
    renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch (error) {
    release(figure);
    throw error;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.toneMapping = ACESFilmicToneMapping;

  const scene = new Scene();
  const rig = new Group();
  rig.add(figure);
  scene.add(rig);
  const bounds = new Box3().setFromObject(figure);
  if (bounds.isEmpty()) {
    renderer.dispose();
    renderer.forceContextLoss();
    release(figure);
    return null;
  }
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  rig.position.copy(center).negate();
  scene.add(new HemisphereLight(0xfff6e6, 0x8aa39a, 2.0));
  const key = new DirectionalLight(0xffead4, 2.4);
  key.position.set(-3, 5, 5);
  scene.add(key);
  const fill = new DirectionalLight(0xc7e6df, 1.5);
  fill.position.set(4, 1, -4);
  scene.add(fill);

  const canvas = renderer.domElement;
  const camera = new PerspectiveCamera(34);
  const mixer = new AnimationMixer(figure);
  const idle = animations.find(clip => /^idle$/i.test(clip.name));
  const talk = animations.find(clip => /^(speaking|talk)$/i.test(clip.name));
  const idleAction = idle ? mixer.clipAction(idle) : null;
  const talkAction = talk ? mixer.clipAction(talk) : null;
  const mouthShapes = [];
  if (!talkAction) {
    figure.traverse(node => {
      const shapes = node.morphTargetDictionary;
      if (!shapes) return;
      const index = shapes.jawOpen ?? shapes.mouthOpen ?? shapes.viseme_aa;
      if (index !== undefined) mouthShapes.push({ node, index });
    });
  }
  const animatedJaw = !talkAction && !mouthShapes.length ? figure.getObjectByName('Jaw') : null;
  const jawRest = animatedJaw?.position.y ?? 0;
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  let disposed = false;
  let speaking = false;
  let lastAccent = -1000;
  let lastFrame = 0;
  let repaint = 0;

  function draw() {
    if (!disposed && !document.hidden) renderer.render(scene, camera);
  }

  function resize() {
    const width = frame.clientWidth;
    const height = frame.clientHeight;
    if (!width || !height || disposed) return;
    camera.aspect = width / height;
    const at = Math.PI * camera.fov / 360;
    const distance = Math.max(size.y, size.x / camera.aspect) * .57 / Math.tan(at) + size.z / 2;
    camera.position.set(0, size.y * .015, distance);
    camera.near = Math.max(.001, distance / 1000);
    camera.far = distance * 8;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    draw();
  }

  function animate(now) {
    repaint = 0;
    if (disposed || document.hidden) return;
    mixer.update(lastFrame ? Math.min(.05, (now - lastFrame) / 1000) : 0);
    lastFrame = now;
    if (speaking && !talkAction) {
      const beat = (Math.sin(now / 53) + Math.sin(now / 97) + 2) / 4;
      const accent = Math.max(0, 1 - (now - lastAccent) / 135);
      const openness = Math.min(1, beat * .53 + accent * .46);
      for (const { node, index } of mouthShapes) node.morphTargetInfluences[index] = openness;
      if (animatedJaw) animatedJaw.position.y = jawRest - openness * size.y * .025;
    }
    draw();
    schedule();
  }

  function schedule() {
    if (disposed || document.hidden || repaint) return;
    if (speaking || (idleAction && !motionPreference.matches)) repaint = requestAnimationFrame(animate);
  }

  function setSpeaking(active) {
    if (disposed || speaking === active) return;
    speaking = active;
    if (active) {
      if (talkAction) {
        idleAction?.stop();
        talkAction.reset().play();
      }
    } else {
      talkAction?.stop();
      for (const { node, index } of mouthShapes) node.morphTargetInfluences[index] = 0;
      if (animatedJaw) animatedJaw.position.y = jawRest;
      if (idleAction && !motionPreference.matches) idleAction.reset().play();
      mixer.update(0);
      draw();
    }
    schedule();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    cancelAnimationFrame(repaint);
    document.removeEventListener('visibilitychange', visible);
    motionPreference.removeEventListener('change', motionChanged);
    signal.removeEventListener('abort', dispose);
    canvas.removeEventListener('webglcontextlost', dispose);
    canvas.remove();
    frame.classList.remove('has-model');
    mixer.stopAllAction();
    release(figure);
    renderer.dispose();
    renderer.forceContextLoss();
  }

  function visible() {
    lastFrame = 0;
    if (!document.hidden) {
      draw();
      schedule();
    }
  }

  function motionChanged() {
    if (!speaking) {
      if (motionPreference.matches) idleAction?.stop();
      else idleAction?.play();
      draw();
      schedule();
    }
  }

  const observer = new ResizeObserver(resize);
  try {
    canvas.setAttribute('aria-hidden', 'true');
    frame.append(canvas);
    if (!motionPreference.matches) idleAction?.play();
    resize();
    frame.classList.add('has-model');
    observer.observe(frame);
    document.addEventListener('visibilitychange', visible);
    motionPreference.addEventListener('change', motionChanged);
    signal.addEventListener('abort', dispose, { once: true });
    canvas.addEventListener('webglcontextlost', dispose, { once: true });
    schedule();
    return { setSpeaking, accent: () => { lastAccent = performance.now(); }, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
