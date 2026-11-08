var C,state,device,draw,resolveState,RIG;
(async()=>{
 const $=s=>document.querySelector(s),params=new URLSearchParams(location.search);
 const response=await fetch('/api/project'+(params.has('revision')?'?revision='+encodeURIComponent(params.get('revision')):''));
 if(!response.ok)throw Error('项目配置无法加载');RIG=await response.json();C=RIG.manifest;C.labels ||= {};C.devices=C.devices.map(d=>({name:d.id,...d}));
 resolveState=s=>C.states.includes(s)?s:RIG.aliases[s]||s;
 const q=location.hash.slice(1).split('@');state=C.states.includes(resolveState(q[0]))?resolveState(q[0]):C.states[0];device=C.devices.some(d=>d.id===q[1])?q[1]:C.devices[0].id;
 document.title=RIG.title+' · '+RIG.revision+' | Tailorbird Rig';$('#project-title').textContent=RIG.title+' · '+RIG.revision;$('#project-description').textContent=RIG.description;
 for(const rev of RIG.revisions){const o=document.createElement('option');o.value=rev.id;o.textContent=rev.label;$('#revision').append(o)}$('#revision').value=RIG.revision;
 $('#revision').onchange=()=>{if(window.rigCanRefresh&&!window.rigCanRefresh()){ $('#error').textContent='请先保存评论或完成当前操作，再切换版本';$('#revision').value=RIG.revision;return}const id=$('#revision').value;location.assign(location.pathname+(id===RIG.currentRevision?'':'?revision='+encodeURIComponent(id))+location.hash)};
 const safeLink=u=>typeof u==='string'&&((u.startsWith('/')&&!u.startsWith('//'))||/^https?:\/\//.test(u));
 for(const link of RIG.links){
  if(!safeLink(link.url))continue;
  const a=document.createElement('a');a.href=link.url;a.className='tool-link';
  a.innerHTML='<svg aria-hidden="true"><use href="#tool-document"/></svg>';
  a.append(document.createTextNode(link.label));$('#links').append(a);
 }
 $('#tool-project-links').hidden=!$('#links').children.length;
 $('#export').href='/api/review?revision='+encodeURIComponent(RIG.revision);
 const handoffLabel=$('#handoff-label');
 $('#handoff').onclick=async()=>{
  try{
   const r=await fetch('/api/handoff');if(!r.ok)throw Error('导出失败');
   const data=await r.json();await navigator.clipboard.writeText(data.markdown);
   handoffLabel.textContent='已复制问题清单';setTimeout(()=>handoffLabel.textContent='复制待处理问题',2000);
  }catch(e){$('#error').textContent='无法复制，请使用工具栏的「下载问题交接」。'}
 };
 if(params.has('revision'))$('#component-library-link').href='/components.html?revision='+encodeURIComponent(RIG.revision);
 const docTypes={product:['产','产品文档'],test:['测','测试文档']};
 function pageRow(page,button){
  const row=document.createElement('div'),links=document.createElement('div');
  const stats=document.createElement('span'),review=document.createElement('span'),test=document.createElement('span');
  const label=document.createElement('span');label.textContent=button.textContent;
  stats.className='page-row-progress';review.className='page-review-percent';test.className='page-development-percent';
  test.hidden=true;stats.append(review,test);button.replaceChildren(stats,label);
  showPageDevelopment(button);
  row.className='state-row';links.className='page-doc-links';row.append(button,links);
  for(const [type,[icon,label]] of Object.entries(docTypes)){
   const link=document.createElement('a');link.className='page-doc-link';link.dataset.doc=type;
   link.textContent=icon;link.title=label;link.setAttribute('aria-label',(C.labels[page]||page)+' · '+label);
   const query=new URLSearchParams({revision:RIG.revision,page,device});
   link.href='/assets/page-doc.html?'+query+'#'+type;link.target='_blank';link.rel='noopener';links.append(link);
  }
  return row;
 }
 const revisionRoot='/revisions/'+encodeURIComponent(RIG.revision)+'/';
 let implementation={};
 const developmentByPage=new Map();
 const developmentProgress=document.createElement('div');
 developmentProgress.id='development-test-progress';
 developmentProgress.innerHTML='<div class="overall-review-label"><span>开发测试进度</span><strong>—</strong></div><progress aria-label="开发测试进度" hidden></progress><small role="status">正在读取测试证据…</small>';
 function evidenceUrl(path){
  if(typeof path!=='string'||path.includes('\\'))return null;
  const parts=path.split('/');
  if(parts.some(part=>!part||part==='.'||part==='..'))return null;
  return revisionRoot+parts.map(encodeURIComponent).join('/');
 }
 function alphaEvidence(page,id){
  const entry=implementation[page]?.[id];
  return entry?.status==='alpha'&&entry.environment==='simulator'&&entry.result==='passed'&&
         evidenceUrl(entry.screenshot)&&typeof entry.summary==='string'&&entry.summary.trim()&&
         typeof entry.build==='string'&&entry.build.trim()?entry:null;
 }
 function showDevelopmentProgress(exclusions){
  let passed=0,excluded=0;
  for(const page of C.states){
   let pagePassed=0,pageExcluded=0;
   for(const {id} of C.devices){
    if(alphaEvidence(page,id)){pagePassed++;continue}
    const exception=exclusions?.[page]?.[id];
    if(['not_implemented','out_of_scope'].includes(exception?.kind)&&
       typeof exception.reason==='string'&&exception.reason.trim())pageExcluded++;
   }
   developmentByPage.set(page,{passed:pagePassed,total:C.devices.length,excluded:pageExcluded});
   passed+=pagePassed;excluded+=pageExcluded;
  }
  for(const button of $('#states').querySelectorAll('button[data-page]'))showPageDevelopment(button);
  const total=C.states.length*C.devices.length;
  const percent=developmentPercent(passed,total);
  developmentProgress.querySelector('strong').textContent=total?percent+'%':'—';
  const bar=developmentProgress.querySelector('progress');
  bar.hidden=!total;
  if(total){bar.max=total;bar.value=passed}
  const label=passed+' / '+total+' 个页面 × 机型已通过';
  developmentProgress.querySelector('small').textContent=label+(excluded?' · 本期范围例外 '+excluded+' 个':'');
 }
 function developmentPercent(passed,total){
  if(!total)return 0;
  return passed===total?100:Math.min(99.9,Math.round(1000*passed/total)/10);
 }
 function showPageDevelopment(button){
  const progress=developmentByPage.get(button.dataset.page);
  if(!progress)return;
  const {passed,total,excluded}=progress,percent=developmentPercent(passed,total);
  const label=button.querySelector('.page-development-percent');
  label.hidden=false;label.textContent='测试 '+percent+'%';
  label.title=passed+' / '+total+' 个机型已通过'+(excluded?' · 本期范围例外 '+excluded+' 个':'');
  button.style.setProperty('--development-progress',percent+'%');
 }
 function decorateDevices(){
  for(const control of $('#devices').querySelectorAll('button[data-device]')){
   const entry=alphaEvidence(state,control.dataset.device);
   if(!entry||control.closest('.device-evidence'))continue;
   const screenshot=evidenceUrl(entry.screenshot);
   const wrapper=document.createElement('div');wrapper.className='device-evidence';
   const badge=document.createElement('span');badge.className='device-alpha';badge.textContent='Alpha';
   badge.setAttribute('aria-hidden','true');control.append(badge);control.removeAttribute('title');
   const report=document.createElement('div');report.className='device-report';
   const title=document.createElement('strong');title.textContent='Alpha · 模拟器测试报告';
   const summary=document.createElement('p');summary.textContent=entry.summary;
   const build=document.createElement('small');build.textContent='测试通过 · 构建 '+entry.build;
   const image=document.createElement('img');image.alt='模拟器截图';
   const reportUrl=evidenceUrl(entry.report),link=document.createElement('a');link.href=reportUrl||screenshot;
   link.target='_blank';link.rel='noopener';link.textContent=reportUrl?'打开完整报告 ↗':'查看原始截图 ↗';
   report.append(title,build,image,summary,link);
   report.id='device-report-'+control.dataset.device;
   control.setAttribute('aria-describedby',report.id);
   control.replaceWith(wrapper);wrapper.append(control,report);
   function positionReport(){
    delete wrapper.dataset.dismissed;
    const rect=wrapper.getBoundingClientRect();
    const width=Math.min(320,window.innerWidth-24);
    const left=Math.max(12,Math.min(rect.left,window.innerWidth-width-12));
    report.style.setProperty('--report-shift',(left-rect.left)+'px');
    const below=window.innerHeight-rect.bottom,above=rect.top;
    wrapper.classList.toggle('report-above',below<360&&above>below);
    report.style.setProperty('--report-height',Math.max(80,Math.min(430,Math.max(above,below)-12))+'px');
    if(!image.hasAttribute('src'))image.src=screenshot;
   }
   wrapper.addEventListener('pointerenter',positionReport);
   wrapper.addEventListener('focusin',positionReport);
   wrapper.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&wrapper.dataset.dismissed!=='true'){
     event.stopPropagation();control.focus({preventScroll:true});wrapper.dataset.dismissed='true';
    }
   });
  }
 }
 draw=function(){
  $('#states').replaceChildren(developmentProgress);$('#devices').replaceChildren();
  const assigned=new Set(),groups=RIG.groups.map(g=>({...g,states:g.states.filter(s=>C.states.includes(s))}));
  for(const g of groups)for(const s of g.states)assigned.add(s);
  const remaining=C.states.filter(s=>!assigned.has(s));if(remaining.length)groups.push({label:'设计页面',states:remaining});
  for(const g of groups){if(!g.states.length)continue;const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=g.label;details.open=g.states.includes(state);details.append(summary);for(const s of g.states){const b=document.createElement('button');b.dataset.page=s;b.textContent=C.labels?.[s]||s;b.className=s===state?'active':'';b.onclick=()=>{$('#error').textContent='';state=s;draw()};details.append(pageRow(s,b))}$('#states').append(details)}
  for(const d of C.devices){const b=document.createElement('button');b.textContent=d.name||d.id;b.dataset.device=d.id;b.className=d.id===device?'active':'';b.setAttribute('aria-pressed',String(d.id===device));b.onclick=()=>{$('#error').textContent='';device=d.id;draw()};$('#devices').append(b)}
  decorateDevices();
  $('#title').textContent=C.labels?.[state]||state;const d=C.devices.find(d=>d.id===device);$('#size').textContent=d.physicalW?`${d.physicalW} × ${d.physicalH} px · ${d.name} · ${RIG.revision}`:`${d.w} × ${d.h} 设计画幅 · ${d.name} · ${RIG.revision}`;
  const rel=(C.image_template||'screens/{device}/{state}.png').replace('{device}',device).replace('{state}',state);
  const url='/revisions/'+encodeURIComponent(RIG.revision)+'/'+rel.split('/').map(encodeURIComponent).join('/');$('#image').src=url;$('#image').alt=(C.labels?.[state]||state)+' · '+d.name;$('#raw').href=url;history.replaceState(null,'',location.pathname+location.search+'#'+state+'@'+device);
 };
 const arrows={ArrowUp:['#states [data-page]',-1],ArrowDown:['#states [data-page]',1],
               ArrowLeft:['#devices [data-device]',-1],ArrowRight:['#devices [data-device]',1]};
 document.addEventListener('keydown',e=>{
  const step=arrows[e.key];
  if(!step||e.defaultPrevented||e.isComposing||e.metaKey||e.ctrlKey||e.altKey||e.shiftKey||
     document.querySelector('dialog[open]')||
     e.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))return;
  e.preventDefault();
  const [selector,direction]=step;
  const items=[...document.querySelectorAll(selector)];
  const current=items.findIndex(item=>item.classList.contains('active'));
  const next=current<0?null:items[current+direction];
  if(!next)return;
  const keepFocus=e.target.closest?.('#states,#devices');
  next.click();
  if(next.isConnected)return;
  const active=document.querySelector(selector+'.active');
  if(keepFocus)active.focus({preventScroll:true});
  active.scrollIntoView({block:'nearest',inline:'nearest'});
 });
 draw();const script=document.createElement('script');script.src='/assets/review.js';script.onload=()=>{const checks=document.createElement('script');checks.src='/assets/page-checks.js';document.body.append(checks)};document.body.append(script);
 fetch(revisionRoot+'implementation-evidence.json').then(r=>{
  if(r.status===404)return null;
  if(!r.ok)throw Error();
  return r.json();
 }).then(data=>{
  implementation=data?.pages||{};showDevelopmentProgress(data?.exclusions);decorateDevices();
 }).catch(()=>{developmentProgress.querySelector('small').textContent='暂时无法读取测试证据'});
 // Follow the latest revision in this tab; explicitly selected historical revisions remain pinned.
 setInterval(async()=>{if(params.has('revision'))return;try{const r=await fetch('/api/project',{cache:'no-store'});if(!r.ok)return;const next=await r.json();if(next.revision!==RIG.revision){if(window.rigCanRefresh&&!window.rigCanRefresh()){$('#error').textContent='新版本 '+next.revision+' 已就绪，请先保存当前评论；保存后本页会更新。';return}location.reload()}}catch{}},3000);
})().catch(e=>document.querySelector('#error').textContent=e.message);
