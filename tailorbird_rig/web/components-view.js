(async()=>{
 const $=s=>document.querySelector(s),query=new URLSearchParams(location.search),suffix=query.has('revision')?'?revision='+encodeURIComponent(query.get('revision')):'';
 const responses=await Promise.all([fetch('/api/project'+suffix),fetch('/api/components'+suffix)]);if(responses.some(r=>!r.ok))throw Error('元素集无法读取，请检查项目规范');
 const [project,library]=await Promise.all(responses.map(r=>r.json())),system=library.system;
 $('#context').textContent=project.title+' · '+library.revision+' · '+system.title+' '+system.version+(library.example?' · 当前为通用示例，项目尚未定义专属元素集':' · 项目专属规范');
 $('#back').href='/'+suffix;
 for(const revision of project.revisions){const option=document.createElement('option');option.value=revision.id;option.textContent=revision.label;$('#version').append(option)}$('#version').value=library.revision;$('#version').onchange=()=>location.assign('/components.html?revision='+encodeURIComponent($('#version').value));
 for(const [name,value]of Object.entries(system.tokens)){const item=document.createElement('div');item.className='token';if(typeof value==='string'&&value.startsWith('#')){const swatch=document.createElement('span');swatch.className='swatch';swatch.style.background=value;item.append(swatch)}item.append(document.createTextNode(name+' · '+value));$('#tokens').append(item)}
 $('#coverage').textContent=library.unmapped_pages.length?'尚未声明组件引用的页面：'+library.unmapped_pages.join('、')+'。PNG 像素无法由引用校验自动证明一致，请同时做视觉检查。':'所有页面已声明组件引用；仍需验证实际页面构图。';
 function draw(){
  $('#components').replaceChildren();const keyword=$('#search').value.trim().toLowerCase();
  for(const c of system.components.filter(c=>(c.id+' '+c.label+' '+(c.description||'')).toLowerCase().includes(keyword))){
   const card=document.createElement('section');card.className='component-entry';card.dataset.id=c.id;
   const title=document.createElement('h3');title.textContent=c.label;const id=document.createElement('code');id.textContent=c.id;const desc=document.createElement('p');desc.textContent=c.description||'项目公共组件';card.append(title,id,desc);
   for(const variant of c.variants?.length?c.variants:[{id:null,label:'默认'}]){const label=document.createElement('div');label.className='variant-label';label.textContent=variant.label;const preview=document.createElement('div');preview.className='component-preview';preview.style.background=system.tokens.background;preview.append(RigComponents.render(system,c.id,variant.id?{variant:variant.id}:{}));card.append(label,preview)}
   const detail=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent='定义与复用引用';pre.textContent=JSON.stringify(c,null,2)+'\n\nRigComponents.render(system, '+JSON.stringify(c.id)+', {label: "业务文案"})';detail.append(summary,pre);card.append(detail);$('#components').append(card);
  }
 }
 $('#search').oninput=draw;draw();$('#download').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(system,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=system.id+'-'+system.version+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
})().catch(e=>document.querySelector('#error').textContent=e.message);
