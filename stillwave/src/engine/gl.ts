// WebGL renderer. Each layer is a grid mesh:
//  - broad motion (sway, head, breath, body) moves the mesh vertices on the CPU
//  - fine motion (eyelids, gaze, mouth) remaps texture lookups in the fragment
//    shader, in rest-pose artboard space, so it rides along with the mesh.
import { images, makeCanvas, masks, sampleMask, zoneBounds } from './assets';
import { axisFrame, eyeBox, eyeLut, LUT_N, spineAt, spineBind, swaySpine } from './geom';
import type { Doc, EyeZone, Layer, MouthZone, SwayZone, Zone } from './types';
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
uniform sampler2D uTex; uniform sampler2D uLut; uniform sampler2D uAtlas;
uniform mat3 uInv; uniform float uAlpha; uniform vec4 uSolid; uniform float uTexel;
uniform int uEyeN;
uniform vec4 uEyeA[4]; uniform vec4 uEyeB[4]; uniform vec4 uEyeC[4]; uniform vec4 uEyeD[4]; uniform vec4 uEyeE[4]; uniform vec4 uEyeF[4];
uniform int uMouthN;
uniform vec4 uMouthA[2]; uniform vec4 uMouthB[2]; uniform vec4 uMouthC[2];

vec2 gDx, gDy;          // screen-space derivatives of the undistorted lookup
vec4 gPlate = vec4(0.); // lid skin: painted by hand over an automatic fill
float gCover = 0., gReplace = 0., gLashA = 0., gKeep = 0.;
vec2 gLashP;

vec4 art(vec2 doc){
  vec2 uv=(uInv*vec3(doc,1.)).xy;
  return textureGrad(uTex,uv,gDx,gDy)*step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.);
}
vec4 artSoft(vec2 doc){
  vec2 uv=(uInv*vec3(doc,1.)).xy;
  return textureLod(uTex,uv,2.)*step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.);
}
// both lid curves at t: x = upper height, y = lower depth
vec2 lids(int row,float t){
  float f=clamp((t+1.)*.5,0.,1.)*128.; float i=min(floor(f),127.);
  vec2 a=texelFetch(uLut,ivec2(int(i),row),0).rg, b=texelFetch(uLut,ivec2(int(i)+1,row),0).rg;
  return mix(a,b,f-i);
}
// the eye's own paint: row 0 lid skin, row 1 marks (r keep, g lash)
vec4 eyePaint(int i,vec2 doc,float row){
  vec4 bx=uEyeF[i]; vec2 q=(doc-bx.xy)/bx.zw;
  if(q.x<0.||q.y<0.||q.x>1.||q.y>1.) return vec4(0.);
  q=clamp(q,vec2(.5/256.),vec2(1.-.5/256.));
  return texture(uAtlas,vec2((uEyeB[i].w+q.x)/8.,(row+q.y)/2.));
}

// Eyelids are made from the drawing itself. The lash line slides down the
// eye; the skin it uncovers is either a blend of the skin above and below
// ("soft") or the strip of skin above the lashes pulled down ("stretch").
// Hand-painted lid skin, extra lash marks and keep marks refine the result.
vec2 eyeWarp(vec2 p,int i){
  vec2 a=uEyeA[i].xy, b=uEyeA[i].zw;
  vec2 mid=(a+b)*.5; vec2 d=b-a; float hw=max(length(d)*.5,1.);
  vec2 ex=d/(2.*hw); vec2 n=vec2(ex.y,-ex.x);
  vec2 q=p-mid; float t=dot(q,ex)/hw; float y=dot(q,n);
  float hU=uEyeB[i].x, hL=uEyeB[i].y;
  float B=uEyeC[i].x, S=max(uEyeC[i].y,1.), B2=uEyeE[i].z, roll=uEyeC[i].w;
  bool soft=uEyeC[i].z>.5;
  int flags=int(uEyeE[i].w+.5); bool hasPaint=(flags&1)!=0, hasMarks=(flags&2)!=0;
  float reach=hasMarks?hU*1.5+B:0.;
  if(abs(t)>=1. || y>hU+B+S+2.+reach || y<-hL-B2-S-2.-reach*.5) return p;
  vec2 ul=lids(int(uEyeB[i].z+.5),t); float U=ul.x, Lw=-ul.y;
  float C=mix(Lw,U,uEyeD[i].w)+uEyeD[i].z*.4*(hU+hL)*(1.-t*t);
  C=clamp(C,Lw,U);
  float Uc=mix(U,C,uEyeD[i].x), Lc=mix(Lw,C,max(uEyeD[i].y,smoothstep(.6,1.,uEyeD[i].x)));
  float shift=U-Uc, moved=smoothstep(0.,1.5,shift);
  float r=mix(1.,1.-.6*roll,uEyeD[i].x); // lashes foreshorten as the lid comes down
  vec2 along=mid+ex*(t*hw);
  float ys=y;
  if(y>=Uc){
    if(!soft){
      float top=U+B+S, bt=Uc+B*r;
      if(y<bt) ys=U+(y-Uc)/r;
      else if(y<top) ys=mix(U+B,top,(y-bt)/(top-bt));
    }
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
  // where lid skin shows: between the moving lash line and where the lashes used to be
  // the fill fades into the untouched skin above it instead of ending in a line
  float topEdge=soft?1.-smoothstep(U+B*.5,U+B+S,y):1.-smoothstep(U+B-1.,U+B+.5,y);
  float cover=step(Uc,y)*topEdge*moved;
  vec4 marks=hasMarks?eyePaint(i,p,1.):vec4(0.);
  cover=max(cover,marks.g*moved);
  vec4 paint=hasPaint?eyePaint(i,p,0.):vec4(0.);
  if(soft){
    // Skin is sampled a little clear of the lashes, across the width of the eye.
    // The skin under the eye is rarely hidden, so it is the reference: samples
    // above the eye that look nothing like it (a fringe, a brow) are ignored.
    float clear=uTexel*4.; int row=int(uEyeB[i].z+.5);
    vec4 below=vec4(0.);
    for(int k=-2;k<=2;k++){ float tt=clamp(t+float(k)*.22,-.92,.92); below+=artSoft(mid+ex*(tt*hw)+n*(-lids(row,tt).y-B2-S-clear)); }
    below/=5.;
    // compare by hue, not brightness: skin in shadow is still skin, a blue fringe is not
    vec3 ref=below.rgb/max(below.r+below.g+below.b,.001);
    vec4 above=vec4(0.); float wsum=0.;
    for(int k=-3;k<=3;k++){
      float tt=clamp(t+float(k)*.2,-.95,.95);
      vec4 c=artSoft(mid+ex*(tt*hw)+n*(lids(row,tt).x+B+S+clear));
      vec3 dc=c.rgb/max(c.r+c.g+c.b,.001)-ref;
      float w=(exp(-dot(dc,dc)*260.)+.002)/(1.+abs(float(k))*.5);
      above+=c*w; wsum+=w;
    }
    above/=wsum;
    float k=clamp((y-Lw)/max(U+B+S-Lw,1.),0.,1.);
    vec4 fill=mix(below,above,smoothstep(0.,1.,k));
    gPlate=paint+fill*(1.-paint.a); gReplace=1.;
  } else { gPlate=paint; gReplace=0.; }
  gCover=cover;
  // lashes: the band above the lid edge, plus anything marked as lash
  float ysL=U+(y-Uc)/r;
  gLashP=along+n*ysL;
  float la=soft?step(Uc,y)*step(U,ysL)*(1.-smoothstep(U+B-1.,U+B+.5,ysL)):0.;
  if(hasMarks) la=max(la,eyePaint(i,gLashP,1.).g);
  gLashA=la*moved;
  gKeep=marks.r;
  return along+n*ys-g;
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
  vec2 uv0=(uInv*vec3(vRest,1.)).xy; gDx=dFdx(uv0); gDy=dFdy(uv0);
  vec2 p=vRest; float ins=0.; vec3 mc=vec3(0.);
  for(int i=0;i<2;i++){ if(i>=uMouthN) break; float k; p=mouthWarp(p,i,k); if(k>0.){ ins=k; mc=uMouthC[i].rgb; } }
  for(int i=0;i<4;i++){ if(i>=uEyeN) break; p=eyeWarp(p,i); }
  vec4 c=art(p);
  c=mix(c,vec4(mc*c.a,c.a),ins);
  if(gCover>0.) c=gReplace>.5?mix(c,gPlate,gCover):gPlate*gCover+c*(1.-gPlate.a*gCover);
  if(gLashA>0.) c=mix(c,art(gLashP),gLashA);
  if(gKeep>0.) c=mix(c,art(vRest),gKeep);
  o=c*uAlpha;
}`;

export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

interface SwayBind { key: string; at: Float32Array; cx: Float32Array; cy: Float32Array }

interface LayerMesh {
  key: string;
  cols: number;
  rows: number;
  rest: Float32Array;
  pos: Float32Array;
  posBuf: WebGLBuffer;
  restBuf: WebGLBuffer;
  idxBuf: WebGLBuffer;
  wireBuf: WebGLBuffer;
  idxCount: number;
  wireCount: number;
  vao: WebGLVertexArrayObject;
  weights: Map<string, { key: string; w: Float32Array | null }>;
  binds: Map<string, SwayBind>;
  // scratch for blending overlapping sways
  sx: Float32Array; sy: Float32Array; sw: Float32Array; un: Float32Array;
  edgeX: number; edgeY: number;
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

const SPINE_STEPS = 32;
const CELL = 256; // eye paint cell size in the atlas
export const MAX_EYES = 8;

export interface RenderOptions {
  wire?: boolean;
  background?: string;
  ghost?: boolean;
  /** Canvases being painted right now, shown in place of saved eye paint: key `${zoneId}:paint` or `:ctl`. */
  livePaint?: Map<string, HTMLCanvasElement>;
}

export class Renderer {
  gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private textures = new Map<string, { tex: WebGLTexture; version: number }>();
  private meshes = new Map<string, LayerMesh>();
  private headInfo = new Map<string, { key: string; cx: number; cy: number; r: number }>();
  private lutTex: WebGLTexture;
  private lutKey: unknown[] = [];
  private atlasTex: WebGLTexture;
  private atlasKey = '';
  private atlasCanvas: HTMLCanvasElement | null = null;
  private paintLayer = new Map<string, { key: string; layer: string | null }>();
  /** Vertices the fold guard had to correct in the last frame. */
  guarded = 0;

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
    for (const n of ['uView', 'uTex', 'uLut', 'uAtlas', 'uInv', 'uAlpha', 'uSolid', 'uTexel', 'uEyeN', 'uEyeA', 'uEyeB', 'uEyeC', 'uEyeD', 'uEyeE', 'uEyeF', 'uMouthN', 'uMouthA', 'uMouthB', 'uMouthC']) {
      this.u[n] = gl.getUniformLocation(p, n);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const small = (unit: number, filter: number) => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.lutTex = small(1, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, LUT_N + 1, MAX_EYES, 0, gl.RGBA, gl.FLOAT, null);
    this.atlasTex = small(2, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.activeTexture(gl.TEXTURE0);
  }

  private texture(id: string): WebGLTexture | null {
    const asset = images.get(id);
    const hit = this.textures.get(id);
    if (hit && (!asset || hit.version === asset.version)) return hit.tex;
    if (!asset) return null;
    const gl = this.gl;
    const tex = hit?.tex ?? gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, asset.canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.textures.set(id, { tex, version: asset.version });
    return tex;
  }

  private mesh(doc: Doc, l: Layer): LayerMesh {
    const key = `${l.w}|${l.h}|${l.x}|${l.y}|${l.scale}|${l.rotation}|${doc.width}|${doc.height}`;
    let m = this.meshes.get(l.id);
    if (m && m.key === key) return m;
    const gl = this.gl;
    const cell = Math.max(doc.width, doc.height) / 84;
    const cols = Math.min(120, Math.max(2, Math.ceil((l.w * l.scale) / cell)));
    const rows = Math.min(120, Math.max(2, Math.ceil((l.h * l.scale) / cell)));
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
    m = {
      key, cols, rows, rest, pos: new Float32Array(rest), restBuf, posBuf, idxBuf, wireBuf, idxCount: idx.length, wireCount: wire.length, vao,
      weights: new Map(), binds: new Map(),
      sx: new Float32Array(n), sy: new Float32Array(n), sw: new Float32Array(n), un: new Float32Array(n),
      edgeX: (l.w * l.scale) / cols, edgeY: (l.h * l.scale) / rows,
    };
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

  /** Where along the sway spine each vertex sits. */
  private bind(m: LayerMesh, z: SwayZone): SwayBind {
    const key = `${m.key}|${z.anchor.x},${z.anchor.y},${z.tip.x},${z.tip.y}|${z.path.map((p) => `${p.x},${p.y}`).join(';')}`;
    let b = m.binds.get(z.id);
    if (b && b.key === key) return b;
    const n = m.rest.length / 2;
    b = { key, at: new Float32Array(n), cx: new Float32Array(n), cy: new Float32Array(n) };
    const spine = swaySpine(z);
    for (let i = 0; i < n; i++) {
      const r = spineBind(spine, m.rest[i * 2], m.rest[i * 2 + 1]);
      b.at[i] = r.at; b.cx[i] = r.cx; b.cy[i] = r.cy;
    }
    m.binds.set(z.id, b);
    return b;
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
    let painted = false; // any soft-edged (painted) motion on this layer: worth guarding against folds

    // ---- sway: each strand is carried along its own spine. Cross-sections stay
    // rigid, so a lock keeps its thickness and drawn shape instead of smearing.
    let sways = 0;
    for (const z of doc.zones) {
      if (z.type !== 'sway' || !z.enabled || !zoneHitsLayer(z, l.id)) continue;
      const w = this.weights(doc, m, z);
      const turn = f.sway[z.id];
      if (!w || !turn) continue;
      if (!sways++) { m.sx.fill(0); m.sy.fill(0); m.sw.fill(0); m.un.fill(1); }
      if (!z.whole) painted = true;
      const spine = swaySpine(z);
      const b = this.bind(m, z);
      // walk the spine, turning each stretch by its angle
      const qx = new Float32Array(SPINE_STEPS + 1), qy = new Float32Array(SPINE_STEPS + 1), ang = new Float32Array(SPINE_STEPS + 1);
      let prev = spineAt(spine, 0);
      qx[0] = prev.x; qy[0] = prev.y;
      const angleAt = (at: number) => {
        const fi = Math.min(1, Math.max(0, at)) * SWAY_SAMPLES;
        const i0 = Math.min(SWAY_SAMPLES - 1, Math.floor(fi));
        return turn[i0] + (turn[i0 + 1] - turn[i0]) * (fi - i0);
      };
      for (let k = 1; k <= SPINE_STEPS; k++) {
        const next = spineAt(spine, k / SPINE_STEPS);
        const a = angleAt((k - 0.5) / SPINE_STEPS);
        const c = Math.cos(a), s = Math.sin(a);
        const dx = next.x - prev.x, dy = next.y - prev.y;
        qx[k] = qx[k - 1] + dx * c - dy * s;
        qy[k] = qy[k - 1] + dx * s + dy * c;
        ang[k - 1] = a;
        prev = next;
      }
      ang[SPINE_STEPS] = ang[SPINE_STEPS - 1];
      for (let i = 0; i < n; i++) {
        const wi = w[i];
        if (wi <= 0.003) continue;
        const fk = b.at[i] * SPINE_STEPS;
        const k = Math.min(SPINE_STEPS - 1, Math.floor(fk));
        const u = fk - k;
        const a = angleAt(b.at[i]);
        const c = Math.cos(a), s = Math.sin(a);
        const ox = rest[i * 2] - b.cx[i], oy = rest[i * 2 + 1] - b.cy[i];
        const nx = qx[k] + (qx[k + 1] - qx[k]) * u + ox * c - oy * s;
        const ny = qy[k] + (qy[k + 1] - qy[k]) * u + ox * s + oy * c;
        // overlapping sways share a vertex by weight instead of adding up
        const w2 = wi * wi;
        m.sx[i] += (nx - rest[i * 2]) * w2;
        m.sy[i] += (ny - rest[i * 2 + 1]) * w2;
        m.sw[i] += w2;
        m.un[i] *= 1 - wi;
      }
    }
    if (sways) {
      for (let i = 0; i < n; i++) {
        if (m.sw[i] <= 0) continue;
        const k = (1 - m.un[i]) / m.sw[i];
        pos[i * 2] += m.sx[i] * k;
        pos[i * 2 + 1] += m.sy[i] * k;
      }
    }

    for (const z of doc.zones) {
      if (!z.enabled || !zoneHitsLayer(z, l.id)) continue;
      if (z.type === 'head') {
        const w = this.weights(doc, m, z);
        if (!w) continue;
        if (!z.whole) painted = true;
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
        if (!z.whole) painted = true;
        const amt = f.breath * z.amount * 0.045 * Math.min(1.6, 0.4 + L * 0.6);
        for (let i = 0; i < n; i++) {
          const wi = w[i];
          if (wi <= 0.003) continue;
          pos[i * 2] += (pos[i * 2] - z.base.x) * amt * 0.35 * wi;
          pos[i * 2 + 1] -= Math.max(0, z.base.y - pos[i * 2 + 1]) * amt * wi;
        }
      }
    }

    // ---- hold still: painted anchors win over everything above
    for (const z of doc.zones) {
      // lifted patches are free of the page they came from: that is the point of lifting them
      if (z.type !== 'hold' || !z.enabled || l.role === 'lifted' || !zoneHitsLayer(z, l.id)) continue;
      const w = this.weights(doc, m, z);
      if (!w) continue;
      painted = true;
      for (let i = 0; i < n; i++) {
        const k = 1 - w[i];
        if (k >= 0.997) continue;
        pos[i * 2] = rest[i * 2] + (pos[i * 2] - rest[i * 2]) * k;
        pos[i * 2 + 1] = rest[i * 2 + 1] + (pos[i * 2 + 1] - rest[i * 2 + 1]) * k;
      }
    }

    if (painted) this.guard(m);

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

  /**
   * Fold guard. Where a moving region meets a still one the grid can be
   * squashed until it turns inside out, which shows as torn, doubled pixels.
   * Any grid edge squeezed below 35% (or stretched past 250%) of its length is
   * eased back; rigid turns are untouched because they keep edge lengths.
   */
  private guard(m: LayerMesh) {
    const { pos, rest, cols, rows } = m;
    const stride = cols + 1;
    let fixed = 0;
    const fix = (a: number, b: number, len: number) => {
      const ex = pos[b * 2] - pos[a * 2], ey = pos[b * 2 + 1] - pos[a * 2 + 1];
      const rx = rest[b * 2] - rest[a * 2], ry = rest[b * 2 + 1] - rest[a * 2 + 1];
      const along = (ex * rx + ey * ry) / len; // signed length along the rest direction: negative means flipped
      const cur = Math.hypot(ex, ey);
      let want = cur;
      if (along < len * 0.35) want = len * 0.35;
      else if (cur > len * 2.5) want = len * 2.5;
      else return;
      // aim for the rest direction when flipped or collapsed, else keep the current one
      const ux = along < len * 0.35 ? rx / len : ex / cur, uy = along < len * 0.35 ? ry / len : ey / cur;
      const ma = Math.abs(pos[a * 2] - rest[a * 2]) + Math.abs(pos[a * 2 + 1] - rest[a * 2 + 1]) > 0.01 ? 1 : 0;
      const mb = Math.abs(pos[b * 2] - rest[b * 2]) + Math.abs(pos[b * 2 + 1] - rest[b * 2 + 1]) > 0.01 ? 1 : 0;
      if (!ma && !mb) return;
      const dx = ux * want - ex, dy = uy * want - ey;
      const ka = ma / (ma + mb), kb = mb / (ma + mb);
      pos[a * 2] -= dx * ka * 0.9; pos[a * 2 + 1] -= dy * ka * 0.9;
      pos[b * 2] += dx * kb * 0.9; pos[b * 2 + 1] += dy * kb * 0.9;
      fixed++;
    };
    for (let pass = 0; pass < 3; pass++) {
      const before = fixed;
      for (let j = 0; j <= rows; j++) {
        for (let i = 0; i <= cols; i++) {
          const a = j * stride + i;
          if (i < cols) fix(a, a + 1, m.edgeX);
          if (j < rows) fix(a, a + stride, m.edgeY);
        }
      }
      if (fixed === before) break;
    }
    this.guarded += fixed;
  }

  resize(w: number, h: number) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /** The layer hand-painted lid skin is drawn on: the front-most one that has artwork at the eye. */
  private paintTarget(doc: Doc, z: EyeZone): string | null {
    const key = doc.layers.map((l) => `${l.id}:${l.image}:${l.visible}:${l.x},${l.y},${l.scale},${l.rotation}`).join('|') + `|${z.a.x},${z.a.y},${z.b.x},${z.b.y}|${JSON.stringify(z.layers)}`;
    const hit = this.paintLayer.get(z.id);
    if (hit && hit.key === key) return hit.layer;
    const mid = axisFrame(z).mid;
    let layer: string | null = null;
    for (let i = doc.layers.length - 1; i >= 0 && !layer; i--) {
      const l = doc.layers[i];
      if (!l.visible || !zoneHitsLayer(z, l.id)) continue;
      const a = images.get(l.image);
      if (!a) continue;
      const c = Math.cos(-l.rotation), s = Math.sin(-l.rotation);
      const dx = mid.x - l.x, dy = mid.y - l.y;
      const lx = ((dx * c - dy * s) / l.scale + l.w / 2) / l.w, ly = ((dx * s + dy * c) / l.scale + l.h / 2) / l.h;
      if (lx < 0 || ly < 0 || lx >= 1 || ly >= 1) continue;
      const t = makeCanvas(1, 1);
      const g = t.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(a.canvas, Math.floor(lx * a.w), Math.floor(ly * a.h), 1, 1, 0, 0, 1, 1);
      if (g.getImageData(0, 0, 1, 1).data[3] > 40) layer = l.id;
    }
    this.paintLayer.set(z.id, { key, layer });
    return layer;
  }

  private prepareEyes(eyes: EyeZone[], live?: Map<string, HTMLCanvasElement>) {
    const gl = this.gl;
    // lid curves
    if (eyes.length !== this.lutKey.length || eyes.some((z, i) => eyeLut(z) !== this.lutKey[i])) {
      const data = new Float32Array((LUT_N + 1) * MAX_EYES * 4);
      eyes.forEach((z, row) => {
        const lut = eyeLut(z);
        for (let i = 0; i <= LUT_N; i++) {
          const o = (row * (LUT_N + 1) + i) * 4;
          data[o] = lut.up[i];
          data[o + 1] = lut.lo[i];
          data[o + 3] = 1;
        }
      });
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); // these are numbers, not colours
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, LUT_N + 1, MAX_EYES, gl.RGBA, gl.FLOAT, data);
      this.lutKey = eyes.map((z) => eyeLut(z));
    }
    // eye paint atlas
    const src = (z: EyeZone, kind: 'paint' | 'ctl') => live?.get(`${z.id}:${kind}`) ?? (z[kind] ? images.get(z[kind]!)?.canvas : undefined);
    const key = eyes.map((z) => `${z.paint}|${z.ctl}`).join(';');
    const anyLive = !!live?.size;
    if (key !== this.atlasKey || anyLive) {
      this.atlasKey = anyLive ? '' : key;
      const any = eyes.some((z) => src(z, 'paint') || src(z, 'ctl'));
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      if (any) {
        this.atlasCanvas ??= makeCanvas(CELL * MAX_EYES, CELL * 2);
        const g = this.atlasCanvas.getContext('2d')!;
        g.clearRect(0, 0, CELL * MAX_EYES, CELL * 2);
        eyes.forEach((z, col) => {
          const p = src(z, 'paint'), c = src(z, 'ctl');
          if (p) g.drawImage(p, col * CELL, 0, CELL, CELL);
          if (c) g.drawImage(c, col * CELL, CELL, CELL, CELL);
        });
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlasCanvas);
      }
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  render(doc: Doc, f: RigFrame, view: View, opts: RenderOptions = {}) {
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    this.guarded = 0;
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
    gl.uniform1i(this.u.uLut, 1);
    gl.uniform1i(this.u.uAtlas, 2);

    const allEyes = doc.zones.filter((z): z is EyeZone => z.type === 'eye').slice(0, MAX_EYES);
    this.prepareEyes(allEyes, opts.livePaint);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.activeTexture(gl.TEXTURE0);

    const mouths = doc.zones.filter((z): z is MouthZone => z.type === 'mouth' && z.enabled && !!f.mouths[z.id]);
    const A = new Float32Array(16), B = new Float32Array(16), C = new Float32Array(16), D = new Float32Array(16), E = new Float32Array(16), F = new Float32Array(16);
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
      gl.uniform1f(this.u.uTexel, (l.w * l.scale) / (images.get(l.image)?.w ?? l.w));
      gl.uniform4f(this.u.uSolid, 0, 0, 0, 0);

      let ne = 0;
      allEyes.forEach((z, row) => {
        const e = f.eyes[z.id];
        if (ne >= 4 || !e || !z.enabled || !zoneHitsLayer(z, l.id)) return;
        const [p, q] = z.a.x <= z.b.x ? [z.a, z.b] : [z.b, z.a];
        const lut = eyeLut(z);
        const box = z.box ?? eyeBox(z);
        const hasPaint = (z.paint || opts.livePaint?.has(`${z.id}:paint`)) && this.paintTarget(doc, z) === l.id;
        const hasMarks = z.ctl || opts.livePaint?.has(`${z.id}:ctl`);
        A.set([p.x, p.y, q.x, q.y], ne * 4);
        B.set([lut.hU, lut.hL, row, row], ne * 4);
        C.set([z.band, z.skin, z.fill === 'soft' ? 1 : 0, z.roll], ne * 4);
        D.set([e.upper, e.lower, e.arc, z.meet], ne * 4);
        E.set([e.gx, e.gy, z.loBand, (hasPaint ? 1 : 0) + (hasMarks ? 2 : 0)], ne * 4);
        F.set([box.x, box.y, box.w, box.h], ne * 4);
        ne++;
      });
      gl.uniform1i(this.u.uEyeN, ne);
      if (ne) {
        gl.uniform4fv(this.u.uEyeA, A); gl.uniform4fv(this.u.uEyeB, B); gl.uniform4fv(this.u.uEyeC, C);
        gl.uniform4fv(this.u.uEyeD, D); gl.uniform4fv(this.u.uEyeE, E); gl.uniform4fv(this.u.uEyeF, F);
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
    // forget meshes and textures of things that no longer exist
    if (this.meshes.size > doc.layers.length) {
      const live = new Set(doc.layers.map((l) => l.id));
      for (const id of this.meshes.keys()) if (!live.has(id)) this.meshes.delete(id);
    }
    if (this.textures.size > doc.layers.length + 24) {
      for (const [id, t] of this.textures) if (!images.has(id)) { gl.deleteTexture(t.tex); this.textures.delete(id); }
    }
  }
}

/** A view that fits the artboard inside a w×h box. */
export function fitView(doc: { width: number; height: number }, w: number, h: number, pad = 0): View {
  const zoom = Math.min((w - pad * 2) / doc.width, (h - pad * 2) / doc.height);
  return { zoom, panX: (w - doc.width * zoom) / 2, panY: (h - doc.height * zoom) / 2 };
}
