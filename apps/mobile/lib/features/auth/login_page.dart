import 'package:flutter/material.dart';

import '../../core.dart' hide Row;
import '../../ui/common.dart';

class LoginPage extends StatefulWidget {
  final AppState state;
  const LoginPage({super.key, required this.state});
  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final username = TextEditingController(),
      password = TextEditingController(),
      url = TextEditingController();
  bool visible = false;
  @override
  void initState() {
    super.initState();
    url.text = widget.state.api.baseUrl;
  }

  @override
  void dispose() {
    username.dispose();
    password.dispose();
    url.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.state;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Image.asset(
                    'assets/vale-amaze-mekaar-logo.png',
                    height: 62,
                    alignment: Alignment.centerLeft,
                  ),
                  const SizedBox(height: 30),
                  Text(
                    'Selamat datang di Tebu AI',
                    style: Theme.of(context).textTheme.headlineMedium
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Masuk untuk memantau kualitas tebu dan mengelola operasional.',
                  ),
                  const SizedBox(height: 28),
                  TextField(
                    controller: username,
                    decoration: const InputDecoration(
                      labelText: 'Username',
                      prefixIcon: Icon(Icons.person_outline),
                    ),
                    textInputAction: TextInputAction.next,
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: password,
                    obscureText: !visible,
                    onSubmitted: (_) =>
                        state.login(username.text.trim(), password.text),
                    decoration: InputDecoration(
                      labelText: 'Password',
                      prefixIcon: const Icon(Icons.lock_outline),
                      suffixIcon: IconButton(
                        tooltip: visible
                            ? 'Sembunyikan password'
                            : 'Lihat password',
                        icon: Icon(
                          visible
                              ? Icons.visibility_off_outlined
                              : Icons.visibility_outlined,
                        ),
                        onPressed: () => setState(() => visible = !visible),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  if (state.error != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Text(
                        state.error!,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    ),
                  FilledButton(
                    onPressed: state.busy
                        ? null
                        : () =>
                              state.login(username.text.trim(), password.text),
                    child: state.busy
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Masuk'),
                  ),
                  const SizedBox(height: 22),
                  ExpansionTile(
                    title: const Text('Pengaturan server'),
                    tilePadding: EdgeInsets.zero,
                    children: [
                      TextField(
                        controller: url,
                        keyboardType: TextInputType.url,
                        decoration: const InputDecoration(
                          labelText: 'Alamat API',
                          hintText: 'http://10.0.2.2:4110',
                        ),
                      ),
                      const SizedBox(height: 8),
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton(
                          onPressed: () async {
                            try {
                              await state.setUrl(url.text);
                              if (context.mounted) {
                                snack(context, 'Alamat server disimpan');
                              }
                            } catch (e) {
                              if (context.mounted) snack(context, e.toString());
                            }
                          },
                          child: const Text('Simpan alamat'),
                        ),
                      ),
                      const Text(
                        'Emulator Android: 10.0.2.2. Ponsel fisik: gunakan IP LAN komputer/server yang dapat diakses.',
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
