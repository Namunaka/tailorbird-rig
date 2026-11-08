import unittest,tempfile,shutil,json,threading,urllib.request,urllib.error,uuid
from pathlib import Path
from tailorbird_rig.config import Project,confined
from tailorbird_rig.store import ReviewStore,atomic,read
from tailorbird_rig.server import make_server
from tailorbird_rig.workflow import activate,handoff,update_issue

class CoreTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)/'project'
  shutil.copytree(Path(__file__).parents[1]/'tailorbird_rig/starter',self.root)
  self.config=self.root/'rig.json';self.store=ReviewStore(self.config)
 def tearDown(self):self.temp.cleanup()
 def event(self,op,ident='mark',**values):return dict(operation=op,operationId=str(uuid.uuid4()),id=ident,**values)
 def add(self,ident='mark',**override):
  mark=dict(revision='v1',page='welcome',device='phone-a',kind='rect',coordinate_space='image-extended',points=[[-.2,.1],[.6,.4]],color='#ff675f',width=3);mark.update(override)
  return self.event('add',ident,mark=mark)
 def test_feedback_lifecycle_and_retry(self):
  add=self.add();self.store.apply(add);self.store.apply(add)
  c=self.event('comment',text='改这里',attachments=[]);self.store.apply(c);self.store.apply(c)
  snapshot=self.store.snapshot();self.assertEqual(len(snapshot['marks']),1);self.assertEqual(len(snapshot['issues']),1)
  self.store.apply(self.event('comment',text='补充'));self.store.apply(self.event('move',points=[[-.1,.2],[.7,.5]]))
  mark=ReviewStore(self.config).snapshot()['marks'][0]
  self.assertEqual(mark['comment']['issueNumber'],1);self.assertEqual(len(mark['geometry_history']),1)
  self.assertEqual(handoff(self.config)['issues'][0]['number'],1)
  update_issue(self.config,1,'已完成（设计）','已调整','screens/phone-a/welcome.png')
  self.assertFalse(handoff(self.config)['issues'])
  update_issue(self.config,1,'已合并处理（并入同类问题）','保留原号与证据','fixture')
  self.assertFalse(handoff(self.config)['issues'])
  self.store.apply(self.event('comment',text='已完成后补充'))
  self.assertEqual(handoff(self.config)['issues'][0]['number'],1)
  self.assertTrue(self.store.snapshot()['issues'][0]['status'].startswith('待处理'))
  self.store.apply(self.event('delete'));self.assertIn('撤回',self.store.snapshot()['issues'][0]['status'])
 def test_revision_publication_and_isolation(self):
  self.store.apply(self.add());root=self.root/'designs/v2';shutil.copytree(self.root/'designs/v1',root)
  activate(self.config,'v2',root)
  self.assertEqual(self.store.snapshot()['currentRevision'],'v2');self.assertEqual(self.store.snapshot()['marks'][0]['revision'],'v1')
  with self.assertRaises(ValueError):activate(self.config,'v2',root)
  (root/'screens/phone-a/welcome.png').unlink()
  with self.assertRaises(ValueError):activate(self.config,'v3',root)
  self.assertEqual(Project(self.config).current,'v2')
 def test_journal_recovery(self):
  atomic(self.store.root/'review-pending.json',{'issues':{'next_issue_number':9,'issues':[]},'annotations':{'marks':[],'operations':[]}})
  self.store.snapshot();self.assertEqual(read(self.store.root/'issues.json',{})['next_issue_number'],9);self.assertFalse((self.store.root/'review-pending.json').exists())
 def test_page_confirmation_content_and_revision_lifecycle(self):
  from tailorbird_rig.page_checks import snapshot,confirm
  def status():return snapshot(self.store,Project(self.config).current,'phone-a')['pages']['welcome']
  def accept():confirm(self.store,dict(revision=Project(self.config).current,page='welcome',device='phone-a',**{k:status()[k] for k in ('content_sha256','feedback_sha256')}))
  self.assertEqual(status()['status'],'default');accept();self.assertEqual(status()['status'],'confirmed')
  self.assertEqual(snapshot(self.store,'v1','phone-b')['pages']['welcome']['status'],'default')
  for revision,changed in [('v2',False),('v3',True),('v4',False)]:
   directory=self.root/'designs'/revision;shutil.copytree(self.root/'designs/v1',directory)
   if changed:shutil.copyfile(directory/'screens/phone-a/form.png',directory/'screens/phone-a/welcome.png')
   activate(self.config,revision,directory)
   self.assertEqual(status()['status'],'confirmed' if revision=='v2' else 'default')
  self.assertEqual(snapshot(self.store,'v1','phone-a')['pages']['welcome']['status'],'confirmed')
 def test_fixed_feedback_yellow_and_stale_confirmation(self):
  from tailorbird_rig.page_checks import snapshot,confirm
  def status():return snapshot(self.store,'v1','phone-a')['pages']['welcome']
  stale=status();self.store.apply(self.add());self.store.apply(self.event('comment',text='调整标题'))
  with self.assertRaises(ValueError):confirm(self.store,dict(revision='v1',page='welcome',device='phone-a',**{k:stale[k] for k in ('content_sha256','feedback_sha256')}))
  self.assertEqual(status()['status'],'needs_work')
  update_issue(self.config,1,'已完成（设计）','标题已调整','synthetic fixture')
  self.assertEqual(status()['status'],'needs_check')
  confirm(self.store,dict(revision='v1',page='welcome',device='phone-a',**{k:status()[k] for k in ('content_sha256','feedback_sha256')}))
  self.assertEqual(status()['status'],'confirmed')
  self.store.apply(self.event('comment',text='再调整字号'));self.assertEqual(status()['status'],'needs_work')
 def test_progress_counts_every_page_device_and_bare_mark(self):
  from tailorbird_rig.page_checks import snapshot,confirm
  _,manifest=Project(self.config).revision('v1')
  total=len(manifest['states'])*len(manifest['devices'])
  for page in manifest['states']:
   for device in manifest['devices']:
    ident=device['id']
    check=snapshot(self.store,'v1',ident)['pages'][page]
    confirm(self.store,dict(revision='v1',page=page,device=ident,**check))
  progress=snapshot(self.store,'v1','phone-b')
  self.assertEqual(progress['overall'],dict(confirmed=total,total=total,needs_check=False,needs_work=False))
  self.store.apply(self.add())
  progress=snapshot(self.store,'v1','phone-b')
  self.assertEqual(progress['pages']['welcome']['status'],'confirmed')
  self.assertEqual(progress['progress']['welcome'],dict(confirmed=6,total=7,needs_check=False,needs_work=True))
  self.assertEqual(progress['overall'],dict(confirmed=total-1,total=total,needs_check=False,needs_work=True))
  check=snapshot(self.store,'v1','phone-a')['pages']['welcome']
  confirm(self.store,dict(revision='v1',page='welcome',device='phone-a',**check))
  self.assertEqual(snapshot(self.store,'v1','phone-b')['overall']['confirmed'],total)
 def test_batch_confirmation_rejects_stale_device_without_partial_writes(self):
  from tailorbird_rig.page_checks import snapshot,confirm
  event=dict(revision='v1',page='welcome',device='phone-a')
  def current():
   return snapshot(self.store,'v1','phone-a','welcome')
  before=current()
  total=before['progress']['welcome']['total']
  self.store.apply(self.add(device='phone-b'))
  with self.assertRaisesRegex(ValueError,'changed'):
   confirm(self.store,dict(event,batch_sha256=before['batch_sha256']))
  self.assertEqual(current()['overall']['confirmed'],0)
  result=confirm(self.store,dict(event,batch_sha256=current()['batch_sha256']))
  self.assertEqual(result['progress']['welcome']['confirmed'],total)
  self.assertEqual(result['overall']['confirmed'],total)
  other=current()['pages']['done']
  confirm(self.store,dict(event,page='done',**other))
  result=confirm(self.store,dict(event,batch_sha256=current()['batch_sha256'],confirmed=False))
  self.assertEqual(result['progress']['welcome']['confirmed'],0)
  self.assertEqual(result['device_statuses']['welcome']['phone-b'],'needs_work')
  self.assertEqual(result['progress']['done']['confirmed'],1)
 def test_scoped_confirmation_does_not_compute_other_pages(self):
  from unittest.mock import patch
  from tailorbird_rig.page_checks import _Review, snapshot, confirm
  original=_Review.status
  def only_welcome(review,page,*args,**kwargs):
   self.assertEqual(page,'welcome')
   return original(review,page,*args,**kwargs)
  with patch.object(_Review,'status',only_welcome):
   result=snapshot(self.store,'v1','phone-a','welcome',page_only=True)
   result=confirm(self.store,dict(revision='v1',page='welcome',device='phone-a',scope='page',
                                batch_sha256=result['batch_sha256']))
  self.assertEqual(list(result['progress']),['welcome'])
  self.assertIsNone(result['overall'])
  self.assertEqual(result['progress']['welcome']['confirmed'],7)
 def test_alpha_requires_passing_evidence_or_explicit_exclusions(self):
  project=Project(self.config);root,manifest=project.revision('v1')
  entry=dict(status='alpha',environment='simulator',result='passed',build='test',
             summary='Form passed',screenshot='screens/phone-a/form.png')
  data={'pages':{'form':{'phone-a':entry}}}
  path=root/'implementation-evidence.json'
  atomic(path,data)
  with self.assertRaisesRegex(ValueError,'Missing Alpha simulator evidence'):
   project.validate_assets()
  data['exclusions']={'form':{d['id']:{'kind':'not_implemented','reason':'Fixture implements A only'}
                              for d in manifest['devices'] if d['id']!='phone-a'}}
  atomic(path,data)
  self.assertGreater(project.validate_assets(),0)
  with self.assertRaisesRegex(ValueError,'页面未登记'):
   project.validate_assets(require_alpha=True)
  for page in set(manifest['states'])-{'form'}:
   data['pages'][page]={}
   data['exclusions'][page]={d['id']:{'kind':'out_of_scope','reason':'Fixture only covers the form'}
                             for d in manifest['devices']}
  atomic(path,data)
  self.assertGreater(project.validate_assets(require_alpha=True),0)
  entry['result']='failed'
  atomic(path,data)
  with self.assertRaisesRegex(ValueError,'Expected passing Alpha simulator evidence'):
   project.validate_assets()
 def test_live_preview_validation_and_confirmation_history(self):
  from tailorbird_rig.page_checks import snapshot,confirm
  root=self.root/'designs/v1'
  manifest=read(root/'coverage.json',{})
  manifest['live_previews']={'welcome':'../escape.html'}
  atomic(root/'coverage.json',manifest)
  with self.assertRaisesRegex(ValueError,'relative HTML path'):
   Project(self.config).validate_assets()
  manifest['live_previews']={'welcome':'preview.html'}
  atomic(root/'coverage.json',manifest)
  with self.assertRaisesRegex(ValueError,'Missing live preview HTML'):
   Project(self.config).validate_assets()
  (root/'preview.html').write_text('<button>Check</button>')
  Project(self.config).validate_assets()
  for device in ('phone-a','phone-b'):
   check=snapshot(self.store,'v1',device)['pages']['welcome']
   confirm(self.store,dict(revision='v1',page='welcome',device=device,**check))
  v2=self.root/'designs/v2'
  shutil.copytree(root,v2)
  manifest['devices'][0]['w']+=10
  atomic(v2/'coverage.json',manifest)
  activate(self.config,'v2',v2)
  self.assertEqual(snapshot(self.store,'v2','phone-a')['pages']['welcome']['status'],'default')
  self.assertEqual(snapshot(self.store,'v2','phone-b')['pages']['welcome']['status'],'confirmed')
  v3=self.root/'designs/v3'
  shutil.copytree(v2,v3)
  (v3/'preview.html').write_text('<button>Changed</button>')
  activate(self.config,'v3',v3)
  self.assertEqual(snapshot(self.store,'v3','phone-b')['pages']['welcome']['status'],'default')
  self.assertEqual(snapshot(self.store,'v1','phone-a')['pages']['welcome']['status'],'confirmed')
 def test_withdrawing_inherited_confirmation_keeps_history(self):
  from tailorbird_rig.page_checks import snapshot,confirm
  def set_checked(revision,desired):
   check=snapshot(self.store,revision,'phone-a')['pages']['welcome']
   return confirm(self.store,dict(revision=revision,page='welcome',device='phone-a',confirmed=desired,**check))
  set_checked('v1',True)
  for revision in ('v2','v3'):
   directory=self.root/'designs'/revision;shutil.copytree(self.root/'designs/v1',directory)
   activate(self.config,revision,directory)
   if revision=='v2':
    self.assertEqual(snapshot(self.store,'v2','phone-b')['device_statuses']['welcome']['phone-a'],'confirmed')
    withdrawn=set_checked('v2',False)
    self.assertEqual(withdrawn['device_statuses']['welcome']['phone-a'],'default')
    self.assertEqual(withdrawn['overall']['confirmed'],0)
  self.assertEqual(snapshot(self.store,'v3','phone-a')['pages']['welcome']['status'],'default')
  self.assertEqual(snapshot(self.store,'v1','phone-a')['pages']['welcome']['status'],'confirmed')
  self.assertEqual(set_checked('v3',True)['overall']['confirmed'],1)
 def test_multiple_store_instances_serialize_issue_numbers(self):
  def write(n):
   store=ReviewStore(self.config);store.apply(self.add(str(n)));store.apply(self.event('comment',str(n),text=str(n)))
  threads=[threading.Thread(target=write,args=(n,)) for n in range(10)]
  for t in threads:t.start()
  for t in threads:t.join()
  self.assertEqual(sorted(i['number'] for i in self.store.snapshot()['issues']),list(range(1,11)))
 def test_invalid_geometry_and_path_escape(self):
  with self.assertRaises(ValueError):self.store.apply(self.add(points=[[float('nan'),0],[0,0]]))
  with self.assertRaises(ValueError):self.store.apply(self.add(kind='rect',points=[[0,0]]))
  with self.assertRaises(ValueError):confined(self.root,'../private.txt')
  (self.root/'outside').symlink_to(self.root.parent,target_is_directory=True)
  with self.assertRaises(ValueError):confined(self.root,'outside/private.txt')
 def test_server_routes_and_write_origin(self):
  server=make_server(self.config,0);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();base=f'http://127.0.0.1:{server.server_port}'
  try:
   self.assertEqual(json.load(urllib.request.urlopen(base+'/api/project'))['revision'],'v1')
   self.assertEqual(urllib.request.urlopen(base+'/revisions/v1/screens/phone-a/welcome.png').status,200)
   self.assertTrue(urllib.request.urlopen(base+'/revisions/v1/index.html').geturl().endswith('/?revision=v1'))
   with self.assertRaises(urllib.error.HTTPError) as err:urllib.request.urlopen(base+'/assets/../../rig.json')
   self.assertEqual(err.exception.code,404)
   request=urllib.request.Request(base+'/api/annotations',data=json.dumps(self.add()).encode(),headers={'Content-Type':'application/json','Origin':'https://external.example'})
   with self.assertRaises(urllib.error.HTTPError) as err:urllib.request.urlopen(request)
   self.assertEqual(err.exception.code,403)
   request=urllib.request.Request(base+'/api/images',data=b'invalid',headers={'Content-Type':'image/png'})
   with self.assertRaises(urllib.error.HTTPError) as err:urllib.request.urlopen(request)
   self.assertEqual(err.exception.code,400)
   with self.assertRaises(ValueError):make_server(self.config,0)
  finally:server.shutdown();server.server_close();server.workspace_lock.close();thread.join()

if __name__=='__main__':unittest.main()

class AnimationAndGuardTests(unittest.TestCase):
 def test_shared_component_registry_and_publish_validation(self):
  from tailorbird_rig.components import validate,load
  import copy
  with tempfile.TemporaryDirectory() as t:
   root=Path(t)/'project';shutil.copytree(Path(__file__).parents[1]/'tailorbird_rig/starter',root);config=root/'rig.json';project=Project(config)
   bundle=load(project);self.assertFalse(bundle['example']);self.assertEqual(len(bundle['system']['components']),9)
   invalid=copy.deepcopy(bundle['system']);invalid['components'].append(copy.deepcopy(invalid['components'][0]))
   with self.assertRaises(ValueError):validate(invalid)
   invalid=copy.deepcopy(bundle['system']);invalid['components'][-1]['children']=['confirm-actions']
   with self.assertRaises(ValueError):validate(invalid)
   candidate=root/'designs/v2';shutil.copytree(root/'designs/v1',candidate);manifest=json.loads((candidate/'coverage.json').read_text());manifest['component_usage']={'welcome':['unknown-control']};atomic(candidate/'coverage.json',manifest)
   with self.assertRaises(ValueError):activate(config,'v2',candidate)
   self.assertEqual(Project(config).current,'v1')
   manifest['component_usage']={'welcome':['primary-action:loading']};atomic(candidate/'coverage.json',manifest);activate(config,'v2',candidate)
   self.assertEqual(load(Project(config))['usage']['welcome'],['primary-action:loading'])
   self.assertIn('公共元素集',handoff(config)['markdown'])
 def test_component_changes_invalidate_page_acceptance(self):
  from tailorbird_rig.page_checks import snapshot,confirm
  with tempfile.TemporaryDirectory() as t:
   root=Path(t)/'project';shutil.copytree(Path(__file__).parents[1]/'tailorbird_rig/starter',root);config=root/'rig.json';store=ReviewStore(config)
   item=snapshot(store,'v1','phone-a')['pages']['welcome'];confirm(store,dict(revision='v1',page='welcome',device='phone-a',**{k:item[k] for k in ('content_sha256','feedback_sha256')}))
   candidate=root/'designs/v2';shutil.copytree(root/'designs/v1',candidate);system=json.loads((candidate/'design-system.json').read_text());system['tokens']['radius']=24;atomic(candidate/'design-system.json',system);activate(config,'v2',candidate)
   self.assertEqual(snapshot(store,'v2','phone-a')['pages']['welcome']['status'],'default')
 def test_authoring_and_rebuild(self):
  from tailorbird_rig.lottie_tools import build_animation,inspect_animation,create_bundle
  for motion in ['bounce','pulse','draw']:
   data=build_animation(motion=motion);self.assertFalse(inspect_animation(data)['errors']);self.assertEqual(data['v'],'5.12.2')
  with tempfile.TemporaryDirectory() as t:
   path=Path(t)/'motion';create_bundle(path,{'motion':'draw'})
   self.assertTrue((path/'generator.py').is_file());self.assertTrue((path/'inspection.json').is_file())
  self.assertTrue(inspect_animation({'w':0,'h':50,'fr':60,'ip':0,'op':20,'layers':[]})['errors'])
  data=build_animation();data['layers'][0]['ks']['p']['x']='alert(1)';self.assertTrue(inspect_animation(data)['errors'])
 def test_framework_integrity_gate(self):
  from unittest.mock import patch
  from tailorbird_rig import guard
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);(root/'core.js').write_text('stable')
   with patch.object(guard,'ROOT',root),patch.object(guard,'LOCK',root/'framework.lock.json'):
    guard.seal('fixture');self.assertTrue(guard.verify()['ok']);(root/'core.js').write_text('modified')
    with self.assertRaises(ValueError):guard.verify()
