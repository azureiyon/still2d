/* Optional monotone-x cubic chains. Legacy eyes are converted only on edit. */
(function(root){'use strict';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),mix=(a,b,t)=>a+(b-a)*t;
function cubic(a,b,c,d,t){const s=1-t;return s*s*s*a+3*s*s*t*b+3*s*t*t*c+t*t*t*d;}
function valid(path){if(!Array.isArray(path)||path.length<2||path.length>12)return false;for(let i=0;i<path.length;i++){const n=path[i];if(!n||['x','y','ix','iy','ox','oy'].some(k=>!Number.isFinite(n[k]))||Math.abs(n.y)>2||n.x<-.5||n.x>1.5||Math.abs(n.iy)>3||Math.abs(n.oy)>3)return false;if(i){const p=path[i-1];if(n.x-p.x<.003||p.ox<p.x||n.ix>n.x||p.ox>n.ix)return false;}}return true;}
function value(path,x){if(x<=path[0].x)return path[0].y;if(x>=path.at(-1).x)return path.at(-1).y;let i=1;while(path[i].x<x)i++;const a=path[i-1],b=path[i];let lo=0,hi=1;for(let j=0;j<16;j++){const t=(lo+hi)/2;if(cubic(a.x,a.ox,b.ix,b.x,t)<x)lo=t;else hi=t;}return cubic(a.y,a.oy,b.iy,b.y,(lo+hi)/2);}
function fromLegacy(eye,key){const g=root.Stillwave.EyeGeometry,p=eye[key]||g.curvePair(eye,key),xp=eye.controlsX?.[key]||[1/3,2/3];
 const nodes=[{x:0,y:0,ix:0,iy:0,ox:xp[0],oy:p[0]},{x:1,y:0,ix:xp[1],iy:p[1],ox:1,oy:0}];
 if(eye.bends?.[key]){const xs=[0,.25,.5,.75,1];return xs.map((x,i)=>{const y=g.ordinate(eye,key,x),a=Math.max(0,x-.001),b=Math.min(1,x+.001),s=(g.ordinate(eye,key,b)-g.ordinate(eye,key,a))/(b-a),left=i?(x-xs[i-1])/3:0,right=i<4?(xs[i+1]-x)/3:0;return{x,y,ix:x-left,iy:y-s*left,ox:x+right,oy:y+s*right};});}
 return split(nodes,.5);
}
function split(path,x){const nodes=structuredClone(path);if(nodes.length>=12)return nodes;let j=1;while(j<nodes.length&&nodes[j].x<x)j++;if(j===nodes.length||x<=nodes[0].x+.003||Math.min(x-nodes[j-1].x,nodes[j].x-x)<.006)return nodes;const a=nodes[j-1],b=nodes[j];let lo=0,hi=1;for(let k=0;k<20;k++){const t=(lo+hi)/2;if(cubic(a.x,a.ox,b.ix,b.x,t)<x)lo=t;else hi=t;}const t=(lo+hi)/2,A={x:mix(a.x,a.ox,t),y:mix(a.y,a.oy,t)},B={x:mix(a.ox,b.ix,t),y:mix(a.oy,b.iy,t)},C={x:mix(b.ix,b.x,t),y:mix(b.iy,b.y,t)},D={x:mix(A.x,B.x,t),y:mix(A.y,B.y,t)},E={x:mix(B.x,C.x,t),y:mix(B.y,C.y,t)},F={x:mix(D.x,E.x,t),y:mix(D.y,E.y,t)};a.ox=A.x;a.oy=A.y;b.ix=C.x;b.iy=C.y;nodes.splice(j,0,{x:F.x,y:F.y,ix:D.x,iy:D.y,ox:E.x,oy:E.y});return nodes;}
function move(path,index,type,x,y,key){const p=structuredClone(path),n=p[index],previous=p[index-1],next=p[index+1];
 if(type==='node'){if((key==='upper'||key==='lower'||key==='closed')&&(index===0||index===p.length-1))return p;const xx=clamp(x,previous?previous.x+.006:-.5,next?next.x-.006:1.5),yy=clamp(y,-2,2),dx=xx-n.x,dy=yy-n.y;n.x=xx;n.y=yy;n.ix+=dx;n.ox+=dx;n.iy+=dy;n.oy+=dy;}
 else if(type==='in'){n.ix=clamp(x,previous?previous.x:n.x,n.x);n.iy=clamp(y,-3,3);if(previous)previous.ox=Math.min(previous.ox,n.ix);}
 else{n.ox=clamp(x,n.x,next?next.x:n.x);n.oy=clamp(y,-3,3);if(next)next.ix=Math.max(next.ix,n.ox);}
 for(let i=0;i<p.length-1;i++){const a=p[i],b=p[i+1];a.ox=clamp(a.ox,a.x,b.x);b.ix=clamp(b.ix,a.ox,b.x);}return p;
}
function mirror(path){return [...path].reverse().map(n=>({x:1-n.x,y:n.y,ix:1-n.ox,iy:n.oy,ox:1-n.ix,oy:n.iy}));}
function remove(path,index){if(path.length<=2||index<=0||index>=path.length-1)return structuredClone(path);const p=structuredClone(path);p.splice(index,1);for(let i=0;i<p.length-1;i++){p[i].ox=clamp(p[i].ox,p[i].x,p[i+1].x);p[i+1].ix=clamp(p[i+1].ix,p[i].ox,p[i+1].x);}return p;}
root.Stillwave.CurvePaths={valid,value,fromLegacy,split,move,mirror,remove};
})(window);
