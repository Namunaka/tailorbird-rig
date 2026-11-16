(async()=>{
 const $=selector=>document.querySelector(selector);
 const params=new URLSearchParams(location.search),revision=params.get('revision'),page=params.get('page');
 const list=(parent,items,tag='ul')=>{
  if(!Array.isArray(items)||!items.length)return;
  const element=document.createElement(tag);
  for(const text of items){const item=document.createElement('li');item.textContent=text;element.append(item)}
  parent.append(element);
 };
 const heading=(parent,tag,text)=>{
  const element=document.createElement(tag);element.textContent=text;parent.append(element);
 };
 const response=await fetch('/api/project'+(revision?'?'+new URLSearchParams({revision}):''));
 if(!response.ok)throw Error('找不到指定设计版本。');
 const project=await response.json(),manifest=project.manifest;
 if(!manifest.states.includes(page))throw Error('该版本没有这张设计稿。');
 const title=manifest.labels?.[page]||page;
 const root='/revisions/'+encodeURIComponent(project.revision)+'/';
 document.title=title+' · 技术文档 | Tailorbird Rig';
 $('#doc-title').textContent=title;
 $('#doc-meta').textContent=project.revision;
 const device=$('#doc-device');
 for(const item of manifest.devices)device.add(new Option(item.name||item.id,item.id));
 if(manifest.devices.some(item=>item.id===params.get('device')))device.value=params.get('device');
 function showDevice(){
  const image=(manifest.image_template||'screens/{device}/{state}.png')
   .replace('{device}',device.value).replace('{state}',page);
  $('#doc-image').src=root+image.split('/').map(encodeURIComponent).join('/');
  $('#doc-image').alt=title+' · '+device.selectedOptions[0].textContent;
  $('#doc-review').href='/index.html?revision='+encodeURIComponent(project.revision)+'#'+page+'@'+device.value;
  $('#doc-handoff').href='/api/handoff?'+new URLSearchParams({revision:project.revision,page,device:device.value,format:'markdown'});
 }
 device.onchange=showDevice;showDevice();
 $('nav').hidden=false;
 $('.doc-layout').hidden=false;
 const docResponse=await fetch(root+'page-docs.json');
 if(!docResponse.ok&&docResponse.status!==404)throw Error('暂时无法读取文档，请刷新后重试。');
 const data=docResponse.ok?await docResponse.json():null;
 const entry=Object.hasOwn(data?.pages||{},page)?data.pages[page]:null;
 const technical=$('#technical > div'),product=$('#product > div'),test=$('#test > div');
 function showCase(parent,testCase){
   const block=document.createElement('article');block.className='doc-case';
   parent.append(block);
   heading(block,'h4',[testCase.id,testCase.title].filter(Boolean).join(' · '));
   for(const [key,label] of Object.entries({setup:'前置条件',steps:'操作步骤',expected:'预期结果'})){
    if(!testCase[key]?.length)continue;
    heading(block,'h5',label);list(block,testCase[key],key==='steps'?'ol':'ul');
   }
 }
 const spec=entry?.technical;
 if(spec?.requirements?.length&&Array.isArray(spec.cases)){
  const sequence=document.createElement('p');
  sequence.textContent='按功能逐项开发。先编写并运行对应测试，确认预期失败，再实现、重构和回归。';
  technical.append(sequence);
  for(const ref of spec.references||[]){
   const path=ref.path.split('/');
   if(path.some(part=>!part||part==='.'||part==='..'||part.includes('\\')))continue;
   const link=document.createElement('a');
   link.textContent=ref.label;link.href=root+path.map(encodeURIComponent).join('/');
   const line=document.createElement('p');line.append(link);technical.append(line);
  }
  for(const item of spec.requirements){
   const block=document.createElement('section');
   block.className='doc-requirement';
   technical.append(block);
   heading(block,'h3',item.id+' · '+item.title);
   heading(block,'h4','功能行为');list(block,item.behavior);
   heading(block,'h4','实现约束');list(block,item.implementation);
   for(const testCase of spec.cases.filter(test=>test.requirement===item.id))showCase(block,testCase);
  }
 }else{
  technical.textContent=entry?'此版本有既有功能与测试资料，待登记按功能编号的开发规格和对应测试。':'此版本尚未登记该页面的技术文档。';
 }
 if(typeof data?.status==='string')$('#doc-meta').textContent+=' · '+data.status;
 if(entry?.product?.length||entry?.sections?.length){
  $('#product').hidden=false;
  list(product,entry.product);
  for(const section of entry.sections||[]){
   heading(product,'h3',section.title);list(product,section.items);
  }
 }
 if(entry?.test?.length||entry?.cases?.length){
  $('#test').hidden=false;
  list(test,entry.test,'ol');
  for(const testCase of entry.cases||[])showCase(test,testCase);
 }
 const section=['#product','#test'].includes(location.hash)&&!$(location.hash).hidden?$(location.hash):null;
 section?.scrollIntoView();
})().catch(error=>{
 if(document.querySelector('.doc-layout').hidden)document.querySelector('#doc-title').textContent='无法打开文档';
 document.querySelector('#doc-meta').textContent=error.message;
});
