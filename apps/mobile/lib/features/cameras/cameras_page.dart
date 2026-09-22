import 'package:flutter/material.dart';

import '../../core.dart' hide Row;
import '../../ui/common.dart';

class CamerasView extends StatelessWidget {
  final AppState state;
  const CamerasView({super.key, required this.state});
  @override
  Widget build(BuildContext context) => pageFrame([
    heading('Manajemen kamera', 'Sumber RTSP yang tersimpan di backend'),
    errorBanner(state),
    if (state.can('camera.write'))
      Align(
        alignment: Alignment.centerLeft,
        child: FilledButton.icon(
          onPressed: () => cameraDialog(context, state),
          icon: const Icon(Icons.add),
          label: const Text('Tambah kamera'),
        ),
      ),
    const SizedBox(height: 10),
    if (state.cameras.isEmpty)
      emptyState(
        'Belum ada kamera. Tambahkan kamera RTSP untuk mulai memantau.',
      )
    else
      ...state.cameras.map(
        (camera) => Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: CircleAvatar(
                    child: Icon(
                      camera['status'] == 'online'
                          ? Icons.videocam
                          : Icons.videocam_off_outlined,
                    ),
                  ),
                  title: Text(
                    s(camera['name']),
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                  subtitle: Text(s(camera['location'])),
                  trailing: Chip(label: Text(s(camera['status']))),
                ),
                Text(
                  'RTSP: ${s(camera['rtspUrl'])}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                if (state.can('camera.write'))
                  Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      TextButton.icon(
                        onPressed: () => cameraDialog(context, state, camera),
                        icon: const Icon(Icons.edit_outlined),
                        label: const Text('Ubah'),
                      ),
                      TextButton.icon(
                        onPressed: () => confirmDelete(
                          context,
                          'Hapus kamera ${s(camera['name'])}?',
                          () => state.mutate(
                            'DELETE',
                            '/api/cameras/${n(camera['id'])}',
                          ),
                        ),
                        icon: const Icon(Icons.delete_outline),
                        label: const Text('Hapus'),
                      ),
                    ],
                  ),
              ],
            ),
          ),
        ),
      ),
  ]);
}

Future<void> cameraDialog(
  BuildContext context,
  AppState state, [
  Map<String, dynamic>? camera,
]) async {
  final name = TextEditingController(text: s(camera?['name'], ''));
  final rtsp = TextEditingController(text: s(camera?['rtspUrl'], ''));
  final location = TextEditingController(text: s(camera?['location'], ''));
  await showDialog<void>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(camera == null ? 'Tambah kamera' : 'Ubah kamera'),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: name,
                decoration: const InputDecoration(labelText: 'Nama kamera'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: rtsp,
                decoration: const InputDecoration(labelText: 'URL RTSP'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: location,
                decoration: const InputDecoration(labelText: 'Lokasi'),
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
            if (name.text.trim().isEmpty || rtsp.text.trim().isEmpty) {
              snack(dialogContext, 'Nama dan URL RTSP wajib diisi');
              return;
            }
            await runMutation(
              dialogContext,
              () => state.mutate(
                camera == null ? 'POST' : 'PUT',
                camera == null
                    ? '/api/cameras'
                    : '/api/cameras/${n(camera['id'])}',
                {
                  'name': name.text.trim(),
                  'rtspUrl': rtsp.text.trim(),
                  'location': location.text.trim(),
                },
              ),
            );
          },
          child: const Text('Simpan'),
        ),
      ],
    ),
  );
  name.dispose();
  rtsp.dispose();
  location.dispose();
}
