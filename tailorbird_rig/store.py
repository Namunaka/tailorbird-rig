"""Versioned local feedback, durable journal and idempotent operations."""
from pathlib import Path
from datetime import datetime,timezone
import json,threading,uuid,hashlib,math
from .config import Project
def read(p,default):return json.loads(p.read_text()) if p.exists() else default
def atomic(p,value):
 import os
 temp=p.with_name(p.name+'.'+uuid.uuid4().hex+'.tmp')
 try:
  with open(temp,'w') as stream:
   json.dump(value,stream,ensure_ascii=False,indent=2);stream.write('\n');stream.flush();os.fsync(stream.fileno())
  os.replace(temp,p)
  fd=os.open(p.parent,os.O_RDONLY)
  try:os.fsync(fd)
  finally:os.close(fd)
 finally:temp.unlink(missing_ok=True)

def short(value,maximum=200):
 if not isinstance(value,str) or not value or len(value)>maximum:raise ValueError('Invalid text')
 return value
def coord(value,extended=False):
 if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not (-16<=value<=17 if extended else 0<=value<=1):raise ValueError('Invalid coordinate')
 return round(value,6)

class WorkspaceLock:
 def __init__(self,path):self.path=path;self.mutex=threading.RLock();self.local=threading.local()
 def __enter__(self):
  self.mutex.acquire()
  try:
   if not getattr(self.local,'depth',0):
    import fcntl
    self.local.file=open(self.path,'a+');fcntl.flock(self.local.file,fcntl.LOCK_EX)
   self.local.depth=getattr(self.local,'depth',0)+1
  except Exception:self.mutex.release();raise
  return self
 def __exit__(self,*args):
  self.local.depth-=1
  if not self.local.depth:self.local.file.close()
  self.mutex.release()

class ReviewStore:
 def __init__(self, config):
  self.config=Path(config).resolve();self.root=Project(config).data_dir
  self.root.mkdir(parents=True,exist_ok=True);self.lock=WorkspaceLock(self.root/"transaction.lock")
  with self.lock:self.initialize()
 def initialize(self):
  if not (self.root/'issues.json').exists():atomic(self.root/'issues.json',{'schema':1,'next_issue_number':1,'issues':[]})
  if not (self.root/'annotations.json').exists():atomic(self.root/'annotations.json',{'schema':1,'marks':[],'operations':[]})
 @property
 def project(self):
  project=Project(self.config)
  if project.data_dir!=self.root:raise ValueError('Restart server after changing data_dir')
  return project
 def recover(self):
  p=self.root/'review-pending.json'
  if p.exists():
   transaction=read(p,{});atomic(self.root/'issues.json',transaction['issues']);atomic(self.root/'annotations.json',transaction['annotations']);p.unlink()
 def snapshot(self, revision=None):
  with self.lock:
   self.recover();issues=read(self.root/'issues.json',{});data=read(self.root/'annotations.json',{'schema':1,'marks':[],'operations':[]})
   return {'marks':data['marks'],'issues':issues['issues'],'currentRevision':revision or self.project.current}
 def attachments(self, values):
  if not isinstance(values,list) or len(values)>8:raise ValueError('Invalid attachments')
  result=[]
  for v in values:
   ident=short(v.get('id',''),80)
   if not __import__('re').fullmatch(r'[a-f0-9]{64}\.(png|jpg|webp)',ident) or not (self.root/'images'/ident).is_file():raise ValueError('Unknown image')
   result.append({'id':ident,'url':'/review-images/'+ident,'name':short(v.get('name','图片'),160)})
  return result
 def apply(self, event):
  with self.lock:
   self.recover();issues=read(self.root/'issues.json',{});data=read(self.root/'annotations.json',{'schema':1,'marks':[],'operations':[]});op=short(event.get('operation'));token=short(event.get('operationId'));mark_id=short(event.get('id'))
   if token in data['operations']:return self.snapshot()
   now=datetime.now(timezone.utc).isoformat();mark=next((x for x in data['marks'] if x['id']==mark_id),None)
   if op=='add':
    if mark is not None:return self.snapshot()
    source=event.get('mark',{});revision=short(source.get('revision'));page=short(source.get('page'));device=short(source.get('device'));kind=short(source.get('kind'))
    directory,coverage=self.project.revision(revision)
    if page not in coverage['states'] or device not in [x['id'] for x in coverage['devices']] or kind not in ['pen','rect','arrow','pin','page']:raise ValueError('Unknown design context')
    points=source.get('points',[])
    if not isinstance(points,list) or not 1<=len(points)<=20000:raise ValueError('Invalid points')
    extended=source.get('coordinate_space')=='image-extended'
    if any(not isinstance(p,list) or len(p)!=2 for p in points):raise ValueError('Invalid points')
    points=[[coord(p[0],extended),coord(p[1],extended)] for p in points if isinstance(p,list) and len(p)==2]
    if not points or kind in ('rect','arrow') and len(points)!=2 or kind in ['pin','page'] and len(points)!=1:raise ValueError('Invalid geometry')
    color=source.get('color','#ff675f')
    if color not in ['#ff675f','#6cd8ff','#ffd37a']:raise ValueError('Invalid color')
    width=source.get('width',3)
    if isinstance(width,bool) or not isinstance(width,(int,float)) or not 1<=width<=12:raise ValueError('Invalid width')
    image=self.project.image(revision,page,device)
    mark={'id':mark_id,'revision':revision,'page':page,'device':device,'kind':kind,'coordinate_space':'image-extended' if extended else 'image','points':points,'color':color,'width':width,'image_sha256':hashlib.sha256(image.read_bytes()).hexdigest(),'created_at':now,'updated_at':now,'deleted':False,'comment':None};data['marks'].append(mark)
   elif op in ['comment','delete','move']:
    if mark is None or mark['deleted']:raise ValueError('Annotation no longer exists')
    if op=='move':
     points=event.get('points',[])
     if not isinstance(points,list) or len(points)!=len(mark['points']):raise ValueError('Invalid move')
     points=[[coord(p[0],True),coord(p[1],True)] for p in points if isinstance(p,list) and len(p)==2]
     if len(points)!=len(mark['points']):raise ValueError('Invalid points')
     mark.setdefault('geometry_history',[]).append({'at':now,'points':mark['points']});mark['points']=points;mark['coordinate_space']='image-extended'
    elif op=='comment':
     text=event.get('text','')
     if not isinstance(text,str):raise ValueError('Invalid text')
     text=text.strip()
     if not isinstance(text,str) or len(text)>6000:raise ValueError('Invalid text')
     images=self.attachments(event.get('attachments',[]))
     if not text and not images:raise ValueError('Empty comment')
     if mark['comment'] is None:
      number=issues['next_issue_number'];issues['next_issue_number']=number+1
      mark['comment']={'text':text,'attachments':images,'issueNumber':number,'created_at':now,'updated_at':now}
      issues['issues'].append({'number':number,'id':self.project.prefix+'-'+str(number).zfill(2),'user_quote':text,'attachments':images,'work':'待按设计图批注处理','status':'待处理','source':'设计网页批注','annotation_id':mark_id,'revision':mark['revision'],'page':mark['page'],'device':mark['device'],'image_sha256':mark['image_sha256'],'evidence':'annotations.json','app_implemented':False,'user_accepted':False})
     else:
      previous=mark['comment']['text'];previous_images=mark['comment'].get('attachments',[]);mark['comment']['text']=text;mark['comment']['attachments']=images;mark['comment']['updated_at']=now
      issue=next(x for x in issues['issues'] if x['number']==mark['comment']['issueNumber']);issue.setdefault('history',[]).append({'at':now,'previous_text':previous,'previous_attachments':previous_images});issue['user_quote']=text;issue['attachments']=images
      if (previous!=text or previous_images!=images) and self.project.is_closed(issue.get('status','')):
       issue['status']='待处理（补充反馈）';issue['user_accepted']=False
    else:
     mark['deleted']=True
     if mark['comment']:
      issue=next(x for x in issues['issues'] if x['number']==mark['comment']['issueNumber']);issue['status']='已撤回（保留记录）'
    mark['updated_at']=now
   else:raise ValueError('Unknown operation')
   data['operations']=(data['operations']+[token])[-5000:]
   atomic(self.root/'review-pending.json',{'issues':issues,'annotations':data});self.recover()
   return self.snapshot()
