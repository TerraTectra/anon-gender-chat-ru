import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const THEMES = {
  spark: ["#211348", "#9045f5"], moon: ["#071b35", "#406cbb"],
  wave: ["#062c42", "#06a7ac"], mask: ["#2b1337", "#ce5c9c"],
  door: ["#182e30", "#42a89b"], bubble: ["#37201a", "#e8985e"],
  chat: ["#162445", "#4b81ed"], heart: ["#3a1533", "#dc5387"]
};
const SIZE = 512;
const clamp = (v) => Math.max(0, Math.min(1, v));
const hex = (color) => [1, 3, 5].map((n) => parseInt(color.slice(n, n + 2), 16));
const distance = (x, y, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, v = (dx * dx + dy * dy) || 1;
  const t = clamp(((x - ax) * dx + (y - ay) * dy) / v);
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
};
const segment = (x, y, a, b, width) => 1 - clamp((distance(x, y, ...a, ...b) - width) * 1.3);
const polyline = (x, y, pts, width) => {
  let opacity = 0;
  for (let k = 1; k < pts.length; k++) opacity = Math.max(opacity, segment(x, y, pts[k - 1], pts[k], width));
  return opacity;
};
function shape(x, y, kind) {
  const X = x - 256, Y = y - 256, R = Math.hypot(X, Y);
  const stroke = (f) => 1 - clamp((Math.abs(f) - 6) / 2);
  if (kind === "spark") {
    const a = polyline(X, Y, [[0,-101],[0,101]], 9);
    const b = polyline(X, Y, [[-101,0],[101,0]], 9);
    const c = polyline(X, Y, [[-69,-69],[69,69]], 6);
    const d = polyline(X, Y, [[-69,69],[69,-69]], 6);
    return Math.max(a,b,c,d);
  }
  if (kind === "moon") {
    const moon = Math.hypot(X+14,Y+4) - 103;
    const cut = Math.hypot(X+68,Y-39) - 95;
    const crescent = clamp(-moon/2) * clamp(cut/2);
    const dot = Math.max(0, 1 - Math.hypot(X-88,Y+60)/6);
    return Math.max(crescent,dot);
  }
  if (kind === "wave") {
    let opacity=0;
    for(const dy of [-44,0,44]){
      const yy = dy + Math.sin((X+110)/220*Math.PI*2)*26;
      if(Math.abs(X)<122) opacity=Math.max(opacity,stroke(Y-yy));
    }
    return opacity;
  }
  if (kind === "mask") {
    const shell = Math.pow(X/123,2)+Math.pow(Y/105,2);
    const outline=stroke((Math.sqrt(shell)-1)*110);
    const leftEye=Math.hypot((X+49)/31,(Y+12)/18)<1?0:1;
    const rightEye=Math.hypot((X-49)/31,(Y+12)/18)<1?0:1;
    const face=clamp((1-shell)*8)*leftEye*rightEye*0.62;
    return Math.max(face,outline);
  }
  if (kind === "door") {
    const vertical = Math.abs(X) > 106 ? 0 : 0;
    const frame = Math.max(polyline(X,Y,[[-100,108],[-100,-108],[100,-108],[100,108]],8),
      polyline(X,Y,[[-100,108],[100,108]],8));
    const knob = 1 - clamp((Math.hypot(X-63,Y-1)-10)/2);
    return Math.max(frame,knob);
  }
  if (kind === "bubble") {
    const outer = Math.hypot(X/123,Y/98);
    const ring = stroke((outer-1)*100);
    const dots = [-55,0,55].map(dx=> 1 - clamp((Math.hypot(X-dx,Y)-13)/2));
    return Math.max(ring,...dots);
  }
  if (kind === "chat") {
    const box = Math.max(Math.abs(X)/124,Math.abs((Y+16)/88));
    const frame=stroke((box-1)*92);
    const tail=polyline(X,Y,[[-36,72],[-63,121],[13,74]],7);
    const lines=Math.max(...[-26,13].map(dy=>polyline(X,Y,[[-65,dy],[65,dy]],6)));
    return Math.max(frame,tail,lines);
  }
  if (kind === "heart") {
    const points=[];
    for(let i=0;i<=110;i++){
      const t=i*Math.PI*2/110;
      const px=16*Math.pow(Math.sin(t),3)*7;
      const py=-(13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t))*7;
      points.push([px,py]);
    }
    return polyline(X,Y,points,9);
  }
  return Math.max(0,1-R/100);
}
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for(let i=0;i<8;i++)crc = (crc>>>1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff)>>>0;
}
function chunk(name,data) {
  const kind = Buffer.from(name);
  const len=Buffer.alloc(4), check=Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  check.writeUInt32BE(crc32(Buffer.concat([kind,data])));
  return Buffer.concat([len,kind,data,check]);
}
function png(bytes) {
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE,0); ihdr.writeUInt32BE(SIZE,4); ihdr[8]=8; ihdr[9]=6;
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(bytes,{level:9})),
    chunk("IEND",Buffer.alloc(0))
  ]);
}
export function ensureVariantAvatar(profile, directory = "./assets/avatars") {
  const output=path.resolve(directory,profile.id + ".png");
  if(fs.existsSync(output))return output;
  const [start,end]=(THEMES[profile.icon]||THEMES.chat).map(hex);
  const rows=Buffer.alloc(SIZE*(1+SIZE*4));
  for(let y=0;y<SIZE;y++){
    const offset=y*(1+SIZE*4);
    for(let x=0;x<SIZE;x++){
      const p=offset+1+x*4;
      const f=clamp((x+y)/(SIZE*2));
      const v=1-Math.pow(Math.hypot((x-256)/350,(y-256)/350),2)*0.3;
      const ring=Math.hypot(x-256,y-256);
      const halo=0.2*Math.exp(-Math.pow((ring-156)/22,2));
      const rim=Math.exp(-Math.pow((ring-185)/2.3,2))*0.55;
      const icon=shape(x,y,profile.icon);
      const depth=clamp(icon+rim);
      for(let k=0;k<3;k++){
        const base=(start[k]*(1-f)+end[k]*f)*v+halo*80;
        rows[p+k]=Math.round(Math.max(0,Math.min(255,base*(1-depth)+(237+rim*17)*depth)));
      }
      rows[p+3]=255;
    }
  }
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,png(rows));
  return output;
}
