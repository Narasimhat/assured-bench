"""Private local caches for completed reviews and checked public GRCh38 context.

Hosted jobs already have durable report storage. Do not use project-local disk
caches there. API keys and provider diagnostics are never persisted here.
"""
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
from datetime import datetime, timezone
import review

ROOT=Path(__file__).resolve().parents[2]/'local-reviews'/'alphagenome-comparison-cache'


def write_private(path,data):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    temporary=path.with_suffix(f'.{os.getpid()}.tmp')
    try:
        fd=os.open(temporary,os.O_CREAT|os.O_WRONLY|os.O_TRUNC,0o600)
        with os.fdopen(fd,'w') as output:json.dump(data,output,allow_nan=False)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def fetch_context(chromosome,start,end,fetcher=None,root=None):
    fetcher=fetcher or review.fetch_reference
    if os.environ.get('VERCEL'):return fetcher(chromosome,start,end)
    root=Path(root or ROOT)/'reference'
    if root.exists():
        for path in root.glob(f'{chromosome}-{start}-*.json'):
            try:
                item=json.loads(path.read_text());sequence=item['sequence']
                if item['chromosome']==chromosome and item['assembly']=='GRCh38' and item['start']==start and item['end']>=end and len(sequence)==item['end']-start and item['sha256']==hashlib.sha256(sequence.encode()).hexdigest():
                    return sequence[:end-start]
            except (OSError,ValueError,KeyError,TypeError):pass
    sequence=fetcher(chromosome,start,end)
    if len(sequence)!=end-start or any(b not in 'ACGTN' for b in sequence):raise ValueError('Invalid fetched GRCh38 reference')
    try:
        if not root.exists() or len(list(root.glob('*.json')))<200:
            write_private(root/f'{chromosome}-{start}-{end}.json',{'assembly':'GRCh38','chromosome':chromosome,'start':start,'end':end,'sequence':sequence,'sha256':hashlib.sha256(sequence.encode()).hexdigest(),'retrievedAt':datetime.now(timezone.utc).isoformat()})
    except OSError:pass # a cache write failure must not invalidate a real prediction
    return sequence


def completed(result,batch):
    candidates=result.get('candidates',[])
    return result.get('requestId')==batch['requestId'] and result.get('sourceId')==batch['sourceId'] and len(candidates)==len(batch['candidates']) and all(c.get('status')=='complete' and c.get('id')==b['id'] for c,b in zip(candidates,batch['candidates']))


def run_cached(batch,client,runner,root=None):
    if os.environ.get('VERCEL'):return runner(batch,client)
    root=Path(root or ROOT)/'reviews'
    # Code and SDK identity invalidate cached evidence when analysis logic changes.
    policy=hashlib.sha256(b''.join((Path(__file__).parent/name).read_bytes() for name in ('review.py','compare.py','alleles.py','local_cache.py'))).hexdigest()
    key=hashlib.sha256(f'{policy}:{importlib.metadata.version("alphagenome")}:{batch["requestId"]}'.encode()).hexdigest()
    path=root/f'{key}.json'
    try:
        result=json.loads(path.read_text())
        if completed(result,batch):return result
    except (OSError,ValueError,TypeError):pass
    result=runner(batch,client)
    if completed(result,batch):
        try:
            if not root.exists() or len(list(root.glob('*.json')))<200:write_private(path,result)
        except OSError:pass
    return result
