"""Explicit inference device selection; importing this module does not initialize CUDA."""
import os
from functools import lru_cache

@lru_cache(maxsize=1)
def torch_device():
    import torch
    requested = os.getenv("AI_DEVICE", "cpu").strip().lower()
    if requested not in ("cpu", "cuda", "auto"):
        raise RuntimeError("AI_DEVICE must be cpu, cuda, or auto")
    available = torch.cuda.is_available() if requested != "cpu" else False
    if requested == "cuda" and not available:
        raise RuntimeError("AI_DEVICE=cuda but CUDA is unavailable. Install CUDA-enabled PyTorch and check CUDA_VISIBLE_DEVICES.")
    device = "cuda:0" if available else "cpu"
    if available:
        fraction = float(os.getenv("AI_GPU_MEMORY_FRACTION", "0.4"))
        if not 0 < fraction <= 1:
            raise RuntimeError("AI_GPU_MEMORY_FRACTION must be > 0 and <= 1")
        torch.cuda.set_per_process_memory_fraction(fraction, 0)
    return device

def execution_status():
    import torch
    device = torch_device()
    return {"requested": os.getenv("AI_DEVICE", "cpu"), "torch_device": device,
            "torch_version": torch.__version__, "cuda_build": torch.version.cuda,
            "gpu_name": torch.cuda.get_device_name(0) if device.startswith("cuda") else None}

def onnx_providers(ort):
    if torch_device().startswith("cuda"):
        if "CUDAExecutionProvider" not in ort.get_available_providers():
            raise RuntimeError("ONNX CUDA provider unavailable; install compatible onnxruntime-gpu or use AI_DEVICE=cpu")
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]
