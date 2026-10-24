#!/usr/bin/env python3
"""Actual non-root image checks from private source modes; synthetic data only."""
import argparse
import io
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import tarfile
import tempfile

from isolated_restore_drill import require_local_docker_engine


def run(args, **kwargs):
    return subprocess.run(args, check=True, timeout=900, **kwargs)


def verify(kind):
    require_local_docker_engine()
    repo=Path(__file__).resolve().parents[1]
    name='operations-image-check-'+secrets.token_hex(6)
    cid=None
    with tempfile.TemporaryDirectory(prefix='operations-image-check-') as raw:
        root=Path(raw);root.chmod(0o700)
        archive=run(['git','archive','HEAD',kind],cwd=repo,stdout=subprocess.PIPE).stdout
        with tarfile.open(fileobj=io.BytesIO(archive)) as data:
            for member in data:
                relative=Path(member.name).relative_to(kind)
                if relative.is_absolute() or '..' in relative.parts or member.issym() or member.islnk():
                    raise RuntimeError('Unsafe source archive')
                if member.isfile():
                    target=root/relative;target.parent.mkdir(parents=True,mode=0o700,exist_ok=True)
                    target.write_bytes(data.extractfile(member).read());target.chmod(0o600)
        run(['docker','build','--tag',name,str(root)])
        args=['docker','run','--detach','--rm','--pull=never','--network=none','--name',name,
              '--memory=2g','--cpus=2','--pids-limit=256','--cap-drop=ALL',
              '--security-opt=no-new-privileges','--log-driver=none','--label','hiddenoasis.operations.image-check=true']
        if kind=='backend':
            args+=['--env','ENVIRONMENT=production','--env','DATABASE_URL=postgresql+psycopg2://synthetic@127.0.0.1/synthetic',
                   '--env','SESSION_SECRET=synthetic-ci-session-key-not-a-real-credential-001',
                   '--env','INTEGRATION_API_KEY=synthetic-ci-integration-not-a-real-credential-001',
                   '--env','UPLOAD_DIR=/uploads']
        try:
            cid=run(args+[name,'sh','-c','sleep 300'],stdout=subprocess.PIPE).stdout.decode().strip()
            if not re.fullmatch('[a-f0-9]{64}',cid):raise RuntimeError('Invalid test container identity')
            if kind=='backend':
                code="import os; assert os.geteuid()!=0; import app.main; assert not os.access('/app/app/main.py',os.W_OK); print('NON_ROOT_BACKEND_IMPORT_OK')"
                run(['docker','exec',cid,'python','-c',code])
            else:
                code="const fs=require('fs');if(process.getuid()===0||fs.accessSync('/app/server.js',fs.constants.R_OK))throw Error('Runtime identity');try{fs.accessSync('/app/server.js',fs.constants.W_OK);throw Error('Source writable');}catch(e){if(e.message==='Source writable')throw e;}fs.writeFileSync('/app/.next/cache/probe','synthetic');fs.unlinkSync('/app/.next/cache/probe');console.log('NON_ROOT_FRONTEND_FILES_OK');"
                run(['docker','exec',cid,'node','-e',code])
                run(['docker','exec','--detach',cid,'node','server.js'])
                probe="const base='http://127.0.0.1:3000';(async()=>{for(let i=0;i<60;i++){try{const r=await fetch(base+'/login');const html=await r.text();if(r.status!==200||!html.includes('Operations'))throw Error('Login');const asset=html.split(String.fromCharCode(34)).find(x=>x.startsWith('/_next/static/')&&(x.endsWith('.css')||x.endsWith('.js')));if(!asset||(await fetch(base+asset)).status!==200)throw Error('Static asset');console.log('NON_ROOT_FRONTEND_HTTP_OK');return;}catch(e){await new Promise(r=>setTimeout(r,1000));}}throw Error('Frontend did not start');})().catch(e=>{console.error(e.name);process.exit(1)});"
                run(['docker','exec',cid,'node','-e',probe])
        finally:
            if cid and re.fullmatch('[a-f0-9]{64}',cid):
                subprocess.run(['docker','rm','--force','--volumes',cid],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=False,timeout=60)
            subprocess.run(['docker','image','rm',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=False,timeout=60)
    print(json.dumps({'component':kind,'non_root_runtime':'pass','private_source_modes_tested':True,'production_data_used':False}))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('component',choices=['backend','frontend'])
    verify(parser.parse_args().component)
