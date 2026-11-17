// WebGL renderer. Each layer is a grid mesh:
//  - broad motion (sway, head, breath, body) moves the mesh vertices on the CPU
//  - fine motion (eyelids, gaze, mouth) remaps texture lookups in the fragment
//    shader, in rest-pose artboard space, so it rides along with the mesh.
import { images, masks, sampleMask, zoneBounds } from './assets';
import type { Doc, EyeZone, Layer, MouthZone, Zone } from './types';
import { zoneHitsLayer } from './types';
import { SWAY_SAMPLES, type RigFrame } from './rig';

const VERT = `#version 300 es
in vec2 aPos; in vec2 aRest;
uniform mat3 uView;
out vec2 vRest;
void main(){ vRest=aRest; vec3 p=uView*vec3(aPos,1.); gl_Position=vec4(p.xy,0.,1.); }`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vRest; out vec4 o;
uniform sampler2D uTex; uniform mat3 uInv; uniform float uAlpha; uniform vec4 uSolid;
uniform int uEyeN;
uniform vec4 uEyeA[4]; uniform vec4 uEyeB[4]; uniform vec4 uEyeC[4]; uniform vec4 uEyeD[4]; uniform vec4 uEyeE[4];
uniform int uMouthN;
uniform vec4 uMouthA[2]; uniform vec4 uMouthB[2]; uniform vec4 uMouthC[2];

float lid(float t,float tp,float h,float r){
  float s = t<tp ? (tp-t)/(tp+1.) : (t-tp)/(1.-tp);
  s = clamp(s,0.,1.);
  return h*pow(max(1.-s*s,0.),r);
}

// An eyelid is not drawn: the lash line and a sliver of skin above it are
// slid down over the eye, and the skin strip stretches to fill the gap.
vec2 eyeWarp(vec2 p,int i){
  vec2 a=uEyeA[i].xy, b=uEyeA[i].zw;
  vec2 mid=(a+b)*.5; vec2 d=b-a; float hw=max(length(d)*.5,1.);
  vec2 ex=d/(2.*hw); vec2 n=vec2(ex.y,-ex.x);
  vec2 q=p-mid; float t=dot(q,ex)/hw; float y=dot(q,n);
  float hU=uEyeB[i].y, hL=uEyeB[i].w;
  if(abs(t)>=1. || y>hU+uEyeC[i].z+uEyeC[i].w+2. || y<-hL-uEyeE[i].z-uEyeC[i].w-2.) return p;
  float U=lid(t,uEyeB[i].x,hU,uEyeC[i].x);
  float Lw=-lid(t,uEyeB[i].z,hL,uEyeC[i].y);
  float B=uEyeC[i].z, S=max(uEyeC[i].w,1.), B2=uEyeE[i].z;
  float C=mix(Lw,U,uEyeD[i].w)+uEyeD[i].z*.4*(hU+hL)*(1.-t*t);
  C=clamp(C,Lw,U);
  float Uc=mix(U,C,uEyeD[i].x), Lc=mix(Lw,C,max(uEyeD[i].y,smoothstep(.6,1.,uEyeD[i].x)));
  float ys=y;
  if(y>=Uc){
    float top=U+B+S;
    if(y<Uc+B) ys=y-Uc+U;
    else if(y<top) ys=mix(U+B,top,(y-Uc-B)/(top-Uc-B));
  } else if(y<=Lc){
    float bot=Lw-B2-S;
    if(y>Lc-B2) ys=y-Lc+Lw;
    else if(y>bot) ys=mix(Lw-B2,bot,(Lc-B2-y)/(Lc-B2-bot));
  }
  vec2 g=vec2(0.);
  float hgt=U-Lw;
  if(hgt>.5 && y<Uc && y>Lc){
    float k=(y-Lw)/hgt;
    float f=smoothstep(0.,.3,k)*smoothstep(0.,.3,1.-k)*(1.-t*t*t*t);
    g=uEyeE[i].xy*f;
  }
  return mid+ex*(t*hw)+n*ys-g;
}

vec2 mouthWarp(vec2 p,int i,out float inside){
  inside=0.;
  vec2 a=uMouthA[i].xy, b=uMouthA[i].zw;
  vec2 mid=(a+b)*.5; vec2 d=b-a; float hw=max(length(d)*.5,1.);
  vec2 ex=d/(2.*hw); vec2 n=vec2(ex.y,-ex.x);
  vec2 q=p-mid; float t=dot(q,ex)/hw; float y=dot(q,n);
  float op=uMouthB[i].x, sm=uMouthB[i].y, R=uMouthB[i].z;
  float bow=uMouthB[i].w*max(1.-t*t,0.);
  y-=bow;
  if(abs(t)>1.8 || abs(y)>R*1.6) return p;
  float wt=1.-smoothstep(1.,1.7,abs(t));
  float fy=exp(-(y*y)/(R*R*.45));
  float ys=y-sm*(min(t*t,1.3)-.3)*wt*fy;
  if(op>.01 && abs(t)<1.){
    float aO=op*pow(1.-t*t,.65);
    float hi=.25*aO, lo=-.75*aO;
    if(ys>lo && ys<hi){ inside=smoothstep(0.,1.5,min(ys-lo,hi-ys)); ys=0.; }
    else if(ys<=lo && ys>-R) ys=-R+(ys+R)/(lo+R)*R;
    else if(ys>=hi && ys<R) ys=R-(R-ys)/(R-hi)*R;
  }
  return mid+ex*(t*hw)+n*(ys+bow);
}

void main(){
  if(uSolid.a>0.){ o=uSolid; return; }
  vec2 p=vRest; float ins=0.; vec3 mc=vec3(0.);
  for(int i=0;i<2;i++){ if(i>=uMouthN) break; float k; p=mouthWarp(p,i,k); if(k>0.){ ins=k; mc=uMouthC[i].rgb; } }
  for(int i=0;i<4;i++){ if(i>=uEyeN) break; p=eyeWarp(p,i); }
  vec2 uv=(uInv*vec3(p,1.)).xy; vec2 uv0=(uInv*vec3(vRest,1.)).xy;
  vec4 c=textureGrad(uTex,uv,dFdx(uv0),dFdy(uv0));
  c*=step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.);
  c=mix(c,vec4(mc*c.a,c.a),ins);
  o=c*uAlpha;
}`;

export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

interface LayerMesh {
  key: string;
  cols: number;
  rows: number;
  rest: Float32Array;
  pos: Float32Array;
  restBuf: WebGLBuffer;
  posBuf: WebGLBuffer;
  idxBuf: WebGLBuffer;
  wireBuf: WebGLBuffer;
  idxCount: number;
  wireCount: number;
  vao: WebGLVertexArrayObject;
  weights: Map<string, { key: string; w: Float32Array | null }>;
}

const hex = (c: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return [0.4, 0.15, 0.18];
  const n = parseInt(m[1], 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export function cssToRgb(c: string): [number, number, number] {
  return hex(c);
}

export class Renderer {
  gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private textures = new Map<string, WebGLTexture>();
  private meshes = new Map<string, LayerMesh>();
  private headInfo = new Map<string, { key: string; cx: number; cy: number; r: number }>();

  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader error');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.bindAttribLocation(p, 1, 'aRest');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link error');
    this.prog = p;
    for (const n of ['uView', 'uTex', 'uInv', 'uAlpha', 'uSolid', 'uEyeN', 'uEyeA', 'uEyeB', 'uEyeC', 'uEyeD', 'uEyeE', 'uMouthN', 'uMouthA', 'uMouthB', 'uMouthC']) {
      this.u[n] = gl.getUniformLocation(p, n);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  private texture(id: string): WebGLTexture | null {
    let t = this.textures.get(id);
    if (t) return t;
    const asset = images.get(id);
    if (!asset) return null;
    const gl = this.gl;
    t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, asset.canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.textures.set(id, t);
    return t;
  }

  private mesh(doc: Doc, l: Layer): LayerMesh {
    const key = `${l.w}|${l.h}|${l.x}|${l.y}|${l.scale}|${l.rotation}|${doc.width}|${doc.height}`;
    let m = this.meshes.get(l.id);
    if (m && m.key === key) return m;
    const gl = this.gl;
    const cell = Math.max(doc.width, doc.height) / 72;
    const cols = Math.min(110, Math.max(2, Math.ceil((l.w * l.scale) / cell)));
    const rows = Math.min(110, Math.max(2, Math.ceil((l.h * l.scale) / cell)));
    const n = (cols + 1) * (rows + 1);
    const rest = new Float32Array(n * 2);
    const c = Math.cos(l.rotation) * l.scale;
    const s = Math.sin(l.rotation) * l.scale;
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const lx = (i / cols - 0.5) * l.w;
        const ly = (j / rows - 0.5) * l.h;
        const o = (j * (cols + 1) + i) * 2;
        rest[o] = l.x + lx * c - ly * s;
        rest[o + 1] = l.y + lx * s + ly * c;
      }
    }
    const idx = new Uint16Array(cols * rows * 6);
    const wire = new Uint16Array((cols * (rows + 1) + rows * (cols + 1)) * 2);
    let k = 0;
    let wk = 0;
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const a = j * (cols + 1) + i;
        if (i < cols && j < rows) {
          const b = a + 1, d = a + cols + 1, e = d + 1;
          // alternate the diagonal so bends look even in both directions
          if ((i + j) % 2 === 0) { idx.set([a, b, e, a, e, d], k); } else { idx.set([a, b, d, b, e, d], k); }
          k += 6;
        }
        if (i < cols) { wire[wk++] = a; wire[wk++] = a + 1; }
        if (j < rows) { wire[wk++] = a; wire[wk++] = a + cols + 1; }
      }
    }
    if (m) {
      gl.deleteBuffer(m.restBuf); gl.deleteBuffer(m.posBuf); gl.deleteBuffer(m.idxBuf); gl.deleteBuffer(m.wireBuf); gl.deleteVertexArray(m.vao);
    }
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, rest, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const restBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, restBuf);
    gl.bufferData(gl.ARRAY_BUFFER, rest, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    const idxBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const wireBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, wireBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, wire, gl.STATIC_DRAW);
    m = { key, cols, rows, rest, pos: new Float32Array(rest), restBuf, posBuf, idxBuf, wireBuf, idxCount: idx.length, wireCount: wire.length, vao, weights: new Map() };
    this.meshes.set(l.id, m);
    return m;
  }

  /** Per-vertex influence of a paint zone on a layer; null means "none". */
  private weights(doc: Doc, m: LayerMesh, z: Zone & { mask: string | null; whole: boolean }): Float32Array | null {
    const key = `${m.key}|${z.whole ? 'whole' : z.mask}`;
    const hit = m.weights.get(z.id);
    if (hit && hit.key === key) return hit.w;
    let w: Float32Array | null = null;
    const n = m.rest.length / 2;
    if (z.whole) {
      w = new Float32Array(n).fill(1);
    } else {
      const mask = z.mask ? masks.get(z.mask) : null;
      if (mask) {
        w = new Float32Array(n);
        let any = false;
        for (let i = 0; i < n; i++) {
          const v = sampleMask(mask, m.rest[i * 2] / doc.width, m.rest[i * 2 + 1] / doc.height);
          w[i] = v;
          if (v > 0.003) any = true;
        }
        if (!any) w = null;
      }
    }
    m.weights.set(z.id, { key, w });
    return w;
  }

  private head(doc: Doc, z: Extract<Zone, { type: 'head' }>) {
    const key = `${z.whole}|${z.mask}|${JSON.stringify(z.layers)}|${z.whole ? doc.layers.map((l) => `${l.x},${l.y},${l.scale},${l.rotation}`).join(';') : ''}`;
    let h = this.headInfo.get(z.id);
    if (h && h.key === key) return h;
    const b = zoneBounds(doc, z);
    h = b
      ? { key, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, r: Math.max(8, Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2) }
      : { key, cx: z.pivot.x, cy: z.pivot.y, r: doc.width / 4 };
    this.headInfo.set(z.id, h);
    return h;
  }

  private deform(doc: Doc, l: Layer, m: LayerMesh, f: RigFrame) {
    const { rest, pos } = m;
    pos.set(rest);
    const n = rest.length / 2;
    const L = f.liveliness;

    for (const z of doc.zones) {
      if (!z.enabled || !zoneHitsLayer(z, l.id)) continue;
      if (z.type === 'sway') {
        const w = this.weights(doc, m, z);
        const curve = f.sway[z.id];
        if (!w || !curve) continue;
        const ax = z.anchor.x, ay = z.anchor.y;
        let dx = z.tip.x - ax, dy = z.tip.y - ay;
        const len = Math.max(1, Math.hypot(dx, dy));
        dx /= len; dy /= len;
        for (let i = 0; i < n; i++) {
          const wi = w[i];
          if (wi <= 0.003) continue;
          const vx = rest[i * 2] - ax, vy = rest[i * 2 + 1] - ay;
          const d = Math.min(1.499, Math.max(0, (vx * dx + vy * dy) / len));
          const fi = (d / 1.5) * SWAY_SAMPLES;
          const i0 = Math.floor(fi);
          const ang = (curve[i0] + (curve[i0 + 1] - curve[i0]) * (fi - i0)) * wi;
          const c = Math.cos(ang), s = Math.sin(ang);
          pos[i * 2] += vx * c - vy * s - vx;
          pos[i * 2 + 1] += vx * s + vy * c - vy;
        }
      }
    }

    for (const z of doc.zones) {
      if (!z.enabled || !zoneHitsLayer(z, l.id)) continue;
      if (z.type === 'head') {
        const w = this.weights(doc, m, z);
        if (!w) continue;
        const h = this.head(doc, z);
        const depth = 1 + l.depth * 0.7;
        const tx = f.head.turn * z.turn * h.r * 0.16 * depth;
        const ty = f.head.nod * z.nod * h.r * 0.12 * depth;
        const tilt = f.head.tilt * z.tilt * 0.16;
        const lift = -f.breath * doc.height * 0.0035 * Math.min(1.5, L);
        const squeeze = 1 - Math.abs(f.head.turn * z.turn) * 0.035;
        for (let i = 0; i < n; i++) {
          const wi = w[i];
          if (wi <= 0.003) continue;
          let x = pos[i * 2], y = pos[i * 2 + 1];
          const rx = (rest[i * 2] - h.cx) / h.r, ry = (rest[i * 2 + 1] - h.cy) / h.r;
          const bulge = 0.4 + 0.6 * Math.max(0, 1 - (rx * rx + ry * ry) * 0.8);
          const ang = tilt * wi;
          const c = Math.cos(ang), s = Math.sin(ang);
          const vx = x - z.pivot.x, vy = y - z.pivot.y;
          x = z.pivot.x + vx * c - vy * s;
          y = z.pivot.y + vx * s + vy * c;
          x += ((x - h.cx) * (squeeze - 1) + tx * bulge) * wi;
          y += (ty * bulge + lift) * wi;
          pos[i * 2] = x;
          pos[i * 2 + 1] = y;
        }
      } else if (z.type === 'breath') {
        const w = this.weights(doc, m, z);
        if (!w) continue;
        const amt = f.breath * z.amount * 0.045 * Math.min(1.6, 0.4 + L * 0.6);
        for (let i = 0; i < n; i++) {
          const wi = w[i];
          if (wi <= 0.003) continue;
          pos[i * 2] += (pos[i * 2] - z.base.x) * amt * 0.35 * wi;
          pos[i * 2 + 1] -= Math.max(0, z.base.y - pos[i * 2 + 1]) * amt * wi;
        }
      }
    }

    if (f.body.rot !== 0 || f.body.bob !== 0) {
      const px = doc.width / 2, py = doc.height;
      const c = Math.cos(f.body.rot), s = Math.sin(f.body.rot);
      for (let i = 0; i < n; i++) {
        const vx = pos[i * 2] - px, vy = pos[i * 2 + 1] - py;
        const fall = Math.min(1, Math.max(0, -vy / doc.height)); // feet stay planted
        pos[i * 2] = px + vx * c - vy * s;
        pos[i * 2 + 1] = py + vx * s + vy * c + f.body.bob * fall;
      }
    }
  }

  resize(w: number, h: number) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  render(doc: Doc, f: RigFrame, view: View, opts: { wire?: boolean; background?: string; ghost?: boolean } = {}) {
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    if (opts.background && opts.background !== 'transparent') {
      const [r, g, b] = hex(opts.background);
      gl.clearColor(r, g, b, 1);
    } else gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    const sx = (2 * view.zoom) / W, sy = (-2 * view.zoom) / H;
    gl.uniformMatrix3fv(this.u.uView, false, [sx, 0, 0, 0, sy, 0, (2 * view.panX) / W - 1, 1 - (2 * view.panY) / H, 1]);
    gl.uniform1i(this.u.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);

    const eyes = doc.zones.filter((z): z is EyeZone => z.type === 'eye' && z.enabled && !!f.eyes[z.id]);
    const mouths = doc.zones.filter((z): z is MouthZone => z.type === 'mouth' && z.enabled && !!f.mouths[z.id]);
    const A = new Float32Array(16), B = new Float32Array(16), C = new Float32Array(16), D = new Float32Array(16), E = new Float32Array(16);
    const MA = new Float32Array(8), MB = new Float32Array(8), MC = new Float32Array(8);

    for (const l of doc.layers) {
      const alpha = l.opacity * (opts.ghost ? (l.visible ? 1 : 0) : f.layerAlpha[l.id] ?? (l.visible ? 1 : 0));
      if (alpha <= 0.002) continue;
      const tex = this.texture(l.image);
      if (!tex) continue;
      const m = this.mesh(doc, l);
      this.deform(doc, l, m, f);
      gl.bindVertexArray(m.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, m.pos);
      gl.bindTexture(gl.TEXTURE_2D, tex);

      const c = Math.cos(l.rotation), s = Math.sin(l.rotation);
      const ia = c / l.scale / l.w, ib = -s / l.scale / l.h, ic = s / l.scale / l.w, id = c / l.scale / l.h;
      gl.uniformMatrix3fv(this.u.uInv, false, [ia, ib, 0, ic, id, 0, 0.5 - ia * l.x - ic * l.y, 0.5 - ib * l.x - id * l.y, 1]);
      gl.uniform1f(this.u.uAlpha, alpha);
      gl.uniform4f(this.u.uSolid, 0, 0, 0, 0);

      let ne = 0;
      for (const z of eyes) {
        if (ne >= 4 || !zoneHitsLayer(z, l.id)) continue;
        const e = f.eyes[z.id];
        const [p, q] = z.a.x <= z.b.x ? [z.a, z.b] : [z.b, z.a];
        const flip = z.a.x <= z.b.x ? 1 : -1;
        const cl = (v: number) => Math.min(0.85, Math.max(-0.85, v * flip));
        A.set([p.x, p.y, q.x, q.y], ne * 4);
        B.set([cl(z.upT), z.upH, cl(z.loT), z.loH], ne * 4);
        C.set([z.upRound, z.loRound, z.band, z.skin], ne * 4);
        D.set([e.upper, e.lower, e.arc, z.meet], ne * 4);
        E.set([e.gx, e.gy, z.loBand, 0], ne * 4);
        ne++;
      }
      gl.uniform1i(this.u.uEyeN, ne);
      if (ne) {
        gl.uniform4fv(this.u.uEyeA, A); gl.uniform4fv(this.u.uEyeB, B); gl.uniform4fv(this.u.uEyeC, C);
        gl.uniform4fv(this.u.uEyeD, D); gl.uniform4fv(this.u.uEyeE, E);
      }
      let nm = 0;
      for (const z of mouths) {
        if (nm >= 2 || !zoneHitsLayer(z, l.id)) continue;
        const mo = f.mouths[z.id];
        const [p, q] = z.a.x <= z.b.x ? [z.a, z.b] : [z.b, z.a];
        const reach = Math.max(4, z.reach);
        MA.set([p.x, p.y, q.x, q.y], nm * 4);
        MB.set([Math.min(mo.open * z.openH, reach), mo.smile * z.smileH, reach, z.bow ?? 0], nm * 4);
        MC.set([...hex(z.color), 1], nm * 4);
        nm++;
      }
      gl.uniform1i(this.u.uMouthN, nm);
      if (nm) { gl.uniform4fv(this.u.uMouthA, MA); gl.uniform4fv(this.u.uMouthB, MB); gl.uniform4fv(this.u.uMouthC, MC); }

      gl.drawElements(gl.TRIANGLES, m.idxCount, gl.UNSIGNED_SHORT, 0);
      if (opts.wire) {
        gl.uniform4f(this.u.uSolid, 0.66 * 0.28, 0.71 * 0.28, 1 * 0.28, 0.28);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.wireBuf);
        gl.drawElements(gl.LINES, m.wireCount, gl.UNSIGNED_SHORT, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.idxBuf);
      }
    }
    gl.bindVertexArray(null);
    // forget meshes of layers that no longer exist
    if (this.meshes.size > doc.layers.length) {
      const live = new Set(doc.layers.map((l) => l.id));
      for (const id of this.meshes.keys()) if (!live.has(id)) this.meshes.delete(id);
    }
  }
}

/** A view that fits the artboard inside a w×h box. */
export function fitView(doc: { width: number; height: number }, w: number, h: number, pad = 0): View {
  const zoom = Math.min((w - pad * 2) / doc.width, (h - pad * 2) / doc.height);
  return { zoom, panX: (w - doc.width * zoom) / 2, panY: (h - doc.height * zoom) / 2 };
}
