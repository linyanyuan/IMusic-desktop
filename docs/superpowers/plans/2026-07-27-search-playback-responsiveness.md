# Search Playback Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make song clicks and playlist additions respond immediately, move lyrics off the playback critical path, progressively enrich playlist search results, and remove the unused artist tab.

**Architecture:** Keep the existing Riverpod and `audioplayers` architecture. Shorten service critical paths and make UI state optimistic, while request serials, search request IDs, and an ordered committed-library mutation queue protect asynchronous state from stale writes.

**Tech Stack:** Flutter 3.41, Dart 3.11, Riverpod 2, audioplayers 6, Dio 5, flutter_test

---

## File Map

- Modify `lib/playback/playback_actions.dart`: publish the requested song and stop old audio before playback resolution.
- Modify `lib/playback/playback_providers.dart`: only if a focused loading state helper is needed; prefer the existing song `status` field.
- Modify `lib/desktop/widgets/desktop_player_bar.dart`: render an indeterminate progress track while the current song is loading.
- Modify `lib/services/music_provider.dart`: define playlist-summary and lightweight playback-ID contracts with safe default implementations.
- Modify `lib/services/bilibili_music_provider.dart`: cache CID values, separate CC subtitle loading from play URL resolution, and implement lightweight playlist summaries.
- Modify `lib/services/hybrid_music_provider.dart`: reuse cached metadata for playback matching, preserve asynchronous Bilibili CC subtitles, and expose lightweight playback-ID resolution.
- Modify `lib/services/music_service.dart`: expose playlist-summary and stable playback-metadata operations to UI/application code.
- Modify `lib/desktop/screens/desktop_search_screen.dart`: remove artist tab, publish search results immediately, enrich playlist rows with four workers, and format progressive summary text.
- Modify `lib/services/library_service.dart`: optimistic add, committed-library shadow, ordered remote mutations, and selective rollback.
- Modify `lib/main.dart`: use lightweight playback metadata resolution when persisting library songs.
- Modify `lib/desktop/screens/desktop_playlist_detail_screen.dart`: show immediate and final add-to-playlist feedback.
- Test `test/playback_commands_test.dart`: playback ordering and stale-request behavior.
- Test `test/widget_test.dart`: player loading animation, search tabs, progressive playlist rows, and menu feedback.
- Test `test/bilibili_music_provider_test.dart`: play URL/subtitle separation, CID reuse, and playlist summaries.
- Test `test/hybrid_music_provider_test.dart`: cached metadata playback matching and CC subtitle fallback order.
- Test `test/library_service_test.dart`: optimistic add, stable ID persistence, ordered writes, and selective rollback.

## Task 1: Immediate Playback Stop and Indeterminate Progress

**Files:**
- Modify: `lib/playback/playback_actions.dart`
- Modify: `lib/desktop/widgets/desktop_player_bar.dart`
- Test: `test/playback_commands_test.dart`
- Test: `test/widget_test.dart`

- [ ] **Step 1: Add a failing playback-order test**

Extend the controlled playback provider in `test/playback_commands_test.dart` with a `Completer<PlaybackUrl>`. Start with a playing old song, call `startSongPlayback` for a new song without completing the resolver, then assert:

```dart
expect(audioPlatform.calls, contains('stop'));
expect(container.read(currentSongProvider)?['id'], 'new-song');
expect(container.read(currentSongProvider)?['status'], 'loading');
```

- [ ] **Step 2: Run the playback test and verify RED**

Run:

```powershell
flutter test .\test\playback_commands_test.dart --plain-name "new playback stops the current song before URL resolution"
```

Expected: FAIL because current code waits for `getPlayUrl` before calling `stop` and publishing the loading song.

- [ ] **Step 3: Implement immediate loading and stop**

In `startSongPlayback`:

```dart
showRequestedSongLoading();
final player = ref.read(audioPlayerProvider);
await player.stop();
previousPlaybackStopped = true;

if (requestSerial != playbackRequestSerial) return;
final musicService = ref.read(musicServiceProvider);
final playUrl = await musicService.getPlayUrl(song['id'].toString());
```

Remove `keepPreviousPlaybackVisible`. Keep every existing request-serial check and ensure errors leave the requested song in `error` state.

- [ ] **Step 4: Run the playback test and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Add failing player-bar state tests**

In `test/widget_test.dart`, set `currentSongProvider` to a song with `status: 'loading'`, pump `DesktopPlayerBar`, and assert that `player-progress-indeterminate-track` exists and `player-progress-active-track` does not. Add focused cases for an `error` song and no current song that assert a keyed static empty track is visible, no active track or thumb remains, and seeking is disabled.

- [ ] **Step 6: Run the widget test and verify RED**

```powershell
flutter test .\test\widget_test.dart --plain-name "player progress is indeterminate while a song is loading"
```

Expected: FAIL because `_ProgressBar` has no loading mode.

- [ ] **Step 7: Implement the indeterminate track**

Pass `isLoading: playbackStatus == 'loading'` into `_ProgressBar`. Add a focused stateful `_IndeterminateProgressTrack` using one repeating `AnimationController`. While loading:

- render the new keyed track with the current accent color;
- do not render the deterministic active track or thumb;
- return early from seek/tap/drag handlers;
- preserve the existing 12-pixel hit area and 3-pixel resting track height.

Pass an enabled/deterministic mode only when a current song has a playable non-error status. For `error` or no current song, render a keyed static empty track, omit the active track and thumb, and return early from all seek handlers so stale duration/position state cannot remain visible or interactive.

- [ ] **Step 8: Run Task 1 tests**

```powershell
flutter test .\test\playback_commands_test.dart .\test\widget_test.dart
```

Expected: Task 1 tests pass; record any pre-existing unrelated failures separately.

- [ ] **Step 9: Commit Task 1**

```powershell
git add lib/playback/playback_actions.dart lib/desktop/widgets/desktop_player_bar.dart test/playback_commands_test.dart test/widget_test.dart
git commit -m "fix: respond immediately to playback requests"
```

## Task 2: Remove Lyrics and Redundant Metadata From the Playback Critical Path

**Files:**
- Modify: `lib/services/bilibili_music_provider.dart`
- Modify: `lib/services/hybrid_music_provider.dart`
- Test: `test/bilibili_music_provider_test.dart`
- Test: `test/hybrid_music_provider_test.dart`

- [ ] **Step 1: Add failing Bilibili request-order tests**

Add adapter-backed tests proving:

```dart
expect(requestPaths, contains('/x/player/playurl'));
expect(requestPaths, isNot(contains('/x/player/v2')));
expect(playUrl.lyrics, isEmpty);
```

Then call `provider.getLyrics(song)` after `getPlayUrl` and assert CC lyrics are returned without a second `/x/player/pagelist` request.

- [ ] **Step 2: Verify Bilibili tests are RED**

```powershell
flutter test .\test\bilibili_music_provider_test.dart --plain-name "play URL resolution does not wait for subtitles"
flutter test .\test\bilibili_music_provider_test.dart --plain-name "lyrics reuse the CID resolved for playback"
```

Expected: the first test sees `/x/player/v2`; the second lacks the new public async lyric path/CID cache.

- [ ] **Step 3: Implement CID caching and async CC lyrics**

Add a private `Map<String, String> _cidByPlaybackId`. In `getPlayUrl`, cache the CID and remove `_getLyrics` from the awaited path. Override `getLyrics(Map<String, dynamic> song)` to:

1. return existing lyrics;
2. find CID in song data or `_cidByPlaybackId`;
3. fetch pagelist only when CID is unavailable;
4. call the existing private CC subtitle loader.

- [ ] **Step 4: Add a failing Hybrid fallback test**

Create a playback fake that returns direct CC lyrics from `getLyrics` and a metadata fake that records searches. Assert `HybridMusicProvider.getLyrics` returns CC text without metadata calls. Add a second case where CC is empty and existing metadata fallback still runs.

- [ ] **Step 5: Implement Hybrid subtitle ordering**

For Bilibili songs, call `playback.getLyrics(song)` first. If empty, keep the existing quoted-collection and reverse-metadata logic unchanged.

- [ ] **Step 6: Add a failing cached-metadata playback test**

Remember a Meting search song containing title/artist, call `getPlayUrl`, and assert the metadata fake's `getSongDetail` count remains zero while playback matching succeeds.

- [ ] **Step 7: Reuse cached metadata before fetching detail**

In `HybridMusicProvider.getPlayUrl`, use `_songCache[id]` when it contains a non-empty title. Fetch metadata detail only when the cache cannot provide matching fields. Preserve existing lyrics and playback-ID merging.

- [ ] **Step 8: Run Task 2 tests**

```powershell
flutter test .\test\bilibili_music_provider_test.dart .\test\hybrid_music_provider_test.dart .\test\music_service_test.dart
```

Expected: all Task 2 tests pass.

- [ ] **Step 9: Commit Task 2**

```powershell
git add lib/services/bilibili_music_provider.dart lib/services/hybrid_music_provider.dart test/bilibili_music_provider_test.dart test/hybrid_music_provider_test.dart
git commit -m "perf: move lyrics off playback startup"
```

## Task 3: Progressive Playlist Summaries and Search Tab Cleanup

**Files:**
- Modify: `lib/services/music_provider.dart`
- Modify: `lib/services/bilibili_music_provider.dart`
- Modify: `lib/services/hybrid_music_provider.dart`
- Modify: `lib/services/music_service.dart`
- Modify: `lib/desktop/screens/desktop_search_screen.dart`
- Test: `test/bilibili_music_provider_test.dart`
- Test: `test/hybrid_music_provider_test.dart`
- Test: `test/widget_test.dart`

- [ ] **Step 1: Add failing playlist-summary provider tests**

Define the desired API in tests:

```dart
final summary = await provider.getPlaylistSummary(playlistMap);
expect(summary.kind, PlaylistSummaryKind.multiPage);
expect(summary.songCount, 3);
expect(summary.available, isTrue);
```

Cover multi-page, single long collection, single-page collection, and failed/unavailable responses.

- [ ] **Step 2: Verify provider tests are RED**

```powershell
flutter test .\test\bilibili_music_provider_test.dart --plain-name "playlist summary classifies Bilibili page layouts"
```

Expected: compile failure because the summary contract does not exist.

- [ ] **Step 3: Implement the summary contract**

In `music_provider.dart`, add:

```dart
enum PlaylistSummaryKind { multiPage, singleLongCollection, singlePageCollection }

class PlaylistSummary {
  final bool available;
  final int songCount;
  final PlaylistSummaryKind kind;
}
```

Add a default unavailable implementation to `MusicProvider`. Implement it in Bilibili using only `/x/player/pagelist`, forward from Hybrid, and expose it from `MusicService`.

- [ ] **Step 4: Add failing search UI tests**

Use a fake provider whose summary Future is controlled by a Completer. Assert:

- the playlist row and `正在获取曲目数...` are visible before completion;
- completing with multi-page data updates the same row to `12 首歌曲 · 分P合集`;
- a single long result displays `歌曲集合` and duration;
- a single short collection displays `歌曲集合` with any title-derived estimate;
- a stale earlier search completion cannot update a later query;
- all-search results with result types other than `song` or `playlist` are not rendered;
- `艺人` is absent and exactly three tabs remain.

- [ ] **Step 5: Verify search UI tests are RED**

```powershell
flutter test .\test\widget_test.dart --plain-name "playlist search results are enriched without blocking initial display"
flutter test .\test\widget_test.dart --plain-name "search exposes only all songs and playlists tabs"
```

- [ ] **Step 6: Implement immediate results and four-worker enrichment**

After the main search completes:

1. annotate existing playlist results with `playlistSummaryState: loading`;
2. publish results and clear `searchLoadingProvider` immediately;
3. start an unawaited worker pool with `min(4, playlistCount)` workers;
4. after each summary, verify `mounted` and request ID, then replace only the matching Song using `copyWith` and merged `extra` fields.

Format the playlist subtitle from `Song` state before constructing the existing `Playlist` UI model. Never change `resultType` or reorder results.

- [ ] **Step 7: Remove artist tab**

Delete `SearchTab.artists`, its label, and its scope branch. In the all-results view, render only results whose `resultType` is `song` or `playlist`; providers may still return other result types, but the page must not treat them as songs. Keep all/songs/playlists search requests otherwise unchanged.

- [ ] **Step 8: Run Task 3 tests**

```powershell
flutter test .\test\bilibili_music_provider_test.dart .\test\hybrid_music_provider_test.dart .\test\widget_test.dart
```

Expected: Task 3 tests pass apart from documented pre-existing failures outside touched behavior.

- [ ] **Step 9: Commit Task 3**

```powershell
git add lib/services/music_provider.dart lib/services/bilibili_music_provider.dart lib/services/hybrid_music_provider.dart lib/services/music_service.dart lib/desktop/screens/desktop_search_screen.dart test/bilibili_music_provider_test.dart test/hybrid_music_provider_test.dart test/widget_test.dart
git commit -m "feat: enrich playlist search results progressively"
```

## Task 4: Fast Optimistic Add-to-Playlist With Ordered Remote Mutations

**Files:**
- Modify: `lib/services/music_provider.dart`
- Modify: `lib/services/hybrid_music_provider.dart`
- Modify: `lib/services/music_service.dart`
- Modify: `lib/services/library_service.dart`
- Modify: `lib/main.dart`
- Modify: `lib/desktop/screens/desktop_search_screen.dart`
- Modify: `lib/desktop/screens/desktop_playlist_detail_screen.dart`
- Test: `test/hybrid_music_provider_test.dart`
- Test: `test/library_service_test.dart`
- Test: `test/widget_test.dart`

- [ ] **Step 1: Add a failing lightweight playback-ID test**

Remember a metadata song, resolve its persistent metadata, and assert the playback provider only receives search calls: no `getPlayUrl`, subtitle, or pagelist request. Bilibili IDs should normalize without network access.

- [ ] **Step 2: Verify the lightweight resolver test is RED**

```powershell
flutter test .\test\hybrid_music_provider_test.dart --plain-name "persistent playback metadata resolves an ID without loading audio"
```

- [ ] **Step 3: Implement lightweight persistent metadata resolution**

Add a default `resolvePlaybackId(Map<String, dynamic> song)` contract to `MusicProvider`. Hybrid should reuse a stable ID or `_resolveBilibiliPlaybackId` without calling `getPlayUrl`. `MusicService.resolvePlaybackMetadata(Song song)` should merge mobile compatibility fields around that ID. Change `main.dart`'s library `playbackResolver` to call this method.

- [ ] **Step 4: Add a failing optimistic-add test**

Use a `Completer` playback resolver in `test/library_service_test.dart`. Call `addSongToPlaylist` without awaiting it, pump a microtask, and assert the local playlist already contains the song while the resolver is incomplete.

- [ ] **Step 5: Add failing committed-shadow concurrency tests**

Use a recording library service with controlled save Completers. Cover:

```text
A optimistic, B optimistic
A save payload contains A but not pending B
A succeeds
B save payload contains committed A and B
B fails
local and committed final state contain A only
```

Also verify:

- a failed mutation reports its error to that caller, then a subsequent mutation still runs and succeeds;
- a failed add removes only its own song and preserves unrelated likes/playlists changed while it was pending;
- rollback follows the optimistic insertion's stable operation token when enrichment normalizes an ID such as `bilibili:BV:1` to `bilibili:BV:p1`;
- a later re-add of the same logical song is not removed by the earlier operation's rollback.
- removing the optimistic song while playback-ID resolution is pending prevents the late add from entering the remote mutation queue or reappearing in committed state.
- a failed non-add mutation, such as removing songs, rolls back only its own delta while a later queued mutation succeeds and remains visible locally and in committed state.

- [ ] **Step 6: Verify library tests are RED**

```powershell
flutter test .\test\library_service_test.dart --plain-name "addSongToPlaylist updates local state before playback metadata resolves"
flutter test .\test\library_service_test.dart --plain-name "remote library mutations exclude later pending optimistic changes"
flutter test .\test\library_service_test.dart --plain-name "failed playlist add rolls back only its own song"
flutter test .\test\library_service_test.dart --plain-name "library mutation queue continues after a failed save"
flutter test .\test\library_service_test.dart --plain-name "failed enriched add does not remove a later re-add"
flutter test .\test\library_service_test.dart --plain-name "removing an optimistic song cancels its pending remote add"
flutter test .\test\library_service_test.dart --plain-name "failed removal preserves a later successful mutation"
```

- [ ] **Step 7: Implement committed-library mutation queue**

Add a private immutable remote snapshot initialized from loaded/login library data and a Future tail. Every remote mutation receives the committed snapshot, produces one candidate snapshot, saves it, and promotes it only on success. Local optimistic state remains separate. Chain each caller-visible operation from the current tail, then assign the internal tail to a recovered Future that handles the prior error; this lets the originating caller receive its failure without poisoning later queued mutations.

Migrate `toggleLike`, `createPlaylist`, `collectPlaylist`, `addSongToPlaylist`, `removeSongsFromPlaylist`, and `deletePlaylist` to the queue. Preserve each method's existing public signature and UI semantics.

Give every optimistic mutation an operation token and track ownership at the smallest affected entity: liked song ID, playlist ID, or playlist-song identity. On save failure, apply only that mutation's inverse delta and only where its token is still the latest owner. Never restore a whole pre-mutation library or playlist snapshot. Concretely, undo only the affected like membership, remove only the playlist created/collected by that operation, restore only songs removed by that operation, or restore only the playlist deleted by that operation; if a later operation touched the same entity, leave the later local state intact. The committed remote snapshot is unchanged on failure, so the next queued candidate is always derived from the last successful remote state.

For `addSongToPlaylist` specifically:

1. allocate a unique operation token and insert the raw song locally immediately with that token tracked outside persisted song data;
2. await lightweight playback metadata;
3. if the token-owned local entry was removed while resolution was pending, return without replacing it or enqueueing an add mutation;
4. replace only the token-owned song locally with enriched data, preserving token ownership across ID normalization;
5. enqueue a committed mutation that adds the enriched song;
6. on failure remove only the song still owned by this operation token; never remove a later re-add of the same logical song.

- [ ] **Step 8: Add failing immediate-feedback widget tests**

In search and playlist-detail context menu tests, delay the resolver/save and assert `正在添加到歌单...` appears immediately. Complete the operation and assert `已添加到歌单`; fail it and assert `添加失败` plus local rollback.

- [ ] **Step 9: Implement menu feedback**

Show the pending SnackBar before awaiting the notifier. Hide/replace it with the existing success or failure SnackBar after completion. Keep mounted checks and duplicate-song disabling.

- [ ] **Step 10: Run Task 4 tests**

```powershell
flutter test .\test\library_service_test.dart .\test\hybrid_music_provider_test.dart .\test\widget_test.dart
```

Expected: all new Task 4 tests pass; pre-existing unrelated baseline failures are unchanged or corrected only where the changed contract requires it.

- [ ] **Step 11: Commit Task 4**

```powershell
git add lib/services/music_provider.dart lib/services/hybrid_music_provider.dart lib/services/music_service.dart lib/services/library_service.dart lib/main.dart lib/desktop/screens/desktop_search_screen.dart lib/desktop/screens/desktop_playlist_detail_screen.dart test/hybrid_music_provider_test.dart test/library_service_test.dart test/widget_test.dart
git commit -m "perf: make playlist additions optimistic"
```

## Task 5: Regression Verification and Visual Check

**Files:**
- Modify only files required to fix regressions introduced by Tasks 1-4.

- [ ] **Step 1: Format changed Dart files**

Run `dart format` with the explicit list of Dart files changed by Tasks 1-4. Do not format entire directories.

Review the diff and revert no unrelated user changes.

- [ ] **Step 2: Run targeted suites**

```powershell
flutter test .\test\playback_commands_test.dart .\test\bilibili_music_provider_test.dart .\test\hybrid_music_provider_test.dart .\test\library_service_test.dart .\test\widget_test.dart
```

Expected: all new tests pass. Compare any remaining failures with the documented baseline of three stale tests.

- [ ] **Step 3: Run the full suite**

```powershell
flutter test
```

Expected: no new failures beyond the pre-existing baseline. If touched behavior makes an old expectation obsolete, update that expectation only after proving the production behavior matches the approved spec.

- [ ] **Step 4: Run static analysis**

```powershell
dart analyze
```

Expected: no errors or warnings introduced; existing info-level lint debt may remain.

- [ ] **Step 5: Build and launch Windows app**

```powershell
flutter build windows
flutter run -d windows
```

Verify manually:

- clicking a new song stops the old one immediately;
- the indeterminate progress animation is visible during URL resolution/cache preparation;
- playlist rows appear before their count enrichment and update without moving;
- only three search tabs are present;
- right-click add shows immediate pending feedback and later success.

- [ ] **Step 6: Inspect final diff and commit verification fixes**

```powershell
git status --short
git diff --check
git diff HEAD~4 --stat
```

Commit only if Step 1-5 required additional corrections:

```powershell
git add <changed-files>
git commit -m "test: verify responsive playback workflows"
```
