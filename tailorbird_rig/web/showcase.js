(async () => {
 const select = id => document.getElementById(id);
 const labels = {effects: '特效库', components: '能力组件库'};
 const parameters = new URLSearchParams(location.search);
 const kind = parameters.get('kind') === 'components' ? 'components' : 'effects';
 const revision = parameters.get('revision');
 const revisionQuery = revision ? '&revision='+encodeURIComponent(revision) : '';
 if (revision) select('review-back').href='/?revision='+encodeURIComponent(revision);
 for (const tab of document.querySelectorAll('[data-kind]')) {
  tab.href='?kind='+tab.dataset.kind+revisionQuery;
  if (tab.dataset.kind===kind) tab.setAttribute('aria-current','page');
 }
 select('title').textContent=labels[kind];
 document.title=labels[kind]+' · Tailorbird Rig';
 select('description').textContent=kind==='effects'
  ? '直接播放或操作项目特效，查看动作、适用场景与参考证据。'
  : '试用完整的业务交互组件。复用时按名称和组件 ID 查找。';
 const root='/mount/library/';
 function asset(path) {
  if (typeof path!=='string'||path.includes('\\')) return null;
  const parts=path.split('/');
  if (parts.some(part=>!part||part==='.'||part==='..')) return null;
  return root+parts.map(encodeURIComponent).join('/');
 }
 try {
  const response=await fetch(root+'catalog.json');
  const catalog=response.status===404 ? {} : response.ok ? await response.json() : null;
  if (!catalog) throw Error('读取失败');
  const entries=(catalog[kind]||[]).filter(item=>/^[a-z0-9-]+$/.test(item.id)&&item.name&&asset(item.demo));
  if (!entries.length) {
   select('status').textContent='当前项目还没有登记演示。';
   return;
  }
  const list=select('entries'), demo=select('demo');
  for (const item of entries) {
   const link=document.createElement('a');
   link.textContent=item.name;
   link.href='#'+item.id;
   list.append(link);
  }
  function render() {
   const item=entries.find(item=>'#'+item.id===location.hash)||entries[0];
   for (const link of list.children) {
    link.removeAttribute('aria-current');
    if (link.hash==='#'+item.id) link.setAttribute('aria-current','true');
   }
   select('entry').hidden=false;
   select('status').hidden=true;
   select('entry-title').textContent=item.name;
   select('entry-id').textContent=item.id;
   select('entry-description').textContent=item.description||'';
   demo.src=asset(item.demo);
   demo.title=item.name+'交互演示';
   select('restart').onclick=()=>{demo.src=asset(item.demo)};
   const details=select('entry-details');
   details.replaceChildren();
   for (const text of item.notes||[]) {
    const line=document.createElement('p');line.textContent=text;details.append(line);
   }
   const resources=select('resources');
   resources.replaceChildren();
   for (const resource of item.resources||[]) {
    const url=asset(resource.path);
    if (!url) continue;
    const link=document.createElement('a');
    link.href=url;link.textContent=resource.label+' ↗';link.target='_blank';link.rel='noopener';
    resources.append(link);
   }
  }
  window.addEventListener('hashchange',render);
  render();
 } catch {
  select('status').textContent='暂时无法读取项目演示。';
 }
})();
