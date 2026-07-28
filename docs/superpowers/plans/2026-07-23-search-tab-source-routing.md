# Search Tab Source Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route each submitted desktop search through the data source selected by the active Tab while preserving legacy artist and unspecified-search behavior.

**Architecture:** Add a call-local `MusicSearchScope` across the service/provider boundary. Migrate signatures first, then implement scoped fallback behavior, deterministic Hybrid routing, and UI request-id protection in isolated TDD microcycles.

**Tech Stack:** Dart, Flutter, Riverpod, `flutter_test`

---

Design: `docs/superpowers/specs/2026-07-23-search-tab-source-routing-design.md`

Use `@superpowers:test-driven-development` for every RED/GREEN microcycle and `@superpowers:verification-before-completion` for each fresh pre-commit verification.

### Task 1: Interface and Override Compile Migration

**Files:**
- Modify contract: `lib/services/music_provider.dart`
- Modify production overrides: `lib/services/bilibili_music_provider.dart`, `lib/services/default_music_provider.dart`, `lib/services/fallback_music_provider.dart`, `lib/services/hybrid_music_provider.dart`, `lib/services/meting_music_provider.dart`
- Modify test overrides: `test/playback_commands_test.dart`, `test/music_service_test.dart`, `test/hybrid_music_provider_test.dart`, `test/widget_test.dart`

- [ ] **Step 1: Introduce only the interface change**

```dart
enum MusicSearchScope { all, songs, playlists, artists }

Future<List<Map<String, dynamic>>> searchSongs(
  String query, {
  MusicSearchScope? scope,
});
```

Do not change any override yet and do not add behavior.

- [ ] **Step 2: Run the isolated compile RED**

Run: `dart analyze`

Expected: FAIL with invalid override/signature diagnostics for every production and test implementation still missing `scope`.

- [ ] **Step 3: Migrate every override once**

Update all listed implementations and fakes to accept the identical optional named parameter. Providers may temporarily ignore it; no class may store scope in an instance field.

- [ ] **Step 4: Format the complete signature migration**

Run: `dart format lib/services/music_provider.dart lib/services/bilibili_music_provider.dart lib/services/default_music_provider.dart lib/services/fallback_music_provider.dart lib/services/hybrid_music_provider.dart lib/services/meting_music_provider.dart test/playback_commands_test.dart test/music_service_test.dart test/hybrid_music_provider_test.dart test/widget_test.dart`

- [ ] **Step 5: Run all post-format targeted GREEN checks**

Run: `dart analyze`

Run: `flutter test --no-pub test/music_service_test.dart test/hybrid_music_provider_test.dart test/playback_commands_test.dart`

Run: `flutter test --no-pub --plain-name "search waits for enter before querying" test/widget_test.dart`

Expected: all pass; `dart analyze` confirms every override migrated.

- [ ] **Step 6: Fresh verify immediately before commit**

Re-run the exact three Step 5 commands from a fresh shell invocation; do not rely on pre-format or cached results.

- [ ] **Step 7: Commit**

```bash
git add lib/services/music_provider.dart lib/services/bilibili_music_provider.dart lib/services/default_music_provider.dart lib/services/fallback_music_provider.dart lib/services/hybrid_music_provider.dart lib/services/meting_music_provider.dart test/playback_commands_test.dart test/music_service_test.dart test/hybrid_music_provider_test.dart test/widget_test.dart
git commit -m "refactor: add scoped search provider signatures"
```

### Task 2: MusicService Forwarding and Fallback Semantics

**Files:**
- Modify: `lib/services/music_provider.dart`, `lib/services/music_service.dart`, `lib/services/fallback_music_provider.dart`
- Modify: `test/music_service_test.dart`
- Create: `test/fallback_music_provider_test.dart`

For every microcycle below: add only the named test, run its command expecting RED, implement only that behavior, then rerun the same command expecting GREEN before starting the next test.

- [ ] **Microcycle A:** `MusicService forwards scope without changing conversion or cache` — Run: `flutter test --no-pub --plain-name "MusicService forwards scope without changing conversion or cache" test/music_service_test.dart`
- [ ] **Legacy forwarding microcycle:** `Fallback legacy scopes preserve raw semantics` — Run RED, implement only scope forwarding with no scoped filter, then run GREEN: `flutter test --no-pub --plain-name "Fallback legacy scopes preserve raw semantics" test/fallback_music_provider_test.dart`
- [ ] **Microcycle B:** `Fallback scoped search filters before fallback` — Run: `flutter test --no-pub --plain-name "Fallback scoped search filters before fallback" test/fallback_music_provider_test.dart`
- [ ] **Microcycle C:** `Fallback scoped search isolates failures and filters fallback` — Run: `flutter test --no-pub --plain-name "Fallback scoped search isolates failures and filters fallback" test/fallback_music_provider_test.dart`

The legacy forwarding microcycle must table-drive `all`, `artists`, and `null` and assert exact semantics:

- Primary raw non-empty: primary calls `1`, fallback calls `0`, return the unfiltered primary list exactly, and forward the same scope.
- Primary empty or throws: primary calls `1`, fallback calls `1`, return the unfiltered fallback list exactly, and forward the same scope to both.
- Do not trim IDs, remove duplicates, or filter types for `all`/`artists`/`null`.

Its minimal production change is only forwarding `scope` to primary and fallback while retaining the original raw emptiness decision. Add `filterSearchResultsForScope` and scoped fallback decisions only when Microcycles B/C turn RED.

Minimal implementation skeleton:

```dart
Future<List<Song>> searchSongs(
  String query, {
  MusicSearchScope? scope,
}) async {
  final results = await _provider.searchSongs(query, scope: scope);
  _cacheResults(results);
  return results.map(_toSong).toList();
}

final scoped = scope == MusicSearchScope.songs ||
    scope == MusicSearchScope.playlists;
final primaryRaw = await primary.searchSongs(query, scope: scope);
final primaryResult = scoped
    ? filterSearchResultsForScope(primaryRaw, scope!)
    : primaryRaw;
if (primaryResult.isNotEmpty) return primaryResult;
// Call fallback once; apply the same filter only for songs/playlists.
```

The shared scoped filter must normalize `resultType`, allow missing/blank/`song` only for songs, allow only `playlist` for playlists, trim IDs, drop empty IDs, and keep the first duplicate.

- [ ] **Step 5: Format**

Run: `dart format lib/services/music_provider.dart lib/services/music_service.dart lib/services/fallback_music_provider.dart test/music_service_test.dart test/fallback_music_provider_test.dart`

- [ ] **Step 6: Run the complete post-format targeted suite**

Run: `flutter test --no-pub test/music_service_test.dart test/fallback_music_provider_test.dart`

- [ ] **Step 7: Fresh verify immediately before commit**

Run: `dart analyze`

Run: `flutter test --no-pub test/music_service_test.dart test/fallback_music_provider_test.dart`

- [ ] **Step 8: Commit**

```bash
git add lib/services/music_provider.dart lib/services/music_service.dart lib/services/fallback_music_provider.dart test/music_service_test.dart test/fallback_music_provider_test.dart
git commit -m "feat: forward search scope and filter fallback results"
```

### Task 3: Deterministic Hybrid Routing and Playlist Merge

**Files:**
- Modify: `lib/services/hybrid_music_provider.dart`
- Modify: `test/hybrid_music_provider_test.dart`

- [ ] **Step 1: Add behavior-preserving characterization tests and keep them GREEN**

Characterize `artists` and `null` legacy composition plus internal lyric/playback reverse searches receiving `scope: null`. Also add `Hybrid playlist keywords skip supplemental search`, covering trimmed `歌单`, `合集`, and case-insensitive `playlist`; this is existing baseline behavior, not a RED test. Use immediate controlled Providers, not an 800ms wall-clock wait.

Run: `flutter test --no-pub --plain-name "Hybrid playlist keywords skip supplemental search" test/hybrid_music_provider_test.dart`

Expected: GREEN before any Hybrid production change.

Run: `flutter test --no-pub test/hybrid_music_provider_test.dart`

Expected: GREEN before changing Hybrid production behavior; existing collection-lyrics and direct-subtitle tests also remain green.

For each new behavior below: add only that test, run the exact command for RED, implement the smallest increment, then rerun the same command for GREEN.

- [ ] `Hybrid all narrows child scopes and keeps fixed source order` — `flutter test --no-pub --plain-name "Hybrid all narrows child scopes and keeps fixed source order" test/hybrid_music_provider_test.dart`
- [ ] `Hybrid all filters types ids and source markers` — `flutter test --no-pub --plain-name "Hybrid all filters types ids and source markers" test/hybrid_music_provider_test.dart`
- [ ] `Hybrid all isolates source failures` — `flutter test --no-pub --plain-name "Hybrid all isolates source failures" test/hybrid_music_provider_test.dart`
- [ ] **Direct-routing RED batch:** Add `Hybrid songs calls only metadata`, `Hybrid playlists calls only playback`, and `Hybrid concurrent scopes stay call local` together. The concurrency test must use query `同名 歌单` so supplemental search is disabled. Run RED once: `flutter test --no-pub --name "Hybrid (songs calls only metadata|playlists calls only playback|concurrent scopes stay call local)" test/hybrid_music_provider_test.dart`; implement one minimal call-local `songs`/`playlists` routing switch; rerun the same batch for GREEN.
- [ ] `Hybrid playlist queries start together and merge deterministically` — before completing either Future assert both ordinary and supplemental calls started; complete supplemental first; assert ordinary-first order and cross-group first-ID deduplication; command: `flutter test --no-pub --plain-name "Hybrid playlist queries start together and merge deterministically" test/hybrid_music_provider_test.dart`
- [ ] `Hybrid playlist single-side failure keeps successful results` — use one table-driven test with rows for ordinary failure and supplemental failure; command: `flutter test --no-pub --plain-name "Hybrid playlist single-side failure keeps successful results" test/hybrid_music_provider_test.dart`
- [ ] **Re-run baseline characterization after the new routing exists:** `flutter test --no-pub --plain-name "Hybrid playlist keywords skip supplemental search" test/hybrid_music_provider_test.dart`; expected GREEN, never RED.

Minimal routing skeleton:

```dart
return switch (scope) {
  MusicSearchScope.all => _searchAll(query),
  MusicSearchScope.songs => _searchSongsOnly(query),
  MusicSearchScope.playlists => _searchPlaylistsOnly(query),
  MusicSearchScope.artists => _searchLegacy(query, scope: scope),
  null => _searchLegacy(query, scope: null),
};

final metadataFuture = _safeMetadataSearch(
  query,
  scope: MusicSearchScope.songs,
);
final playlistFuture = _searchBilibiliPlaylists(query);
final metadataSongs = await metadataFuture;
final playlists = await playlistFuture;

final ordinaryFuture = _safePlaybackSearch(query);
final supplementalFuture = _safePlaybackSearch('$query 歌单');
// Both Futures exist before either await; merge ordinary then supplemental.
```

Never forward `all`, never store an active scope field, isolate each source/query error, preserve `_withBilibiliPlaybackSource` and Bilibili `sourceLabel`, and explicitly pass `scope: null` in internal reverse searches.

- [ ] **Step 3: Format**

Run: `dart format lib/services/hybrid_music_provider.dart test/hybrid_music_provider_test.dart`

- [ ] **Step 4: Run the complete post-format targeted suite**

Run: `flutter test --no-pub test/hybrid_music_provider_test.dart`

- [ ] **Step 5: Fresh verify immediately before commit**

Run: `dart analyze`

Run: `flutter test --no-pub test/hybrid_music_provider_test.dart`

- [ ] **Step 6: Commit**

```bash
git add lib/services/hybrid_music_provider.dart test/hybrid_music_provider_test.dart
git commit -m "feat: route hybrid searches deterministically"
```

### Task 4: Desktop Scope Mapping and Request-ID Protection

**Files:**
- Modify: `lib/desktop/screens/desktop_search_screen.dart`
- Modify: `test/widget_test.dart`

For each test below: add one test, run its command for RED, implement only its requirement, and rerun the same command for GREEN.

- [ ] `scoped search maps tabs at submit time` — assert switching alone does not search and map all four tabs; command: `flutter test --no-pub --plain-name "scoped search maps tabs at submit time" test/widget_test.dart`
- [ ] `scoped search latest request wins reverse completion` — submit twice while loading using two `receiveAction` calls, using only `pump`; complete latest then old and keep latest state; command: `flutter test --no-pub --plain-name "scoped search latest request wins reverse completion" test/widget_test.dart`
- [ ] `scoped search old provider error keeps latest loading` — command: `flutter test --no-pub --plain-name "scoped search old provider error keeps latest loading" test/widget_test.dart`
- [ ] `scoped search empty query invalidates pending request` — command: `flutter test --no-pub --plain-name "scoped search empty query invalidates pending request" test/widget_test.dart`

Controlled widget tests must never call `pumpAndSettle`:

```dart
await tester.testTextInput.receiveAction(TextInputAction.search);
await tester.pump();
expect(container.read(searchLoadingProvider), isTrue);
await tester.enterText(find.byType(TextField), 'new');
await tester.testTextInput.receiveAction(TextInputAction.search);
await tester.pump();
expect(provider.calls, hasLength(2));
```

For the old-error test, call `completeError` on the old Provider Future. `MusicService.searchSongs` converts that failure to an empty result, so assert request-id rejection of that stale returned result, not execution of the widget `catch`: after pumping the old completion loading remains `true`; after completing and pumping the new request loading becomes `false` and only the new result is visible.

Minimal screen skeleton:

```dart
int _latestSearchRequestId = 0;

final requestId = ++_latestSearchRequestId;
final query = rawQuery.trim();
final scope = _scopeFor(ref.read(searchTabProvider));
if (query.isEmpty) {
  // Clear query/results/loading after consuming the request id.
  return;
}
final results = await musicService.searchSongs(query, scope: scope);
if (!mounted || requestId != _latestSearchRequestId) return;
// Write results and set loading false only for the latest request.
```

Map `SearchTab` to `MusicSearchScope` with an explicit switch. Apply the same mounted/latest-id guard before error-path loading writes, and keep Tab changes view-only.

- [ ] **Step 3: Format**

Run: `dart format lib/desktop/screens/desktop_search_screen.dart test/widget_test.dart`

- [ ] **Step 4: Run all post-format targeted widget tests**

Run: `flutter test --no-pub --plain-name "search" test/widget_test.dart`

- [ ] **Step 5: Fresh verify immediately before commit**

Run: `dart analyze`

Run: `flutter test --no-pub --plain-name "search" test/widget_test.dart`

- [ ] **Step 6: Commit**

```bash
git add lib/desktop/screens/desktop_search_screen.dart test/widget_test.dart
git commit -m "feat: route desktop searches by selected tab"
```

## Full Verification

- [ ] Run: `dart analyze`
- [ ] Run: `flutter test --no-pub`
