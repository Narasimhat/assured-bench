import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import {createServer} from 'vite';
import {renderToStaticMarkup} from 'react-dom/server';

globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {act}=TestRenderer;
const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join('');
const raw=fs.readFileSync(new URL('../public/references/tp53-NG_017013.2.gb',import.meta.url),'utf8');
async function modules(fn){
 const vite=await createServer({server:{middlewareMode:true,ws:false},appType:'custom',optimizeDeps:{noDiscovery:true},logLevel:'error'});
 try{return await fn({...(await vite.ssrLoadModule('/src/components/design/DesignResultView.jsx')),...(await vite.ssrLoadModule('/src/engine/design/designEngine.js')),...(await vite.ssrLoadModule('/src/services/projectState.js')),...(await vite.ssrLoadModule('/src/components/design/StructuralAlternativeComparison.jsx'))});}finally{await vite.close();}
}
const props=project=>({project,reagents:{counts:{guides:0,donors:0,primers:0},guides:[],donors:[],primers:[]},onUpdateProject(){},onProceedToOrder(){},onEditSettings(){}});

test('all six modification types expose Design and review and a cell selector on the selected-design page',async()=>{
 await modules(async({DesignResultView,runDesign,createProject})=>{
  const cases=[['ko','',''],['pm','','R175H'],['ct','FLAG',''],['nt','N:EGFP-Linker',''],['it','SPOT','R175'],['ct','T2A-EGFP','']];
  for(const [type,tag,mutation] of cases){
   const result=runDesign(type,raw,mutation,tag,400,{expectedGene:'TP53',enzyme:'spcas9',deliveryMethod:'rnp'});assert.ok(!result.err,result.err);
   const project={...createProject(),gene:'TP53',genbankRaw:raw,editType:type,tag,mutation,designResult:result};
   const html=renderToStaticMarkup(React.createElement(DesignResultView,props(project)));
   assert.match(html,/<h2>Design and review<\/h2>/,type+tag);
   assert.match(html,/aria-label="Cell type for AlphaGenome review"/,type+tag);
   assert.match(html,/>Design and review<\/button>/,type+tag);
   assert.doesNotMatch(html,/Review edited allele with AlphaGenome/,type+tag);
   if(type==='ct'&&tag==='FLAG')assert.match(html,/Explore a separate 2A reporter instead/,'FLAG is reviewed as FLAG, never silently converted to GFP');
  }
  const {designGenomicSnp}=await import('../src/engine/design/genomicSnp.js');
  const {normalizeGenomicDesign}=await import('../src/services/genomicDesignResult.js');
  const gb=fs.readFileSync(new URL('../public/references/apoe-ensg00000130203.gb',import.meta.url),'utf8').replace('FEATURES','COMMENT     Location: chromosome:GRCh38:19:44905754:44909393:1\nFEATURES');
  const input={gene:'APOE',assembly:'GRCh38',chromosome:'19',referenceStart:44905754,position:44908822,ref:'C',alt:'T',forwardConfirmed:true,blockingPolicy:'independent'};
  const result=normalizeGenomicDesign(designGenomicSnp(gb,input));assert.ok(!result.err,result.err);
  const project={...createProject(),gene:'APOE',editType:'genomic-snv',genbankRaw:gb,genomicDesignInput:{genbankRaw:gb,input},designResult:result};
  const html=renderToStaticMarkup(React.createElement(DesignResultView,props(project)));
  assert.match(html,/<h2>Design and review<\/h2>/);assert.match(html,/>Design and review<\/button>/);
 });
});

test('a running review survives report/evidence/alternatives navigation with one mounted review panel',async t=>{
 await modules(async({DesignResultView,runDesign,createProject})=>{
  const result=runDesign('ct',raw,'','FLAG',400,{expectedGene:'TP53',deliveryMethod:'rnp'});
  const project={...createProject(),gene:'TP53',editType:'ct',genbankRaw:raw,designResult:result,alleleReviewContext:'EFO:0009747'};
  let signal,finish;const updates=[];
  t.mock.method(globalThis,'fetch',async(url,init)=>{
   if(String(url).endsWith('/status'))return new Response(JSON.stringify({available:true,authenticated:true}));
   if(String(url).endsWith('/compare')){signal=init.signal;return new Promise(resolve=>{finish=resolve;});}
   throw new Error('Unexpected request');
  });
  let r;try{
   await act(async()=>{r=TestRenderer.create(React.createElement(DesignResultView,{...props(project),onUpdateProject:fields=>updates.push(fields)}));});
   for(let i=0;i<10;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});
   const buttons=label=>r.root.findAll(n=>n.type==='button'&&text(n)===label);
   let pending;
   await act(async()=>{pending=buttons('Design and review')[0].props.onClick();await Promise.resolve();});
   assert.ok(signal);assert.equal(signal.aborted,false);
   for(const label of ['Scientific report','Analysis & evidence','Compare alternatives','Selected design']){
    await act(async()=>{buttons(label)[0].props.onClick();});
    assert.equal(signal.aborted,false,label+' must not stop waiting');
    assert.equal(r.root.findAll(n=>n.props['aria-label']==='AlphaGenome edited allele review').length,1);
   }
   await act(async()=>{finish(new Response(JSON.stringify({error:'test failure'}),{status:503}));await pending;});
   assert.match(text(r.toJSON()),/test failure/);
  }finally{if(r)await act(async()=>r.unmount());}
 });
});


test('primary 2A comparison preserves the reporter and applies only a supported unique preference',async t=>{
 await modules(async({StructuralAlternativeComparison,runDesign,createProject})=>{
  for(const requirement of ['unknown','neither']){
   const result=runDesign('ct',raw,'','T2A-mScarlet_I3',400,{expectedGene:'TP53',deliveryMethod:'rnp',maxBlockingChanges:3});
   assert.ok(!result.err,result.err);
   const project={...createProject(),gene:'TP53',genbankRaw:raw,designResult:result};
   const updates=[];let calls=0;
   const mock=t.mock.method(globalThis,'fetch',async(url,init)=>{
    const batch=JSON.parse(init.body),req=batch.candidates[0].request;
    const delta=++calls/100;
    return new Response(JSON.stringify({schema:'assured-alphagenome-allele-review/1',status:'complete',evidenceType:'model-prediction',annotationFullyCovered:true,requestId:batch.requestId,sourceId:batch.sourceId,alleleRequestId:req.requestId,ontologyTerms:req.ontologyTerms,comparisonContext:req.comparisonContext,candidates:[{id:'edited-allele',status:'complete'}],modelVersion:'ALL_FOLDS',sdkVersion:'test',neighborStatus:'available',neighborTracks:[{output:'RNA_SEQ',maxAbsDelta:delta}],targetTracks:[{output:'RNA_SEQ',name:'rna',signedRelativeChange:delta,maxAbsDelta:delta},{output:'SPLICE_SITE_USAGE',name:'usage',maxAbsDelta:delta},{output:'SPLICE_SITES',name:'site',maxAbsDelta:delta}]}));
   });
   let r;try{
    await act(async()=>{r=TestRenderer.create(React.createElement(StructuralAlternativeComparison,{project,ontology:'EFO:0009747',status:{available:true},onBusyChange(){},onUpdateProject:fields=>updates.push(fields),primary:true}));});
    if(requirement==='neither')await act(async()=>{r.root.findByProps({'aria-label':'Host-protein terminal requirement'}).props.onChange({target:{value:requirement}});});
    await act(async()=>{await r.root.findAll(n=>n.type==='button'&&text(n)==='Design and review')[0].props.onClick();});
    assert.ok(calls>=2,'reviews eligible native alternatives');
    const saved=updates.filter(u=>u.structuralAlternatives).at(-1).structuralAlternatives;
    assert.equal(saved.settings.reporter,'T2A-mScarlet_I3');
    const applied=updates.filter(u=>u.designResult);
    if(requirement==='unknown'){
     assert.equal(applied.length,0,'unknown protein requirements must retain the selected design');
     assert.match(text(r.toJSON()),/Trade-offs/);
    }else{
     assert.equal(applied.length,1,'a unique supported preference is applied once');
     assert.equal(applied[0].designResult.tag,'T2A-mScarlet_I3');
     assert.equal(applied[0].structuralAlternatives.appliedId,'design-1');
     assert.notEqual(applied[0].status,'ready','external validation remains open');
    }
   }finally{if(r)await act(async()=>r.unmount());mock.mock.restore();}
  }
 });
});
