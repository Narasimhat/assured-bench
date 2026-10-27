"""Catalog coverage tests; no credentials, network, sequence inference or SDK needed."""
import unittest
from context_catalog import build_catalog


class ContextCatalogTests(unittest.TestCase):
    def test_coverage_is_ontology_specific_and_shared_outputs_are_not_borrowed(self):
        definitions = [{"id": "h1", "ontology": "EFO:1"}, {"id": "missing", "ontology": "CL:2"}]
        metadata = {"schema": "assured-alphagenome-metadata/1", "organism": "HOMO_SAPIENS", "outputs": {
            "rna_seq": [{"ontology_curie": "EFO:1", "biosample_name": "H1", "genetically_modified": False}],
            "contact_maps": [{"ontology_curie": "EFO:1", "biosample_name": "H1-hESC"}],
            "splice_sites": [{"name": "shared"}],
        }}
        result = build_catalog(metadata, definitions)
        self.assertEqual(result["contexts"][0]["outputTracks"], {"RNA_SEQ": 1, "CONTACT_MAPS": 1})
        self.assertEqual(result["contexts"][0]["biosampleNames"], ["H1", "H1-hESC"])
        self.assertFalse(result["contexts"][0]["experimentalMatchVerified"])
        self.assertFalse(result["contexts"][1]["available"])
        self.assertEqual(result["contexts"][1]["outputTracks"], {})
        self.assertEqual(result["sharedOutputs"], {"SPLICE_SITES": 1})

    def test_species_and_duplicate_ids_are_rejected(self):
        with self.assertRaises(ValueError): build_catalog({"schema": "assured-alphagenome-metadata/1", "organism": "mouse"}, [])
        metadata = {"schema": "assured-alphagenome-metadata/1", "organism": "HOMO_SAPIENS", "outputs": {}}
        with self.assertRaises(ValueError): build_catalog(metadata, [{"id": "x", "ontology": "A"}, {"id": "x", "ontology": "A"}])


if __name__ == "__main__":
    unittest.main()
