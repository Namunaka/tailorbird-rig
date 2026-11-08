// Run with PLAYWRIGHT_MODULE and CHROME_EXECUTABLE if using an existing local runtime.
const{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'tailorbird-browser-')),project=path.join(temp,'project'),checks=[];fs.cpSync(path.join(root,'tailorbird_rig/starter'),project,{recursive:true});const config=path.join(project,'rig.json'),python=process.env.PYTHON||'python3';let server,browser;
const check=(name,pass)=>{checks.push({name,pass});if(!pass)throw Error(name)};
(async()=>{
 const sourceId='00000000-0000-4000-8000-000000000001';
 const workspace=JSON.parse(fs.readFileSync(config,'utf8'));
 const design=path.join(project,'designs/v1'),manifest=JSON.parse(fs.readFileSync(path.join(design,'coverage.json'),'utf8'));
 fs.mkdirSync(path.join(design,'evidence'));
 fs.copyFileSync(path.join(design,'screens/phone-a/form.png'),path.join(design,'evidence/simulator.png'));
 fs.writeFileSync(path.join(design,'implementation-evidence.json'),JSON.stringify({
  pages:{form:{'phone-a':{status:'alpha',environment:'simulator',result:'passed',build:'fixture.1',
   screenshot:'evidence/simulator.png',summary:'表单提交流程已验证'}}},
  exclusions:{form:Object.fromEntries(manifest.devices.filter(d=>d.id!=='phone-a').map(d=>[d.id,{kind:'out_of_scope',reason:'测试只覆盖 A'}]))}
 }));
 fs.writeFileSync(path.join(project,'designs/v1/page-docs.json'),JSON.stringify({status:'测试夹具',pages:{form:{
  product:['说明表单功能'],sections:[{title:'实现范围',items:['保留表单输入']}],
  cases:[{title:'表单提交',setup:['填写表单'],steps:['检查表单提交'],expected:['提交成功']}]
 }}}));
 workspace.codex_source={thread_id:sourceId,title:'测试来源对话',cwd:'.'};
 fs.writeFileSync(config,JSON.stringify(workspace));
 const cli=path.join(temp,'codex');
 fs.writeFileSync(cli,[
  '#!/bin/sh',
  'echo "$@" > "$RIG_TEST_CAPTURE/args"',
  'cat > "$RIG_TEST_CAPTURE/prompt"',
  "echo '{\"type\":\"turn.started\"}'",
  "echo '{\"type\":\"turn.completed\"}'"
 ].join('\n')+'\n',{mode:0o700});
 server=cp.spawn(python,['-m','tailorbird_rig','serve',config,'--port','0'],{cwd:root,
  env:{...process.env,PATH:temp+path.delimiter+process.env.PATH,RIG_TEST_CAPTURE:temp},stdio:['ignore','pipe','ignore']});
 const base=await new Promise((resolve,reject)=>{let out='';server.stdout.on('data',d=>{out+=d;let m=out.match(/http:\/\/127\.0\.0\.1:\d+/);if(m)resolve(m[0])});server.on('exit',c=>reject(Error('server exited '+c)));setTimeout(()=>reject(Error('server startup timeout')),10000).unref()});
 browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});const context=await browser.newContext(),p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.setViewportSize({width:1600,height:1050});await p.goto(base);await p.getByText('已连接本机批注',{exact:true}).waitFor();await p.locator('#image').evaluate(i=>i.decode());
 check('seven fixed device/form options',await p.locator('#devices button').count()===7);
 const development=p.locator('#development-test-progress');
 await development.getByText('1 / 21 个页面 × 机型已通过 · 本期范围例外 6 个').waitFor();
 await p.locator('#overall-review-progress + #development-test-progress').waitFor();
 check('development progress sits below design progress and counts all devices in coverage',
  await development.locator('strong').textContent()==='4.8%'&&await development.locator('progress').evaluate(bar=>bar.value===1&&bar.max===21));
 const formRow=p.locator('.state-row').filter({has:p.locator('[data-page="form"]')});
 const productLink=formRow.locator('[data-doc="product"]'),testLink=formRow.locator('[data-doc="test"]');
 const [rowBox,productBox,testBox]=await Promise.all([formRow.locator('[data-page]').boundingBox(),productLink.boundingBox(),testLink.boundingBox()]);
 check('stacked doc buttons align with the full design row',productBox.x===testBox.x&&productBox.y===rowBox.y&&testBox.y>productBox.y&&Math.abs(testBox.y+testBox.height-rowBox.y-rowBox.height)<1);
 async function openDoc(link){
  const opened=context.waitForEvent('page');await link.click();return opened;
 }
 let pageDoc=await openDoc(productLink);
 await pageDoc.getByText('说明表单功能').waitFor();
 check('product opens in a standalone page without changing the review',pageDoc.url().endsWith('#product')&&p.url().endsWith('#welcome@phone-a'));
 await pageDoc.close();
 pageDoc=await openDoc(testLink);
 await pageDoc.getByText('检查表单提交').waitFor();
 check('test entry opens the same document at test cases',pageDoc.url().endsWith('#test')&&await pageDoc.getByText('预期结果').isVisible());
 await pageDoc.close();
 pageDoc=await openDoc(p.locator('.state-row').filter({has:p.locator('[data-page="done"]')}).locator('[data-doc="test"]'));
 await pageDoc.getByText('此版本尚未关联测试文档。').waitFor();
 await pageDoc.close();
 await p.locator('#states [data-page="welcome"]').focus();
 await p.keyboard.press('ArrowDown');
 check('Down selects the next page and keeps navigation focus',p.url().endsWith('#form@phone-a')&&await p.locator('#states [data-page="form"]').evaluate(b=>b===document.activeElement));
 const alphaDevice=p.locator('#devices [data-device="phone-a"]');
 await alphaDevice.locator('.device-alpha').waitFor();
 check('Alpha badge is scoped to its device and separate from review confirmation',await p.locator('.device-alpha').count()===1&&await alphaDevice.getAttribute('data-check')!=='confirmed');
 await alphaDevice.hover();
 const simulatorReport=p.locator('#device-report-phone-a');
 await simulatorReport.getByText('表单提交流程已验证').waitFor();
 await simulatorReport.locator('img').evaluate(img=>img.decode());
 check('device hover shows screenshot and simulator result',await simulatorReport.getByText('测试通过 · 构建 fixture.1').isVisible());
 await p.locator('#states [data-page="form"]').hover();
 await alphaDevice.focus();
 check('keyboard focus also opens simulator report',await simulatorReport.isVisible());
 await p.keyboard.press('Escape');
 await simulatorReport.waitFor({state:'hidden'});
 await p.locator('#page-check-all').click();
 const confirmedForm=formRow.locator('[data-page="form"][data-check="confirmed"]');
 await confirmedForm.waitFor();
 check('confirmed row with one tested device and six exceptions shows only partial dark green',
  await confirmedForm.evaluate(button=>button.querySelector('.page-review-percent').textContent==='100%'&&
    button.querySelector('.page-development-percent').textContent==='测试 14.3%'&&
    getComputedStyle(button).backgroundImage.includes('rgb(16, 75, 52) 14.3%')));
 await p.getByRole('button',{name:'全部取消',exact:true}).click();
 await formRow.locator('[data-page="form"][data-check="default"]').waitFor();
 await p.keyboard.press('ArrowRight');
 check('Right selects the next device and keeps the page',p.url().endsWith('#form@phone-b'));
 await p.keyboard.press('ArrowLeft');
 await p.keyboard.press('ArrowUp');
 await p.keyboard.press('ArrowUp');
 check('Left and Up select the previous item and stop at the boundary',p.url().endsWith('#welcome@phone-a'));
 check('another page has no Alpha without matching evidence',await p.locator('.device-alpha').count()===0);
 check('development progress covers the whole revision when switching pages',await development.locator('strong').textContent()==='4.8%');
 await p.locator('#review-text').fill('未保存的导航测试');
 await p.keyboard.press('ArrowDown');
 check('arrow keys stay in the comment field while editing',p.url().endsWith('#welcome@phone-a'));
 await p.locator('#review-text').blur();
 await p.keyboard.press('ArrowRight');
 check('arrow navigation can leave an unsaved comment',p.url().endsWith('#welcome@phone-b')&&await p.locator('#review-text').inputValue()==='');
 await p.locator('#states [data-page="done"]').click();
 await p.locator('#review-text').fill('另一页的评论草稿');
 await p.locator('#page-check-confirm').click();
 await p.locator('#page-check-confirm[aria-pressed=true]:enabled').waitFor();
 check('another page can hold a draft and be confirmed',await p.locator('#review-text').inputValue()==='另一页的评论草稿');
 await p.locator('#page-check-confirm').click();
 await p.locator('#page-check-confirm[aria-pressed=false]:enabled').waitFor();
 await p.locator('#review-text').fill('');
 await p.locator('#states [data-page="welcome"]').click();
 await p.locator('#devices [data-device="phone-a"]').click();
 check('returning to the original device restores its draft',await p.locator('#review-text').inputValue()==='未保存的导航测试');
 await p.locator('#review-text').fill('');
 for(const name of ['折叠屏 A · 折叠','折叠屏 A · 展开','折叠屏 B · 折叠','折叠屏 B · 展开']){await p.getByRole('button',{name,exact:true}).click();await p.locator('#image').evaluate(i=>i.decode());check(name+' switches image',await p.locator('#size').textContent().then(t=>t.includes(name)))}
 await p.getByRole('button',{name:'手机 A · 示例',exact:true}).click();await p.locator('#image').evaluate(i=>i.decode());
 const saved=()=>p.waitForFunction(()=>document.querySelector('#review-save-state').textContent==='已保存到本机'),data=async()=>await(await p.request.get(base+'/api/review')).json();
 await p.locator('[data-tool=rect]').click();let frame=await p.locator('.review-overlay').boundingBox(),im=await p.locator('#image').boundingBox();await p.mouse.move(frame.x+8,im.y+25);await p.mouse.down();await p.mouse.move(im.x+im.width*.6,im.y+im.height*.3,{steps:8});await p.mouse.up();await saved();await p.locator('#review-text').fill('圈选调整');await p.locator('#review-add-comment').click();await saved();let m=(await data()).marks[0];check('extended canvas coordinates and source hash',m.points[0][0]<0&&m.image_sha256.length===64);check('sequential issue created',m.comment.issueNumber===1);
 await p.locator('#review-text').fill('圈选调整补充');await p.locator('#review-add-comment').click();await saved();check('editing retains issue number',(await data()).issues.length===1);
 await p.locator('#review-text').fill('原标记的修改草稿');
 await p.locator('#states [data-page="form"]').click();
 check('selected annotation draft stays on its original page',await p.locator('#review-text').inputValue()==='');
 await p.locator('#states [data-page="welcome"]').click();
 check('returning restores the selected annotation and draft',await p.locator('#review-text').inputValue()==='原标记的修改草稿'&&await p.locator('#review-add-comment').textContent()==='更新评论');
 await p.locator('#review-text').fill('abc');await p.locator('#review-text').press('Backspace');check('editing text does not delete annotation',!(await data()).marks[0].deleted);await p.locator('#review-text').fill('圈选调整补充');
 check('no separate browse or select controls',await p.locator('[data-tool=browse],[data-tool=select]').count()===0);await p.evaluate(()=>scrollTo(0,document.querySelector('.review-workspace').getBoundingClientRect().top+scrollY-20));im=await p.locator('#image').boundingBox();const x=im.x+(m.points[0][0]+m.points[1][0])/2*im.width,y=im.y+(m.points[0][1]+m.points[1][1])/2*im.height;await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x+20,y+20,{steps:5});await p.mouse.up();await saved();check('move retains geometry history',((await data()).marks[0].geometry_history||[]).length===1);
 await p.reload();await p.locator('.review-card').waitFor();check('reload restores comment',await p.locator('.review-card').count()===1);await p.locator('.review-card').click();await p.locator('#review-delete').click();await saved();check('delete preserves withdrawal history',(await data()).issues[0].status.includes('撤回'));
 // Verify pen/color/width/undo and point comments as fixed tools.
 await p.locator('[data-tool=pen]').click();await p.locator('[data-color="#6cd8ff"]').click();await p.locator('#review-width').evaluate(e=>{e.value='6';e.dispatchEvent(new Event('input',{bubbles:true}))});await p.evaluate(()=>scrollTo(0,document.querySelector('.review-workspace').getBoundingClientRect().top+scrollY-20));im=await p.locator('#image').boundingBox();await p.mouse.move(im.x+im.width*.25,im.y+80);await p.mouse.down();await p.mouse.move(im.x+im.width*.55,im.y+120,{steps:8});await p.mouse.up();await saved();check('pen color and width retained',(await data()).marks.some(m=>!m.deleted&&m.kind==='pen'&&m.color==='#6cd8ff'&&m.width===6));await p.locator('#review-undo').click();await saved();check('undo preserves previous commented history',!(await data()).marks.some(m=>!m.deleted&&m.kind==='pen'));
 await p.locator('[data-tool=comment]').click();await p.evaluate(()=>scrollTo(0,document.querySelector('.review-workspace').getBoundingClientRect().top+scrollY-20));im=await p.locator('#image').boundingBox();await p.mouse.click(im.x+im.width*.7,im.y+150);await p.locator('#review-text').fill('位置评论');await p.locator('#review-add-comment').click();await saved();check('position comment creates pin',(await data()).marks.some(m=>!m.deleted&&m.kind==='pin'&&m.comment));await p.locator('#review-delete').click();await saved();
 await p.locator('#review-text').fill('附图评论');await p.locator('#review-file').setInputFiles(path.join(project,'designs/v1/screens/phone-a/welcome.png'));await p.waitForFunction(()=>document.querySelectorAll('#review-attachments img').length===1);await p.locator('#review-add-comment').click();await saved();check('image attachment saved',(await data()).marks.find(m=>!m.deleted).comment.attachments.length===1);
 await p.reload();await p.locator('.review-card img').waitFor();check('attachment survives reload',await p.locator('.review-card img').count()===1);
 await p.getByRole('button',{name:'手机 B · 示例',exact:true}).click();check('annotations isolated by device',await p.locator('.review-card').count()===0);
 // Browser paste and drag/drop route through the same actual upload endpoint.
 const bytes=fs.readFileSync(path.join(project,'designs/v1/screens/phone-a/form.png')).toString('base64');
 await p.evaluate(bytes=>{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],'pasted.png',{type:'image/png'}));document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))},bytes);await p.waitForFunction(()=>document.querySelectorAll('#review-attachments img').length===1);await p.locator('#review-add-comment').click();await saved();check('paste uploads image and creates general comment',(await data()).marks.some(m=>m.device==='phone-b'&&m.kind==='page'&&m.comment.attachments.length===1));
 await p.getByRole('button',{name:'手机 C · 示例',exact:true}).click();await p.evaluate(bytes=>{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],'dropped.png',{type:'image/png'}));document.querySelector('#review-panel').dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}))},bytes);await p.waitForFunction(()=>document.querySelectorAll('#review-attachments img').length===1);await p.locator('#review-add-comment').click();await saved();check('drag/drop uploads image', (await data()).marks.some(m=>m.device==='phone-c'&&m.comment?.attachments.length===1));
 const bundle=await(await p.request.get(base+'/api/handoff')).json();check('handoff includes numbered feedback and attachment provenance',bundle.issues.length===3&&bundle.markdown.includes('SHA256')&&bundle.markdown.includes('images/'));
 check('handoff prompts cross-device and state review',bundle.scope_guidance.includes('各机型、折叠形态和相关状态')&&bundle.markdown.includes(bundle.scope_guidance));
 check('handoff includes native verification and its completion gate',bundle.alpha_guidance.includes('implementation-evidence.json')&&bundle.alpha_check.includes('--require-alpha')&&bundle.markdown.includes(bundle.alpha_guidance)&&bundle.markdown.includes(bundle.alpha_check));
 check('review toolbar offers handoff without a start task card',await p.locator('#start-work').count()===0&&await p.locator('#handoff').isVisible());
 const work=await p.request.post(base+'/api/codex-work',{headers:{Origin:base},data:{revision:'v1'}});
 check('existing local work endpoint accepts the configured revision',work.status()===202);
 let workState;
 for(let attempt=0;attempt<50;attempt++){
  workState=(await(await p.request.get(base+'/api/codex-work')).json()).state;
  if(workState==='completed'||workState==='failed')break;
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 check('local work endpoint reports completion',workState==='completed');
 check('local work endpoint resumes the bound session with pending issue IDs',
  fs.readFileSync(path.join(temp,'args'),'utf8').includes('resume --skip-git-repo-check '+sourceId)&&
  fs.readFileSync(path.join(temp,'prompt'),'utf8').includes('待处理问题编号：'+bundle.issues.map(i=>i.number).join('、'))&&
  fs.readFileSync(path.join(temp,'prompt'),'utf8').includes(bundle.scope_guidance)&&
  fs.readFileSync(path.join(temp,'prompt'),'utf8').includes(bundle.alpha_check));
 // Publishing creates a new revision and refreshes this tab after unsaved work is saved.
 await p.locator('#review-text').fill('尚未保存的新意见');fs.cpSync(path.join(project,'designs/v1'),path.join(project,'designs/v2'),{recursive:true});cp.execFileSync(python,['-m','tailorbird_rig','publish',config,'--revision','v2','--root',path.join(project,'designs/v2')],{cwd:root});await p.waitForTimeout(3600);check('unsaved feedback blocks auto-refresh',await p.locator('#revision').inputValue()==='v1'&&(await p.locator('#error').textContent()).includes('新版本'));
 await p.locator('#review-add-comment').click();await saved();await p.waitForFunction(()=>document.querySelector('#revision')?.value==='v2',undefined,{timeout:12000});await p.getByText('已连接本机批注',{exact:true}).waitFor();check('new revision loads in the same tab',context.pages().length===1);check('new revision keeps page and device',p.url().endsWith('#welcome@phone-c'));check('old revision annotations not drawn on new images',await p.locator('.review-card').count()===0);
 await p.selectOption('#revision','v1');await p.getByText('已连接本机批注',{exact:true}).waitFor();check('historical revision restores its annotations',await p.locator('.review-card').count()===1);
 // Human acceptance changes the actual navigation background and survives reloads.
 await p.goto(base+'/#done@phone-c');await p.locator('#page-check-confirm:not([disabled])').waitFor();
 const nav=p.locator('#states [data-page="done"]');check('uncommented page starts with default navigation',await nav.getAttribute('data-check')==='default');
 await p.locator('#page-check-confirm').click();await p.waitForFunction(()=>document.querySelector('#states [data-page="done"]').dataset.check==='partial');
 check('one of seven devices fills 14.3% green',await nav.evaluate(b=>b.querySelector('.page-review-percent').textContent==='14.3%'&&getComputedStyle(b).backgroundImage.includes('rgb(38, 129, 79)')));
 check('one confirmation contributes to overall progress',await p.locator('#overall-review-progress progress').evaluate(b=>b.value===1&&b.max===21));
 const reviewedDevice=p.locator('#devices button[data-device=phone-c]');
 const confirmation=p.locator('#page-check-confirm');
 check('confirmed device is green',await reviewedDevice.evaluate(b=>getComputedStyle(b).backgroundColor==='rgb(38, 129, 79)'));
 await p.getByRole('button',{name:'手机 B · 示例',exact:true}).click();
 check('confirmed device stays green when another device is selected',await reviewedDevice.evaluate(b=>!b.classList.contains('active')&&getComputedStyle(b).backgroundColor==='rgb(38, 129, 79)'));
 await reviewedDevice.click();
 await confirmation.and(p.locator('[aria-pressed=true]:not([disabled])')).click();
 await p.waitForFunction(()=>document.querySelector('#overall-review-progress progress').value===0);
 check('second click revokes the confirmation and removes green',await reviewedDevice.getAttribute('data-check')==='default'&&await nav.getAttribute('data-check')==='default');
 await p.reload();await confirmation.and(p.locator(':not([disabled])')).waitFor();
 check('withdrawal persists after refresh',await confirmation.getAttribute('aria-pressed')==='false');
 await confirmation.click();
 await p.waitForFunction(()=>document.querySelector('#overall-review-progress progress').value===1);
 await p.reload();await p.locator('#page-check-confirm:not([disabled])').waitFor();check('confirmation persists after reload',await nav.getAttribute('data-check')==='partial');
 const event={operation:'add',operationId:crypto.randomUUID(),id:'check-fixture',mark:{revision:'v2',page:'done',device:'phone-c',kind:'page',points:[[.5,.5]]}};
 await p.request.post(base+'/api/annotations',{data:event});
 await p.getByRole('button',{name:'手机 B · 示例',exact:true}).click();
 await p.waitForFunction(()=>document.querySelector('#states [data-page="done"]').dataset.check==='needs_work');
 check('a bare mark on another device turns page red',await nav.evaluate(b=>getComputedStyle(b).backgroundColor)==='rgb(150, 61, 71)');
 await p.getByRole('button',{name:'手机 C · 示例',exact:true}).click();
 await p.request.post(base+'/api/annotations',{data:{operation:'comment',operationId:crypto.randomUUID(),id:event.id,text:'Review this page'}});
 await p.waitForFunction(()=>document.querySelector('#overall-review-progress progress').value===0);check('new feedback invalidates confirmation',true);
 const issueNumber=(await data()).issues.find(i=>i.annotation_id===event.id).number;
 cp.execFileSync(python,['-m','tailorbird_rig','resolve',config,String(issueNumber),'--resolution','Updated synthetic design','--evidence','fixture'],{cwd:root});
 await p.reload();await p.locator('#page-check-confirm:not([disabled])').waitFor();check('resolved feedback paints navigation yellow',await nav.evaluate(b=>getComputedStyle(b).backgroundColor)==='rgb(244, 196, 81)');
 await p.locator('#page-check-confirm').click();await p.waitForFunction(()=>document.querySelector('#states [data-page="done"]').dataset.check==='partial');
 fs.cpSync(path.join(project,'designs/v2'),path.join(project,'designs/v3'),{recursive:true});fs.copyFileSync(path.join(project,'designs/v3/screens/phone-c/welcome.png'),path.join(project,'designs/v3/screens/phone-c/done.png'));
 cp.execFileSync(python,['-m','tailorbird_rig','publish',config,'--revision','v3','--root',path.join(project,'designs/v3')],{cwd:root});
 await p.waitForFunction(()=>document.querySelector('#revision')?.value==='v3');await p.locator('#page-check-confirm:not([disabled])').waitFor();check('changed draft resets navigation to default',await nav.getAttribute('data-check')==='default');
 check('confirmation history stays on original draft',(await(await p.request.get(base+'/api/page-checks?revision=v2&device=phone-c')).json()).pages.done.status==='confirmed');
 const confirmAll=p.locator('#page-check-all');
 const singleBox=await confirmation.boundingBox(),allBox=await confirmAll.boundingBox();
 check('confirm all sits to the right of the single confirmation',allBox.x>singleBox.x&&allBox.y===singleBox.y);
 const formChecks=p.waitForResponse(r=>r.url().includes('/api/page-checks?')&&r.url().includes('page=form'));
 await p.locator('#states [data-page="form"]').click();
 await formChecks;
 const doneChecks=/\/api\/page-checks\?.*\bpage=done$/;
 let release,requested,calls=0;
 const delayed=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{requested=resolve});
 await p.route(doneChecks,async route=>{calls++;requested();await delayed;await route.continue()});
 try{
  await p.locator('#states [data-page="done"]').click();
  await started;
  await p.waitForTimeout(3200);
  check('polling does not replace an outstanding page status request',calls===1);
  await p.keyboard.press('Meta+Shift+b');
  check('changed draft accepts batch confirmation while status loads',await p.locator('#page-check-state').textContent()==='正在确认全部机型…');
 }finally{release()}
 await p.waitForFunction(()=>document.querySelector('#states [data-page="done"]').dataset.check==='confirmed');
 await p.unroute(doneChecks);
 check('confirm all paints this page 100% and all seven devices green',await nav.locator('.page-review-percent').textContent()==='100%'&&await p.locator('#devices [data-check=confirmed]').count()===7);
 check('confirm all only counts the current page',await p.locator('#overall-review-progress progress').evaluate(b=>b.value===7&&b.max===21));
 await p.reload();
 await confirmation.and(p.locator('[aria-pressed=true]:not([disabled])')).waitFor();
 check('batch confirmation persists after reload',await nav.getAttribute('data-check')==='confirmed');
 await p.getByRole('button',{name:'全部取消',exact:true}).click();
 await p.waitForFunction(()=>document.querySelector('#overall-review-progress progress').value===0);
 check('cancel all clears the page and device confirmations',await nav.locator('.page-review-percent').textContent()==='0%'&&await p.locator('#devices [data-check=confirmed]').count()===0);
 await p.reload();
 await p.getByRole('button',{name:'全部确认',exact:true}).and(p.locator(':not([disabled])')).waitFor();
 check('batch cancellation persists after reload',await nav.locator('.page-review-percent').textContent()==='0%');
 const overviewRoute=/\/api\/page-checks\?(?!.*scope=page)/;
 let unblockOverview;
 const blockedOverview=new Promise(resolve=>{unblockOverview=resolve});
 await p.route(overviewRoute,async route=>{await blockedOverview;await route.continue().catch(()=>{})});
 try{
  await p.reload();
  await confirmAll.click();
  await p.getByRole('button',{name:'全部取消',exact:true}).and(p.locator(':enabled')).waitFor({timeout:4000});
  check('batch saves and turns the current page green while overview is blocked',await nav.locator('.page-review-percent').textContent()==='100%');
  await p.getByRole('button',{name:'全部取消',exact:true}).click();
  await p.getByRole('button',{name:'全部确认',exact:true}).and(p.locator(':enabled')).waitFor({timeout:4000});
 }finally{unblockOverview();await p.unroute(overviewRoute)}
 const confirmRoute='**/api/page-checks/confirm';
 let unblockPost;
 const blockedPost=new Promise(resolve=>{unblockPost=resolve});
 await p.route(confirmRoute,async route=>{await blockedPost;await route.abort().catch(()=>{})});
 await p.evaluate(()=>{
  const nativeTimeout=AbortSignal.timeout;
  AbortSignal.timeout=()=>{AbortSignal.timeout=nativeTimeout;return nativeTimeout(200)};
 });
 try{
  const recovered=p.waitForResponse(r=>r.url().includes('/api/page-checks?'));
  await confirmAll.click();
  await recovered;
  await confirmAll.and(p.locator(':enabled')).waitFor();
  check('timed-out batch save restores buttons and uses persisted status',await nav.locator('.page-review-percent').textContent()==='0%');
 }finally{unblockPost();await p.unroute(confirmRoute)}
 check('both review buttons display their default shortcuts',await confirmation.locator('kbd').textContent()==='⌘B'&&await confirmAll.locator('kbd').textContent()==='⌘⇧B');
 await p.keyboard.press('Meta+b');
 await p.waitForFunction(()=>document.querySelector('#overall-review-progress progress').value===1);
 check('Command+B confirms only the selected device',await p.locator('#devices [data-check=confirmed]').count()===1&&await reviewedDevice.getAttribute('data-check')==='confirmed');
 await p.locator('#shortcut-settings').click();
 await p.locator('#shortcut-single').press('Meta+Shift+k');
 await p.locator('#shortcut-all').press('Meta+Shift+k');
 await p.locator('#shortcut-dialog').getByRole('button',{name:'保存',exact:true}).click();
 check('duplicate shortcuts cannot be saved',await p.locator('#shortcut-help').textContent()==='两个操作需要使用不同的快捷键。');
 await p.locator('#shortcut-single').press('Meta+j');
 await p.locator('#shortcut-dialog').getByRole('button',{name:'保存',exact:true}).click();
 await p.reload();
 await confirmAll.and(p.locator(':enabled')).waitFor();
 check('custom shortcuts persist and appear on both buttons',await confirmation.locator('kbd').textContent()==='⌘J'&&await confirmAll.locator('kbd').textContent()==='⌘⇧K');
 await p.locator('#review-text').focus();
 const ignored=await p.locator('#review-text').evaluate(e=>e.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyK',key:'K',metaKey:true,shiftKey:true,bubbles:true,cancelable:true})));
 check('shortcut leaves comment input keys alone',ignored);
 await p.locator('#review-text').blur();
 await p.keyboard.press('Meta+Shift+k');
 await p.waitForFunction(()=>document.querySelector('#states [data-page="done"]').dataset.check==='confirmed');
 await p.locator('#shortcut-settings').click();
 await p.locator('#shortcut-reset').click();
 await p.locator('#shortcut-dialog').getByRole('button',{name:'保存',exact:true}).click();
 check('reset restores both shortcuts',await confirmation.getAttribute('aria-keyshortcuts')==='Meta+B'&&await confirmAll.getAttribute('aria-keyshortcuts')==='Shift+Meta+B');
 await p.keyboard.press('Meta+Shift+b');
 await p.waitForFunction(()=>document.querySelector('#overall-review-progress progress').value===0);
 await p.goto(base+'/lottie.html');await p.waitForFunction(()=>window.rigLottie?.ready);check('Lottie SVG ready',await p.locator('#player svg').count()===1);
 await p.locator('#play').click();await p.waitForFunction(()=>window.rigLottie.completed===1);check('SVG complete playback',await p.locator('#status').textContent()==='完整播放结束');
 await p.locator('#timeline').evaluate(e=>{e.value='30';e.dispatchEvent(new Event('input',{bubbles:true}))});check('timeline scrubs frames',(await p.locator('#time').textContent()).startsWith('30'));
 await p.selectOption('#renderer','canvas');await p.waitForFunction(()=>window.rigLottie?.ready&&window.rigLottie.renderer==='canvas');check('Canvas ready',await p.locator('#player canvas').count()===1);
 await p.locator('#replay').click();await p.waitForFunction(()=>window.rigLottie.completed===2);check('Canvas complete playback',true);
 await p.selectOption('#motion','draw');await p.locator('#generate').click();await p.waitForFunction(()=>window.rigLottie.ready&&document.querySelector('#inspection').textContent.includes('"paths": 1'));check('path authoring and inspection',true);
 const sourceDownload=p.waitForEvent('download');await p.locator('#generator').click();const generated=await sourceDownload;check('rebuildable generator export',generated.suggestedFilename()==='generator.py');
 await p.locator('#source').fill('{invalid');await p.locator('#apply').click();check('invalid JSON visible error',(await p.locator('#status').textContent()).includes('JSON格式错误'));
 await p.locator('#generate').click();await p.waitForFunction(()=>window.rigLottie.ready);
 await p.goto(base+'/components.html');await p.locator('.component-entry').first().waitFor();check('shared element set contains nine reusable components',await p.locator('.component-entry').count()===9);
 check('primary control variants rendered',await p.locator('[data-id="primary-action"] .component-preview').count()===3);
 check('disabled and loading states use actual disabled controls',await p.locator('[data-id="primary-action"] button:disabled').count()===2);
 check('back and confirm share control dimensions',await p.locator('[data-id="back-button"] .rig-back').first().evaluate(b=>b.offsetHeight)===await p.locator('[data-id="primary-action"] .rig-primary').first().evaluate(b=>b.offsetHeight));
 await p.locator('#search').fill('text-field');check('component search retains variants',await p.locator('.component-entry').count()===1&&await p.locator('.component-preview').count()===4);await p.locator('#search').fill('');
 const specDownload=p.waitForEvent('download');await p.locator('#download').click();check('shared definitions export', (await specDownload).suggestedFilename()==='example-elements-1.0.0.json');
 fs.cpSync(path.join(project,'designs/v3'),path.join(project,'designs/v4'),{recursive:true});const dsPath=path.join(project,'designs/v4/design-system.json'),ds=JSON.parse(fs.readFileSync(dsPath));ds.version='1.1.0';ds.tokens.brand='#8855cc';ds.components.push({id:'save-actions',kind:'stack',label:'保存操作组',props:{direction:'horizontal'},children:['secondary-action','primary-action']});fs.writeFileSync(dsPath,JSON.stringify(ds));
 cp.execFileSync(python,['-m','tailorbird_rig','publish',config,'--revision','v4','--root',path.join(project,'designs/v4')],{cwd:root});
 await p.goto(base+'/components.html');await p.locator('[data-id="save-actions"]').waitFor();check('project composition appears without framework changes',await p.locator('.component-entry').count()===10);
 check('token update reaches composed primary controls',await p.locator('[data-id="save-actions"] .rig-primary').evaluate(b=>getComputedStyle(b).backgroundColor)==='rgb(136, 85, 204)');
 await p.goto(base+'/components.html?revision=v3');await p.locator('.component-entry').first().waitFor();check('historical element set remains unchanged',await p.locator('.component-entry').count()===9&&await p.locator('[data-id="primary-action"] .rig-primary').first().evaluate(b=>getComputedStyle(b).backgroundColor)==='rgb(82, 105, 217)');
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});await p.screenshot({path:path.join(root,'test-results/component-library.png')});
 await p.goto(base);await p.getByText('已连接本机批注',{exact:true}).waitFor();check('viewer exposes shared element library',await p.locator('#component-library-link').count()===1);
 const toolbar=p.getByRole('navigation',{name:'评审工具导航'});
 check('review actions and design links are grouped in toolbar',await toolbar.locator('#handoff,#handoff-download,#export,#component-library-link,#lottie-workbench-link').count()===5);
 await p.locator('#review-tools [data-tool=arrow]').click();
 await p.locator('#image').scrollIntoViewIfNeeded();let arrowImg=await p.locator('#image').boundingBox();
 const sx=arrowImg.x+arrowImg.width*.25,sy=arrowImg.y+arrowImg.height*.35,ex=sx+65,ey=sy+45;
 await p.mouse.move(sx,sy);await p.mouse.down();await p.mouse.move(ex,ey,{steps:5});await p.mouse.up();
 await saved();
 const arrow=(await data()).marks.find(m=>m.kind==='arrow'&&!m.deleted);
 check('arrow persists with two ordered endpoints',arrow?.points.length===2&&arrow.points[1][0]>arrow.points[0][0]&&arrow.points[1][1]>arrow.points[0][1]);
 await p.reload();const arrowPath=p.locator('path[data-mark-kind=arrow]');await arrowPath.waitFor();
 check('saved arrow renders shaft and arrowhead on reload',(await arrowPath.getAttribute('d')).split('L').length===4);
 const arrowBounds=await p.locator('path[data-arrow-hit]').boundingBox();
 const cx=arrowBounds.x+arrowBounds.width*.5,cy=arrowBounds.y+arrowBounds.height*.5;
 await p.mouse.move(cx,cy);await p.mouse.down();await p.mouse.move(cx+18,cy+12,{steps:4});await p.mouse.up();await saved();
 check('dragging the arrow moves both endpoints',(await data()).marks.find(m=>m.id===arrow.id).points.every((point,index)=>point[0]>arrow.points[index][0]));
 await p.locator('#review-undo').click();await saved();
 check('undo removes the arrow',(await data()).marks.find(m=>m.id===arrow.id).deleted);
 for(const width of [980,390]){await p.setViewportSize({width,height:844});check('responsive workspace '+width,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))}
 check('no JavaScript errors',errors.length===0);fs.mkdirSync(path.join(root,'test-results'),{recursive:true});await p.screenshot({path:path.join(root,'test-results/browser-mobile.png')});fs.writeFileSync(path.join(root,'test-results/browser.json'),JSON.stringify({pass:true,checks},null,2));console.log(JSON.stringify({pass:true,checks:checks.length}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;fs.mkdirSync(path.join(root,'test-results'),{recursive:true});fs.writeFileSync(path.join(root,'test-results/browser.json'),JSON.stringify({pass:false,checks,error:e.message},null,2))}).finally(async()=>{if(browser)await browser.close();if(server)server.kill()});
