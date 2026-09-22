import 'package:flutter/material.dart';

import '../../core.dart' hide Row;
import '../../ui/common.dart';

class DashboardView extends StatelessWidget {
  final AppState state;
  const DashboardView({super.key, required this.state});
  @override
  Widget build(BuildContext context) {
    final recent = state.history.take(5).toList();
    final stats = state.status;
    return pageFrame([
      heading('Ringkasan operasional', 'Data langsung dari backend Sugarcane'),
      errorBanner(state),
      Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          SizedBox(
            width: 260,
            child: infoCard(
              context,
              'Deteksi tersedia',
              '${state.history.length}',
              Icons.analytics_outlined,
            ),
          ),
          SizedBox(
            width: 260,
            child: infoCard(
              context,
              'Kamera online',
              '${state.cameras.where((c) => c['status'] == 'online').length}/${state.cameras.length}',
              Icons.videocam_outlined,
            ),
          ),
          SizedBox(
            width: 260,
            child: infoCard(
              context,
              'Model aktif',
              s(
                state.models
                    .where((m) => m['active'] == true)
                    .firstOrNull?['name'],
                'Tidak ada',
              ),
              Icons.psychology_outlined,
            ),
          ),
        ],
      ),
      const SizedBox(height: 14),
      heading('Status layanan'),
      Card(
        child: Column(
          children: [
            statusTile('Backend', s(row(stats['backend'])['status'])),
            statusTile('AI Service', s(row(stats['ai'])['status'])),
            statusTile('Database', s(row(stats['database'])['status'])),
            statusTile(
              'WebSocket',
              '${n(row(stats['websocket'])['clients'])} klien',
            ),
          ],
        ),
      ),
      const SizedBox(height: 14),
      heading('Deteksi terbaru'),
      state.latest.isEmpty
          ? emptyState('Belum ada hasil deteksi dari backend.')
          : inferenceCard(context, state.latest),
      const SizedBox(height: 14),
      heading('Riwayat terbaru'),
      if (recent.isEmpty)
        emptyState('Belum ada riwayat deteksi.')
      else
        ...recent.map((r) => inferenceCard(context, r)),
    ]);
  }
}
