"""Human page acceptance, tied to content and feedback rather than release names."""
import hashlib, json
from collections import defaultdict
from datetime import datetime, timezone
from functools import lru_cache
from .config import confined, covered_image
from .store import atomic, read

FINGERPRINT_FIELDS=('content_sha256','feedback_sha256')

def _batch_digest(revision,page,checks):
    fingerprints=[(device,*(check[k] for k in FINGERPRINT_FIELDS))
                  for device,check in sorted(checks.items())]
    return hashlib.sha256(json.dumps([revision,page,fingerprints]).encode()).hexdigest()

@lru_cache(maxsize=4096)
def _digest(path, modified, size):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def _file_digest(path):
    stat=path.stat()
    return _digest(path,stat.st_mtime_ns,stat.st_size)

class _RevisionContent:
    def __init__(self,project,revision):
        from .components import load
        self.root,self.manifest=project.revision(revision)
        elements=load(project,revision)
        self.elements_digest=None if elements['example'] else elements['sha256']
        self.animations={}

    def digest(self,page,device):
        parts=[_file_digest(covered_image(self.root,self.manifest,page,device))]
        if self.elements_digest is not None:parts.append(self.elements_digest)
        for animation in self.manifest.get('animations',[]):
            if animation.get('pages') and page not in animation['pages']:continue
            path=animation['path']
            if path not in self.animations:
                self.animations[path]=_file_digest(confined(self.root,path))
            parts.append(self.animations[path])
        return hashlib.sha256(json.dumps(parts).encode()).hexdigest()

def content_digest(project, revision, page, device):
    return _RevisionContent(project,revision).digest(page,device)

def feedback_digest(issues):
    fields=('number','user_quote','attachments','status','work','resolved_content_sha256')
    return hashlib.sha256(json.dumps([{k:i.get(k) for k in fields} for i in sorted(issues,key=lambda i:i['number'])],sort_keys=True,ensure_ascii=False).encode()).hexdigest()

def _group(entries):
    groups=defaultdict(list)
    for entry in entries:
        groups[entry.get('page'),entry.get('device')].append(entry)
    return groups


class _Review:
    def __init__(self,store,revision):
        self.project=store.project
        _,self.manifest=self.project.revision(revision)
        self.revision=revision
        self.revisions=list(self.project.revisions)
        self.index=self.revisions.index(revision)
        self.visible=set(self.revisions[:self.index+1])
        self.issues=_group(i for i in read(store.root/'issues.json',{})['issues']
                           if (not i.get('revision') or i['revision'] in self.visible)
                           and not i.get('status','').startswith('已撤回'))
        self.marks=_group(m for m in read(store.root/'annotations.json',{})['marks']
                          if not m.get('deleted') and m.get('revision') in self.visible)
        self.records=_group(r for r in read(store.root/'page-checks.json',{'records':[]})['records']
                            if r['revision'] in self.visible)
        self.digests={}
        self.content_by_revision={}

    def digest(self,revision,page,device):
        key=revision,page,device
        if key not in self.digests:
            if revision not in self.content_by_revision:
                self.content_by_revision[revision]=_RevisionContent(self.project,revision)
            self.digests[key]=self.content_by_revision[revision].digest(page,device)
        return self.digests[key]

    def status(self,page,device,detail=False):
        key=page,device
        issues=self.issues.get(key,[])
        marks=self.marks.get(key,[])
        records=self.records.get(key,[])
        if not (detail or issues or marks or records):
            return {'status':'default'}
        content=self.digest(self.revision,*key)

        def same_draft(revision):
            try:
                return all(self.digest(r,*key)==content
                           for r in self.revisions[self.revisions.index(revision):self.index+1])
            except (ValueError,KeyError,FileNotFoundError):
                return False

        marks=[m for m in marks if same_draft(m['revision'])]
        legacy=feedback_digest(issues)
        fingerprint=sorted((m['id'],m.get('updated_at') or m.get('created_at') or '') for m in marks)
        feedback=hashlib.sha256(json.dumps([legacy,fingerprint]).encode()).hexdigest() if marks else legacy
        result={'content_sha256':content,'feedback_sha256':feedback}
        # A later revision takes precedence over actions taken on older drafts.
        for record in reversed(sorted(records,key=lambda r:self.revisions.index(r['revision']))):
            if record.get('revoked'):break
            if record['content_sha256']!=content:continue
            # Keep approvals from before mark tracking if no active mark has changed since.
            matches=record['feedback_sha256']==feedback
            if not record.get('tracks_marks') and record['feedback_sha256']==legacy:
                matches=all(stamp and stamp<=record['at'] for _,stamp in fingerprint)
            if matches and same_draft(record['revision']):
                return dict(result,status='confirmed',confirmed_at=record['at'])

        linked_marks={i.get('annotation_id') for i in issues}
        if any(not self.project.is_closed(i.get('status','')) for i in issues) or any(
            m['id'] not in linked_marks for m in marks
        ):
            return dict(result,status='needs_work')
        resolved=any(i.get('resolved_content_sha256')==content for i in issues)
        return dict(result,status='needs_check' if resolved else 'default')


def snapshot(store,revision,device,active_page=None):
    with store.lock:
        store.recover()
        review=_Review(store,revision)
        devices=[d['id'] for d in review.manifest['devices']]
        if device not in devices:raise ValueError('Unknown device')
        if active_page is not None and active_page not in review.manifest['states']:
            raise ValueError('Unknown page')
        pages={}
        progress={}
        device_statuses={}
        checks={}
        for page in review.manifest['states']:
            statuses={}
            for ident in devices:
                check=review.status(page,ident,detail=ident==device or page==active_page)
                statuses[ident]=check['status']
                if ident==device:pages[page]=check
                if page==active_page:checks[ident]=check
            device_statuses[page]=statuses
            progress[page]={'confirmed':list(statuses.values()).count('confirmed'),
                            'total':len(devices),'needs_check':'needs_check' in statuses.values(),
                            'needs_work':'needs_work' in statuses.values()}
        overall={'confirmed':sum(p['confirmed'] for p in progress.values()),
                 'total':sum(p['total'] for p in progress.values()),
                 'needs_check':any(p['needs_check'] for p in progress.values()),
                 'needs_work':any(p['needs_work'] for p in progress.values())}
        return {'revision':revision,'device':device,'pages':pages,'progress':progress,
                'device_statuses':device_statuses,'overall':overall,
                'active_page':active_page,
                'batch_sha256':_batch_digest(revision,active_page,checks) if active_page is not None else None}


def confirm(store,event):
    with store.lock:
        store.recover();revision=event['revision'];page=event['page'];device=event['device']
        review=_Review(store,revision)
        devices={d['id'] for d in review.manifest['devices']}
        if page not in review.manifest['states'] or device not in devices:
            raise ValueError('Unknown page or device')
        desired=event.get('confirmed',True)
        if not isinstance(desired,bool):raise ValueError('Invalid confirmation state')
        if 'batch_sha256' in event:
            checks={ident:review.status(page,ident,detail=True) for ident in devices}
            if event['batch_sha256']!=_batch_digest(revision,page,checks):
                raise ValueError('Page or feedback changed; review again')
        else:
            check=review.status(page,device,detail=True)
            if any(event.get(k)!=check[k] for k in FINGERPRINT_FIELDS):
                raise ValueError('Page or feedback changed; review again')
            checks={device:check}
        records=[]
        for ident,check in checks.items():
            if (check['status']=='confirmed')!=desired:
                records.append({'revision':revision,'page':page,'device':ident,
                                'content_sha256':check['content_sha256'],'feedback_sha256':check['feedback_sha256'],
                                'tracks_marks':True,'revoked':not desired,
                                'at':datetime.now(timezone.utc).isoformat()})
        if records:
            data=read(store.root/'page-checks.json',{'schema':1,'records':[]})
            data['records'].extend(records)
            atomic(store.root/'page-checks.json',data)
        return snapshot(store,revision,device,page)
