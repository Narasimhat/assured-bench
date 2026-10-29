"""Defined deletion / integrated cassette review. Indel-aligned retained bases only.

No deleted base is scored as a model-predicted expression decrease. This is an
exploratory sequence comparison, not a validated knockout/protein-loss assay.
"""
import hashlib
import importlib.metadata
import json
import re
from datetime import datetime, timezone
from urllib.request import Request, urlopen
import numpy as np
import review


# AlphaGenome prediction contexts; large loci need the long ones to fit a whole transcript.
CONTEXT_LENGTHS = (16384, 131072, 524288, 1048576)


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',', ':'),ensure_ascii=False).encode()).hexdigest()


def validate_batch(batch):
    if batch.get('schema')!='assured-alphagenome-comparison-request/1' or batch.get('requestId')!=digest({k:v for k,v in batch.items() if k!='requestId'}):
        raise ValueError('Invalid allele batch identity')
    candidates=batch.get('candidates',[])
    if len(candidates)!=1 or candidates[0].get('id')!='edited-allele' or not re.fullmatch('[a-f0-9]{64}',batch.get('sourceId','')):
        raise ValueError('Review exactly one defined edited allele')
    r=candidates[0]['request']
    if r.get('schema')!='assured-alphagenome-allele-request/1' or r.get('requestId')!=digest({k:v for k,v in r.items() if k!='requestId'}):
        raise ValueError('Invalid allele identity')
    if r.get('assembly')!='GRCh38' or not re.fullmatch(r'chr(?:[1-9]|1\d|2[0-2]|X|Y)',r.get('chromosome','')) or r.get('designKind') not in ('ko','ct','nt','it'):
        raise ValueError('Unsupported reference or design')
    ref=r.get('reference',{}); length=r.get('sequenceLength')
    if type(ref.get('start')) is not int or ref['start']<1 or not re.fullmatch('[ACGTN]{1,1000000}',ref.get('sequence','')) or length not in CONTEXT_LENGTHS:
        raise ValueError('Invalid reference or context')
    if r.get('requestedOutputs')!=list(review.OUTPUTS) or len(r.get('ontologyTerms',[]))!=1 or not re.fullmatch(r'(?:CL|EFO|UBERON):\d+',r['ontologyTerms'][0]):
        raise ValueError('Invalid assays or cell context')
    edit=r.get('edit',{}); a,b=edit.get('start'),edit.get('end'); inserted=edit.get('inserted','')
    if type(a) is not int or type(b) is not int or not ref['start']-1<=a<=b<=ref['start']-1+len(ref['sequence']) or not re.fullmatch('[ACGT]*',inserted) or max(b-a,len(inserted))>length//4 or b==a and not inserted:
        raise ValueError('Invalid or oversized edit')
    if r['designKind']=='ko' and (inserted or b==a):raise ValueError('A knockout review requires a defined deletion')
    if r['designKind']!='ko' and not inserted:raise ValueError('A knock-in review requires the complete cassette')
    blockers=edit.get('blockers',[])
    if len(blockers)>127 or len({v.get('position') for v in blockers})!=len(blockers):raise ValueError('Invalid arm blockers')
    for v in blockers:
        p=v.get('position')
        if type(p) is not int or not ref['start']-1<=p<ref['start']-1+len(ref['sequence']) or a<=p<b or not re.fullmatch('[ACGT]',v.get('ref','')) or not re.fullmatch('[ACGT]',v.get('alt','')) or v['ref']==v['alt'] or ref['sequence'][p-ref['start']+1]!=v['ref']:
            raise ValueError('Blocker does not match reference')
    annotation=r.get('annotation',{})
    if annotation.get('strand') not in (1,-1) or annotation.get('convention')!='0-based half-open':raise ValueError('Explicit transcript mapping required')
    for key in ('exons','codingExons'):
        spans=annotation.get(key,[])
        if not isinstance(spans,list) or len(spans)>1000 or key=='exons' and not spans:raise ValueError('Invalid transcript intervals')
        last=-1
        for span in spans:
            if not isinstance(span,list) or len(span)!=2 or any(type(p) is not int for p in span) or not 0<=span[0]<span[1] or span[0]<last:raise ValueError('Invalid or overlapping transcript intervals')
            last=span[1]
    if any(not any(e[0]<=c[0]<c[1]<=e[1] for e in annotation['exons']) for c in annotation.get('codingExons',[])):raise ValueError('Coding interval outside transcript exons')
    center=(a+b)//2; start=max(0,center-length//2)
    common=r.get('comparisonContext')
    if common is not None:
        if common.get('schema')!='assured-structural-comparison-context/1' or type(common.get('start')) is not int or common['start']<0:
            raise ValueError('Invalid common comparison window')
        start=common['start']; exclusions=common.get('exclusions',[])
        if not isinstance(exclusions,list) or len(exclusions)>20:raise ValueError('Invalid comparison exclusions')
        for span in exclusions:
            if not isinstance(span,list) or len(span)!=2 or any(type(p) is not int for p in span) or not start<=span[0]<span[1]<=start+length:raise ValueError('Invalid excluded span')
    end=start+length
    if not start<a<=b<end or any(not start<=v['position']<end for v in blockers):raise ValueError('Edit and blockers must fit within the prediction context')
    return r,(start,end)


def build_sequences(r,context,bounds):
    start,end=bounds; edit=r['edit']; a,b=edit['start']-start,edit['end']-start; inserted=edit['inserted']; length=end-start
    needed=length+max(0,b-a-len(inserted))
    if len(context)!=needed or not re.fullmatch('[ACGTN]+',context):raise ValueError('Invalid extended GRCh38 context')
    ref=r['reference']; lo=max(start,ref['start']-1); hi=min(start+len(context),ref['start']-1+len(ref['sequence']))
    if context[lo-start:hi-start]!=ref['sequence'][lo-ref['start']+1:hi-ref['start']+1]:raise ValueError('Uploaded reference disagrees with GRCh38')
    full=list(context)
    for v in edit['blockers']:
        i=v['position']-start
        if full[i]!=v['ref']:raise ValueError('Blocker disagrees with fetched GRCh38')
        full[i]=v['alt']
    intended=(context[:a]+inserted+context[b:])[:length]
    joined=''.join(full); edited=(joined[:a]+inserted+joined[b:])[:length]
    if len(intended)!=length or len(edited)!=length:raise ValueError('Incomplete edited context')
    return {'reference':context[:length],'intended':intended,'edited':edited}


def coordinate_map(r,bounds):
    """Reference-base → alternate-base index; missing/deleted/cropped bases are -1."""
    start,end=bounds; edit=r['edit']; positions=np.arange(start,end); shift=len(edit['inserted'])-(edit['end']-edit['start'])
    mapped=positions-start+np.where(positions>=edit['end'],shift,0)
    mapped[(positions>=edit['start'])&(positions<edit['end'])]=-1
    mapped[(mapped<0)|(mapped>=end-start)]=-1
    return mapped


def fetch_neighbors(chromosome,start,end):
    url=f'https://rest.ensembl.org/overlap/region/human/{chromosome.removeprefix("chr")}:{start+1}-{end}?feature=gene;content-type=application/json'
    with urlopen(Request(url,headers={'Accept':'application/json'}),timeout=20) as response:
        data=json.loads(response.read())
    return [{'gene':g.get('external_name') or g['id'],'id':g['id'],'start':g['start']-1,'end':g['end'],'strand':g['strand']} for g in data if g.get('assembly_name')=='GRCh38' and g.get('feature_type')=='gene']


def checked_predictions(predictions,r,length):
    for prediction in predictions.values():
        for output in review.OUTPUTS:
            t=getattr(prediction,output.lower(),None)
            if t is None:raise ValueError('Missing expression/splicing output')
            values=np.asarray(t.values)
            # All three supported outputs are base-resolution in the pinned SDK.
            # Refuse a new resolution instead of comparing bins straddling an indel.
            if t.resolution!=1 or values.ndim!=2 or values.shape[0]!=length or not values.shape[1] or not np.isfinite(values).all():raise ValueError('Unsupported prediction resolution or invalid values')
            if output!='SPLICE_SITES' and ('ontology_curie' not in t.metadata or not set(t.metadata['ontology_curie']).issubset(set(r['ontologyTerms']))):raise ValueError('Cell context mismatch')
    review.compare_tracks(predictions['reference'],predictions['edited'])
    review.compare_tracks(predictions['intended'],predictions['edited'])


def track_rows(before,after,r,bounds,exons,strand,include_splicing=True,aligned=True):
    start,end=bounds; positions=np.arange(start,end); mapping=coordinate_map(r,bounds) if aligned else np.arange(end-start)
    mask=np.zeros(end-start,dtype=bool)
    for a,b in exons:mask|=(positions>=a)&(positions<b)
    rows=[]
    for output in review.OUTPUTS if include_splicing else ('RNA_SEQ',):
        a,b=getattr(before,output.lower()),getattr(after,output.lower()); av=np.asarray(a.values);bv=np.asarray(b.values)
        # RNA is localized to retained exons. Splicing includes the target gene body
        # to capture cryptic sites; removed bases are excluded from both modalities.
        region=mask.copy() if output=='RNA_SEQ' else ((positions>=min(e[0] for e in exons))&(positions<max(e[1] for e in exons)))
        region&=mapping>=0
        for left,right in r.get('comparisonContext',{}).get('exclusions',[]):
            if aligned:
                region&=~((positions>=left)&(positions<right))
            else:
                translated=coordinate_map(r,bounds)[left-start:right-start]
                translated=translated[translated>=0]
                if len(translated):region&=~((positions>=start+translated.min())&(positions<=start+translated.max()))
        for i in range(av.shape[1]):
            meta=a.metadata.iloc[i]
            if str(meta.get('strand','.')) not in ('+' if strand==1 else '-', '.'):continue
            x=av[region,i]; y=bv[mapping[region],i]
            baseline=float(np.mean(x)) if len(x) else None; alternate=float(np.mean(y)) if len(y) else None
            delta=y-x
            ontology=str(meta.get('ontology_curie',''))
            rows.append({'output':output,'name':str(meta.get('name',i)),'strand':str(meta.get('strand','.')),'ontology':ontology,
                'cellSpecific':output!='SPLICE_SITES' and ontology in r['ontologyTerms'],
                'comparedBases':int(region.sum()),'referenceMean':baseline,'editedMean':alternate,
                'signedRelativeChange':float((alternate-baseline)/baseline) if output=='RNA_SEQ' and baseline is not None and baseline>1e-8 else None,
                'maxAbsDelta':float(np.max(np.abs(delta))) if len(x) else None,
                'scope':'retained annotated exons' if output=='RNA_SEQ' else 'retained gene body, including cryptic sites'})
    return rows


def structural_evidence(r):
    e=r['edit'];coding=r['annotation'].get('codingExons',[])
    removed=sum(max(0,min(b,e['end'])-max(a,e['start'])) for a,b in coding)
    total=sum(b-a for a,b in coding)
    # A coding-frame calculation is only meaningful when every removed base is CDS.
    # Splice-spanning / intronic deletions need transcript reconstruction.
    frame=bool(removed and removed==e['end']-e['start'] and removed%3) if coding else None
    return {'deletedBp':e['end']-e['start'],'insertedBp':len(e['inserted']),'codingBasesRemoved':removed,'annotatedCodingBases':total,
        'frameshiftSupported':frame,'entireAnnotatedCdsDeleted':bool(total and removed==total),
        'scope':'one annotated transcript; exact designed allele, not the distribution of repair outcomes',
        'proteinLossConfirmed':False,'alternativeTranscriptsAssessed':False}


def run_batch(batch,client,reference_fetcher=review.fetch_reference,neighbor_fetcher=fetch_neighbors,on_progress=None):
    from alphagenome.data import genome
    from alphagenome.models import dna_client
    r,bounds=validate_batch(batch); start,end=bounds; edit=r['edit']; extra=max(0,edit['end']-edit['start']-len(edit['inserted']))
    sequences=build_sequences(r,reference_fetcher(r['chromosome'],start,end+extra),bounds)
    cache={};predictions={}
    for name,sequence in sequences.items():
        key=hashlib.sha256(sequence.encode()).hexdigest()
        if key not in cache:cache[key]=client.predict_sequence(sequence=sequence,interval=genome.Interval(r['chromosome'],start,end),requested_outputs=[getattr(dna_client.OutputType,n) for n in review.OUTPUTS],ontology_terms=r['ontologyTerms'])
        predictions[name]=cache[key]
    checked_predictions(predictions,r,end-start)
    annotation=r['annotation'];exons=annotation['exons'];mapping=coordinate_map(r,bounds)
    covered=all(start<=a<b<=end for a,b in exons)
    # Insertions crop the far-right reference flank. Coverage requires all retained
    # target exon bases to remain observable, not just their reference coordinates.
    for a,b in exons:
        lo=max(a,start); hi=min(b,end)
        if hi>lo:
            positions=np.arange(lo,hi);deleted=(positions>=edit['start'])&(positions<edit['end'])
            if np.any((mapping[lo-start:hi-start]<0)&~deleted):covered=False
    tracks=track_rows(predictions['reference'],predictions['edited'],r,bounds,exons,annotation['strand'])
    # Intended and final alleles share insertion coordinates; masks must be mapped
    # to ALT coordinates before comparing blocker-associated effects.
    alternate_exons=[]
    for a,b in exons:
        points=mapping[max(a,start)-start:min(b,end)-start] if min(b,end)>max(a,start) else []
        valid=np.asarray(points);valid=valid[valid>=0]
        if len(valid):alternate_exons.append([start+int(valid.min()),start+int(valid.max())+1])
    blockers=track_rows(predictions['intended'],predictions['edited'],r,bounds,alternate_exons,annotation['strand'],aligned=False) if alternate_exons and edit['blockers'] else []
    structural=structural_evidence(r)
    expression_usable=any(t['output']=='RNA_SEQ' and t['signedRelativeChange'] is not None for t in tracks)
    if not covered or not expression_usable:conclusion='Evidence insufficient'
    elif r['designKind']=='ko':conclusion='Target disruption supported by sequence' if structural['frameshiftSupported'] or structural['entireAnnotatedCdsDeleted'] else 'Possible transcript escape'
    else:conclusion='Host-gene expression and splicing require review'
    neighbors=[];neighbor_status='available'
    try:
        genes=neighbor_fetcher(r['chromosome'],start,end)
        for g in genes:
            if g['gene'].upper()==r['gene'].upper():continue
            rows=track_rows(predictions['reference'],predictions['edited'],r,bounds,[[g['start'],g['end']]],g['strand'],include_splicing=False)
            for row in rows:row.update({'gene':g['gene'],'scope':'retained gene-body RNA proxy; not exon-normalized','annotationFullyCovered':start<=g['start']<g['end']<=end})
            neighbors.extend(rows)
    except Exception:neighbor_status='unavailable; no absence of effects inferred'
    cassette=[]
    if edit['inserted']:
        left=edit['start']-start;right=left+len(edit['inserted'])
        for output in review.OUTPUTS:
            t=getattr(predictions['edited'],output.lower()); vals=np.asarray(t.values)
            for i in range(vals.shape[1]):
                meta=t.metadata.iloc[i]
                cassette.append({'output':output,'name':str(meta.get('name',i)),'meanSignal':float(np.mean(vals[left:right,i])),'maxSignal':float(np.max(vals[left:right,i]))})
    if on_progress:on_progress(1)
    return {'schema':'assured-alphagenome-allele-review/1','status':'complete','evidenceType':'model-prediction','requestId':batch['requestId'],'sourceId':batch['sourceId'],'alleleRequestId':r['requestId'],
        'candidates':[{'id':'edited-allele','status':'complete','requestId':r['requestId']}], 'createdAt':datetime.now(timezone.utc).isoformat(),'modelVersion':'ALL_FOLDS','sdkVersion':importlib.metadata.version('alphagenome'),
        'ontologyTerms':r['ontologyTerms'],'designKind':r['designKind'],'context':{'start':start,'end':end,'convention':'0-based half-open'},'annotation':annotation,'comparisonContext':r.get('comparisonContext'),'annotationFullyCovered':covered,'conclusion':conclusion,
        'structuralEvidence':structural,'targetTracks':tracks,'blockerTracks':blockers,'neighborTracks':neighbors,'neighborStatus':neighbor_status,'cassetteTracks':cassette,'uniqueSequencePredictions':len(cache),
        'limitations':['Exploratory custom track comparisons, not calibrated variant scores, knockout probabilities or safety thresholds.',
        'Deleted bases are excluded from RNA comparisons. Reduced signal caused solely by deleting exons is not model evidence of transcript suppression.',
        'Only one annotated transcript is assessed. Alternative promoters, isoforms, translation reinitiation and protein loss remain unverified.',
        'The exact designed allele is modeled. Actual NHEJ junctions, mixed repair products, zygosity, cutting and HDR efficiency are not predicted.',
        'Cell-specific RNA and splice usage require matching ontology metadata; splice-site tracks can be tissue-agnostic. Junction counts and complete isoform reconstruction are not assessed.',
        'Neighbouring genes use retained gene-body RNA proxies within the window, not complete exon-normalized or genome-wide effects.',
        'Cassette signal is descriptive; no reference-equivalent inserted bases exist. It does not establish reporter or protein function.']}
