"""Programmatic authoring starters; custom generators live in design projects."""
import json,math
from pathlib import Path
from .lottie_core import animation,shape_layer,fixed,animated,transform,write
from .lottie_inspector import inspect

def inspect_animation(data):
    if not isinstance(data,dict):raise ValueError('Expected a Lottie JSON object')
    result=inspect(data)
    def walk(v):
        if isinstance(v,dict):
            if isinstance(v.get('x'),str):result['errors'].append('Expressions are not supported in this local studio')
            for k,value in v.items():
                if k in ['p','u','fPath'] and isinstance(value,str) and value.startswith(('http:','https:','//')):result['errors'].append('Remote animation assets are not loaded by this studio')
                walk(value)
        elif isinstance(v,list):
            for child in v:walk(child)
    walk(data);return result

def build_animation(name='Motion study',motion='bounce',color='#1478ff',duration=2,width=480,height=360,fps=60):
    if motion not in ['bounce','pulse','draw']:raise ValueError('Unknown starter motion')
    if not isinstance(color,str) or not __import__('re').fullmatch('#[0-9a-fA-F]{6}',color):raise ValueError('Invalid color')
    for n,lo,hi in [(duration,.2,20),(width,64,4096),(height,64,4096),(fps,12,120)]:
        if isinstance(n,bool) or not isinstance(n,(int,float)) or not math.isfinite(n) or not lo<=n<=hi:raise ValueError('Invalid composition dimensions or timing')
    end=round(duration*fps);rgb=[int(color[i:i+2],16)/255 for i in [1,3,5]]
    ellipse={'ty':'el','p':fixed([0,0]),'s':fixed([64,64]),'nm':'Circle'}
    fill={'ty':'fl','c':fixed(rgb+[1]),'o':fixed(100),'r':1}
    group={'ty':'gr','nm':'Shape','it':[ellipse,fill,{'ty':'tr',**transform()}]}
    layer=shape_layer(name,1,[group],end)
    layer['ks']['p']=fixed([width/2,height/2,0])
    if motion=='bounce':
        samples=[]
        for i in range(end+1):
            t=i/end;y=-height*.28*math.exp(-6*t)*math.cos(12*t)
            samples.append((i,[width/2,height/2+y,0]))
        samples[-1]=(end,[width/2,height/2,0]);layer['ks']['p']=animated(samples)
    elif motion=='pulse':
        layer['ks']['s']=animated([(0,[100,100,100]),(end/2,[145,145,100]),(end,[100,100,100])])
    else:
        group['it']=[{'ty':'sh','ks':fixed({'v':[[-70,0],[-15,48],[80,-65]],'i':[[0,0]]*3,'o':[[0,0]]*3,'c':False})},
                     {'ty':'st','c':fixed(rgb+[1]),'o':fixed(100),'w':fixed(12),'lc':2,'lj':2},
                     {'ty':'tm','s':fixed(0),'e':animated([(0,0),(end*.7,100),(end,100)]),'o':fixed(0),'m':1},
                     {'ty':'tr',**transform()}]
    return animation(str(name)[:100],width,height,fps,duration,[layer])

def generator_source(parameters):
    return 'from tailorbird_rig.lottie_tools import build_animation\nfrom tailorbird_rig.lottie_core import write\nfrom pathlib import Path\nparameters = '+repr(parameters)+'\nwrite(build_animation(**parameters), Path(__file__).with_name("animation.json"))\n'

def create_bundle(directory,parameters):
    root=Path(directory)
    if root.exists():raise ValueError('Choose a new animation directory')
    data=build_animation(**parameters);report=inspect_animation(data)
    if report['errors']:raise ValueError(str(report['errors']))
    root.mkdir(parents=True);write(data,root/'animation.json')
    (root/'generator.py').write_text(generator_source(parameters))
    (root/'parameters.json').write_text(json.dumps(parameters,ensure_ascii=False,indent=2))
    (root/'inspection.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    return report
