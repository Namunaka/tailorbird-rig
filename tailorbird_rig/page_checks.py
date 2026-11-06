"""Human page acceptance, tied to content and feedback rather than release names."""
import hashlib, json
from datetime import datetime, timezone
from functools import lru_cache
from .store import atomic, read

@lru_cache(maxsize=4096)
def _digest(path, modified, size):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def image_digest(project, revision, page, device):
    path=project.image(revision,page,device); stat=path.stat()
    return _digest(path,stat.st_mtime_ns,stat.st_size)

def content_digest(project, revision, page, device):
    root,manifest=project.revision(revision)
    from .config import confined
    parts=[image_digest(project,revision,page,device)]
    for animation in manifest.get('animations',[]):
        if animation.get('pages') and page not in animation['pages']:continue
        path=confined(root,animation['path']);stat=path.stat()
        parts.append(_digest(path,stat.st_mtime_ns,stat.st_size))
    return hashlib.sha256(json.dumps(parts).encode()).hexdigest()

def feedback_digest(issues):
    fields=('number','user_quote','attachments','status','work','resolved_content_sha256')
    return hashlib.sha256(json.dumps([{k:i.get(k) for k in fields} for i in sorted(issues,key=lambda i:i['number'])],sort_keys=True,ensure_ascii=False).encode()).hexdigest()

def _context(store,revision,page,device):
    project=store.project; content=content_digest(project,revision,page,device)
    issues=[i for i in read(store.root/'issues.json',{})['issues'] if i.get('page')==page and i.get('device')==device and not i.get('status','').startswith('已撤回')]
    return project,content,issues,feedback_digest(issues)

def _status(store,revision,page,device,records):
    project,content,issues,feedback=_context(store,revision,page,device)
    revisions=list(project.revisions);index=revisions.index(revision)
    for record in reversed(records):
        if record['page']!=page or record['device']!=device or record['revision'] not in revisions:continue
        start=revisions.index(record['revision'])
        if start>index or record['content_sha256']!=content or record['feedback_sha256']!=feedback:continue
        # A content change invalidates acceptance even if a later draft reuses old pixels.
        try: unchanged=all(content_digest(project,r,page,device)==content for r in revisions[start:index+1])
        except (ValueError,KeyError,FileNotFoundError): unchanged=False
        if unchanged:
            return {'status':'confirmed','content_sha256':content,'feedback_sha256':feedback,'confirmed_at':record['at']}
    ready=bool(issues) and all(project.is_closed(i.get('status','')) for i in issues) and any(i.get('resolved_content_sha256')==content for i in issues)
    return {'status':'needs_check' if ready else 'default','content_sha256':content,'feedback_sha256':feedback}

def snapshot(store,revision,device):
    with store.lock:
        store.recover();project=store.project;_,manifest=project.revision(revision)
        if device not in [d['id'] for d in manifest['devices']]:raise ValueError('Unknown device')
        records=read(store.root/'page-checks.json',{'records':[]})['records']
        return {'revision':revision,'device':device,'pages':{p:_status(store,revision,p,device,records) for p in manifest['states']}}

def confirm(store,event):
    with store.lock:
        store.recover();revision=event['revision'];page=event['page'];device=event['device']
        project,content,issues,feedback=_context(store,revision,page,device)
        if event.get('content_sha256')!=content or event.get('feedback_sha256')!=feedback:raise ValueError('Page or feedback changed; review again')
        data=read(store.root/'page-checks.json',{'schema':1,'records':[]})
        data['records'].append({'revision':revision,'page':page,'device':device,'content_sha256':content,'feedback_sha256':feedback,'at':datetime.now(timezone.utc).isoformat()})
        atomic(store.root/'page-checks.json',data)
        return snapshot(store,revision,device)
