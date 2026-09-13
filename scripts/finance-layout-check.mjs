import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
// Run with: node scripts/finance-layout-check.mjs
// Mount the real component inside the global desktop grid, with sample bank data.
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(root+'/package.json');
const {build}=require('esbuild');
const {compile}=require('svelte/compiler');
const {chromium}=require('playwright');
const output=await fs.mkdtemp(path.join(os.tmpdir(),'polymux-finance-layout-'));
await fs.mkdir(output,{recursive:true});
await build({stdin:{contents:`import {mount} from 'svelte';import View from '${root}/apps/desktop/src/renderer/lib/features/workspace/FinanceView.svelte';mount(View,{target:document.getElementById('finance-fixture')});`,resolveDir:root},bundle:true,format:'iife',conditions:['browser'],outfile:output+'/app.js',loader:{'.png':'dataurl'},plugins:[{name:'finance-fixture',setup(b){b.onResolve({filter:/api\/polymux$/},()=>({path:'finance-api',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export function polymuxApi(){return window.fixtureApi}`,loader:'js'}));b.onLoad({filter:/\.svelte$/},async args=>({contents:compile(await fs.readFile(args.path,'utf8'),{filename:args.path,generate:'client',css:'injected'}).js.code,loader:'js',resolveDir:path.dirname(args.path)}));}}]});
const styles=await fs.readFile(root+'/apps/desktop/src/renderer/public/style.css','utf8');
const script=await fs.readFile(output+'/app.js','utf8');
const browser=await chromium.launch({headless:true});
const errors=[];
for(const theme of ['light','dark'])for(const mode of ['empty','populated'])for(const width of [280,380,465,760,1000]){
const page=await browser.newPage({viewport:{width:Math.max(1440,width+500),height:850},deviceScaleFactor:1});
page.on('pageerror',e=>errors.push(e.message));
await page.setContent(`<style>${styles}\nhtml,body{margin:0;width:100%;height:100%;overflow:hidden}#finance-fixture{height:100%;width:100%}</style><main style="--chat-drawer-column:240px;--content-right-column:${width}px"><div></div><div></div><div class="workspace-content" style="height:850px;width:${width}px"><div id="finance-fixture"></div></div></main>`);
await page.evaluate(mode=>{window.fixtureApi={mcp:{list:async()=>mode==='empty'?[]:[{id:'bank',name:'Example bank',enabled:true,status:'connected',toolNames:['bank__list_accounts','bank__get_transactions']}]},finance:{read:async req=>req.accountId?{transactions:[{id:'1',date:'2026-09-08',description:'Local coffee shop',status:'Booked',amount:-6.5,currency:'AUD'},{id:'2',date:'2026-09-08',description:'Transfer received',status:'Booked',amount:450,currency:'AUD'},{id:'3',date:'2026-09-07',description:'Public transport',status:'Booked',amount:-12.6,currency:'AUD'}],continuation:null}:{accounts:[{id:'a',name:'Everyday account',bank:'Example Bank',currency:'AUD',booked:2036.66,available:1988.1,balanceDate:'2026-09-08'},{id:'b',name:'Travel account',bank:'Example Bank',currency:'SGD',booked:850,available:850}],fetchedAt:new Date().toISOString()}}}},mode);
await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
await page.addScriptTag({content:script});
if(mode==='populated'){await page.getByLabel('BankMCP connection').selectOption('bank');await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('Local coffee shop').waitFor();}
await page.locator("#finance-fixture").screenshot({path:`${output}/${mode}-${width}-${theme}.png`});
const geometry=await page.evaluate(()=>{
 const content=document.querySelector('.finance-content');
 const card=document.querySelector('.card-area').getBoundingClientRect();
 const panel=document.querySelector('.statement-panel').getBoundingClientRect();
 return {width:document.querySelector('.finance').getBoundingClientRect().width,overlaps:panel.top<card.bottom-1,overflow:content.scrollWidth>content.clientWidth+1,panelHeight:panel.height,cardWidth:document.querySelector('.bank-card,.unconnected-card').getBoundingClientRect().width};
});
if(Math.abs(geometry.width-width)>1||geometry.overlaps||geometry.cardWidth<180||(mode==='empty'&&geometry.panelHeight>450))errors.push(`${mode} ${width}: invalid geometry ${JSON.stringify(geometry)}`);
const overflow=geometry.overflow;
if(overflow)errors.push(`${mode} ${width}: document overflow`);
if(mode==='empty'&&width===380){await page.getByRole('button',{name:'Agent cards',exact:true}).click();await page.screenshot({path:output+'/agent-380.png'});await page.getByRole('button',{name:'Manage connections',exact:true}).click();await page.getByText('Bank connections',{exact:true}).waitFor();await page.screenshot({path:output+'/manage-380.png'});}
await page.close();
}
await browser.close();
console.log(JSON.stringify({cases:20,errors,output}));
if(errors.length)process.exitCode=1;
