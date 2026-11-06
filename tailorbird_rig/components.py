"""Versioned, project-owned design tokens and reusable component definitions."""
import hashlib, json, re
from pathlib import Path
from .config import confined, identifier

KINDS={'back','button','input','checkbox','card','segmented','notice','stack'}
COLORS={'background','surface','text','muted','brand','onBrand','border','success','danger'}
NUMBERS={'radius':(0,64),'controlHeight':(28,100),'spacing':(0,64),'fontSize':(10,40),'borderWidth':(0,8)}

def validate(system):
    if system.get('schema_version')!=1:raise ValueError('Expected component schema_version 1')
    identifier(system['id']);identifier(system['version'])
    tokens=system['tokens']
    def token_values(values,required=False):
        if required and not COLORS|NUMBERS.keys()<=values.keys():raise ValueError('Missing design tokens')
        for key,value in values.items():
            if key in COLORS:
                if not isinstance(value,str) or not re.fullmatch(r'#[0-9a-fA-F]{6}',value):raise ValueError('Expected hex color token')
            elif key in NUMBERS:
                lo,hi=NUMBERS[key]
                if isinstance(value,bool) or not isinstance(value,(int,float)) or not lo<=value<=hi:raise ValueError('Invalid numeric token')
            else:raise ValueError('Unknown design token: '+key)
    token_values(tokens,True)
    components=system['components']
    if not isinstance(components,list) or not 1<=len(components)<=200:raise ValueError('Expected 1–200 components')
    ids=[identifier(c['id']) for c in components]
    if len(ids)!=len(set(ids)):raise ValueError('Duplicate component ID')
    for component in components:
        if component['kind'] not in KINDS:raise ValueError('Unknown component kind')
        if not isinstance(component.get('label'),str) or not 0<len(component['label'])<=160:raise ValueError('Expected component label')
        token_values(component.get('tokens',{}))
        variants=component.get('variants',[]);variant_ids=[identifier(v['id']) for v in variants]
        if len(variant_ids)!=len(set(variant_ids)):raise ValueError('Duplicate variant')
        for variant in variants:token_values(variant.get('tokens',{}))
        for props in [component.get('props',{}),*(v.get('props',{}) for v in variants)]:
            if not isinstance(props,dict):raise ValueError('Expected component props')
            for key,value in props.items():
                if key=='items':
                    if not isinstance(value,list) or not 1<=len(value)<=20 or any(not isinstance(i,str) or len(i)>1000 for i in value):raise ValueError('Expected item labels')
                elif key=='selected':
                    if isinstance(value,bool) or not isinstance(value,int) or not 0<=value<20:raise ValueError('Invalid selected item')
                elif key in {'label','text','title','value','placeholder','message','tone','direction','state'}:
                    if not isinstance(value,str) or len(value)>4000:raise ValueError('Invalid component text')
                else:raise ValueError('Unregistered prop: '+key)
            if props.get('state','default') not in {'default','disabled','loading','error','focus','checked'}:raise ValueError('Unknown component state')
        if not isinstance(component.get('children',[]),list):raise ValueError('Expected child component IDs')
        for child in component.get('children',[]):
            if child not in ids:raise ValueError('Unknown child component: '+child)
    lookup={c['id']:c for c in components}
    def visit(ident,trail):
        if ident in trail or len(trail)>12:raise ValueError('Recursive component composition')
        for child in lookup[ident].get('children',[]):visit(child,trail+[ident])
    for ident in ids:visit(ident,[])
    return system

def load(project,revision=None):
    revision=revision or project.current;root,manifest=project.revision(revision)
    relative=manifest.get('design_system','design-system.json');path=confined(root,relative)
    fallback=not path.exists()
    if fallback:path=Path(__file__).parent/'starter/designs/v1/design-system.json'
    system=validate(json.loads(path.read_text()))
    usage=manifest.get('component_usage',{})
    known={c['id']:c for c in system['components']}
    for page,refs in usage.items():
        if page not in manifest['states'] or not isinstance(refs,list):raise ValueError('Unknown component usage page')
        for ref in refs:
            if not isinstance(ref,str):raise ValueError('Expected component reference')
            ident,_,variant=ref.partition(':')
            if ident not in known:raise ValueError('Unregistered component: '+ident)
            if variant and variant not in [v['id'] for v in known[ident].get('variants',[])]:raise ValueError('Unregistered component variant: '+ref)
    if manifest.get('require_component_usage'):
        if fallback or any(not usage.get(p) for p in manifest['states']):raise ValueError('Every page must declare shared component usage')
    digest=hashlib.sha256(json.dumps(system,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    return {'revision':revision,'system':system,'sha256':digest,'example':fallback,'source':str(path),
            'usage':usage,'unmapped_pages':[p for p in manifest['states'] if not usage.get(p)]}
