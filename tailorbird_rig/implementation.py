"""Resolve simulator evidence against the current content of each design page."""
from collections import defaultdict

from .config import confined, validate_alpha_entry
from .page_checks import revision_content, _file_digest
from .store import read


def implementation_report(project, revision):
    revisions=list(project.revisions)
    revisions=revisions[:revisions.index(revision)+1]
    _,manifest=project.revision(revision)
    pages=set(manifest['states'])
    devices={device['id'] for device in manifest['devices']}
    declarations=defaultdict(list)
    for index,ident in enumerate(revisions):
        folder,_=project.revision(ident)
        data=read(confined(folder,'implementation-evidence.json'),{})
        for page,entries in data.get('pages',{}).items():
            if page in pages:
                declarations[page].append((index,folder,entries,data.get('exclusions',{}).get(page,{})))

    content={}
    def digest(index,page):
        try:
            if index not in content:
                content[index]=revision_content(project,revisions[index])
            return content[index].page_digest(page)
        except (ValueError,KeyError,FileNotFoundError):
            return None

    report={'pages':{},'exclusions':{}}
    for page,history in declarations.items():
        start=len(revisions)-1
        current=digest(start,page)
        if current is None:
            continue
        while start>history[0][0] and digest(start-1,page)==current:
            start-=1
        index,folder,entries,exclusions=history[-1]
        if index<start:
            continue
        passing={}
        for device in devices & entries.keys():
            entry=entries[device]
            try:
                screenshot=validate_alpha_entry(folder,entry)
                previous=[(old_folder,old_entries[device]) for old_index,old_folder,old_entries,_ in history
                          if old_index<start and device in old_entries]
                if any(_same_capture(old_folder,old,entry,screenshot) for old_folder,old in previous):
                    continue
            except (ValueError,TypeError,FileNotFoundError):
                continue
            passing[device]={**entry,'revision':revisions[index]}
        report['pages'][page]=passing
        report['exclusions'][page]={device:exclusions[device] for device in devices & exclusions.keys()}
    return report


def _same_capture(folder, previous, entry, screenshot):
    if not isinstance(previous,dict) or previous.get('build')!=entry['build']:
        return False
    old_screenshot=confined(folder,previous.get('screenshot'))
    return old_screenshot.is_file() and _file_digest(old_screenshot)==_file_digest(screenshot)
