(()=>{
 const panel=document.querySelector('#review-panel'),area=document.createElement('section');area.id='page-check-controls';
 area.innerHTML='<h3>界面检查</h3><p id="page-check-state" role="status">正在读取检查状态…</p><div class="page-check-actions"><button id="page-check-confirm" disabled>检查确认</button><button id="page-check-all" title="确认当前页面的所有机型" disabled>全部确认</button></div><p>红色待修改 · 黄色待复查 · 绿色已通过。左侧按所有机型累计。</p>';
 panel.insertBefore(area,document.querySelector('#review-tools'));
 let pages={},progress={},deviceStatuses={},overall=null,loadedDevice='',batchPage='',batchDigest='',pending=null,confirming=false;
 const button=document.querySelector('#page-check-confirm'),allButton=document.querySelector('#page-check-all'),note=document.querySelector('#page-check-state');
 function percent({confirmed,total}){
  return confirmed===total?100:Math.min(99.9,Math.round(1000*confirmed/total)/10);
 }
 function apply(data){
  pages=data.pages;progress=data.progress;deviceStatuses=data.device_statuses||{};overall=data.overall;loadedDevice=data.device;
  batchPage=data.active_page;batchDigest=data.batch_sha256;paint();
 }
 function paint(){
  const current=loadedDevice===device?pages[state]:null;
  if(overall){
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
  button.textContent=checked?'已检查确认':'检查确认';
  button.setAttribute('aria-pressed',String(checked));
  button.disabled=confirming||!current||!document.querySelector('#image').complete||!document.querySelector('#image').naturalWidth;
  const pageProgress=progress[state];
  const allChecked=pageProgress&&pageProgress.confirmed===pageProgress.total;
  allButton.dataset.check=allChecked?'confirmed':'default';
  allButton.textContent=allChecked?'全部取消':'全部确认';
  allButton.title=allChecked?'撤回当前页面所有机型的确认':'确认当前页面的所有机型';
  allButton.disabled=button.disabled;
 }
 async function readChecks(page,target){
  const query=new URLSearchParams({revision:RIG.revision,device:target,page});
  const r=await fetch('/api/page-checks?'+query,{cache:'no-store'});
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
  if(window.rigCanRefresh&&!rigCanRefresh()){note.textContent='请先保存评论或完成当前操作，再更改确认状态';return}
  const page=state,target=device,check=pages[page];
  const confirmed=all?allButton.dataset.check!=='confirmed':check.status!=='confirmed';
  const waiting=pending?.page===page&&pending.target===target?pending.result:null;
  confirming=true;pending=null;paint();
  if(all)note.textContent=confirmed?'正在确认全部机型…':'正在撤回全部机型的确认…';
  try{
   let action={content_sha256:check.content_sha256,feedback_sha256:check.feedback_sha256};
   if(all){
    let digest=batchPage===page?batchDigest:null;
    if(!digest){
     const fresh=await (waiting||readChecks(page,target));
     const current=fresh.pages[page];
     if(!fresh.batch_sha256||Object.keys(action).some(key=>current?.[key]!==action[key])){
      throw Error('页面或反馈已变化，请刷新状态后重试');
     }
     digest=fresh.batch_sha256;
    }
    action={batch_sha256:digest};
   }
   const r=await fetch('/api/page-checks/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:RIG.revision,page,device:target,confirmed,...action})});
   if(!r.ok)throw Error('页面或反馈已变化，请刷新状态后重试');
   const data=await r.json();if(device===target)apply(data);
  }catch(e){
   confirming=false;paint();
   if(page===state&&target===device){note.textContent=e.message;button.disabled=allButton.disabled=true}
   return;
  }
  confirming=false;paint();
  if(page!==state||target!==device)refresh();
 }
 button.onclick=()=>submit(false);
 allButton.onclick=()=>submit(true);
 const previous=draw;draw=function(){previous();paint();refresh()};
 document.querySelector('#image').addEventListener('load',paint);
 document.addEventListener('rig:review-saved',()=>refresh(true));
 refresh();setInterval(refresh,3000);
})();
