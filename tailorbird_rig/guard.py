"""Integrity gate for explicit framework maintenance (not an OS permission sandbox)."""
from pathlib import Path
import hashlib,json
from datetime import datetime,timezone
from .store import atomic
ROOT=Path(__file__).parent
LOCK=ROOT/'framework.lock.json'

def files():
    return {str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in ROOT.rglob('*')
            if p.is_file() and '__pycache__' not in p.parts and p!=LOCK and p.suffix not in ['.pyc']}

def seal(reason):
    if not reason.strip():raise ValueError('A maintenance reason is required')
    atomic(LOCK,{'schema':1,'sealed_at':datetime.now(timezone.utc).isoformat(),'maintenance_reason':reason,'files':files()})

def verify():
    if not LOCK.exists():raise ValueError('Framework has no approved integrity baseline')
    expected=json.loads(LOCK.read_text())['files'];actual=files()
    changed=sorted(k for k in expected.keys()|actual.keys() if expected.get(k)!=actual.get(k))
    if changed:raise ValueError('Framework changed; explicit tailorbird-rig maintenance required: '+', '.join(changed))
    return {'ok':True,'files':len(actual)}

def verify_resource(path):
    expected=json.loads(LOCK.read_text())['files'];rel=str(Path(path).relative_to(ROOT))
    if expected.get(rel)!=hashlib.sha256(Path(path).read_bytes()).hexdigest():raise ValueError('Protected framework resource changed')
