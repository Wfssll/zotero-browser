"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const root=path.join(__dirname,"..");
const context=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(root,"content/backgrounds.js"),"utf8"),context);
const api=context.zbBackgrounds;
function service(initial="{}",extra={}) {
  let saved=initial; const calls=[];
  const value=api.createService({read:()=>saved,write:v=>{saved=v;},fileURL:file=>"file://"+file,importImage:async()=>null,removeImage:async file=>calls.push(file),...extra});
  return {value,calls,saved:()=>saved};
}
test("all eight wallpaper and thumbnail assets are packaged JPEGs",()=>{
  assert.equal(api.presets.length,8);
  for(const preset of api.presets){for(const suffix of [".jpg","-thumb.jpg"]){const data=fs.readFileSync(path.join(root,"content/backgrounds",preset.id+suffix));assert.equal(data.readUInt16BE(),0xffd8);assert.ok(data.length>1000);}}
});
test("wallpaper selection, mask and position persist across restart; invalid preference values fall back safely",()=>{
  const s=service();s.value.update({id:"ocean",darkness:.4,position:"top"});
  const restored=service(s.saved()).value.snapshot();assert.equal(restored.id,"ocean");assert.equal(restored.darkness,.4);assert.equal(restored.position,"top");
  assert.equal(service("invalid JSON").value.snapshot().id,"none");
  const safe=api.normalize({id:"bad",darkness:9,position:"bad"});assert.equal(safe.id,"none");assert.equal(safe.darkness,.7);assert.equal(safe.position,"center");
});
test("cancelled and failed imports preserve the previous background; replacing removes only the old imported copy",async()=>{
  const s=service('{"id":"ocean"}');await s.value.importImage({});assert.equal(s.value.snapshot().id,"ocean");
  let file="/managed/photo1.jpg";const imported=service("{}",{importImage:async()=>file});
  await imported.value.importImage({});assert.equal(imported.value.snapshot().id,"custom");
  imported.value.update({id:"desert"});assert.equal(imported.value.snapshot().customFile,file);
  file="/managed/photo2.png";await imported.value.importImage({});assert.deepEqual(imported.calls,["/managed/photo1.jpg"]);
  await imported.value.removeCustom();assert.equal(imported.value.snapshot().id,"none");assert.equal(imported.value.snapshot().customFile,"");
  const failed=service('{"id":"ocean"}',{importImage:async()=>{throw Error("bad image");}});await assert.rejects(failed.value.importImage({}),/bad image/);assert.equal(failed.value.snapshot().id,"ocean");
});
test("active views receive live changes and unsubscribe cleanly; background removal restores the plain home",()=>{
  const s=service();let events=0;const dispose=s.value.subscribe(()=>events++);
  s.value.update({id:"desert"});assert.equal(events,2);dispose();s.value.update({id:"none"});assert.equal(events,2);
  let enabled;const view={classList:{toggle:(_name,on)=>{enabled=on;}},style:{}};
  api.apply(view,s.value,{id:"ocean",darkness:.25,position:"center"});assert.equal(enabled,true);assert.match(view.style.backgroundImage,/ocean\.jpg/);assert.match(view.style.backgroundImage,/0\.25/);
  api.apply(view,s.value,{id:"none",darkness:.25,position:"center"});assert.equal(enabled,false);assert.equal(view.style.backgroundImage,"none");
});

const bootstrap=fs.readFileSync(path.join(root,"bootstrap.js"),"utf8");
function importContext(file,options={}){
  const copied=[];let selectedFile=file;
  const directory={path:"/data",exists:()=>false,create(){},append(name){this.path+="/"+name;}};
  const ctx=vm.createContext({Zotero:{DataDirectory:{dir:"/data"},File:{pathToFile:()=>directory}},
    Services:{io:{newFileURI:()=>({spec:"file:///original/photo.jpg"})}},
    Components:{
      interfaces:{nsIFilePicker:{modeOpen:0,returnOK:0},nsIFile:{DIRECTORY_TYPE:1}},
      classes:{"@mozilla.org/filepicker;1":{createInstance:()=>({init(){},appendFilter(){},file:selectedFile,open(callback){callback(options.cancel?1:0);}})}}
    }
  });
  const start=bootstrap.indexOf("async function zbImportBackgroundImage(");vm.runInContext(bootstrap.slice(start,bootstrap.indexOf("\n}\n",start)+2),ctx);
  file.copyTo=(dir,name)=>copied.push({dir:dir.path,name});
  const win={browsingContext:{},Image:function(){this.decode=async()=>{if(options.invalid)throw Error("invalid");};}};
  return {copy:()=>ctx.zbImportBackgroundImage(win),copied};
}
test("native import copies a decoded image to plugin storage, leaves the original intact and rejects invalid, huge or cancelled selections",async()=>{
  const file={leafName:"photo.jpg",fileSize:1234};const ctx=importContext(file);const imported=await ctx.copy();
  assert.match(imported,/^\/data\/zotero-browser-backgrounds\/custom-.*\.jpg$/);assert.equal(ctx.copied.length,1);assert.equal(file.leafName,"photo.jpg");
  for(const [sample,options,pattern] of [[{leafName:"file.svg",fileSize:123},{},/请选择/],[{leafName:"file.png",fileSize:30*1024*1024},{},/20 MB/],[{leafName:"bad.jpg",fileSize:123},{invalid:true},/无法读取/]]){
    const bad=importContext(sample,options);await assert.rejects(bad.copy(),pattern);assert.equal(bad.copied.length,0);
  }
  const cancelled=importContext({leafName:"file.jpg",fileSize:123},{cancel:true});assert.equal(await cancelled.copy(),null);assert.equal(cancelled.copied.length,0);
});

function galleryNode(tag) {
  return { tag, style: {}, children: [], attributes: {}, events: {},
    appendChild(n) { this.children.push(n); },
    setAttribute(k,v) { this.attributes[k]=String(v); },
    getAttribute(k) { return k==='src' ? this.src || null : this.attributes[k] ?? null; },
    removeAttribute(k) { delete this.attributes[k]; if(k==='src') delete this.src; },
    addEventListener(k,fn) { this.events[k]=fn; }
  };
}
function galleryElements(root) { return [root,...root.children.flatMap(galleryElements)]; }
test("gallery previews selection and crop without saving until Apply; reopening discards an unapplied draft",()=>{
  const s=service('{"id":"ocean"}');const g=api.createGallery({createElement:galleryNode},s.value);
  const all=galleryElements(g.root),choose=id=>all.find(e=>e.attributes['aria-label']===id);
  const hero=all.find(e=>e.className==='zb-wallpaper-hero-image');
  const apply=all.find(e=>e.textContent==='应用背景');
  choose('雪山冰原').events.click();
  assert.match(hero.src,/ice-mountains\.jpg$/);assert.equal(s.value.snapshot().id,'ocean');
  const range=choose('背景遮罩深度');range.value='35';range.events.input();
  const position=choose('背景显示位置');position.value='top';position.events.change();
  assert.equal(s.value.snapshot().darkness,.18);assert.equal(hero.style.objectPosition,'top');
  g.resetPreview();assert.match(hero.src,/ocean\.jpg$/);assert.equal(apply.disabled,true);
  choose('沙漠').events.click();range.value='35';range.events.input();apply.events.click();
  assert.equal(s.value.snapshot().id,'desert');assert.equal(s.value.snapshot().darkness,.35);assert.equal(apply.disabled,true);
  assert.equal(choose('沙漠').children[0].children[2].hidden,false);
  assert.ok(all.filter(e=>e.className==='zb-wallpaper-thumbnail'&&e.src).length===8);
  g.dispose();s.value.update({id:'ocean'});assert.match(hero.src,/desert\.jpg$/);
});
test("unreadable gallery images show a fallback and cannot overwrite a working background",()=>{
  const s=service('{"id":"ocean"}');const g=api.createGallery({createElement:galleryNode},s.value);
  const all=galleryElements(g.root),hero=all.find(e=>e.className==='zb-wallpaper-hero-image');
  all.find(e=>e.attributes['aria-label']==='黄河').events.click();hero.events.error();
  assert.equal(hero.hidden,true);assert.equal(all.find(e=>e.textContent==='应用背景').disabled,true);
  assert.equal(s.value.snapshot().id,'ocean');
  all.find(e=>e.attributes['aria-label']==='纯色背景').events.click();
  assert.equal(all.find(e=>e.textContent==='应用背景').disabled,false);
  all.find(e=>e.textContent==='应用背景').events.click();assert.equal(s.value.snapshot().id,'none');
});
