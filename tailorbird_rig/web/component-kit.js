/* One renderer for previews and project HTML designs. No project-specific styles here. */
(()=>{
 const contentProps=new Set(['label','text','title','value','placeholder','items','selected','message']);
 const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n};
 function render(system,id,options={},trail=[]){
  if(trail.includes(id)||trail.length>12)throw Error('Recursive component');
  const c=system.components.find(c=>c.id===id);if(!c)throw Error('Unregistered component '+id);
  const variant=options.variant?c.variants?.find(v=>v.id===options.variant):null;
  if(options.variant&&!variant)throw Error('Unregistered variant '+options.variant);
  for(const key of Object.keys(options))if(key!=='variant'&&!contentProps.has(key))throw Error('Use registered variants for style/state changes: '+key);
  const p={...c.props,...variant?.props,...options},tokens={...system.tokens,...c.tokens,...variant?.tokens};
  const wrap=node('div');wrap.className='rig-element';wrap.dataset.component=id;wrap.dataset.variant=options.variant||'default';wrap.dataset.elementVersion=system.version;
  for(const [key,value]of Object.entries(tokens))wrap.style.setProperty('--rig-'+key,typeof value==='number'?value+'px':value);
  const disabled=['disabled','loading'].includes(p.state);let control;
  if(c.kind==='back'||c.kind==='button'){
   control=node('button');control.type='button';control.disabled=disabled;control.className='rig-control rig-'+(c.kind==='back'?'back':p.tone==='secondary'?'secondary':'primary');
   if(c.kind==='back'){const icon=node('span','‹');icon.className='rig-back-icon';icon.setAttribute('aria-hidden','true');control.append(icon);control.setAttribute('aria-label',p.label||'返回')}
   else{if(p.state==='loading'){const spinner=node('span');spinner.className='rig-spinner';spinner.setAttribute('aria-hidden','true');control.append(spinner);control.setAttribute('aria-busy','true')}control.append(node('span',p.label||'确认'))}
  }else if(c.kind==='input'){
   control=node('label');control.className='rig-field';control.append(node('span',p.label||'输入'));
   const input=node('input');input.className='rig-control';input.placeholder=p.placeholder||'';input.value=p.value||'';input.disabled=disabled;if(p.state==='error')input.setAttribute('aria-invalid','true');if(p.state==='focus')input.classList.add('rig-focus');control.append(input);
   if(p.message){const hint=node('small',p.message);hint.className=p.state==='error'?'rig-error':'';control.append(hint)}
  }else if(c.kind==='checkbox'){
   control=node('label');control.className='rig-check';const input=node('input');input.type='checkbox';input.checked=p.state==='checked';input.disabled=disabled;control.append(input,node('span',p.label||'勾选'));
  }else if(c.kind==='card'){
   control=node('section');control.className='rig-card';control.append(node('strong',p.title||'标题'),node('p',p.text||''));
  }else if(c.kind==='segmented'){
   control=node('div');control.className='rig-segments';control.setAttribute('role','group');control.setAttribute('aria-label',c.label);
   for(const [i,text]of(p.items||[]).entries()){const b=node('button',text);b.type='button';b.setAttribute('aria-pressed',String(i===(p.selected||0)));b.onclick=()=>{for(const item of control.children)item.setAttribute('aria-pressed',String(item===b))};control.append(b)}
  }else if(c.kind==='notice'){
   control=node('div',p.text||'提示');control.className='rig-notice';control.setAttribute('role','status');
  }else if(c.kind==='stack'){
   control=node('div');control.className='rig-stack';control.dataset.direction=p.direction||'vertical';
   for(const child of c.children||[])control.append(render(system,child,{},[...trail,id]));
  }else throw Error('Unknown component kind');
  wrap.append(control);return wrap;
 }
 window.RigComponents={render};
})();
