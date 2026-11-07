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
 const response=await fetch('/api/project?'+new URLSearchParams({revision}));
 if(!response.ok)throw Error('找不到指定设计版本。');
 const project=await response.json(),manifest=project.manifest;
 if(!manifest.states.includes(page))throw Error('该版本没有这张设计稿。');
 const title=manifest.labels?.[page]||page;
 const root='/revisions/'+encodeURIComponent(project.revision)+'/';
 document.title=title+' · 产品与测试文档 | Tailorbird Rig';
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
 }
 device.onchange=showDevice;showDevice();
 $('nav').hidden=false;
 $('.doc-layout').hidden=false;
 const docResponse=await fetch(root+'page-docs.json');
 if(!docResponse.ok&&docResponse.status!==404)throw Error('暂时无法读取文档，请刷新后重试。');
 const data=docResponse.ok?await docResponse.json():null;
 const entry=Object.hasOwn(data?.pages||{},page)?data.pages[page]:null;
 const product=$('#product > div'),test=$('#test > div');
 if(!entry){
  product.textContent='此版本尚未关联产品文档。';
  test.textContent='此版本尚未关联测试文档。';
 }else{
  if(typeof data.status==='string')$('#doc-meta').textContent+=' · '+data.status;
  list(product,entry.product);
  for(const section of entry.sections||[]){
   heading(product,'h3',section.title);list(product,section.items);
  }
  if(!entry.product?.length&&!entry.sections?.length)product.textContent='此版本尚未关联产品文档。';
  list(test,entry.test,'ol');
  for(const testCase of entry.cases||[]){
   const block=document.createElement('article');block.className='doc-case';test.append(block);
   heading(block,'h3',testCase.title);
   for(const [key,label] of Object.entries({setup:'前置条件',steps:'操作步骤',expected:'预期结果'})){
    if(!testCase[key]?.length)continue;
    heading(block,'h4',label);list(block,testCase[key],key==='steps'?'ol':'ul');
   }
  }
  if(!entry.test?.length&&!entry.cases?.length)test.textContent='此版本尚未关联测试文档。';
 }
 const section=location.hash==='#test'?'#test':'#product';
 $(section).scrollIntoView();
})().catch(error=>{
 if(document.querySelector('.doc-layout').hidden)document.querySelector('#doc-title').textContent='无法打开文档';
 document.querySelector('#doc-meta').textContent=error.message;
});
