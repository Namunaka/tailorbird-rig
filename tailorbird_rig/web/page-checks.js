(()=>{
 const panel=document.querySelector('#review-panel'),area=document.createElement('section');area.id='page-check-controls';
 area.innerHTML='<h3>界面检查</h3><p id="page-check-state" role="status">正在读取检查状态…</p><div class="page-check-actions"><button id="page-check-confirm" disabled><span>检查确认</span><kbd aria-hidden="true"></kbd></button><button id="page-check-all" disabled><span>全部确认</span><kbd aria-hidden="true"></kbd></button></div><p>红色待修改 · 黄色待复查 · 绿色已通过。左侧按所有机型累计。</p>';
 panel.insertBefore(area,document.querySelector('#review-tools'));
 let pages={},progress={},deviceStatuses={},overviewReady=false,overviewPending=false,writeGeneration=0;
 let loadedDevice='',batchPage='',batchDigest='',pending=null,confirming=false;
 const button=document.querySelector('#page-check-confirm'),allButton=document.querySelector('#page-check-all'),note=document.querySelector('#page-check-state');
 function percent({confirmed,total}){
  return confirmed===total?100:Math.min(99.9,Math.round(1000*confirmed/total)/10);
 }
 function apply(data){
  pages=loadedDevice===data.device?{...pages,...data.pages}:data.pages;
  Object.assign(progress,data.progress);Object.assign(deviceStatuses,data.device_statuses);
  overviewReady||=Boolean(data.overall);loadedDevice=data.device;
  batchPage=data.active_page;batchDigest=data.batch_sha256;paint();
 }
 async function refreshOverview(){
  if(confirming||overviewPending)return;
  overviewPending=true;
  const generation=writeGeneration,target=device;
  try{
   const query=new URLSearchParams({revision:RIG.revision,device:target});
   const response=await fetch('/api/page-checks?'+query,{cache:'no-store',signal:AbortSignal.timeout(requestTimeout)});
   if(!response.ok)return;
   const data=await response.json();
   if(generation!==writeGeneration)return;
   progress={...data.progress,...(progress[state]?{[state]:progress[state]}:{})};
   deviceStatuses={...data.device_statuses,...(deviceStatuses[state]?{[state]:deviceStatuses[state]}:{})};
   if(target===loadedDevice)pages={...data.pages,...pages};
   overviewReady=true;paint();
  }catch{}finally{
   overviewPending=false;
   if(!overviewReady&&generation!==writeGeneration)refreshOverview();
  }
 }
 function paint(){
  const current=loadedDevice===device?pages[state]:null;
  if(overviewReady){
   const counts=Object.values(progress);
   const overall={confirmed:counts.reduce((sum,page)=>sum+page.confirmed,0),total:C.states.length*C.devices.length,
                  needs_work:counts.some(page=>page.needs_work),needs_check:counts.some(page=>page.needs_check)};
   const sidebar=document.querySelector('#states');
   let summary=sidebar.querySelector('#overall-review-progress');
   if(!summary){
    summary=document.createElement('div');summary.id='overall-review-progress';
    summary.innerHTML='<div class="overall-review-label"><span>总确认进度</span><strong></strong></div><progress aria-label="总确认进度"></progress><small></small>';
    sidebar.prepend(summary);
   }
   summary.dataset.check=overall.needs_work?'needs_work':overall.needs_check?'needs_check':'default';
   summary.querySelector('strong').textContent=percent(overall)+'%';
   const bar=summary.querySelector('progress');bar.max=overall.total;bar.value=overall.confirmed;
   summary.querySelector('small').textContent=overall.confirmed+' / '+overall.total+' 个页面 × 机型';
  }
  for(const b of document.querySelectorAll('#states button[data-page]')){
   const check=progress[b.dataset.page];
   if(!check)continue;
   const value=percent(check);
   b.dataset.check=check.needs_work?'needs_work':check.needs_check?'needs_check':value===100?'confirmed':value>0?'partial':'default';
   b.style.setProperty('--review-progress',value+'%');
   b.title=check.confirmed+' / '+check.total+' 个机型已确认'+(check.needs_work?' · 有机型待修改':check.needs_check?' · 有机型待复查':'');
   let count=b.querySelector('.page-review-percent');
   if(!count){
    count=document.createElement('span');count.className='page-review-percent';
    const label=document.createElement('span');label.textContent=b.textContent;
    b.replaceChildren(count,label);
   }
   count.textContent=value+'%';
  }
  for(const b of document.querySelectorAll('#devices button[data-device]')){
   const status=deviceStatuses[state]?.[b.dataset.device];
   b.dataset.check=status||'default';
   b.title=status==='confirmed'?'当前页面 · 已检查确认':status==='needs_work'?'当前页面 · 待修改':status==='needs_check'?'当前页面 · 待复查':'当前页面 · 尚未确认';
  }
  const checked=current?.status==='confirmed';
  note.textContent=checked?'当前界面已检查确认，再点一次可撤回':current?.status==='needs_work'?'当前机型有标记，待修改':current?.status==='needs_check'?'修改已完成，等待复查':'当前界面尚未确认';
  button.querySelector('span').textContent=checked?'已检查确认':'检查确认';
  button.setAttribute('aria-pressed',String(checked));
  button.disabled=confirming||!current||!document.querySelector('#image').complete||!document.querySelector('#image').naturalWidth;
  const pageProgress=progress[state];
  const allChecked=pageProgress&&pageProgress.confirmed===pageProgress.total;
  allButton.dataset.check=allChecked?'confirmed':'default';
  allButton.querySelector('span').textContent=allChecked?'全部取消':'全部确认';
  allButton.title=allChecked?'撤回当前页面所有机型的确认':'确认当前页面的所有机型';
  allButton.disabled=button.disabled;
 }
 const requestTimeout=12000;
 async function readChecks(page,target,signal=AbortSignal.timeout(requestTimeout)){
  const query=new URLSearchParams({revision:RIG.revision,device:target,scope:'page',page});
  const r=await fetch('/api/page-checks?'+query,{cache:'no-store',signal});
  if(!r.ok)throw Error('检查状态暂时无法读取，请稍后重试');
  return r.json();
 }
 async function refresh(force=false){
  const page=state,target=device;
  if(confirming||(!force&&pending?.page===page&&pending.target===target))return;
  const task={page,target,result:readChecks(page,target)};pending=task;
  try{
   const data=await task.result;
   if(pending===task&&target===device&&page===state)apply(data);
  }catch{
   if(pending===task){note.textContent='检查状态暂时无法读取，请稍后重试';button.disabled=allButton.disabled=true}
  }finally{
   if(pending===task)pending=null;
  }
 }
 async function submit(all){
  const page=state,target=device,check=pages[page];
  const confirmed=all?allButton.dataset.check!=='confirmed':check.status!=='confirmed';
  const waiting=pending?.page===page&&pending.target===target?pending.result:null;
  const signal=AbortSignal.timeout(requestTimeout);
  confirming=true;writeGeneration++;pending=null;paint();
  if(all)note.textContent=confirmed?'正在确认全部机型…':'正在撤回全部机型的确认…';
  try{
   let action={content_sha256:check.content_sha256,feedback_sha256:check.feedback_sha256};
   if(all){
    let digest=batchPage===page?batchDigest:null;
    if(!digest){
     const fresh=await (waiting||readChecks(page,target,signal));
     const current=fresh.pages[page];
     if(!fresh.batch_sha256||Object.keys(action).some(key=>current?.[key]!==action[key])){
      throw Error('页面或反馈已变化，请刷新状态后重试');
     }
     digest=fresh.batch_sha256;
    }
    action={batch_sha256:digest};
   }
   const r=await fetch('/api/page-checks/confirm',{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:RIG.revision,page,device:target,scope:'page',confirmed,...action})});
   if(!r.ok)throw Error('页面或反馈已变化，请刷新状态后重试');
   const data=await r.json();if(device===target)apply(data);
  }catch(e){
   confirming=false;paint();
   if(page===state&&target===device){
    note.textContent=e.name==='TimeoutError'?'确认请求超时，正在重新读取状态…':e.message;
    button.disabled=allButton.disabled=true;
   }
   refresh(true);
   return;
  }
  confirming=false;paint();
  if(page!==state||target!==device)refresh();
  if(!overviewReady)refreshOverview();
 }
 button.onclick=()=>submit(false);
 allButton.onclick=()=>submit(true);
 const settings=document.querySelector('#shortcut-settings'),dialog=document.querySelector('#shortcut-dialog');
 const records=dialog.querySelectorAll('[data-shortcut]'),help=document.querySelector('#shortcut-help');
 const storageKey='tailorbird-rig:review-shortcuts';
 const defaults={single:'Meta+B',all:'Shift+Meta+B'},buttons={single:button,all:allButton};
 const validShortcut=/^(?=.*(?:Control|Alt|Meta)\+)(?:Control\+)?(?:Alt\+)?(?:Shift\+)?(?:Meta\+)?[A-Z0-9]$/;
 const instructions=help.textContent;
 let shortcuts={...defaults},draft;
 function shortcutLabel(value){
  const command=value.includes('Meta+')?'⌘':'';
  return command+value.replace('Meta+','').replace('Control+','Ctrl+').replace('Shift+','⇧');
 }
 function keyCombination(e){
  if(!(e.metaKey||e.ctrlKey||e.altKey))return '';
  const key=/^Key[A-Z]$/.test(e.code)?e.code.slice(3):/^Digit[0-9]$/.test(e.code)?e.code.slice(5):'';
  if(!key)return '';
  return [e.ctrlKey&&'Control',e.altKey&&'Alt',e.shiftKey&&'Shift',e.metaKey&&'Meta',key].filter(Boolean).join('+');
 }
 try{
  const saved=JSON.parse(localStorage.getItem(storageKey));
  const legacy=localStorage.getItem('tailorbird-rig:batch-review-shortcut');
  if(saved&&validShortcut.test(saved.single)&&validShortcut.test(saved.all)&&saved.single!==saved.all){
   shortcuts=saved;
  }else if(validShortcut.test(legacy)&&legacy!==defaults.single){
   shortcuts.all=legacy;
  }
 }catch{}
 function showShortcuts(){
  for(const [action,target] of Object.entries(buttons)){
   target.setAttribute('aria-keyshortcuts',shortcuts[action]);
   target.querySelector('kbd').textContent=shortcutLabel(shortcuts[action]);
  }
 }
 function showDraft(){
  for(const record of records)record.textContent=shortcutLabel(draft[record.dataset.shortcut]);
  help.textContent=instructions;
 }
 showShortcuts();
 settings.disabled=false;
 settings.onclick=()=>{
  draft={...shortcuts};showDraft();dialog.showModal();
 };
 document.querySelector('#shortcut-reset').onclick=()=>{
  draft={...defaults};showDraft();
 };
 dialog.addEventListener('keydown',e=>{
  e.stopPropagation();
  const action=e.target.dataset.shortcut;
  if(!action||e.repeat||e.isComposing)return;
  const combination=keyCombination(e);
  if(!combination)return;
  e.preventDefault();
  draft[action]=combination;e.target.textContent=shortcutLabel(combination);help.textContent='已录入，点击保存后生效。';
 });
 dialog.querySelector('form').addEventListener('submit',e=>{
  if(e.submitter?.value!=='save')return;
  e.preventDefault();
  if(draft.single===draft.all){help.textContent='两个操作需要使用不同的快捷键。';return}
  try{localStorage.setItem(storageKey,JSON.stringify(draft))}catch{help.textContent='浏览器无法保存快捷键设置。';return}
  shortcuts=draft;showShortcuts();dialog.close();
 });
 document.addEventListener('keydown',e=>{
  if(e.defaultPrevented||e.isComposing||dialog.open||
     e.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))return;
  const combination=keyCombination(e);
  const target=combination===shortcuts.single?button:combination===shortcuts.all?allButton:null;
  if(!target)return;
  e.preventDefault();
  if(!e.repeat)target.click();
 });
 const previous=draw;draw=function(){previous();paint();refresh()};
 document.querySelector('#image').addEventListener('load',paint);
 document.addEventListener('rig:review-saved',()=>refresh(true));
 refresh();refreshOverview();
 setInterval(()=>{if(!document.hidden)refresh()},3000);
 setInterval(()=>{if(!document.hidden)refreshOverview()},15000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){refresh();refreshOverview()}});
})();
