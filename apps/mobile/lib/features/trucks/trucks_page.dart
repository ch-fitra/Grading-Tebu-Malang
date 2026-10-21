import 'package:flutter/material.dart';

import '../../core.dart' hide Row;
import '../../ui/common.dart';

class TrucksView extends StatelessWidget {
  final AppState state;
  const TrucksView({super.key, required this.state});

  @override
  Widget build(BuildContext context) => pageFrame([
    heading(
      'Inspeksi truk',
      'Sesi inspeksi tersimpan di PostgreSQL dan dapat dibuka di perangkat lain',
    ),
    errorBanner(state),
    if (state.can('inspection.write'))
      Align(
        alignment: Alignment.centerLeft,
        child: FilledButton.icon(
          onPressed: state.cameras.isEmpty
              ? null
              : () => truckDialog(context, state),
          icon: const Icon(Icons.add),
          label: const Text('Mulai inspeksi'),
        ),
      ),
    if (state.cameras.isEmpty)
      const Padding(
        padding: EdgeInsets.all(8),
        child: Text(
          'Tambahkan kamera terlebih dahulu untuk memilih jalur inspeksi.',
        ),
      ),
    const SizedBox(height: 12),
    if (state.trucks.isEmpty)
      emptyState('Belum ada sesi inspeksi truk.')
    else
      ...state.trucks.map(
        (truck) => Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const CircleAvatar(
                    child: Icon(Icons.local_shipping_outlined),
                  ),
                  title: Text(
                    s(truck['truckCode']),
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                  subtitle: Text(
                    '${s(truck['plateNumber'])}  â€¢  Jalur #${n(truck['line'])}',
                  ),
                  trailing: Chip(
                    label: Text(
                      truck['status'] == 'active'
                          ? 'Aktif'
                          : s(truck['finalDecision']),
                    ),
                  ),
                ),
                Text('Mulai: ${date(truck['startedAt'])}'),
                Text(
                  'Tangkapan: ${n(truck['totalCaptures'])}  â€¢  Kotoran rata-rata: ${truck['impurityMeasured'] == true ? '${d(truck['averageImpurity']).toStringAsFixed(1)}%' : 'Tidak diukur'}',
                ),
                Text(
                  'Kepercayaan rata-rata: ${pct(truck['averageConfidence'])}',
                ),
                if (s(truck['notes'], '').isNotEmpty)
                  Text('Catatan: ${s(truck['notes'])}'),
                if (state.can('inspection.write'))
                  Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      if (truck['status'] == 'active')
                        TextButton.icon(
                          onPressed: () =>
                              completeTruckDialog(context, state, truck),
                          icon: const Icon(Icons.check_circle_outline),
                          label: const Text('Selesaikan'),
                        ),
                      TextButton.icon(
                        onPressed: () => confirmDelete(
                          context,
                          'Hapus inspeksi ${s(truck['truckCode'])}?',
                          () => state.mutate(
                            'DELETE',
                            '/api/truck-inspections/${s(truck['id'])}',
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

Future<void> truckDialog(BuildContext context, AppState state) async {
  final code = TextEditingController(),
      plate = TextEditingController(),
      driver = TextEditingController(),
      supplier = TextEditingController(),
      notes = TextEditingController();
  var line = n(state.cameras.first['id']);
  await showDialog<void>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (dialogContext, setLocal) => AlertDialog(
        title: const Text('Mulai inspeksi truk'),
        content: SizedBox(
          width: 420,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: code,
                  decoration: const InputDecoration(labelText: 'Kode truk *'),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: plate,
                  decoration: const InputDecoration(labelText: 'Nomor polisi'),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: driver,
                  decoration: const InputDecoration(
                    labelText: 'Nama pengemudi',
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: supplier,
                  decoration: const InputDecoration(labelText: 'Pemasok'),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<int>(
                  initialValue: line,
                  decoration: const InputDecoration(labelText: 'Jalur/kamera'),
                  items: [
                    for (final c in state.cameras)
                      DropdownMenuItem(
                        value: n(c['id']),
                        child: Text(s(c['name'])),
                      ),
                  ],
                  onChanged: (v) => setLocal(() => line = v ?? line),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: notes,
                  decoration: const InputDecoration(labelText: 'Catatan'),
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
              if (code.text.trim().isEmpty) {
                snack(dialogContext, 'Kode truk wajib diisi');
                return;
              }
              await runMutation(
                dialogContext,
                () => state.mutate('POST', '/api/truck-inspections', {
                  'truckCode': code.text.trim(),
                  'plateNumber': plate.text.trim(),
                  'driverName': driver.text.trim(),
                  'supplier': supplier.text.trim(),
                  'line': line,
                  'notes': notes.text.trim(),
                }),
                'Inspeksi dimulai',
              );
            },
            child: const Text('Mulai'),
          ),
        ],
      ),
    ),
  );
  code.dispose();
  plate.dispose();
  driver.dispose();
  supplier.dispose();
  notes.dispose();
}

Future<void> completeTruckDialog(
  BuildContext context,
  AppState state,
  Map<String, dynamic> truck,
) async {
  final notes = TextEditingController(text: s(truck['notes'], ''));
  await showDialog<void>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: const Text('Selesaikan inspeksi'),
      content: TextField(
        controller: notes,
        maxLines: 3,
        decoration: const InputDecoration(labelText: 'Catatan akhir'),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialogContext),
          child: const Text('Batal'),
        ),
        FilledButton(
          onPressed: () => runMutation(
            dialogContext,
            () => state.mutate(
              'PATCH',
              '/api/truck-inspections/${s(truck['id'])}/complete',
              {'notes': notes.text.trim()},
            ),
            'Inspeksi selesai',
          ),
          child: const Text('Selesaikan'),
        ),
      ],
    ),
  );
  notes.dispose();
}
