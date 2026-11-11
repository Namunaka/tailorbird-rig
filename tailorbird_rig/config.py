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

def covered_image(root, manifest, page, device):
    if page not in manifest['states'] or device not in [d['id'] for d in manifest['devices']]:
        raise ConfigError('Unknown page or device')
    template = manifest.get('image_template','screens/{device}/{state}.png')
    return confined(root, template.format(device=device,state=page))

def validate_live_previews(root, manifest):
    previews = manifest.get('live_previews', {})
    if not isinstance(previews, dict) or previews.keys() - set(manifest['states']):
        raise ConfigError('Live previews must reference existing pages')
    for relative in previews.values():
        if not isinstance(relative, str) or any(part in {'', '.', '..'} for part in relative.split('/')):
            raise ConfigError('Live previews require a relative HTML path')
        if relative == 'index.html':
            raise ConfigError('The revision index is reserved for the review viewer')
        path = confined(root, relative)
        if path.suffix.lower() != '.html' or not path.is_file():
            raise ConfigError('Missing live preview HTML: ' + relative)

def validate_alpha_entry(root,entry):
    if not isinstance(entry,dict):
        raise ConfigError('Unknown implementation evidence device')
    if entry.get('status')!='alpha' or entry.get('environment')!='simulator' or entry.get('result')!='passed':
        raise ConfigError('Expected passing Alpha simulator evidence')
    if any(not isinstance(entry.get(key),str) or not entry[key].strip() for key in ('build','summary')):
        raise ConfigError('Alpha evidence requires a build and test summary')
    screenshot=confined(root,entry.get('screenshot'))
    if not screenshot.is_file() or screenshot.suffix.lower() not in {'.png','.jpg','.jpeg','.webp'}:
        raise ConfigError('Missing or unsupported Alpha simulator screenshot')
    if 'report' in entry and not confined(root,entry['report']).is_file():
        raise ConfigError('Missing Alpha test report')
    return screenshot

def validate_implementation_evidence(root, manifest):
    path=confined(root,'implementation-evidence.json')
    if not path.exists():
        return
    data=json.loads(path.read_text())
    if not isinstance(data,dict) or not isinstance(data.get('pages'),dict):
        raise ConfigError('Expected implementation evidence pages')
    devices={device['id'] for device in manifest['devices']}
    exclusions=data.get('exclusions',{})
    if not isinstance(exclusions,dict) or exclusions.keys()-data['pages'].keys():
        raise ConfigError('Alpha exclusions must reference a registered page')
    for page,entries in data['pages'].items():
        if page not in manifest['states'] or not isinstance(entries,dict):
            raise ConfigError('Unknown implementation evidence page')
        excluded=exclusions.get(page,{})
        if not isinstance(excluded,dict) or excluded.keys()-devices or excluded.keys()&entries.keys():
            raise ConfigError('Invalid Alpha exclusions: '+page)
        for exception in excluded.values():
            if (not isinstance(exception,dict) or exception.get('kind') not in {'not_implemented','out_of_scope'}
                or not isinstance(exception.get('reason'),str) or not exception['reason'].strip()):
                raise ConfigError('Alpha exclusions require a reason: '+page)
        missing=devices-entries.keys()-excluded.keys()
        if missing:
            raise ConfigError('Missing Alpha simulator evidence for '+page+': '+', '.join(sorted(missing)))
        for device,entry in entries.items():
            if device not in devices:
                raise ConfigError('Unknown implementation evidence device')
            validate_alpha_entry(root,entry)

class Project:
    def __init__(self, filename):
        self.filename = Path(filename).resolve()
        self.base = self.filename.parent
        self.config_version = self.filename.stat().st_mtime_ns
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
        return covered_image(root, manifest, page, device)

    def is_closed(self, status):
        prefixes=self.raw.get('closed_status_prefixes',['已完成','已撤回','已验收','已合并处理','已解决','已关闭'])
        return isinstance(status,str) and status.startswith(tuple(prefixes))

    def validate_assets(self, revision=None, require_alpha=False):
        ident=revision or self.current;root,manifest=self.revision(ident);count=0
        from .components import load
        load(self,ident)
        validate_live_previews(root,manifest)
        validate_implementation_evidence(root,manifest)
        if require_alpha:
            from .implementation import implementation_report
            report=implementation_report(self,ident)
            missing_pages=[page for page in manifest['states'] if page not in report['pages']]
            if missing_pages:
                raise ConfigError(f'Alpha 开发验收未完成：{len(missing_pages)} 个页面未登记有效测试或范围例外：'
                                  +', '.join(missing_pages[:8]))
            devices={device['id'] for device in manifest['devices']}
            for page,entries in report['pages'].items():
                missing=devices-entries.keys()-report['exclusions'][page].keys()
                if missing:
                    raise ConfigError('Alpha 开发验收未完成，待重测：'+page+' / '+', '.join(sorted(missing)))
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
