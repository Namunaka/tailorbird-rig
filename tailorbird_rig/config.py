"""Declarative project/revision configuration; no product-specific paths."""
from pathlib import Path
import json, re, math

class ConfigError(ValueError):
    pass

def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-][A-Za-z0-9_.-]{0,159}', value) or value in {'.','..'}:
        raise ConfigError('Invalid identifier')
    return value

def confined(root, relative):
    root = Path(root).resolve()
    if not isinstance(relative, str) or '\\' in relative or Path(relative).is_absolute():
        raise ConfigError('Invalid relative path')
    target = (root / relative).resolve()
    if not target.is_relative_to(root):
        raise ConfigError('Path escapes configured root')
    return target

class Project:
    def __init__(self, filename):
        self.filename = Path(filename).resolve()
        self.base = self.filename.parent
        self.raw = json.loads(self.filename.read_text())
        if self.raw.get('schema_version') != 1:
            raise ConfigError('Expected schema_version 1')
        self.id = identifier(self.raw['id'])
        self.current = identifier(self.raw['current_revision'])
        self.data_dir = (self.base / self.raw.get('data_dir', '.rig')).resolve()
        self.revisions = {}
        for rev in self.raw['revisions']:
            ident = identifier(rev['id'])
            if ident in self.revisions:
                raise ConfigError('Duplicate revision')
            self.revisions[ident] = rev
        if self.current not in self.revisions:
            raise ConfigError('Unknown current revision')
        self.prefix = self.raw.get('issue_prefix', 'RIG')
        identifier(self.prefix)

    def revision(self, ident=None):
        ident = ident or self.current
        if ident not in self.revisions:
            raise ConfigError('Unknown revision')
        rev = self.revisions[ident]
        root = (self.base / rev['root']).resolve()
        manifest = json.loads(confined(root, rev.get('manifest','coverage.json')).read_text())
        states = manifest['states']; devices = manifest['devices']
        if not states or len(set(states)) != len(states):
            raise ConfigError('Empty or duplicate states')
        for state in states: identifier(state)
        ids = [identifier(d['id']) for d in devices]
        if not ids or len(set(ids)) != len(ids):
            raise ConfigError('Empty or duplicate devices')
        for d in devices:
            if any(isinstance(d.get(k), bool) or not isinstance(d.get(k),(int,float)) or not math.isfinite(d[k]) or d[k]<=0 for k in ['w','h']):
                raise ConfigError('Device w/h must be positive numbers')
        return root, manifest

    def image(self, revision, page, device):
        root, manifest = self.revision(revision)
        if page not in manifest['states'] or device not in [d['id'] for d in manifest['devices']]:
            raise ConfigError('Unknown page or device')
        template = manifest.get('image_template','screens/{device}/{state}.png')
        return confined(root, template.format(device=device,state=page))

    def is_closed(self, status):
        prefixes=self.raw.get('closed_status_prefixes',['已完成','已撤回','已验收','已合并处理','已解决','已关闭'])
        return isinstance(status,str) and status.startswith(tuple(prefixes))

    def validate_assets(self, revision=None):
        ident=revision or self.current;root,manifest=self.revision(ident);count=0
        for device in manifest['devices']:
            for state in manifest['states']:
                if not self.image(ident,state,device['id']).is_file():raise ConfigError('Missing image: '+device['id']+'/'+state)
                count+=1
        from .lottie_tools import inspect_animation
        for item in manifest.get('animations',[]):
            report=inspect_animation(json.loads(confined(root,item['path']).read_text()))
            if report['errors']:raise ConfigError('Invalid animation '+item.get('id','')+': '+str(report['errors']))
        return count

    def public(self, revision=None):
        revision = revision or self.current
        _, manifest = self.revision(revision)
        return {'id':self.id,'title':self.raw.get('title',self.id),'description':self.raw.get('description',''),
                'revision':revision,'currentRevision':self.current,
                'revisions':[{'id':k,'label':v.get('label',k)} for k,v in self.revisions.items()],
                'manifest':manifest,'groups':self.raw.get('groups',[]),'links':self.raw.get('links',[]),
                'aliases':self.raw.get('aliases',{}),'storageKey':'tailorbird-rig:'+self.id+':'+__import__('hashlib').sha256(str(self.filename).encode()).hexdigest()[:12]}
