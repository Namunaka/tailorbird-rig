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
 for(const link of RIG.links){if(!safeLink(link.url))continue;const a=document.createElement('a');a.href=link.url;a.textContent=link.label;$('#links').append(a)}
 $('#export').href='/api/review?revision='+encodeURIComponent(RIG.revision);
 const handoff=document.createElement('button');handoff.textContent='复制待处理问题给对话';handoff.id='handoff';handoff.onclick=async()=>{try{const r=await fetch('/api/handoff');if(!r.ok)throw Error('导出失败');const data=await r.json();await navigator.clipboard.writeText(data.markdown);handoff.textContent='已复制问题清单';setTimeout(()=>handoff.textContent='复制待处理问题给对话',2000)}catch(e){$('#error').textContent='无法复制；可用下方“下载问题交接”保存文件';}};$('.revision-row').append(handoff);
 const download=document.createElement('a');download.href='/api/handoff?format=markdown';download.download='tailorbird-feedback.md';download.textContent='下载问题交接';$('.revision-row').append(download);
 draw=function(){
  $('#states').replaceChildren();$('#devices').replaceChildren();
  const assigned=new Set(),groups=RIG.groups.map(g=>({...g,states:g.states.filter(s=>C.states.includes(s))}));
  for(const g of groups)for(const s of g.states)assigned.add(s);
  const remaining=C.states.filter(s=>!assigned.has(s));if(remaining.length)groups.push({label:'设计页面',states:remaining});
  for(const g of groups){if(!g.states.length)continue;const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=g.label;details.open=g.states.includes(state);details.append(summary);for(const s of g.states){const b=document.createElement('button');b.dataset.page=s;b.textContent=C.labels?.[s]||s;b.className=s===state?'active':'';b.onclick=()=>{if(window.rigCanRefresh&&!rigCanRefresh()){$('#error').textContent='请先保存当前评论再切换页面';return}state=s;draw()};details.append(b)}$('#states').append(details)}
  for(const d of C.devices){const b=document.createElement('button');b.textContent=d.name||d.id;b.className=d.id===device?'active':'';b.onclick=()=>{if(window.rigCanRefresh&&!rigCanRefresh()){$('#error').textContent='请先保存当前评论再切换机型';return}device=d.id;draw()};$('#devices').append(b)}
  $('#title').textContent=C.labels?.[state]||state;const d=C.devices.find(d=>d.id===device);$('#size').textContent=d.physicalW?`${d.physicalW} × ${d.physicalH} px · ${d.name} · ${RIG.revision}`:`${d.w} × ${d.h} 设计画幅 · ${d.name} · ${RIG.revision}`;
  const rel=(C.image_template||'screens/{device}/{state}.png').replace('{device}',device).replace('{state}',state);
  const url='/revisions/'+encodeURIComponent(RIG.revision)+'/'+rel.split('/').map(encodeURIComponent).join('/');$('#image').src=url;$('#image').alt=(C.labels?.[state]||state)+' · '+d.name;$('#raw').href=url;history.replaceState(null,'',location.pathname+location.search+'#'+state+'@'+device);
 };
 const elements=document.createElement('a');elements.href='/components.html'+(params.has('revision')?'?revision='+encodeURIComponent(RIG.revision):'');elements.textContent='公共元素集';elements.id='component-library-link';$('.revision-row').append(elements);
 draw();const script=document.createElement('script');script.src='/assets/review.js';script.onload=()=>{const checks=document.createElement('script');checks.src='/assets/page-checks.js';document.body.append(checks)};document.body.append(script);
 // Follow the latest revision in this tab; explicitly selected historical revisions remain pinned.
 setInterval(async()=>{if(params.has('revision'))return;try{const r=await fetch('/api/project',{cache:'no-store'});if(!r.ok)return;const next=await r.json();if(next.revision!==RIG.revision){if(window.rigCanRefresh&&!window.rigCanRefresh()){$('#error').textContent='新版本 '+next.revision+' 已就绪，请先保存当前评论；保存后本页会更新。';return}location.reload()}}catch{}},3000);
})().catch(e=>document.querySelector('#error').textContent=e.message);
