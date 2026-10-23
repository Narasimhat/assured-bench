// Sequence export is independent of biological release approval.
export function buildGenomicSequenceCsv(result, { selectedNames = [], acknowledged = false, note = '', reviewedAt = '' } = {}) {
  if (!result || result.err) throw Error('Generate a valid design first.');
  const selected = result.candidates.filter(c => selectedNames.includes(c.name));
  if (!selected.length) throw Error('Select at least one guide/donor pair.');
  const cell = value => {
    const text = String(value ?? '');
    return '"' + (/^[=+@-]/.test(text) ? "'" + text : text).replace(/"/g,'""') + '"';
  };
  const header = ['Name','Type','Sequence 5-prime to 3-prime','Length nt','Matched pair','PAM (not part of spacer)','Strand','Protection','Residual CFD','Design status','Review acknowledgement','Review note','Review time UTC','Target','Blocking policy','Additional donor changes','Splice screen','Warnings'];
  const target = `${result.input.assembly} chr${result.input.chromosome}:${result.input.position} ${result.input.ref}>${result.input.alt}`;
  const warnings = [...result.blockers,...result.warnings,(result.blocking?.feasible && result.blocking.coDelivery ? 'Co-delivery: both guides and both ssODNs go into the same electroporation; each ssODN carries the same blocking changes.' : 'Alternative pairs; do not pool.') + ' Guide spacers use DNA notation; vendor chemistry and format must be chosen separately.'].join(' | ');
  const rows=[];
  const add=(name,type,seq,pair,pam,strand,protection='',cfd='')=>{
    if(!/^[ACGT]+$/.test(seq || ''))throw Error(`Invalid sequence for ${name}`);
    rows.push([name,type,seq,seq.length,pair,pam,strand,protection,cfd,result.status,acknowledged?'User acknowledged limitations; proceeding after review':'Draft; not reviewed',note,acknowledged?reviewedAt:'',target,result.input.blockingPolicy || 'none',
      (result.candidates.find(c=>c.name===pair)?.blockingChanges || []).map(m=>`${result.input.referenceStart+m.gp} ${result.gb.genomicSequence[m.gp]}>${m.nb} (${m.mt==='silent'?'synonymous coding':'noncoding'})`).join('; '),
      result.candidates.find(c=>c.name===pair)?.spliceAssessment?.risk || 'unassessed',warnings]);
  };
  for(const c of selected){
    if(!c.nucleotideValidation?.valid)throw Error(`Donor validation failed for ${c.name}`);
    add(c.name,'Guide spacer',c.sp,c.name,c.pam,c.str,c.protection.tier,c.protection.cfd);
    add(`${c.name}_ssODN`,'ssODN',c.donor.od,c.name,'',c.str==='+'?'-':'+',c.protection.tier,c.protection.cfd);
  }
  const p=result.primers[0];
  if(p){add('PCR_Fw','Primer',p.forward.s,'Primary PCR pair','','+');add('PCR_Rev','Primer',p.reverse.s,'Primary PCR pair','','-');}
  return '\ufeff'+[header,...rows].map(row=>row.map(cell).join(',')).join('\r\n');
}
