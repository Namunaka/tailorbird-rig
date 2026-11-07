(()=>{
 const panel=document.querySelector('#review-panel'),area=document.createElement('section');area.id='page-check-controls';
 area.innerHTML='<h3>界面检查</h3><p id="page-check-state" role="status">正在读取检查状态…</p><button id="page-check-confirm" disabled>检查确认</button><p>左侧按所有机型累计。任一机型有待检查的标记，页面会显示黄色。</p>';
 panel.insertBefore(area,document.querySelector('#review-tools'));
 let pages={},progress={},deviceStatuses={},overall=null,loadedDevice='',request=0,confirming=false;
 const button=document.querySelector('#page-check-confirm'),note=document.querySelector('#page-check-state');
 function percent({confirmed,total}){
  return confirmed===total?100:Math.min(99.9,Math.round(1000*confirmed/total)/10);
 }
 function apply(data){
  pages=data.pages;progress=data.progress;deviceStatuses=data.device_statuses||{};overall=data.overall;loadedDevice=data.device;paint();
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
   summary.dataset.check=overall.needs_check?'needs_check':'default';
   summary.querySelector('strong').textContent=percent(overall)+'%';
   const bar=summary.querySelector('progress');bar.max=overall.total;bar.value=overall.confirmed;
   summary.querySelector('small').textContent=overall.confirmed+' / '+overall.total+' 个页面 × 机型';
  }
  for(const b of document.querySelectorAll('#states button[data-page]')){
   const check=progress[b.dataset.page];
   if(!check)continue;
   const value=percent(check);
   b.dataset.check=check.needs_check?'needs_check':value===100?'confirmed':value>0?'partial':'default';
   b.style.setProperty('--review-progress',value+'%');
   b.title=check.confirmed+' / '+check.total+' 个机型已确认'+(check.needs_check?' · 有机型待检查':'');
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
   b.title=status==='confirmed'?'当前页面 · 已检查确认':status==='needs_check'?'当前页面 · 待检查':'当前页面 · 尚未确认';
  }
  const checked=current?.status==='confirmed';
  note.textContent=checked?'当前界面已检查确认，再点一次可撤回':current?.status==='needs_check'?'当前机型有标记，请检查确认':'当前界面尚未确认';
  button.textContent=checked?'已检查确认':'检查确认';
  button.setAttribute('aria-pressed',String(checked));
  button.disabled=confirming||!current||!document.querySelector('#image').complete||!document.querySelector('#image').naturalWidth;
 }
 async function refresh(){
  if(confirming)return;
  const serial=++request,target=device;
  try{
   const r=await fetch('/api/page-checks?revision='+encodeURIComponent(RIG.revision)+'&device='+encodeURIComponent(target),{cache:'no-store'});
   if(!r.ok)throw Error();
   const data=await r.json();if(serial===request&&target===device)apply(data);
  }catch{if(serial===request){note.textContent='检查状态暂时无法读取，请稍后重试';button.disabled=true}}
 }
 button.onclick=async()=>{
  if(window.rigCanRefresh&&!rigCanRefresh()){note.textContent='请先保存评论或完成当前操作，再更改确认状态';return}
  const page=state,target=device,check=loadedDevice===device?pages[page]:null;if(!check)return;
  confirming=true;++request;paint();
  try{const r=await fetch('/api/page-checks/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:RIG.revision,page,device:target,content_sha256:check.content_sha256,feedback_sha256:check.feedback_sha256,confirmed:check.status!=='confirmed'})});if(!r.ok)throw Error('页面或反馈已变化，请刷新状态后重试');const data=await r.json();if(device===target)apply(data)}
  catch(e){note.textContent=e.message;confirming=false;button.disabled=false;return}
  confirming=false;paint();refresh();
 };
 const previous=draw;draw=function(){previous();paint();refresh()};
 document.querySelector('#image').addEventListener('load',paint);
 document.addEventListener('rig:review-saved',refresh);
 refresh();setInterval(refresh,3000);
})();
