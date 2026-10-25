import re
import unittest
from pathlib import Path


TERRAFORM_ROOT = Path(__file__).resolve().parents[1]


class TerraformModuleRegionTest(unittest.TestCase):
    def test_environments_set_region_on_provider_not_modules(self):
        for environment in ("dev", "staging"):
            with self.subTest(environment=environment):
                root_config = (
                    TERRAFORM_ROOT / "environments" / environment / "main.tf"
                ).read_text()
                self.assertRegex(
                    root_config,
                    r'provider\s+"aws"\s*\{\s*region\s*=\s*var\.region',
                )

                for module_name in ("vpc", "eks"):
                    module_call = re.search(
                        rf'module\s+"{module_name}"\s*\{{(.*?)\n\}}',
                        root_config,
                        re.DOTALL,
                    )
                    self.assertIsNotNone(module_call)
                    self.assertNotRegex(module_call.group(1), r"(?m)^\s*region\s*=")

    def test_vpc_and_eks_modules_do_not_declare_unused_region_inputs(self):
        for module_name in ("vpc", "eks"):
            with self.subTest(module=module_name):
                module_config = (
                    TERRAFORM_ROOT / "modules" / module_name / "main.tf"
                ).read_text()
                self.assertNotRegex(module_config, r'variable\s+"region"\s*\{')


if __name__ == "__main__":
    unittest.main()
