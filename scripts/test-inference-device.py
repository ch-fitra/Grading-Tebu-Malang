"""Database-free regression tests for CPU/CUDA selection."""
import importlib.util
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

path = Path(__file__).resolve().parents[1] / "apps/ai-service/inference_device.py"
spec = importlib.util.spec_from_file_location("inference_device", path)
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)

class DeviceTests(unittest.TestCase):
    def setUp(self):
        runtime.torch_device.cache_clear()
        self.cuda = SimpleNamespace(is_available=Mock(return_value=True), set_per_process_memory_fraction=Mock(), get_device_name=Mock(return_value="fixture GPU"))
        self.fake = SimpleNamespace(cuda=self.cuda, __version__="fixture", version=SimpleNamespace(cuda="12.4"))
        self.env = patch.dict(os.environ, {"AI_DEVICE":"cpu","AI_GPU_MEMORY_FRACTION":"0.4"})
        self.modules = patch.dict(sys.modules, {"torch":self.fake})
        self.env.start(); self.modules.start()
    def tearDown(self):
        self.env.stop(); self.modules.stop(); runtime.torch_device.cache_clear()
    def test_cpu_does_not_initialize_cuda(self):
        self.assertEqual(runtime.torch_device(), "cpu")
        self.cuda.is_available.assert_not_called()
    def test_cuda_budget_and_device(self):
        os.environ["AI_DEVICE"]="cuda"
        self.assertEqual(runtime.torch_device(), "cuda:0")
        self.cuda.set_per_process_memory_fraction.assert_called_once_with(0.4,0)
        self.assertEqual(runtime.execution_status()["gpu_name"],"fixture GPU")
    def test_missing_cuda_fails_explicitly(self):
        os.environ["AI_DEVICE"]="cuda"; self.cuda.is_available.return_value=False
        with self.assertRaisesRegex(RuntimeError,"CUDA is unavailable"): runtime.torch_device()
    def test_auto_falls_back(self):
        os.environ["AI_DEVICE"]="auto"; self.cuda.is_available.return_value=False
        self.assertEqual(runtime.torch_device(),"cpu")
    def test_invalid_budget(self):
        os.environ["AI_DEVICE"]="cuda"; os.environ["AI_GPU_MEMORY_FRACTION"]="1.2"
        with self.assertRaises(RuntimeError): runtime.torch_device()
    def test_onnx_provider_required(self):
        os.environ["AI_DEVICE"]="cuda"
        with self.assertRaisesRegex(RuntimeError,"ONNX CUDA provider"):
            runtime.onnx_providers(SimpleNamespace(get_available_providers=lambda:["CPUExecutionProvider"]))

if __name__ == "__main__": unittest.main()
