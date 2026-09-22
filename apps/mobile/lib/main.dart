import 'dart:math';

import 'package:flutter/material.dart';

import 'core.dart' hide Row;
import 'ui/common.dart';
import 'features/auth/login_page.dart';
import 'features/dashboard/dashboard_page.dart';
import 'features/history/history_page.dart';
import 'features/trucks/trucks_page.dart';
import 'features/cameras/cameras_page.dart';
import 'features/models/models_page.dart';
import 'features/access/access_page.dart';
import 'features/settings/settings_page.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final state = AppState();
  state.initialize();
  runApp(SugarcaneApp(state: state));
}

class SugarcaneApp extends StatelessWidget {
  final AppState state;
  const SugarcaneApp({super.key, required this.state});

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: state,
    builder: (context, _) => MaterialApp(
      title: 'Tebu AI',
      debugShowCheckedModeBanner: false,
      themeMode: state.dark ? ThemeMode.dark : ThemeMode.light,
      theme: _theme(false),
      darkTheme: _theme(true),
      home: !state.ready
          ? const SplashPage()
          : state.signedIn
          ? HomePage(state: state)
          : LoginPage(state: state),
    ),
  );
}

ThemeData _theme(bool dark) {
  final scheme = ColorScheme.fromSeed(
    seedColor: green,
    brightness: dark ? Brightness.dark : Brightness.light,
    surface: dark ? const Color(0xFF0D1C16) : Colors.white,
    primary: dark ? mint : green,
  );
  return ThemeData(
    colorScheme: scheme,
    scaffoldBackgroundColor: dark
        ? const Color(0xFF07110D)
        : const Color(0xFFF5F8F5),
    useMaterial3: true,
    appBarTheme: AppBarTheme(
      backgroundColor: dark ? const Color(0xFF0D1C16) : Colors.white,
      elevation: 0,
    ),
    cardTheme: CardThemeData(
      color: scheme.surface,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(
          color: dark ? const Color(0xFF263B30) : const Color(0xFFDDE8DF),
        ),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
  );
}

class SplashPage extends StatelessWidget {
  const SplashPage({super.key});
  @override
  Widget build(BuildContext context) =>
      const Scaffold(body: Center(child: CircularProgressIndicator()));
}

class _NavItem {
  final String title, permission;
  final IconData icon;
  const _NavItem(this.title, this.permission, this.icon);
}

const _items = [
  _NavItem('Dashboard', 'dashboard.read', Icons.dashboard_outlined),
  _NavItem('Riwayat', 'history.read', Icons.history),
  _NavItem('Truk', 'history.read', Icons.local_shipping_outlined),
  _NavItem('Kamera', 'camera.read', Icons.videocam_outlined),
  _NavItem('Model AI', 'model.read', Icons.psychology_outlined),
  _NavItem('Pengguna', 'user.read', Icons.people_outline),
  _NavItem('Pengaturan', '', Icons.settings_outlined),
];

class HomePage extends StatefulWidget {
  final AppState state;
  const HomePage({super.key, required this.state});
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  int selected = 0;
  @override
  Widget build(BuildContext context) {
    final state = widget.state;
    final available = _items
        .where((item) => item.permission.isEmpty || state.can(item.permission))
        .toList();
    if (selected >= available.length) selected = 0;
    final item = available[selected];
    final primaryCount = min(3, available.length);
    final wide = MediaQuery.sizeOf(context).width >= 850;
    final body = switch (item.title) {
      'Dashboard' => DashboardView(state: state),
      'Riwayat' => HistoryView(state: state),
      'Truk' => TrucksView(state: state),
      'Kamera' => CamerasView(state: state),
      'Model AI' => ModelsView(state: state),
      'Pengguna' => AccessView(state: state),
      _ => SettingsView(state: state),
    };
    return Scaffold(
      appBar: AppBar(
        title: Text(
          item.title,
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        actions: [
          IconButton(
            tooltip: 'Muat ulang',
            onPressed: state.refresh,
            icon: const Icon(Icons.refresh),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: Row(
        children: [
          if (wide)
            NavigationRail(
              selectedIndex: selected,
              extended: MediaQuery.sizeOf(context).width >= 1100,
              onDestinationSelected: (i) => setState(() => selected = i),
              labelType: MediaQuery.sizeOf(context).width >= 1100
                  ? NavigationRailLabelType.none
                  : NavigationRailLabelType.all,
              destinations: [
                for (final nav in available)
                  NavigationRailDestination(
                    icon: Icon(nav.icon),
                    label: Text(nav.title),
                  ),
              ],
            ),
          Expanded(
            child: RefreshIndicator(onRefresh: state.refresh, child: body),
          ),
        ],
      ),
      bottomNavigationBar: wide
          ? null
          : NavigationBar(
              height: 70,
              selectedIndex: selected < primaryCount ? selected : primaryCount,
              onDestinationSelected: (i) {
                if (i < primaryCount) {
                  setState(() => selected = i);
                  return;
                }
                showModalBottomSheet<void>(
                  context: context,
                  builder: (sheetContext) => SafeArea(
                    child: ListView(
                      shrinkWrap: true,
                      children: [
                        for (
                          var index = primaryCount;
                          index < available.length;
                          index++
                        )
                          ListTile(
                            leading: Icon(available[index].icon),
                            title: Text(available[index].title),
                            selected: selected == index,
                            onTap: () {
                              Navigator.pop(sheetContext);
                              setState(() => selected = index);
                            },
                          ),
                      ],
                    ),
                  ),
                );
              },
              destinations: [
                for (final nav in available.take(primaryCount))
                  NavigationDestination(icon: Icon(nav.icon), label: nav.title),
                if (available.length > primaryCount)
                  const NavigationDestination(
                    icon: Icon(Icons.menu),
                    label: 'Lainnya',
                  ),
              ],
            ),
    );
  }
}
