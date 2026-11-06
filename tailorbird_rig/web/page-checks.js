(()=>{
 const panel=document.querySelector('#review-panel'),area=document.createElement('section');area.id='page-check-controls';
 area.innerHTML='<h3>界面检查</h3><p id="page-check-state" role="status">正在读取检查状态…</p><button id="page-check-confirm" disabled>检查确认</button><p>黄色：修改后待复查 · 绿色：已确认。状态按当前机型保存，稿件变化后重新检查。</p>';
 panel.insertBefore(area,document.querySelector('#review-tools'));
 let pages={},loadedDevice='',loading=false,confirming=false;
 const button=document.querySelector('#page-check-confirm'),note=document.querySelector('#page-check-state');
 function paint(){
  const current=loadedDevice===device?pages[state]:null;
  for(const b of document.querySelectorAll('#states button')){
   const check=loadedDevice===device?pages[b.dataset.page]:null;
   b.dataset.check=check?.status||'default';
   b.title=check?.status==='confirmed'?'已检查确认':check?.status==='needs_check'?'修改后待复查':'尚未确认';
  }
  note.textContent=current?.status==='confirmed'?'当前界面已检查确认':current?.status==='needs_check'?'批注已处理，请回来复查':'当前界面尚未确认';
  button.textContent=current?.status==='confirmed'?'已检查确认':'检查确认';
  button.disabled=confirming||!current||!document.querySelector('#image').complete||!document.querySelector('#image').naturalWidth;
 }
 async function refresh(){
  if(loading)return;loading=true;const requested=device;
  try{const r=await fetch('/api/page-checks?revision='+encodeURIComponent(RIG.revision)+'&device='+encodeURIComponent(requested),{cache:'no-store'});if(!r.ok)throw Error();const data=await r.json();if(device===requested){pages=data.pages;loadedDevice=requested;paint()}}
  catch{note.textContent='检查状态暂时无法读取，请稍后重试';button.disabled=true}finally{loading=false}
 }
 button.onclick=async()=>{
  if(window.rigCanRefresh&&!rigCanRefresh()){note.textContent='请先保存评论或完成当前操作，再检查确认';return}
  const page=state,target=device,check=loadedDevice===device?pages[page]:null;if(!check)return;
  confirming=true;paint();
  try{const r=await fetch('/api/page-checks/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:RIG.revision,page,device:target,content_sha256:check.content_sha256,feedback_sha256:check.feedback_sha256})});if(!r.ok)throw Error('页面或反馈已变化，请重新检查后确认');const data=await r.json();if(device===target){pages=data.pages;loadedDevice=target}}
  catch(e){note.textContent=e.message;confirming=false;button.disabled=false;return}
  confirming=false;paint();
 };
 const previous=draw;draw=function(){previous();paint();refresh()};
 document.querySelector('#image').addEventListener('load',paint);
 refresh();setInterval(refresh,3000);
})();
