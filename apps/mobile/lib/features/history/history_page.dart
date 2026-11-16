import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../../core.dart' hide Row;
import '../../ui/common.dart';

class HistoryView extends StatefulWidget {
  final AppState state;
  const HistoryView({super.key, required this.state});
  @override
  State<HistoryView> createState() => _HistoryViewState();
}

class _HistoryViewState extends State<HistoryView> {
  String query = '', grade = 'Semua';
  @override
  Widget build(BuildContext context) {
    final list = widget.state.history
        .where(
          (r) =>
              (grade == 'Semua' || r['grade'] == grade) &&
              ('$r'.toLowerCase().contains(query.toLowerCase())),
        )
        .toList();
    return pageFrame([
      heading('Riwayat deteksi', '${list.length} hasil dari backend'),
      errorBanner(widget.state),
      TextField(
        decoration: const InputDecoration(
          labelText: 'Cari grade, kamera, atau tanggal',
          prefixIcon: Icon(Icons.search),
        ),
        onChanged: (v) => setState(() => query = v),
      ),
      const SizedBox(height: 10),
      Wrap(
        spacing: 7,
        children: [
          for (final value in <String>{'Semua', ...widget.state.history.map((r) => '${r['grade'] ?? ''}').where((value) => value.isNotEmpty)})
            ChoiceChip(
              label: Text(value),
              selected: grade == value,
              onSelected: (_) => setState(() => grade = value),
            ),
        ],
      ),
      Align(
        alignment: Alignment.centerRight,
        child: TextButton.icon(
          onPressed: list.isEmpty
              ? null
              : () => SharePlus.instance.share(
                  ShareParams(
                    text: _csv(list),
                    subject: 'Riwayat deteksi Tebu AI',
                  ),
                ),
          icon: const Icon(Icons.share_outlined),
          label: const Text('Bagikan CSV'),
        ),
      ),
      if (list.isEmpty)
        emptyState('Belum ada hasil yang cocok.')
      else
        ...list.map((r) => inferenceCard(context, r)),
    ]);
  }

  String _csv(List<Map<String, dynamic>> list) {
    String cell(dynamic value) => '"${s(value, '').replaceAll('"', '""')}"';
    return [
      'ID,Waktu,Kamera,Grade,Kepercayaan,Daun,Pucuk,Sampah',
      for (final r in list)
        [
          r['id'],
          r['timestamp'],
          r['cameraId'],
          r['grade'],
          r['confidence'],
          r['impurityMeasured'] == true ? row(r['classes'])['daun'] : 'Tidak diukur',
          r['impurityMeasured'] == true ? row(r['classes'])['pucuk'] : 'Tidak diukur',
          r['impurityMeasured'] == true ? row(r['classes'])['sampah'] : 'Tidak diukur',
        ].map(cell).join(','),
    ].join('\n');
  }
}
