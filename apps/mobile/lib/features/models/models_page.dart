import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';

import '../../core.dart' hide Row;
import '../../ui/common.dart';

class ModelsView extends StatelessWidget {
  final AppState state;
  const ModelsView({super.key, required this.state});
  @override
  Widget build(BuildContext context) => pageFrame([
    heading('Model AI', 'Versi model yang tercatat pada backend'),
    errorBanner(state),
    if (state.can('model.write'))
      Align(
        alignment: Alignment.centerLeft,
        child: FilledButton.icon(
          onPressed: () => modelDialog(context, state),
          icon: const Icon(Icons.upload_file),
          label: const Text('Unggah model'),
        ),
      ),
    const SizedBox(height: 10),
    if (state.models.isEmpty)
      emptyState('Belum ada model AI.')
    else
      ...state.models.map(
        (model) => Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const CircleAvatar(
                    child: Icon(Icons.psychology_outlined),
                  ),
                  title: Text(
                    s(model['name']),
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                  subtitle: Text('Versi ${s(model['version'])}'),
                  trailing: model['active'] == true
                      ? const Chip(label: Text('Aktif'))
                      : null,
                ),
                Text(
                  'Path: ${s(model['path'])}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                if (state.can('model.write') && model['active'] != true)
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton.icon(
                      onPressed: () async {
                        try {
                          await state.mutate('POST', '/api/models/activate', {
                            'id': n(model['id']),
                          });
                          if (context.mounted) {
                            snack(context, 'Model diaktifkan');
                          }
                        } catch (e) {
                          if (context.mounted) snack(context, e.toString());
                        }
                      },
                      icon: const Icon(Icons.check_circle_outline),
                      label: const Text('Aktifkan'),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
  ]);
}

Future<void> modelDialog(BuildContext context, AppState state) async {
  final name = TextEditingController(),
      version = TextEditingController(text: '1.0.0');
  PlatformFile? file;
  await showDialog<void>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (dialogContext, setLocal) => AlertDialog(
        title: const Text('Unggah model AI'),
        content: SizedBox(
          width: 420,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: name,
                  decoration: const InputDecoration(labelText: 'Nama model'),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: version,
                  decoration: const InputDecoration(labelText: 'Versi'),
                ),
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  onPressed: () async {
                    final picked = await FilePicker.pickFile(
                      type: FileType.custom,
                      allowedExtensions: ['onnx'],
                    );
                    if (picked != null) setLocal(() => file = picked);
                  },
                  icon: const Icon(Icons.attach_file),
                  label: Text(file?.name ?? 'Pilih file .onnx'),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Model harus berformat ONNX. Ukuran besar memerlukan koneksi stabil.',
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Batal'),
          ),
          FilledButton(
            onPressed: () async {
              if (name.text.trim().isEmpty ||
                  version.text.trim().isEmpty ||
                  file == null) {
                snack(dialogContext, 'Isi nama, versi, dan pilih file');
                return;
              }
              try {
                await state.api.uploadModel(
                  name.text.trim(),
                  version.text.trim(),
                  file!,
                );
                await state.refresh();
                if (dialogContext.mounted) {
                  Navigator.pop(dialogContext);
                  snack(context, 'Model berhasil diunggah');
                }
              } catch (e) {
                if (dialogContext.mounted) snack(dialogContext, e.toString());
              }
            },
            child: const Text('Unggah'),
          ),
        ],
      ),
    ),
  );
  name.dispose();
  version.dispose();
}
