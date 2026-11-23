import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
const root=path.resolve('site/dist');
const server=http.createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const target=path.resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));if(!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}const content=await fs.readFile(target);res.setHeader('Content-Type',target.endsWith('.css')?'text/css':target.endsWith('.svg')?'image/svg+xml':target.endsWith('.png')?'image/png':'text/html; charset=utf-8');res.end(content);}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  for(const route of ['/','/en/','/privacy.html']){
    await page.goto(url+route);assert.ok(await page.locator('h1').innerText());
    for(const width of [1280,768,375,320]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${route} overflows at ${width}`);}
  }
  await page.setViewportSize({width:1280,height:900});await page.goto(url+'/');await page.screenshot({path:'test-results/site-light.png',fullPage:true});
  await page.getByRole('button',{name:'切换明暗主题'}).click();assert.equal(await page.evaluate(()=>document.documentElement.style.colorScheme),'dark');await page.screenshot({path:'test-results/site-dark.png',fullPage:true});assert.deepEqual(errors,[]);
  console.log('Site: 3 pages, 4 viewport widths, theme toggle and screenshots passed');
}finally{await browser.close();server.close();}
