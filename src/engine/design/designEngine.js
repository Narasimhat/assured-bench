import { calculateCfd } from "./cfd.js";
import { getCodonFraction, introducesRareCodon } from "./codonUsage.js";
import {
  codingPosToGenomic,
  describeGuidePlacementFromModel,
  describeKoGenomicContextFromModel,
  extractCodingDonorWindowFromModel,
  findKoDesignTargetFromModel,
  findSpCas9Guides,
  genomicPosToAa,
  getFeatureCount,
  getCdsFromModel,
  getCodonAtAa,
  getGenomicSequence,
  normalizeGenBankToTranscriptModel,
  normalizeRawSequenceToTranscriptModel,
  selectNearbyGuidesForModel,
} from "./transcriptModel.js";
import { MINIMUM_ALTERNATIVE_CUT_OFFSET, pickGuidePair, pickPartnerGuide } from "./guideSelection.js";
import { classifyPosition, inSpliceWindow } from "./spliceZones.js";
import { buildDonorFormatReport, planDonorArms } from "./donorFormat.js";
import { describeGuideUse } from "./guideUse.js";

const CODON_TABLE = {
  TTT: "F", TTC: "F", TTA: "L", TTG: "L", CTT: "L", CTC: "L", CTA: "L", CTG: "L",
  ATT: "I", ATC: "I", ATA: "I", ATG: "M", GTT: "V", GTC: "V", GTA: "V", GTG: "V",
  TCT: "S", TCC: "S", TCA: "S", TCG: "S", CCT: "P", CCC: "P", CCA: "P", CCG: "P",
  ACT: "T", ACC: "T", ACA: "T", ACG: "T", GCT: "A", GCC: "A", GCA: "A", GCG: "A",
  TAT: "Y", TAC: "Y", TAA: "*", TAG: "*", CAT: "H", CAC: "H", CAA: "Q", CAG: "Q",
  AAT: "N", AAC: "N", AAA: "K", AAG: "K", GAT: "D", GAC: "D", GAA: "E", GAG: "E",
  TGA: "*", TGT: "C", TGC: "C", TGG: "W", CGT: "R", CGC: "R", CGA: "R", CGG: "R",
  AGT: "S", AGC: "S", AGA: "R", AGG: "R", GGT: "G", GGC: "G", GGA: "G", GGG: "G",
};

const DNA_COMPLEMENT = { A: "T", T: "A", G: "C", C: "G" };

export const REPORTERS = {
  EGFP: {
    dna: "ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTACGGCAAGCTGACCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACCCTCGTGACCACCCTGACCTACGGCGTGCAGTGCTTCAGCCGCTACCCCGACCACATGAAGCAGCACGACTTCTTCAAGTCCGCCATGCCCGAAGGCTACGTCCAGGAGCGCACCATCTTCTTCAAGGACGACGGCAACTACAAGACCCGCGCCGAGGTGAAGTTCGAGGGCGACACCCTGGTGAACCGCATCGAGCTGAAGGGCATCGACTTCAAGGAGGACGGCAACATCCTGGGGCACAAGCTGGAGTACAACTACAACAGCCACAACGTCTATATCATGGCCGACAAGCAGAAGAACGGCATCAAGGTGAACTTCAAGATCCGCCACAACATCGAGGACGGCAGCGTGCAGCTCGCCGACCACTACCAGCAGAACACCCCCATCGGCGACGGCCCCGTGCTGCTGCCCGACAACCACTACCTGAGCACCCAGTCCGCCCTGAGCAAAGACCCCAACGAGAAGCGCGATCACATGGTCCTGCTGGAGTTCGTGACCGCCGCCGGGATCACTCTCGGCATGGACGAGCTGTACAAG",
    aa: "MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTLTYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFKDDGNYKTRAEVKFEGDTLVNRIELKGIDFKEDGNILGHKLEYNYNSHNVYIMADKQKNGIKVNFKIRHNIEDGSVQLADHYQQNTPIGDGPVLLPDNHYLSTQSALSKDPNEKRDHMVLLEFVTAAGITLGMDELYK",
    sourceLabel: "FPbase EGFP",
    sourceUrl: "https://www.fpbase.org/protein/egfp/",
  },
  mCherry: {
    dna: "ATGGTGAGCAAGGGCGAGGAGGACAACATGGCCATCATCAAGGAGTTCATGCGCTTCAAGGTGCACATGGAGGGCAGCGTGAACGGCCACGAGTTCGAGATCGAGGGCGAGGGCGAGGGCCGCCCCTACGAGGGCACCCAGACCGCCAAGCTGAAGGTGACCAAGGGCGGCCCCCTGCCCTTCGCCTGGGACATCCTGAGCCCCCAGTTCATGTACGGCAGCAAGGCCTACGTGAAGCACCCCGCCGACATCCCCGACTACCTGAAGCTGAGCTTCCCCGAGGGCTTCAAGTGGGAGCGCGTGATGAACTTCGAGGACGGCGGCGTGGTGACCGTGACCCAGGACAGCAGCCTGCAGGACGGCGAGTTCATCTACAAGGTGAAGCTGCGCGGCACCAACTTCCCCAGCGACGGCCCCGTGATGCAGAAGAAGACCATGGGCTGGGAGGCCAGCAGCGAGCGCATGTACCCCGAGGACGGCGCCCTGAAGGGCGAGATCAAGCAGCGCCTGAAGCTGAAGGACGGCGGCCACTACGACGCCGAGGTGAAGACCACCTACAAGGCCAAGAAGCCCGTGCAGCTGCCCGGCGCCTACAACGTGAACATCAAGCTGGACATCACCAGCCACAACGAGGACTACACCATCGTGGAGCAGTACGAGCGCGCCGAGGGCCGCCACAGCACCGGCGGCATGGACGAGCTGTACAAG",
    aa: "MVSKGEEDNMAIIKEFMRFKVHMEGSVNGHEFEIEGEGEGRPYEGTQTAKLKVTKGGPLPFAWDILSPQFMYGSKAYVKHPADIPDYLKLSFPEGFKWERVMNFEDGGVVTVTQDSSLQDGEFIYKVKLRGTNFPSDGPVMQKKTMGWEASSERMYPEDGALKGEIKQRLKLKDGGHYDAEVKTTYKAKKPVQLPGAYNVNIKLDITSHNEDYTIVEQYERAEGRHSTGGMDELYK",
    sourceLabel: "FPbase mCherry",
    sourceUrl: "https://www.fpbase.org/protein/mcherry/",
  },
  mScarlet: {
    dna: "ATGGTGAGCAAGGGCGAGGCCGTGATCAAGGAGTTCATGCGCTTCAAGGTGCACATGGAGGGCAGCATGAACGGCCACGAGTTCGAGATCGAGGGCGAGGGCGAGGGCCGCCCCTACGAGGGCACCCAGACCGCCAAGCTGAAGGTGACCAAGGGCGGCCCCCTGCCCTTCAGCTGGGACATCCTGAGCCCCCAGTTCATGTACGGCAGCCGCGCCTTCACCAAGCACCCCGCCGACATCCCCGACTACTACAAGCAGAGCTTCCCCGAGGGCTTCAAGTGGGAGCGCGTGATGAACTTCGAGGACGGCGGCGCCGTGACCGTGACCCAGGACACCAGCCTGGAGGACGGCACCCTGATCTACAAGGTGAAGCTGCGCGGCACCAACTTCCCCCCCGACGGCCCCGTGATGCAGAAGAAGACCATGGGCTGGGAGGCCAGCACCGAGCGCCTGTACCCCGAGGACGGCGTGCTGAAGGGCGACATCAAGATGGCCCTGCGCCTGAAGGACGGCGGCCGCTACCTGGCCGACTTCAAGACCACCTACAAGGCCAAGAAGCCCGTGCAGATGCCCGGCGCCTACAACGTGGACCGCAAGCTGGACATCACCAGCCACAACGAGGACTACACCGTGGTGGAGCAGTACGAGCGCAGCGAGGGCCGCCACAGCACCGGCGGCATGGACGAGCTGTACAAG",
    aa: "MVSKGEAVIKEFMRFKVHMEGSMNGHEFEIEGEGEGRPYEGTQTAKLKVTKGGPLPFSWDILSPQFMYGSRAFTKHPADIPDYYKQSFPEGFKWERVMNFEDGGAVTVTQDTSLEDGTLIYKVKLRGTNFPPDGPVMQKKTMGWEASTERLYPEDGVLKGDIKMALRLKDGGRYLADFKTTYKAKKPVQMPGAYNVDRKLDITSHNEDYTVVEQYERSEGRHSTGGMDELYK",
    sourceLabel: "FPbase mScarlet",
    sourceUrl: "https://www.fpbase.org/protein/mscarlet/",
  },
  mScarlet_I3: {
    dna: "ATGGATAGCACCGAGGCAGTGATCAAGGAGTTCATGCGGTTCAAGGTGCACATGGAGGGCTCCATGAACGGCCACGAGTTCGAGATCGAGGGCGAGGGCGAGGGCCGCCCCTACGAGGGCACCCAGACCGCCAAGCTGAAGGTGACCAAGGGTGGCCCCCTGCCCTTCTCCTGGGACATCCTGTCCCCTCAGTTCATGTACGGCTCCAGGGCCTTCATCAAGCACCCCGCCGACATCCCCGACTACTGGAAGCAGTCCTTCCCCGAGGGCTTCAAGTGGGAGCGCGTGATGATCTTCGAGGACGGCGGCACCGTGTCCGTGACCCAGGACACCTCCCTGGAGGACGGCACCCTGATCTACAAGGTGAAGCTCCGCGGCGGCAACTTCCCTCCTGACGGCCCCGTAATGCAGAAGAGGACAATGGGCTGGGAAGCATCCACCGAGCGGTTGTACCCCGAGGACGTCGTGCTGAAGGGCGACATTAAGATGGCCCTGCGCCTGAAGGACGGCGGCCGCTACCTGGCGGACTTCAAGACCACCTACAAGGCCAAGAAGCCCGTGCAGATGCCCGGCGCCTTCAACATCGACCGCAAGTTGGACATCACCTCCCACAACGAGGACTACACCGTGGTGGAACAGTACGAACGCTCCGTGGCCCGCCACTCCACCGGCGGCTCCGGTGGCTCC",
    aa: "MDSTEAVIKEFMRFKVHMEGSMNGHEFEIEGEGEGRPYEGTQTAKLKVTKGGPLPFSWDILSPQFMYGSRAFIKHPADIPDYWKQSFPEGFKWERVMIFEDGGTVSVTQDTSLEDGTLIYKVKLRGGNFPPDGPVMQKRTMGWEASTERLYPEDVVLKGDIKMALRLKDGGRYLADFKTTYKAKKPVQMPGAFNIDRKLDITSHNEDYTVVEQYERSVARHSTGGSGGS",
    sourceLabel: "FPbase mScarlet-I3",
    sourceUrl: "https://www.fpbase.org/protein/mscarlet-i3/",
  },
  mStayGold2: {
    dna: "ATGGTGAGCACCGGCGAGGAGCTGTTCACCGGCGTGGTGCCCTTCAAGTTCCAGCTGAAGGGCACCATCAACGGCAAGAGCTTCACCGTGGAGGGCGAGGGCGAGGGCAACAGCCACGAGGGCAGCCACAAGGGCAAGTACGTGTGCACCAGCGGCAAGCTGCCCATGAGCTGGGCCGCCCTGGGCACCAGCTTCGGCTACGGCATGAAGTACTACACCAAGTACCCCAGCGGCCTGAAGAACTGGTTCCACGAGGTGATGCCCGAGGGCTTCACCTACGACCGCCACATCCAGTACAAGGGCGACGGCAGCATCCACGCCAAGCACCAGCACTTCATGAAGAACGGCACCTACCACAACATCGTGGAGTTCACCGGCCAGGACTTCAAGGAGAACAGCCCCGTGCTGACCGGCGACATGGACGTGAGCCTGCCCAACGAGGTGCAGCACATCCCCCGCGACGACGGCGTGGAGTGCACCGTGACCCTGACCTACCCCCTGCTGAGCGACGAGAGCAAGTGCGTGGAGGCCTACCAGAACACCATCATCAAGCCCCTGCACAACCAGCCCGCCCCCGACGTGCCCTACCACTGGATCCGCAAGCAGTACACCCAGAGCAAGGACGACACCGAGGAGCGCGACCACATCATCCAGAGCGAGACCCTGGAGGCCCACCTGTACAGCCGCACCAAGCTGGAG",
    aa: "MVSTGEELFTGVVPFKFQLKGTINGKSFTVEGEGEGNSHEGSHKGKYVCTSGKLPMSWAALGTSFGYGMKYYTKYPSGLKNWFHEVMPEGFTYDRHIQYKGDGSIHAKHQHFMKNGTYHNIVEFTGQDFKENSPVLTGDMDVSLPNEVQHIPRDDGVECTVTLTYPLLSDESKCVEAYQNTIIKPLHNQPAPDVPYHWIRKQYTQSKDDTEERDHIIQSETLEAHLYSRTKLE",
    sourceLabel: "FPbase mStayGold2",
    sourceUrl: "https://www.fpbase.org/protein/mstaygold2/",
  },
};

const REPORTER_PROTEIN_REFERENCES = Object.fromEntries(
  Object.entries(REPORTERS).map(([name, reporter]) => [name, {
    label: reporter.sourceLabel,
    aa: reporter.aa,
    sourceUrl: reporter.sourceUrl,
  }]),
);

const PEPTIDE_INSERTS = {
  P2A: "GCAACAAACTTCTCTCTGCTGAAACAAGCCGGAGATGTCGAAGAGAATCCTGGACCG",
  T2A: "GAGGGCAGAGGAAGTCTTCTAACATGCGGCGACGTGGAGGAAAATCCCGGCCCC",
};

export const CASSETTES = {
  "2xHA-only": { seq: "GCAGCTAAAGCCAAAAACAACCAGGGATCCGGAGGCGGCTACCCCTACGACGTGCCCGACTACGCCGGCTATCCGTATGATGTCCCGGACTATTAA", len: 93, pos: "C-term" },
  "N:2xHA-dTAG-Linker": { seq: "GGCGGCTACCCCTACGACGTGCCCGACTACGCCGGCTATCCGTATGATGTCCCGGACTATGCAGGAGTGCAGGTGGAAACCATCTCCCCAGGAGACGGGCGCACCTTCCCCAAGCGCGGCCAGACCTGCGTGGTGCACTACACCGGGATGCTTGAAGATGGAAAGAAAGTTGATTCCTCCCGGGACAGAAACAAGCCCTTTAAGTTTATGCTAGGCAAGCAGGAGGTGATCCGAGGCTGGGAAGAAGGGGTTGCCCAGATGAGTGTGGGTCAGAGAGCCAAACTGACTATATCTCCAGATTATGCCTATGGTGCCACTGGGCACCCAGGCATCATCCCACCACATGCCACTCTCGTCTTCGATGTGGAGCTTCTAAAACTGGAAGCAGCTAAAGCCAAAAACAACCAGGGATCCGGA", len: 414, pos: "N-term" },
  "N:EGFP-Linker": { seq: "ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTACGGCAAGCTGACCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACCCTCGTGACCACCCTGACCTACGGCGTGCAGTGCTTCAGCCGCTACCCCGACCACATGAAGCAGCACGACTTCTTCAAGTCCGCCATGCCCGAAGGCTACGTCCAGGAGCGCACCATCTTCTTCAAGGACGACGGCAACTACAAGACCCGCGCCGAGGTGAAGTTCGAGGGCGACACCCTGGTGAACCGCATCGAGCTGAAGGGCATCGACTTCAAGGAGGACGGCAACATCCTGGGGCACAAGCTGGAGTACAACTACAACAGCCACAACGTCTATATCATGGCCGACAAGCAGAAGAACGGCATCAAGGTGAACTTCAAGATCCGCCACAACATCGAGGACGGCAGCGTGCAGCTCGCCGACCACTACCAGCAGAACACCCCCATCGGCGACGGCCCCGTGCTGCTGCCCGACAACCACTACCTGAGCACCCAGTCCGCCCTGAGCAAAGACCCCAACGAGAAGCGCGATCACATGGTCCTGCTGGAGTTCGTGACCGCCGCCGGGATCACTCTCGGCATGGACGAGCTGTACAAGGCAGCTAAAGCCAAAAACAACCAGGGATCCGGA", len: 747, pos: "N-term" },
  "N:mStayGold2-Linker": { seq: "ATGGTGAGCACCGGCGAGGAGCTGTTCACCGGCGTGGTGCCCTTCAAGTTCCAGCTGAAGGGCACCATCAACGGCAAGAGCTTCACCGTGGAGGGCGAGGGCGAGGGCAACAGCCACGAGGGCAGCCACAAGGGCAAGTACGTGTGCACCAGCGGCAAGCTGCCCATGAGCTGGGCCGCCCTGGGCACCAGCTTCGGCTACGGCATGAAGTACTACACCAAGTACCCCAGCGGCCTGAAGAACTGGTTCCACGAGGTGATGCCCGAGGGCTTCACCTACGACCGCCACATCCAGTACAAGGGCGACGGCAGCATCCACGCCAAGCACCAGCACTTCATGAAGAACGGCACCTACCACAACATCGTGGAGTTCACCGGCCAGGACTTCAAGGAGAACAGCCCCGTGCTGACCGGCGACATGGACGTGAGCCTGCCCAACGAGGTGCAGCACATCCCCCGCGACGACGGCGTGGAGTGCACCGTGACCCTGACCTACCCCCTGCTGAGCGACGAGAGCAAGTGCGTGGAGGCCTACCAGAACACCATCATCAAGCCCCTGCACAACCAGCCCGCCCCCGACGTGCCCTACCACTGGATCCGCAAGCAGTACACCCAGAGCAAGGACGACACCGAGGAGCGCGACCACATCATCCAGAGCGAGACCCTGGAGGCCCACCTGTACAGCCGCACCAAGCTGGAGGCAGCTAAAGCCAAAAACAACCAGGGATCCGGA", len: 732, pos: "N-term" },
  "N:SD40-Linker": { seq: "CTGTTGCTGTTCTGCCCTATTTGCGGGTTTACATGTCGCCAGAAGGGCAACTTACTTCGCCATATTAACCTGCACACAGGGGAAAAGTTATTTAAGTACCACCTGTATGCAGCTAAAGCCAAAAACAACCAGGGATCCGGA", len: 138, pos: "N-term" },
  "N:dTAG-Linker": { seq: "GGAGTGCAGGTGGAAACCATCTCCCCAGGAGACGGGCGCACCTTCCCCAAGCGCGGCCAGACCTGCGTGGTGCACTACACCGGGATGCTTGAAGATGGAAAGAAAGTTGATTCCTCCCGGGACAGAAACAAGCCCTTTAAGTTTATGCTAGGCAAGCAGGAGGTGATCCGAGGCTGGGAAGAAGGGGTTGCCCAGATGAGTGTGGGTCAGAGAGCCAAACTGACTATATCTCCAGATTATGCCTATGGTGCCACTGGGCACCCAGGCATCATCCCACCACATGCCACTCTCGTCTTCGATGTGGAGCTTCTAAAACTGGAAGCAGCTAAAGCCAAAAACAACCAGGGATCCGGA", len: 351, pos: "N-term" },
  "N:mAID-Linker": { seq: "AAGGAGAAGAGTGCTTGTCCTAAAGATCCAGCCAAACCTCCGGCCAAGGCACAAGTTGTGGGATGGCCACCGGTGAGATCATACCGGAAGAACGTGATGGTTTCCTGCCAAAAATCAAGCGGTGGCCCGGAGGCGGCGGCGTTCGTGAAGGTATCAATGGACGGAGCACCGTACTTGAGGAAAATCGATTTGAGGATGTATAAAGCAGCTAAAGCCAAAAACAACCAGGGATCCGGA", len: 234, pos: "N-term" },
  "P2A-mCherry": { seq: "GCAACAAACTTCTCTCTGCTGAAACAAGCCGGAGATGTCGAAGAGAATCCTGGACCGGTGAGCAAGGGCGAGGAGGATAACATGGCCATCATCAAGGAGTTCATGCGCTTCAAGGTGCACATGGAGGGCTCCGTGAACGGCCACGAGTTCGAGATCGAGGGCGAGGGCGAGGGCCGCCCCTACGAGGGCACCCAGACCGCCAAGCTGAAGGTGACCAAGGGTGGCCCCCTGCCCTTCGCCTGGGACATCCTGTCCCCTCAGTTCATGTACGGCTCCAAGGCCTACGTGAAGCACCCCGCCGACATCCCCGACTACTTGAAGCTGTCCTTCCCCGAGGGCTTCAAGTGGGAGCGCGTGATGAACTTCGAGGACGGCGGCGTGGTGACCGTGACCCAGGACTCCTCCCTGCAGGACGGCGAGTTCATCTACAAGGTGAAGCTGCGCGGCACCAACTTCCCCTCCGACGGCCCCGTAATGCAGAAGAAAACCATGGGCTGGGAGGCCTCCTCCGAGCGGATGTACCCCGAGGACGGCGCCCTGAAGGGCGAGATCAAGCAGAGGCTGAAGCTGAAGGACGGCGGCCACTACGACGCTGAGGTCAAGACCACCTACAAGGCCAAGAAGCCCGTGCAGCTGCCCGGCGCCTACAACGTCAACATCAAGTTGGACATCACCTCCCACAACGAGGACTACACCATCGTGGAACAGTACGAACGCGCCGAGGGCCGCCACTCCACCGGCGGCATGGACGAGCTGTACAAGTAATAATAA", len: 771, pos: "C-term" },
  "P2A-mScarlet": { seq: "GCAACAAACTTCTCTCTGCTGAAACAAGCCGGAGATGTCGAAGAGAATCCTGGACCGATGGTGAGCAAGGGCGAGGCCGTGATCAAGGAGTTCATGCGCTTCAAGGTGCACATGGAGGGCAGCATGAACGGCCACGAGTTCGAGATCGAGGGCGAGGGCGAGGGCCGCCCCTACGAGGGCACCCAGACCGCCAAGCTGAAGGTGACCAAGGGCGGCCCCCTGCCCTTCAGCTGGGACATCCTGAGCCCCCAGTTCATGTACGGCAGCCGCGCCTTCACCAAGCACCCCGCCGACATCCCCGACTACTACAAGCAGAGCTTCCCCGAGGGCTTCAAGTGGGAGCGCGTGATGAACTTCGAGGACGGCGGCGCCGTGACCGTGACCCAGGACACCAGCCTGGAGGACGGCACCCTGATCTACAAGGTGAAGCTGCGCGGCACCAACTTCCCCCCCGACGGCCCCGTGATGCAGAAGAAGACCATGGGCTGGGAGGCCAGCACCGAGCGCCTGTACCCCGAGGACGGCGTGCTGAAGGGCGACATCAAGATGGCCCTGCGCCTGAAGGACGGCGGCCGCTACCTGGCCGACTTCAAGACCACCTACAAGGCCAAGAAGCCCGTGCAGATGCCCGGCGCCTACAACGTGGACCGCAAGCTGGACATCACCAGCCACAACGAGGACTACACCGTGGTGGAGCAGTACGAGCGCAGCGAGGGCCGCCACAGCACCGGCGGCATGGACGAGCTGTACAAGTAA", len: 756, pos: "C-term" },
  "P2A-mStayGold2": { seq: "GCAACAAACTTCTCTCTGCTGAAACAAGCCGGAGATGTCGAAGAGAATCCTGGACCGATGGTGAGCACCGGCGAGGAGCTGTTCACCGGCGTGGTGCCCTTCAAGTTCCAGCTGAAGGGCACCATCAACGGCAAGAGCTTCACCGTGGAGGGCGAGGGCGAGGGCAACAGCCACGAGGGCAGCCACAAGGGCAAGTACGTGTGCACCAGCGGCAAGCTGCCCATGAGCTGGGCCGCCCTGGGCACCAGCTTCGGCTACGGCATGAAGTACTACACCAAGTACCCCAGCGGCCTGAAGAACTGGTTCCACGAGGTGATGCCCGAGGGCTTCACCTACGACCGCCACATCCAGTACAAGGGCGACGGCAGCATCCACGCCAAGCACCAGCACTTCATGAAGAACGGCACCTACCACAACATCGTGGAGTTCACCGGCCAGGACTTCAAGGAGAACAGCCCCGTGCTGACCGGCGACATGGACGTGAGCCTGCCCAACGAGGTGCAGCACATCCCCCGCGACGACGGCGTGGAGTGCACCGTGACCCTGACCTACCCCCTGCTGAGCGACGAGAGCAAGTGCGTGGAGGCCTACCAGAACACCATCATCAAGCCCCTGCACAACCAGCCCGCCCCCGACGTGCCCTACCACTGGATCCGCAAGCAGTACACCCAGAGCAAGGACGACACCGAGGAGCGCGACCACATCATCCAGAGCGAGACCCTGGAGGCCCACCTGTACAGCCGCACCAAGCTGGAGTAA", len: 759, pos: "C-term" },
  "SD40-2xHA": { seq: "GCAGCTAAAGCCAAAAACAACCAGGGATCCGGACTGTTGCTGTTCTGCCCTATTTGCGGGTTTACATGTCGCCAGAAGGGCAACTTACTTCGCCATATTAACCTGCACACAGGGGAAAAGTTATTTAAGTACCACCTGTATGGCGGCTACCCCTACGACGTGCCCGACTACGCCGGCTATCCGTATGATGTCCCGGACTATGCATAA", len: 204, pos: "C-term" },
  "SD40-2xHA-P2A-mCherry": { seq: "GCAGCTAAAGCCAAAAACAACCAGGGATCCGGACTGTTGCTGTTCTGCCCTATTTGCGGGTTTACATGTCGCCAGAAGGGCAACTTACTTCGCCATATTAACCTGCACACAGGGGAAAAGTTATTTAAGTACCACCTGTATGGCGGCTACCCCTACGACGTGCCCGACTACGCCGGCTATCCGTATGATGTCCCGGACTATGCAGCAACAAACTTCTCTCTGCTGAAACAAGCCGGAGATGTCGAAGAGAATCCTGGACCGGTGAGCAAGGGCGAGGAGGATAACATGGCCATCATCAAGGAGTTCATGCGCTTCAAGGTGCACATGGAGGGCTCCGTGAACGGCCACGAGTTCGAGATCGAGGGCGAGGGCGAGGGCCGCCCCTACGAGGGCACCCAGACCGCCAAGCTGAAGGTGACCAAGGGTGGCCCCCTGCCCTTCGCCTGGGACATCCTGTCCCCTCAGTTCATGTACGGCTCCAAGGCCTACGTGAAGCACCCCGCCGACATCCCCGACTACTTGAAGCTGTCCTTCCCCGAGGGCTTCAAGTGGGAGCGCGTGATGAACTTCGAGGACGGCGGCGTGGTGACCGTGACCCAGGACTCCTCCCTGCAGGACGGCGAGTTCATCTACAAGGTGAAGCTGCGCGGCACCAACTTCCCCTCCGACGGCCCCGTAATGCAGAAGAAAACCATGGGCTGGGAGGCCTCCTCCGAGCGGATGTACCCCGAGGACGGCGCCCTGAAGGGCGAGATCAAGCAGAGGCTGAAGCTGAAGGACGGCGGCCACTACGACGCTGAGGTCAAGACCACCTACAAGGCCAAGAAGCCCGTGCAGCTGCCCGGCGCCTACAACGTCAACATCAAGTTGGACATCACCTCCCACAACGAGGACTACACCATCGTGGAACAGTACGAACGCGCCGAGGGCCGCCACTCCACCGGCGGCATGGACGAGCTGTACAAGTAATAATAA", len: 972, pos: "C-term" },
  "T2A-EGFP": { seq: "GAGGGCAGAGGAAGTCTTCTAACATGCGGCGACGTGGAGGAAAATCCCGGCCCCATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTACGGCAAGCTGACCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACCCTCGTGACCACCCTGACCTACGGCGTGCAGTGCTTCAGCCGCTACCCCGACCACATGAAGCAGCACGACTTCTTCAAGTCCGCCATGCCCGAAGGCTACGTCCAGGAGCGCACCATCTTCTTCAAGGACGACGGCAACTACAAGACCCGCGCCGAGGTGAAGTTCGAGGGCGACACCCTGGTGAACCGCATCGAGCTGAAGGGCATCGACTTCAAGGAGGACGGCAACATCCTGGGGCACAAGCTGGAGTACAACTACAACAGCCACAACGTCTATATCATGGCCGACAAGCAGAAGAACGGCATCAAGGTGAACTTCAAGATCCGCCACAACATCGAGGACGGCAGCGTGCAGCTCGCCGACCACTACCAGCAGAACACCCCCATCGGCGACGGCCCCGTGCTGCTGCCCGACAACCACTACCTGAGCACCCAGTCCGCCCTGAGCAAAGACCCCAACGAGAAGCGCGATCACATGGTCCTGCTGGAGTTCGTGACCGCCGCCGGGATCACTCTCGGCATGGACGAGCTGTACAAGTAA", len: 774, pos: "C-term" },
  "T2A-mScarlet_I3": { seq: "GAGGGCAGAGGAAGTCTTCTAACATGCGGCGACGTGGAGGAAAATCCCGGCCCCATGGATAGCACCGAGGCAGTGATCAAGGAGTTCATGCGGTTCAAGGTGCACATGGAGGGCTCCATGAACGGCCACGAGTTCGAGATCGAGGGCGAGGGCGAGGGCCGCCCCTACGAGGGCACCCAGACCGCCAAGCTGAAGGTGACCAAGGGTGGCCCCCTGCCCTTCTCCTGGGACATCCTGTCCCCTCAGTTCATGTACGGCTCCAGGGCCTTCATCAAGCACCCCGCCGACATCCCCGACTACTGGAAGCAGTCCTTCCCCGAGGGCTTCAAGTGGGAGCGCGTGATGATCTTCGAGGACGGCGGCACCGTGTCCGTGACCCAGGACACCTCCCTGGAGGACGGCACCCTGATCTACAAGGTGAAGCTCCGCGGCGGCAACTTCCCTCCTGACGGCCCCGTAATGCAGAAGAGGACAATGGGCTGGGAAGCATCCACCGAGCGGTTGTACCCCGAGGACGTCGTGCTGAAGGGCGACATTAAGATGGCCCTGCGCCTGAAGGACGGCGGCCGCTACCTGGCGGACTTCAAGACCACCTACAAGGCCAAGAAGCCCGTGCAGATGCCCGGCGCCTTCAACATCGACCGCAAGTTGGACATCACCTCCCACAACGAGGACTACACCGTGGTGGAACAGTACGAACGCTCCGTGGCCCGCCACTCCACCGGCGGCTCCGGTGGCTCCTAATAA", len: 744, pos: "C-term" },
  "T2A-mStayGold2": { seq: "GAGGGCAGAGGAAGTCTTCTAACATGCGGCGACGTGGAGGAAAATCCCGGCCCCATGGTGAGCACCGGCGAGGAGCTGTTCACCGGCGTGGTGCCCTTCAAGTTCCAGCTGAAGGGCACCATCAACGGCAAGAGCTTCACCGTGGAGGGCGAGGGCGAGGGCAACAGCCACGAGGGCAGCCACAAGGGCAAGTACGTGTGCACCAGCGGCAAGCTGCCCATGAGCTGGGCCGCCCTGGGCACCAGCTTCGGCTACGGCATGAAGTACTACACCAAGTACCCCAGCGGCCTGAAGAACTGGTTCCACGAGGTGATGCCCGAGGGCTTCACCTACGACCGCCACATCCAGTACAAGGGCGACGGCAGCATCCACGCCAAGCACCAGCACTTCATGAAGAACGGCACCTACCACAACATCGTGGAGTTCACCGGCCAGGACTTCAAGGAGAACAGCCCCGTGCTGACCGGCGACATGGACGTGAGCCTGCCCAACGAGGTGCAGCACATCCCCCGCGACGACGGCGTGGAGTGCACCGTGACCCTGACCTACCCCCTGCTGAGCGACGAGAGCAAGTGCGTGGAGGCCTACCAGAACACCATCATCAAGCCCCTGCACAACCAGCCCGCCCCCGACGTGCCCTACCACTGGATCCGCAAGCAGTACACCCAGAGCAAGGACGACACCGAGGAGCGCGACCACATCATCCAGAGCGAGACCCTGGAGGCCCACCTGTACAGCCGCACCAAGCTGGAGTAA", len: 756, pos: "C-term" },
  "dTAG-2xHA": { seq: "GCAGCTAAAGCCAAAAACAACCAGGGATCCGGAGGAGTGCAGGTGGAAACCATCTCCCCAGGAGACGGGCGCACCTTCCCCAAGCGCGGCCAGACCTGCGTGGTGCACTACACCGGGATGCTTGAAGATGGAAAGAAAGTTGATTCCTCCCGGGACAGAAACAAGCCCTTTAAGTTTATGCTAGGCAAGCAGGAGGTGATCCGAGGCTGGGAAGAAGGGGTTGCCCAGATGAGTGTGGGTCAGAGAGCCAAACTGACTATATCTCCAGATTATGCCTATGGTGCCACTGGGCACCCAGGCATCATCCCACCACATGCCACTCTCGTCTTCGATGTGGAGCTTCTAAAACTGGAAGGCGGCTACCCCTACGACGTGCCCGACTACGCCGGCTATCCGTATGATGTCCCGGACTATGCATAA", len: 417, pos: "C-term" },
  "dTAG-2xHA-P2A-mCherry": { seq: "GCAGCTAAAGCCAAAAACAACCAGGGATCCGGAGGAGTGCAGGTGGAAACCATCTCCCCAGGAGACGGGCGCACCTTCCCCAAGCGCGGCCAGACCTGCGTGGTGCACTACACCGGGATGCTTGAAGATGGAAAGAAAGTTGATTCCTCCCGGGACAGAAACAAGCCCTTTAAGTTTATGCTAGGCAAGCAGGAGGTGATCCGAGGCTGGGAAGAAGGGGTTGCCCAGATGAGTGTGGGTCAGAGAGCCAAACTGACTATATCTCCAGATTATGCCTATGGTGCCACTGGGCACCCAGGCATCATCCCACCACATGCCACTCTCGTCTTCGATGTGGAGCTTCTAAAACTGGAAGGCGGCTACCCCTACGACGTGCCCGACTACGCCGGCTATCCGTATGATGTCCCGGACTATGCAGCAACAAACTTCTCTCTGCTGAAACAAGCCGGAGATGTCGAAGAGAATCCTGGACCGGTGAGCAAGGGCGAGGAGGATAACATGGCCATCATCAAGGAGTTCATGCGCTTCAAGGTGCACATGGAGGGCTCCGTGAACGGCCACGAGTTCGAGATCGAGGGCGAGGGCGAGGGCCGCCCCTACGAGGGCACCCAGACCGCCAAGCTGAAGGTGACCAAGGGTGGCCCCCTGCCCTTCGCCTGGGACATCCTGTCCCCTCAGTTCATGTACGGCTCCAAGGCCTACGTGAAGCACCCCGCCGACATCCCCGACTACTTGAAGCTGTCCTTCCCCGAGGGCTTCAAGTGGGAGCGCGTGATGAACTTCGAGGACGGCGGCGTGGTGACCGTGACCCAGGACTCCTCCCTGCAGGACGGCGAGTTCATCTACAAGGTGAAGCTGCGCGGCACCAACTTCCCCTCCGACGGCCCCGTAATGCAGAAGAAAACCATGGGCTGGGAGGCCTCCTCCGAGCGGATGTACCCCGAGGACGGCGCCCTGAAGGGCGAGATCAAGCAGAGGCTGAAGCTGAAGGACGGCGGCCACTACGACGCTGAGGTCAAGACCACCTACAAGGCCAAGAAGCCCGTGCAGCTGCCCGGCGCCTACAACGTCAACATCAAGTTGGACATCACCTCCCACAACGAGGACTACACCATCGTGGAACAGTACGAACGCGCCGAGGGCCGCCACTCCACCGGCGGCATGGACGAGCTGTACAAGTAATAATAA", len: 1185, pos: "C-term" },
  "mAID-2xHA": { seq: "GCAGCTAAAGCCAAAAACAACCAGGGATCCGGAAAGGAGAAGAGTGCTTGTCCTAAAGATCCAGCCAAACCTCCGGCCAAGGCACAAGTTGTGGGATGGCCACCGGTGAGATCATACCGGAAGAACGTGATGGTTTCCTGCCAAAAATCAAGCGGTGGCCCGGAGGCGGCGGCGTTCGTGAAGGTATCAATGGACGGAGCACCGTACTTGAGGAAAATCGATTTGAGGATGTATAAAGGCGGCTACCCCTACGACGTGCCCGACTACGCCGGCTATCCGTATGATGTCCCGGACTATGCATAA", len: 300, pos: "C-term" },
  "mAID-2xHA-P2A-mCherry": { seq: "GCAGCTAAAGCCAAAAACAACCAGGGATCCGGAAAGGAGAAGAGTGCTTGTCCTAAAGATCCAGCCAAACCTCCGGCCAAGGCACAAGTTGTGGGATGGCCACCGGTGAGATCATACCGGAAGAACGTGATGGTTTCCTGCCAAAAATCAAGCGGTGGCCCGGAGGCGGCGGCGTTCGTGAAGGTATCAATGGACGGAGCACCGTACTTGAGGAAAATCGATTTGAGGATGTATAAAGGCGGCTACCCCTACGACGTGCCCGACTACGCCGGCTATCCGTATGATGTCCCGGACTATGCAGCAACAAACTTCTCTCTGCTGAAACAAGCCGGAGATGTCGAAGAGAATCCTGGACCGGTGAGCAAGGGCGAGGAGGATAACATGGCCATCATCAAGGAGTTCATGCGCTTCAAGGTGCACATGGAGGGCTCCGTGAACGGCCACGAGTTCGAGATCGAGGGCGAGGGCGAGGGCCGCCCCTACGAGGGCACCCAGACCGCCAAGCTGAAGGTGACCAAGGGTGGCCCCCTGCCCTTCGCCTGGGACATCCTGTCCCCTCAGTTCATGTACGGCTCCAAGGCCTACGTGAAGCACCCCGCCGACATCCCCGACTACTTGAAGCTGTCCTTCCCCGAGGGCTTCAAGTGGGAGCGCGTGATGAACTTCGAGGACGGCGGCGTGGTGACCGTGACCCAGGACTCCTCCCTGCAGGACGGCGAGTTCATCTACAAGGTGAAGCTGCGCGGCACCAACTTCCCCTCCGACGGCCCCGTAATGCAGAAGAAAACCATGGGCTGGGAGGCCTCCTCCGAGCGGATGTACCCCGAGGACGGCGCCCTGAAGGGCGAGATCAAGCAGAGGCTGAAGCTGAAGGACGGCGGCCACTACGACGCTGAGGTCAAGACCACCTACAAGGCCAAGAAGCCCGTGCAGCTGCCCGGCGCCTACAACGTCAACATCAAGTTGGACATCACCTCCCACAACGAGGACTACACCATCGTGGAACAGTACGAACGCGCCGAGGGCCGCCACTCCACCGGCGGCATGGACGAGCTGTACAAGTAATAATAA", len: 1068, pos: "C-term" }
};

export const INTERNAL_TAGS = {
  SPOT: { seq: "GACCGCGTGCGCGCCGTGAGCCATTGGAGCAGC", len: 33, aa: "DRVRAVSHWSS" },
  alphaBtx: { seq: "CGATACTATGAAAGCAGTCTAGAGCCTTACCCAGAC", len: 36, aa: "RYYESSLEPYPD" },
};

const toAA = (codon) => CODON_TABLE[codon] || "?";
const reverseComplement = (sequence) => sequence.split("").reverse().map((base) => DNA_COMPLEMENT[base] || "N").join("");

function sanitizeLabelPart(value, fallback) {
  const cleaned = String(value || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

function simplifyTagName(tag) {
  const raw = String(tag || "").replace(/^N:/, "");
  if (/SD40/i.test(raw)) return "SD40";
  if (/dTAG/i.test(raw)) return "dTAG";
  if (/mAID/i.test(raw)) return "mAID";
  if (/2xHA/i.test(raw) && !/SD40|dTAG|mAID/i.test(raw)) return "2xHA";
  if (/EGFP/i.test(raw)) return "EGFP";
  if (/mScarlet/i.test(raw)) return "mScarlet";
  if (/mCherry/i.test(raw)) return "mCherry";
  return raw;
}

function buildDesignModifier(projectType, mutationString = "", tag = "") {
  if (projectType === "pm") return sanitizeLabelPart(String(mutationString || "").toUpperCase(), "PM");
  if (projectType === "ko") return "KO";
  return `${sanitizeLabelPart(simplifyTagName(tag), "KI")}_KI`;
}

function buildDesignPrefix(gene, projectType, mutationString = "", tag = "") {
  return `${sanitizeLabelPart(gene, "GENE")}_${buildDesignModifier(projectType, mutationString, tag)}`;
}

function makeGuideName(gene, projectType, index, mutationString = "", tag = "") {
  return `${buildDesignPrefix(gene, projectType, mutationString, tag)}_gRNA${index + 1}`;
}

function makePrimerName(gene, projectType, direction, mutationString = "", tag = "") {
  return `${buildDesignPrefix(gene, projectType, mutationString, tag)}_${direction}`;
}

export function parseGB(rawText) {
  const text = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const feats = [];
  let seq = "";
  let inSequence = false;
  let inFeatures = false;
  let current = null;
  let lastQualifier = "";

  for (const line of text.split("\n")) {
    if (line.startsWith("ORIGIN")) { inSequence = true; inFeatures = false; continue; }
    if (line.startsWith("//")) break;
    if (line.startsWith("FEATURES")) { inFeatures = true; continue; }
    if (inSequence) { seq += line.replace(/[^a-zA-Z]/g, ""); continue; }
    if (!inFeatures) continue;
    if (line.length > 5 && line.charAt(5) !== " " && line.charAt(0) === " ") {
      if (current) feats.push(current);
      const parts = line.trim().split(/\s+/);
      current = { type: parts[0], loc: parts.slice(1).join(""), q: {} };
      lastQualifier = "";
      continue;
    }
    if (current && /^\s{21}\//.test(line)) {
      const match = line.trim().match(/^\/(\w+)=?"?([^"]*)"?$/);
      if (match) { current.q[match[1]] = match[2]; lastQualifier = match[1]; }
      continue;
    }
    if (current && /^\s{21}[^/]/.test(line) && !current.loc.includes(")")) { current.loc += line.trim(); continue; }
    if (current && lastQualifier && /^\s{21}/.test(line)) current.q[lastQualifier] = `${current.q[lastQualifier] || ""}${line.trim().replace(/"/g, "")}`;
  }
  if (current) feats.push(current);
  return { seq: seq.toUpperCase(), feats };
}

function armType(guide, mutationPos) {
  return guide.str === "+" ? (mutationPos > guide.cut ? "PROX" : "DIST") : (mutationPos < guide.cut ? "PROX" : "DIST");
}

export function classifySpCas9PamDisruption(originalPam, mutatedPam) {
  const before = String(originalPam || "").toUpperCase();
  const after = String(mutatedPam || "").toUpperCase();
  if (!/^[ACGT]{3}$/.test(before) || !/^[ACGT]{3}$/.test(after)) {
    return { acceptable: false, tier: "none", reason: "PAM sequence is incomplete." };
  }
  if (before.slice(1) !== "GG") {
    return { acceptable: false, tier: "none", reason: `${before} is not a canonical NGG PAM.` };
  }
  if (after.slice(1) === "GG") {
    return { acceptable: false, tier: "none", reason: `${after} remains a canonical NGG PAM.` };
  }
  if (after.slice(1) === "AG") {
    return { acceptable: false, tier: "weak", reason: `${after} is an NAG alternative PAM and is not accepted as a blocking mutation.` };
  }
  if (after[1] === "G" && after[2] === "A") {
    return { acceptable: false, tier: "weak", reason: `${after} is an NGA alternative PAM and is not accepted as a blocking mutation.` };
  }
  if (["C", "T"].includes(after[1]) || ["C", "T"].includes(after[2])) {
    return { acceptable: true, tier: "strong", reason: `${before}->${after} removes the NGG PAM with a C/T substitution at PAM position 2 or 3.` };
  }
  return { acceptable: false, tier: "weak", reason: `${before}->${after} is not treated as a reliably dead SpCas9 PAM.` };
}

export function assessGuideSequence(spacer, deliveryMethod = "unknown") {
  const sequence = String(spacer || "").toUpperCase();
  const gc = calculatePrimerGcPercent(sequence);
  const polyT = sequence.includes("TTTT");
  const polyG = sequence.includes("GGGG");
  const warnings = [];
  if (!/^[ACGT]+$/.test(sequence)) warnings.push("Guide spacer must contain DNA bases A, C, G, and T only.");
  if (sequence.length !== 20) warnings.push(`Guide spacer is ${sequence.length} nt; the design engine requires an explicit 20 nt SpCas9 spacer.`);
  // Deliberately not phrased as a prediction of failure. GC correlates with SpCas9 activity
  // only weakly and non-monotonically: the extremes are worse on average, but individual
  // guides well outside 40-60% are frequently highly active, and GC alone is a poor
  // predictor next to a trained on-target model. What high GC does more reliably is raise
  // tolerance of off-target mismatches, which is a specificity question, not an activity one.
  if (gc < 40 || gc > 60) {
    warnings.push(`GC ${gc}% is outside the 40-60% band where SpCas9 activity is highest on average. GC alone does not predict whether a guide cuts; confirm activity empirically or with an on-target model.`);
  }
  if (polyG) warnings.push("Guide contains GGGG, which may reduce synthesis or activity reliability.");
  if (polyT && deliveryMethod === "u6") warnings.push("Guide contains TTTT, a Pol III termination risk for U6-driven expression.");
  if (polyT && deliveryMethod === "unknown") warnings.push("Guide contains TTTT; choose a delivery method to determine whether the U6/Pol III termination rule applies.");
  return { status: warnings.length ? "warn" : "pass", gc, polyT, polyG, deliveryMethod, warnings };
}

function assessOrientedGuideSite(guide, rawSite) {
  const donorSpacer = guide.str === "+" ? rawSite.slice(0, 20) : reverseComplement(rawSite.slice(3));
  const donorPam = guide.str === "+" ? rawSite.slice(20) : reverseComplement(rawSite.slice(0, 3));
  const pamAssessment = classifySpCas9PamDisruption(guide.pam, donorPam);
  const mismatches = [];
  for (let index = 0; index < 20; index += 1) if (donorSpacer[index] !== guide.sp[index]) mismatches.push(index + 1);
  const seedMismatches = mismatches.filter((position) => position >= 11);
  const weakenedPam = donorPam !== guide.pam && pamAssessment.tier === "weak";
  // Scored from the donor sequence itself, which is the authority on what will be ordered.
  // An untouched site is 'none' - no protection - not 'weak'. CFD would score it 1.0,
  // which reads as weak protection on the ladder, but there is no protection at all
  // here and the do-not-pool logic depends on the distinction.
  if (!mismatches.length && donorPam === guide.pam) {
    return { tier: "none", protected: false, donorPam, mismatches, cfd: 1, reason: `The full protospacer and ${donorPam} PAM remain intact.` };
  }
  const scored = calculateCfd(guide.sp, donorSpacer, donorPam);
  const cfd = scored ? scored.score : null;
  const tier = gradeProtection({ pamWeakened: weakenedPam, seedMismatches: seedMismatches.length, cfd });
  if (tier === "none") {
    return { tier, protected: false, donorPam, mismatches, reason: `The full protospacer and ${donorPam} PAM remain intact.` };
  }
  const parts = [];
  if (seedMismatches.length) parts.push(`${seedMismatches.length} seed mismatch${seedMismatches.length === 1 ? "" : "es"}`);
  if (weakenedPam) parts.push("a weakened PAM");
  if (!parts.length) parts.push(`${mismatches.length} protospacer mismatch${mismatches.length === 1 ? "" : "es"}`);
  // The PAM survives here, so say what the protection rests on rather than implying the
  // site cannot be cut at all.
  const qualifier = Number.isFinite(cfd)
    ? ` - predicted residual activity ${cfd.toFixed(4)} (CFD)`
    : " - scored by mismatch count; CFD unavailable for this site";
  return { tier, protected: true, donorPam, mismatches, cfd, reason: `${parts.join(" plus ")} with PAM ${donorPam}${qualifier}.` };
}

export function assessGuideAgainstPointMutationDonor(guide, donor) {
  const start = guide.ps;
  const end = guide.ps + 23;
  if (!donor?.genomicDonor || start < donor.donorStart || end > donor.donorEnd) {
    return { tier: "unknown", protected: false, reason: "The complete guide target is outside this ssODN window." };
  }
  return assessOrientedGuideSite(guide, donor.genomicDonor.slice(start - donor.donorStart, end - donor.donorStart));
}

function assessGuideAgainstInternalDonor(guide, donor) {
  const start = guide.ps;
  const end = guide.ps + 23;
  if (!donor?.donorSense || start < donor.donorStart || end > donor.donorEnd) {
    return { tier: "unknown", protected: false, reason: "The complete guide target is outside this ssODN window." };
  }
  if (donor.insertionPos > start && donor.insertionPos < end) {
    return { tier: "strong", protected: true, reason: "The internal-tag insertion splits the original protospacer/PAM sequence." };
  }
  const rawSite = Array.from({ length: 23 }, (_, offset) => {
    const genomicPos = start + offset;
    let donorIndex = genomicPos - donor.donorStart;
    if (genomicPos >= donor.insertionPos) donorIndex += donor.insertSequence.length;
    return donor.donorSense[donorIndex] || "N";
  }).join("");
  return assessOrientedGuideSite(guide, rawSite);
}

/** CDS exon boundaries, so a silent change can avoid landing on a splice junction. */
export function getSpliceBoundaries(model) {
  const segments = model?.cdsSegments || [];
  const boundaries = [];
  segments.forEach(([start, end], index) => {
    if (index > 0) boundaries.push(start);          // acceptor side of this exon
    if (index < segments.length - 1) boundaries.push(end - 1); // donor side
  });
  return boundaries;
}

/**
 * Distance in bp from the nearest CDS exon boundary, or Infinity for a single-exon CDS.
 *
 * Synonymous changes within a few bases of a junction can disrupt the splice site itself or
 * an adjacent exonic splicing enhancer. The engine does not model splicing, so it avoids the
 * window rather than pretending to predict the consequence.
 */
export const SPLICE_BOUNDARY_MARGIN = 3;

export function distanceToSpliceBoundary(model, genomicPos) {
  const boundaries = getSpliceBoundaries(model);
  if (!boundaries.length) return Infinity;
  return Math.min(...boundaries.map((boundary) => Math.abs(boundary - genomicPos)));
}

/**
 * Combined protection from a set of blocking changes.
 *
 * A destroyed PAM ends the question: no PAM, no cut. Otherwise protection comes from seed
 * mismatches, which SpCas9 tolerates singly and increasingly poorly in combination - so the
 * count is what matters, not any one change. A weakened-but-alive PAM (NAG/NGA) is worth
 * roughly one seed mismatch: it lowers cleavage without preventing it.
 */
/**
 * CFD thresholds for grading protection of a repaired allele.
 *
 * The *score* is published (Doench 2016). These *cut points* are this tool's choice and are
 * stated as such. 0.023 is the CFD value below which a site is conventionally not treated as
 * a plausible off-target, so it is used here as the point at which a repaired allele is
 * considered adequately protected from re-cutting. The raw score travels with the design so
 * it can be calibrated against bench data rather than taken on faith.
 *
 * Note this is a stricter test than the engine applied before. A synonymous change to PAM
 * position 2 or 3 was graded "strong" outright; CFD puts NCG at 0.107 and NTG at 0.039 of
 * NGG activity, so neither is complete protection on its own.
 */
export const CFD_PROTECTION_THRESHOLDS = Object.freeze({ strong: 0.023, moderate: 0.10 });

/** The 23 nt guide site as the donor leaves it, in guide orientation. */
export function buildEditedGuideSite(model, guide, mutations = []) {
  const seq = getGenomicSequence(model);
  const start = guide.ps;
  if (!Number.isFinite(start) || start < 0 || start + 23 > seq.length) return null;
  const bases = seq.slice(start, start + 23).split("");
  (mutations || []).forEach((mutation) => {
    const offset = mutation.gp - start;
    if (offset >= 0 && offset < 23) bases[offset] = mutation.nb;
  });
  const rawSite = bases.join("");
  return guide.str === "+"
    ? { spacer: rawSite.slice(0, 20), pam: rawSite.slice(20) }
    : { spacer: reverseComplement(rawSite.slice(3)), pam: reverseComplement(rawSite.slice(0, 3)) };
}

/** Predicted residual activity of `guide` against its own site after `mutations`. */
export function scoreResidualActivity(model, guide, mutations = []) {
  const site = buildEditedGuideSite(model, guide, mutations);
  if (!site) return null;
  return calculateCfd(guide.sp, site.spacer, site.pam);
}

/** Tier from a CFD score. Lower score means less residual cleavage, so better protection. */
export function gradeProtectionFromCfd(cfd) {
  if (!Number.isFinite(cfd)) return null;
  if (cfd <= CFD_PROTECTION_THRESHOLDS.strong) return "strong";
  if (cfd <= CFD_PROTECTION_THRESHOLDS.moderate) return "moderate";
  return "weak";
}

/**
 * The one rule for how much protection a set of changes gives.
 *
 * Two callers used to answer this separately and disagreed as soon as a guide carried more
 * than one change: the set-based grader called three seed mismatches strong while the
 * donor-sequence grader capped any number of seed mismatches at moderate. Same design, two
 * tiers, depending on which code path a reader happened to hit.
 *
 * On the ladder itself: a destroyed PAM makes cleavage impossible, and three seed mismatches
 * make it strongly disfavoured but not impossible. Both are graded "strong" because both are
 * adequate protection in practice, and the reason text keeps the distinction rather than
 * letting the tier imply the site is uncuttable.
 */
export function gradeProtection({ pamKilled = false, pamWeakened = false, seedMismatches = 0, cfd = null } = {}) {
  // CFD when it can be computed. It is position- and identity-weighted and published, where
  // the count below treats every seed position alike - which the underlying data does not
  // support: mean penalty runs from 0.93 at the PAM-distal end to about 0.31 mid-seed.
  const fromCfd = gradeProtectionFromCfd(cfd);
  if (fromCfd) return fromCfd;

  // Fallback for sites CFD cannot score - ambiguity codes, a site running off the end of the
  // reference. Deliberately conservative and marked as a fallback wherever it is reported.
  if (pamKilled) return "strong";
  const effective = seedMismatches + (pamWeakened ? 1 : 0);
  if (effective >= 3) return "strong";
  if (effective === 2) return "moderate";
  if (effective === 1) return "weak";
  return "none";
}

export function gradeBlockingSet(mutations, context = {}) {
  const list = (mutations || []).filter(Boolean);
  if (!list.length) return { tier: "none", seedCount: 0, pamKilled: false, pamWeakened: false, cfd: null };

  const pamKilled = list.some((entry) => inferBlockingTier(entry) === "strong");
  const pamWeakened = list.some((entry) => /^PAM\b/i.test(String(entry.pur || "")) && inferBlockingTier(entry) !== "strong");
  const seedCount = list.filter((entry) => /^Seed\b/i.test(String(entry.pur || ""))).length;

  // With a model and guide, the set is graded on predicted residual activity of the repaired
  // allele rather than on how many changes it happens to contain.
  const scored = context.model && context.guide
    ? scoreResidualActivity(context.model, context.guide, list)
    : null;
  const cfd = scored ? scored.score : null;

  const tier = gradeProtection({ pamKilled, pamWeakened, seedMismatches: seedCount, cfd });
  return { tier, seedCount, pamKilled, pamWeakened, cfd, effective: seedCount + (pamWeakened ? 1 : 0) };
}

/**
 * Every acceptable single blocking change for a guide, best first.
 *
 * Ordering is deliberate: destroy the PAM if any synonymous change can, because that is the
 * only change that makes the site uncuttable. Otherwise work from the PAM-proximal end of
 * the seed outward, since mismatches there cost SpCas9 the most.
 *
 * Within one position the alternatives are ranked by human codon usage instead of the
 * alphabet. A silent change is silent at the protein level, not at the translation level.
 */
function collectSilentCandidates(model, guide, blockedPositions = new Set(), options = {}) {
  const allowNonCoding = !!options.allowNonCoding;
  const seq = getGenomicSequence(model);
  const pamStart = guide.str === "+" ? guide.ps + 20 : guide.ps;
  if (pamStart < 0 || pamStart + 3 > seq.length) return [];

  // Terminal-tag designs only apply a change that lands inside a homology arm, so they pass
  // a predicate. Without it, stacking would credit changes in the tier that are then
  // discarded - a design claiming protection its oligo does not carry.
  const isPositionAllowed = typeof options.isPositionAllowed === "function"
    ? options.isPositionAllowed
    : () => true;

  const sites = [];
  const seenPositions = new Set();
  const addSite = (genomicPos, label, kind, pamIndex = null) => {
    if (!Number.isFinite(genomicPos) || genomicPos < 0 || genomicPos >= seq.length) return;
    if (blockedPositions.has(genomicPos) || seenPositions.has(genomicPos)) return;
    if (!isPositionAllowed(genomicPos)) return;
    seenPositions.add(genomicPos);
    sites.push({ genomicPos, label, kind, pamIndex });
  };

  const pamIndexes = guide.str === "+" ? [1, 2] : [0, 1];
  pamIndexes.forEach((pamIndex) => addSite(pamStart + pamIndex, "PAM", "pam", pamIndex));

  // Seed, PAM-proximal first.
  for (let spacerIndex = 19; spacerIndex >= 10; spacerIndex -= 1) {
    const genomicPos = guide.str === "+"
      ? guide.ps + spacerIndex
      : guide.ps + 3 + (19 - spacerIndex);
    addSite(genomicPos, `Seed pos ${spacerIndex + 1}/20`, "seed");
  }
  for (let spacerIndex = 0; spacerIndex < 10; spacerIndex += 1) {
    const genomicPos = guide.str === "+"
      ? guide.ps + spacerIndex
      : guide.ps + 3 + (19 - spacerIndex);
    addSite(genomicPos, `Guide pos ${spacerIndex + 1}/20`, "guide");
  }

  const candidates = [];
  for (const site of sites) {
    const { genomicPos, label, kind, pamIndex } = site;
    const aaNumber = genomicPosToAa(model, genomicPos);
    const codonInfo = aaNumber ? getCodonAtAa(model, aaNumber, toAA) : null;
    const codon = codonInfo?.cod || null;
    const codonIndex = codonInfo ? codonInfo.genomicPositions.indexOf(genomicPos) : -1;
    const originalAA = codon ? toAA(codon) : null;
    const originalBase = seq[genomicPos];
    // Applies to coding and non-coding candidates alike. A non-coding position this close
    // to a CDS boundary *is* the splice site - the intronic GT/AG - so skipping the check
    // there guarded the milder case and waved through the dangerous one.
    if (distanceToSpliceBoundary(model, genomicPos) < SPLICE_BOUNDARY_MARGIN) continue;

    for (const alt of ["A", "C", "G", "T"]) {
      if (alt === originalBase) continue;

      if (kind === "pam") {
        const mutantPam = seq.slice(pamStart, pamStart + 3).split("");
        mutantPam[pamIndex] = alt;
        const stillPam = guide.str === "+"
          ? mutantPam.slice(1).join("") === "GG"
          : reverseComplement(mutantPam.join("")).slice(1) === "GG";
        if (stillPam) continue;
        const oldPam = guide.str === "+" ? seq.slice(pamStart, pamStart + 3) : reverseComplement(seq.slice(pamStart, pamStart + 3));
        const newPam = guide.str === "+" ? mutantPam.join("") : reverseComplement(mutantPam.join(""));
        const pamDisruption = classifySpCas9PamDisruption(oldPam, newPam);
        if (!pamDisruption.acceptable) continue;

        if (!codonInfo || codonIndex < 0) {
          if (!allowNonCoding) continue;
          candidates.push({ rank: 0, usage: 1, mutation: { gp: genomicPos, nb: alt, lb: "noncoding", oc: originalBase, nc: alt, pur: `PAM ${oldPam}->${newPam} outside CDS`, mt: "noncoding", blockingTier: pamDisruption.tier, blockingReason: pamDisruption.reason, pamBefore: oldPam, pamAfter: newPam } });
          continue;
        }
        const mutantCodon = `${codon.slice(0, codonIndex)}${alt}${codon.slice(codonIndex + 1)}`;
        if (toAA(mutantCodon) !== originalAA) continue;
        if (introducesRareCodon(codon, mutantCodon)) continue;
        candidates.push({ rank: 0, usage: getCodonFraction(mutantCodon), mutation: { gp: genomicPos, nb: alt, lb: `p.${originalAA}${aaNumber}${originalAA}`, oc: codon, nc: mutantCodon, pur: `PAM ${oldPam}->${newPam}`, mt: "silent", blockingTier: pamDisruption.tier, blockingReason: pamDisruption.reason, pamBefore: oldPam, pamAfter: newPam } });
        continue;
      }

      const rank = kind === "seed" ? 1 : 2;
      if (!codonInfo || codonIndex < 0) {
        if (!allowNonCoding) continue;
        candidates.push({ rank, usage: 1, mutation: { gp: genomicPos, nb: alt, lb: "noncoding", oc: originalBase, nc: alt, pur: `${label} outside CDS`, mt: "noncoding", blockingTier: "weak", blockingReason: `A single ${label.toLowerCase()} mismatch with an intact PAM is weak protection.` } });
        continue;
      }
      const mutantCodon = `${codon.slice(0, codonIndex)}${alt}${codon.slice(codonIndex + 1)}`;
      if (toAA(mutantCodon) !== originalAA) continue;
      if (introducesRareCodon(codon, mutantCodon)) continue;
      candidates.push({ rank, usage: getCodonFraction(mutantCodon), mutation: { gp: genomicPos, nb: alt, lb: `p.${originalAA}${aaNumber}${originalAA}`, oc: codon, nc: mutantCodon, pur: label, mt: "silent", blockingTier: "weak", blockingReason: `A single ${label.toLowerCase()} mismatch with an intact PAM is weak protection.` } });
    }
  }

  // Preserve site order (PAM, then PAM-proximal seed outward) and prefer the commonest
  // synonymous codon at each site.
  const positionOrder = new Map(sites.map((site, index) => [site.genomicPos, index]));
  return candidates.sort((left, right) => (
    left.rank - right.rank
    || positionOrder.get(left.mutation.gp) - positionOrder.get(right.mutation.gp)
    || right.usage - left.usage
  ));
}

/**
 * Up to `maxChanges` synonymous changes that together stop the guide re-cutting.
 *
 * One change is what the engine used to emit, and one seed mismatch with an intact PAM does
 * not reliably prevent re-cleavage - the tool said so in its own warning text and then
 * shipped exactly that. Where the PAM cannot be destroyed synonymously, mismatches are
 * stacked from the PAM-proximal end until protection is strong.
 *
 * The cap matters in the other direction: every extra mismatch lowers HDR efficiency and
 * makes the edited allele harder to read when sequencing. Three is the usual working limit.
 */
export const MAX_BLOCKING_CHANGES = 3;

/** Clamp a caller-supplied cap into [1, MAX_BLOCKING_CHANGES]; anything else means default. */
export function normalizeMaxBlockingChanges(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return MAX_BLOCKING_CHANGES;
  return Math.max(1, Math.min(MAX_BLOCKING_CHANGES, Math.floor(requested)));
}

/**
 * Would adding `candidate` to `chosen` still leave every touched codon synonymous?
 *
 * Each change is synonymous on its own. Two in the same codon are not necessarily
 * synonymous together, and stacking made that reachable for the first time.
 */
export function keepsCodonsSynonymous(model, chosen, candidate) {
  const all = [...chosen, candidate].filter((entry) => entry && entry.mt === "silent");
  if (all.length < 2) return true;
  const byCodon = new Map();
  for (const mutation of all) {
    const aaNumber = genomicPosToAa(model, mutation.gp);
    if (!aaNumber) continue;
    if (!byCodon.has(aaNumber)) byCodon.set(aaNumber, []);
    byCodon.get(aaNumber).push(mutation);
  }
  for (const [aaNumber, mutations] of byCodon) {
    if (mutations.length < 2) continue;
    const codonInfo = getCodonAtAa(model, aaNumber, toAA);
    if (!codonInfo) return false;
    const bases = codonInfo.cod.split("");
    mutations.forEach((mutation) => {
      const index = codonInfo.genomicPositions.indexOf(mutation.gp);
      if (index >= 0) bases[index] = mutation.nb;
    });
    if (toAA(bases.join("")) !== codonInfo.aa) return false;
  }
  return true;
}

export function findBlockingSet(model, guide, blockedPositions = new Set(), options = {}) {
  const maxChanges = Number.isFinite(options.maxChanges) ? options.maxChanges : MAX_BLOCKING_CHANGES;
  const candidates = collectSilentCandidates(model, guide, blockedPositions, options);
  if (!candidates.length) return [];

  // Greedy on predicted residual activity: at each step take the change that reduces CFD
  // the most, not simply the next one in position order.
  //
  // This matters more than it sounds. Ordering by position and codon usage picked the first
  // synonymous base available at each seed position, which on the APOE R154S fixture gave
  // three mismatches that together still left 0.30 of the original activity - CFD entries
  // vary by an order of magnitude between identities at the same position, so "a mismatch
  // here" is not a fixed amount of protection. Choosing by score finds fewer, better
  // changes, which is also the outcome that costs the least HDR efficiency.
  const chosen = [];
  const usedPositions = new Set();
  const remaining = [...candidates];
  const scoreOf = (set) => {
    const scored = scoreResidualActivity(model, guide, set);
    return scored ? scored.score : null;
  };

  while (chosen.length < maxChanges) {
    let best = null;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      if (!candidate || usedPositions.has(candidate.mutation.gp)) continue;
      // One PAM change is enough; a second cannot make an absent PAM more absent.
      if (candidate.mutation.pur.startsWith("PAM") && chosen.some((entry) => entry.pur.startsWith("PAM"))) continue;
      if (!keepsCodonsSynonymous(model, chosen, candidate.mutation)) continue;
      const score = scoreOf([...chosen, candidate.mutation]);
      // Unscoreable sites fall back to the original ordering, which is already
      // PAM-first then PAM-proximal then commonest codon.
      const key = score === null ? Number.POSITIVE_INFINITY : score;
      if (!best || key < best.key - 1e-12
        || (Math.abs(key - best.key) <= 1e-12 && candidate.usage > best.candidate.usage)) {
        best = { candidate, key, index };
      }
    }
    if (!best) break;
    chosen.push(best.candidate.mutation);
    usedPositions.add(best.candidate.mutation.gp);
    remaining[best.index] = null;
    if (gradeBlockingSet(chosen, { model, guide }).tier === "strong") break;
  }

  const grade = gradeBlockingSet(chosen, { model, guide });
  return chosen.map((mutation) => ({
    ...mutation,
    blockingTier: grade.tier,
    blockingReason: describeBlockingSet(grade, chosen),
  }));
}

/**
 * The blocking set for a point mutation: coding silent changes first, exactly as before.
 *
 * Only when those cannot make the guide strongly blocked, retry with changes outside the coding sequence (intron or UTR) as well, never inside a splice-site window
 * of an annotated exon, and keep the retry only if it grades better. A guide whose PAM or seed lies in the intron next to the edited exon can then be blocked
 * without touching splicing. `allowNonCodingBlockers: false` restores the coding-only behaviour.
 */
function findPointMutationBlockingSet(model, guide, blockedPositions, options = {}) {
  const maxChanges = options.maxChanges;
  const coding = findBlockingSet(model, guide, blockedPositions, { maxChanges });
  if (options.allowNonCodingBlockers === false) return coding;
  const grade = (set) => gradeBlockingSet(set, { model, guide });
  const base = grade(coding);
  if (base.tier === "strong") return coding;
  // Coding bases stay allowed (silent, as before) except inside a splice-site window; bases outside the CDS only in the intron, away from the windows. UTR bases inside
  // an exon are not changed: they are neither silent nor out of reach of exonic splicing signals.
  const insideCds = (position) => (model.cdsSegments || []).some(([start, end]) => position >= start && position < end);
  const widened = findBlockingSet(model, guide, blockedPositions, { maxChanges, allowNonCoding: true,
    isPositionAllowed: (position) => (insideCds(position) ? !inSpliceWindow(model, position) : classifyPosition(model, position).zone === "intron-deep") });
  if (!widened.length) return coding;
  const next = grade(widened);
  const better = PROTECTION_RANK[next.tier] < PROTECTION_RANK[base.tier]
    || (next.tier === base.tier && Number.isFinite(next.cfd) && Number.isFinite(base.cfd) && next.cfd < base.cfd - 1e-9);
  return better ? widened : coding;
}

/**
 * Two guides whenever two exist within 30 bp. Selection stops at the first distance window that has a guide, which returns one guide when the window's guides
 * cut closer than the minimum offset. Keep that guide as the lead and look in the wider windows for a partner at least that far from its cut, ranked by
 * how well the partner can be blocked (the same strategy the design will use).
 */
function completeGuidePair(model, targetPos, selection, blockingOptions) {
  if (!selection || selection.guides.length !== 1) return selection;
  const lead = selection.guides[0];
  for (const window of [20, 30]) {
    if (window <= selection.window) continue;
    const candidates = findSpCas9Guides(model, reverseComplement, targetPos, window)
      .slice().sort((left, right) => Math.abs(left.d) - Math.abs(right.d));
    const entries = candidates.map((guide, index) => {
      const set = findPointMutationBlockingSet(model, guide, new Set(blockingOptions.reserved), blockingOptions);
      return { guide, index, rank: PROTECTION_RANK[gradeBlockingSet(set, { model, guide }).tier] ?? PROTECTION_RANK.none };
    });
    const partner = pickPartnerGuide(lead, entries, { minimumCutOffset: MINIMUM_ALTERNATIVE_CUT_OFFSET });
    if (!partner) continue;
    return { ...selection, guides: [lead, partner], partnerFallback: { leadWindow: selection.window, partnerWindow: window, partnerCutDistance: Math.abs(partner.d) } };
  }
  return selection;
}

function describeBlockingSet(grade, mutations) {
  const parts = [];
  if (grade.pamKilled) parts.push("the NGG PAM is changed");
  else if (grade.pamWeakened) parts.push("the PAM is weakened but alive");
  if (grade.seedCount) parts.push(`${grade.seedCount} synonymous seed mismatch${grade.seedCount === 1 ? "" : "es"}`);
  if (!parts.length && !mutations.length) return "No donor change clearly disrupts this target.";
  if (!parts.length) parts.push(`${mutations.length} synonymous change${mutations.length === 1 ? "" : "s"}`);

  // The score is the substance; the tier is a reading of it. Both are reported so a reviewer
  // can disagree with the thresholds without having to re-derive the number.
  if (Number.isFinite(grade.cfd)) {
    const strength = grade.tier === "strong"
      ? "below the 0.023 threshold at which a site is not treated as plausibly cut"
      : grade.tier === "moderate"
        ? "reduced but not below the threshold for adequate protection"
        : "little reduced; SpCas9 is expected to re-cut this allele";
    return `${parts.join(" plus ")}: predicted residual activity ${grade.cfd.toFixed(4)} of the unedited target (CFD, Doench 2016) - ${strength}.`;
  }

  // No CFD available for this site, so the count fallback applies and says so.
  const strength = grade.tier === "strong"
    ? "together give strong protection against re-cutting"
    : grade.tier === "moderate"
      ? "reduce but do not reliably prevent re-cutting"
      : "are weak protection; SpCas9 tolerates a single mismatch";
  return `${parts.join(" plus ")} ${strength} (mismatch count; this site could not be scored).`;
}

export function validatePointMutationPayload(model, donorStart, payload, targetAaNumber, intendedAa) {
  const reference = getGenomicSequence(model);
  const changedAaNumbers = new Set();
  payload.forEach((base, index) => {
    const genomicPos = donorStart + index;
    if (base !== reference[genomicPos]) {
      const aaNumber = genomicPosToAa(model, genomicPos);
      if (aaNumber) changedAaNumbers.add(aaNumber);
    }
  });
  changedAaNumbers.add(targetAaNumber);
  const codons = [...changedAaNumbers].sort((left, right) => left - right).map((aaNumber) => {
    const codonInfo = getCodonAtAa(model, aaNumber, toAA);
    if (!codonInfo) return { aaNumber, valid: false, reason: "Codon could not be mapped." };
    const finalCodon = codonInfo.genomicPositions.map((genomicPos) => {
      const donorIndex = genomicPos - donorStart;
      return donorIndex >= 0 && donorIndex < payload.length ? payload[donorIndex] : reference[genomicPos];
    }).join("");
    const observedAa = toAA(finalCodon);
    const expectedAa = aaNumber === targetAaNumber ? intendedAa : codonInfo.aa;
    return {
      aaNumber,
      referenceCodon: codonInfo.cod,
      finalCodon,
      referenceAa: codonInfo.aa,
      expectedAa,
      observedAa,
      valid: observedAa === expectedAa,
    };
  });
  const target = codons.find((entry) => entry.aaNumber === targetAaNumber);
  const valid = !!target && target.valid && codons.every((entry) => entry.valid);
  return {
    valid,
    targetAaNumber,
    intendedAa,
    observedAa: target?.observedAa || "?",
    codons,
    errors: codons.filter((entry) => !entry.valid).map((entry) => `AA ${entry.aaNumber}: expected ${entry.expectedAa}, observed ${entry.observedAa} (${entry.finalCodon})`),
  };
}

export function mkODN(model, guide, mutationPositions, mutationBases, silentMutations = [], validationTarget = null) {
  const seq = getGenomicSequence(model);
  let donorStart;
  let donorEnd;
  if (guide.str === "+") { donorStart = guide.cut - 36; donorEnd = guide.cut + 91; }
  else { donorStart = guide.cut - 91; donorEnd = guide.cut + 36; }
  const desiredLength = donorEnd - donorStart;
  if (donorStart < 0) {
    donorEnd = Math.min(seq.length, donorEnd - donorStart);
    donorStart = 0;
  }
  if (donorEnd > seq.length) {
    donorStart = Math.max(0, donorStart - (donorEnd - seq.length));
    donorEnd = seq.length;
  }
  if (donorEnd - donorStart < desiredLength && seq.length >= desiredLength) {
    donorStart = Math.max(0, donorEnd - desiredLength);
    donorEnd = Math.min(seq.length, donorStart + desiredLength);
  }
  if (donorStart < 0 || donorEnd > seq.length || donorEnd - donorStart < desiredLength) return null;

  const payload = seq.slice(donorStart, donorEnd).split("");
  const wildType = seq.slice(donorStart, donorEnd);
  mutationPositions.forEach((pos, index) => {
    const donorIndex = pos - donorStart;
    if (donorIndex >= 0 && donorIndex < 127) payload[donorIndex] = mutationBases[index];
  });
  silentMutations.forEach((mutation) => {
    const donorIndex = mutation.gp - donorStart;
    if (donorIndex >= 0 && donorIndex < 127) payload[donorIndex] = mutation.nb;
  });
  const guideSiteStart = guide.ps - donorStart;
  const guideSiteEnd = guideSiteStart + 23;
  const guidePamStart = guide.str === "+" ? guideSiteStart + 20 : guideSiteStart;
  const guidePamEnd = guidePamStart + 3;
  const ssOdn = guide.str === "+" ? reverseComplement(payload.join("")) : payload.join("");
  const wtOdn = guide.str === "+" ? reverseComplement(wildType) : wildType;
  const { codingWt, codingDonor } = extractCodingDonorWindowFromModel(model, donorStart, donorEnd, payload);
  const proteinValidation = validationTarget
    ? validatePointMutationPayload(model, donorStart, payload, validationTarget.aaNumber, validationTarget.intendedAa)
    : null;
  const orderedIndex = (genomicPos) => {
    const payloadIndex = genomicPos - donorStart;
    if (payloadIndex < 0 || payloadIndex >= payload.length) return null;
    return guide.str === "+" ? payload.length - 1 - payloadIndex : payloadIndex;
  };
  const diff = [];
  for (let index = 0; index < 127; index += 1) if (ssOdn[index] !== wtOdn[index]) diff.push(index);
  const desiredDiffIndexes = mutationPositions.map((pos) => orderedIndex(pos)).filter((index) => index !== null).sort((left, right) => left - right);
  const silentDiffIndexes = silentMutations.map((mutation) => orderedIndex(mutation.gp)).filter((index) => index !== null).sort((left, right) => left - right);
  return {
    od: ssOdn,
    wo: wtOdn,
    df: diff,
    desiredDiffIndexes,
    silentDiffIndexes,
    silentMutations,
    sl: guide.str === "+" ? "- strand target" : "+ strand target",
    codingWt,
    codingDonor,
    proteinValidation,
    donorStart,
    donorEnd,
    genomicDonor: payload.join(""),
    guideSiteStart,
    guideSiteEnd,
    guidePamStart,
    guidePamEnd,
  };
}

const COMMON_LINKER = "GCAGCTAAAGCCAAAAACAACCAGGGATCCGGA";
const CTERM_MINIIAA7_V5_EXACT_SEQ = "GCTAGCGGAGGTGGATCGGGAGGTGGATCGGGCTTCTCTGAGACCGTGGACCTGATGCTGAACCTGCAGTCCAATAAGGAGGGCTCTGTGGATCTGAAGAACGTGAGCGCCGTGCCTAAGGAGAAGACCACACTGAAGGACCCATCCAAGCCCCCTGCCAAGGCACAGGTGGTGGGATGGCCACCCGTGCGGAACTACAGAAAGAATATGATGACCCAGCAGAAGACAAGCTCCGGGAAGCCCATCCCCAACCCCCTGCTGGGCCTGGACAGCACGTAA";
const CTERM_MINIIAA7_V5_BLASTIR_EXACT_SEQ = "GCTAGCGGAGGTGGATCGGGAGGTGGATCGGGCTTCTCTGAGACCGTGGACCTGATGCTGAACCTGCAGTCCAATAAGGAGGGCTCTGTGGATCTGAAGAACGTGAGCGCCGTGCCTAAGGAGAAGACCACACTGAAGGACCCATCCAAGCCCCCTGCCAAGGCACAGGTGGTGGGATGGCCACCCGTGCGGAACTACAGAAAGAATATGATGACCCAGCAGAAGACAAGCTCCGGGAAGCCCATCCCCAACCCCCTGCTGGGCCTGGACAGCACGAGCGCTGGCAGCGGCGCCACCAACTTCAGCCTGCTGAAGCAGGCCGGCGACGTGGAGGAGAACCCCGGCCCCATGAAGACCTTCAACATCTCTCAGCAGGACCTTGAGCTGGTGGAAGTTGCCACTGAGAAAATCACCATGCTCTATGAGGACAACAAGCACCATGTTGGTGCTGCCATCAGGACCAAGACAGGAGAAATCATCTCTGCTGTCCACATTGAAGCCTACATTGGCAGGGTCACTGTGTGTGCAGAGGCCATTGCCATTGGGTCTGCAGTCTCCAATGGGCAGAAGGACTTTGACACCATTGTGGCTGTGAGGCACCCCTACAGTGATGAGGTGGACAGGTCCATCAGAGTGGTGTCCCCCTGTGGCATGTGCAGGGAGCTCATCTCAGACTATGCCCCTGATTGCTTTGTTCTGATTGAGATGAATGGCAAGCTGGTCAAGACAACCATTGAGGAGCTGATTCCACTGAAATACACCAGAAACTAA";
const NTERM_MINIIAA7_V5_EXACT_SEQ = "ATGGGGAAGCCCATCCCCAACCCCCTGCTGGGCCTGGACAGCACGGGCTTCTCTGAGACCGTGGACCTGATGCTGAACCTGCAGTCCAATAAGGAGGGCTCTGTGGATCTGAAGAACGTGAGCGCCGTGCCTAAGGAGAAGACCACACTGAAGGACCCATCCAAGCCCCCTGCCAAGGCACAGGTGGTGGGATGGCCACCCGTGCGGAACTACAGAAAGAATATGATGACCCAGCAGAAGACAAGCTCCGGGGGTGGATCGGGAGGTGGATCC";
const NTERM_MINIIAA7_V5_BLASTIR_EXACT_SEQ = "ATGAAGACCTTCAACATCTCTCAGCAGGACCTTGAGCTGGTGGAAGTTGCCACTGAGAAAATCACCATGCTCTATGAGGACAACAAGCACCATGTTGGTGCTGCCATCAGGACCAAGACAGGAGAAATCATCTCTGCTGTCCACATTGAAGCCTACATTGGCAGGGTCACTGTGTGTGCAGAGGCCATTGCCATTGGGTCTGCAGTCTCCAATGGGCAGAAGGACTTTGACACCATTGTGGCTGTGAGGCACCCCTACAGTGATGAGGTGGACAGGTCCATCAGAGTGGTGTCCCCCTGTGGCATGTGCAGGGAGCTCATCTCAGACTATGCCCCTGATTGCTTTGTTCTGATTGAGATGAATGGCAAGCTGGTCAAGACAACCATTGAGGAGCTGATTCCACTGAAATACACCAGAAACGGCAGCGGCGCCACCAACTTCAGCCTGCTGAAGCAGGCCGGCGACGTGGAGGAGAACCCCGGCCCCGGGAAGCCCATCCCCAACCCCCTGCTGGGCCTGGACAGCACGGGCTTCTCTGAGACCGTGGACCTGATGCTGAACCTGCAGTCCAATAAGGAGGGCTCTGTGGATCTGAAGAACGTGAGCGCCGTGCCTAAGGAGAAGACCACACTGAAGGACCCATCCAAGCCCCCTGCCAAGGCACAGGTGGTGGGATGGCCACCCGTGCGGAACTACAGAAAGAATATGATGACCCAGCAGAAGACAAGCTCCGGGGGTGGATCGGGAGGTGGATCC";
const V5_TAG_SEQ = "GGGAAGCCCATCCCCAACCCCCTGCTGGGCCTGGACAGCACG";
const HA_TAG_SEQ = "TACCCCTACGACGTGCCCGACTACGCC";
const MINI_IAA7_SEQ = "GGCTTCTCTGAGACCGTGGACCTGATGCTGAACCTGCAGTCCAATAAGGAGGGCTCTGTGGATCTGAAGAACGTGAGCGCCGTGCCTAAGGAGAAGACCACACTGAAGGACCCATCCAAGCCCCCTGCCAAGGCACAGGTGGTGGGATGGCCACCCGTGCGGAACTACAGAAAGAATATGATGACCCAGCAGAAGACAAGCTCC";
const P2A_SELECTION_SEQ = "GGCAGCGGCGCCACCAACTTCAGCCTGCTGAAGCAGGCCGGCGACGTGGAGGAGAACCCCGGCCCC";
const NTERM_BLASTIR_SEQ = "ATGAACATCTCTCAGCAGGACCTTGAGCTGGTGGAAGTTGCCACTGAGAAAATCACCATGCTCTATGAGGACAACAAGCACCATGTTGGTGCTGCCATCAGGACCAAGACAGGAGAAATCATCTCTGCTGTCCACATTGAAGCCTACATTGGCAGGGTCACTGTGTGTGCAGAGGCCATTGCCATTGGGTCTGCAGTCTCCAATGGGCAGAAGGACTTTGACACCATTGTGGCTGTGAGGCACCCCTACAGTGATGAGGTGGACAGGTCCATCAGAGTGGTGTCCCCCTGTGGCATGTGCAGGGAGCTCATCTCAGACTATGCCCCTGATTGCTTTGTTCTGATTGAGATGAATGGCAAGCTGGTCAAGACAACCATTGAGGAGCTGATTCCACTGAAATACACCAGAAAC";
const CTERM_BLASTIR_SEQ = "ATGAAGACCTTCAACATCTCTCAGCAGGACCTTGAGCTGGTGGAAGTTGCCACTGAGAAAATCACCATGCTCTATGAGGACAACAAGCACCATGTTGGTGCTGCCATCAGGACCAAGACAGGAGAAATCATCTCTGCTGTCCACATTGAAGCCTACATTGGCAGGGTCACTGTGTGTGCAGAGGCCATTGCCATTGGGTCTGCAGTCTCCAATGGGCAGAAGGACTTTGACACCATTGTGGCTGTGAGGCACCCCTACAGTGATGAGGTGGACAGGTCCATCAGAGTGGTGTCCCCCTGTGGCATGTGCAGGGAGCTCATCTCAGACTATGCCCCTGATTGCTTTGTTCTGATTGAGATGAATGGCAAGCTGGTCAAGACAACCATTGAGGAGCTGATTCCACTGAAATACACCAGAAACTTAA";
const NTERM_HYGROR_SEQ = "ATGAAAAAGCCTGAACTCACCGCGACGTCTGTCGAGAAGTTTCTGATCGATGCCTGGCGGCGGCGGTGCCGCCGTGCTGGCGATTGCGGAGAGCATCCTGCTGCAACAGCTGCCCGGACGCCGCCCTGTAGAGGAAGAGCCTGACCTATTGCATACTTTGTCAAGAGCAATCGGTCCATCACAGTGCTGACCTCCATAGAAGACACCGCACTGGCTGGAGTTGTCCCAATTCTTGGAGCCCTCAGTCCTGCTCCTCTGGCGATGATTATCATATAATTTCTGGGTAGCGGCTCTGAGGGTGGCGGTGATGCCGGCCACGACGAGATATACAAGCTCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACCCTCGTGACCACCCTGACCTACGGCGTGCAGTGCTTCAGCCGCTACCCCGACCACATGAAGCAGCACGACTTCTTCAAGTCCGCCATGCCCGAAGGCTACGTCCAGGAGCGCACCATCTTCTTCAAGGACGACGGCAACTACAAGACCCGCGCCGAGGTGAAGTTCGAGGGCGACACCCTGGTGAACCGCATCGAGCTGAAGGGCATCGACTTCAAGGAGGACGGCAACATCCTGGGGCACAAGCTGGAGTACAACTACAACAGCCACAACGTCTATATCATGGCCGACAAGCAGAAGAACGGCATCAAGGTGAACTTCAAG";
const CTERM_HYGROR_SEQ = "ATGAAAAAGCCTGAACTCACCGCGACGTCTGTCGAGAAGTTTCTGATCGATGCCTGGCGGCGGCGGTGCCGCCGTGCTGGCGATTGCGGAGAGCATCCTGCTGCAACAGCTGCCCGGACGCCGCCCTGTAGAGGAAGAGCCTGACCTATTGCATACTTTGTCAAGAGCAATCGGTCCATCACAGTGCTGACCTCCATAGAAGACACCGCACTGGCTGGAGTTGTCCCAATTCTTGGAGCCCTCAGTCCTGCTCCTCTGGCGATGATTATCATATAATTTCTGGGTAGCGGCTCTGAGGGTGGCGGTGATGCCGGCCACGACGAGATATACAAGCTCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACCCTCGTGACCACCCTGACCTACGGCGTGCAGTGCTTCAGCCGCTACCCCGACCACATGAAGCAGCACGACTTCTTCAAGTCCGCCATGCCCGAAGGCTACGTCCAGGAGCGCACCATCTTCTTCAAGGACGACGGCAACTACAAGACCCGCGCCGAGGTGAAGTTCGAGGGCGACACCCTGGTGAACCGCATCGAGCTGAAGGGCATCGACTTCAAGGAGGACGGCAACATCCTGGGGCACAAGCTGGAGTACAACTACAACAGCCACAACGTCTATATCATGGCCGACAAGCAGAAGAACGGCATCAAGGTGAACTTCAAGTAA";
const DONOR_COLORS = {
  HA5: "#38bdf8",
  HA3: "#818cf8",
  START: "#22c55e",
  LINKER: "#f59e0b",
  TAG: "#34d399",
  DETECT: "#06b6d4",
  REPORTER: "#fb7185",
  PEPTIDE: "#f97316",
  STOP: "#facc15",
  GUIDE: "#c084fc",
  PAM: "#fbbf24",
  SILENT: "#ef4444",
};

function cloneSegments(segments) {
  return segments.map((segment) => ({ ...segment }));
}

function getReporterDefinition(reporterLabel) {
  return REPORTERS[reporterLabel] || null;
}

function buildPureReporterPreset(name, twoALabel, reporterLabel) {
  const sequence = CASSETTES[name].seq;
  const reporterStart = sequence.indexOf("ATG", 20);
  const reporter = getReporterDefinition(reporterLabel);
  const peptideSeq = PEPTIDE_INSERTS[twoALabel] || sequence.slice(0, reporterStart);
  const reporterSeq = reporter?.dna || sequence.slice(reporterStart, -3);
  const reporterReference = reporter ? REPORTER_PROTEIN_REFERENCES[reporterLabel] : null;
  const stopSeq = "TAA";
  return {
    ct: {
      seq: `${peptideSeq}${reporterSeq}${stopSeq}`,
      segments: [
        { label: twoALabel, role: "PEPTIDE", color: DONOR_COLORS.PEPTIDE, seq: peptideSeq },
        { label: reporterLabel, role: "REPORTER", color: DONOR_COLORS.REPORTER, seq: reporterSeq, referenceProtein: reporterReference },
        { label: "Stop", role: "STOP", color: DONOR_COLORS.STOP, seq: stopSeq },
      ],
    },
    nt: {
      seq: `${reporterSeq}${peptideSeq}`,
      segments: [
        { label: "Start", role: "START", color: DONOR_COLORS.START, seq: "ATG" },
        { label: reporterLabel, role: "REPORTER", color: DONOR_COLORS.REPORTER, seq: reporterSeq.slice(3), referenceProtein: reporterReference ? { ...reporterReference, aa: reporterReference.aa.slice(1) } : null },
        { label: twoALabel, role: "PEPTIDE", color: DONOR_COLORS.PEPTIDE, seq: peptideSeq },
      ],
    },
  };
}

function buildReporterLinkerPreset(name, reporterLabel) {
  const sequence = CASSETTES[name].seq;
  const reporter = getReporterDefinition(reporterLabel);
  const reporterSeq = reporter?.dna || sequence.slice(0, sequence.length - COMMON_LINKER.length);
  const reporterReference = reporter ? REPORTER_PROTEIN_REFERENCES[reporterLabel] : null;
  return {
    nt: {
      seq: `${reporterSeq}${COMMON_LINKER}`,
      segments: [
        { label: "Start", role: "START", color: DONOR_COLORS.START, seq: "ATG" },
        {
          label: reporterLabel,
          role: "REPORTER",
          color: DONOR_COLORS.REPORTER,
          seq: reporterSeq.startsWith("ATG") ? reporterSeq.slice(3) : reporterSeq,
          referenceProtein: reporterReference
            ? {
              ...reporterReference,
              aa: reporterReference.aa.startsWith("M") ? reporterReference.aa.slice(1) : reporterReference.aa,
            }
            : null,
        },
        { label: "Linker", role: "LINKER", color: DONOR_COLORS.LINKER, seq: COMMON_LINKER },
      ],
    },
  };
}

function buildTaggedPreset(name, tagLabel) {
  const fullSeq = CASSETTES[name].seq;
  const tagSeq = fullSeq.slice(COMMON_LINKER.length, -3);
  const ntTagSeq = tagSeq.startsWith("ATG") ? tagSeq : `ATG${tagSeq}`;
  return {
    ct: {
      seq: fullSeq,
      segments: [
        { label: "Linker", role: "LINKER", color: DONOR_COLORS.LINKER, seq: COMMON_LINKER },
        { label: tagLabel, role: "TAG", color: DONOR_COLORS.TAG, seq: tagSeq },
        { label: "Stop", role: "STOP", color: DONOR_COLORS.STOP, seq: "TAA" },
      ],
    },
    nt: {
      seq: `${ntTagSeq}${COMMON_LINKER}`,
      segments: [
        { label: "Start", role: "START", color: DONOR_COLORS.START, seq: "ATG" },
        { label: tagLabel, role: "TAG", color: DONOR_COLORS.TAG, seq: ntTagSeq.slice(3) },
        { label: "Linker", role: "LINKER", color: DONOR_COLORS.LINKER, seq: COMMON_LINKER },
      ],
    },
  };
}

function buildComboPreset(name, tagLabel, tailPresetName, twoALabel, reporterLabel) {
  const tailSeq = CASSETTES[tailPresetName].seq;
  const comboSeq = CASSETTES[name].seq;
  const tagSeq = comboSeq.slice(COMMON_LINKER.length, comboSeq.length - tailSeq.length);
  const pureReporter = buildPureReporterPreset(tailPresetName, twoALabel, reporterLabel);
  const peptideSeq = pureReporter.ct.segments[0].seq;
  const reporterSeq = pureReporter.ct.segments[1].seq;
  const reporterReference = pureReporter.ct.segments[1].referenceProtein || null;
  return {
    ct: {
      seq: comboSeq,
      segments: [
        { label: "Linker", role: "LINKER", color: DONOR_COLORS.LINKER, seq: COMMON_LINKER },
        { label: tagLabel, role: "TAG", color: DONOR_COLORS.TAG, seq: tagSeq },
        { label: twoALabel, role: "PEPTIDE", color: DONOR_COLORS.PEPTIDE, seq: peptideSeq },
        { label: reporterLabel, role: "REPORTER", color: DONOR_COLORS.REPORTER, seq: reporterSeq, referenceProtein: reporterReference },
        { label: "Stop", role: "STOP", color: DONOR_COLORS.STOP, seq: "TAA" },
      ],
    },
    nt: {
      seq: `${reporterSeq}${peptideSeq}${tagSeq}${COMMON_LINKER}`,
      segments: [
        { label: "Start", role: "START", color: DONOR_COLORS.START, seq: "ATG" },
        { label: reporterLabel, role: "REPORTER", color: DONOR_COLORS.REPORTER, seq: reporterSeq.slice(3), referenceProtein: reporterReference ? { ...reporterReference, aa: reporterReference.aa.slice(1) } : null },
        { label: twoALabel, role: "PEPTIDE", color: DONOR_COLORS.PEPTIDE, seq: peptideSeq },
        { label: tagLabel, role: "TAG", color: DONOR_COLORS.TAG, seq: tagSeq },
        { label: "Linker", role: "LINKER", color: DONOR_COLORS.LINKER, seq: COMMON_LINKER },
      ],
    },
  };
}

function buildSelectableTaggedPreset(coreLabel, coreSeq, detectLabel, detectSeq, selection = null) {
  const baseName = `${coreLabel}-${detectLabel}${selection ? `-P2A-${selection.label}` : ""}`;
  if (baseName === "miniIAA7-V5" && !selection) {
    return {
      baseName,
      preset: {
        ct: {
          seq: CTERM_MINIIAA7_V5_EXACT_SEQ,
          segments: [
            { label: "Spacer", role: "LINKER", color: DONOR_COLORS.LINKER, seq: CTERM_MINIIAA7_V5_EXACT_SEQ.slice(0, 30) },
            { label: coreLabel, role: "TAG", color: DONOR_COLORS.TAG, seq: coreSeq },
            { label: "V5 tag", role: "DETECT", color: DONOR_COLORS.DETECT, seq: detectSeq },
            { label: "Stop", role: "STOP", color: DONOR_COLORS.STOP, seq: "TAA" },
          ],
        },
        nt: {
          seq: NTERM_MINIIAA7_V5_EXACT_SEQ,
          segments: [
            { label: "Start", role: "START", color: DONOR_COLORS.START, seq: "ATG" },
            { label: "V5 tag", role: "DETECT", color: DONOR_COLORS.DETECT, seq: detectSeq },
            { label: coreLabel, role: "TAG", color: DONOR_COLORS.TAG, seq: coreSeq },
            { label: "Spacer", role: "LINKER", color: DONOR_COLORS.LINKER, seq: NTERM_MINIIAA7_V5_EXACT_SEQ.slice(-24) },
          ],
        },
      },
      cassettes: {
        [baseName]: { seq: CTERM_MINIIAA7_V5_EXACT_SEQ, len: CTERM_MINIIAA7_V5_EXACT_SEQ.length, pos: "C-term" },
        [`N:${baseName}`]: { seq: NTERM_MINIIAA7_V5_EXACT_SEQ, len: NTERM_MINIIAA7_V5_EXACT_SEQ.length, pos: "N-term" },
      },
    };
  }
  if (baseName === "miniIAA7-V5-P2A-BlastiR") {
    const blastirCodingSeq = NTERM_MINIIAA7_V5_BLASTIR_EXACT_SEQ.slice(3, 798);
    return {
      baseName,
      preset: {
        ct: {
          seq: CTERM_MINIIAA7_V5_BLASTIR_EXACT_SEQ,
          segments: [
            { label: "Spacer", role: "LINKER", color: DONOR_COLORS.LINKER, seq: CTERM_MINIIAA7_V5_BLASTIR_EXACT_SEQ.slice(0, 30) },
            { label: coreLabel, role: "TAG", color: DONOR_COLORS.TAG, seq: coreSeq },
            { label: "V5 tag", role: "DETECT", color: DONOR_COLORS.DETECT, seq: detectSeq },
            { label: "P2A", role: "PEPTIDE", color: DONOR_COLORS.PEPTIDE, seq: P2A_SELECTION_SEQ },
            { label: "BlastiR", role: "REPORTER", color: DONOR_COLORS.REPORTER, seq: selection.ctSeq },
            { label: "Stop", role: "STOP", color: DONOR_COLORS.STOP, seq: "TAA" },
          ],
        },
        nt: {
          seq: NTERM_MINIIAA7_V5_BLASTIR_EXACT_SEQ,
          segments: [
            { label: "Start", role: "START", color: DONOR_COLORS.START, seq: "ATG" },
            { label: "BlastiR", role: "REPORTER", color: DONOR_COLORS.REPORTER, seq: blastirCodingSeq },
            { label: "P2A", role: "PEPTIDE", color: DONOR_COLORS.PEPTIDE, seq: P2A_SELECTION_SEQ },
            { label: "V5 tag", role: "DETECT", color: DONOR_COLORS.DETECT, seq: detectSeq },
            { label: coreLabel, role: "TAG", color: DONOR_COLORS.TAG, seq: coreSeq },
            { label: "Spacer", role: "LINKER", color: DONOR_COLORS.LINKER, seq: NTERM_MINIIAA7_V5_BLASTIR_EXACT_SEQ.slice(-24) },
          ],
        },
      },
      cassettes: {
        [baseName]: { seq: CTERM_MINIIAA7_V5_BLASTIR_EXACT_SEQ, len: CTERM_MINIIAA7_V5_BLASTIR_EXACT_SEQ.length, pos: "C-term" },
        [`N:${baseName}`]: { seq: NTERM_MINIIAA7_V5_BLASTIR_EXACT_SEQ, len: NTERM_MINIIAA7_V5_BLASTIR_EXACT_SEQ.length, pos: "N-term" },
      },
    };
  }
  const ctSegments = [
    { label: "Linker", role: "LINKER", color: DONOR_COLORS.LINKER, seq: COMMON_LINKER },
    { label: coreLabel, role: "TAG", color: DONOR_COLORS.TAG, seq: coreSeq },
    { label: detectLabel, role: "DETECT", color: DONOR_COLORS.DETECT, seq: detectSeq },
  ];
  const ntSegments = [];

  let ctSeq = `${COMMON_LINKER}${coreSeq}${detectSeq}`;
  let ntSeq = `${detectSeq}${coreSeq}${COMMON_LINKER}`;

  if (selection) {
    ctSeq = `${ctSeq}${P2A_SELECTION_SEQ}${selection.ctSeq}`;
    ntSeq = `${selection.ntSeq}${P2A_SELECTION_SEQ}${ntSeq}`;
    ctSegments.push(
      { label: "P2A", role: "PEPTIDE", color: DONOR_COLORS.PEPTIDE, seq: P2A_SELECTION_SEQ },
      { label: selection.label, role: "REPORTER", color: DONOR_COLORS.REPORTER, seq: selection.ctSeq },
    );
    ntSegments.push(
      { label: selection.label, role: "REPORTER", color: DONOR_COLORS.REPORTER, seq: selection.ntSeq },
      { label: "P2A", role: "PEPTIDE", color: DONOR_COLORS.PEPTIDE, seq: P2A_SELECTION_SEQ },
      { label: detectLabel, role: "DETECT", color: DONOR_COLORS.DETECT, seq: detectSeq },
      { label: coreLabel, role: "TAG", color: DONOR_COLORS.TAG, seq: coreSeq },
      { label: "Linker", role: "LINKER", color: DONOR_COLORS.LINKER, seq: COMMON_LINKER },
    );
  } else {
    ctSeq = `${ctSeq}TAA`;
    ntSeq = `ATG${ntSeq}`;
    ctSegments.push({ label: "Stop", role: "STOP", color: DONOR_COLORS.STOP, seq: "TAA" });
    ntSegments.push(
      { label: "Start", role: "START", color: DONOR_COLORS.START, seq: "ATG" },
      { label: detectLabel, role: "DETECT", color: DONOR_COLORS.DETECT, seq: detectSeq },
      { label: coreLabel, role: "TAG", color: DONOR_COLORS.TAG, seq: coreSeq },
      { label: "Linker", role: "LINKER", color: DONOR_COLORS.LINKER, seq: COMMON_LINKER },
    );
  }

  return {
    baseName,
    preset: {
      ct: { seq: ctSeq, segments: ctSegments },
      nt: { seq: ntSeq, segments: ntSegments },
    },
    cassettes: {
      [baseName]: { seq: ctSeq, len: ctSeq.length, pos: "C-term" },
      [`N:${baseName}`]: { seq: ntSeq, len: ntSeq.length, pos: "N-term" },
    },
  };
}

function buildGeneratedTerminalTagPresets() {
  const results = { presets: {}, cassettes: {} };
  const coreModules = {
    SD40: CASSETTES["N:SD40-Linker"].seq.slice(0, -COMMON_LINKER.length),
    dTAG: CASSETTES["N:dTAG-Linker"].seq.slice(0, -COMMON_LINKER.length),
    miniIAA7: MINI_IAA7_SEQ,
  };
  const detectModules = {
    HA: HA_TAG_SEQ,
    V5: V5_TAG_SEQ,
  };
  const selectionModules = {
    none: null,
    BlastiR: { label: "BlastiR", ntSeq: NTERM_BLASTIR_SEQ, ctSeq: CTERM_BLASTIR_SEQ },
    HygroR: { label: "HygroR", ntSeq: NTERM_HYGROR_SEQ, ctSeq: CTERM_HYGROR_SEQ },
  };

  Object.entries(coreModules).forEach(([coreLabel, coreSeq]) => {
    Object.entries(detectModules).forEach(([detectLabel, detectSeq]) => {
      Object.values(selectionModules).forEach((selection) => {
        const generated = buildSelectableTaggedPreset(coreLabel, coreSeq, detectLabel, detectSeq, selection);
        results.presets[generated.baseName] = generated.preset;
        Object.assign(results.cassettes, generated.cassettes);
      });
    });
  });

  return results;
}

const GENERATED_TERMINAL_TAGS = buildGeneratedTerminalTagPresets();
Object.assign(CASSETTES, GENERATED_TERMINAL_TAGS.cassettes);

const DONOR_PRESETS = {
  "2xHA-only": buildTaggedPreset("2xHA-only", "2xHA"),
  "N:EGFP-Linker": buildReporterLinkerPreset("N:EGFP-Linker", "EGFP"),
  "N:mStayGold2-Linker": buildReporterLinkerPreset("N:mStayGold2-Linker", "mStayGold2"),
  "SD40-2xHA": buildTaggedPreset("SD40-2xHA", "SD40-2xHA"),
  "dTAG-2xHA": buildTaggedPreset("dTAG-2xHA", "dTAG-2xHA"),
  "mAID-2xHA": buildTaggedPreset("mAID-2xHA", "mAID-2xHA"),
  "P2A-mCherry": buildPureReporterPreset("P2A-mCherry", "P2A", "mCherry"),
  "P2A-mScarlet": buildPureReporterPreset("P2A-mScarlet", "P2A", "mScarlet"),
  "P2A-mStayGold2": buildPureReporterPreset("P2A-mStayGold2", "P2A", "mStayGold2"),
  "T2A-EGFP": buildPureReporterPreset("T2A-EGFP", "T2A", "EGFP"),
  "T2A-mScarlet_I3": buildPureReporterPreset("T2A-mScarlet_I3", "T2A", "mScarlet_I3"),
  "T2A-mStayGold2": buildPureReporterPreset("T2A-mStayGold2", "T2A", "mStayGold2"),
  "SD40-2xHA-P2A-mCherry": buildComboPreset("SD40-2xHA-P2A-mCherry", "SD40-2xHA", "P2A-mCherry", "P2A", "mCherry"),
  "dTAG-2xHA-P2A-mCherry": buildComboPreset("dTAG-2xHA-P2A-mCherry", "dTAG-2xHA", "P2A-mCherry", "P2A", "mCherry"),
  "mAID-2xHA-P2A-mCherry": buildComboPreset("mAID-2xHA-P2A-mCherry", "mAID-2xHA", "P2A-mCherry", "P2A", "mCherry"),
  ...GENERATED_TERMINAL_TAGS.presets,
};

// C-terminal SD40-V5 with a flexible spacer. The built-in "SD40-V5" cassette puts V5 directly on
// the SD40 C-terminal tail, the part of SD40 that contacts cereblon (Mercer et al., Science 2024,
// doi:10.1126/science.adk4422), and uses the 11-aa house linker upstream. These two entries add a
// GGGGS spacer between SD40 and V5, and the second also replaces the upstream linker with
// (GGGGS)x3 for targets whose C-terminus should sit further from the tag. Codons are
// diversified (no repeated 9-mers, no runs of five, no BsaI/BsmBI/BbsI sites) so the donors
// synthesise cleanly. C-terminal only: there is no N-terminal counterpart.
const GS_LINKER_15 = "GGAGGAGGTGGGTCCGGAGGCGGAGGATCAGGCGGCGGAGGTTCA";
const GS_SPACER_5 = "GGTGGCGGCGGTTCA";

function buildSpacedSD40V5Entries() {
  const sd40 = CASSETTES["N:SD40-Linker"].seq.slice(0, -COMMON_LINKER.length);
  const variants = [
    { name: "SD40-GGGGS-V5", linkerLabel: "Linker", linkerSeq: COMMON_LINKER },
    { name: "GGGGS3-SD40-GGGGS-V5", linkerLabel: "Linker (GGGGS)x3", linkerSeq: GS_LINKER_15 },
  ];
  const entries = { cassettes: {}, presets: {} };
  variants.forEach(({ name, linkerLabel, linkerSeq }) => {
    const seq = `${linkerSeq}${sd40}${GS_SPACER_5}${V5_TAG_SEQ}TAA`;
    entries.cassettes[name] = { seq, len: seq.length, pos: "C-term" };
    entries.presets[name] = {
      ct: {
        seq,
        segments: [
          { label: linkerLabel, role: "LINKER", color: DONOR_COLORS.LINKER, seq: linkerSeq },
          { label: "SD40", role: "TAG", color: DONOR_COLORS.TAG, seq: sd40 },
          { label: "GGGGS spacer", role: "LINKER", color: DONOR_COLORS.LINKER, seq: GS_SPACER_5 },
          { label: "V5 tag", role: "DETECT", color: DONOR_COLORS.DETECT, seq: V5_TAG_SEQ },
          { label: "Stop", role: "STOP", color: DONOR_COLORS.STOP, seq: "TAA" },
        ],
      },
    };
  });
  return entries;
}

const SPACED_SD40_V5 = buildSpacedSD40V5Entries();
Object.assign(CASSETTES, SPACED_SD40_V5.cassettes);
Object.assign(DONOR_PRESETS, SPACED_SD40_V5.presets);

// Minimal FLAG fusion: DYKDDDDK, directly adjacent to the native protein.
const FLAG_SEQ = "GACTACAAGGACGACGATGACAAG";
CASSETTES.FLAG = { seq: `${FLAG_SEQ}TAA`, len: 27, pos: "C-term" };
DONOR_PRESETS.FLAG = {
  ct: { seq: `${FLAG_SEQ}TAA`, segments: [
    { label: "FLAG", role: "TAG", color: DONOR_COLORS.TAG, seq: FLAG_SEQ },
    { label: "Stop", role: "STOP", color: DONOR_COLORS.STOP, seq: "TAA" },
  ] },
  nt: { seq: `ATG${FLAG_SEQ}`, segments: [
    { label: "Start", role: "START", color: DONOR_COLORS.START, seq: "ATG" },
    { label: "FLAG", role: "TAG", color: DONOR_COLORS.TAG, seq: FLAG_SEQ },
  ] },
};

function getInsertPreset(name, orientation) {
  const preset = DONOR_PRESETS[name];
  if (preset) return { ...preset[orientation], segments: cloneSegments(preset[orientation].segments) };
  if (orientation === "nt" && name.startsWith("N:")) {
    const normalizedName = name.slice(2);
    const normalizedPreset = DONOR_PRESETS[normalizedName];
    if (normalizedPreset) {
      return { ...normalizedPreset.nt, segments: cloneSegments(normalizedPreset.nt.segments) };
    }
  }
  if (orientation === "nt" && CASSETTES[name]?.pos === "N-term") {
    return { seq: CASSETTES[name].seq, segments: [{ label: name.replace(/^N:/, ""), role: "TAG", color: DONOR_COLORS.TAG, seq: CASSETTES[name].seq }] };
  }
  const fallback = CASSETTES[name];
  if (!fallback) return null;
  return { seq: fallback.seq, segments: [{ label: name, role: "TAG", color: DONOR_COLORS.TAG, seq: fallback.seq }] };
}

export function getCassetteSequenceLength(name, orientation = "ct") {
  const preset = getInsertPreset(name, orientation);
  if (preset?.seq) return preset.seq.length;
  return CASSETTES[name]?.seq?.length || 0;
}

function buildDonorAnnotations(h5Length, insertSegments, h3Length, extraAnnotations = []) {
  const annotations = [];
  let cursor = 0;
  annotations.push({ label: "5' HA", color: DONOR_COLORS.HA5, start: cursor, end: cursor + h5Length, priority: 1 });
  cursor += h5Length;
  insertSegments.forEach((segment) => {
    annotations.push({ label: segment.label, color: segment.color, start: cursor, end: cursor + segment.seq.length, priority: 1 });
    cursor += segment.seq.length;
  });
  annotations.push({ label: "3' HA", color: DONOR_COLORS.HA3, start: cursor, end: cursor + h3Length, priority: 1 });
  return annotations.concat(extraAnnotations).sort((left, right) => {
    if (left.start !== right.start) return left.start - right.start;
    return (left.priority || 0) - (right.priority || 0);
  });
}

function buildSilentAnnotations(silentMutations, toDonorIndex) {
  return silentMutations
    .map((mutation) => {
      const donorIndex = toDonorIndex(mutation);
      if (!Number.isFinite(donorIndex) || donorIndex < 0) return null;
      const isNonCoding = mutation.mt === "noncoding";
      const labelPrefix = isNonCoding ? "Guide block" : "Silent";
      return {
        label: `${labelPrefix} gRNA${mutation.gi || ""}`.trim(),
        badgeLabel: `${labelPrefix} gRNA${mutation.gi || ""}`.trim(),
        title: `${mutation.lb}: ${mutation.oc} -> ${mutation.nc} | ${mutation.pur}`,
        color: DONOR_COLORS.SILENT,
        start: donorIndex,
        end: donorIndex + 1,
        priority: 10,
      };
    })
    .filter(Boolean);
}

function buildIndexedAnnotations(indexes, details) {
  const ordered = [...new Set((indexes || []).filter((index) => Number.isFinite(index) && index >= 0))].sort((left, right) => left - right);
  if (!ordered.length) return [];
  const ranges = [];
  let start = ordered[0];
  let previous = ordered[0];
  for (let index = 1; index < ordered.length; index += 1) {
    const current = ordered[index];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    ranges.push({ start, end: previous + 1 });
    start = current;
    previous = current;
  }
  ranges.push({ start, end: previous + 1 });
  return ranges.map((range) => ({ ...details, start: range.start, end: range.end }));
}

function buildGuideAnnotationsFromIndexes(guide, guideIndex, siteIndexes, pamIndexes) {
  return [
    ...buildIndexedAnnotations(siteIndexes, {
      label: `gRNA${guideIndex} site`,
      badgeLabel: `gRNA${guideIndex} site`,
      title: `${guide.sp}`,
      color: DONOR_COLORS.GUIDE,
      priority: 6,
    }),
    ...buildIndexedAnnotations(pamIndexes, {
      label: `gRNA${guideIndex} PAM`,
      badgeLabel: `gRNA${guideIndex} PAM`,
      title: `${guide.pam}`,
      color: DONOR_COLORS.PAM,
      priority: 7,
    }),
  ];
}

function buildGuideAnnotationsForMappedDonor(guide, guideIndex, toDonorIndex) {
  const sitePositions = guide.str === "+"
    ? Array.from({ length: 20 }, (_, index) => guide.ps + index)
    : Array.from({ length: 20 }, (_, index) => guide.ps + 3 + index);
  const pamPositions = guide.str === "+"
    ? [guide.ps + 20, guide.ps + 21, guide.ps + 22]
    : [guide.ps, guide.ps + 1, guide.ps + 2];
  const siteIndexes = sitePositions.map((position) => toDonorIndex(position)).filter((index) => Number.isFinite(index) && index >= 0);
  const pamIndexes = pamPositions.map((position) => toDonorIndex(position)).filter((index) => Number.isFinite(index) && index >= 0);
  return buildGuideAnnotationsFromIndexes(guide, guideIndex, siteIndexes, pamIndexes);
}

const PRIMER_NN_PARAMS = {
  AA: [-7900, -22.2], TT: [-7900, -22.2], AT: [-7200, -20.4], TA: [-7200, -21.3],
  CA: [-8500, -22.7], TG: [-8500, -22.7], GT: [-8400, -22.4], AC: [-8400, -22.4],
  CT: [-7800, -21.0], AG: [-7800, -21.0], GA: [-8200, -22.2], TC: [-8200, -22.2],
  CG: [-10600, -27.2], GC: [-9800, -24.4], GG: [-8000, -19.9], CC: [-8000, -19.9],
};

const VALIDATION_PRIMER_MIN_AMP = 450;
const VALIDATION_PRIMER_MAX_AMP = 500;
const VALIDATION_PRIMER_TARGET_AMP = 475;

function calculateNearestNeighborTm(seq, cP = 250e-9, mg = 1.5e-3, mono = 0.05) {
  const clean = String(seq || "").toUpperCase();
  if (!clean) return 0;
  let dH = 200;
  let dS = -5.7;
  for (let index = 0; index < clean.length - 1; index += 1) {
    const pair = clean[index] + clean[index + 1];
    if (PRIMER_NN_PARAMS[pair]) {
      dH += PRIMER_NN_PARAMS[pair][0];
      dS += PRIMER_NN_PARAMS[pair][1];
    }
  }
  const R = 1.987;
  const CT4 = cP / 4;
  const tmBase = dH / (dS + R * Math.log(CT4)) - 273.15;
  const gcFraction = [...clean].filter((base) => base === "G" || base === "C").length / clean.length;
  const ratio = Math.sqrt(mg) / mono;
  let inv;
  if (ratio < 0.22) {
    inv = (1 / (tmBase + 273.15)) + (4.29 * gcFraction - 3.95) * 1e-5 * Math.log(mono) + 9.4e-6 * Math.log(mono) ** 2;
  } else if (ratio < 6.0) {
    inv = (1 / (tmBase + 273.15))
      + 3.92e-5
      - 9.11e-6 * Math.log(mg)
      + gcFraction * (6.26e-5 + 1.42e-5 * Math.log(mg))
      + (1 / (2 * Math.max(1, clean.length - 1))) * (-4.82e-4 + 5.25e-4 * Math.log(mg) + 8.31e-5 * Math.log(mg) ** 2);
  } else {
    inv = (1 / (tmBase + 273.15)) * (0.843 - 0.352 * Math.log(mg));
  }
  return Math.round(((1 / inv) - 273.15) * 10) / 10;
}

function calculatePrimerGcPercent(seq) {
  const clean = String(seq || "").toUpperCase();
  if (!clean) return 0;
  return Math.round(([...clean].filter((base) => base === "G" || base === "C").length / clean.length) * 1000) / 10;
}

function hasPrimerHomopolymerRun(seq, runLength = 4) {
  const clean = String(seq || "").toUpperCase();
  return ["A", "C", "G", "T"].some((base) => clean.includes(base.repeat(runLength)));
}

function countThreePrimeClamp(seq) {
  return [...String(seq || "").toUpperCase().slice(-3)].filter((base) => base === "G" || base === "C").length;
}

function countGc(sequence) {
  return [...String(sequence || "").toUpperCase()].filter((base) => base === "G" || base === "C").length;
}

function longestSelfComplementRun(seq, minLoop = 3) {
  const clean = String(seq || "").toUpperCase();
  const rc = reverseComplement(clean);
  let best = 0;
  for (let offset = -(rc.length - 1); offset < clean.length; offset += 1) {
    let current = 0;
    for (let index = 0; index < clean.length; index += 1) {
      const rcIndex = index - offset;
      if (rcIndex < 0 || rcIndex >= rc.length) {
        current = 0;
        continue;
      }
      // Pairings closer together than minLoop cannot form a hairpin loop, so they
      // break the stem rather than extending it.
      const originalIndex = clean.length - 1 - rcIndex;
      if (Math.abs(originalIndex - index) <= minLoop) {
        current = 0;
        continue;
      }
      if (clean[index] === rc[rcIndex]) {
        current += 1;
        best = Math.max(best, current);
      } else {
        current = 0;
      }
    }
  }
  return best;
}

function longestComplementRun(leftSequence, rightSequence) {
  const left = String(leftSequence || "").toUpperCase();
  const right = reverseComplement(String(rightSequence || "").toUpperCase());
  let best = 0;
  for (let offset = -(right.length - 1); offset < left.length; offset += 1) {
    let current = 0;
    for (let index = 0; index < left.length; index += 1) {
      const rightIndex = index - offset;
      if (rightIndex < 0 || rightIndex >= right.length) {
        current = 0;
        continue;
      }
      if (left[index] === right[rightIndex]) {
        current += 1;
        best = Math.max(best, current);
      } else {
        current = 0;
      }
    }
  }
  return best;
}

function countThreePrimeComplementRun(leftSequence, rightSequence, windowSize = 8) {
  const left = String(leftSequence || "").toUpperCase().slice(-windowSize);
  const right = reverseComplement(String(rightSequence || "").toUpperCase().slice(-windowSize));
  let best = 0;
  for (let offset = -(right.length - 1); offset < left.length; offset += 1) {
    let current = 0;
    for (let index = 0; index < left.length; index += 1) {
      const rightIndex = index - offset;
      if (rightIndex < 0 || rightIndex >= right.length) {
        current = 0;
        continue;
      }
      if (left[index] === right[rightIndex]) {
        current += 1;
        best = Math.max(best, current);
      } else {
        current = 0;
      }
    }
  }
  return best;
}

function hasLowComplexityPrimer(seq) {
  const clean = String(seq || "").toUpperCase();
  if (!clean) return true;
  if (/^(AT)+$|^(TA)+$|^(GC)+$|^(CG)+$/i.test(clean)) return true;
  const uniqueBases = new Set(clean.split("")).size;
  if (uniqueBases <= 2 && clean.length >= 20) return true;
  const dinucleotideRepeats = clean.match(/(..)\1{3,}/g) || [];
  return dinucleotideRepeats.length > 0;
}

function calculateThreePrimeGcCount(seq, windowSize = 5) {
  return countGc(String(seq || "").toUpperCase().slice(-windowSize));
}

// ΔG of the 3′ terminal window using SantaLucia 1998 nearest-neighbor parameters at 37 °C.
// Values in PRIMER_NN_PARAMS are in cal/mol (ΔH) and cal/mol/K (ΔS).
// Ideal range for specific priming: −2.0 to −9.0 kcal/mol.
// > −1.0  → weak 3′ clamp (non-productive priming risk)
// < −10.0 → over-stable 3′ end (non-specific priming risk)

// ΔG of the 3′ terminal window (SantaLucia 1998 nearest-neighbour parameters, 37 °C).
// PRIMER_NN_PARAMS holds ΔH in cal/mol and ΔS in cal/mol/K.
//
// The thresholds below are calibrated against the range this metric can actually
// produce. With a 5 nt window there are only four nearest-neighbour steps, so every
// one of the 1024 possible 5-mers lands in [-8.79, -2.93] kcal/mol. The previous
// -1.0 / -10.0 cut-offs sat outside that interval, so both 3′-end checks were
// unreachable and silently contributed nothing to primer QC. These values instead
// flag the tails of the achievable distribution: the AT-rich ~7% and the GC-rich ~2.5%.
// `reachableMin`/`reachableMax` are asserted against the real code path in
// test/review-fixes.test.js, so changing `window` will fail the suite until they are
// recomputed.
export const PRIMER_THREE_PRIME_DG = Object.freeze({
  window: 5,
  weakAbove: -4.0,
  overStableBelow: -8.0,
  reachableMin: -8.79,
  reachableMax: -2.93,
});

function calculateThreePrimeDeltaG(seq, windowSize = PRIMER_THREE_PRIME_DG.window) {
  const clean = String(seq || "").toUpperCase().slice(-windowSize);
  let dH = 0;
  let dS = 0;
  for (let index = 0; index < clean.length - 1; index += 1) {
    const pair = clean[index] + clean[index + 1];
    if (PRIMER_NN_PARAMS[pair]) {
      dH += PRIMER_NN_PARAMS[pair][0];
      dS += PRIMER_NN_PARAMS[pair][1];
    }
  }
  // ΔG (kcal/mol) at 37 °C (310.15 K)
  return Math.round(((dH - 310.15 * dS) / 1000) * 100) / 100;
}

// `metrics` lets assessPrimerSequence hand over the values it has already computed.
// Without it this function repeated all three O(len^2) alignments its only caller had
// just finished, roughly doubling the cost of every primer assessment.
function calculatePrimerPenalty(seq, metrics = null) {
  const clean = String(seq || "").toUpperCase();
  if (!clean) return 100;
  let penalty = 0;
  const gcPercent = metrics?.gc ?? calculatePrimerGcPercent(clean);
  penalty += Math.abs(gcPercent - 50) / 4;
  const tm = metrics?.tm ?? calculateNearestNeighborTm(clean);
  penalty += Math.abs(tm - 60) / 3;
  if (hasPrimerHomopolymerRun(clean, 4)) penalty += 8;
  if (hasLowComplexityPrimer(clean)) penalty += 10;
  const dg3 = metrics?.threePrimeDeltaG ?? calculateThreePrimeDeltaG(clean);
  if (dg3 > PRIMER_THREE_PRIME_DG.weakAbove) penalty += 6;            // weak 3′ clamp — unproductive priming risk
  else if (dg3 < PRIMER_THREE_PRIME_DG.overStableBelow) penalty += 4; // over-stable 3′ end — non-specific priming risk
  const selfRun = metrics?.selfDimerRun ?? longestComplementRun(clean, clean);
  const selfThreePrimeRun = metrics?.selfThreePrimeRun ?? countThreePrimeComplementRun(clean, clean);
  const hairpinRun = metrics?.hairpinRun ?? longestSelfComplementRun(clean);
  penalty += Math.max(0, selfRun - 3) * 2.5;
  penalty += Math.max(0, selfThreePrimeRun - 2) * 5;
  penalty += Math.max(0, hairpinRun - 3) * 3;
  return Math.round(penalty * 10) / 10;
}

function assessPrimerSequence(seq) {
  const clean = String(seq || "").toUpperCase();
  const gc = calculatePrimerGcPercent(clean);
  const tm = calculateNearestNeighborTm(clean);
  const selfDimerRun = longestComplementRun(clean, clean);
  const selfThreePrimeRun = countThreePrimeComplementRun(clean, clean);
  const hairpinRun = longestSelfComplementRun(clean);
  const dg3 = calculateThreePrimeDeltaG(clean);
  const warnings = [];
  if (hasPrimerHomopolymerRun(clean, 4)) warnings.push("homopolymer run");
  if (hasLowComplexityPrimer(clean)) warnings.push("low complexity");
  if (selfThreePrimeRun >= 4) warnings.push("3' self-dimer risk");
  if (selfDimerRun >= 6) warnings.push("self-dimer risk");
  if (hairpinRun >= 5) warnings.push("hairpin risk");
  if (dg3 > PRIMER_THREE_PRIME_DG.weakAbove) warnings.push("weak 3' clamp");
  if (dg3 < PRIMER_THREE_PRIME_DG.overStableBelow) warnings.push("over-stable 3' end");
  const penalty = calculatePrimerPenalty(clean, {
    gc, tm, threePrimeDeltaG: dg3, selfDimerRun, selfThreePrimeRun, hairpinRun,
  });
  const status = penalty <= 6 ? "high" : penalty <= 14 ? "medium" : "review";
  return {
    penalty,
    status,
    gc,
    tm,
    selfDimerRun,
    selfThreePrimeRun,
    hairpinRun,
    threePrimeDeltaG: dg3,
    warnings,
  };
}

// `precomputed.forward` / `precomputed.reverse` let a primer search reuse the
// per-primer assessments it has already cached. The primer searches evaluate each
// candidate once and then test it against many partners, so re-assessing both primers
// on every pair was the dominant cost of the whole design run.
export function summarizePrimerPairQuality(forwardSequence, reverseSequence, precomputed = {}) {
  const forward = precomputed.forward || assessPrimerSequence(forwardSequence);
  const reverse = precomputed.reverse || assessPrimerSequence(reverseSequence);
  const heteroDimerRun = longestComplementRun(forwardSequence, reverseSequence);
  const heteroThreePrimeRun = countThreePrimeComplementRun(forwardSequence, reverseSequence);
  const warnings = [...forward.warnings.map((item) => `Fw ${item}`), ...reverse.warnings.map((item) => `Rev ${item}`)];
  if (heteroThreePrimeRun >= 4) warnings.push("3' hetero-dimer risk");
  else if (heteroDimerRun >= 7) warnings.push("hetero-dimer risk");
  const penalty = Math.round((forward.penalty + reverse.penalty + Math.max(0, heteroDimerRun - 4) * 3 + Math.max(0, heteroThreePrimeRun - 2) * 7 + Math.abs(forward.tm - reverse.tm) / 2) * 10) / 10;
  const confidence = penalty <= 14 ? "high" : penalty <= 26 ? "medium" : "review";
  return {
    confidence,
    penalty,
    heteroDimerRun,
    heteroThreePrimeRun,
    tmDelta: Math.round(Math.abs(forward.tm - reverse.tm) * 10) / 10,
    forward,
    reverse,
    warnings,
  };
}

export function summarizePrimerReadiness(result) {
  const primers = result?.ps || [];
  if (primers.length < 2 || !result?.amp) {
    return { ready: false, status: "warn", detail: "Recommended primers or amplicon sizing are incomplete." };
  }
  const quality = summarizePrimerPairQuality(primers[0]?.s || "", primers[1]?.s || "");
  const candidate = result?.primerCandidates?.[0] || null;
  const isFallback = String(result?.primerStrategy || "").includes("fallback") || Number(candidate?.score) <= -900;
  const primerBoundsPass = primers.every((primer) => Number.isFinite(primer?.tm)
    && primer.tm >= 55 && primer.tm <= 67
    && Number.isFinite(primer?.gc) && primer.gc >= 38 && primer.gc <= 67);
  const pairPass = quality.tmDelta <= 5 && quality.confidence !== "review" && quality.heteroThreePrimeRun < 4;
  const marginRequired = String(result?.primerStrategy || "").includes("outside-homology-arms");
  const requiredMargin = Number(candidate?.minimumOutsideMargin);
  const marginPass = !marginRequired || (Number.isFinite(requiredMargin)
    && Number(candidate?.leftOutsideMargin) >= requiredMargin
    && Number(candidate?.rightOutsideMargin) >= requiredMargin);
  const ready = !isFallback && primerBoundsPass && pairPass && marginPass;
  const marginText = marginRequired && Number.isFinite(requiredMargin)
    ? ` Nearest primer edges are ${candidate.leftOutsideMargin}/${candidate.rightOutsideMargin} bp outside the 5'/3' arms (minimum ${requiredMargin} bp).`
    : "";
  if (ready) {
    return { ready: true, status: "pass", quality, detail: `Thermodynamic primer checks pass (${result.amp}; Tm delta ${quality.tmDelta} C).${marginText}` };
  }
  const reasons = [];
  if (isFallback) reasons.push("only fallback placement was available");
  if (!primerBoundsPass) reasons.push("Tm or GC is outside the accepted range");
  if (!pairPass) reasons.push("pair thermodynamics need review");
  if (!marginPass) reasons.push("the outside-homology-arm margin is below the required floor or was not recorded");
  return { ready: false, status: "warn", quality, detail: `Primer pair is not ordering-ready: ${reasons.join("; ")}.${marginText}` };
}

function inferBlockingTier(mutation) {
  if (mutation?.blockingTier) return mutation.blockingTier;
  const pamMatch = String(mutation?.pur || "").match(/PAM\s+([ACGT]{3})->([ACGT]{3})/i);
  if (pamMatch) return classifySpCas9PamDisruption(pamMatch[1], pamMatch[2]).tier;
  return mutation ? "weak" : "none";
}

export function summarizeGuideBlocking(result) {
  const guides = result?.gs || [];
  if (!guides.length) return { tier: "none", status: "warn", detail: "No selected guides are available for blocking assessment.", guides: [] };
  const explicitProtection = Array.isArray(result?.guideProtection) ? result.guideProtection : [];
  const mutations = Array.isArray(result?.ss) ? result.ss : [];
  const assessments = guides.map((guide, index) => {
    const guideIndex = index + 1;
    const explicit = explicitProtection.find((entry) => Number(entry.guideIndex) === guideIndex);
    const guideMutations = mutations.filter((entry) => Number(entry.gi) === guideIndex);
    let tier = explicit?.tier || "none";
    let reason = explicit?.reason || "";
    if (!explicit?.tier && explicit?.byInsertion) {
      tier = "strong";
      reason = "The donor insertion disrupts the original guide target.";
    }
    if (tier === "none" && guideMutations.length) {
      // gradeBlockingSet is the single rule for how much protection a set of changes gives.
      // This used to grade the set here with its own logic, which meant two answers to the
      // same question as soon as a guide carried more than one change.
      const grade = gradeBlockingSet(guideMutations, { model: result?.gb, guide });
      tier = grade.tier;
      reason = [...new Set(guideMutations.map((entry) => entry.blockingReason || entry.pur).filter(Boolean))].join("; ");
    }
    if (!reason) reason = tier === "none" ? "No donor change clearly disrupts this target." : "Guide protection needs review.";
    return { guideIndex, guideName: guide.n || `gRNA${guideIndex}`, tier, reason };
  });
  const allStrong = assessments.every((entry) => entry.tier === "strong");
  const anyNone = assessments.some((entry) => entry.tier === "none");
  const anyWeak = assessments.some((entry) => entry.tier === "weak");
  const overallTier = allStrong ? "strong" : anyNone ? "none" : anyWeak ? "weak" : "moderate";
  const detail = assessments.map((entry) => `${entry.guideName}: ${entry.tier} (${entry.reason})`).join(" ");
  return { tier: overallTier, status: allStrong ? "pass" : "warn", detail, guides: assessments };
}

// Requirements that apply to every design no matter how clean it is. These are
// reported separately from `warnings` on purpose: folding them into `warnings` made
// `status` resolve to "review" for every possible design, which erased the whole
// distinction between a design with real findings and one without. They must still
// travel with any exported order record - use collectProcurementReviewNotes().
const PROCUREMENT_STANDING_REQUIREMENTS = Object.freeze([
  "Genome-wide guide and primer specificity require an external, assembly-matched check before ordering.",
]);

/** Blockers + design-specific warnings + standing requirements, in reporting order. */
export function collectProcurementReviewNotes(readiness) {
  return [
    ...(readiness?.blockers || []),
    ...(readiness?.warnings || []),
    ...(readiness?.standingRequirements || []),
  ];
}

/**
 * A reviewed, recorded decision to order a pair whose guide is only weakly blocked.
 *
 * Requires a reason. An unexplained override in a design record is indistinguishable from a
 * mis-click a year later, and the point of recording it is that a future reader can tell a
 * judgement from an oversight.
 */
export function getWeakProtectionAcceptance(result) {
  const acceptance = result?.weakProtectionAcceptance;
  if (!acceptance || !acceptance.accepted) return null;
  const reason = String(acceptance.reason || "").trim();
  if (!reason) return null;
  return { reason, acceptedBy: String(acceptance.acceptedBy || "").trim() };
}

/**
 * Release state per guide+donor pair.
 *
 * The orderable unit is one guide with its matched ssODN, not "the design". Grading blocking
 * design-wide meant a weak *alternative* guide blocked the pair you were actually going to
 * use - while the same report told you to use one matched pair only and not to pool the
 * alternatives. Those two statements cannot both be right.
 *
 * Co-delivery is the exception, and it is the reason the strict gate existed. When both
 * guides and both ssODNs go into the same well, a guide that is not blocked in every donor
 * re-cuts the allele the other donor just repaired, so there every guide must be strong.
 */
export function summarizeGuidePairReadiness(result) {
  const blocking = summarizeGuideBlocking(result);
  const donors = result?.os || [];
  const coDelivery = Boolean(result?.coDeliveryBlockingRequested);
  const acceptance = getWeakProtectionAcceptance(result);

  const pairs = (blocking.guides || []).map((assessment) => {
    const donor = donors.find((entry) => entry.guideName === assessment.guideName) || null;

    // Weak protection is a risk a competent designer can weigh and accept. A donor that
    // encodes the wrong protein is not a risk, it is an error - so the two are separated
    // and only the first can be acknowledged away.
    const riskBlockers = [];
    const hardBlockers = [];
    if (assessment.tier !== "strong") {
      riskBlockers.push(`${assessment.guideName} is not strongly blocked: ${assessment.tier} (${assessment.reason})`);
    }
    if (donor && donor.proteinValidation && !donor.proteinValidation.valid) {
      hardBlockers.push(`${donor.n} fails the final assembled-protein assertion.`);
    }

    // Not honoured under co-delivery: there a weak guide re-cuts the allele the *other*
    // donor just repaired, which is a different and larger risk than the one being
    // accepted here. Turn co-delivery off and order the pairs separately to proceed.
    const acknowledged = Boolean(acceptance && !coDelivery && riskBlockers.length > 0 && hardBlockers.length === 0);

    return {
      guideName: assessment.guideName,
      guideIndex: assessment.guideIndex,
      donorName: donor?.n || "",
      tier: assessment.tier,
      reason: assessment.reason,
      blockers: [...hardBlockers, ...riskBlockers],
      hardBlockers,
      riskBlockers,
      acknowledged,
      acknowledgementReason: acknowledged ? acceptance.reason : "",
      acknowledgedBy: acknowledged ? acceptance.acceptedBy : "",
      orderable: hardBlockers.length === 0 && (riskBlockers.length === 0 || acknowledged),
    };
  });

  const orderable = pairs.filter((pair) => pair.orderable);
  return {
    coDelivery,
    pairs,
    orderablePairs: orderable,
    // Plainly "at least one pair stands on its own". The co-delivery rule - that the set
    // fails together, because an unblocked guide re-cuts the allele the other donor just
    // repaired - is applied in summarizeProcurementReadiness, which is the only place that
    // decides release. Encoding it here as well produced a second copy that nothing read.
    anyOrderable: orderable.length > 0,
    allOrderable: pairs.length > 0 && orderable.length === pairs.length,
  };
}

export function summarizeProcurementReadiness(result) {
  if (!result || result.err) {
    return {
      status: "blocked",
      blockers: [result?.err || "No completed design is available."],
      warnings: [],
      standingRequirements: [...PROCUREMENT_STANDING_REQUIREMENTS],
    };
  }

  const blockers = [];
  const warnings = [];

  // Reference validity precedes everything else: if the wrong gene, a partial CDS or an
  // out-of-frame CDS was used, every downstream coordinate and residue number is wrong.
  ((result.gb && result.gb.referenceIssues) || []).forEach((issue) => {
    if (issue.severity === "blocker") blockers.push(issue.message);
    else warnings.push(issue.message);
  });

  const guides = result.gs || [];
  if (!guides.length) blockers.push("No guide sequence is available.");
  guides.forEach((guide) => {
    const assessment = assessGuideSequence(guide.sp, result.deliveryMethod || "unknown");
    if (assessment.warnings.length) warnings.push(`${guide.n || "Guide"}: ${assessment.warnings.join(" ")}`);
  });

  let pairReadiness = null;
  if (["pm", "it", "ct", "nt"].includes(result.type)) {
    const blocking = summarizeGuideBlocking(result);
    pairReadiness = summarizeGuidePairReadiness(result);
    if (pairReadiness.coDelivery) {
      // Both guides and both ssODNs share a well: an unblocked guide re-cuts the repaired
      // allele, so the whole set fails together.
      if (blocking.status !== "pass") {
        blockers.push(`Co-delivery requires every guide to be strongly blocked in every donor. ${blocking.detail}`);
      }
    } else if (!pairReadiness.anyOrderable) {
      // Nothing usable: no pair survives on its own either.
      blockers.push(`No guide is strongly blocked by its matched donor. ${blocking.detail}`);
    } else if (!pairReadiness.allOrderable) {
      // At least one pair is sound. Blocking the design would condemn the pair you were
      // told to use because of the alternative you were told not to.
      const usable = pairReadiness.orderablePairs.map((pair) => pair.guideName).join(", ");
      const unusable = pairReadiness.pairs.filter((pair) => !pair.orderable)
        .map((pair) => `${pair.guideName} (${pair.tier})`).join(", ");
      warnings.push(`Order ${usable} with its matched ssODN only. Do not order ${unusable}: not strongly blocked, so the donor can be re-cut after repair.`);
    }

    // An accepted risk stays visible. It moves from "do not order" to a stated decision -
    // it never disappears, and it never lets the design reach "ready".
    pairReadiness.pairs.filter((pair) => pair.acknowledged).forEach((pair) => {
      const attribution = pair.acknowledgedBy ? ` Accepted by: ${pair.acknowledgedBy}.` : "";
      warnings.push(`${pair.guideName}: weak protection accepted for ordering. ${pair.reason} Recorded reason: ${pair.acknowledgementReason}${attribution}`);
    });
  }

  if (result.type === "pm") {
    if (result.partnerFallback && result.partnerFallback.partnerCutDistance > 10) {
      warnings.push(`The second guide cuts ${result.partnerFallback.partnerCutDistance} bp from the mutation site (the first is within 10 bp). HDR falls off with cut-to-edit distance, so expect its ssODN to convert less.`);
    }
    if (result.partnerSkipped) {
      warnings.push("Only one guide is offered: a second guide was found, but its blocking changes could not be combined with the first guide's without changing the protein.");
    }
    // Blocking changes outside the coding sequence are not silent. They avoid the splice-site windows, but splicing is not predicted, so they stay a review item.
    const noncoding = (result.ss || []).filter((entry) => entry.mt === "noncoding");
    if (noncoding.length) {
      const positions = [...new Set(noncoding.map((entry) => `${entry.oc}>${entry.nc} at reference index ${entry.gp + 1}`))].join("; ");
      warnings.push(`Blocking change${noncoding.length === 1 ? "" : "s"} outside the coding sequence (intron; not silent): ${positions}. Placed outside the splice-site windows, but splice effects are not predicted; confirm with a splice predictor.`);
    }
    if (!(result.os || []).length) blockers.push("No validated ssODN donor is available.");
    if ((result.os || []).some((donor) => !donor.proteinValidation?.valid)) blockers.push("A donor fails the final assembled-protein assertion.");
  }

  if (["it", "ct", "nt"].includes(result.type) && result.insertValidation) {
    if (!result.insertValidation.matchesPreset) blockers.push("The donor insert does not match the selected preset.");
    if (!result.insertValidation.framePreserved) blockers.push("The donor insert does not preserve the intended coding frame.");
  }

  if (result.type === "it" && (result.gs || []).length > 1 && !result.coDeliverySafe) {
    warnings.push(result.guideDonorInstruction || "Use each guide only with its matched donor; do not pool alternatives.");
  }
  if (result.type === "pm" && (result.gs || []).length > 1 && !result.coDeliverySafe) {
    warnings.push(result.guideDonorInstruction || "Use each guide only with its matched donor; do not pool alternatives.");
  }

  const primerReadiness = summarizePrimerReadiness(result);
  if (!primerReadiness.ready && !(result.type === "ko" && result.referenceOnly)) warnings.push(primerReadiness.detail);

  return {
    status: blockers.length ? "blocked" : warnings.length ? "review" : "ready",
    blockers,
    warnings,
    standingRequirements: [...PROCUREMENT_STANDING_REQUIREMENTS],
    // Per-pair state, so a report or an export can mark one pair orderable and another not
    // rather than applying a single design-wide answer to both.
    guidePairs: pairReadiness ? pairReadiness.pairs : [],
  };
}

export function buildPrimerRecord(name, sequence, extra = {}) {
  const clean = String(sequence || "").toUpperCase();
  const assessment = assessPrimerSequence(clean);
  return {
    n: name,
    s: clean,
    len: clean.length,
    gc: calculatePrimerGcPercent(clean),
    tm: calculateNearestNeighborTm(clean),
    dg3: calculateThreePrimeDeltaG(clean),
    clamp: countThreePrimeClamp(clean),
    qc: assessment,
    notes: extra.notes || "",
  };
}

// `precomputedQuality` lets the primer search reuse the quality summary it already
// computed for filtering. summarizePrimerPairQuality runs several O(len^2) alignments,
// and every accepted pair used to pay for it three times: once to filter, once here,
// and once in buildPrimerCandidatePair.
function scoreValidatedPrimerPair(forwardPrimer, reversePrimer, ampliconLength, desiredAmpliconLength = 520, extraPenalty = 0, precomputedQuality = null) {
  const quality = precomputedQuality || summarizePrimerPairQuality(forwardPrimer.seq, reversePrimer.seq);
  return Math.round((-(Math.abs(forwardPrimer.tm - 60) + Math.abs(reversePrimer.tm - 60))
    - (Math.abs(forwardPrimer.gc - 50) + Math.abs(reversePrimer.gc - 50)) / 10
    + (forwardPrimer.clamp + reversePrimer.clamp) * 2
    - Math.abs(ampliconLength - desiredAmpliconLength) / 100
    - quality.penalty / 8
    - extraPenalty) * 100) / 100;
}

const HIGH_GC_AMPLICON_WARNING = "high-GC amplicon (>65%)";

function buildPrimerCandidatePair(forwardPrimer, reversePrimer, extra = {}) {
  const quality = extra.quality || summarizePrimerPairQuality(forwardPrimer.seq, reversePrimer.seq);
  const ampliconGc = typeof extra.ampliconGc === "number" ? extra.ampliconGc : null;
  // The guard used to test for "high-GC amplicon" while pushing "high-GC amplicon
  // (>65%)", so it never matched. That was harmless only because every call built a
  // fresh quality object; now that a precomputed one can be passed in, the strings
  // have to agree or the warning would be appended twice.
  if (ampliconGc !== null && ampliconGc > 65 && !quality.warnings.includes(HIGH_GC_AMPLICON_WARNING)) {
    quality.warnings.push(HIGH_GC_AMPLICON_WARNING);
  }
  return {
    fw: forwardPrimer,
    rev: reversePrimer,
    amp: extra.amp ?? (reversePrimer.end - forwardPrimer.start),
    wtAmpliconLength: extra.wtAmpliconLength ?? null,
    deletionAmpliconLength: extra.deletionAmpliconLength ?? null,
    leftOutsideMargin: extra.leftOutsideMargin ?? null,
    rightOutsideMargin: extra.rightOutsideMargin ?? null,
    minimumOutsideMargin: extra.minimumOutsideMargin ?? null,
    ampliconGc,
    quality,
    score: extra.score ?? 0,
  };
}

function buildFallbackPrimerPair(seq, ampliconStart, ampliconEnd, forwardName = "Fw", reverseName = "Rev") {
  const forward = seq.slice(ampliconStart, Math.min(seq.length, ampliconStart + 24));
  const reverse = reverseComplement(seq.slice(Math.max(0, ampliconEnd - 24), ampliconEnd));
  return buildPrimerCandidatePair(
    {
      seq: forward,
      start: ampliconStart,
      end: ampliconStart + forward.length,
      tm: calculateNearestNeighborTm(forward),
      gc: calculatePrimerGcPercent(forward),
      len: forward.length,
      clamp: countThreePrimeClamp(forward),
      name: forwardName,
    },
    {
      seq: reverse,
      start: Math.max(0, ampliconEnd - 24),
      end: ampliconEnd,
      tm: calculateNearestNeighborTm(reverse),
      gc: calculatePrimerGcPercent(reverse),
      len: reverse.length,
      clamp: countThreePrimeClamp(reverse),
      name: reverseName,
    },
    { amp: ampliconEnd - ampliconStart, score: -999 },
  );
}

function serializePrimerCandidates(pairs = []) {
  return pairs.map((pair, index) => {
    const ampliconGc = typeof pair.ampliconGc === "number" ? pair.ampliconGc : null;
    return {
      rank: index + 1,
      score: pair.score,
      ampliconLength: pair.amp ?? null,
      ampliconGc,
      ampliconGcWarning: ampliconGc !== null && ampliconGc > 65 ? "high-GC amplicon — consider adding DMSO or betaine to PCR" : null,
      wtAmpliconLength: pair.wtAmpliconLength ?? null,
      deletionAmpliconLength: pair.deletionAmpliconLength ?? null,
      leftOutsideMargin: pair.leftOutsideMargin ?? null,
      rightOutsideMargin: pair.rightOutsideMargin ?? null,
      minimumOutsideMargin: pair.minimumOutsideMargin ?? null,
      quality: pair.quality || summarizePrimerPairQuality(pair.fw?.seq || pair.forward || "", pair.rev?.seq || pair.reverse || ""),
      forward: buildPrimerRecord("Fw", pair.fw?.seq || pair.forward || ""),
      reverse: buildPrimerRecord("Rev", pair.rev?.seq || pair.reverse || ""),
    };
  });
}

export function designFlankingPrimerPairs(seq, anchorStart, anchorEnd, opts = {}) {
  const {
    minAmp = VALIDATION_PRIMER_MIN_AMP,
    maxAmp = VALIDATION_PRIMER_MAX_AMP,
    desiredAmp = VALIDATION_PRIMER_TARGET_AMP,
    minLen = 18,
    maxLen = 26,
    tmMin = 55,
    tmMax = 67,
    gcMin = 38,
    gcMax = 67,
    tmDelta = 5,
  } = opts;
  const fwCandidates = [];
  const revCandidates = [];

  // Widened upstream window: 500 bp (was 400) to maximise candidate diversity.
  const fwSearchStart = Math.max(0, anchorStart - 500);
  const fwSearchEnd = Math.max(0, anchorStart - 80);
  for (let pos = fwSearchStart; pos < fwSearchEnd; pos += 1) {
    for (let len = minLen; len <= maxLen; len += 1) {
      const primer = seq.slice(pos, pos + len);
      if (primer.length !== len || primer.includes("N")) continue;
      const gc = calculatePrimerGcPercent(primer);
      if (gc < gcMin || gc > gcMax || hasPrimerHomopolymerRun(primer)) continue;
      const tm = calculateNearestNeighborTm(primer);
      if (tm < tmMin || tm > tmMax) continue;
      const qc = assessPrimerSequence(primer);
      if (qc.selfThreePrimeRun >= 4 || qc.hairpinRun >= 6 || qc.penalty > 22) continue;
      fwCandidates.push({ seq: primer, start: pos, end: pos + len, tm, gc, len, clamp: countThreePrimeClamp(primer) });
    }
  }

  const revSearchStart = Math.min(seq.length, anchorEnd + 80);
  const revSearchEnd = Math.min(seq.length, anchorEnd + 460);
  for (let pos = revSearchStart; pos < revSearchEnd; pos += 1) {
    for (let len = minLen; len <= maxLen; len += 1) {
      if (pos + len > seq.length) break;
      const primer = reverseComplement(seq.slice(pos, pos + len));
      if (primer.includes("N")) continue;
      const gc = calculatePrimerGcPercent(primer);
      if (gc < gcMin || gc > gcMax || hasPrimerHomopolymerRun(primer)) continue;
      const tm = calculateNearestNeighborTm(primer);
      if (tm < tmMin || tm > tmMax) continue;
      const qc = assessPrimerSequence(primer);
      if (qc.selfThreePrimeRun >= 4 || qc.hairpinRun >= 6 || qc.penalty > 22) continue;
      revCandidates.push({ seq: primer, start: pos, end: pos + len, tm, gc, len, clamp: countThreePrimeClamp(primer) });
    }
  }

  const pairs = [];
  for (const fw of fwCandidates) {
    for (const rev of revCandidates) {
      const amp = rev.end - fw.start;
      if (amp < minAmp || amp > maxAmp) continue;
      if (Math.abs(fw.tm - rev.tm) > tmDelta) continue;
      if (reverseComplement(fw.seq.slice(-4)) === rev.seq.slice(-4)) continue;
      const quality = summarizePrimerPairQuality(fw.seq, rev.seq);
      if (quality.heteroThreePrimeRun >= 4 || quality.penalty > 30) continue;
      const ampliconGc = calculatePrimerGcPercent(seq.slice(fw.start, rev.end));
      const score = scoreValidatedPrimerPair(fw, rev, amp, desiredAmp, 0, quality);
      pairs.push(buildPrimerCandidatePair(fw, rev, { amp, ampliconGc, score, quality }));
    }
  }
  if (pairs.length) return pairs.sort((left, right) => right.score - left.score).slice(0, 5);
  const fallbackAmp = Math.max(48, Math.min(seq.length, desiredAmp));
  const idealStart = Math.max(0, Math.min(Math.max(0, seq.length - fallbackAmp), Math.round(((anchorStart + anchorEnd) / 2) - fallbackAmp / 2)));
  return [buildFallbackPrimerPair(seq, idealStart, Math.min(seq.length, idealStart + fallbackAmp))];
}

export function designOutsideHomologyArmPrimerPairs(seq, homology5Start, homology3End, opts = {}) {
  const {
    minLen = 18,
    maxLen = 26,
    tmMin = 55,
    tmMax = 67,
    gcMin = 38,
    gcMax = 67,
    tmDelta = 5,
    searchWindow = 650,
    desiredOutsideFlank = 120,
    minimumOutsideMargin = 50,
    candidateLimit = 90,
  } = opts;
  const sequence = String(seq || "").toUpperCase();
  const leftBoundary = Math.max(0, Math.min(sequence.length, homology5Start));
  const rightBoundary = Math.max(leftBoundary, Math.min(sequence.length, homology3End));
  const enforcedMargin = Math.max(0, Number(minimumOutsideMargin) || 0);
  const forwardBoundary = Math.max(0, leftBoundary - enforcedMargin);
  const reverseBoundary = Math.min(sequence.length, rightBoundary + enforcedMargin);
  if (forwardBoundary < minLen || sequence.length - reverseBoundary < minLen) return [];

  const protectedLength = Math.max(0, rightBoundary - leftBoundary);
  const minAmp = opts.minAmp ?? Math.max(protectedLength + minLen * 2 + enforcedMargin * 2, protectedLength + 48);
  const maxAmp = opts.maxAmp ?? Math.max(minAmp, protectedLength + searchWindow * 2 + maxLen * 2);
  const desiredAmp = opts.desiredAmp ?? Math.max(minAmp, protectedLength + desiredOutsideFlank * 2);

  const fwCandidates = [];
  const revCandidates = [];
  const fwSearchStart = Math.max(0, forwardBoundary - searchWindow);
  const fwSearchEnd = Math.max(0, forwardBoundary - minLen);
  for (let pos = fwSearchStart; pos <= fwSearchEnd; pos += 1) {
    for (let len = minLen; len <= maxLen; len += 1) {
      if (pos + len > forwardBoundary) continue;
      const primer = sequence.slice(pos, pos + len);
      if (primer.length !== len || primer.includes("N")) continue;
      const gc = calculatePrimerGcPercent(primer);
      if (gc < gcMin || gc > gcMax || hasPrimerHomopolymerRun(primer)) continue;
      const tm = calculateNearestNeighborTm(primer);
      if (tm < tmMin || tm > tmMax) continue;
      const qc = assessPrimerSequence(primer);
      if (qc.selfThreePrimeRun >= 4 || qc.hairpinRun >= 6 || qc.penalty > 22) continue;
      fwCandidates.push({ seq: primer, start: pos, end: pos + len, tm, gc, len, clamp: countThreePrimeClamp(primer) });
    }
  }

  const revSearchEnd = Math.min(sequence.length - minLen, reverseBoundary + searchWindow);
  for (let pos = reverseBoundary; pos <= revSearchEnd; pos += 1) {
    for (let len = minLen; len <= maxLen; len += 1) {
      if (pos + len > sequence.length) break;
      const primer = reverseComplement(sequence.slice(pos, pos + len));
      if (primer.includes("N")) continue;
      const gc = calculatePrimerGcPercent(primer);
      if (gc < gcMin || gc > gcMax || hasPrimerHomopolymerRun(primer)) continue;
      const tm = calculateNearestNeighborTm(primer);
      if (tm < tmMin || tm > tmMax) continue;
      const qc = assessPrimerSequence(primer);
      if (qc.selfThreePrimeRun >= 4 || qc.hairpinRun >= 6 || qc.penalty > 22) continue;
      revCandidates.push({ seq: primer, start: pos, end: pos + len, tm, gc, len, clamp: countThreePrimeClamp(primer) });
    }
  }

  const scoreOutsideCandidate = (candidate, boundary, side) => {
    const flank = side === "forward" ? boundary - candidate.start : candidate.end - boundary;
    return Math.abs(flank - desiredOutsideFlank)
      + Math.abs(candidate.tm - 60) * 8
      + Math.abs(candidate.gc - 50) * 2
      - candidate.clamp * 4;
  };
  const rankedFwCandidates = fwCandidates
    .sort((left, right) => scoreOutsideCandidate(left, leftBoundary, "forward") - scoreOutsideCandidate(right, leftBoundary, "forward"))
    .slice(0, candidateLimit);
  const rankedRevCandidates = revCandidates
    .sort((left, right) => scoreOutsideCandidate(left, rightBoundary, "reverse") - scoreOutsideCandidate(right, rightBoundary, "reverse"))
    .slice(0, candidateLimit);

  const pairs = [];
  for (const fw of rankedFwCandidates) {
    for (const rev of rankedRevCandidates) {
      const amp = rev.end - fw.start;
      if (amp < minAmp || amp > maxAmp) continue;
      if (Math.abs(fw.tm - rev.tm) > tmDelta) continue;
      if (reverseComplement(fw.seq.slice(-4)) === rev.seq.slice(-4)) continue;
      const quality = summarizePrimerPairQuality(fw.seq, rev.seq);
      if (quality.heteroThreePrimeRun >= 4 || quality.penalty > 30) continue;
      const leftFlank = leftBoundary - fw.start;
      const rightFlank = rev.end - rightBoundary;
      const placementPenalty = (Math.abs(leftFlank - desiredOutsideFlank) + Math.abs(rightFlank - desiredOutsideFlank)) / 25;
      const ampliconGc = calculatePrimerGcPercent(sequence.slice(fw.start, rev.end));
      const score = scoreValidatedPrimerPair(fw, rev, amp, desiredAmp, placementPenalty, quality);
      pairs.push(buildPrimerCandidatePair(fw, rev, {
        amp,
        ampliconGc,
        score,
        quality,
        leftOutsideMargin: leftBoundary - fw.end,
        rightOutsideMargin: rev.start - rightBoundary,
        minimumOutsideMargin: enforcedMargin,
      }));
    }
  }
  if (pairs.length) return pairs.sort((left, right) => right.score - left.score).slice(0, 5);

  const fallbackFwLen = Math.min(24, maxLen, forwardBoundary);
  const fallbackRevLen = Math.min(24, maxLen, sequence.length - reverseBoundary);
  if (fallbackFwLen < minLen || fallbackRevLen < minLen) return [];
  const fwStart = forwardBoundary - fallbackFwLen;
  const revStart = reverseBoundary;
  const fwSeq = sequence.slice(fwStart, forwardBoundary);
  const revSeq = reverseComplement(sequence.slice(revStart, revStart + fallbackRevLen));
  const fallback = buildPrimerCandidatePair(
    {
      seq: fwSeq,
      start: fwStart,
      end: forwardBoundary,
      tm: calculateNearestNeighborTm(fwSeq),
      gc: calculatePrimerGcPercent(fwSeq),
      len: fwSeq.length,
      clamp: countThreePrimeClamp(fwSeq),
    },
    {
      seq: revSeq,
      start: revStart,
      end: revStart + fallbackRevLen,
      tm: calculateNearestNeighborTm(revSeq),
      gc: calculatePrimerGcPercent(revSeq),
      len: revSeq.length,
      clamp: countThreePrimeClamp(revSeq),
    },
    {
      amp: revStart + fallbackRevLen - fwStart,
      ampliconGc: calculatePrimerGcPercent(sequence.slice(fwStart, revStart + fallbackRevLen)),
      score: -999,
      leftOutsideMargin: leftBoundary - forwardBoundary,
      rightOutsideMargin: reverseBoundary - rightBoundary,
      minimumOutsideMargin: enforcedMargin,
    },
  );
  return [fallback];
}

function buildOutsideHomologyPrimerWarning(seq, homology5Start, homology3End, primerPairs = []) {
  const sequenceLength = String(seq || "").length;
  if (primerPairs[0]?.score <= -900) return "Only fallback primers could be placed outside the homology arms; review primer QC before ordering.";
  const selected = primerPairs[0];
  if (selected && Number.isFinite(selected.minimumOutsideMargin)
    && (selected.leftOutsideMargin < selected.minimumOutsideMargin || selected.rightOutsideMargin < selected.minimumOutsideMargin)) {
    return `Primer margin is below the required ${selected.minimumOutsideMargin} bp outside one or both homology arms.`;
  }
  if (primerPairs.length) return "";
  const missing = [];
  if (homology5Start < 18) missing.push("upstream of the 5' homology arm");
  if (sequenceLength - homology3End < 18) missing.push("downstream of the 3' homology arm");
  if (missing.length) {
    return `Outside-homology-arm primers need at least 18 bp of reference sequence ${missing.join(" and ")}. Upload a reference with additional flank or shorten the homology arms.`;
  }
  return "No validated primer pair could be placed outside both homology arms; review this locus manually.";
}

function getOutsideHomologyPrimerStrategy(primerPairs = []) {
  if (!primerPairs.length) return "outside-homology-arms-unavailable";
  if (primerPairs[0]?.score <= -900) return "outside-homology-arms-fallback";
  return "recommended-outside-homology-arms";
}

function scorePrimerSequence(primer) {
  const seq = String(primer || "").toUpperCase();
  if (!seq) return Number.MAX_SAFE_INTEGER;
  const gcCount = [...seq].filter((base) => base === "G" || base === "C").length;
  const gcPercent = (gcCount / seq.length) * 100;
  let score = Math.abs(gcPercent - 50);
  if (/(A{5,}|T{5,}|G{5,}|C{5,})/.test(seq)) score += 20;
  if (/AAAA|TTTT/.test(seq)) score += 6;
  const lastBase = seq[seq.length - 1];
  if (lastBase !== "G" && lastBase !== "C") score += 4;
  return score;
}

// A candidate primer is fully determined by its (start, length, orientation); nothing
// about the enclosing amplicon changes it. The amplicon/offset sweeps in the primer
// searches revisit the same combinations tens of thousands of times, and each visit ran
// assessPrimerSequence, which performs several O(length^2) alignments. Evaluating each
// distinct candidate once is what keeps a single design under a second instead of the
// 45-60 s it used to spend blocking the browser main thread.
//
// Returns { primer, qc } so callers can hand the cached assessment to
// summarizePrimerPairQuality instead of making it re-assess both primers per pair. The
// qc is deliberately kept off the primer object so emitted results keep their shape.
function createPrimerCandidateEvaluator(seq, bounds) {
  const { minLen, tmMin, tmMax, gcMin, gcMax } = bounds;
  const cache = new Map();
  return function evaluateCandidate(start, len, orientation) {
    const key = `${orientation}:${start}:${len}`;
    if (cache.has(key)) return cache.get(key);
    let entry = null;
    const window = seq.slice(start, start + len);
    // The N check must run on the oriented primer, not the raw window:
    // reverseComplement maps any non-ACGT base to N, so checking after orientation is
    // what rejects IUPAC ambiguity codes on the reverse strand. Checking the raw
    // window instead would silently let a primer containing N through.
    const primer = window.length === len && orientation === "rev" ? reverseComplement(window) : window;
    if (window.length === len && len >= minLen && !primer.includes("N")) {
      const gc = calculatePrimerGcPercent(primer);
      if (gc >= gcMin && gc <= gcMax && !hasPrimerHomopolymerRun(primer)) {
        const tm = calculateNearestNeighborTm(primer);
        if (tm >= tmMin && tm <= tmMax) {
          const qc = assessPrimerSequence(primer);
          if (qc.selfThreePrimeRun < 4 && qc.hairpinRun < 6 && qc.penalty <= 22) {
            entry = {
              primer: { seq: primer, start, end: start + len, tm, gc, len, clamp: countThreePrimeClamp(primer) },
              qc,
            };
          }
        }
      }
    }
    cache.set(key, entry);
    return entry;
  };
}

export function designCenteredPrimerPairs(seq, center, opts = {}) {
  const {
    minAmp = 430,
    maxAmp = 650,
    desiredAmp = 475,
    minLen = 18,
    maxLen = 26,
    tmMin = 55,
    tmMax = 67,
    gcMin = 38,
    gcMax = 67,
    tmDelta = 5,
    maxOffset = 35,
    // ICE/TIDE mode: place the cut ~iceTideOffset bp downstream of the Fw primer
    // start rather than at the amplicon center. Recommended: 175 bp for Sanger + ICE.
    // Set to 0 (default) to preserve the original centering behaviour.
    iceTideOffset = 0,
  } = opts;
  const minLength = Math.max(minLen * 2, minAmp);
  const maxLength = Math.max(minLength, maxAmp);

  const evaluateCandidate = createPrimerCandidateEvaluator(seq, { minLen, tmMin, tmMax, gcMin, gcMax });

  const pairs = [];
  for (let ampliconLength = minLength; ampliconLength <= maxLength; ampliconLength += 1) {
    const maxStart = Math.max(0, seq.length - ampliconLength);
    // When iceTideOffset > 0, anchor the Fw primer start so the cut falls at
    // the desired distance; otherwise centre as before.
    const idealStart = iceTideOffset > 0
      ? Math.round(center - iceTideOffset)
      : Math.round(center - ampliconLength / 2);

    // Clamping collapses many offsets onto the same amplicon start. Without this the
    // identical placement is re-scored and pushed repeatedly, so a single placement
    // could occupy several of the five "alternative" slots returned below.
    const ampliconStarts = new Set();
    for (let offset = -maxOffset; offset <= maxOffset; offset += 1) {
      ampliconStarts.add(Math.max(0, Math.min(maxStart, idealStart + offset)));
    }

    for (const ampliconStart of ampliconStarts) {
      const ampliconEnd = ampliconStart + ampliconLength;
      // Placement penalty: penalise deviation from desired cut position within amplicon.
      const placementPenalty = iceTideOffset > 0
        ? Math.abs((center - ampliconStart) - iceTideOffset) / 5
        : Math.abs(center - (ampliconStart + ampliconLength / 2)) / 5;
      // Amplicon GC — flag anything > 65 %.
      const ampliconGc = calculatePrimerGcPercent(seq.slice(ampliconStart, ampliconEnd));
      for (let fwLen = minLen; fwLen <= maxLen; fwLen += 1) {
        const fwEntry = evaluateCandidate(ampliconStart, fwLen, "fw");
        if (!fwEntry) continue;
        const fw = fwEntry.primer;
        for (let revLen = minLen; revLen <= maxLen; revLen += 1) {
          const revStart = ampliconEnd - revLen;
          if (revStart <= fw.end) continue;
          const revEntry = evaluateCandidate(revStart, revLen, "rev");
          if (!revEntry) continue;
          const rev = revEntry.primer;
          if (Math.abs(fw.tm - rev.tm) > tmDelta) continue;
          if (reverseComplement(fw.seq.slice(-4)) === rev.seq.slice(-4)) continue;
          const quality = summarizePrimerPairQuality(fw.seq, rev.seq, { forward: fwEntry.qc, reverse: revEntry.qc });
          if (quality.heteroThreePrimeRun >= 4 || quality.penalty > 30) continue;
          const score = scoreValidatedPrimerPair(fw, rev, ampliconLength, desiredAmp, placementPenalty, quality);
          pairs.push(buildPrimerCandidatePair(fw, rev, { amp: ampliconLength, ampliconGc, score, quality }));
        }
      }
    }
  }
  if (pairs.length) return pairs.sort((left, right) => right.score - left.score).slice(0, 5);
  const fallbackLength = Math.max(48, Math.min(seq.length, desiredAmp));
  const maxStart = Math.max(0, seq.length - fallbackLength);
  const ampliconStart = Math.max(0, Math.min(maxStart, Math.round(center - fallbackLength / 2)));
  return [buildFallbackPrimerPair(seq, ampliconStart, Math.min(seq.length, ampliconStart + fallbackLength))];
}

function pickCenteredPrimerPair(seq, center, minAmpliconLength = 450, maxAmpliconLength = 500) {
  const best = designCenteredPrimerPairs(seq, center, { minAmp: minAmpliconLength, maxAmp: maxAmpliconLength, desiredAmp: Math.round((minAmpliconLength + maxAmpliconLength) / 2) })[0];
  return {
    forward: best.fw.seq,
    reverse: best.rev.seq,
    ampliconLength: best.amp,
    score: best.score,
    fw: best.fw,
    rev: best.rev,
  };
}

const KO_LONG_DELETION_THRESHOLD = 1000;
const KO_DELETION_SCREEN_FLANK = 250;

export function designDeletionScreenPrimerPairs(seq, leftCut, rightCut, flank = KO_DELETION_SCREEN_FLANK, opts = {}) {
  const {
    minLen = 18,
    maxLen = 26,
    tmMin = 55,
    tmMax = 67,
    gcMin = 38,
    gcMax = 67,
    tmDelta = 5,
    offsetWindow = 40,
  } = opts;
  const maxStart = Math.max(0, seq.length - minLen);
  const desiredForwardStart = Math.max(0, Math.min(maxStart, leftCut - flank));
  const desiredReverseStart = Math.max(0, Math.min(maxStart, rightCut + flank - minLen));
  const evaluateCandidate = createPrimerCandidateEvaluator(seq, { minLen, tmMin, tmMax, gcMin, gcMax });

  const pairs = [];
  for (let forwardOffset = -offsetWindow; forwardOffset <= offsetWindow; forwardOffset += 1) {
    const forwardStart = Math.max(0, Math.min(maxStart, desiredForwardStart + forwardOffset));
    for (let fwLen = minLen; fwLen <= maxLen; fwLen += 1) {
      const fwEntry = evaluateCandidate(forwardStart, fwLen, "fw");
      if (!fwEntry) continue;
      const fw = fwEntry.primer;
      for (let reverseOffset = -offsetWindow; reverseOffset <= offsetWindow; reverseOffset += 1) {
        for (let revLen = minLen; revLen <= maxLen; revLen += 1) {
          const reverseStart = Math.max(fw.end + 50, Math.min(Math.max(0, seq.length - revLen), desiredReverseStart + reverseOffset));
          const revEntry = evaluateCandidate(reverseStart, revLen, "rev");
          if (!revEntry) continue;
          const rev = revEntry.primer;
          if (Math.abs(fw.tm - rev.tm) > tmDelta) continue;
          const quality = summarizePrimerPairQuality(fw.seq, rev.seq, { forward: fwEntry.qc, reverse: revEntry.qc });
          if (quality.heteroThreePrimeRun >= 4 || quality.penalty > 30) continue;
          const wtAmpliconLength = reverseStart + revLen - forwardStart;
          const deletionAmpliconLength = Math.max(minLen * 2, (leftCut - forwardStart) + ((reverseStart + revLen) - rightCut));
          const leftFlankPenalty = Math.abs((leftCut - forwardStart) - flank);
          const rightFlankPenalty = Math.abs(((reverseStart + revLen) - rightCut) - flank);
          const score = scoreValidatedPrimerPair(fw, rev, deletionAmpliconLength, 500, (leftFlankPenalty + rightFlankPenalty) / 20, quality);
          pairs.push(buildPrimerCandidatePair(fw, rev, { amp: deletionAmpliconLength, wtAmpliconLength, deletionAmpliconLength, score, quality }));
        }
      }
    }
  }
  if (pairs.length) return pairs.sort((left, right) => right.score - left.score).slice(0, 5);
  const fallbackForwardStart = desiredForwardStart;
  const fallbackReverseStart = Math.max(fallbackForwardStart + 74, desiredReverseStart);
  const fallback = buildFallbackPrimerPair(seq, fallbackForwardStart, Math.min(seq.length, fallbackReverseStart + 24));
  fallback.wtAmpliconLength = (fallback.rev?.end || 0) - (fallback.fw?.start || 0);
  fallback.deletionAmpliconLength = Math.max(48, (leftCut - fallbackForwardStart) + ((fallback.rev?.end || fallbackReverseStart + 24) - rightCut));
  fallback.amp = fallback.deletionAmpliconLength;
  return [fallback];
}

export function designPrimerTool(sequenceInput, config = {}) {
  const sequence = String(sequenceInput || "").toUpperCase().replace(/[^ACGTN]/g, "");
  if (!sequence) return { err: "Paste a DNA sequence or upload a GenBank file first." };
  if (sequence.length < 120) return { err: "Reference sequence must be at least 120 bp long for primer design." };

  const mode = config.mode || "centered";
  const primerNamePrefix = String(config.primerNamePrefix || "Primer");
  const minAmp = parseInt(config.minAmp, 10);
  const maxAmp = parseInt(config.maxAmp, 10);
  const desiredAmp = parseInt(config.desiredAmp, 10);

  const normalizedPrimerConfig = {
    minAmp: Number.isFinite(minAmp) ? minAmp : VALIDATION_PRIMER_MIN_AMP,
    maxAmp: Number.isFinite(maxAmp) ? maxAmp : VALIDATION_PRIMER_MAX_AMP,
    desiredAmp: Number.isFinite(desiredAmp) ? desiredAmp : VALIDATION_PRIMER_TARGET_AMP,
  };

  let primerPairs = [];
  let strategy = "";
  let targetSummary = "";
  let ampliconSummary = "";
  let target = null;

  if (mode === "centered") {
    const centerOneBased = parseInt(config.center, 10);
    if (!Number.isFinite(centerOneBased) || centerOneBased < 1 || centerOneBased > sequence.length) {
      return { err: `Centered primer mode needs a valid 1-based target position between 1 and ${sequence.length}.` };
    }
    const centerZeroBased = centerOneBased - 1;
    primerPairs = designCenteredPrimerPairs(sequence, centerZeroBased, normalizedPrimerConfig);
    strategy = "recommended-centered";
    targetSummary = `Centered around position ${centerOneBased}`;
    ampliconSummary = `~${primerPairs[0]?.amp || normalizedPrimerConfig.desiredAmp} bp`;
    target = { mode, center: centerOneBased };
  } else if (mode === "flanking") {
    const startOneBased = parseInt(config.intervalStart, 10);
    const endOneBased = parseInt(config.intervalEnd, 10);
    if (!Number.isFinite(startOneBased) || !Number.isFinite(endOneBased) || startOneBased < 1 || endOneBased > sequence.length || startOneBased > endOneBased) {
      return { err: `Flanking primer mode needs a valid 1-based interval within 1-${sequence.length}.` };
    }
    const anchorStart = startOneBased - 1;
    const anchorEnd = endOneBased;
    primerPairs = designFlankingPrimerPairs(sequence, anchorStart, anchorEnd, normalizedPrimerConfig);
    strategy = "recommended-flanking";
    targetSummary = `Flanking interval ${startOneBased}-${endOneBased}`;
    ampliconSummary = `~${primerPairs[0]?.amp || normalizedPrimerConfig.desiredAmp} bp`;
    target = { mode, intervalStart: startOneBased, intervalEnd: endOneBased };
  } else if (mode === "deletion") {
    const leftCutOneBased = parseInt(config.leftCut, 10);
    const rightCutOneBased = parseInt(config.rightCut, 10);
    const flank = parseInt(config.flank, 10);
    if (!Number.isFinite(leftCutOneBased) || !Number.isFinite(rightCutOneBased) || leftCutOneBased < 1 || rightCutOneBased > sequence.length || leftCutOneBased >= rightCutOneBased) {
      return { err: `Deletion screen mode needs two valid 1-based cut positions within 1-${sequence.length}.` };
    }
    primerPairs = designDeletionScreenPrimerPairs(sequence, leftCutOneBased - 1, rightCutOneBased - 1, Number.isFinite(flank) ? flank : KO_DELETION_SCREEN_FLANK);
    strategy = "recommended-deletion-screen";
    ampliconSummary = `WT ~${primerPairs[0]?.wtAmpliconLength || "n/a"} bp | deletion ~${primerPairs[0]?.deletionAmpliconLength || "n/a"} bp`;
    targetSummary = `Deletion screen across cuts ${leftCutOneBased} and ${rightCutOneBased}`;
    target = { mode, leftCut: leftCutOneBased, rightCut: rightCutOneBased, flank: Number.isFinite(flank) ? flank : KO_DELETION_SCREEN_FLANK };
  } else {
    return { err: `Unsupported primer design mode: ${mode}.` };
  }

  const primerPair = primerPairs[0];
  if (!primerPair?.fw?.seq || !primerPair?.rev?.seq) return { err: "No primer pair could be generated from the supplied sequence." };

  return {
    type: "primer-tool",
    strategy,
    targetSummary,
    amp: ampliconSummary,
    target,
    sequenceLength: sequence.length,
    ps: [
      buildPrimerRecord(`${primerNamePrefix}_Fw`, primerPair.fw.seq),
      buildPrimerRecord(`${primerNamePrefix}_Rev`, primerPair.rev.seq),
    ],
    primerCandidates: serializePrimerCandidates(primerPairs),
  };
}

function pickDeletionScreenPrimerPair(seq, leftCut, rightCut, flank = KO_DELETION_SCREEN_FLANK) {
  const best = designDeletionScreenPrimerPairs(seq, leftCut, rightCut, flank)[0];
  return {
    forward: best.fw.seq,
    reverse: best.rev.seq,
    wtAmpliconLength: best.wtAmpliconLength,
    deletionAmpliconLength: best.deletionAmpliconLength,
    score: best.score,
    fw: best.fw,
    rev: best.rev,
  };
}

function selectKoGuidePair(guides, maxSpacing = 140) {
  const candidatePairs = [];
  for (let leftIndex = 0; leftIndex < guides.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < guides.length; rightIndex += 1) {
      const leftGuide = guides[leftIndex];
      const rightGuide = guides[rightIndex];
      const spacing = Math.abs(rightGuide.cut - leftGuide.cut);
      if (spacing > maxSpacing) continue;
      candidatePairs.push({
        guides: leftGuide.cut <= rightGuide.cut ? [leftGuide, rightGuide] : [rightGuide, leftGuide],
        spacing,
        preferredSpacing: spacing >= 40 && spacing <= 140,
        oppositeStrands: leftGuide.str !== rightGuide.str,
        score: leftGuide.gc + rightGuide.gc,
      });
    }
  }
  candidatePairs.sort((left, right) => {
    if (left.preferredSpacing !== right.preferredSpacing) return left.preferredSpacing ? -1 : 1;
    if (left.oppositeStrands !== right.oppositeStrands) return left.oppositeStrands ? -1 : 1;
    if (right.score !== left.score) return right.score - left.score;
    if (left.preferredSpacing && right.preferredSpacing) return Math.abs(left.spacing - 90) - Math.abs(right.spacing - 90);
    return right.spacing - left.spacing;
  });
  return candidatePairs[0] || null;
}

/**
 * Guide selection for co-delivery.
 *
 * selectNearbyGuidesForModel picks the closest guide and one distinct partner, judged only
 * on proximity and strand. That is the right objective for a single matched guide/donor
 * pair, and the wrong one when both guides go into the same well: there, the pair is only
 * usable if BOTH targets can be silently destroyed, and the closest pair frequently cannot
 * be. This searches the whole candidate set in the window and prefers pairs where each
 * guide admits a strong (PAM-destroying) synonymous change, falling back to proximity when
 * no such pair exists.
 */
function selectCoDeliveryGuidesWithFallback(model, targetPos, reservedPositions, silentOptions = {}) {
  const minimumAlternativeCutOffset = 10;
  for (const window of [10, 20, 30]) {
    const candidates = findSpCas9Guides(model, reverseComplement, targetPos, window)
      .slice()
      .sort((left, right) => Math.abs(left.d) - Math.abs(right.d));
    if (!candidates.length) continue;

    const scored = candidates.map((guide) => {
      // Scored with the same strategy the design will use. Scoring by a single change while
      // the design stacks up to three under-rated every guide whose PAM cannot be killed but
      // whose seed can be mismatched - so selection preferred the wrong guides.
      const blockingSet = findBlockingSet(model, guide, new Set(reservedPositions), silentOptions);
      return { guide, stronglyBlockable: gradeBlockingSet(blockingSet).tier === "strong" };
    });
    const tier = window === 10 ? "preferred" : window === 20 ? "fallback" : "distant fallback";

    let best = null;
    for (let i = 0; i < scored.length; i += 1) {
      for (let j = i + 1; j < scored.length; j += 1) {
        const left = scored[i];
        const right = scored[j];
        if (Math.abs(left.guide.cut - right.guide.cut) < minimumAlternativeCutOffset) continue;
        // Both strongly blockable dominates everything else; opposite strands are preferred
        // as before; proximity breaks remaining ties.
        const strongCount = (left.stronglyBlockable ? 1 : 0) + (right.stronglyBlockable ? 1 : 0);
        const oppositeStrand = left.guide.str !== right.guide.str ? 1 : 0;
        const proximity = Math.abs(left.guide.d) + Math.abs(right.guide.d);
        const score = strongCount * 1000 + oppositeStrand * 10 - proximity / 1000;
        if (!best || score > best.score) {
          best = { score, strongCount, guides: [left.guide, right.guide] };
        }
      }
    }
    const bestSingle = scored.find((entry) => entry.stronglyBlockable) || null;
    if (best) {
      return {
        guides: best.guides,
        window,
        tier,
        coDeliverySelection: {
          searched: candidates.length,
          stronglyBlockableSelected: best.strongCount,
          allStronglyBlockable: best.strongCount === 2,
          // Co-delivery is a choice, not a free upgrade: at some sites the best two-guide
          // pair is less well protected than a single guide would be. Say so rather than
          // silently handing over the weaker design.
          singleGuideAlternative: best.strongCount < 2 && bestSingle
            ? { spacer: bestSingle.guide.sp, pam: bestSingle.guide.pam, strand: bestSingle.guide.str }
            : null,
        },
      };
    }
    return {
      guides: [scored[0].guide],
      window,
      tier,
      coDeliverySelection: {
        searched: candidates.length,
        stronglyBlockableSelected: scored[0].stronglyBlockable ? 1 : 0,
        allStronglyBlockable: !!scored[0].stronglyBlockable,
        note: "Only one guide with a distinct cut site was available in this window.",
      },
    };
  }
  return null;
}

/**
 * Guides near the edit, nearest window first.
 *
 * With `preferBlockable`, guides whose target can be adequately disrupted by synonymous
 * changes are ranked ahead of guides that cannot, *within the same distance window*. The
 * order of those two criteria is the whole point: HDR efficiency falls steeply with the
 * distance between the cut and the edit, so a well-behaved guide far away loses to a usable
 * one nearby. Widening the search is only worth it when the near window has nothing.
 *
 * Guides that cannot be blocked are still offered rather than discarded - they are ranked
 * last, and the per-pair release state refuses them. Dropping them silently would leave a
 * designer unable to see why a site is difficult, and some sites have nothing better.
 */
/**
 * Blockability first, distance second - the order is the point.
 *
 * HDR efficiency falls steeply with the distance between the cut and the edit, so a guide
 * that is easier to block but much further away is not automatically better. Ranking within
 * a distance window keeps that trade honest.
 */
export function compareGuidesByProtectionThenDistance(left, right) {
  return left.rank - right.rank || left.index - right.index;
}

export const PROTECTION_RANK = Object.freeze({ strong: 0, moderate: 1, weak: 2, none: 3 });

function selectInsertGuidesWithFallback(model, targetPos, options = {}) {
  const windows = [10, 20, 30];
  const preferBlockable = !!options.preferBlockable;
  for (const window of windows) {
    let guides;
    if (preferBlockable) {
      // Every candidate in the window is scored before the pair is chosen. Choosing the pair
      // first (selectNearbyGuidesForModel: nearest guide, then a distinct partner) and ranking
      // afterwards meant a better-protected guide within 10 bp of the nearest guide's cut was
      // never scored at all. Distance order is preserved inside a class: candidates are
      // nearest-first and `index` keeps that as the final tie-break.
      const candidates = findSpCas9Guides(model, reverseComplement, targetPos, window)
        .sort((left, right) => Math.abs(left.d) - Math.abs(right.d));
      const entries = candidates.map((guide, index) => {
        const blockingSet = findBlockingSet(model, guide, new Set(), options.silentOptions || {});
        const tier = gradeBlockingSet(blockingSet).tier;
        return { guide, index, rank: PROTECTION_RANK[tier] ?? PROTECTION_RANK.none };
      });
      guides = pickGuidePair(entries, { minimumCutOffset: MINIMUM_ALTERNATIVE_CUT_OFFSET });
    } else {
      guides = selectNearbyGuidesForModel(model, reverseComplement, targetPos, window);
    }
    if (!guides.length) continue;
    return {
      guides,
      window,
      tier: window === 10 ? "preferred" : window === 20 ? "fallback" : "distant fallback",
    };
  }
  return null;
}

function normalizeCustomSpacer(spacer) {
  return String(spacer || "").toUpperCase().replace(/[^ACGT]/g, "");
}

function findGuideMatchesForSpacer(model, spacer, targetPos = null) {
  const seq = getGenomicSequence(model);
  const cleanSpacer = normalizeCustomSpacer(spacer);
  if (cleanSpacer.length !== 20) return [];
  const matches = [];
  for (let pos = 0; pos <= seq.length - 23; pos += 1) {
    const plusSpacer = seq.slice(pos, pos + 20);
    const plusPam = seq.slice(pos + 20, pos + 23);
    if (plusSpacer === cleanSpacer && /GG$/.test(plusPam)) {
      const cut = pos + 17;
      matches.push({
        sp: cleanSpacer,
        pam: plusPam,
        str: "+",
        cut,
        d: Number.isFinite(targetPos) ? cut - targetPos : null,
        gc: Math.round((cleanSpacer.split("").filter((base) => base === "G" || base === "C").length / 20) * 100),
        ps: pos,
      });
    }
    const minusPam = seq.slice(pos, pos + 3);
    const minusSpacer = reverseComplement(seq.slice(pos + 3, pos + 23));
    if (minusSpacer === cleanSpacer && /^CC/.test(minusPam)) {
      const cut = pos + 6;
      matches.push({
        sp: cleanSpacer,
        pam: reverseComplement(minusPam),
        str: "-",
        cut,
        d: Number.isFinite(targetPos) ? cut - targetPos : null,
        gc: Math.round((cleanSpacer.split("").filter((base) => base === "G" || base === "C").length / 20) * 100),
        ps: pos,
      });
    }
  }
  matches.sort((left, right) => {
    const leftDistance = Number.isFinite(left.d) ? Math.abs(left.d) : Number.MAX_SAFE_INTEGER;
    const rightDistance = Number.isFinite(right.d) ? Math.abs(right.d) : Number.MAX_SAFE_INTEGER;
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    return left.cut - right.cut;
  });
  return matches;
}

function resolveCustomGuides(model, spacers, targetPos, options = {}) {
  const maxDistance = Number.isFinite(options.maxDistance) ? options.maxDistance : null;
  const desiredCount = Number.isFinite(options.desiredCount) ? options.desiredCount : 2;
  const seenSites = new Set();
  const selected = [];
  for (const rawSpacer of spacers || []) {
    const cleanSpacer = normalizeCustomSpacer(rawSpacer);
    if (!cleanSpacer) continue;
    if (cleanSpacer.length !== 20) return { err: `Custom gRNA "${rawSpacer}" must be a 20 nt spacer.` };
    const matches = findGuideMatchesForSpacer(model, cleanSpacer, targetPos).filter((guide) => {
      if (maxDistance === null) return true;
      return Number.isFinite(guide.d) && Math.abs(guide.d) <= maxDistance;
    });
    if (!matches.length) {
      if (maxDistance === null) return { err: `Custom gRNA ${cleanSpacer} could not be mapped to the reference sequence.` };
      return { err: `Custom gRNA ${cleanSpacer} does not map within ${maxDistance} bp of the target site.` };
    }
    const chosen = matches.find((guide) => !seenSites.has(`${guide.ps}:${guide.str}`)) || matches[0];
    seenSites.add(`${chosen.ps}:${chosen.str}`);
    selected.push(chosen);
    if (selected.length >= desiredCount) break;
  }
  if (!selected.length) return null;
  return {
    guides: selected,
    window: selected.reduce((max, guide) => Math.max(max, Number.isFinite(guide.d) ? Math.abs(guide.d) : 0), 0),
    tier: "custom",
  };
}

function buildInsertGuideNote(guide, anchorLabel, tier, window) {
  if (tier === "custom") return `Custom gRNA | cut ${Math.abs(guide.d)} bp ${guide.d < 0 ? "5-prime" : "3-prime"} of ${anchorLabel}`;
  const relativeLabel = guide.d < 0 ? "5-prime" : "3-prime";
  const tierLabel = tier === "preferred" ? "preferred window" : tier === "fallback" ? "fallback window" : "distant fallback";
  return `Cut ${Math.abs(guide.d)} bp ${relativeLabel} of ${anchorLabel} | ${tierLabel} <=${window} bp`;
}

function buildPointMutationGuideNote(guide, tier, window) {
  if (tier === "custom") return `Custom gRNA | cut-to-edit distance ${Math.abs(guide.d)} bp`;
  const tierLabel = tier === "preferred" ? "preferred window" : tier === "fallback" ? "fallback window" : "distant fallback";
  return `Cut-to-edit distance ${Math.abs(guide.d)} bp | ${tierLabel} <=${window} bp`;
}

function appendGuideContext(note, model, guide) {
  const context = describeGuidePlacementFromModel(model, guide);
  if (!context?.label) return note;
  return `${note} | ${context.label}: ${context.detail}`;
}

function getGuideSpan(guide) {
  return { start: guide.ps, end: guide.ps + 23 };
}

function guideOverlapsReplacement(guide, replaceStart, replaceEnd) {
  const { start, end } = getGuideSpan(guide);
  return start < replaceEnd && end > replaceStart;
}

function classifyGuideReplacementProtection(guide, replaceStart, replaceEnd, insertionSite = replaceStart) {
  const { start, end } = getGuideSpan(guide);
  const overlapsReplacement = guideOverlapsReplacement(guide, replaceStart, replaceEnd);
  const splitsTarget = insertionSite > start && insertionSite < end;
  if (overlapsReplacement || splitsTarget) {
    return {
      protected: true,
      tier: "strong",
      reason: splitsTarget
        ? "The cassette insertion splits the original protospacer/PAM sequence."
        : "The replacement removes bases from the original protospacer/PAM sequence.",
    };
  }
  return { protected: false, tier: "none", reason: "The insertion does not disrupt this guide target." };
}

function parsePointMutationInput(value) {
  const normalized = String(value || "").trim().replace(/^p\./i, "").replace(/\s+/g, "").toUpperCase();
  const canonical = normalized.match(/^([A-Z])(\d+)([A-Z])$/);
  if (canonical) return { wtAA: canonical[1], aaNumber: parseInt(canonical[2], 10), mutAA: canonical[3] };

  const reversed = normalized.match(/^(\d+)([A-Z])([A-Z])$/);
  if (reversed) {
    return {
      err: `Use mutation format ${reversed[2]}${reversed[1]}${reversed[3]}, not ${normalized}. The app expects WT-position-mutant, for example G96S.`,
    };
  }

  const delimited = normalized.match(/^([A-Z])[-_/]?(\d+)[-_/]?([A-Z])$/);
  if (delimited) return { wtAA: delimited[1], aaNumber: parseInt(delimited[2], 10), mutAA: delimited[3] };

  return { err: "Cannot parse mutation. Use WT-position-mutant format such as G96S or p.G96S." };
}

function parseInternalSiteInput(value) {
  const normalized = String(value || "").trim().replace(/^after\s+/i, "").replace(/\s+/g, "").toUpperCase();
  const withResidue = normalized.match(/^([A-Z])(\d+)$/);
  if (withResidue) return { wtAA: withResidue[1], aaNumber: parseInt(withResidue[2], 10) };
  const numeric = normalized.match(/^(\d+)$/);
  if (numeric) return { wtAA: "", aaNumber: parseInt(numeric[1], 10) };
  return { err: "Use an internal insertion site such as P155 or 155." };
}

function mkInternalOdn(model, guide, insertionPos, insertSequence, silentMutations = []) {
  const seq = getGenomicSequence(model);
  let donorStart;
  let donorEnd;
  if (guide.str === "+") { donorStart = guide.cut - 36; donorEnd = guide.cut + 91; }
  else { donorStart = guide.cut - 91; donorEnd = guide.cut + 36; }
  const desiredLength = donorEnd - donorStart;
  if (donorStart < 0) {
    donorEnd = Math.min(seq.length, donorEnd - donorStart);
    donorStart = 0;
  }
  if (donorEnd > seq.length) {
    donorStart = Math.max(0, donorStart - (donorEnd - seq.length));
    donorEnd = seq.length;
  }
  if (donorEnd - donorStart < desiredLength && seq.length >= desiredLength) {
    donorStart = Math.max(0, donorEnd - desiredLength);
    donorEnd = Math.min(seq.length, donorStart + desiredLength);
  }
  if (donorStart < 0 || donorEnd > seq.length || donorEnd - donorStart < desiredLength) return null;

  const wtWindow = seq.slice(donorStart, donorEnd);
  const payload = wtWindow.split("");
  const insertIndex = insertionPos - donorStart;
  if (insertIndex < 0 || insertIndex > payload.length) return null;
  payload.splice(insertIndex, 0, ...insertSequence.split(""));

  silentMutations.forEach((mutation) => {
    let donorIndex = mutation.gp - donorStart;
    if (mutation.gp >= insertionPos) donorIndex += insertSequence.length;
    if (donorIndex >= 0 && donorIndex < payload.length) payload[donorIndex] = mutation.nb;
  });

  const donorSense = payload.join("");
  const orderSequence = guide.str === "+" ? reverseComplement(donorSense) : donorSense;
  const wtOrder = guide.str === "+" ? reverseComplement(wtWindow) : wtWindow;
  const orderedInsertStart = guide.str === "+" ? donorSense.length - (insertIndex + insertSequence.length) : insertIndex;
  const orderedInsertEnd = orderedInsertStart + insertSequence.length;
  const toSilentDonorIndex = (mutation) => {
    let donorIndex = mutation.gp - donorStart;
    if (mutation.gp >= insertionPos) donorIndex += insertSequence.length;
    return guide.str === "+" ? donorSense.length - 1 - donorIndex : donorIndex;
  };
  // silentIndexes is sorted for rendering, which destroys the correspondence with
  // silentMutations. Callers annotating several blocking changes need the pairing, so it is
  // returned separately rather than reconstructed by position in the array.
  const silentPlacements = silentMutations
    .map((mutation) => ({ gp: mutation.gp, index: toSilentDonorIndex(mutation) }))
    .filter((entry) => Number.isFinite(entry.index));
  const silentIndexes = silentPlacements
    .map((entry) => entry.index)
    .sort((left, right) => left - right);
  const sitePositions = guide.str === "+"
    ? Array.from({ length: 20 }, (_, index) => guide.ps + index)
    : Array.from({ length: 20 }, (_, index) => guide.ps + 3 + index);
  const pamPositions = guide.str === "+"
    ? [guide.ps + 20, guide.ps + 21, guide.ps + 22]
    : [guide.ps, guide.ps + 1, guide.ps + 2];
  const toOrderedIndex = (genomicPos) => {
    let donorIndex = genomicPos - donorStart;
    if (genomicPos >= insertionPos) donorIndex += insertSequence.length;
    if (donorIndex < 0 || donorIndex >= donorSense.length) return -1;
    return guide.str === "+" ? donorSense.length - 1 - donorIndex : donorIndex;
  };

  return {
    od: orderSequence,
    wo: wtOrder,
    donorStart,
    donorEnd,
    donorSense,
    insertionPos,
    sl: guide.str === "+" ? "- strand target" : "+ strand target",
    donorSenseLength: donorSense.length,
    insertSequence,
    // insertStart/insertEnd index the ORDER strand (od), which is the reverse complement
    // of donorSense whenever the guide is on the + strand. Anything that needs to read
    // the insert in coding orientation - translation, preset comparison - must use the
    // sense indices below instead.
    insertStart: orderedInsertStart,
    insertEnd: orderedInsertEnd,
    senseInsertStart: insertIndex,
    senseInsertEnd: insertIndex + insertSequence.length,
    silentIndexes,
    silentPlacements,
    guideSiteIndexes: sitePositions.map((position) => toOrderedIndex(position)).filter((index) => index >= 0),
    guidePamIndexes: pamPositions.map((position) => toOrderedIndex(position)).filter((index) => index >= 0),
    silentMutations,
  };
}

function buildInternalProteinPreview(model, aaNumber, insertAa) {
  const wtProtein = [];
  for (let index = 1; index <= model.proteinLength; index += 1) {
    const codonInfo = getCodonAtAa(model, index, toAA);
    wtProtein.push(codonInfo?.aa || "?");
  }
  const donorProtein = wtProtein.slice(0, aaNumber).concat(insertAa.split(""), wtProtein.slice(aaNumber));
  const prefix = Math.max(0, aaNumber - 8);
  const suffix = Math.min(wtProtein.length, aaNumber + 8);
  return {
    wtPrefix: wtProtein.slice(prefix, aaNumber).join(""),
    wtAnchor: wtProtein[aaNumber - 1] || "?",
    wtSuffix: wtProtein.slice(aaNumber, suffix).join(""),
    donorPrefix: donorProtein.slice(prefix, aaNumber).join(""),
    insertAa,
    donorSuffix: donorProtein.slice(aaNumber + insertAa.length, aaNumber + insertAa.length + (suffix - aaNumber)).join(""),
  };
}

function buildInternalCodingPreview(model, aaNumber, insertSequence, insertAa) {
  const prefixStart = Math.max(1, aaNumber - 7);
  const suffixEnd = Math.min(model.proteinLength, aaNumber + 8);
  const prefixEntries = [];
  const suffixEntries = [];
  for (let index = prefixStart; index <= aaNumber; index += 1) {
    const codonInfo = getCodonAtAa(model, index, toAA);
    if (codonInfo) prefixEntries.push({ codon: codonInfo.cod, aa: codonInfo.aa === "*" ? "Stop" : codonInfo.aa });
  }
  for (let index = aaNumber + 1; index <= suffixEnd; index += 1) {
    const codonInfo = getCodonAtAa(model, index, toAA);
    if (codonInfo) suffixEntries.push({ codon: codonInfo.cod, aa: codonInfo.aa === "*" ? "Stop" : codonInfo.aa });
  }
  const insertCodons = [];
  const upperInsert = String(insertSequence || "").toUpperCase();
  for (let index = 0; index < upperInsert.length; index += 3) insertCodons.push(upperInsert.slice(index, index + 3));
  return {
    note: `Insert ${insertAa} after residue ${aaNumber}.`,
    wtCodons: prefixEntries.map((entry) => entry.codon).concat(suffixEntries.map((entry) => entry.codon)),
    donorCodons: prefixEntries.map((entry) => entry.codon).concat(insertCodons, suffixEntries.map((entry) => entry.codon)),
    wtAas: prefixEntries.map((entry) => entry.aa).concat(suffixEntries.map((entry) => entry.aa)),
    donorAas: prefixEntries.map((entry) => entry.aa).concat(insertAa.split(""), suffixEntries.map((entry) => entry.aa)),
    insertCodonStart: prefixEntries.length,
    insertCodonLength: insertCodons.length,
    insertAaStart: prefixEntries.length,
    insertAaLength: insertAa.length,
  };
}

function translateDnaToAaTokens(sequence) {
  const tokens = [];
  const upper = String(sequence || "").toUpperCase();
  const limit = Math.floor(upper.length / 3) * 3;
  for (let index = 0; index < limit; index += 3) {
    const aa = toAA(upper.slice(index, index + 3));
    tokens.push(aa === "*" ? "Stop" : aa);
  }
  return tokens;
}

function translateDnaToCodonEntries(sequence) {
  const entries = [];
  const upper = String(sequence || "").toUpperCase();
  const limit = Math.floor(upper.length / 3) * 3;
  for (let index = 0; index < limit; index += 3) {
    const codon = upper.slice(index, index + 3);
    const aa = toAA(codon);
    entries.push({ codon, aa: aa === "*" ? "Stop" : aa });
  }
  return entries;
}

function buildInsertValidation(expectedSequence, actualSequence, options = {}) {
  const allowTerminalStop = !!options.allowTerminalStop;
  const segments = Array.isArray(options.segments) ? options.segments : [];
  const expected = String(expectedSequence || "").toUpperCase();
  const actual = String(actualSequence || "").toUpperCase();
  const expectedEntries = translateDnaToCodonEntries(expected);
  const actualEntries = translateDnaToCodonEntries(actual);
  const expectedAas = expectedEntries.map((entry) => entry.aa);
  const actualAas = actualEntries.map((entry) => entry.aa);
  const unexpectedStop = actualEntries.some((entry, index) => entry.aa === "Stop" && !(allowTerminalStop && index === actualEntries.length - 1));
  const terminalStopPresent = allowTerminalStop ? actualEntries[actualEntries.length - 1]?.aa === "Stop" : false;
  let cursor = 0;
  const canonicalChecks = segments
    .map((segment) => {
      const start = cursor;
      const end = cursor + String(segment.seq || "").length;
      cursor = end;
      if (!segment.referenceProtein?.aa) return null;
      const actualSegmentSequence = actual.slice(start, end);
      const actualSegmentAas = translateDnaToCodonEntries(actualSegmentSequence).map((entry) => entry.aa).join("");
      return {
        label: segment.referenceProtein.label || segment.label,
        expectedAas: segment.referenceProtein.aa,
        actualAas: actualSegmentAas,
        matches: actualSegmentAas === segment.referenceProtein.aa,
        sourceUrl: segment.referenceProtein.sourceUrl || "",
      };
    })
    .filter(Boolean);
  return {
    expectedSequence: expected,
    actualSequence: actual,
    expectedLengthBp: expected.length,
    actualLengthBp: actual.length,
    expectedAas,
    actualAas,
    matchesPreset: expected === actual,
    framePreserved: actual.length > 0 && actual.length % 3 === 0 && !unexpectedStop && (!allowTerminalStop || terminalStopPresent),
    unexpectedStop,
    terminalStopPresent,
    canonicalChecks,
  };
}

function buildKnockinProteinPreview(model, orientation, preset) {
  const wtEntries = [];
  for (let index = 1; index <= model.proteinLength; index += 1) {
    const codonInfo = getCodonAtAa(model, index, toAA);
    if (codonInfo) wtEntries.push({ codon: codonInfo.cod, aa: codonInfo.aa === "*" ? "Stop" : codonInfo.aa });
  }
  const insertEntries = translateDnaToCodonEntries(preset?.seq || "");

  if (orientation === "ct") {
    const tailLength = Math.min(8, wtEntries.length);
    const wtTail = wtEntries.slice(wtEntries.length - tailLength);
    return {
      mode: "ct",
      note: "Coding frame view across the C-terminal junction. The edited protein appends the translated knock-in before the terminal stop.",
      wtCodons: wtTail.map((entry) => entry.codon),
      donorCodons: wtTail.map((entry) => entry.codon).concat(insertEntries.map((entry) => entry.codon)),
      wtAas: wtTail.map((entry) => entry.aa),
      donorAas: wtTail.map((entry) => entry.aa).concat(insertEntries.map((entry) => entry.aa)),
      insertCodonStart: wtTail.length,
      insertCodonLength: insertEntries.length,
      insertAaStart: wtTail.length,
      insertAaLength: insertEntries.length,
    };
  }

  const headLength = Math.min(8, wtEntries.length);
  const wtHead = wtEntries.slice(0, headLength);
  const resumedWt = wtEntries.slice(1, 1 + headLength);
  return {
    mode: "nt",
    note: "Coding frame view across the N-terminal junction. The edited protein starts with the translated knock-in and then resumes the native CDS after the original start codon.",
    wtCodons: wtHead.map((entry) => entry.codon),
    donorCodons: insertEntries.map((entry) => entry.codon).concat(resumedWt.map((entry) => entry.codon)),
    wtAas: wtHead.map((entry) => entry.aa),
    donorAas: insertEntries.map((entry) => entry.aa).concat(resumedWt.map((entry) => entry.aa)),
    insertCodonStart: 0,
    insertCodonLength: insertEntries.length,
    insertAaStart: 0,
    insertAaLength: insertEntries.length,
  };
}

/**
 * A point-mutation design. Under co-delivery every donor carries the blocking changes of both guides, and two sets that are each silent can touch one codon and change the
 * protein together, which the donor check refuses. When that happens to a pair whose second guide was added by completeGuidePair, the lone guide is offered instead of no design.
 */
export function designPM(gb, mutationString, options = {}) {
  const result = designPMCore(gb, mutationString, options);
  if (result?.err && /No donor preserved the intended/.test(result.err) && options.ensureGuidePair !== false && !options.customGuides?.length) {
    const single = designPMCore(gb, mutationString, { ...options, ensureGuidePair: false });
    return single?.err ? result : { ...single, partnerSkipped: true };
  }
  return result;
}

function designPMCore(gb, mutationString, options = {}) {
  const cds = getCdsFromModel(gb);
  if (!cds) return { err: "No CDS annotation found in GenBank file." };
  const seq = getGenomicSequence(gb);
  const mutation = parsePointMutationInput(mutationString);
  if (mutation.err) return { err: mutation.err };
  const { wtAA, aaNumber, mutAA } = mutation;
  const codonInfo = getCodonAtAa(gb, aaNumber, toAA);
  if (!codonInfo) return { err: `Cannot map amino acid ${aaNumber} to the genomic sequence.` };
  if (codonInfo.aa !== wtAA.toUpperCase()) return { err: `Expected ${wtAA.toUpperCase()} at position ${aaNumber} but found ${codonInfo.aa} (${codonInfo.cod}).` };

  let bestMutantCodon = null;
  let bestChanges = [];
  for (const base1 of "ACGT") {
    for (const base2 of "ACGT") {
      for (const base3 of "ACGT") {
        const mutantCodon = `${base1}${base2}${base3}`;
        if (toAA(mutantCodon) !== mutAA.toUpperCase()) continue;
        const changes = [];
        for (let index = 0; index < 3; index += 1) {
          if (codonInfo.cod[index] !== mutantCodon[index]) {
            changes.push({ p: codonInfo.genomicPositions[index], w: codonInfo.cod[index], m: mutantCodon[index] });
          }
        }
        if (!bestMutantCodon || changes.length < bestChanges.length) { bestMutantCodon = mutantCodon; bestChanges = changes; }
      }
    }
  }
  if (!bestMutantCodon) return { err: `No codon encodes ${mutAA.toUpperCase()}.` };

  const mutationPositions = bestChanges.map((change) => change.p);
  const mutationBases = bestChanges.map((change) => change.m);
  // Declared before guide selection, which now scores blockability with the same cap.
  const maxBlockingChanges = normalizeMaxBlockingChanges(options.maxBlockingChanges);
  const customGuideSelection = options.customGuides?.length ? resolveCustomGuides(gb, options.customGuides, codonInfo.g, { maxDistance: 30, desiredCount: 2 }) : null;
  if (customGuideSelection?.err) return { err: customGuideSelection.err };
  // Guide choice has to change with the delivery plan, not just the donor: the closest pair
  // is often not the pair that can both be silently destroyed.
  const guideSelection = customGuideSelection
    || (options.coDeliveryBlocking
      // Scored with the same cap the design will use. Scoring with three while the design
      // applies one is the same disagreement in mirror image.
      ? selectCoDeliveryGuidesWithFallback(gb, codonInfo.g, codonInfo.genomicPositions, { maxChanges: maxBlockingChanges })
      // Blockability first within a window: an unblockable guide re-cuts the repair, which
      // costs more than a few bases of extra cut-to-edit distance inside the same window.
      : selectInsertGuidesWithFallback(gb, codonInfo.g, { preferBlockable: true }));
  if (!guideSelection) return { err: "No gRNAs found with cut sites within 30 bp of the mutation site." };
  // A lone guide gets a partner from the wider windows (the lab designs two guides), unless that is switched off.
  const pairedSelection = customGuideSelection || options.ensureGuidePair === false ? guideSelection
    : completeGuidePair(gb, codonInfo.g, guideSelection, { maxChanges: maxBlockingChanges, allowNonCodingBlockers: options.allowNonCodingBlockers, reserved: [...codonInfo.genomicPositions] });
  const { guides: rawSelectedGuides, window: guideWindow, tier: guideTier } = pairedSelection;
  const minimumAlternativeCutOffset = 10;
  const selectedGuides = customGuideSelection
    ? rawSelectedGuides
    : rawSelectedGuides.filter((guide, index, guides) => index === 0 || guides.slice(0, index).every((existing) => Math.abs(existing.cut - guide.cut) >= minimumAlternativeCutOffset));
  const removedRedundantGuideCount = rawSelectedGuides.length - selectedGuides.length;
  const blockedPositions = new Set(codonInfo.genomicPositions);

  const result = {
    type: "pm",
    gene: gb.gene,
    an: aaNumber,
    wA: wtAA.toUpperCase(),
    mA: mutAA.toUpperCase(),
    wC: codonInfo.cod,
    mC: bestMutantCodon,
    gp: codonInfo.g,
    ch: bestChanges,
    gs: [],
    os: [],
    ss: [],
    ps: [],
    guideWindow,
    guideTier,
    ...(pairedSelection.partnerFallback ? { partnerFallback: pairedSelection.partnerFallback } : {}),
    guideDistinctness: {
      minimumCutOffset: minimumAlternativeCutOffset,
      removedRedundantGuideCount,
      customGuidesRequireReview: !!customGuideSelection && rawSelectedGuides.some((guide, index) => rawSelectedGuides.slice(0, index).some((existing) => Math.abs(existing.cut - guide.cut) < minimumAlternativeCutOffset)),
    },
  };
  // Co-delivery: when both guides and both ssODNs go into the same well, a donor that only
  // disrupts its own guide leaves the OTHER guide free to re-cut the allele it just
  // repaired. In this mode every donor carries the blocking change for every offered guide,
  // so whichever donor performs the repair, neither guide can cut the product.
  const coDeliveryBlocking = !!options.coDeliveryBlocking;
  // One blocking *set* per guide, not one change. A single seed mismatch with an intact
  // PAM does not reliably stop re-cutting - the engine's own warning said so while it
  // emitted exactly that.
  const blockingByGuide = selectedGuides.map((guide) => {
    const blockingSet = findPointMutationBlockingSet(gb, guide, blockedPositions, { maxChanges: maxBlockingChanges, allowNonCodingBlockers: options.allowNonCodingBlockers });
    // Positions are always reserved now: several changes per guide means two individually
    // silent changes can otherwise land in one codon and combine into a coding change.
    blockingSet.forEach((entry) => blockedPositions.add(entry.gp));
    return blockingSet;
  });

  selectedGuides.forEach((guide, index) => {
    const blockingSet = blockingByGuide[index];
    const donorSilents = coDeliveryBlocking
      ? blockingByGuide.flat().filter(Boolean)
      : blockingSet;
    const donor = mkODN(gb, guide, mutationPositions, mutationBases, donorSilents, { aaNumber, intendedAa: mutAA.toUpperCase() });
    const guideName = makeGuideName(gb.gene, "pm", index, mutationString);
    result.gs.push({ n: guideName, sp: guide.sp, pm: guide.pam, str: guide.str, gc: guide.gc, d: guide.d, ps: guide.ps, cut: guide.cut, arm: appendGuideContext(buildPointMutationGuideNote(guide, guideTier, guideWindow), gb, guide) });
    if (donor?.proteinValidation?.valid) result.os.push({ ...donor, n: `ssODN${index + 1} (matched to ${guideName})`, gi: index, guideName, guideStrand: guide.str });
    blockingSet.forEach((entry) => result.ss.push({ ...entry, gi: index + 1 }));
  });
  if (!result.os.length) return { err: `No donor preserved the intended ${wtAA.toUpperCase()}${aaNumber}${mutAA.toUpperCase()} protein change after guide-blocking mutations were assembled.` };
  result.os = result.os.map((donor) => ({
    ...donor,
    guideProtection: selectedGuides.map((guide, guideIndex) => ({
      guideIndex: guideIndex + 1,
      guideName: result.gs[guideIndex]?.n || `gRNA${guideIndex + 1}`,
      ...assessGuideAgainstPointMutationDonor(guide, donor),
    })),
  }));
  result.coDeliverySafe = result.os.every((donor) => donor.guideProtection.every((entry) => entry.tier === "strong"));
  result.coDeliveryBlockingRequested = coDeliveryBlocking;
  if (options.acceptWeakProtection) {
    result.weakProtectionAcceptance = {
      accepted: true,
      reason: options.weakProtectionReason || "",
      acceptedBy: options.acceptedBy || "",
    };
  }
  if (guideSelection.coDeliverySelection) result.coDeliverySelection = guideSelection.coDeliverySelection;
  // (guideDonorInstruction below reads result.coDeliverySelection, so it must be set first.)
  // "unknown" means the other guide's target lies outside this donor's window entirely, so
  // no amount of extra blocking changes can cover it - that needs different guides.
  if (coDeliveryBlocking && result.os.some((donor) => donor.guideProtection.some((entry) => entry.tier === "unknown"))) {
    result.coDeliveryOutOfWindow = true;
  }
  result.guideDonorInstruction = result.coDeliverySafe
    ? "Each ssODN strongly disrupts every offered guide target, so the guides and donors may be co-delivered together."
    : coDeliveryBlocking
      ? [
        "Co-delivery blocking was requested but could not be achieved: at least one guide is still not strongly disrupted in every donor.",
        "Co-delivering these reagents risks the surviving guide re-cutting a correctly repaired allele.",
        result.coDeliverySelection?.singleGuideAlternative
          ? `A single-guide design using ${result.coDeliverySelection.singleGuideAlternative.spacer} (${result.coDeliverySelection.singleGuideAlternative.pam}, ${result.coDeliverySelection.singleGuideAlternative.strand} strand) can be strongly protected, so one matched guide/ssODN pair is safer at this site than co-delivering two.`
          : "No guide at this site admits a synonymous PAM-destroying change, so neither one guide nor two can be strongly protected here.",
      ].join(" ")
      : "Use one guide with its explicitly matched ssODN only. Do not co-deliver or pool the alternative guides unless every guide is independently shown as strongly blocked in that donor.";

  // Two guides cutting the same allele can delete the fragment between them by NHEJ. This
  // is a property of co-delivery itself, not of the donors, so it is reported whenever more
  // than one guide is offered for simultaneous use.
  if (coDeliveryBlocking && selectedGuides.length > 1) {
    const cuts = selectedGuides.map((guide) => guide.cut).sort((left, right) => left - right);
    const spans = cuts.slice(1).map((cut, index) => cut - cuts[index]);
    result.dualCutDeletionRisk = {
      cutSites: cuts,
      spans,
      note: `Co-delivering ${selectedGuides.length} guides allows both sites to be cut in the same allele; non-homologous repair can then delete the intervening ${spans.join(" and ")} bp. Screen for the deletion product as well as the intended edit.`,
    };
  }

  const primerPairs = designCenteredPrimerPairs(seq, codonInfo.g, { minAmp: VALIDATION_PRIMER_MIN_AMP, maxAmp: VALIDATION_PRIMER_MAX_AMP, desiredAmp: VALIDATION_PRIMER_TARGET_AMP });
  const primerPair = primerPairs[0];
  result.ps = [
    buildPrimerRecord(makePrimerName(gb.gene, "pm", "Fw", mutationString), primerPair.fw.seq),
    buildPrimerRecord(makePrimerName(gb.gene, "pm", "Rev", mutationString), primerPair.rev.seq),
  ];
  result.amp = `~${primerPair.amp} bp`;
  result.primerStrategy = "recommended-centered";
  result.primerCandidates = serializePrimerCandidates(primerPairs);
  return result;
}

export function designIT(gb, siteString, tag, options = {}) {
  const cds = getCdsFromModel(gb);
  if (!cds) return { err: "No CDS annotation found in GenBank file." };
  const site = parseInternalSiteInput(siteString);
  if (site.err) return { err: site.err };
  const { wtAA, aaNumber } = site;
  if (!aaNumber || aaNumber < 1 || aaNumber >= gb.proteinLength) return { err: "Internal insertion site must be within the coding sequence and before the final amino acid." };
  const codonInfo = getCodonAtAa(gb, aaNumber, toAA);
  if (!codonInfo) return { err: `Cannot map amino acid ${aaNumber} to the coding sequence.` };
  if (wtAA && codonInfo.aa !== wtAA) return { err: `Expected ${wtAA} at position ${aaNumber} but found ${codonInfo.aa} (${codonInfo.cod}).` };
  const nextCodonInfo = getCodonAtAa(gb, aaNumber + 1, toAA);
  const preset = INTERNAL_TAGS[tag];
  if (!preset) return { err: `Internal tag "${tag}" is not available.` };

  const insertionPos = codingPosToGenomic(gb, aaNumber * 3);
  if (insertionPos === null || insertionPos === undefined) return { err: `Cannot map insertion point after amino acid ${aaNumber}.` };

  const customGuideSelection = options.customGuides?.length ? resolveCustomGuides(gb, options.customGuides, insertionPos, { maxDistance: 30, desiredCount: 2 }) : null;
  if (customGuideSelection?.err) return { err: customGuideSelection.err };
  const guideSelection = customGuideSelection
    || selectInsertGuidesWithFallback(gb, insertionPos, { preferBlockable: true, silentOptions: { allowNonCoding: true } });
  if (!guideSelection) return { err: "No gRNAs found with cut sites within 30 bp of the internal insertion site." };
  const { guides, window: guideWindow, tier: guideTier } = guideSelection;

  const blockedPositions = new Set();
  const donors = [];
  const allBlockingMutations = [];
  // See designPM: under co-transfection a donor that disrupts only its matched guide leaves
  // the other guide free to re-cut the allele it just repaired. Note that for internal tags
  // the insert itself strongly disrupts any guide whose protospacer it splits, so this mode
  // often has less work to do here than for a point mutation.
  const coDeliveryBlocking = !!options.coDeliveryBlocking;
  const maxBlockingChanges = normalizeMaxBlockingChanges(options.maxBlockingChanges);
  const selectedItGuides = guides.slice(0, 2);
  const blockingByGuide = selectedItGuides.map((guide, index) => {
    const blockingSet = findBlockingSet(gb, guide, blockedPositions, { allowNonCoding: true, maxChanges: maxBlockingChanges });
    blockingSet.forEach((entry) => blockedPositions.add(entry.gp));
    return blockingSet.map((entry) => ({ ...entry, gi: index + 1 }));
  });

  selectedItGuides.forEach((guide, index) => {
    const donorBlocking = coDeliveryBlocking
      ? blockingByGuide.flat().filter(Boolean)
      : (blockingByGuide[index] || []);
    const donor = mkInternalOdn(gb, guide, insertionPos, preset.seq, donorBlocking);
    const guideName = makeGuideName(gb.gene, "it", index, `AFTER_${wtAA || ""}${aaNumber}`, tag);
    if (donor) {
      const annotationBase = [
        { label: "5' arm", color: DONOR_COLORS.HA5, start: 0, end: donor.insertStart, priority: 1, badgeLabel: "5' arm" },
        { label: tag, color: DONOR_COLORS.TAG, start: donor.insertStart, end: donor.insertEnd, priority: 1, badgeLabel: tag, title: `${tag} insert` },
        { label: "3' arm", color: DONOR_COLORS.HA3, start: donor.insertEnd, end: donor.od.length, priority: 1, badgeLabel: "3' arm" },
      ];
      const silentPlacement = new Map((donor.silentPlacements || []).map((entry) => [entry.gp, entry.index]));
      const blockingAnnotations = buildSilentAnnotations(donorBlocking, (mutation) => silentPlacement.get(mutation.gp) ?? -1);
      const guideAnnotations = buildGuideAnnotationsFromIndexes(guide, index + 1, donor.guideSiteIndexes, donor.guidePamIndexes);
      donors.push({
        ...donor,
        n: `ssODN${index + 1} (matched to ${guideName})`,
        gi: index,
        guideName,
        guideStrand: guide.str,
        donorAnnotations: annotationBase.concat(guideAnnotations, blockingAnnotations),
      });
    }
    (blockingByGuide[index] || []).forEach((entry) => allBlockingMutations.push(entry));
  });

  donors.forEach((donor) => {
    donor.guideProtection = guides.slice(0, 2).map((guide, guideIndex) => ({
      guideIndex: guideIndex + 1,
      guideName: makeGuideName(gb.gene, "it", guideIndex, `AFTER_${wtAA || ""}${aaNumber}`, tag),
      ...assessGuideAgainstInternalDonor(guide, donor),
    }));
  });
  const coDeliverySafe = donors.length > 0 && donors.every((donor) => donor.guideProtection.every((entry) => entry.tier === "strong"));
  const guideDonorInstruction = coDeliverySafe
    ? "Each ssODN strongly disrupts every offered guide target."
    : "Use one guide with its explicitly matched ssODN only. Do not co-deliver or pool the alternative guides unless every guide is independently shown as strongly blocked in that donor.";

  const proteinPreview = buildInternalProteinPreview(gb, aaNumber, preset.aa);
  const codingPreview = buildInternalCodingPreview(gb, aaNumber, preset.seq, preset.aa);
  const seq = getGenomicSequence(gb);
  const primerPairs = designCenteredPrimerPairs(seq, insertionPos, { minAmp: VALIDATION_PRIMER_MIN_AMP, maxAmp: VALIDATION_PRIMER_MAX_AMP, desiredAmp: VALIDATION_PRIMER_TARGET_AMP });
  const primerPair = primerPairs[0];
  // The insert must be compared in coding orientation. Slicing it out of `od` compared
  // the antisense strand against a sense-orientation preset whenever the guide was on the
  // + strand, so matchesPreset was always false for those designs - and for a preset whose
  // reverse complement happens to contain an in-frame stop (alphaBtx does) it also
  // reported a fabricated premature stop and a broken frame. Roughly half of all
  // internal-tag designs were being blocked by that.
  const insertValidation = donors[0]
    ? buildInsertValidation(
      preset.seq,
      donors[0].donorSense.slice(donors[0].senseInsertStart, donors[0].senseInsertEnd),
    )
    : buildInsertValidation(preset.seq, "");

  // Two cut sites in one allele can lose the sequence between them to non-homologous
  // repair. That is a property of co-delivery, not of the donors, so it applies to an
  // internal tag exactly as it does to a point mutation.
  let dualCutDeletionRisk = null;
  if (coDeliveryBlocking && selectedItGuides.length > 1) {
    const cuts = selectedItGuides.map((guide) => guide.cut).sort((left, right) => left - right);
    const spans = cuts.slice(1).map((cut, index) => cut - cuts[index]);
    dualCutDeletionRisk = {
      cutSites: cuts,
      spans,
      note: `Co-delivering ${selectedItGuides.length} guides allows both sites to be cut in the same allele; non-homologous repair can then delete the intervening ${spans.join(" and ")} bp. Screen for the deletion product as well as the intended edit.`,
    };
  }

  return {
    type: "it",
    // Reported, not just applied: the report section, the dual-cut warning and the release
    // gate all read this flag, and designIT set none of them while still building the
    // donors for co-delivery.
    coDeliveryBlockingRequested: coDeliveryBlocking,
    ...(options.acceptWeakProtection
      ? {
        weakProtectionAcceptance: {
          accepted: true,
          reason: options.weakProtectionReason || "",
          acceptedBy: options.acceptedBy || "",
        },
      }
      : {}),
    ...(dualCutDeletionRisk ? { dualCutDeletionRisk } : {}),
    gene: gb.gene,
    prot: gb.proteinLength,
    an: aaNumber,
    wA: codonInfo.aa,
    nextAA: nextCodonInfo?.aa || "?",
    tag,
    td: `${tag} (${preset.seq.length} bp)`,
    il: preset.seq.length,
    gp: insertionPos,
    guideWindow,
    guideTier,
    proteinPreview,
    codingPreview,
    insertValidation,
    gs: guides.slice(0, 2).map((guide, index) => ({
      n: makeGuideName(gb.gene, "it", index, `AFTER_${wtAA || ""}${aaNumber}`, tag),
      sp: guide.sp,
      pm: guide.pam,
      str: guide.str,
      gc: guide.gc,
      d: guide.d,
      ps: guide.ps,
      cut: guide.cut,
      arm: appendGuideContext(`Cut-to-insert distance ${Math.abs(guide.d)} bp | ${guideTier === "preferred" ? "preferred window" : guideTier === "fallback" ? "fallback window" : "distant fallback"} <=${guideWindow} bp`, gb, guide),
    })),
    os: donors,
    coDeliverySafe,
    guideDonorInstruction,
    ss: allBlockingMutations,
    ps: [
      buildPrimerRecord(makePrimerName(gb.gene, "it", "Fw", `AFTER_${wtAA || ""}${aaNumber}`, tag), primerPair.fw.seq),
      buildPrimerRecord(makePrimerName(gb.gene, "it", "Rev", `AFTER_${wtAA || ""}${aaNumber}`, tag), primerPair.rev.seq),
    ],
    amp: `WT ~${primerPair.amp} bp | KI ~${primerPair.amp + preset.seq.length} bp`,
    primerStrategy: "recommended-centered",
    primerCandidates: serializePrimerCandidates(primerPairs),
  };
}

export function designCT(gb, tag, homologyArmLength, options = {}) {
  const cds = getCdsFromModel(gb);
  if (!cds) return { err: "No CDS annotation found in GenBank file." };
  const seq = getGenomicSequence(gb);
  const lastSegment = gb.cdsSegments[gb.cdsSegments.length - 1];
  const stopStart = lastSegment[1] - 3;
  const stopCodon = seq.slice(stopStart, stopStart + 3);
  if (!["TAA", "TAG", "TGA"].includes(stopCodon)) return { err: `Expected a stop codon at the end of the CDS, found ${stopCodon}.` };
  const preset = getInsertPreset(tag, "ct");
  if (!preset) return { err: `Tag "${tag}" is not available.` };

  // Arms are planned per side: symmetric `homologyArmLength` unless donorFormat, arm5Length,
  // arm3Length or autoTrimArms say otherwise (see donorFormat.js). With none of those the arms are
  // what they always were.
  const armPlan = planDonorArms({
    insertBp: preset.seq.length, genome: seq, leftEdge: stopStart, rightEdge: stopStart + 3,
    requestedArm: homologyArmLength, options,
  });
  const armLength = armPlan.arms.requestedFive;
  const homology5Start = stopStart - armPlan.arms.five;
  const homology3End = stopStart + 3 + armPlan.arms.three;
  const homology5 = seq.slice(homology5Start, stopStart);
  const homology3 = seq.slice(stopStart + 3, homology3End);
  const customGuideSelection = options.customGuides?.length ? resolveCustomGuides(gb, options.customGuides, stopStart, { maxDistance: 30, desiredCount: 2 }) : null;
  if (customGuideSelection?.err) return { err: customGuideSelection.err };
  const maxBlockingChanges = normalizeMaxBlockingChanges(options.maxBlockingChanges);
  const guideSelection = customGuideSelection
    || selectInsertGuidesWithFallback(gb, stopStart, { preferBlockable: true, silentOptions: { allowNonCoding: true } });
  if (!guideSelection) return { err: "No SpCas9 gRNAs found with cut sites within 30 bp of the stop codon." };
  const { guides, window: guideWindow, tier: guideTier } = guideSelection;

  const silentMutations = [];
  const blockedPositions = new Set();
  // Same blocking strategy as point mutations and internal tags: stack synonymous changes
  // when one is not enough. Only positions inside a homology arm are offered, because only
  // those end up in the donor - so the tier counts changes the oligo actually carries.
  const inTerminalHomology = (genomicPos) => (
    (genomicPos >= homology5Start && genomicPos < stopStart)
    || (genomicPos >= stopStart + 3 && genomicPos < homology3End)
  );
  guides.slice(0, 2).forEach((guide, index) => {
    const blockingSet = findBlockingSet(gb, guide, blockedPositions, {
      allowNonCoding: true,
      maxChanges: maxBlockingChanges,
      isPositionAllowed: inTerminalHomology,
    });
    blockingSet.forEach((entry) => {
      silentMutations.push({ ...entry, gi: index + 1 });
      blockedPositions.add(entry.gp);
    });
  });
  const homology5Array = homology5.split("");
  const homology3Array = homology3.split("");
  silentMutations.forEach((mutation) => {
    const homology5Index = mutation.gp - homology5Start;
    if (homology5Index >= 0 && homology5Index < homology5Array.length) {
      homology5Array[homology5Index] = mutation.nb;
      return;
    }
    const homology3Index = mutation.gp - (stopStart + 3);
    if (homology3Index >= 0 && homology3Index < homology3Array.length) homology3Array[homology3Index] = mutation.nb;
  });

  const donor = `${homology5Array.join("")}${preset.seq}${homology3Array.join("")}`;
  const insertValidation = buildInsertValidation(
    preset.seq,
    donor.slice(homology5.length, homology5.length + preset.seq.length),
    { allowTerminalStop: true, segments: preset.segments },
  );
  const toCtDonorIndex = (genomicPos) => {
    const homology5Index = genomicPos - homology5Start;
    if (homology5Index >= 0 && homology5Index < homology5.length) return homology5Index;
    const homology3Index = genomicPos - (stopStart + 3);
    if (homology3Index >= 0 && homology3Index < homology3.length) return homology5.length + preset.seq.length + homology3Index;
    return -1;
  };
  const donorAnnotations = buildDonorAnnotations(
    homology5.length,
    preset.segments,
    homology3.length,
    buildSilentAnnotations(silentMutations, toCtDonorIndex).concat(
      guides.slice(0, 2).flatMap((guide, index) => buildGuideAnnotationsForMappedDonor(guide, index + 1, toCtDonorIndex)),
    ),
  );
  const lastAA = getCodonAtAa(gb, gb.proteinLength, toAA);
  const primerPairs = designOutsideHomologyArmPrimerPairs(seq, homology5Start, homology3End);
  const primerPair = primerPairs[0] || null;
  const wtAmpliconLength = primerPair?.amp || null;
  const kiAmpliconLength = wtAmpliconLength ? wtAmpliconLength + preset.seq.length - 3 : null;
  const primerWarning = buildOutsideHomologyPrimerWarning(seq, homology5Start, homology3End, primerPairs);
  const guideProtection = guides.slice(0, 2).map((guide, index) => {
    const guideIndex = index + 1;
    const mutation = silentMutations.find((entry) => entry.gi === guideIndex) || null;
    const insertionProtection = classifyGuideReplacementProtection(guide, stopStart, stopStart + 3, stopStart);
    const tier = insertionProtection.tier === "strong" ? "strong" : (mutation?.blockingTier || "none");
    return {
      guideIndex,
      byMutation: !!mutation,
      byInsertion: insertionProtection.protected,
      protected: tier !== "none",
      tier,
      reason: insertionProtection.protected ? insertionProtection.reason : (mutation?.blockingReason || "No guide-blocking change was found."),
    };
  });
  return {
    type: "ct",
    gene: gb.gene,
    stop: stopCodon,
    sp: stopStart + 1,
    prot: gb.proteinLength,
    lastAA: lastAA ? `${lastAA.aa}${gb.proteinLength}` : "?",
    tag,
    td: `${tag} (${preset.seq.length} bp)`,
    il: preset.seq.length,
    hl: armLength,
    h5l: homology5.length,
    h3l: homology3.length,
    dl: donor.length,
    donor,
    donorFormat: buildDonorFormatReport({ plan: armPlan, donor, insertBp: preset.seq.length, firstGuideStrand: guides[0]?.str, guides: guides.slice(0, 2).map((guide, index) => ({ str: guide.str, name: makeGuideName(gb.gene, "ct", index, "", tag) })) }),
    donorAnnotations,
    proteinPreview: buildKnockinProteinPreview(gb, "ct", preset),
    insertValidation,
    guideWindow: guideWindow,
    guideTier,
    guideProtection,
    guideUse: describeGuideUse({
      guides: guides.slice(0, 2).map((guide, index) => ({ name: makeGuideName(gb.gene, "ct", index, "", tag), sp: guide.sp, str: guide.str, gc: guide.gc, d: guide.d, cut: guide.cut })),
      protection: guideProtection,
      anchorWord: "stop codon",
    }),
    gs: guides.slice(0, 2).map((guide, index) => ({ n: makeGuideName(gb.gene, "ct", index, "", tag), sp: guide.sp, pm: guide.pam, str: guide.str, gc: guide.gc, d: guide.d, ps: guide.ps, cut: guide.cut, note: appendGuideContext(buildInsertGuideNote(guide, "stop", guideTier, guideWindow), gb, guide) })),
    ss: silentMutations,
    ps: primerPair ? [
      buildPrimerRecord(makePrimerName(gb.gene, "ct", "Fw", "", tag), primerPair.fw.seq),
      buildPrimerRecord(makePrimerName(gb.gene, "ct", "Rev", "", tag), primerPair.rev.seq),
    ] : [],
    amp: primerPair ? `WT ~${wtAmpliconLength} bp | KI ~${kiAmpliconLength} bp` : "",
    primerStrategy: getOutsideHomologyPrimerStrategy(primerPairs),
    primerWarning,
    primerCandidates: serializePrimerCandidates(primerPairs),
  };
}

export function designKO(gb, options = {}) {
  const cds = getCdsFromModel(gb);
  if (!cds) return { err: "No CDS annotation found." };
  if (gb.cdsSegments.length < 2) return { err: "Not enough coding exons available for KO design." };
  let selectedPair;
  let exonStart;
  let exonEnd;
  let bestLength;
  let exonNumber;
  if (options.customGuides?.length) {
    const customGuideSelection = resolveCustomGuides(gb, options.customGuides, null, { desiredCount: 2 });
    if (customGuideSelection?.err) return { err: customGuideSelection.err };
    if (!customGuideSelection || customGuideSelection.guides.length < 2) return { err: "Paste two custom gRNAs for knockout design." };
    const guides = customGuideSelection.guides
      .slice(0, 2)
      .sort((left, right) => left.cut - right.cut)
      .map((guide) => ({ ...guide, d: null }));
    selectedPair = {
      guides,
      spacing: Math.abs(guides[1].cut - guides[0].cut),
    };
    const contexts = guides.map((guide) => describeKoGenomicContextFromModel(gb, guide.cut));
    const exonMatch = contexts[0]?.label?.match(/Exon\s+(\d+)/i);
    exonNumber = exonMatch ? parseInt(exonMatch[1], 10) : null;
    const exon = Array.isArray(gb.exons) ? gb.exons.find((entry) => entry.exonNumber === exonNumber) : null;
    exonStart = exon?.start ?? 0;
    exonEnd = exon?.end ?? 0;
    bestLength = exon ? (exon.end - exon.start) : 0;
  } else {
    const target = findKoDesignTargetFromModel(gb, reverseComplement, selectKoGuidePair);
    if (!target) return { err: "No gRNA pair found with cut-site spacing up to 140 bp across non-terminal coding exons, preferentially exons 2-4, including exon-intron boundaries." };
    ({ start: exonStart, end: exonEnd, exonLength: bestLength, exonNumber, pair: selectedPair } = target);
  }
  const seq = getGenomicSequence(gb);
  const cutCenter = Math.round(selectedPair.guides.reduce((sum, guide) => sum + guide.cut, 0) / selectedPair.guides.length);
  const sortedCuts = selectedPair.guides.map((guide) => guide.cut).filter(Number.isFinite).sort((left, right) => left - right);
  const longDeletion = sortedCuts.length === 2 && selectedPair.spacing > KO_LONG_DELETION_THRESHOLD;
  const primerPairs = longDeletion
    ? designDeletionScreenPrimerPairs(seq, sortedCuts[0], sortedCuts[1], KO_DELETION_SCREEN_FLANK)
    : designCenteredPrimerPairs(seq, cutCenter, {
        minAmp: VALIDATION_PRIMER_MIN_AMP,
        maxAmp: VALIDATION_PRIMER_MAX_AMP,
        desiredAmp: VALIDATION_PRIMER_TARGET_AMP,
        // ICE/TIDE optimisation: place the cut ~175 bp from the Fw primer start
        // so the indel falls in the optimal Sanger read quality window.
        iceTideOffset: 175,
      });
  const primerPairsWithOutcomes = primerPairs.map((pair) => longDeletion ? pair : ({
    ...pair,
    wtAmpliconLength: pair.amp,
    deletionAmpliconLength: Math.max(48, pair.amp - selectedPair.spacing),
  }));
  const primerPair = primerPairsWithOutcomes[0];
  const spliceDonorRemoved = Number.isFinite(exonEnd) && sortedCuts.length === 2 && sortedCuts[0] < exonEnd && sortedCuts[1] >= exonEnd;
  const deletionOutcome = {
    deletionSize: selectedPair.spacing,
    deletionMod3: ((selectedPair.spacing % 3) + 3) % 3,
    frameshiftPredicted: selectedPair.spacing % 3 !== 0,
    spliceDonorRemoved,
    exonLength: bestLength,
    exonSkippingMod3: bestLength ? bestLength % 3 : null,
    exonSkippingFrameshiftPredicted: bestLength ? bestLength % 3 !== 0 : null,
  };

  return {
    type: "ko",
    gene: gb.gene,
    exon: `Exon ${exonNumber} (${exonStart + 1}-${exonEnd}, ${bestLength} bp)`,
    exSz: bestLength,
    prot: gb.proteinLength,
    gs: selectedPair.guides.map((guide, index) => {
      const context = describeKoGenomicContextFromModel(gb, guide.cut);
      const placement = describeGuidePlacementFromModel(gb, guide);
      return {
        n: makeGuideName(gb.gene, "ko", index),
        sp: guide.sp,
        pm: guide.pam,
        str: guide.str,
        gc: guide.gc,
        cut: guide.cut,
        d: guide.d,
        note: `Cut at ${guide.cut + 1}, ${context.label} (${context.detail}) | ${placement.label}: ${placement.detail} | pair spacing ${selectedPair.spacing} bp`,
      };
    }),
    ps: [
      buildPrimerRecord(makePrimerName(gb.gene, "ko", "Fw"), primerPair.fw.seq),
      buildPrimerRecord(makePrimerName(gb.gene, "ko", "Rev"), primerPair.rev.seq),
    ],
    amp: `WT ~${primerPair.wtAmpliconLength} bp | deletion ~${primerPair.deletionAmpliconLength} bp`,
    deletionOutcome,
    strat: longDeletion
      ? "NHEJ-mediated deletion using dual Cas9 guides. Screen with flanking junction PCR, then confirm the deletion by sequencing."
      : "NHEJ-mediated frameshift using Cas9 RNP. Screen by Sanger sequencing plus ICE/TIDE, then confirm protein loss.",
    primerStrategy: longDeletion ? "recommended-deletion-screen" : "recommended-centered",
    primerCandidates: serializePrimerCandidates(primerPairsWithOutcomes),
  };
}

export function designNT(gb, tag, homologyArmLength, options = {}) {
  const cds = getCdsFromModel(gb);
  if (!cds) return { err: "No CDS annotation found." };
  const seq = getGenomicSequence(gb);
  const startCodonPos = gb.cdsSegments[0][0];
  if (seq.slice(startCodonPos, startCodonPos + 3) !== "ATG") return { err: `Expected ATG at CDS start, found ${seq.slice(startCodonPos, startCodonPos + 3)}.` };
  const preset = getInsertPreset(tag, "nt");
  if (!preset) return { err: `Unknown tag: ${tag}.` };

  const insertionSite = startCodonPos;
  const codingResume = startCodonPos + 3;
  const armPlan = planDonorArms({
    insertBp: preset.seq.length, genome: seq, leftEdge: insertionSite, rightEdge: codingResume,
    requestedArm: homologyArmLength, options,
  });
  const armLength = armPlan.arms.requestedFive;
  const homology5Start = insertionSite - armPlan.arms.five;
  const homology3End = codingResume + armPlan.arms.three;
  const homology5 = seq.slice(homology5Start, insertionSite);
  const homology3 = seq.slice(codingResume, homology3End);
  const customGuideSelection = options.customGuides?.length ? resolveCustomGuides(gb, options.customGuides, startCodonPos, { maxDistance: 30, desiredCount: 2 }) : null;
  if (customGuideSelection?.err) return { err: customGuideSelection.err };
  const maxBlockingChanges = normalizeMaxBlockingChanges(options.maxBlockingChanges);
  const guideSelection = customGuideSelection
    || selectInsertGuidesWithFallback(gb, startCodonPos, { preferBlockable: true, silentOptions: { allowNonCoding: true } });
  if (!guideSelection) return { err: "No gRNAs found with cut sites within 30 bp of the start codon." };
  const { guides, window: guideWindow, tier: guideTier } = guideSelection;

  const silentMutations = [];
  const blockedPositions = new Set();
  // See designCT: stack changes, but only at positions the donor will carry.
  const inTerminalHomology = (genomicPos) => genomicPos >= homology5Start && genomicPos < homology3End;
  guides.slice(0, 2).forEach((guide, index) => {
    const blockingSet = findBlockingSet(gb, guide, blockedPositions, {
      allowNonCoding: true,
      maxChanges: maxBlockingChanges,
      isPositionAllowed: inTerminalHomology,
    });
    blockingSet.forEach((entry) => {
      silentMutations.push({ ...entry, gi: index + 1 });
      blockedPositions.add(entry.gp);
    });
  });

  const homology5Array = homology5.split("");
  const homology3Array = homology3.split("");
  silentMutations.forEach((mutation) => {
    const homology5Index = mutation.gp - homology5Start;
    if (homology5Index >= 0 && homology5Index < homology5Array.length) { homology5Array[homology5Index] = mutation.nb; return; }
    const homology3Index = mutation.gp - codingResume;
    if (homology3Index >= 0 && homology3Index < homology3Array.length) homology3Array[homology3Index] = mutation.nb;
  });

  const donor = `${homology5Array.join("")}${preset.seq}${homology3Array.join("")}`;
  const insertValidation = buildInsertValidation(
    preset.seq,
    donor.slice(homology5.length, homology5.length + preset.seq.length),
    { segments: preset.segments },
  );
  const toNtDonorIndex = (genomicPos) => {
    const homology5Index = genomicPos - homology5Start;
    if (homology5Index >= 0 && homology5Index < homology5.length) return homology5Index;
    const homology3Index = genomicPos - codingResume;
    if (homology3Index >= 0 && homology3Index < homology3.length) return homology5.length + preset.seq.length + homology3Index;
    return -1;
  };
  const donorAnnotations = buildDonorAnnotations(
    homology5.length,
    preset.segments,
    homology3.length,
    buildSilentAnnotations(silentMutations, toNtDonorIndex).concat(
      guides.slice(0, 2).flatMap((guide, index) => buildGuideAnnotationsForMappedDonor(guide, index + 1, toNtDonorIndex)),
    ),
  );
  const guideProtection = guides.slice(0, 2).map((guide, index) => {
    const guideIndex = index + 1;
    const mutation = silentMutations.find((entry) => entry.gi === guideIndex) || null;
    const insertionProtection = classifyGuideReplacementProtection(guide, startCodonPos, startCodonPos + 3, startCodonPos);
    const tier = insertionProtection.tier === "strong" ? "strong" : (mutation?.blockingTier || "none");
    return {
      guideIndex,
      byMutation: !!mutation,
      byInsertion: insertionProtection.protected,
      protected: tier !== "none",
      tier,
      reason: insertionProtection.protected ? insertionProtection.reason : (mutation?.blockingReason || "No guide-blocking change was found."),
    };
  });
  const primerPairs = designOutsideHomologyArmPrimerPairs(seq, homology5Start, homology3End);
  const primerPair = primerPairs[0] || null;
  const wtAmpliconLength = primerPair?.amp || null;
  const kiAmpliconLength = wtAmpliconLength ? wtAmpliconLength + preset.seq.length - 3 : null;
  const primerWarning = buildOutsideHomologyPrimerWarning(seq, homology5Start, homology3End, primerPairs);
  return {
    type: "nt",
    gene: gb.gene,
    prot: gb.proteinLength,
    tag,
    td: `${tag} (${preset.seq.length} bp)`,
    il: preset.seq.length,
    hl: armLength,
    h5l: homology5.length,
    h3l: homology3.length,
    dl: donor.length,
    donor,
    donorFormat: buildDonorFormatReport({ plan: armPlan, donor, insertBp: preset.seq.length, firstGuideStrand: guides[0]?.str, guides: guides.slice(0, 2).map((guide, index) => ({ str: guide.str, name: makeGuideName(gb.gene, "nt", index, "", tag) })) }),
    donorAnnotations,
    proteinPreview: buildKnockinProteinPreview(gb, "nt", preset),
    insertValidation,
    guideWindow: guideWindow,
    guideTier,
    guideProtection,
    guideUse: describeGuideUse({
      guides: guides.slice(0, 2).map((guide, index) => ({ name: makeGuideName(gb.gene, "nt", index, "", tag), sp: guide.sp, str: guide.str, gc: guide.gc, d: guide.d, cut: guide.cut })),
      protection: guideProtection,
      anchorWord: "start codon",
    }),
    gs: guides.slice(0, 2).map((guide, index) => ({ n: makeGuideName(gb.gene, "nt", index, "", tag), sp: guide.sp, pm: guide.pam, str: guide.str, gc: guide.gc, d: guide.d, ps: guide.ps, cut: guide.cut, note: appendGuideContext(buildInsertGuideNote(guide, "start codon replacement site", guideTier, guideWindow), gb, guide) })),
    ss: silentMutations,
    ps: primerPair ? [
      buildPrimerRecord(makePrimerName(gb.gene, "nt", "Fw", "", tag), primerPair.fw.seq),
      buildPrimerRecord(makePrimerName(gb.gene, "nt", "Rev", "", tag), primerPair.rev.seq),
    ] : [],
    amp: primerPair ? `WT ~${wtAmpliconLength} bp | KI ~${kiAmpliconLength} bp` : "",
    primerStrategy: getOutsideHomologyPrimerStrategy(primerPairs),
    primerWarning,
    primerCandidates: serializePrimerCandidates(primerPairs),
  };
}

/** Nearby terminal-tag candidates, assessed against the donor actually generated.
 * These are review alternatives; they do not become selected guides or QC cut sites.
 */
function buildTerminalGuideAlternatives(model, result) {
  if (!["ct", "nt"].includes(result.type) || !result.gs?.length) return null;
  const target = result.gs[0].cut - result.gs[0].d;
  const selected = new Set(result.gs.map(g => `${g.sp}:${g.str}:${g.cut}`));
  const candidates = findSpCas9Guides(model, reverseComplement, target, 30)
    .filter(g => !selected.has(`${g.sp}:${g.str}:${g.cut}`))
    .sort((a, b) => Math.abs(a.d) - Math.abs(b.d) || a.cut - b.cut || a.str.localeCompare(b.str))
    .map(guide => {
      const insertion = classifyGuideReplacementProtection(guide, target, target + 3, target);
      // CFD substitutions alone cannot score a target split by an inserted cassette.
      const cfd = insertion.protected ? null : (scoreResidualActivity(model, guide, result.ss || [])?.score ?? null);
      const protection = insertion.protected ? "strong" : (cfd === 1 ? "none" : gradeProtectionFromCfd(cfd) || "unknown");
      return { sp: guide.sp, pm: guide.pam, str: guide.str, gc: guide.gc, cut: guide.cut, d: guide.d,
        protection, cfd, byInsertion: insertion.protected,
        reason: insertion.protected ? insertion.reason : "CFD estimate against this donor's existing blocking substitutions; a different guide may need a regenerated donor." };
    });
  return { radius: 30, selectedWindow: result.guideWindow, candidates,
    note: "The primary selection is retained. Alternatives are assessed against the current donor and require review before use. Genome-wide specificity has not been checked. Selecting a different guide requires regenerating and reviewing its donor." };
}

export function runDesignFromTranscriptModel(projectType, model, mutation, tag, homologyArmLength, options = {}) {
  if (!model?.genomicSequence) return { err: "Transcript model is missing genomic sequence." };
  if (!projectType) return { err: "Select a project type first." };
  const cds = getCdsFromModel(model);
  if (!cds) return { err: "Transcript model is missing CDS segments." };

  let designResult;
  if (projectType === "pm") {
    if (!mutation) return { err: "Enter a mutation such as L72S." };
    designResult = designPM(model, mutation, options);
  } else if (projectType === "it") {
    if (!mutation) return { err: "Enter an internal insertion site such as P155." };
    designResult = designIT(model, mutation, tag, options);
  } else if (projectType === "ct") designResult = designCT(model, tag, homologyArmLength, options);
  else if (projectType === "nt") designResult = designNT(model, tag, homologyArmLength, options);
  else designResult = designKO(model, options);

  if (designResult?.err) return designResult;
  const alternatives = buildTerminalGuideAlternatives(model, designResult);
  if (alternatives) designResult.guideAlternatives = alternatives;
  const deliveryMethod = options.deliveryMethod || "unknown";
  const guideSequenceQc = (designResult.gs || []).map((guide, index) => ({
    guideIndex: index + 1,
    guideName: guide.n || `gRNA${index + 1}`,
    ...assessGuideSequence(guide.sp, deliveryMethod),
  }));

  return {
    gb: model,
    cds,
    deliveryMethod,
    guideSequenceQc,
    dbg: `Parsed ${model.genomicSequence.length} bp with ${getFeatureCount(model)} features. CDS: ${model.gene}, ${model.cdsSegments.length} segments, ${model.proteinLength} aa.`,
    ...designResult,
  };
}

export function runDesign(projectType, gbRaw, mutation, tag, homologyArmLength, options = {}) {
  let model = null;
  if (options.rawReference?.sequence) {
    model = normalizeRawSequenceToTranscriptModel(options.rawReference);
    if (!model?.genomicSequence) return { err: "Could not normalize the raw DNA input into a transcript model. Check the DNA sequence and CDS coordinates." };
  } else {
    if (!gbRaw) return { err: "Upload a GenBank file first." };
    const parsedGenBank = parseGB(gbRaw);
    if (!parsedGenBank.seq) return { err: "Could not parse a DNA sequence from the file." };
    model = normalizeGenBankToTranscriptModel(parsedGenBank, { expectedGene: options.expectedGene });
  }
  if (!model?.genomicSequence) return { err: "Could not normalize the GenBank file into a transcript model." };
  return runDesignFromTranscriptModel(projectType, model, mutation, tag, homologyArmLength, options);
}
