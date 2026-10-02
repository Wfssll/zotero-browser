const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '../content');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'zoom.sys.mjs'), 'utf8').replace('export const', 'var'), context);
const zoom = context.zbZoom;
function key(value, extra={}) {
  return { type:'keydown', key:value, metaKey:true, isTrusted:true, ...extra,
    preventDefault(){ this.defaultPrevented=true; }, stopImmediatePropagation(){this.stopped=true;} };
}
test('Command/Ctrl zoom accepts shifted plus, unshifted equals and numeric keypad; ignores unrelated or composing keys',()=>{
  for(const k of ['+','=','Add']) assert.equal(zoom.command(key(k)),'in');
  for(const k of ['-','Subtract']) assert.equal(zoom.command(key(k)),'out');
  assert.equal(zoom.command(key('0')),'reset');
  assert.equal(zoom.command(key('+',{metaKey:false,ctrlKey:true,shiftKey:true})),'in');
  for(const e of [key('+',{altKey:true}),key('+',{isComposing:true}),key('+',{keyCode:229}),key('+',{metaKey:false}),key('0',{shiftKey:true}),key('a'),key('+',{defaultPrevented:true})]) assert.equal(zoom.command(e),null);
});
test('page zoom stays within 50-300%, resets to 100%, and preserves independent tabs without touching the background',()=>{
  const tab={browser:{fullZoom:1}}, other={browser:{fullZoom:1},pageZoom:1};
  const home={style:{backgroundImage:'unchanged'}};
  assert.equal(zoom.apply(tab,home,'in'),1.1);assert.equal(tab.browser.fullZoom,1.1);assert.equal(home.style.zoom,'1.1');
  assert.equal(other.browser.fullZoom,1);assert.equal(home.style.backgroundImage,'unchanged');
  for(let n=0;n<50;n++) zoom.apply(tab,home,'in');assert.equal(tab.pageZoom,3);
  for(let n=0;n<50;n++) zoom.apply(tab,home,'out');assert.equal(tab.pageZoom,.5);
  zoom.apply(tab,home,'reset');assert.equal(tab.browser.fullZoom,1);
  assert.equal(zoom.apply(tab,home,'invalid'),null);
});
test('failed native zoom does not save a misleading tab ratio or change the home content',()=>{
  const tab={pageZoom:1,browser:{set fullZoom(v){throw Error('closed docshell');}}},home={style:{zoom:'1'}};
  assert.throws(()=>zoom.apply(tab,home,'in'),/closed/);assert.equal(tab.pageZoom,1);assert.equal(home.style.zoom,'1');
});
test('remote webpage and PDF actor forwards a zoom command once and leaves ordinary text entry alone',()=>{
  const ctx=vm.createContext({zbZoom:zoom,JSWindowActorChild:class {}});
  const source=fs.readFileSync(path.join(root,'actors/ZoteroBrowserEmbedChild.sys.mjs'),'utf8');
  vm.runInContext(source.replace(/^import .*;/m,'').replace('export class','class')+'\nthis.Actor=ZoteroBrowserEmbedChild;',ctx);
  const a=new ctx.Actor(),sent=[];a._isCaptchaFrame=()=>false;a._isChallengePageNow=()=>false;a._handleBilibiliSearch=()=>{};
  a.sendAsyncMessage=(name,data)=>sent.push({name,...data});
  const e=key('+');a.handleEvent(e);assert.equal(e.defaultPrevented,true);assert.equal(sent[0].command,'in');
  a.handleEvent(e);a.handleEvent(key('+',{isTrusted:false}));a.handleEvent(key('a'));assert.equal(sent.length,1);
});
test('legacy frame bridge deduplicates an already handled actor key and unregisters its parent listener',()=>{
  const listeners={},sent=[];const ctx=vm.createContext({content:{},ChromeUtils:{importESModule:()=>({zbZoom:zoom})},addEventListener:(name,fn)=>listeners[name]=fn,sendAsyncMessage:(name,data)=>sent.push({name,...data})});
  vm.runInContext(fs.readFileSync(path.join(root,'frame-script.js'),'utf8'),ctx);
  const e=key('-');listeners.keydown(e);assert.equal(sent[0].name,'zb-page-zoom');assert.equal(sent[0].command,'out');
  listeners.keydown(e);assert.equal(sent.length,1);
  const sidebar=fs.readFileSync(path.join(root,'sidebar-browser.js'),'utf8');
  assert.match(sidebar,/if \(b === browser\) zoomCurrentPage/);
  assert.match(sidebar,/removeMessageListener\("zb-page-zoom", b\._zbLegacyPageZoomListener\)/);
});

test('PDF shortcuts leave fit-to-width before scaling so a resize cannot undo the keyboard zoom',()=>{
  const source=fs.readFileSync(path.join(root,'pdf-viewer.js'),'utf8');
  const a=source.indexOf('function zbZoomPdfPage('),b=source.indexOf('\nwindow.zbZoomPdfPage',a);
  const ctx=vm.createContext({pdfDoc:{},fitWidth:true,zoom:.8,renderToken:0,window:{},updatePager(){},scheduleZoomPersist(){},clearTimeout(){},setTimeout(){return 1;},layoutPages(){}});
  vm.runInContext(source.slice(a,b),ctx);
  assert.equal(ctx.zbZoomPdfPage('in'),.9);assert.equal(ctx.fitWidth,false);
  assert.equal(ctx.zbZoomPdfPage('out'),.8);assert.equal(ctx.zbZoomPdfPage('reset'),1);
  ctx.pdfDoc=null;assert.equal(ctx.zbZoomPdfPage('in'),null);
});

test('remote PDF zoom reaches the viewer even when Gecko denies direct contentWindow access',async()=>{
  const source=fs.readFileSync(path.join(root,'sidebar-browser.js'),'utf8');
  const a=source.indexOf('  async function zoomCurrentPage('),b=source.indexOf('\n  function snapshotActiveTabPdf()',a);
  const calls=[],tab={pdfOpen:true,browser:{get contentWindow(){throw Error('remote');},browsingContext:{currentWindowGlobal:{getActor:()=>({sendQuery:async(name,data)=>{calls.push({name,...data});return 1.1;}})}}}};
  const ctx=vm.createContext({recordingShortcut:null,currentTab:()=>tab,showToast(){}});
  vm.runInContext(source.slice(a,b),ctx);await ctx.zoomCurrentPage('in');
  assert.equal(calls[0].name,'PDFZoom');assert.equal(calls[0].command,'in');assert.equal(tab.pageZoom,1.1);
});
