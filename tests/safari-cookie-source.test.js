const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../content/sidebar-browser.js'), 'utf8');
function helper(name) {
  let start = source.indexOf('  async function ' + name + '(');
  if (start < 0) start = source.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n  }\n', start) + 5);
}
function load(context, names) {
  const ctx = vm.createContext(context);
  for (const name of names) vm.runInContext(helper(name), ctx);
  return ctx;
}
const names = ['safariCookieError', 'inspectSafariCookieFile', 'cookieSourceLabel', 'updateSafariCookieState', 'addSafariCookieSource'];
const header = Uint8Array.from([99,111,111,107]);
function denied() { return Object.assign(new Error('NS_ERROR_FILE_ACCESS_DENIED /private/secret-value'), {name:'NotAllowedError'}); }
function state(extra={}) {
  const messages=[], dropdown={value:'0',items:[],getValue(){return this.value;},setDisabled(){},setItems(items,label,value){this.items=items;this.value=items.some(x=>x.value===value)?value:items[0]?.value;}};
  return {IOUtils:{read:async()=>header}, autoCookieSources:[],autoCookieSourceDropdown:dropdown,
    autoCookieButton:{},safariAccessBox:{style:{}},safariFileHint:{},showToast:(...args)=>messages.push(args),messages,...extra};
}
test('Safari discovery probes only the format header and retains a blocked source without calling it readable', async()=>{
  const calls=[];
  const ctx=load(state({IOUtils:{async read(path,options){calls.push({path,options});if(path==='blocked')throw denied();return header;}}}),names);
  const list=[];await ctx.addSafariCookieSource(list,'blocked','Container');await ctx.addSafariCookieSource(list,'ok','Readable');await ctx.addSafariCookieSource(list,'ok','Duplicate');
  assert.equal(list.length,2);assert.equal(list[0].access,'blocked');assert.equal(list[1].access,'readable');assert.ok(calls.every(c=>c.options.maxBytes===4));
  ctx.autoCookieSources=list;ctx.updateSafariCookieState();assert.equal(ctx.autoCookieButton.disabled,true);assert.equal(ctx.safariAccessBox.style.display,'block');assert.match(ctx.cookieSourceLabel(list[0]),/需要授权/);
  ctx.autoCookieSourceDropdown.value='1';ctx.updateSafariCookieState();assert.equal(ctx.autoCookieButton.disabled,false);assert.equal(ctx.safariAccessBox.style.display,'none');
});
test('missing files, invalid format and other read errors remain distinct from macOS authorization errors',async()=>{
  const ctx=load(state(),names);
  assert.equal(ctx.safariCookieError(denied()).code,'SAFARI_PERMISSION');assert.doesNotMatch(ctx.safariCookieError(denied()).message,/secret-value/);
  ctx.IOUtils.read=async()=>{throw Object.assign(new Error('missing'),{name:'NotFoundError'});};assert.equal((await ctx.inspectSafariCookieFile('x')).access,'missing');
  ctx.IOUtils.read=async()=>{throw new TypeError('IO failure');};assert.equal((await ctx.inspectSafariCookieFile('x')).access,'error');
  ctx.IOUtils.read=async()=>new Uint8Array(4);assert.equal((await ctx.inspectSafariCookieFile('x')).access,'invalid');
});
function pickerContext(result,ioRead=async()=>header) {
  const calls=[];
  class FilePicker {
    constructor(){this.modeOpen=0;this.returnOK=0;this.filterAll=1;this.file='/copy/Cookies.binarycookies';}
    init(win,title,mode){assert.ok(win.browsingContext);calls.push({win,title,mode});}
    appendFilter(){}appendFilters(){}async show(){return result;}
  }
  const ctx=load(state({IOUtils:{read:ioRead},doc:{defaultView:{browsingContext:{id:1}}},PathUtils:{parent:p=>path.dirname(p)},ChromeUtils:{importESModule:()=>({FilePicker})}}),[...names,'chooseSafariCookieFile']);
  return {ctx,calls};
}
test('Zotero FilePicker wrapper supplies the window context; cancel does not replace the selected source',async()=>{
  const {ctx,calls}=pickerContext(1);const old={type:'safari',path:'/old',access:'readable'};ctx.autoCookieSources=[old];await ctx.chooseSafariCookieFile();assert.equal(calls.length,1);assert.equal(ctx.autoCookieSources[0],old);assert.equal(ctx.messages.length,0);
});
test('manual Safari selection checks real readability before enabling import; invalid files do not replace the source',async()=>{
  const {ctx}=pickerContext(0);await ctx.chooseSafariCookieFile();assert.equal(ctx.autoCookieSources[0].manuallySelected,true);assert.equal(ctx.autoCookieButton.disabled,false);assert.match(ctx.messages[0][0],/已验证/);
  const blocked=pickerContext(0,async()=>{throw denied();}).ctx;await blocked.chooseSafariCookieFile();assert.equal(blocked.autoCookieSources[0].access,'blocked');assert.equal(blocked.autoCookieButton.disabled,true);assert.equal(blocked.safariAccessBox.style.display,'block');
  const invalid=pickerContext(0,async()=>new Uint8Array(4)).ctx;await invalid.chooseSafariCookieFile();assert.equal(invalid.autoCookieSources.length,0);assert.match(invalid.messages[0][0],/不是 Safari/);
});
test('re-detection preserves the selected Safari source and the explicit file, and enables import after authorization',async()=>{
  const ctx=load(state({detectingCookieSources:false,homePath:()=>'/home',Zotero:{isMac:false},dump(){}}),[...names,'detectLocalCookieSources']);
  ctx.autoCookieSources=[{type:'chromium',dbPath:'/chrome'},{type:'safari',browserName:'Safari',profileName:'Manual',path:'/copy',access:'blocked',manuallySelected:true}];ctx.autoCookieSourceDropdown.value='1';
  await ctx.detectLocalCookieSources();assert.equal(ctx.autoCookieSources.length,1);assert.equal(ctx.autoCookieSources[0].path,'/copy');assert.equal(ctx.autoCookieSources[0].access,'readable');assert.equal(ctx.autoCookieSourceDropdown.getValue(),'0');assert.equal(ctx.autoCookieButton.disabled,false);
});
test('production Safari reader reports access denial and succeeds after access is restored, retaining exact domain filtering',async()=>{
  const parsed={cookies:[{domain:'arxiv.org',value:'synthetic'},{domain:'evil-arxiv.org',value:'other'}],stats:{expired:2},errors:[]};
  const ctx=load(state({IOUtils:{read:async()=>{throw denied();}},zbParseSafariBinaryCookies:()=>parsed,cookieDomainMatches:(host,domain)=>host===domain}),[...names,'readSafariCookieSource']);
  const selected={path:'/safari'};await assert.rejects(ctx.readSafariCookieSource(selected,'arxiv.org'),{code:'SAFARI_PERMISSION'});assert.equal(selected.access,'blocked');
  ctx.IOUtils.read=async()=>header;const result=await ctx.readSafariCookieSource(selected,'arxiv.org');assert.equal(selected.access,'readable');assert.equal(result.rows.length,1);assert.equal(result.stats.fileExpired,2);
  const all=await ctx.readSafariCookieSource(selected,'');assert.equal(all.rows.length,2);
});
