"""Loopback-only HTTP host for one configured design workspace."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, unquote, parse_qs
from pathlib import Path
import json, hashlib, io, mimetypes, fcntl
from PIL import Image, UnidentifiedImageError
from .config import Project, confined, identifier
from .store import ReviewStore, read
from .codex_work import CodexWork, WorkError
WEB = Path(__file__).parent/'web'

class Handler(BaseHTTPRequestHandler):
    def respond(self, status, body, mime='application/json; charset=utf-8'):
        if not isinstance(body,bytes): body=json.dumps(body,ensure_ascii=False).encode()
        self.send_response(status); self.send_header('Content-Type',mime)
        self.send_header('Cache-Control','no-store'); self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)

    def file(self, path):
        if not path.is_file(): self.respond(404,{'error':'Not found'}); return
        self.respond(200,path.read_bytes(),mimetypes.guess_type(path.name)[0] or 'application/octet-stream')

    @property
    def revision(self):
        value=parse_qs(urlsplit(self.path).query).get('revision',[None])[0]
        if value: self.server.store.project.revision(value)
        return value

    def trusted(self):
        port=self.server.server_port
        hosts={f'127.0.0.1:{port}',f'localhost:{port}'}
        return self.headers.get('Host') in hosts and self.headers.get('Origin') in {None,*('http://'+h for h in hosts)}

    def do_GET(self):
        if not self.trusted(): self.respond(403,{'error':'Local requests only'}); return
        try:
            path=unquote(urlsplit(self.path).path); store=self.server.store; project=store.project
            if path=='/healthz': self.respond(200,{'ok':True,'project':project.id,'workspace':project.public()['storageKey']}); return
            if path=='/api/handoff':
                from .workflow import handoff
                data=handoff(self.server.config)
                if parse_qs(urlsplit(self.path).query).get('format')==['markdown']:self.respond(200,data['markdown'].encode(),'text/markdown; charset=utf-8')
                else:self.respond(200,data)
                return
            if path=='/api/project': self.respond(200,project.public(self.revision)); return
            if path=='/api/codex-work':
                self.respond(200,self.server.codex_work.status(project));return
            if path=='/api/components':
                from .components import load
                self.respond(200,load(project,self.revision));return
            if path=='/api/review': self.respond(200,store.snapshot(self.revision)); return
            if path=='/api/page-checks':
                from .page_checks import snapshot
                query=parse_qs(urlsplit(self.path).query)
                self.respond(200,snapshot(store,self.revision or project.current,query['device'][0],query.get('page',[None])[0]));return
            if path=='/issues.json':
                with store.lock: store.recover(); self.respond(200,read(store.root/'issues.json',{}))
                return
            if path=='/lottie.html':self.file(WEB/'lottie.html');return
            if path=='/components.html':self.file(WEB/'components.html');return
            if path in ['/','/index.html','/issues.html']: self.file(WEB/('issues.html' if path=='/issues.html' else 'index.html')); return
            if path.startswith('/assets/'):
                target=confined(WEB,path[8:])
                if target.is_file():
                    from .guard import verify_resource
                    verify_resource(target)
                self.file(target);return
            if path.startswith('/review-images/'): self.file(confined(store.root/'images',path[15:])); return
            if path=='/design/index.html':
                self.send_response(302);self.send_header('Location','/');self.end_headers();return
            if path.startswith('/screens/'):
                root,_=project.revision();self.file(confined(root,path[1:]));return
            if path.startswith('/design/'):
                root,_=project.revision(self.revision); self.file(confined(root,path[8:])); return
            if path.startswith('/revisions/'):
                rev,rel=path[11:].split('/',1);root,_=project.revision(rev)
                if rel=='index.html':
                    from urllib.parse import quote
                    self.send_response(302);self.send_header('Location','/?revision='+quote(rev));self.end_headers();return
                self.file(confined(root,rel));return
            if path.startswith('/mount/'):
                name,rel=path[7:].split('/',1);root=project.raw.get('mounts',{})[name]
                self.file(confined(project.base/root,rel));return
            name,_,relative=path.lstrip('/').partition('/')
            if name in project.raw.get('mounts',{}):self.file(confined(project.base/project.raw['mounts'][name],relative));return
            self.respond(404,{'error':'Not found'})
        except WorkError as exc:self.respond(400,{'error':str(exc)})
        except (ValueError,KeyError,TypeError,FileNotFoundError): self.respond(404,{'error':'Unknown project resource'})
        except Exception: self.respond(500,{'error':'Unable to read workspace'})

    def do_POST(self):
        if not self.trusted():self.respond(403,{'error':'Local requests only'});return
        try:
            path=urlsplit(self.path).path; size=int(self.headers.get('Content-Length','0')); store=self.server.store
            if path=='/api/codex-work':
                if self.headers.get('Origin')!='http://'+self.headers['Host']:
                    self.respond(403,{'error':'请在当前评审页点击「开始任务」。'});return
                if self.headers.get('Content-Type','').split(';')[0]!='application/json' or not 0<size<=1024:
                    raise WorkError('请求格式无效。')
                payload=json.loads(self.rfile.read(size))
                self.respond(202,self.server.codex_work.start(store.project,payload.get('revision')));return
            if path=='/api/page-checks/confirm':
                if self.headers.get('Content-Type','').split(';')[0]!='application/json' or not 0<size<=16000:raise ValueError('Expected bounded JSON')
                from .page_checks import confirm
                self.respond(200,confirm(store,json.loads(self.rfile.read(size))));return
            if path in ['/api/lottie/inspect','/api/lottie/generate']:
                if self.headers.get('Content-Type','').split(';')[0]!='application/json' or not 0<size<=8000000:raise ValueError('Expected bounded JSON input')
                from .lottie_tools import inspect_animation,build_animation
                value=json.loads(self.rfile.read(size))
                if path.endswith('/inspect'):self.respond(200,inspect_animation(value))
                else:
                    animation=build_animation(**value);self.respond(200,{'animation':animation,'inspection':inspect_animation(animation)})
                return
            if path=='/api/images':
                if not 0<size<=8*1024*1024:raise ValueError('单张图片不能超过8 MB')
                raw=self.rfile.read(size)
                with Image.open(io.BytesIO(raw)) as img:
                    if img.format not in ['PNG','JPEG','WEBP'] or img.width*img.height>40000000:raise ValueError('支持PNG、JPG、WebP，最多4000万像素')
                    ext={'PNG':'png','JPEG':'jpg','WEBP':'webp'}[img.format];img.verify()
                ident=hashlib.sha256(raw).hexdigest()+'.'+ext
                with store.lock:
                    (store.root/'images').mkdir(exist_ok=True);target=store.root/'images'/ident
                    if not target.exists():target.write_bytes(raw)
                self.respond(200,{'id':ident,'url':'/review-images/'+ident});return
            if path!='/api/annotations':self.respond(404,{'error':'Not found'});return
            if self.headers.get('Content-Type','').split(';')[0]!='application/json':self.respond(415,{'error':'Expected application/json'});return
            if not 0<size<=4000000:raise ValueError('Invalid request size')
            revision=self.revision;payload=store.apply(json.loads(self.rfile.read(size)))
            payload['currentRevision']=revision or store.project.current
            self.respond(200,payload)
        except WorkError as exc:self.respond(400,{'error':str(exc)})
        except (ValueError,KeyError,TypeError,AttributeError,FileNotFoundError,UnidentifiedImageError,Image.DecompressionBombError):self.respond(400,{'error':'批注内容、图片或设计版本无效，请刷新后重试'})
        except Exception:self.respond(500,{'error':'未保存，请重试'})

def make_server(config, port=18766):
    from .guard import verify
    verify()
    store=ReviewStore(config)
    lock=open(store.root/'server.lock','a+')
    try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError: lock.close();raise ValueError('This workspace already has a running server')
    try: server=ThreadingHTTPServer(('127.0.0.1',port),Handler)
    except Exception: lock.close();raise
    server.config=Path(config).resolve();server.store=store;server.workspace_lock=lock
    server.codex_work=CodexWork()
    return server
