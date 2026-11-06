import argparse, json, shutil, sys, hashlib
from pathlib import Path
from .config import Project
from .store import atomic, read

def import_review(source, workspace, output):
    source=Path(source).resolve();workspace=Path(workspace).resolve();output=Path(output).resolve()
    if output.exists():raise ValueError('Output must be a new directory')
    paths=[source/'issues.json',source/'annotations.json']
    before=[p.read_bytes() for p in paths]
    if (source/'review-pending.json').exists():raise ValueError('Legacy store is mid-write; retry after saving')
    issues,annotations=[json.loads(b) for b in before]
    if before!=[p.read_bytes() for p in paths]:raise ValueError('Legacy store changed; retry import')
    current=(workspace/issues['current_revision']).resolve()
    revisions=[{'id':current.name,'root':str(current)}]
    for ident in sorted({m['revision'] for m in annotations['marks']}):
        root=current.parent/ident
        if ident!=current.name and (root/'coverage.json').is_file():revisions.append({'id':ident,'root':str(root)})
    manifest=read(current/'coverage.json',{})
    prefix=next((x['id'].rsplit('-',1)[0] for x in issues['issues'] if x.get('id')),'RIG')
    config={'schema_version':1,'id':output.name,'title':output.name,'description':'Imported review workspace',
            'current_revision':current.name,'data_dir':'.rig','issue_prefix':prefix,'revisions':revisions,
            'groups':manifest.get('groups',[]),'links':[]}
    output.mkdir(parents=True);data=output/'.rig';data.mkdir()
    atomic(output/'rig.json',config);(data/'issues.json').write_bytes(before[0]);(data/'annotations.json').write_bytes(before[1])
    if (source/'images').exists():shutil.copytree(source/'images',data/'images')
    atomic(output/'import-provenance.json',{'source':str(source),'mode':'copy feedback; reference designs read-only','sha256':{p.name:hashlib.sha256(b).hexdigest() for p,b in zip(paths,before)},'marks':len(annotations['marks']),'issues':len(issues['issues'])})
    return output/'rig.json'

def main():
    parser=argparse.ArgumentParser(prog='tailorbird-rig');sub=parser.add_subparsers(dest='command',required=True)
    init=sub.add_parser('init');init.add_argument('directory')
    serve=sub.add_parser('serve');serve.add_argument('project');serve.add_argument('--port',type=int,default=18766)
    start=sub.add_parser('start');start.add_argument('project');start.add_argument('--port',type=int,default=18766)
    check=sub.add_parser('check');check.add_argument('project')
    imp=sub.add_parser('import-review');imp.add_argument('--store',required=True);imp.add_argument('--workspace',required=True);imp.add_argument('--output',required=True)
    feed=sub.add_parser('feedback');feed.add_argument('project');feed.add_argument('--format',choices=['json','markdown'],default='markdown')
    rev=sub.add_parser('publish');rev.add_argument('project');rev.add_argument('--revision',required=True);rev.add_argument('--root',required=True)
    issue=sub.add_parser('resolve');issue.add_argument('project');issue.add_argument('number',type=int);issue.add_argument('--resolution',required=True);issue.add_argument('--evidence',required=True);issue.add_argument('--status',default='已完成（设计）')
    guard=sub.add_parser('framework');guard.add_argument('action',choices=['verify','seal']);guard.add_argument('--maintenance',action='store_true');guard.add_argument('--reason',default='')
    lottie=sub.add_parser('lottie');ls=lottie.add_subparsers(dest='action',required=True)
    create=ls.add_parser('create');create.add_argument('directory');create.add_argument('--motion',choices=['bounce','pulse','draw'],default='bounce');create.add_argument('--color',default='#1478ff');create.add_argument('--duration',type=float,default=2);create.add_argument('--name',default='Motion study')
    inspect=ls.add_parser('inspect');inspect.add_argument('animation')
    args=parser.parse_args()
    try:
        if args.command!='framework':
            from .guard import verify
            verify()
        if args.command=='framework':
            from .guard import verify,seal
            if args.action=='seal':
                if not args.maintenance:raise ValueError('Explicit --maintenance mode is required')
                seal(args.reason);print('Framework maintenance baseline sealed')
            else:print(json.dumps(verify()))
        elif args.command=='lottie':
            from .lottie_tools import create_bundle,inspect_animation
            if args.action=='create':result=create_bundle(args.directory,{'name':args.name,'motion':args.motion,'color':args.color,'duration':args.duration,'width':480,'height':360,'fps':60})
            else:result=inspect_animation(json.loads(Path(args.animation).read_text()))
            print(json.dumps(result,ensure_ascii=False,indent=2))
            if result['errors']:return 1
        elif args.command=='init':
            target=Path(args.directory)
            if target.exists():raise ValueError('Choose a new directory')
            shutil.copytree(Path(__file__).parent/'starter',target);print(target.resolve()/'rig.json')
        elif args.command=='import-review':print(import_review(args.store,args.workspace,args.output))
        elif args.command=='start':
            from .launcher import start
            print(start(args.project,args.port))
        elif args.command=='check':
            p=Project(args.project);count=0
            for revision in p.revisions:count+=p.validate_assets(revision)
            print(json.dumps({'project':p.id,'revisions':len(p.revisions),'images':count,'ok':True}))
        elif args.command=='feedback':
            from .workflow import handoff
            result=handoff(args.project);print(json.dumps(result,ensure_ascii=False,indent=2) if args.format=='json' else result['markdown'])
        elif args.command=='publish':
            from .workflow import activate
            activate(args.project,args.revision,args.root);print('Published '+args.revision+'; refresh the existing browser tab')
        elif args.command=='resolve':
            from .workflow import update_issue
            update_issue(args.project,args.number,args.status,args.resolution,args.evidence);print('Updated issue '+str(args.number))
        else:
            from .server import make_server
            server=make_server(args.project,args.port);print(f'Tailorbird Rig: http://127.0.0.1:{server.server_port}',flush=True)
            try:server.serve_forever()
            except KeyboardInterrupt:pass
            finally:server.server_close();server.workspace_lock.close()
    except (ValueError,KeyError,OSError,StopIteration) as error:
        parser.exit(1,str(error)+'\n')
