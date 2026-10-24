import { BLOCKING_POLICIES, buildBlockingComparison, isTwoGuidePolicy } from './genomicBlocking.js';
import { buildPairDesign, pairSectionHtml } from './pairBlocking.js';
import { buildReportHtml } from './reportHtml.js';
import { parseGB, mkODN, assessGuideAgainstPointMutationDonor, assessGuideSequence, designCenteredPrimerPairs, buildPrimerRecord, summarizePrimerPairQuality } from './designEngine.js';
import { normalizeGenBankToTranscriptModel, findSpCas9Guides } from './transcriptModel.js';
import { complementBase, genomicAt, genomicSpan, indexOfGenomic, isReverse } from './genomicCoords.js';
import { getEnzyme } from './enzymeConfig.js';
import { findConfiguredModelGuides, guideGeometry } from './enzymeModelGuides.js';

const rc = (s) => s.split('').reverse().map(b => ({ A:'T', T:'A', C:'G', G:'C', N:'N' }[b] || 'N')).join('');
const chromosome = (s) => String(s || '').replace(/^chr/i, '');
export function readGenomicReferenceMetadata(raw) {
  const m = String(raw).match(/Location:\s*chromosome:([^:\s]+):([^:\s]+):(\d+):(\d+):(-?1)\b/i);
  return m ? { assembly:m[1], chromosome:m[2], start:Number(m[3]), end:Number(m[4]), orientation:Number(m[5]) } : null;
}

/** Exact single-nucleotide substitution; no extra blocking edits, codon conversion or inferred assembly. */
export function designGenomicSnp(raw, input) {
  try {
    const enzyme=getEnzyme(input.enzyme || 'spcas9');
    const policy=input.blockingPolicy || 'none';
    if(!BLOCKING_POLICIES[policy])throw Error('Unknown blocking-change policy.');
    const maxChanges=Number(input.maxBlockingChanges ?? (isTwoGuidePolicy(policy) ? 3 : 2));
    if(!Number.isInteger(maxChanges) || maxChanges<1 || maxChanges>3)throw Error('Choose 1, 2 or 3 additional blocking changes.');
    const record = parseGB(raw);
    if (!record.seq || !/^[ACGTN]+$/.test(record.seq)) throw Error('Upload a GenBank reference with an A/C/G/T/N genomic sequence.');
    const meta = readGenomicReferenceMetadata(raw);
    const start = Number(input.referenceStart), position = Number(input.position);
    // The alleles and the position are forward-strand genomic values, as ClinVar and VCF give them.
    const forwardRef = String(input.ref || '').toUpperCase(), forwardAlt = String(input.alt || '').toUpperCase();
    if (!input.assembly?.trim() || !input.chromosome?.trim()) throw Error('Specify the genome assembly and chromosome.');
    if (!Number.isSafeInteger(start) || start < 1 || !Number.isSafeInteger(position) || position < 1) throw Error('Coordinates must be positive, 1-based integers.');
    if (!/^[ACGT]$/.test(forwardRef) || !/^[ACGT]$/.test(forwardAlt) || forwardRef === forwardAlt) throw Error('Enter different single reference and alternate bases (A, C, G or T).');
    // A record of a reverse-strand gene is written along the transcript (Location ...:-1); its coordinates are mapped from the Location annotation.
    let orientation = 1;
    if (meta) {
      if (meta.assembly !== input.assembly.trim() || chromosome(meta.chromosome) !== chromosome(input.chromosome) || meta.start !== start) throw Error('Assembly, chromosome or reference start conflicts with the GenBank Location annotation.');
      if (meta.end - meta.start + 1 !== record.seq.length) throw Error('The annotated genomic interval does not match the reference sequence length.');
      orientation = meta.orientation === -1 ? -1 : 1;
    } else if (!input.forwardConfirmed) throw Error('Confirm that the reference sequence is in forward genomic orientation.');
    const end = start + record.seq.length - 1;
    const frame = { referenceStart: start, referenceEnd: end, orientation };
    if (position < start || position > end) throw Error('The requested position lies outside this reference.');
    const gp = indexOfGenomic(frame, position);
    // Inside the designers the alleles are read as the record reads them: the transcript strand for a reverse record.
    const ref = isReverse(frame) ? complementBase(forwardRef) : forwardRef, alt = isReverse(frame) ? complementBase(forwardAlt) : forwardAlt;
    if (record.seq[gp] !== ref) throw Error(`Reference mismatch at ${position}: requested ${forwardRef}, but the uploaded sequence contains ${isReverse(frame) ? complementBase(record.seq[gp]) : record.seq[gp]}${isReverse(frame) ? ' on the forward strand' : ''}.`);
    const normalized = normalizeGenBankToTranscriptModel(record, { expectedGene: input.gene || '' });
    const issues = normalized?.referenceIssues || [];
    const fatalIssues = issues.filter(i => ['error','blocker'].includes(i.severity));
    if (fatalIssues.length) throw Error(fatalIssues.map(i => i.message).join(' '));
    // Genomic SNVs do not require a CDS. An annotation-free model must not invent one.
    const model = normalized || { genomicSequence:record.seq, cdsSegments:[], exons:[], rawFeatures:record.feats, gene:input.gene || 'Locus' };
    const guides = (enzyme.id==='spcas9'?findSpCas9Guides(model, rc, gp, 30):findConfiguredModelGuides(model,gp,30,{enzyme:enzyme.id,spacerLength:input.spacerLength})).sort((a,b) => Math.abs(a.d)-Math.abs(b.d));
    const exactCandidates = guides.map((guide,index) => {
      const donor = mkODN(model,guide,[gp],[alt],[],null);
      if (!donor) throw Error('The reference is too short to construct a complete 127-nt donor. Supply more flanking sequence.');
      const wt = record.seq.slice(donor.donorStart, donor.donorEnd);
      const differences = [...wt].flatMap((b,i) => b !== donor.genomicDonor[i] ? [donor.donorStart+i] : []);
      if (differences.length !== 1 || differences[0] !== gp || donor.genomicDonor[gp-donor.donorStart] !== alt) throw Error('Donor validation failed: the final allele does not contain exactly the requested substitution.');
      if (donor.od !== (guide.str === '+' ? rc(donor.genomicDonor) : donor.genomicDonor)) throw Error('Donor strand validation failed.');
      const comparison=buildBlockingComparison(model,guide,gp,alt,isTwoGuidePolicy(policy)?'none':policy,maxChanges);
      const chosen=comparison.selected;
      const additionalChanges=chosen.changes.length;
      return { name:`gRNA${index+1}`, ...guide, interval:(([low,high])=>({ start:low,end:high }))(genomicSpan(frame,guide.ps,guideGeometry(guide).end-1)), qc:assessGuideSequence(guide.sp,input.deliveryMethod || 'rnp',enzyme.id), donor:chosen.donor, protection:chosen.protection, blockingChanges:chosen.changes, comparison, spliceAssessment:chosen.splice, nucleotideValidation:{ valid:true, differences:1+additionalChanges, additionalChanges } };
    });
    const pair = isTwoGuidePolicy(policy) ? buildPairDesign({ model, seq:record.seq, exactCandidates, gp, ref, alt, start, frame, shared:policy==='pair', maxChanges, pinned:Array.isArray(input.guideSpacers) ? input.guideSpacers : null }) : null;
    const candidates = pair ? pair.candidates : exactCandidates;
    const primers = designCenteredPrimerPairs(record.seq,gp,{ minAmp:400,maxAmp:700,desiredAmp:500 }).slice(0,3).map((p,index)=>({ rank:index+1,ampliconLength:p.amp,forward:buildPrimerRecord('Fw',p.fw.seq),reverse:buildPrimerRecord('Rev',p.rev.seq),quality:p.quality || summarizePrimerPairQuality(p.fw.seq,p.rev.seq) }));
    const boundaries = (model.exons || []).flatMap(exon => [
      { label:exon.label || `Exon ${exon.exonNumber || ''}`,edge:'start',distance:gp-exon.start },
      { label:exon.label || `Exon ${exon.exonNumber || ''}`,edge:'last exon base',distance:gp-(exon.end-1) },
    ]).sort((a,b)=>Math.abs(a.distance)-Math.abs(b.distance));
    const warnings = [
      ...(enzyme.id!=='spcas9'?[`${enzyme.name}: canonical-PAM sequence checks replace SpCas9 CFD. Residual activity, noncanonical PAMs and mismatch tolerance are uncalibrated; no numeric CFD is assigned.`]:[]),
      ...issues.map(i=>i.message),
      ...(!normalized ? ['No usable CDS annotation. Coding and splice context have not been established.'] : []),
      ...(!meta ? ['Genomic mapping is user-supplied; no Location annotation was available to verify it.'] : []),
      ...(isReverse(frame) ? [`The reference is written along the transcript (reverse-strand gene): guide and donor strands (+/−), primers and cut offsets are relative to the transcript direction, while positions and alleles are shown on the forward genomic strand.`] : []),
      'Genome-wide guide and primer specificity are not checked.',
      ...(pair ? [pair.warnings.lead[0]] : [candidates.some(c=>c.blockingChanges.length) ? 'Permitted blocking substitutions were added. Noncoding changes are not silent. Splice effects remain unassessed; review the allele comparison.' : 'No additional blocking substitutions were added. Review each guide against its matched repaired allele.']),
      ...(pair && pair.feasible ? [] : ['Local splice screening compares WT to requested edit, then requested edit to final donor; it is not a splice-strength prediction.']),
      pair ? pair.warnings.lead[1] : 'Splicing and protein outcomes are not predicted. An unchanged annotated CDS does not validate mature RNA or protein.',
      ...(pair ? pair.warnings.trail : ['Alternative guides and donors are separate candidates; do not pool them.']),
      ...(!input.cellLine ? ['Cell line and parental genotype are unspecified.'] : ['Parental sequence must be confirmed; specifying a cell line is not WGS validation.']),
    ];
    const blockers = !candidates.length ? [`No ${enzyme.name} ${enzyme.pam_pattern} guides passed the native sequence filters within 30 bp.`]
      : pair && pair.feasible ? (pair.pairStrong ? [] : ['The selected guide pair is not strongly protected on the repaired allele.'])
      : candidates.every(c=>c.protection.tier!=='strong') ? [pair ? `No blocking set was found (${pair.blocking.reason}) and no candidate has strong predicted re-cutting protection from the requested edit alone.` : policy==='none'?'No candidate has strong predicted re-cutting protection from the requested edit alone.':'No candidate has strong predicted re-cutting protection under the selected blocking policy.'] : [];
    return { type:'genomic-snv',...(enzyme.id!=='spcas9'?{enzyme}:{}),status:blockers.length?'BLOCKED':'REVIEW REQUIRED',blockers,warnings,input:{ ...input,blockingPolicy:policy,maxBlockingChanges:maxChanges,ref:forwardRef,alt:forwardAlt,position,referenceStart:start,referenceEnd:end,orientation },...(pair ? { blocking:pair.blocking,splice:pair.splice,recommendation:pair.recommendation } : {}),gb:{genomicSequence:record.seq,exons:model.exons,cdsSegments:model.cdsSegments,transcriptId:model.transcriptId},reference:{ length:record.seq.length,metadata:meta,issues },context:{ before:record.seq.slice(Math.max(0,gp-20),gp),ref,alt,after:record.seq.slice(gp+1,gp+21),nearestExonBoundary:boundaries[0] || null },candidates,primers };
  } catch (error) { return { err:error.message }; }
}

const escape = (s) => String(s ?? '').replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
export function buildGenomicSnpReport(r) {
  if (!r || r.err) throw Error('A validated nucleotide design is required for a report.');
  // Adapt nucleotide results to the shared report model; never pretend this is a protein edit.
  const clean = value => typeof value === 'string' ? escape(value) : Array.isArray(value) ? value.map(clean) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clean(v)])) : value;
  const safe = clean(r);
  const result = {
    ...safe, gene:safe.input.gene || 'Locus', gp:indexOfGenomic(r.input,r.input.position),
    deliveryMethod:r.input.deliveryMethod,
    gs:safe.candidates.map(c=>({...c,n:c.name,pm:c.pam,note:`chr${safe.input.chromosome}:${c.interval.start}–${c.interval.end}; cut offset ${c.d} bp; ${c.protection.tier} protection; residual CFD ${c.protection.cfd?.toFixed(4) ?? 'unscored'}`})),
    os:safe.candidates.map(c=>({...c.donor,n:`ssODN matched to ${c.name}`,guideName:c.name,guideStrand:c.str,nucleotideValidation:c.nucleotideValidation,guideProtection:c.crossProtection || [{guideName:c.name,...c.protection}]})),
    ps:safe.primers.length ? [safe.primers[0].forward,safe.primers[0].reverse] : [],
    primerCandidates:safe.primers,
    amp:safe.primers.length ? `${safe.primers[0].ampliconLength} bp (WT and edited)` : '',
    primerStrategy:'Genomic PCR; RNA validation must separately establish splice effects.',
    guideSequenceQc:safe.candidates.map(c=>({...c.qc,guideName:c.name})),
    extraSectionHtml:pairSectionHtml(r),
  };
  return buildReportHtml({...safe.input,projectType:'genomic-snv',notes:`${BLOCKING_POLICIES[r.input.blockingPolicy || 'none']}. Guides are listed by cut distance. ${r.enzyme ? 'Canonical-PAM checks assess the repaired allele; residual activity is unscored for this enzyme. No SpCas9 CFD is applied.' : 'Residual CFD estimates activity against the repaired allele, not genome-wide specificity or editing probability.'}`},result,safe.input.fileName,null,safe.warnings.map(text=>({level:'warning',text})));
}
