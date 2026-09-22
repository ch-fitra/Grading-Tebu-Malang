# AI Format

Active model directory:

```plaintext
models/active/model.onnx
models/active/config.json
```

Example config:

```json
{
  "name": "Tebu Segmentation V1",
  "version": "1.0.0",
  "type": "segmentation",
  "input_size": 640,
  "classes": ["daun", "pucuk", "sampah"],
  "threshold": 0.5
}
```

The AI service returns class percentages only. The backend calculates final grade using the rule engine.
