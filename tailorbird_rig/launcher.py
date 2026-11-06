"""Start a detached loopback server without opening any browser window."""
import subprocess,sys,time,json,urllib.request,socket
from .config import Project

def start(config,port):
    project=Project(config)
    if not 1<=port<=65535:raise ValueError('Port must be between 1 and 65535')
    url=f'http://127.0.0.1:{port}'
    def healthy():
        try:
            with urllib.request.urlopen(url+'/healthz',timeout=.5) as r:data=json.load(r)
            return data.get('workspace')==project.public()['storageKey']
        except Exception:return False
    if healthy():return url
    with socket.socket() as probe:
        if probe.connect_ex(('127.0.0.1',port))==0:raise ValueError('Port is occupied by another service; choose another port')
    project.data_dir.mkdir(parents=True,exist_ok=True)
    log=open(project.data_dir/'server.log','ab')
    try:child=subprocess.Popen([sys.executable,'-m','tailorbird_rig','serve',str(project.filename),'--port',str(port)],cwd=__import__('pathlib').Path(__file__).resolve().parent.parent,stdout=log,stderr=log,start_new_session=True)
    finally:log.close()
    for _ in range(60):
        if healthy():
            (project.data_dir/'server.pid').write_text(str(child.pid));return url
        if child.poll() is not None:raise ValueError('Server failed; see '+str(project.data_dir/'server.log'))
        time.sleep(.1)
    raise ValueError('Server not ready; inspect local server.log before retrying')
