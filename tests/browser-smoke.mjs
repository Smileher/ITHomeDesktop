import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const base=process.env.ITHOME_TEST_URL||'http://127.0.0.1:5173';
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
const page=await browser.newPage({viewport:{width:1280,height:860},deviceScaleFactor:1});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const report={live:{},fixtures:{},responsive:[]};
try {
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.locator('.news-row').first().waitFor({timeout:45000});
  await page.locator('.reader>h1').waitFor({timeout:45000});
  await page.locator('.comment-thread,.empty-inline,.comments .inline-error').first().waitFor({timeout:30000});
  const title=await page.locator('.reader>h1').innerText();
  assert.ok(title.length>5);report.live={articles:await page.locator('.news-row').count(),title,comments:await page.locator('.comment-thread').count()};
  await fs.mkdir('test-results',{recursive:true});await fs.mkdir('site/assets',{recursive:true});
  await page.screenshot({path:'test-results/live-desktop.png'});
  await page.screenshot({path:'site/assets/desktop.png'});
  await page.setViewportSize({width:375,height:860});
  await page.getByRole('button',{name:'返回列表',exact:true}).click();
  const navigation=await page.locator('.sidebar').boundingBox();const feed=await page.locator('.feed-pane').boundingBox();
  assert.ok(navigation.y>feed.y&&navigation.width<373&&navigation.width>=340&&feed.width>=373,'Phone layout must use an inset floating bar and a full-width feed');
  assert.ok(navigation.x>=10&&860-navigation.y-navigation.height>=10,'Floating navigation needs outer breathing room');
  await page.screenshot({path:'test-results/live-mobile-feed.png'});await page.screenshot({path:'site/assets/mobile.png'});
  await page.locator('.news-row').first().click();await page.locator('.reader>h1').waitFor();
  assert.equal(await page.locator('.feed-pane').isVisible(),false);await page.screenshot({path:'test-results/live-mobile-article.png'});
  await page.locator('.detail-pane').evaluate(element=>{element.scrollTop=element.scrollHeight;});
  await page.getByRole('textbox',{name:'评论草稿'}).waitFor();
  const composer=await page.locator('.composer').boundingBox();const floating=await page.locator('.sidebar').boundingBox();
  assert.ok(composer.y+composer.height<=floating.y+1,'Floating bar must not cover the comment composer');
  await page.getByRole('button',{name:'我的',exact:true}).click();
  await page.locator('.mobile-account-links').waitFor();await page.locator('.mobile-account-links').getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('heading',{name:'设置',exact:true}).waitFor();
  await page.getByRole('button',{name:'资讯',exact:true}).click();assert.equal(await page.locator('.feed-pane').isVisible(),true);
  report.phone={floatingNavigation:'pass',fullWidthList:'pass',articleNavigation:'pass',composerClearance:'pass',accountAndSettings:'pass'};
  await page.setViewportSize({width:1280,height:860});

  // Controlled responses exercise failures and draft persistence without writing to a real account.
  const news={newslist:[{newsid:1030761,title:'自动化测试：文章与评论的状态恢复',postdate:'2026-11-23T09:35:25',orderdate:'2026-11-23T09:35:25',description:'测试数据',image:'',commentcount:1},{newsid:1030760,title:'自动化测试：切换文章后保留草稿',postdate:'2026-11-23T09:32:41',orderdate:'2026-11-23T09:32:41',image:'',commentcount:0}]};
  const comment={id:100,city:'测试区域',postTime:'2026-11-23T10:00:00',support:1,against:0,userInfo:{id:1,userNick:'测试家友',level:1},elements:[{type:0,content:'仅用于离线测试的评论'}],children:[],floorStr:'1楼',replyCommentId:0,parentCommentId:0,deviceTailModel:null};
  await page.route('**/__news/json/newslist/**',route=>route.fulfill({json:news}));
  await page.route('**/__news/json/newscontent/*',route=>{const id=Number(new URL(route.request().url()).pathname.split('/').at(-1));const value=news.newslist.find(v=>v.newsid===id)||news.newslist[0];return route.fulfill({json:{...value,success:true,detail:'<p>受控测试正文</p><script>window.badScriptRan=true</script><img src="javascript:alert(1)">',newsauthor:'测试作者',newssource:'测试来源'}});});
  await page.route('**/__page/**',route=>route.fulfill({body:'<div id="post_comm" data-id="test-sn"></div>',contentType:'text/html'}));
  await page.route('**/__comments/**',route=>route.fulfill({json:{success:true,content:{newsId:1030761,userId:0,userNick:null,canComment:true,cannotCommentTip:null,ruleHint:'测试提示',comments:[comment],hotComments:[comment]}}}));
  await page.evaluate(()=>localStorage.clear());await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'自动化测试：文章与评论的状态恢复'}).waitFor();
  await page.getByRole('textbox',{name:'评论草稿'}).fill('测试草稿：切换之后继续写。');
  await page.getByText('草稿已保存',{exact:true}).waitFor();
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('switch',{name:'紧凑列表'}).click();
  await page.getByText('设置已保存',{exact:true}).waitFor();
  await page.getByRole('button',{name:'资讯',exact:true}).click();
  await page.getByRole('textbox',{name:'评论草稿'}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'评论草稿'}).inputValue(),'测试草稿：切换之后继续写。');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('textbox',{name:'评论草稿'}).waitFor();
  await page.waitForFunction(()=>document.querySelector('textarea')?.value==='测试草稿：切换之后继续写。');
  assert.equal(await page.evaluate(()=>window.badScriptRan),undefined);
  assert.equal(await page.locator('.article-body script').count(),0);
  await page.getByRole('button',{name:'加入本机收藏'}).click();
  await page.getByRole('button',{name:'取消本机收藏'}).waitFor();
  await page.getByRole('button',{name:'本机收藏',exact:true}).click();
  assert.equal(await page.locator('.news-row').count(),1);
  await page.getByRole('button',{name:'登录后评论',exact:true}).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByRole('button',{name:'同步登录',exact:true}).isEnabled(),false);
  await page.getByRole('button',{name:'取消',exact:true}).click();
  report.fixtures={draftSwitch:'pass',draftRestart:'pass',favorite:'pass',settings:'pass',htmlSanitization:'pass',loginGate:'pass'};
  for(const width of [1280,1024,768,600,420,375,360]){
    await page.setViewportSize({width,height:860});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
    assert.equal(overflow,false,`horizontal overflow at ${width}`);report.responsive.push({width,pass:true});
  }
  assert.deepEqual(errors,[]);report.runtimeErrors=errors;await fs.writeFile('test-results/browser.json',JSON.stringify(report,null,2),'utf8');
  console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}
