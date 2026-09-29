#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{once}=require('node:events');
const args={};
for(let i=2;i<process.argv.length;i++){
  const key=process.argv[i];
  if(key==='--preview'||key==='--help')args[key.slice(2)]=true;
  else if(['--plan','--modules','--ffmpeg'].includes(key))args[key.slice(2)]=process.argv[++i];
  else throw Error('Unknown argument: '+key);
}
if(args.help){console.log('render.cjs --plan plan.json [--modules node_modules] [--ffmpeg binary] [--preview]');process.exit(0);}
if(!args.plan)throw Error('--plan is required');
const planPath=path.resolve(args.plan),plan=JSON.parse(fs.readFileSync(planPath,'utf8')),work=path.dirname(planPath);
function dependency(name){return require(args.modules?path.join(path.resolve(args.modules),name):name);}
const {createCanvas,loadImage}=dependency('@napi-rs/canvas');
const sharp=dependency('sharp');
const W=plan.width??900,PH=plan.panelHeight??600,H=PH*2,FPS=plan.fps??24,DURATION=plan.duration??4;
const smallW=plan.gifWidth??720,smallH=Math.round(smallW*H/W),count=Math.round(FPS*DURATION);
const motions=plan.motions??[],out=path.resolve(work,plan.outputDir??'result'),name=plan.name??'scene';
const clamp=v=>Math.max(0,Math.min(1,v)),ease=v=>{v=clamp(v);return v*v*(3-2*v)};
function requireTrue(condition,message){if(!condition)throw Error(message);}
requireTrue([W,PH,FPS,count,smallW,smallH].every(v=>Number.isInteger(v)&&v>0),'Invalid dimensions or frame count');
requireTrue(DURATION>0&&DURATION<=12&&FPS<=30&&count<=360,'Use duration <=12 seconds and fps <=30');
requireTrue(/^[a-z0-9][a-z0-9_-]*$/i.test(name),'name must be a simple filename stem');
requireTrue(Array.isArray(motions)&&motions.length<=2,'At most two motion anchors');
function point(p){return [p[0]*W,p[1]*PH];}
function polygon(c,ps){c.beginPath();ps.forEach((p,i)=>{const [x,y]=point(p);i?c.lineTo(x,y):c.moveTo(x,y)});c.closePath();}
function inside(x,y,ps){let yes=false;for(let i=0,j=ps.length-1;i<ps.length;j=i++){
  const [xi,yi]=point(ps[i]),[xj,yj]=point(ps[j]);
  if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))yes=!yes;
}return yes;}
function lineY(line,x){const [x1,y1]=point(line.slice(0,2)),[x2,y2]=point(line.slice(2));return y1+(y2-y1)*(x-x1)/(x2-x1);}
function within(x,y,r){return x>=r[0]&&x<r[2]&&y>=r[1]&&y<r[3];}
function sample(src,x,y,dest,index){
  x=Math.max(0,Math.min(W-1.001,x));y=Math.max(0,Math.min(PH-1.001,y));
  const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0,i=(y0*W+x0)*4,j=i+W*4;
  for(let c=0;c<3;c++)dest[index+c]=(src[i+c]*(1-fx)+src[i+4+c]*fx)*(1-fy)+(src[j+c]*(1-fx)+src[j+4+c]*fx)*fy;
}
async function main(){
  fs.mkdirSync(out,{recursive:true});
  let photo,art;
  if(plan.referencePair){
    const pair=await loadImage(path.resolve(work,plan.referencePair));
    photo=createCanvas(W,PH);photo.getContext('2d').drawImage(pair,0,0,pair.width,pair.height/2,0,0,W,PH);
    art=createCanvas(W,PH);art.getContext('2d').drawImage(pair,0,pair.height/2,pair.width,pair.height/2,0,0,W,PH);
  }else{
    requireTrue(plan.photo&&plan.illustration,'Supply photo and illustration, or referencePair');
    photo=await loadImage(await sharp(path.resolve(work,plan.photo)).rotate().resize(W,PH,{fit:'cover',position:plan.photoPosition??'centre'}).png().toBuffer());
    art=await loadImage(path.resolve(work,plan.illustration));
  }
  const base=createCanvas(W,H),bc=base.getContext('2d');bc.drawImage(photo,0,0,W,PH);bc.drawImage(art,0,PH,W,PH);
  bc.fillStyle='#f2eadc';bc.fillRect(0,PH-2,W,4);
  const source=bc.getImageData(0,PH,W,PH).data;
  const types=['drift','head-sway','flag-flutter','light-pulse','wave-crest','exposure','cutout-move'];
  for(const m of motions){
    requireTrue(types.includes(m.type),'Unknown motion: '+m.type);
    requireTrue(Array.isArray(m.rect)&&m.rect.length===4&&m.rect.every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&m.rect[0]<m.rect[2]&&m.rect[1]<m.rect[3],'Invalid normalized motion rect');
    m.bounds=[Math.floor(m.rect[0]*W),Math.floor(m.rect[1]*PH),Math.ceil(m.rect[2]*W),Math.ceil(m.rect[3]*PH)];
    m.cycles=m.cycles??1;requireTrue(Number.isInteger(m.cycles)&&m.cycles>0,'cycles must be a positive integer');
    if(['head-sway'].includes(m.type))requireTrue(m.center&&m.radius&&m.pivot,'head-sway requires center, radius and pivot');
    if(m.type==='flag-flutter')requireTrue(m.cordLine&&m.clothLength>0,'flag-flutter requires cordLine and clothLength');
    if(['light-pulse','exposure','wave-crest'].includes(m.type))requireTrue(m.polygons?.length,'This motion requires a polygon mask');
    if(m.type==='wave-crest')requireTrue(m.path?.length,'wave-crest requires a path');
    if(m.type==='cutout-move'){
      requireTrue(m.sprite&&m.start&&m.end&&m.spriteWidth>0,'cutout-move requires sprite, start, end and spriteWidth');
      const file=path.resolve(work,m.sprite),meta=await sharp(file).metadata();requireTrue(meta.hasAlpha,'Sprite must have alpha');
      const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      let transparent=false;for(let i=3;i<data.length;i+=info.channels)if(data[i]<200){transparent=true;break;}
      requireTrue(transparent,'Sprite background is opaque');m.spriteImage=await loadImage(await sharp(file).trim({threshold:1}).png().toBuffer());
    }
  }
  const wave=createCanvas(W,PH),wc=wave.getContext('2d');
  function draw(time){
    const canvas=createCanvas(W,H),c=canvas.getContext('2d');c.drawImage(base,0,0);
    const t=((time%DURATION)+DURATION)%DURATION;
    for(const m of motions){
      const phase=t*m.cycles/DURATION,angle=phase*Math.PI*2,rect=m.bounds;
      if(m.type==='cutout-move'){
        const q=phase%1,move=ease(q/.76),reset=ease((q-.80)/.17);
        const start=point(m.start),end=point(m.end),sprite=m.spriteImage,sw=m.spriteWidth*W,sh=sw*sprite.height/sprite.width;
        c.save();c.translate(0,PH);c.beginPath();c.rect(rect[0],rect[1],rect[2]-rect[0],rect[3]-rect[1]);c.clip();
        for(const [p,a] of [[move,1-reset],[0,reset]])if(a>0){c.globalAlpha=a;const x=start[0]+(end[0]-start[0])*p,y=start[1]+(end[1]-start[1])*p;c.drawImage(sprite,x-sw/2,y-sh/2,sw,sh);}
        c.globalAlpha=1;
        if(m.occluders?.length){c.save();c.beginPath();for(const ps of m.occluders){ps.forEach((p,i)=>{const [x,y]=point(p);i?c.lineTo(x,y):c.moveTo(x,y)});c.closePath();}c.clip();c.drawImage(art,0,0,W,PH);c.restore();}
        c.restore();continue;
      }
      if(m.type==='wave-crest'){
        wc.clearRect(0,0,W,PH);wc.save();const q=phase%1,[dx,dy]=point(m.displacement??[.018,0]);wc.translate(dx*(1-q),dy*(1-q));
        const color=m.color??[244,242,219];wc.strokeStyle=`rgb(${color.join(',')})`;wc.lineWidth=m.lineWidth??1.8;wc.lineCap='round';wc.globalAlpha=Math.sin(Math.PI*q);wc.setLineDash([20,3,9,2,27,4]);wc.beginPath();
        for(const cmd of m.path){if(cmd[0]==='M'){const [x,y]=point(cmd.slice(1));wc.moveTo(x,y);}else if(cmd[0]==='C'){const a=point(cmd.slice(1,3)),b=point(cmd.slice(3,5)),d=point(cmd.slice(5,7));wc.bezierCurveTo(...a,...b,...d);}else throw Error('Only M/C path commands are supported');}
        wc.stroke();wc.restore();
        const img=wc.getImageData(0,0,W,PH);
        for(let y=0;y<PH;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4;if(!within(x,y,rect)||!m.polygons.some(ps=>inside(x+.5,y+.5,ps))||(m.blueWaterOnly&&!(source[i+2]>source[i]*1.04&&source[i+1]>source[i]*1.08)))img.data[i+3]=0;}
        const dest=c.getImageData(0,PH,W,PH);
        for(let i=0;i<img.data.length;i+=4){const alpha=img.data[i+3]/255;if(alpha>0)for(let channel=0;channel<3;channel++)dest.data[i+channel]=dest.data[i+channel]*(1-alpha)+img.data[i+channel]*alpha;}
        c.putImageData(dest,0,PH);continue;
      }
      const img=c.getImageData(0,PH,W,PH);
      for(let y=rect[1];y<rect[3];y++)for(let x=rect[0];x<rect[2];x++){
        const i=(y*W+x)*4;
        if(['light-pulse','exposure'].includes(m.type)){
          if(!m.polygons.some(ps=>inside(x+.5,y+.5,ps)))continue;
          const r=source[i],g=source[i+1],b=source[i+2],lum=(r+g+b)/3,level=.5-.5*Math.cos(angle);
          if(m.maxLuminance!==undefined&&lum>m.maxLuminance)continue;
          if(m.type==='light-pulse'){
            const amount=level*(m.strength??.88),color=m.color??[255,229,164],grain=(lum-85)*.3;
            for(let channel=0;channel<3;channel++)img.data[i+channel]=source[i+channel]*(1-amount)+Math.min(255,color[channel]+grain)*amount;
          }else{
            const gain=m.nightGain??[.06,.065,.075],lift=m.nightLift??[6,7,10];
            for(let channel=0;channel<3;channel++)img.data[i+channel]=source[i+channel]*(1-level)+(source[i+channel]*gain[channel]+lift[channel])*level;
          }continue;
        }
        let sx=x,sy=y;
        if(m.type==='drift'){
          if(m.ceilingLine&&y>=lineY(m.ceilingLine,x))continue;
          let w=ease((x-rect[0])/Math.max(1,(rect[2]-rect[0])*.07))*ease((rect[2]-x)/Math.max(1,(rect[2]-rect[0])*.07));
          if(m.fadeY!==false)w*=ease((y-rect[1])/Math.max(1,(rect[3]-rect[1])*.10))*ease((rect[3]-y)/Math.max(1,(rect[3]-rect[1])*.10));
          const [dx,dy]=point(m.displacement??[.025,0]);sx-=dx*Math.sin(angle)*w;sy-=dy*Math.sin(angle)*w;
          if(m.ceilingLine)sy=Math.min(sy,lineY(m.ceilingLine,sx)-1);
        }else if(m.type==='head-sway'){
          const [cx,cy]=point(m.center),[rx,ry]=point(m.radius),[px,py]=point(m.pivot);
          const weight=1-ease((Math.hypot((x-cx)/rx,(y-cy)/ry)-.62)/.38);if(weight<=0)continue;
          const turn=(m.angleDegrees??3.5)*Math.PI/180*Math.sin(angle)*weight,cs=Math.cos(turn),sn=Math.sin(turn),[dx,dy]=point(m.displacement??[.003,.003]);
          sx=px+(x-px)*cs+(y-py)*sn-dx*Math.sin(angle)*weight;sy=py-(x-px)*sn+(y-py)*cs-dy*Math.sin(angle)*weight;
          for(const ear of m.ears??[]){const [ex,ey]=point(ear.center),[erx,ery]=point(ear.radius),w=1-ease((Math.hypot((x-ex)/erx,(y-ey)/ery)-.2)/.8);sy-=(m.earAmplitude??.01)*PH*Math.sin(angle*2)*w*(ear.sign??1);}
        }else if(m.type==='flag-flutter'){
          const below=y-lineY(m.cordLine,x),length=m.clothLength*PH;if(below<1||below>length*1.4)continue;
          const edge=ease((x-rect[0])/Math.max(1,(rect[2]-rect[0])*.12))*ease((rect[2]-x)/Math.max(1,(rect[2]-rect[0])*.12));
          const cloth=ease(below/(length*.6))*(1-ease((below-length)/(length*.4))),local=(x-rect[0])/Math.max(1,(rect[2]-rect[0]))*3.7;
          const flutter=(Math.sin(angle+local)-Math.sin(local))*.74+Math.sin(angle*2)*.26,[dx,dy]=point(m.amplitude??[.003,.011]);
          sx-=dx*flutter*edge*cloth;sy-=dy*flutter*edge*cloth;
        }
        if(Math.abs(sx-x)+Math.abs(sy-y)>.00001)sample(source,sx,sy,img.data,i);
      }
      c.putImageData(img,0,PH);
    }return canvas;
  }
  const active=plan.activeTime??DURATION*.23,still=draw(0);fs.writeFileSync(path.join(out,name+'.png'),still.toBuffer('image/png'));
  const proof=createCanvas(W*2,H),pc=proof.getContext('2d');pc.drawImage(still,0,0);pc.drawImage(draw(active),W,0);fs.writeFileSync(path.join(out,'motion-proof.png'),proof.toBuffer('image/png'));
  const a=still.getContext('2d').getImageData(0,0,W,H).data,b=draw(active).getContext('2d').getImageData(0,0,W,H).data,end=draw(DURATION).getContext('2d').getImageData(0,0,W,H).data;
  let changed=0,photoChanged=0,outsideAnchor=0,loopChanged=0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4;
    if(a[i]!==end[i]||a[i+1]!==end[i+1]||a[i+2]!==end[i+2])loopChanged++;
    if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2]){changed++;if(y<PH)photoChanged++;if(y<PH||!motions.some(m=>within(x,y-PH,m.bounds)))outsideAnchor++;}}
  const verification={anchorCount:motions.length,duration:DURATION,changedPixels:changed,photoChanged,outsideAnchor,loopChanged};
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(verification,null,2));
  requireTrue(!photoChanged&&!outsideAnchor&&!loopChanged,'Motion escaped its anchor or loop boundary');
  requireTrue(!motions.length||changed>40,'Chosen preview time has no visible motion; adjust activeTime/geometry');
  console.log(JSON.stringify(verification));
  if(args.preview||!motions.length)return;
  const small=createCanvas(smallW,smallH),sc=small.getContext('2d');
  if(args.ffmpeg){
    function start(extra){const child=spawn(path.resolve(args.ffmpeg),['-hide_banner','-loglevel','error','-y','-f','image2pipe','-c:v','mjpeg','-framerate',String(FPS),'-i','pipe:0',...extra],{stdio:['pipe','ignore','pipe']});let err='';child.stderr.on('data',d=>err+=d);const completion=once(child,'close').then(([code])=>{if(code!==0)throw Error(err)});return {child,completion};}
    const video=start(['-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',path.join(out,name+'.mp4')]);
    const gif=start(['-filter_complex','split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3','-loop','0',path.join(out,name+'.gif')]);
    for(let i=0;i<count;i++){const frame=draw(i/FPS);if(!video.child.stdin.write(frame.toBuffer('image/jpeg',98)))await once(video.child.stdin,'drain');sc.drawImage(frame,0,0,smallW,smallH);if(!gif.child.stdin.write(small.toBuffer('image/jpeg',98)))await once(gif.child.stdin,'drain');}
    video.child.stdin.end();gif.child.stdin.end();await Promise.all([video.completion,gif.completion]);
  }else{
    const bytes=smallW*smallH*4,stack=Buffer.alloc(bytes*count),delays=[];let elapsed=0;
    for(let i=0;i<count;i++){sc.drawImage(draw(i/FPS),0,0,smallW,smallH);Buffer.from(sc.getImageData(0,0,smallW,smallH).data).copy(stack,i*bytes);const next=Math.round((i+1)*100/FPS)*10;delays.push(next-elapsed);elapsed=next;}
    await sharp(stack,{raw:{width:smallW,height:smallH*count,channels:4,pageHeight:smallH},limitInputPixels:false}).gif({loop:0,delay:delays,effort:3,dither:.6,interPaletteMaxError:256,keepDuplicateFrames:true}).toFile(path.join(out,name+'.gif'));
  }
  console.log(JSON.stringify({png:path.join(out,name+'.png'),gif:path.join(out,name+'.gif'),mp4:args.ffmpeg?path.join(out,name+'.mp4'):null}));
}
main().catch(error=>{console.error(error.stack??error);process.exitCode=1;});
