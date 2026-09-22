import 'dart:math';

import 'package:flutter/material.dart';

import '../../core.dart' hide Row;
import '../../ui/common.dart';

class AccessView extends StatefulWidget {
  final AppState state;
  const AccessView({super.key, required this.state});
  @override
  State<AccessView> createState() => _AccessViewState();
}

class _AccessViewState extends State<AccessView> {
  int tab = 0;
  @override
  Widget build(BuildContext context) {
    final state = widget.state;
    final roleTab = state.can('role.read');
    return pageFrame([
      heading('Pengguna & akses', 'Pengelolaan mengikuti izin dari backend'),
      errorBanner(state),
      if (roleTab)
        SegmentedButton<int>(
          segments: const [
            ButtonSegment(
              value: 0,
              label: Text('Pengguna'),
              icon: Icon(Icons.people_outline),
            ),
            ButtonSegment(
              value: 1,
              label: Text('Role & Izin'),
              icon: Icon(Icons.shield_outlined),
            ),
          ],
          selected: {tab},
          onSelectionChanged: (v) => setState(() => tab = v.first),
        ),
      const SizedBox(height: 14),
      tab == 0 ? _users(context) : _roles(context),
    ]);
  }

  Widget _users(BuildContext context) {
    final state = widget.state;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (state.can('user.write'))
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton.icon(
              onPressed: () => userDialog(context, state),
              icon: const Icon(Icons.person_add_alt),
              label: const Text('Tambah pengguna'),
            ),
          ),
        const SizedBox(height: 10),
        if (state.users.isEmpty)
          emptyState('Belum ada pengguna yang dapat ditampilkan.')
        else
          ...state.users.map(
            (u) => Card(
              child: ListTile(
                leading: const CircleAvatar(child: Icon(Icons.person_outline)),
                title: Text(s(u['username'])),
                subtitle: Text(
                  'Role: ${s(u['role'])}  â€¢  ${u['active'] == true ? 'Aktif' : 'Nonaktif'}',
                ),
                trailing: state.can('user.write')
                    ? IconButton(
                        tooltip: 'Ubah pengguna',
                        icon: const Icon(Icons.edit_outlined),
                        onPressed: () => userDialog(context, state, u),
                      )
                    : null,
              ),
            ),
          ),
      ],
    );
  }

  Widget _roles(BuildContext context) {
    final state = widget.state;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (state.can('role.write'))
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton.icon(
              onPressed: () => roleDialog(context, state),
              icon: const Icon(Icons.add),
              label: const Text('Tambah role'),
            ),
          ),
        const SizedBox(height: 10),
        if (state.roles.isEmpty)
          emptyState('Belum ada role yang dapat ditampilkan.')
        else
          ...state.roles.map(
            (role) => Card(
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    ListTile(
                      leading: const CircleAvatar(
                        child: Icon(Icons.shield_outlined),
                      ),
                      title: Text(s(role['name'])),
                      subtitle: Text(s(role['code'])),
                      trailing: role['system'] == true
                          ? const Chip(label: Text('SISTEM'))
                          : null,
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      child: Text(s(role['description'])),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(
                        '${(role['permissions'] as List?)?.length ?? 0} izin aktif',
                      ),
                    ),
                    if (state.can('role.write') && role['system'] != true)
                      Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          TextButton(
                            onPressed: () => roleDialog(context, state, role),
                            child: const Text('Ubah'),
                          ),
                          TextButton(
                            onPressed: () => confirmDelete(
                              context,
                              'Hapus role ${s(role['name'])}?',
                              () => state.mutate(
                                'DELETE',
                                '/api/roles/${n(role['id'])}',
                              ),
                            ),
                            child: const Text('Hapus'),
                          ),
                        ],
                      ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}

Future<void> userDialog(
  BuildContext context,
  AppState state, [
  Map<String, dynamic>? user,
]) async {
  final username = TextEditingController(text: s(user?['username'], ''));
  final password = TextEditingController();
  var roleId = n(user?['roleId']);
  var active = user?['active'] != false;
  final permittedRoles = state.roles
      .where(
        (r) =>
            state.user?['role'] == 'developer' ||
            !(r['permissions'] as List).any(
              (p) => [
                'user.read',
                'user.write',
                'role.read',
                'role.write',
                'model.write',
                'settings.read',
              ].contains(p),
            ),
      )
      .toList();
  if (!permittedRoles.any((r) => n(r['id']) == roleId)) {
    roleId = permittedRoles.isEmpty ? 0 : n(permittedRoles.first['id']);
  }
  await showDialog<void>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (dialogContext, setLocal) => AlertDialog(
        title: Text(user == null ? 'Tambah pengguna' : 'Ubah pengguna'),
        content: SizedBox(
          width: 420,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: username,
                  enabled: user == null,
                  decoration: const InputDecoration(labelText: 'Username'),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: password,
                  obscureText: true,
                  decoration: InputDecoration(
                    labelText: user == null
                        ? 'Password (min. 8 karakter)'
                        : 'Password baru (opsional)',
                  ),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<int>(
                  initialValue: roleId == 0 ? null : roleId,
                  decoration: const InputDecoration(labelText: 'Role'),
                  items: [
                    for (final r in permittedRoles)
                      DropdownMenuItem(
                        value: n(r['id']),
                        child: Text(s(r['name'])),
                      ),
                  ],
                  onChanged: (v) => setLocal(() => roleId = v ?? 0),
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Aktif'),
                  value: active,
                  onChanged: (v) => setLocal(() => active = v),
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
              if (roleId == 0 ||
                  (user == null &&
                      (username.text.trim().length < 3 ||
                          password.text.length < 8))) {
                snack(dialogContext, 'Periksa username, password, dan role');
                return;
              }
              await runMutation(
                dialogContext,
                () => state.mutate(
                  user == null ? 'POST' : 'PATCH',
                  user == null ? '/api/users' : '/api/users/${n(user['id'])}',
                  {
                    if (user == null) 'username': username.text.trim(),
                    if (user == null || password.text.isNotEmpty)
                      'password': password.text,
                    'roleId': roleId,
                    'active': active,
                  },
                ),
              );
            },
            child: const Text('Simpan'),
          ),
        ],
      ),
    ),
  );
  username.dispose();
  password.dispose();
}

const allPermissions = [
  'dashboard.read',
  'history.read',
  'inspection.write',
  'camera.read',
  'camera.write',
  'model.read',
  'model.write',
  'settings.read',
  'user.read',
  'user.write',
  'role.read',
  'role.write',
];

Future<void> roleDialog(
  BuildContext context,
  AppState state, [
  Map<String, dynamic>? role,
]) async {
  final code = TextEditingController(text: s(role?['code'], ''));
  final name = TextEditingController(text: s(role?['name'], ''));
  final description = TextEditingController(text: s(role?['description'], ''));
  final permissions = Set<String>.from(role?['permissions'] as List? ?? []);
  await showDialog<void>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (dialogContext, setLocal) => AlertDialog(
        title: Text(role == null ? 'Tambah role' : 'Ubah role'),
        content: SizedBox(
          width: 420,
          height: min(MediaQuery.sizeOf(dialogContext).height * .7, 620),
          child: ListView(
            children: [
              TextField(
                controller: code,
                enabled: role == null,
                decoration: const InputDecoration(
                  labelText: 'Kode role',
                  hintText: 'misalnya supervisor',
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: name,
                decoration: const InputDecoration(labelText: 'Nama role'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: description,
                decoration: const InputDecoration(labelText: 'Deskripsi'),
              ),
              const SizedBox(height: 12),
              const Text(
                'Izin akses',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              for (final permission in allPermissions)
                CheckboxListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(permission),
                  value: permissions.contains(permission),
                  onChanged: (v) => setLocal(
                    () => v == true
                        ? permissions.add(permission)
                        : permissions.remove(permission),
                  ),
                ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Batal'),
          ),
          FilledButton(
            onPressed: () async {
              if (name.text.trim().length < 2 ||
                  (role == null &&
                      !RegExp(r'^[a-z][a-z0-9_]{2,49}$')
                          .hasMatch(code.text.trim()))) {
                snack(dialogContext, 'Kode role atau nama tidak valid');
                return;
              }
              await runMutation(
                dialogContext,
                () => state.mutate(
                  role == null ? 'POST' : 'PUT',
                  role == null ? '/api/roles' : '/api/roles/${n(role['id'])}',
                  {
                    if (role == null) 'code': code.text.trim(),
                    'name': name.text.trim(),
                    'description': description.text.trim(),
                    'permissions': permissions.toList(),
                  },
                ),
              );
            },
            child: const Text('Simpan'),
          ),
        ],
      ),
    ),
  );
  code.dispose();
  name.dispose();
  description.dispose();
}
