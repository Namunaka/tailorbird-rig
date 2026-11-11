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
 browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});const context=await browser.newContext(),p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.setViewportSize({width:1600,height:1050});await p.goto(base);await p.locator('#page-check-confirm:enabled').waitFor();await p.locator('#image').evaluate(i=>i.decode());
 check('seven fixed device/form options',await p.locator('#devices button').count()===7);
 const development=p.locator('#development-test-progress');
 await development.getByText('1 / 21 个页面 × 机型已通过 · 本期范围例外 6 个').waitFor();
 await p.locator('#review-panel #overall-review-progress + #development-test-progress').waitFor();
 check('development progress sits below design progress and counts all devices in coverage',
  await development.locator('strong').textContent()==='4.8%'&&await development.locator('progress').evaluate(bar=>bar.value===1&&bar.max===21));
 const formRow=p.locator('#states [data-page="form"]');
 const productLink=p.locator('#review-panel [data-doc="product"]'),testLink=p.locator('#review-panel [data-doc="test"]');
 check('review tools stay in the right panel and the directory has no document buttons',
  await p.locator('#states [data-doc],#states #review-progress,#review-tools,#review-text,#review-file,.review-overlay').count()===0&&
  await p.locator('#review-panel #page-check-controls,#review-panel #page-documents,#review-panel #review-progress').count()===3);
 await formRow.click();
 async function openDoc(link){
  const opened=context.waitForEvent('page');await link.click();return opened;
 }
 let pageDoc=await openDoc(productLink);
 await pageDoc.getByText('说明表单功能').waitFor();
 check('right-side product document opens the current page without navigating the viewer',pageDoc.url().endsWith('#product')&&p.url().endsWith('#form@phone-a'));
 await pageDoc.close();
 pageDoc=await openDoc(testLink);
 await pageDoc.getByText('检查表单提交').waitFor();
 check('test entry opens the same document at test cases',pageDoc.url().endsWith('#test')&&await pageDoc.getByText('预期结果').isVisible());
 await pageDoc.close();
 await p.locator('#states [data-page="done"]').click();
 pageDoc=await openDoc(testLink);
 await pageDoc.getByText('此版本尚未关联测试文档。').waitFor();
 await pageDoc.close();
 await p.locator('#states [data-page="welcome"]').click();
 await p.locator('#states [data-page="welcome"]').focus();
 await p.keyboard.press('ArrowDown');
 check('Down selects the next page and keeps navigation focus',p.url().endsWith('#form@phone-a')&&await p.locator('#states [data-page="form"]').evaluate(b=>b===document.activeElement));
 const alphaDevice=p.locator('#devices [data-device="phone-a"]');
 await alphaDevice.locator('.device-alpha').waitFor();
 check('Alpha badge is scoped to its device and separate from review confirmation',await p.locator('.device-alpha').count()===1&&await alphaDevice.getAttribute('data-check')!=='confirmed');
 const comparison=p.locator('#simulator-comparison'),capture=comparison.locator('#simulator-image');
 await capture.evaluate(image=>image.decode());
 const designBox=await p.locator('#image').boundingBox(),captureBox=await capture.boundingBox();
 check('valid Alpha puts the full design on the left and the matching simulator screenshot on the right',
  designBox.x+designBox.width<captureBox.x&&designBox.y===captureBox.y&&
  (await comparison.locator('#simulator-raw').getAttribute('href')).endsWith('/v1/evidence/simulator.png'));
 await p.setViewportSize({width:500,height:900});
 check('narrow comparison stacks both images without horizontal overflow',
  (await capture.boundingBox()).y>(await p.locator('#image').boundingBox()).y&&
  await p.evaluate(()=>document.documentElement.scrollWidth===innerWidth));
 await p.setViewportSize({width:1600,height:1050});
 await p.locator('#devices [data-device="phone-b"]').click();
 await p.locator('#image').waitFor();
 check('a device without simulator evidence returns to the single design view',
  !await comparison.isVisible()&&await capture.getAttribute('src')===null);
 await alphaDevice.click();
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
 const confirmedForm=formRow.and(p.locator('[data-check="confirmed"]'));
 await confirmedForm.waitFor();
 check('design confirmation fills the upper half independently of the dark green test progress below',
  await confirmedForm.evaluate(button=>button.querySelector('.page-review-percent').textContent==='100%'&&
    button.querySelector('.page-development-percent').textContent==='测试 14.3%'&&
    getComputedStyle(button).backgroundImage.includes('rgb(38, 129, 79) 100%')&&
    getComputedStyle(button).backgroundImage.includes('rgb(16, 75, 52) 14.3%')&&
    getComputedStyle(button).backgroundPositionY==='0%, 100%'));
 await p.getByRole('button',{name:'全部取消',exact:true}).click();
 await formRow.and(p.locator('[data-check="default"]')).waitFor();
 await p.keyboard.press('ArrowRight');
 check('Right selects the next device and keeps the page',p.url().endsWith('#form@phone-b'));
 await p.keyboard.press('ArrowLeft');
 await p.keyboard.press('ArrowUp');
 await p.keyboard.press('ArrowUp');
 check('Left and Up select the previous item and stop at the boundary',p.url().endsWith('#welcome@phone-a'));
 check('another page has no Alpha without matching evidence',await p.locator('.device-alpha').count()===0);
 check('development progress covers the whole revision when switching pages',await development.locator('strong').textContent()==='4.8%');
 for(const name of ['折叠屏 A · 折叠','折叠屏 A · 展开','折叠屏 B · 折叠','折叠屏 B · 展开']){await p.getByRole('button',{name,exact:true}).click();await p.locator('#image').evaluate(i=>i.decode());check(name+' switches image',await p.locator('#size').textContent().then(t=>t.includes(name)))}
 await p.getByRole('button',{name:'手机 A · 示例',exact:true}).click();await p.locator('#image').evaluate(i=>i.decode());
 const data=async()=>await(await p.request.get(base+'/api/review')).json();
 // Seed an existing annotation so read-only history and handoff can be exercised.
 const attachment=await(await p.request.post(base+'/api/images',{data:fs.readFileSync(path.join(design,'screens/phone-a/welcome.png'))})).json();
 const historicalMark='historical-fixture';
 await p.request.post(base+'/api/annotations',{data:{operation:'add',operationId:crypto.randomUUID(),id:historicalMark,
  mark:{revision:'v1',page:'welcome',device:'phone-c',kind:'rect',points:[[.2,.2],[.7,.7]]}}});
 await p.request.post(base+'/api/annotations',{data:{operation:'comment',operationId:crypto.randomUUID(),id:historicalMark,
  text:'已有评审记录',attachments:[{id:attachment.id,name:'历史截图'}]}});
 await p.locator('#devices [data-device="phone-c"]').click();
 const bundle=await(await p.request.get(base+'/api/handoff')).json();check('handoff includes numbered feedback and attachment provenance',bundle.issues.length===1&&bundle.markdown.includes('SHA256')&&bundle.markdown.includes('images/'));
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
 // Publishing updates the active tab and keeps prior feedback available.
 fs.cpSync(path.join(project,'designs/v1'),path.join(project,'designs/v2'),{recursive:true});
 cp.execFileSync(python,['-m','tailorbird_rig','publish',config,'--revision','v2','--root',path.join(project,'designs/v2')],{cwd:root});
 await p.waitForFunction(()=>document.querySelector('#revision')?.value==='v2',undefined,{timeout:12000});
 check('new revision loads in the same tab and keeps page and device',context.pages().length===1&&p.url().endsWith('#welcome@phone-c'));
 await p.selectOption('#revision','v1');
 await p.locator('#page-check-confirm:enabled').waitFor();
 const archive=await(await p.request.get(base+'/api/review?revision=v1')).json();
 check('historical feedback and attachment remain readable',archive.marks.some(mark=>mark.id===historicalMark&&mark.comment.attachments[0].id===attachment.id));
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
 check('a bare mark on another device turns the upper band red',await nav.evaluate(b=>getComputedStyle(b).backgroundImage.includes('rgb(150, 61, 71) 100%')));
 await p.getByRole('button',{name:'手机 C · 示例',exact:true}).click();
 await p.request.post(base+'/api/annotations',{data:{operation:'comment',operationId:crypto.randomUUID(),id:event.id,text:'Review this page'}});
 await p.waitForFunction(()=>document.querySelector('#overall-review-progress progress').value===0);check('new feedback invalidates confirmation',true);
 const issueNumber=(await data()).issues.find(i=>i.annotation_id===event.id).number;
 cp.execFileSync(python,['-m','tailorbird_rig','resolve',config,String(issueNumber),'--resolution','Updated synthetic design','--evidence','fixture'],{cwd:root});
 await p.reload();await p.locator('#page-check-confirm:not([disabled])').waitFor();check('resolved feedback paints the upper band amber',await nav.evaluate(b=>getComputedStyle(b).backgroundImage.includes('rgb(129, 87, 22) 100%')));
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
 const ignored=await p.locator('#revision').evaluate(e=>e.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyK',key:'K',metaKey:true,shiftKey:true,bubbles:true,cancelable:true})));
 check('shortcut leaves focused form controls alone',ignored);
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
 await p.goto(base);await p.locator('#page-check-confirm:enabled').waitFor();check('viewer exposes shared element library',await p.locator('#component-library-link').count()===1);
 const toolbar=p.getByRole('navigation',{name:'评审工具导航'});
 check('review actions and design links are grouped in toolbar',await toolbar.locator('#handoff,#handoff-download,#export,#component-library-link,#lottie-workbench-link').count()===5);
 const liveRoot=path.join(project,'designs/v5');
 fs.cpSync(path.join(project,'designs/v4'),liveRoot,{recursive:true});
 const coveragePath=path.join(liveRoot,'coverage.json'),coverage=JSON.parse(fs.readFileSync(coveragePath,'utf8'));
 coverage.live_previews={form:'preview.html'};
 fs.writeFileSync(coveragePath,JSON.stringify(coverage));
 fs.writeFileSync(path.join(liveRoot,'preview.html'),`<!doctype html><button>Try action</button><output></output>
 <script>
 const output=document.querySelector('output');
 document.querySelector('button').onclick=()=>{
  let isolated=false;try{parent.document.title}catch{isolated=true}
  output.textContent=new URLSearchParams(location.search).get('device')+' '+innerWidth+' '+isolated;
 };
 </script>`);
 cp.execFileSync(python,['-m','tailorbird_rig','publish',config,'--revision','v5','--root',liveRoot],{cwd:root});
 await p.goto(base+'/?revision=v5#form@phone-a');
 await p.locator('#development-test-progress').getByText('0 / 21 个页面 × 机型已通过').waitFor();
 check('a changed form preview clears Alpha and comparison despite copied evidence',
  await p.locator('#devices .device-alpha').count()===0&&!await comparison.isVisible()&&await formRow.locator('.page-development-percent').textContent()==='测试 0%');
 const live=p.frameLocator('.live-preview-frame'),tryAction=live.getByRole('button',{name:'Try action'});
 await tryAction.click();
 const logicalWidth=id=>Math.ceil(coverage.devices.find(d=>d.id===id).w);
 await live.locator('output').getByText('phone-a '+logicalWidth('phone-a')+' true',{exact:true}).waitFor();
 const liveResponse=await p.request.get(base+'/revisions/v5/preview.html');
 check('live preview runs in canvas with opaque origin and a server sandbox',
  (await p.locator('.live-preview-frame').getAttribute('sandbox'))==='allow-scripts'&&liveResponse.headers()['content-security-policy'].includes('sandbox allow-scripts'));
 await p.locator('#devices [data-device="phone-b"]').click();
 await tryAction.click();
 await live.locator('output').getByText('phone-b '+logicalWidth('phone-b')+' true',{exact:true}).waitFor();
 await p.locator('#page-check-confirm').click();
 await p.locator('#page-check-confirm[aria-pressed=true]').waitFor();
 check('live preview uses the selected device and existing confirmation',p.url().endsWith('#form@phone-b')&&await p.locator('.live-preview-frame').isVisible());
 await p.getByRole('button',{name:'查看静态图'}).click();
 await p.locator('#image').waitFor();
 check('the canvas toggles to its static reference',await p.locator('.live-preview-frame').count()===0&&
  (await p.locator('#image').getAttribute('src')).endsWith('/screens/phone-b/form.png'));
 await p.getByRole('button',{name:'试用交互稿'}).click();
 await tryAction.waitFor();
 const evidencePath=path.join(liveRoot,'implementation-evidence.json'),fresh=JSON.parse(fs.readFileSync(evidencePath,'utf8'));
 fresh.pages.form['phone-a'].build='fixture.2';
 fs.writeFileSync(evidencePath,JSON.stringify(fresh));
 await p.locator('#devices [data-device="phone-a"]').click();
 await p.reload();
 await comparison.waitFor();
 check('Alpha comparison starts with the static design even when there is an interactive preview',
  await p.locator('#image').isVisible()&&await p.locator('.live-preview-frame').count()===0);
 await p.getByRole('button',{name:'试用交互稿'}).click();
 await tryAction.click();
 check('interactive preview remains usable on the left with the simulator screenshot on the right',
  await capture.isVisible()&&await live.locator('output').getByText('phone-a '+logicalWidth('phone-a')+' true',{exact:true}).isVisible());
 await p.locator('#states [data-page="welcome"]').click();
 check('ordinary design pages have no live canvas controls',await p.locator('.live-preview-frame').count()===0&&!(await p.locator('.live-preview-tools').isVisible()));
 for(const width of [980,390]){await p.setViewportSize({width,height:844});check('responsive workspace '+width,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))}
 check('no JavaScript errors',errors.length===0);fs.mkdirSync(path.join(root,'test-results'),{recursive:true});await p.screenshot({path:path.join(root,'test-results/browser-mobile.png')});fs.writeFileSync(path.join(root,'test-results/browser.json'),JSON.stringify({pass:true,checks},null,2));console.log(JSON.stringify({pass:true,checks:checks.length}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;fs.mkdirSync(path.join(root,'test-results'),{recursive:true});fs.writeFileSync(path.join(root,'test-results/browser.json'),JSON.stringify({pass:false,checks,error:e.message},null,2))}).finally(async()=>{if(browser)await browser.close();if(server)server.kill()});
