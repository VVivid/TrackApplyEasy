import copy
import unittest
from promote import update


class PromotionTests(unittest.TestCase):
    def test_preserves_operator_fields(self):
        original = {"defaultNamespace": "trackapplyeasy", "keepResources": True, "helm": {"repo": "oci://ghcr.io/vvivid/charts/trackapplyeasy", "version": "0.0.0", "values": {"configured": True, "image": {"repository": "ghcr.io/vvivid/trackapplyeasy", "digest": "old"}, "routes": {"publicEnabled": False}, "identity": {"secretName": "operator-owned"}, "resources": {"limits": {"memory": "512Mi"}}, "provenance": {}}}}
        release = {"version": "0.1.0", "imageDigest": "image", "chartDigest": "chart", "sourceRef": "refs/tags/v0.1.0", "sourceCommit": "a" * 40, "workflowRun": "run"}
        before = copy.deepcopy(original)
        changed = update(original, release)
        self.assertEqual(original, before)
        for name in ("routes", "identity", "resources", "configured"):
            self.assertEqual(changed["helm"]["values"][name], original["helm"]["values"][name])
        self.assertEqual(changed["helm"]["values"]["image"]["repository"], original["helm"]["values"]["image"]["repository"])
        self.assertEqual(changed["helm"]["values"]["provenance"]["chartDigest"], "chart")

    def test_rejects_unprepared_or_other_app(self):
        for namespace, configured in [("other", True), ("trackapplyeasy", False)]:
            document = {"defaultNamespace": namespace, "helm": {"repo": "oci://ghcr.io/vvivid/charts/trackapplyeasy", "values": {"configured": configured}}}
            with self.assertRaises(ValueError):
                update(document, {})
