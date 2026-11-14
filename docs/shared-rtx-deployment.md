# Shared RTX deployment: Malang and Trangkil

Changes are local; no server environment, database, or running service was changed.
Both repositories have the same inference_device.py. Commit/push each repository separately.

## Server deployment, one installation at a time

Use an agreed idle maintenance window. Stop only the target installation with its own established stop procedure. Do not replace Torch in a running venv. Record `python -m pip freeze` before changing packages. Use each installation's own `.venv\Scripts\python.exe` (check its path and Python version). Do not copy .env between installations.

The reported Malang environment has torch 2.6.0+cpu. The official PyTorch 2.6.0 CUDA 12.4 wheel can be installed with:

```
.venv\Scripts\python.exe -m pip install --upgrade torch==2.6.0 --index-url https://download.pytorch.org/whl/cu124
.venv\Scripts\python.exe -m pip check
```

Check Trangkil's Torch/Python versions before choosing its package version; do not blindly downgrade a newer installation. Use https://pytorch.org/get-started/previous-versions/ for the matching CUDA build. `nvidia-smi` CUDA Version reports driver capability, not the installed PyTorch build.

Edit only these keys in EACH target .env, preserving its database/ports/tokens:

```
KERAS_BACKEND=torch
CUDA_VISIBLE_DEVICES=0
AI_DEVICE=cuda
AI_GPU_MEMORY_FRACTION=0.4
AI_TORCH_THREADS=2
```

The 0.4 budget limits PyTorch allocator memory per process; it is not a complete VRAM reservation and excludes some CUDA/runtime overhead. Two installations still contend for GPU compute. Measure both together; an allocation error must not be treated as a successful grade. Start with one AI worker per installation. A .env edit affects only newly started processes; verify that the target's launcher loads its .env before importing main.py.

After installing, run the server's own CUDA probe and a small tensor operation before restarting the target service:

```
.venv\Scripts\python.exe -c "import os; os.environ['CUDA_VISIBLE_DEVICES']='0'; import torch; print(torch.__version__, torch.version.cuda); assert torch.cuda.is_available(); x=torch.ones((32,32),device='cuda'); print((x@x)[0,0].item()); print(torch.cuda.get_device_name(0))"
```

Restart with the target installation's launcher. Check AI /health `execution.torch_device` is cuda:0, then run an approved real-model grading check and inspect nvidia-smi. Health reports selected runtime; it does not prove a model has completed inference. ONNX models require a compatible onnxruntime-gpu provider separately; CPU onnxruntime will explicitly reject CUDA mode. Current deployment should be checked for actual .keras/.h5 vs ONNX model use.

Repeat for the other installation only after the first works. Verify both models, concurrent cycles, latency, VRAM, temperature and retained history. GPU acceleration does not migrate OpenCV CPU video decode/JPEG encoding, browser, API, or database work and does not guarantee lower laptop temperature.

Rollback: stop target while idle, set AI_DEVICE=cpu and restart its own launcher. CUDA-enabled Torch can also run on CPU; package downgrade is not required for this configuration rollback.
