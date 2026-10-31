import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

typedef Row = Map<String, dynamic>;

class ApiFailure implements Exception {
  final String message;
  final int status;
  const ApiFailure(this.message, this.status);
  @override
  String toString() => message;
}

class ApiClient {
  final http.Client client;
  String baseUrl;
  String? token;

  ApiClient({required this.baseUrl, http.Client? client})
    : client = client ?? http.Client();

  Uri url(String path) => Uri.parse('$baseUrl$path');

  Future<dynamic> request(String method, String path, [Object? body]) async {
    try {
      final response = await client.send(
        http.Request(method, url(path))
          ..headers.addAll({
            if (token != null) 'Authorization': 'Bearer $token',
            if (body != null) 'Content-Type': 'application/json',
          })
          ..body = body == null ? '' : jsonEncode(body),
      ).timeout(Duration(seconds: method == 'GET' ? 20 : 65));
      final raw = await http.Response.fromStream(response)
          .timeout(Duration(seconds: method == 'GET' ? 20 : 65));
      final decoded = raw.body.isEmpty ? null : jsonDecode(raw.body);
      if (raw.statusCode >= 400) {
        throw ApiFailure(
          decoded is Map && decoded['message'] is String
              ? decoded['message'] as String
              : 'Permintaan gagal (${raw.statusCode})',
          raw.statusCode,
        );
      }
      return decoded;
    } on ApiFailure {
      rethrow;
    } on SocketException {
      throw const ApiFailure(
        'Tidak dapat menghubungi server. Periksa alamat dan jaringan.',
        0,
      );
    } on FormatException {
      throw const ApiFailure('Respons server tidak valid.', 0);
    } on http.ClientException {
      throw const ApiFailure('Koneksi ke server gagal.', 0);
    } on TimeoutException {
      throw const ApiFailure('Server tidak merespons tepat waktu.', 0);
    }
  }

  Future<Row> uploadModel(
    String name,
    String version,
    PlatformFile file,
  ) async {
    final request = http.MultipartRequest('POST', url('/api/models/upload'))
      ..fields['name'] = name
      ..fields['version'] = version;
    request.files.add(
      file.path == null
          ? http.MultipartFile.fromBytes(
              'file',
              await file.readAsBytes(),
              filename: file.name,
            )
          : await http.MultipartFile.fromPath(
              'file',
              file.path!,
              filename: file.name,
            ),
    );
    if (token != null) request.headers['Authorization'] = 'Bearer $token';
    final response = await http.Response.fromStream(await client.send(request).timeout(const Duration(minutes: 5)))
        .timeout(const Duration(minutes: 5));
    final decoded = jsonDecode(response.body);
    if (response.statusCode >= 400) {
      throw ApiFailure(
        decoded is Map && decoded['message'] is String
            ? decoded['message'] as String
            : 'Unggah gagal',
        response.statusCode,
      );
    }
    return row(decoded);
  }

  void close() => client.close();
}

Row row(dynamic value) =>
    value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
List<Row> rows(dynamic value) =>
    value is List ? value.map(row).toList() : <Row>[];
String s(dynamic value, [String fallback = '—']) =>
    value == null || value.toString().isEmpty ? fallback : value.toString();
int n(dynamic value) =>
    value is num ? value.toInt() : int.tryParse('$value') ?? 0;
double d(dynamic value) =>
    value is num ? value.toDouble() : double.tryParse('$value') ?? 0;

class AppState extends ChangeNotifier {
  static const storage = FlutterSecureStorage();
  static const configuredUrl = String.fromEnvironment('API_BASE_URL');
  static String get defaultUrl => configuredUrl.isNotEmpty
      ? configuredUrl
      : Platform.isIOS
      ? 'http://127.0.0.1:4111'
      : 'http://10.0.2.2:4111';
  late final ApiClient api = ApiClient(baseUrl: defaultUrl);
  Row? user;
  Row status = {};
  Row latest = {};
  List<Row> history = [],
      trucks = [],
      cameras = [],
      models = [],
      users = [],
      roles = [];
  bool ready = false, busy = false, dark = false;
  String? error;
  Timer? poll;
  WebSocket? socket;
  bool _closed = false;
  int _refreshVersion = 0, _connectionVersion = 0;
  Timer? _retryTimer;

  bool can(String permission) =>
      (user?['permissions'] is List) &&
      (user!['permissions'] as List).contains(permission);
  bool get signedIn => user != null;

  Future<void> initialize() async {
    try {
      api.baseUrl =
          (await storage.read(key: 'malang_api_url'))
              ?.trim()
              .replaceAll(RegExp(r'/$'), '') ??
          defaultUrl;
      dark = (await storage.read(key: 'malang_theme')) == 'dark';
      api.token = await storage.read(key: 'malang_token');
      if (api.token != null) {
        try {
          user = row(await api.request('GET', '/api/auth/me'));
          await refresh();
          _startRealtime();
        } on ApiFailure catch (failure) {
          if (failure.status == 401) {
            await logout();
          } else {
            error = failure.message;
          }
        }
      }
    } finally {
      ready = true;
      notifyListeners();
    }
  }

  Future<void> login(String username, String password) async {
    busy = true;
    error = null;
    notifyListeners();
    try {
      final session = row(
        await api.request('POST', '/api/auth/login', {
          'username': username,
          'password': password,
        }),
      );
      api.token = s(session['token'], '');
      user = row(session['user']);
      await storage.write(key: 'malang_token', value: api.token);
      await refresh();
      _startRealtime();
    } catch (e) {
      error = e.toString();
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> refresh() async {
    if (user == null || _closed) return;
    final token = api.token;
    final version = ++_refreshVersion;
    try {
      final requests = <Future<dynamic>>[
        if (can('dashboard.read')) api.request('GET', '/api/system/status'),
        if (can('dashboard.read')) api.request('GET', '/api/inference/latest'),
        if (can('history.read')) api.request('GET', '/api/inference/history'),
        if (can('history.read')) api.request('GET', '/api/truck-inspections'),
        if (can('camera.read')) api.request('GET', '/api/cameras'),
        if (can('model.read')) api.request('GET', '/api/models'),
        if (can('user.read')) api.request('GET', '/api/users'),
        if (can('role.read')) api.request('GET', '/api/roles'),
      ];
      final values = await Future.wait(requests);
      if (_closed || api.token != token || version != _refreshVersion) return;
      var i = 0;
      if (can('dashboard.read')) status = row(values[i++]);
      if (can('dashboard.read')) latest = row(values[i++]);
      if (can('history.read')) history = rows(values[i++]);
      if (can('history.read')) trucks = rows(values[i++]);
      if (can('camera.read')) cameras = rows(values[i++]);
      if (can('model.read')) models = rows(values[i++]);
      if (can('user.read')) users = rows(values[i++]);
      if (can('role.read')) roles = rows(values[i++]);
      error = null;
    } on ApiFailure catch (failure) {
      if (_closed || api.token != token || version != _refreshVersion) return;
      if (failure.status == 401) {
        await logout();
        return;
      }
      error = failure.message;
    } catch (e) {
      if (_closed || api.token != token || version != _refreshVersion) return;
      error = e.toString();
    }
    if (!_closed) notifyListeners();
  }

  void _startRealtime() {
    poll?.cancel();
    poll = Timer.periodic(const Duration(seconds: 10), (_) => refresh());
    _connectSocket();
  }

  Future<void> _connectSocket() async {
    if (_closed || api.token == null) return;
    _retryTimer?.cancel();
    final version = ++_connectionVersion;
    final token = api.token!;
    socket?.close();
    socket = null;
    try {
      final wsUrl = api.baseUrl.replaceFirst(RegExp(r'^http'), 'ws');
      final connected = await WebSocket.connect(
        '$wsUrl/ws?token=${Uri.encodeComponent(token)}',
      ).timeout(const Duration(seconds: 20));
      if (_closed || api.token != token || version != _connectionVersion) {
        connected.close();
        return;
      }
      socket = connected;
      connected.listen(
        (_) { if (version == _connectionVersion) refresh(); },
        onDone: () => _retrySocket(version),
        onError: (_) => _retrySocket(version),
      );
    } catch (_) {
      _retrySocket(version);
    }
  }

  void _retrySocket(int version) {
    if (_closed || user == null || version != _connectionVersion) return;
    socket = null;
    _retryTimer?.cancel();
    _retryTimer = Timer(const Duration(seconds: 10), _connectSocket);
  }

  Future<void> mutate(String method, String path, [Object? body]) async {
    await api.request(method, path, body);
    await refresh();
  }

  Future<void> setUrl(String value) async {
    final normalized = value.trim().replaceAll(RegExp(r'/$'), '');
    final uri = Uri.tryParse(normalized);
    if (uri == null ||
        !['http', 'https'].contains(uri.scheme) ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment) {
      throw const ApiFailure(
        'Masukkan URL http:// atau https:// yang valid.',
        0,
      );
    }
    if (normalized == api.baseUrl) return;
    // Sessions belong to one backend. Never send a previous server's token
    // to an address entered in settings.
    await logout();
    api.baseUrl = normalized;
    await storage.write(key: 'malang_api_url', value: normalized);
    socket?.close();
    notifyListeners();
  }

  Future<void> setDark(bool value) async {
    dark = value;
    notifyListeners();
    await storage.write(key: 'malang_theme', value: value ? 'dark' : 'light');
  }

  Future<void> logout() async {
    _connectionVersion++;
    _refreshVersion++;
    _retryTimer?.cancel();
    poll?.cancel();
    socket?.close();
    socket = null;
    api.token = null;
    user = null;
    history = [];
    trucks = [];
    cameras = [];
    models = [];
    users = [];
    roles = [];
    latest = {};
    status = {};
    await storage.delete(key: 'malang_token');
    if (!_closed) notifyListeners();
  }

  @override
  void dispose() {
    _closed = true;
    _connectionVersion++;
    _retryTimer?.cancel();
    poll?.cancel();
    socket?.close();
    api.close();
    super.dispose();
  }
}
