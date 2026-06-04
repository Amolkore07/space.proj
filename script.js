import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const W = 512, H = 256;

function hash2D(x, y) {
    let h = x * 374761393 + y * 668265263;
    h = ((h ^ (h >> 13)) * 1274126177) & 0x7fffffff;
    return h / 0x7fffffff;
}

function smoothNoise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const v00 = hash2D(ix, iy), v10 = hash2D(ix + 1, iy);
    const v01 = hash2D(ix, iy + 1), v11 = hash2D(ix + 1, iy + 1);
    return v00 * (1 - sx) * (1 - sy) + v10 * sx * (1 - sy) + v01 * (1 - sx) * sy + v11 * sx * sy;
}

function fbm(x, y, oct = 4) {
    let v = 0, a = 1, f = 1, m = 0;
    for (let i = 0; i < oct; i++) { v += a * smoothNoise(x * f, y * f); m += a; a *= 0.5; f *= 2; }
    return v / m;
}

function fbmWarp(x, y, oct = 4, w = 2) {
    const q = fbm(x, y, 3);
    return fbm(x + w * q, y + w * q, oct);
}

function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }

function lerp(a, b, t) { return a + (b - a) * t; }

function makeTexture(colorFn) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const d = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const u = x / W, v = y / H;
            const col = colorFn(u, v, x, y);
            const i = (y * W + x) * 4;
            d.data[i] = clamp(col.r, 0, 255);
            d.data[i + 1] = clamp(col.g, 0, 255);
            d.data[i + 2] = clamp(col.b, 0, 255);
            d.data[i + 3] = 255;
        }
    }
    ctx.putImageData(d, 0, 0);
    return c;
}

function texFromFn(fn) {
    return new THREE.CanvasTexture(makeTexture(fn));
}

const nScale = 4;

// === MERCURY ===
function mercuryColor(u, v) {
    const n = fbm(u * nScale * 2, v * nScale * 2, 5);
    const c1 = fbm(u * nScale * 4 + 10, v * nScale * 4 + 10, 3);
    const crater = Math.pow(Math.abs(smoothNoise(u * 30, v * 30)), 1.5) > 0.92 ? 0.6 : 0;
    const base = 90 + 60 * n + 20 * c1;
    const dark = base * (1 - crater * 0.5);
    return { r: dark + 10, g: dark, b: dark - 10 };
}

// === VENUS ===
function venusColor(u, v) {
    const sw = fbmWarp(u * 3, v * 3, 5, 2.5);
    const sw2 = fbmWarp(u * 5 + 5, v * 5 + 5, 4, 1.5);
    const band = Math.sin(v * 12 + sw * 3) * 0.5 + 0.5;
    const r = 170 + 50 * sw + 30 * band;
    const g = 140 + 40 * sw2 + 25 * band;
    const b = 70 + 30 * sw + 20 * band;
    return { r, g: g * 0.9, b: b * 0.7 };
}

// === EARTH ===
function earthColor(u, v) {
    const lat = v;
    const isPole = lat < 0.1 || lat > 0.9;
    const n = fbm(u * 3, v * 3, 6);
    const n2 = fbm(u * 6 + 100, v * 6 + 100, 4);
    const n3 = fbm(u * 12 + 200, v * 12 + 200, 3);
    const landThreshold = 0.48 + 0.05 * Math.sin(u * Math.PI * 2);
    if (isPole && lat < 0.08) {
        const blend = lat / 0.08;
        const ice = 230 + 20 * n2;
        return { r: lerp(ice, 200, blend), g: lerp(ice, 210, blend), b: lerp(ice, 220, blend) };
    }
    if (isPole && lat > 0.92) {
        const blend = (1 - lat) / 0.08;
        const ice = 230 + 20 * n2;
        return { r: lerp(ice, 200, blend), g: lerp(ice, 210, blend), b: lerp(ice, 220, blend) };
    }
    if (n > landThreshold) {
        const elev = (n - landThreshold) / (1 - landThreshold);
        if (elev < 0.3) {
            const t = elev / 0.3;
            return { r: lerp(100, 140, t), g: lerp(140, 160, t), b: lerp(50, 70, t) };
        } else if (elev < 0.6) {
            const t = (elev - 0.3) / 0.3;
            return { r: lerp(140, 120, t), g: lerp(160, 130, t), b: lerp(70, 60, t) };
        } else {
            const t = (elev - 0.6) / 0.4;
            return { r: lerp(120, 160, t), g: lerp(130, 150, t), b: lerp(60, 80, t) };
        }
    } else {
        const depth = n / landThreshold;
        if (depth < 0.3) {
            const t = depth / 0.3;
            return { r: lerp(10, 30, t), g: lerp(40, 80, t), b: lerp(120, 150, t) };
        } else if (depth < 0.7) {
            return { r: 30, g: 80, b: 150 };
        } else {
            const t = (depth - 0.7) / 0.3;
            return { r: lerp(30, 60, t), g: lerp(80, 120, t), b: lerp(150, 180, t) };
        }
    }
}

function cloudColor(u, v) {
    const n = fbm(u * 5, v * 5, 5);
    const wisp = fbm(u * 8 + 50, v * 8 + 50, 3);
    const bright = 240 + 15 * wisp;
    return { r: bright, g: bright, b: bright };
}

function earthCloudTexture() {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const d = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const u = x / W, v = y / H;
            const n = fbm(u * 5, v * 5, 5);
            const wisp = fbm(u * 8 + 50, v * 8 + 50, 3);
            const i = (y * W + x) * 4;
            const alpha = n > 0.52 ? clamp((n - 0.52) * 300, 60, 220) : 0;
            d.data[i] = 240;
            d.data[i + 1] = 240;
            d.data[i + 2] = 240;
            d.data[i + 3] = alpha;
        }
    }
    ctx.putImageData(d, 0, 0);
    return c;
}

// === MARS ===
function marsColor(u, v) {
    const n = fbm(u * 4, v * 4, 5);
    const n2 = fbm(u * 8 + 50, v * 8 + 50, 4);
    const crater = Math.pow(Math.abs(smoothNoise(u * 25 + 5, v * 25 + 5)), 2) > 0.94 ? 0.4 : 0;
    const lat = v;
    const ice = (lat < 0.08 || lat > 0.92) ? 1 - Math.min(Math.abs(lat - 0.5) * 10, 1) : 0;
    if (ice > 0) {
        const blend = ice;
        const iceCol = 200 + 40 * n;
        return { r: lerp(180, iceCol, blend), g: lerp(100, iceCol, blend), b: lerp(60, iceCol, blend) };
    }
    const r = 170 + 50 * n + 20 * n2 - crater * 100;
    const g = 80 + 40 * n + 10 * n2 - crater * 60;
    const b = 40 + 20 * n + 10 * n2 - crater * 30;
    return { r, g, b };
}

// === JUPITER ===
function jupiterColor(u, v) {
    const warp = fbmWarp(u * 2.5, v * 2.5, 4, 1.8);
    const turb = fbm(u * 8 + 100, v * 8 + 100, 3) * 0.15;
    const bandPos = v * 20 + warp * 0.8 + turb;
    const band = Math.sin(bandPos * Math.PI * 2) * 0.5 + 0.5;
    const band2 = Math.sin(v * 30 + warp * 0.5) * 0.5 + 0.5;
    const band3 = Math.sin(v * 12 + warp * 0.3) * 0.5 + 0.5;
    let r, g, b;
    const zone = Math.floor(bandPos * 5) % 5;
    if (zone === 0 || zone === 2) {
        r = 200 + 40 * band2; g = 150 + 40 * band2; b = 80 + 30 * band2;
    } else if (zone === 1 || zone === 3) {
        r = 160 + 40 * band3; g = 120 + 30 * band3; b = 60 + 20 * band3;
    } else {
        r = 220 + 30 * band; g = 200 + 30 * band; b = 160 + 30 * band;
    }
    const gx = (u - 0.5);
    const gy = (v - 0.65);
    const spotDist = Math.sqrt(gx * gx * 2 + gy * gy * 1);
    if (spotDist < 0.12) {
        const t = 1 - spotDist / 0.12;
        const sr = 200, sg = 120, sb = 80;
        r = lerp(r, sr, t * 0.8);
        g = lerp(g, sg, t * 0.8);
        b = lerp(b, sb, t * 0.8);
    }
    return { r, g, b };
}

// === SATURN ===
function saturnColor(u, v) {
    const warp = fbmWarp(u * 2, v * 4, 4, 1.5);
    const band = Math.sin(v * 24 + warp * 0.8) * 0.5 + 0.5;
    const band2 = Math.sin(v * 16 + warp * 0.4) * 0.5 + 0.5;
    const r = 210 + 30 * band + 10 * band2;
    const g = 185 + 30 * band + 10 * band2;
    const b = 130 + 30 * band + 10 * band2;
    return { r, g: g * 0.95, b: b * 0.85 };
}

// === URANUS ===
function uranusColor(u, v) {
    const n = fbm(u * 3, v * 3, 3);
    const band = Math.sin(v * 16 + n * 0.3) * 0.5 + 0.5;
    const r = 150 + 20 * band + 10 * n;
    const g = 210 + 15 * band + 10 * n;
    const b = 210 + 15 * band + 10 * n;
    return { r: r * 0.8, g: g * 0.9, b };
}

// === NEPTUNE ===
function neptuneColor(u, v) {
    const n = fbm(u * 4, v * 4, 4);
    const warp = fbmWarp(u * 3, v * 4, 3, 1.2);
    const band = Math.sin(v * 20 + warp * 0.5) * 0.5 + 0.5;
    const r = 30 + 20 * band + 15 * n;
    const g = 50 + 30 * band + 20 * n;
    const b = 150 + 50 * band + 30 * n;
    return { r: r * 0.7, g: g * 0.8, b };
}

// === SUN TEXTURE ===
function sunColor(u, v) {
    const n = fbm(u * 6, v * 6, 5);
    const n2 = fbm(u * 12 + 100, v * 12 + 100, 3);
    const bright = 0.8 + 0.4 * n + 0.2 * n2;
    const r = 255;
    const g = clamp(200 * bright, 100, 230);
    const b = clamp(60 * bright, 20, 100);
    return { r, g, b };
}

// === SATURN RING TEXTURE ===
function ringTexture() {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 128;
    const ctx = c.getContext('2d');
    const d = ctx.createImageData(1024, 128);
    for (let y = 0; y < 128; y++) {
        for (let x = 0; x < 1024; x++) {
            const u = x / 1024;
            const v = y / 128;
            const r = u;
            const gap = (r > 0.45 && r < 0.5) || (r > 0.75 && r < 0.78);
            if (gap) {
                const i = (y * 1024 + x) * 4;
                d.data[i] = 0; d.data[i + 1] = 0; d.data[i + 2] = 0; d.data[i + 3] = 0;
                continue;
            }
            const noise = fbm(u * 20 + 50, v * 8 + 50, 3);
            const density = Math.sin(u * 60) * 0.5 + 0.5;
            const trans = clamp(100 + 100 * density * (1 - Math.abs(v - 0.5) * 2), 0, 255);
            const br = clamp(160 + 60 * noise + 40 * (1 - Math.abs(v - 0.5)), 0, 255);
            const gr = clamp(140 + 50 * noise + 30 * (1 - Math.abs(v - 0.5)), 0, 255);
            const bl = clamp(100 + 40 * noise + 20 * (1 - Math.abs(v - 0.5)), 0, 255);
            const i = (y * 1024 + x) * 4;
            d.data[i] = br; d.data[i + 1] = gr; d.data[i + 2] = bl; d.data[i + 3] = trans;
        }
    }
    ctx.putImageData(d, 0, 0);
    return c;
}

// === SUN GLOW TEXTURE ===
function glowTexture() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,200,80,1)');
    g.addColorStop(0.1, 'rgba(255,180,50,0.8)');
    g.addColorStop(0.3, 'rgba(255,150,30,0.3)');
    g.addColorStop(0.6, 'rgba(255,100,0,0.1)');
    g.addColorStop(1, 'rgba(255,50,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    return c;
}

// === SCENE SETUP ===
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(35, 25, 45);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.5;
document.body.appendChild(renderer.domElement);

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.6, 0.3, 0.15
);
bloomPass.threshold = 0.1;
composer.addPass(bloomPass);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 3;
controls.maxDistance = 200;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.3;
controls.target.set(0, 0, 0);
controls.update();

// === LIGHTING ===
const ambientLight = new THREE.AmbientLight(0x6688aa, 0.8);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0x88ccff, 0x554433, 0.7);
scene.add(hemiLight);

const sunLight = new THREE.PointLight(0xffeedd, 300, 0, 0.6);
sunLight.position.set(0, 0, 0);
scene.add(sunLight);

const sunFill = new THREE.PointLight(0xffeecc, 5, 0, 0);
sunFill.position.set(0, 0, 0);
scene.add(sunFill);

// === STARFIELD ===
const starCount = 20000;
const starGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(starCount * 3);
const starSizes = new Float32Array(starCount);
const starColors = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 300 + Math.random() * 700;
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = r * Math.cos(phi);
    starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    starSizes[i] = 0.3 + Math.random() * 1.5;
    const temp = Math.random();
    if (temp < 0.1) {
        starColors[i * 3] = 0.8; starColors[i * 3 + 1] = 0.8; starColors[i * 3 + 2] = 1.0;
    } else if (temp < 0.2) {
        starColors[i * 3] = 1.0; starColors[i * 3 + 1] = 0.9; starColors[i * 3 + 2] = 0.7;
    } else {
        const b = 0.7 + Math.random() * 0.3;
        starColors[i * 3] = b; starColors[i * 3 + 1] = b; starColors[i * 3 + 2] = b;
    }
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
starGeo.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));
starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));

const starMat = new THREE.PointsMaterial({
    size: 0.8,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
});
const stars = new THREE.Points(starGeo, starMat);
scene.add(stars);

// === SUN ===
const sunTex = texFromFn(sunColor);
sunTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
const sunMat = new THREE.MeshBasicMaterial({ map: sunTex });
const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(4, 64, 64), sunMat);
scene.add(sunMesh);

const glowSpriteMat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(glowTexture()),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.6,
});
const glowSprite = new THREE.Sprite(glowSpriteMat);
glowSprite.scale.set(30, 30, 1);
scene.add(glowSprite);

const glowSpriteMat2 = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(glowTexture()),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.3,
});
const glowSprite2 = new THREE.Sprite(glowSpriteMat2);
glowSprite2.scale.set(50, 50, 1);
scene.add(glowSprite2);

// === PLANET DATA ===
const planetData = [
    { name: 'Mercury', radius: 0.5, orbit: 8, speed: 2.0, rotSpeed: 0.02, colorFn: mercuryColor, roughness: 0.7, metalness: 0.15 },
    { name: 'Venus', radius: 0.9, orbit: 12, speed: 1.5, rotSpeed: -0.005, colorFn: venusColor, roughness: 0.6, metalness: 0.05 },
    { name: 'Earth', radius: 1.0, orbit: 16, speed: 1.2, rotSpeed: 0.05, colorFn: earthColor, roughness: 0.5, metalness: 0.05 },
    { name: 'Mars', radius: 0.6, orbit: 20, speed: 1.0, rotSpeed: 0.046, colorFn: marsColor, roughness: 0.65, metalness: 0.1 },
    { name: 'Jupiter', radius: 2.8, orbit: 28, speed: 0.6, rotSpeed: 0.2, colorFn: jupiterColor, roughness: 0.4, metalness: 0.0 },
    { name: 'Saturn', radius: 2.3, orbit: 36, speed: 0.4, rotSpeed: 0.18, colorFn: saturnColor, roughness: 0.4, metalness: 0.0 },
    { name: 'Uranus', radius: 1.5, orbit: 44, speed: 0.3, rotSpeed: -0.1, colorFn: uranusColor, roughness: 0.3, metalness: 0.05 },
    { name: 'Neptune', radius: 1.4, orbit: 52, speed: 0.2, rotSpeed: 0.12, colorFn: neptuneColor, roughness: 0.3, metalness: 0.05 },
];

const planets = [];
const orbitLines = [];

planetData.forEach((data, idx) => {
    const angle = Math.random() * Math.PI * 2;
    const tex = texFromFn(data.colorFn);
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const mat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: data.roughness,
        metalness: data.metalness,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(data.radius, 48, 48), mat);
    mesh.position.x = data.orbit * Math.cos(angle);
    mesh.position.z = data.orbit * Math.sin(angle);
    scene.add(mesh);

    if (data.name === 'Earth') {
        const cloudTex = new THREE.CanvasTexture(earthCloudTexture());
        const cloudMat = new THREE.MeshBasicMaterial({
            map: cloudTex,
            transparent: true,
            opacity: 0.5,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        const cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(1.05, 48, 48), cloudMat);
        cloudMesh.position.copy(mesh.position);
        scene.add(cloudMesh);
        planets.push({ data, mesh, cloudMesh, angle });
    } else if (data.name === 'Saturn') {
        const ringTex = new THREE.CanvasTexture(ringTexture());
        const ringMat = new THREE.MeshBasicMaterial({
            map: ringTex,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
        });
        const ringMesh = new THREE.Mesh(new THREE.RingGeometry(3.0, 4.8, 64), ringMat);
        ringMesh.rotation.x = Math.PI / 2.5;
        ringMesh.position.copy(mesh.position);
        scene.add(ringMesh);
        planets.push({ data, mesh, ringMesh, angle });
    } else {
        planets.push({ data, mesh, angle });
    }

    // Orbit line
    const orbitPoints = [];
    const segments = 128;
    for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        orbitPoints.push(new THREE.Vector3(
            data.orbit * Math.cos(a),
            0,
            data.orbit * Math.sin(a)
        ));
    }
    const orbitGeo = new THREE.BufferGeometry().setFromPoints(orbitPoints);
    const orbitMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(0x88bbdd),
        transparent: true,
        opacity: 0.35,
    });
    const orbitLine = new THREE.Line(orbitGeo, orbitMat);
    scene.add(orbitLine);
    orbitLines.push(orbitLine);
});

// === BLACK HOLE ===
const BH_POS = new THREE.Vector3(-70, 3, -60);
const BH_SHADOW_R = 3.5;
const BH_PHOTON_INNER = BH_SHADOW_R;
const BH_PHOTON_OUTER = BH_SHADOW_R + 0.8;
const BH_DISK_INNER = BH_SHADOW_R + 1.2;
const BH_DISK_OUTER = 26;

function makeDiskTextureParams(opts = {}) {
    const {
        dopplerStr = 0.45, alphaMul = 200,
    } = opts;
    const W = 1024, H = 512;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const d = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const u = x / W, v = y / H, angle = v * Math.PI * 2;
            const temp = Math.pow(Math.max(0, 1 - u * 1.1), 0.7);
            const density = Math.exp(-u * 3.2) * (1 - u * 0.6);
            const doppler = 1 + dopplerStr * Math.sin(angle);
            const t1 = fbm(u * 5 + 10, v * 5, 3);
            const t2 = fbm(u * 10 + 20, v * 10 + 30, 2);
            const turb = 0.7 + 0.3 * (t1 * 0.7 + t2 * 0.3);
            const spiral = 0.75 + 0.25 * Math.sin(angle * 3 - u * 18 + 0.5 * Math.sin(angle));
            let bright = density * doppler * spiral * turb;
            bright = Math.pow(bright, 0.8);
            let r, g, b;
            if (temp > 0.85) {
                r = 180 + 75 * (temp - 0.85) / 0.15;
                g = 210 + 45 * (temp - 0.85) / 0.15;
                b = 255;
            } else if (temp > 0.6) {
                const t = (temp - 0.6) / 0.25;
                r = 255; g = 180 + 75 * t; b = 150 + 105 * (1 - t);
            } else if (temp > 0.35) {
                const t = (temp - 0.35) / 0.25;
                r = 255; g = 150 + 30 * t; b = 50 + 100 * (1 - t);
            } else if (temp > 0.15) {
                const t = (temp - 0.15) / 0.2;
                r = 255; g = 40 + 110 * t; b = 10 + 40 * t;
            } else {
                const t = temp / 0.15;
                r = 100 + 155 * t; g = 10 + 30 * t; b = 5 + 5 * t;
            }
            r *= bright; g *= bright; b *= bright;
            const i = (y * W + x) * 4;
            d.data[i] = clamp(r, 0, 255);
            d.data[i + 1] = clamp(g, 0, 255);
            d.data[i + 2] = clamp(b, 0, 255);
            d.data[i + 3] = clamp(bright * alphaMul, 0, 255);
        }
    }
    ctx.putImageData(d, 0, 0);
    return c;
}

function makePhotonRingTexture() {
    const W = 512, H = 64;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const d = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const u = x / W, v = y / H;
            const dx = (u - 0.5) * 10;
            const intensity = Math.exp(-dx * dx);
            const flicker = 0.9 + 0.1 * fbm(v * 8, u * 4, 2);
            const val = clamp(intensity * 255 * flicker, 0, 255);
            const i = (y * W + x) * 4;
            d.data[i] = 255; d.data[i + 1] = 235; d.data[i + 2] = 200;
            d.data[i + 3] = val;
        }
    }
    ctx.putImageData(d, 0, 0);
    return c;
}

function makeGlowTexture() {
    const s = 256;
    const c = document.createElement('canvas');
    c.width = s; c.height = s;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(180,200,255,0.3)');
    g.addColorStop(0.05, 'rgba(255,200,150,0.15)');
    g.addColorStop(0.15, 'rgba(255,150,80,0.08)');
    g.addColorStop(0.4, 'rgba(255,100,30,0.03)');
    g.addColorStop(1, 'rgba(255,50,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    return c;
}

// Build black hole
const bhGroup = new THREE.Group();
bhGroup.position.copy(BH_POS);

// Shadow sphere - the dark event horizon and gravitational shadow
const bhShadow = new THREE.Mesh(
    new THREE.SphereGeometry(BH_SHADOW_R, 64, 64),
    new THREE.MeshBasicMaterial({ color: 0x000000 })
);
bhGroup.add(bhShadow);

// Photon ring - bright thin ring at the edge of the shadow
const bhPhotonTex = new THREE.CanvasTexture(makePhotonRingTexture());
bhPhotonTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
const bhPhotonMat = new THREE.MeshBasicMaterial({
    map: bhPhotonTex,
    side: THREE.DoubleSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.95,
});
const bhPhoton = new THREE.Mesh(
    new THREE.RingGeometry(BH_PHOTON_INNER, BH_PHOTON_OUTER, 128),
    bhPhotonMat
);
bhPhoton.rotation.x = -Math.PI / 2;
bhGroup.add(bhPhoton);

// Main accretion disk - tilted to create the iconic Interstellar look
const bhDiskTex = new THREE.CanvasTexture(makeDiskTextureParams({}));
bhDiskTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
const bhDiskMat = new THREE.MeshBasicMaterial({
    map: bhDiskTex,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.82,
});
const bhDisk = new THREE.Mesh(
    new THREE.RingGeometry(BH_DISK_INNER, BH_DISK_OUTER, 128),
    bhDiskMat
);
bhDisk.rotation.x = -Math.PI / 2 + 0.25;
bhGroup.add(bhDisk);

// Hot inner disk - smaller, brighter, with opposite tilt for depth
const bhHotTex = new THREE.CanvasTexture(makeDiskTextureParams({
    dopplerStr: 0.6, alphaMul: 250,
}));
bhHotTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
const bhHotMat = new THREE.MeshBasicMaterial({
    map: bhHotTex,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.65,
});
const bhHotDisk = new THREE.Mesh(
    new THREE.RingGeometry(BH_SHADOW_R + 1.0, 14, 96),
    bhHotMat
);
bhHotDisk.rotation.x = -Math.PI / 2 - 0.2;
bhGroup.add(bhHotDisk);

// Lensing ring - gravitational light bending effect (disk appears above)
const bhLensTex = new THREE.CanvasTexture(makeDiskTextureParams({
    dopplerStr: 0.3, alphaMul: 120,
}));
bhLensTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
const bhLensMat = new THREE.MeshBasicMaterial({
    map: bhLensTex,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.3,
});
const bhLens = new THREE.Mesh(
    new THREE.RingGeometry(BH_SHADOW_R + 0.6, 10, 96),
    bhLensMat
);
bhLens.rotation.x = -Math.PI / 2;
bhLens.position.y = BH_SHADOW_R * 0.5;
bhGroup.add(bhLens);

// Glow sprites
const bhGlowTex = new THREE.CanvasTexture(makeGlowTexture());
const bhGlowMat1 = new THREE.SpriteMaterial({
    map: bhGlowTex, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
    opacity: 0.6,
});
const bhGlow1 = new THREE.Sprite(bhGlowMat1);
bhGlow1.scale.set(60, 60, 1);
bhGroup.add(bhGlow1);

const bhGlowMat2 = new THREE.SpriteMaterial({
    map: bhGlowTex, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
    opacity: 0.3,
});
const bhGlow2 = new THREE.Sprite(bhGlowMat2);
bhGlow2.scale.set(100, 100, 1);
bhGroup.add(bhGlow2);

// Wrap in a parent group so the entire black hole can be rotated
const blackHoleRoot = new THREE.Group();
blackHoleRoot.add(bhGroup);
scene.add(blackHoleRoot);

const bhParts = { disk: bhDisk, hotDisk: bhHotDisk, photon: bhPhoton, lens: bhLens, root: blackHoleRoot, bhTime: 0 };

// === ANIMATION ===
let time = 0;

function animate() {
    requestAnimationFrame(animate);
    time += 0.005;

    sunMesh.rotation.y += 0.002;

    // Black hole animation - differential rotation of accretion disk layers
    bhParts.bhTime += 0.005;
    const bhRotSpeed = 0.06 + 0.015 * Math.sin(bhParts.bhTime * 0.08);
    bhParts.disk.rotation.y += bhRotSpeed;
    bhParts.hotDisk.rotation.y += bhRotSpeed * 1.8;
    bhParts.photon.rotation.y += bhRotSpeed * 0.4;
    bhParts.lens.rotation.y += bhRotSpeed * 1.3;

    planets.forEach((p, idx) => {
        const orbit = p.data.orbit;
        const a = p.angle + time * p.data.speed;
        p.mesh.position.x = orbit * Math.cos(a);
        p.mesh.position.z = orbit * Math.sin(a);
        p.mesh.rotation.y += p.data.rotSpeed;

        if (p.cloudMesh) {
            p.cloudMesh.position.copy(p.mesh.position);
            p.cloudMesh.rotation.y += p.data.rotSpeed * 1.3;
        }
        if (p.ringMesh) {
            p.ringMesh.position.copy(p.mesh.position);
            p.ringMesh.rotation.y += 0.005;
        }
    });

    controls.update();
    composer.render();
}

animate();

// === RESIZE ===
window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
});
