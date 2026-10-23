import { findBlockingSet, keepsCodonsSynonymous, mkODN, assessGuideAgainstPointMutationDonor } from './designEngine.js';

export const BLOCKING_POLICIES = Object.freeze({
  none: 'Requested edit only',
  synonymous: 'Allow synonymous coding changes',
  noncoding: 'Allow synonymous and additional noncoding changes',
  pair: 'Two guides, co-transfected: shared blocking changes on both ssODNs',
  independent: 'Two guides, delivered separately: each ssODN blocks its own guide',
});

/** The two-guide policies (see pairBlocking.js): always two guides and two ssODNs; co-transfection shares the blocking set, otherwise each ssODN blocks its own guide. */
export const isTwoGuidePolicy = (policy) => policy === 'pair' || policy === 'independent';

/** The form's two checkboxes as a policy: blocking changes off -> exact edit only; on -> shared set (co-transfection) or per-guide sets. */
export function blockingPolicyFor({ addBlocking = true, coDelivery = true } = {}) {
  return addBlocking === false ? 'none' : coDelivery === false ? 'independent' : 'pair';
}

// These are explicit screening heuristics, not splice-site strength predictions.
export function spliceJunctions(model) {
  const exons = [...(model.exons || [])].sort((a,b)=>a.start-b.start);
  return exons.slice(0,-1).flatMap((e,i)=>e.end < exons[i+1].start ? [
    {kind:'donor',start:e.end,edge:e.end,label:e.label},
    {kind:'acceptor',start:exons[i+1].start-2,edge:exons[i+1].start,label:exons[i+1].label},
  ] : []);
}

export function screenSpliceChanges(model, before, changes) {
  const edits = new Map(changes.map(m=>[m.gp,m.nb]));
  const base=p=>edits.get(p) ?? before[p];
  const pair=p=>`${base(p)||''}${base(p+1)||''}`;
  const junctions=spliceJunctions(model);
  const junctionChanges=junctions.filter(j=>edits.has(j.start)||edits.has(j.start+1)).map(j=>({
    ...j,before:before.slice(j.start,j.start+2),after:pair(j.start),
  })).filter(j=>j.before!==j.after);
  const nearby=changes.flatMap(m=>junctions.filter(j=>Math.abs(m.gp-j.edge)<=20).map(j=>({gp:m.gp,kind:j.kind,distance:m.gp-j.edge})));
  const motifChanges=[...new Set(changes.flatMap(m=>[m.gp-1,m.gp]))].filter(p=>p>=0 && p+1<before.length).flatMap(p=>{
    const a=before.slice(p,p+2),b=pair(p);
    return a!==b && [a,b].some(x=>['GT','AG'].includes(x)) ? [{gp:p,before:a,after:b}] : [];
  });
  return {method:'Sequence screen only; no splice-strength model',predictionStatus:'unassessed',
    annotationAvailable:junctions.length>0,junctionChanges,nearby,motifChanges,
    risk:junctionChanges.length?'junction changed':nearby.length || motifChanges.length?'review signals':junctions.length?'no local flags':'annotation unavailable',
    limitation:'GT/AG motif changes and a 20-bp junction proximity flag are screening signals, not evidence of cryptic splice-site use or safety. Branch points, enhancers, silencers and RNA outcomes are not predicted.'};
}

export function buildBlockingComparison(model, guide, gp, alt, policy, maxChanges) {
  const seq=model.genomicSequence;
  const edited=seq.slice(0,gp)+alt+seq.slice(gp+1);
  const editedModel={...model,genomicSequence:edited};
  const junctions=spliceJunctions(model);
  const baselineDonor=mkODN(model,guide,[gp],[alt],[],null);
  if(!baselineDonor)throw Error('Insufficient reference for the donor.');
  const baselineProtection=assessGuideAgainstPointMutationDonor(guide,baselineDonor);
  const allowed=p=>p!==gp && p>=baselineDonor.donorStart && p<baselineDonor.donorEnd && !junctions.some(j=>p===j.start || p===j.start+1);
  const variants=[{id:'requested-only',changes:[],donor:baselineDonor,protection:baselineProtection}];
  // No CDS means "outside CDS" is unknown, not proven noncoding.
  if(policy!=='none' && model.cdsSegments?.length && baselineProtection.tier!=='strong') {
    const pamStart=guide.str==='+'?guide.ps+20:guide.ps;
    for(const pamOnly of [true,false]) {
      const changes=findBlockingSet(editedModel,guide,new Set([gp]),{
        allowNonCoding:policy==='noncoding',maxChanges,
        isPositionAllowed:p=>allowed(p) && (!pamOnly || (p>=pamStart && p<pamStart+3)),
      });
      if(!changes.length || variants.some(v=>JSON.stringify(v.changes.map(m=>[m.gp,m.nb]))===JSON.stringify(changes.map(m=>[m.gp,m.nb]))))continue;
      // Validate the combined changes relative to the requested-edit allele, including codon interactions.
      if(!changes.every((m,i)=>keepsCodonsSynonymous(editedModel,changes.slice(0,i),m)))continue;
      const donor=mkODN(model,guide,[gp],[alt],changes,null);
      const expected=new Map([[gp,alt],...changes.map(m=>[m.gp,m.nb])]);
      if(!donor || [...donor.genomicDonor].some((b,i)=>b!==(expected.get(donor.donorStart+i)??seq[donor.donorStart+i])))throw Error('Blocking donor validation failed.');
      const protection=assessGuideAgainstPointMutationDonor(guide,donor);
      if(Number.isFinite(protection.cfd) && protection.cfd < baselineProtection.cfd)variants.push({id:pamOnly?'pam-blocking':'pam-seed-blocking',changes,donor,protection});
    }
  }
  for(const v of variants)v.splice=screenSpliceChanges(model,edited,v.changes);
  // Prefer a strong candidate, then fewer local screening flags, fewer added bases and lower CFD.
  const rank=v=>[v.protection.tier==='strong'?0:1,v.splice.junctionChanges.length*100+v.splice.nearby.length+v.splice.motifChanges.length,v.changes.length,v.protection.cfd??Infinity];
  const sorted=[...variants].sort((a,b)=>{const x=rank(a),y=rank(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]-y[i];return 0;});
  const selected=sorted[0];
  return {selected,variants,requestedSplice:screenSpliceChanges(model,seq,[{gp,nb:alt}]),
    recommendation:selected.changes.length
      ? 'Provisional re-cutting recommendation only; splice effects remain unassessed. Review added changes before use.'
      : baselineProtection.tier==='strong'?'The requested edit already provides strong predicted re-cutting protection; no extra bases needed.'
      : policy==='none'?'Requested-edit-only policy selected; no blocking changes added.'
      : 'No permitted blocking alternative was preferred. Retain the requested edit and review re-cutting risk.',
  };
}
