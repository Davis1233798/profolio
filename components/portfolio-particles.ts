import * as THREE from 'three';
import type { ParticlePulse } from './portfolio-experience';

/** A mounted canvas owns one renderer and reuses its bounded GPU resources. */
export function createParticleController(canvas: HTMLCanvasElement): { play(pulse: ParticlePulse): void; dispose(): void } {
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' }); }
  catch { return { play() {}, dispose() {} }; }

  let width = Math.max(1, window.innerWidth), height = Math.max(1, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, width / height, .1, 2000);
  camera.position.z = 600;
  const count = width < 600 ? 260 : 520;
  const positions = new Float32Array(count * 3), vectors = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, vertexColors: true, blending: THREE.AdditiveBlending,
    uniforms: { opacity: { value: 0 }, ratio: { value: renderer.getPixelRatio() } },
    vertexShader: 'varying vec3 vColor; uniform float ratio; void main(){vColor=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=7.0*ratio*(600.0/-mv.z); gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'varying vec3 vColor; uniform float opacity; void main(){float d=length(gl_PointCoord-0.5)*2.0; float glow=pow(max(0.0,1.0-d),2.0); gl_FragColor=vec4(vColor,glow*opacity);}',
  });
  scene.add(new THREE.Points(geometry, material));
  let frame = 0, disposed = false, lost = false, generation = 0, active = false, started = 0;
  let originX = 0, originY = 0, maxSpread = 250;

  const cancelFrame = () => { if (frame) cancelAnimationFrame(frame); frame = 0; };
  const contextLost = (event: Event) => { event.preventDefault(); lost = true; generation++; cancelFrame(); active = false; geometry.dispose(); material.dispose(); renderer.dispose(); };
  canvas.addEventListener('webglcontextlost', contextLost);
  const draw = (now: number, token: number) => {
    if (disposed || token !== generation || document.hidden) { cancelFrame(); return; }
    const t = Math.min((now - started) / 900, 1), ease = 1 - (1 - t) ** 3;
    const spread = 18 + ease * maxSpread;
    for (let i = 0; i < count; i++) {
      const offset = i * 3, swirl = t * 2 + i * .015;
      positions[offset] = originX + vectors[offset] * spread + Math.sin(swirl) * 20 * t;
      positions[offset + 1] = originY + vectors[offset + 1] * spread + Math.cos(swirl) * 20 * t;
      positions[offset + 2] = vectors[offset + 2] * spread * .6;
    }
    geometry.attributes.position.needsUpdate = true;
    material.uniforms.opacity.value = Math.sin(Math.PI * Math.min(t * 1.3, 1)) * (1 - t * .55);
    renderer.render(scene, camera);
    if (t < 1) frame = requestAnimationFrame(next => draw(next, token));
    else { material.uniforms.opacity.value = 0; renderer.clear(); frame = 0; active = false; }
  };
  const resume = () => {
    if (disposed || !active || document.hidden || frame) return;
    frame = requestAnimationFrame(now => { frame = 0; draw(now, generation); });
  };
  const visibility = () => { if (document.hidden) cancelFrame(); else resume(); };
  document.addEventListener('visibilitychange', visibility);

  return {
    play(pulse) {
      if (disposed || lost) return;
      if (width !== window.innerWidth || height !== window.innerHeight) {
        width = Math.max(1, window.innerWidth); height = Math.max(1, window.innerHeight);
        renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
      }
      generation++;
      if (frame) cancelAnimationFrame(frame);
      frame = 0; active = true; started = performance.now();
      const scale = 2 * Math.tan(25 * Math.PI / 180) * 600 / height;
      originX = (pulse.x - width / 2) * scale;
      originY = (height / 2 - pulse.y) * scale;
      maxSpread = pulse.kind === 'language' ? 360 : 230;
      const lime = new THREE.Color('#b9fa65'), violet = new THREE.Color(pulse.kind === 'language' ? '#bc91ff' : '#63dfd0');
      for (let i = 0; i < count; i++) {
        const angle = i * 2.399963, z = 1 - 2 * (i + .5) / count, radius = Math.sqrt(1 - z * z), offset = i * 3;
        vectors[offset] = Math.cos(angle) * radius; vectors[offset + 1] = Math.sin(angle) * radius; vectors[offset + 2] = z;
        const mix = (z + 1) / 2;
        colors[offset] = lime.r + (violet.r - lime.r) * mix;
        colors[offset + 1] = lime.g + (violet.g - lime.g) * mix;
        colors[offset + 2] = lime.b + (violet.b - lime.b) * mix;
      }
      geometry.attributes.color.needsUpdate = true;
      resume();
    },
    dispose() {
      if (disposed) return;
      disposed = true; generation++; cancelFrame();
      document.removeEventListener('visibilitychange', visibility);
      canvas.removeEventListener('webglcontextlost', contextLost);
      geometry.dispose(); material.dispose(); renderer.dispose();
    },
  };
}
