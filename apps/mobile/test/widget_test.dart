import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sugarcane_mobile/core.dart';
import 'package:sugarcane_mobile/main.dart';

void main() {
  test('API mengirim bearer token dan membaca respons', () async {
    final api = ApiClient(
      baseUrl: 'http://localhost:4110',
      client: MockClient((request) async {
        expect(request.url.path, '/api/cameras');
        expect(request.headers['Authorization'], 'Bearer test-token');
        return http.Response(
          jsonEncode([
            {'id': 1, 'name': 'Kamera 1'},
          ]),
          200,
        );
      }),
    );
    api.token = 'test-token';
    expect(
      rows(await api.request('GET', '/api/cameras')).single['name'],
      'Kamera 1',
    );
    api.close();
  });

  test('API memunculkan pesan kesalahan backend', () async {
    final api = ApiClient(
      baseUrl: 'http://localhost:4110',
      client: MockClient(
        (_) async => http.Response('{"message":"Akses ditolak"}', 403),
      ),
    );
    expect(
      () => api.request('GET', '/api/users'),
      throwsA(
        isA<ApiFailure>().having((e) => e.message, 'message', 'Akses ditolak'),
      ),
    );
    api.close();
  });

  testWidgets('Layar login memiliki tombol lihat password', (tester) async {
    final state = AppState()..ready = true;
    await tester.pumpWidget(SugarcaneApp(state: state));
    expect(find.text('Selamat datang di Tebu AI'), findsOneWidget);
    expect(find.byIcon(Icons.visibility_outlined), findsOneWidget);
    await tester.tap(find.byIcon(Icons.visibility_outlined));
    await tester.pump();
    expect(find.byIcon(Icons.visibility_off_outlined), findsOneWidget);
    state.dispose();
  });

  testWidgets('Navigasi ponsel mengikuti izin dan menu tambahan', (
    tester,
  ) async {
    final state = AppState()
      ..ready = true
      ..user = {
        'username': 'operator',
        'role': 'operator',
        'permissions': [
          'dashboard.read',
          'history.read',
          'inspection.write',
          'camera.read',
          'model.read',
        ],
      };
    await tester.pumpWidget(SugarcaneApp(state: state));
    expect(find.text('Dashboard'), findsWidgets);
    expect(find.text('Lainnya'), findsOneWidget);
    await tester.tap(find.text('Lainnya'));
    await tester.pumpAndSettle();
    expect(find.text('Model AI'), findsOneWidget);
    expect(find.text('Pengguna'), findsNothing);
    state.dispose();
  });
}
