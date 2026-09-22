import 'package:flutter/material.dart';

import '../core.dart' hide Row;

const green = Color(0xFF168349);
const mint = Color(0xFF35C777);

void snack(BuildContext context, String message) =>
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));

Future<void> runMutation(
  BuildContext context,
  Future<void> Function() work, [
  String success = 'Berhasil disimpan',
]) async {
  try {
    await work();
    if (context.mounted) {
      Navigator.maybePop(context);
      snack(context, success);
    }
  } catch (e) {
    if (context.mounted) snack(context, e.toString());
  }
}

Widget pageFrame(List<Widget> children) => ListView(
  padding: const EdgeInsets.all(16),
  children: [
    ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 1100),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: children,
      ),
    ),
  ],
);
Widget heading(String title, [String? subtitle]) => Padding(
  padding: const EdgeInsets.only(bottom: 12),
  child: Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        title,
        style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
      ),
      if (subtitle != null)
        Padding(padding: const EdgeInsets.only(top: 3), child: Text(subtitle)),
    ],
  ),
);
Widget infoCard(
  BuildContext context,
  String title,
  String value,
  IconData icon, {
  Color? color,
}) => Card(
  child: Padding(
    padding: const EdgeInsets.all(18),
    child: Row(
      children: [
        CircleAvatar(
          backgroundColor: (color ?? Theme.of(context).colorScheme.primary)
              .withValues(alpha: .12),
          child: Icon(
            icon,
            color: color ?? Theme.of(context).colorScheme.primary,
          ),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title),
              Text(
                value,
                style: const TextStyle(
                  fontSize: 21,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
        ),
      ],
    ),
  ),
);
Widget emptyState(String text) => Padding(
  padding: const EdgeInsets.symmetric(vertical: 36),
  child: Center(child: Text(text, textAlign: TextAlign.center)),
);
Widget errorBanner(AppState state) => state.error == null
    ? const SizedBox.shrink()
    : Card(
        color: const Color(0xFFFFE5E5),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Text(
            state.error!,
            style: const TextStyle(color: Color(0xFF8A1B1B)),
          ),
        ),
      );
String date(dynamic value) {
  final parsed = DateTime.tryParse(s(value, ''));
  if (parsed == null) return 'â€”';
  final local = parsed.toLocal();
  return '${local.day.toString().padLeft(2, '0')}/${local.month.toString().padLeft(2, '0')}/${local.year} ${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
}

String pct(dynamic value) => '${(d(value) * 100).toStringAsFixed(1)}%';

Widget statusTile(String name, String value) => ListTile(
  dense: true,
  title: Text(name),
  trailing: Text(
    value,
    style: TextStyle(
      fontWeight: FontWeight.bold,
      color: value == 'ok' || value == 'online' ? green : null,
    ),
  ),
);
Widget inferenceCard(BuildContext context, Map<String, dynamic> result) {
  final classes = row(result['classes']);
  return Card(
    child: Padding(
      padding: const EdgeInsets.all(15),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Grade ${s(result['grade'])}',
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 18,
                  ),
                ),
              ),
              Chip(label: Text(pct(result['confidence']))),
            ],
          ),
          Text(
            '${date(result['timestamp'])}  â€¢  Kamera #${s(result['cameraId'])}',
          ),
          const SizedBox(height: 7),
          Text(
            'Daun ${s(classes['daun'], '0')}  â€¢  Pucuk ${s(classes['pucuk'], '0')}  â€¢  Sampah ${s(classes['sampah'], '0')}',
          ),
        ],
      ),
    ),
  );
}

Future<void> confirmDelete(
  BuildContext context,
  String question,
  Future<void> Function() work,
) async {
  final yes = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: const Text('Konfirmasi'),
      content: Text(question),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialogContext, false),
          child: const Text('Batal'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(dialogContext, true),
          child: const Text('Hapus'),
        ),
      ],
    ),
  );
  if (yes == true && context.mounted) {
    try {
      await work();
      if (context.mounted) snack(context, 'Berhasil dihapus');
    } catch (e) {
      if (context.mounted) snack(context, e.toString());
    }
  }
}
