import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const executable=path.resolve(process.env.ITHOME_NATIVE_EXE||'src-tauri/target/debug/ithome-desktop.exe');
const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
const started=Date.now();
const child=spawn(executable,[],{windowsHide:true,stdio:'ignore',env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-allow-origins=*`}});
let browser,app,original,draftBefore;
const report={build:executable.includes('debug')?'debug':'release',readinessMs:0,checks:[],memory:null};
let id=0;
const reply=9000000000;
async function call(command,args={}){return app.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});}
try{
  let endpoint;
  for(let attempt=0;attempt<100;attempt++){
    if(child.exitCode!==null)throw new Error('Native process exited before exposing its WebView');
    try{const response=await fetch(`http://127.0.0.1:${port}/json/version`);if(response.ok){endpoint=(await response.json()).webSocketDebuggerUrl;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,300));
  }
  assert.ok(endpoint,'Native WebView debugging endpoint was not available');
  browser=await chromium.connectOverCDP(endpoint);
  const context=browser.contexts()[0];
  for(let attempt=0;attempt<50;attempt++){
    app=context.pages().find(p=>p.url().includes('localhost')||p.url().includes('tauri.localhost'));
    if(app)break;await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert.ok(app,'Main WebView was not found');
  await app.waitForFunction(()=>!!window.__TAURI_INTERNALS__);
  const boot=await call('bootstrap');original=boot.settings;
  assert.equal(boot.profile.id,0,'Run native smoke tests only without an existing real account');
  const news=await call('get_news',{channel:'news',cursor:null,refresh:true});assert.ok(news.data.length>0);id=news.data[0].id;
  const article=await call('get_article',{id,refresh:true});assert.equal(article.data.item.id,id);assert.ok(article.data.sn);
  const comments=await call('get_comments',{id,cursor:0,earliest:false});assert.equal(comments.newsId,id);assert.ok(Array.isArray(comments.comments));
  await app.locator('.reader>h1').waitFor({timeout:30000});report.readinessMs=Date.now()-started;report.checks.push('native news/article/comments');
  await call('save_settings',{settings:{...original,fontSize:18}});assert.equal((await call('bootstrap')).settings.fontSize,18);
  await assert.rejects(()=>call('save_settings',{settings:{...original,fontSize:0}}));assert.equal((await call('bootstrap')).settings.fontSize,18);report.checks.push('settings validation and persistence');
  draftBefore=await call('get_draft',{id,reply});
  await call('save_draft',{id,reply,body:'自动化测试草稿',account:0});assert.equal(await call('get_draft',{id,reply}),'自动化测试草稿');
  await assert.rejects(()=>call('save_draft',{id,reply,body:'wrong account',account:99999}));report.checks.push('scoped draft persistence');
  await assert.rejects(()=>call('submit_comment',{id,reply:0,body:'must not be transmitted without login'}));report.checks.push('unauthenticated write rejected');
  const stats=await call('get_stats');assert.ok(stats.cacheBytes>0);report.checks.push('real SQLite cache');
  const command=`$taskRoot=${child.pid};$taskProcesses=Get-CimInstance Win32_Process;$taskPids=@($taskRoot);for($taskIndex=0;$taskIndex -lt $taskPids.Count;$taskIndex++){ $taskPids+=@($taskProcesses|Where-Object ParentProcessId -eq $taskPids[$taskIndex]|Select-Object -ExpandProperty ProcessId) };$taskPerf=Get-CimInstance Win32_PerfFormattedData_PerfProc_Process|Where-Object {$_.IDProcess -in $taskPids};[pscustomobject]@{processCount=@($taskPerf).Count;privateWorkingSetMb=[math]::Round((($taskPerf|Measure-Object WorkingSetPrivate -Sum).Sum/1MB),1)}|ConvertTo-Json -Compress`;
  const measured=spawnSync('pwsh',['-NoProfile','-Command',command],{encoding:'utf8',windowsHide:true});
  try{report.memory=JSON.parse(measured.stdout);}catch{}
  await call('open_official',{kind:'article',id,query:null});
  let remote;
  for(let attempt=0;attempt<50;attempt++){remote=context.pages().find(p=>p!==app&&p.url().includes('ithome.com'));if(remote)break;await new Promise(resolve=>setTimeout(resolve,200));}
  assert.ok(remote,'Official isolated WebView did not open');
  const remoteAccess=await remote.evaluate(async()=>{if(!window.__TAURI_INTERNALS__)return 'no bridge';try{await window.__TAURI_INTERNALS__.invoke('bootstrap');return 'allowed';}catch{return 'rejected';}});
  assert.notEqual(remoteAccess,'allowed');report.checks.push('remote official page denied local command access');
  await assert.rejects(()=>call('sync_login',{remember:false,id}));report.checks.push('browser cookie collection and unauthenticated session rejection');
  await call('logout');
  await fs.mkdir('test-results',{recursive:true});await app.screenshot({path:'test-results/native-desktop.png'});
  await fs.writeFile('test-results/native.json',JSON.stringify(report,null,2),'utf8');console.log(JSON.stringify(report,null,2));
}finally{
  if(app){if(original)await call('save_settings',{settings:original}).catch(()=>{});if(id&&draftBefore!==undefined)await call('save_draft',{id,reply,body:draftBefore,account:0}).catch(()=>{});}
  if(browser)await browser.close().catch(()=>{});child.kill();
}
