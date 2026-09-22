import 'package:flutter/material.dart';

import '../../core.dart' hide Row;
import '../../ui/common.dart';

class SettingsView extends StatefulWidget {
  final AppState state;
  const SettingsView({super.key, required this.state});
  @override
  State<SettingsView> createState() => _SettingsViewState();
}

class _SettingsViewState extends State<SettingsView> {
  late final url = TextEditingController(text: widget.state.api.baseUrl);
  @override
  void dispose() {
    url.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.state;
    return pageFrame([
      heading('Pengaturan aplikasi'),
      errorBanner(state),
      Card(
        child: Column(
          children: [
            SwitchListTile(
              secondary: Icon(
                state.dark
                    ? Icons.dark_mode_outlined
                    : Icons.light_mode_outlined,
              ),
              title: const Text('Mode gelap'),
              subtitle: const Text('Tema Tebu AI untuk perangkat ini'),
              value: state.dark,
              onChanged: state.setDark,
            ),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.person_outline),
              title: Text(s(state.user?['username'])),
              subtitle: Text('Role: ${s(state.user?['role'])}'),
            ),
          ],
        ),
      ),
      const SizedBox(height: 15),
      heading(
        'Koneksi backend',
        'Web, desktop, dan mobile menggunakan API yang sama',
      ),
      TextField(
        controller: url,
        keyboardType: TextInputType.url,
        decoration: const InputDecoration(
          labelText: 'Alamat API',
          hintText: 'http://10.0.2.2:4110',
        ),
      ),
      const SizedBox(height: 10),
      Align(
        alignment: Alignment.centerLeft,
        child: OutlinedButton.icon(
          onPressed: () async {
            try {
              await state.setUrl(url.text);
              if (context.mounted) snack(context, 'Alamat API disimpan');
            } catch (e) {
              if (context.mounted) snack(context, e.toString());
            }
          },
          icon: const Icon(Icons.save_outlined),
          label: const Text('Simpan alamat'),
        ),
      ),
      const SizedBox(height: 10),
      const Text(
        'Untuk ponsel fisik, gunakan alamat IP LAN atau domain server. HTTP hanya untuk pengembangan; produksi wajib HTTPS.',
      ),
      const SizedBox(height: 28),
      OutlinedButton.icon(
        onPressed: state.logout,
        icon: const Icon(Icons.logout),
        label: const Text('Keluar'),
      ),
    ]);
  }
}
