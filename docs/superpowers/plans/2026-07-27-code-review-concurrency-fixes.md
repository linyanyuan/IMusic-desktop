# Code Review Concurrency Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the confirmed playback and library concurrency bugs without broadening the original responsiveness feature.

**Architecture:** Serialize only audio source mutations while keeping the immediate stop path responsive. Give library mutations explicit cancellation/results, isolate mutation queues per account generation, and prevent concurrent like operations for the same canonical song identity. Reuse the existing song identity helper for current-song presentation.

**Tech Stack:** Flutter, Dart, Riverpod, audioplayers, flutter_test

---

### Task 1: Serialize Playback Source Mutations

**Files:**
- Modify: `test/playback_commands_test.dart`
- Modify: `lib/playback/playback_actions.dart`

- [ ] Add fake audio platform tests that block the first `setSource` or `resume`, start a second request, and verify the newest source is final and stale playback is stopped.
- [ ] Add a failure-then-success test proving one failed `setSource` does not poison later source mutations.
- [ ] Run the focused test and confirm it fails because the old source can complete last.
- [ ] Add a small source-mutation Future chain; each queued mutation checks the playback serial before setting the source and resuming, and a stale post-resume request stops before releasing the chain.
- [ ] Keep the caller's operation Future fallible while assigning a recovered Future to the internal queue tail so one error cannot poison later requests.
- [ ] Keep the initial `player.stop()` outside the source chain so clicks still stop current playback immediately.
- [ ] Run `flutter test test/playback_commands_test.dart` and confirm it passes.

### Task 2: Make Library Cancellation Observable

**Files:**
- Modify: `test/library_service_test.dart`
- Modify: `lib/services/library_service.dart`
- Modify: `lib/desktop/screens/desktop_search_screen.dart`
- Modify: `lib/desktop/screens/desktop_playlist_detail_screen.dart`

- [ ] Add tests proving a queued old-account mutation completes as cancelled and a new-account mutation does not wait for the old queue.
- [ ] Add a test proving an add removed during metadata resolution returns cancelled.
- [ ] Run the focused tests and confirm the current void-return behavior fails them.
- [ ] Introduce a typed `LibraryMutationCancelled` exception for account-generation changes and an `AddSongToPlaylistResult` enum for `added`, `unchanged`, and locally `cancelled` outcomes.
- [ ] Replace generation mismatch normal returns with the typed cancellation error; create a new recovered mutation tail when applying or clearing an account library.
- [ ] Keep all existing create/collect/delete/remove callers on their failure path when account cancellation is thrown, and add focused UI coverage for at least one of those operations.
- [ ] Return the add result to both add-to-playlist UIs and show success only for `added`; suppress success for `cancelled` and `unchanged`.
- [ ] Run `flutter test test/library_service_test.dart` and the relevant widget tests.

### Task 3: Prevent Concurrent Like Divergence

**Files:**
- Modify: `test/library_service_test.dart`
- Modify: `lib/services/library_service.dart`

- [ ] Add a controlled-resolver test that starts two likes for the same song and forces one remote save to fail.
- [ ] Confirm the test currently leaves local and committed behavior inconsistent.
- [ ] Reject or cancel a second pending operation for the same canonical like entity inside `LibraryNotifier`.
- [ ] Validate non-empty song identity before claiming the entity and return a clear argument error for malformed songs.
- [ ] Run focused library tests and confirm local state matches the successful committed save.

### Task 4: Unify Current-Song Highlighting

**Files:**
- Modify: `test/widget_test.dart`
- Modify: `lib/desktop/screens/desktop_search_screen.dart`
- Modify: `lib/desktop/screens/desktop_playlist_detail_screen.dart`
- Modify: `lib/desktop/widgets/desktop_right_rail.dart`

- [ ] Add widget coverage where the current song uses `bilibili:BVxxx:p1` and a row/queue entry uses `bilibili:BVxxx`.
- [ ] Confirm current equality checks fail to highlight the equivalent song.
- [ ] Replace presentation-only ID equality with `songsShareIdentity`.
- [ ] Run the focused widget tests.

### Task 5: Verification

**Files:**
- Verify all changed production and test files.

- [ ] Run `dart format` on changed Dart files.
- [ ] Run focused playback, library, and widget tests.
- [ ] Run `flutter test` and compare any failures with the known baseline.
- [ ] Run `dart analyze` and confirm there are no errors or warnings.
- [ ] Run `flutter build windows`.
- [ ] Run `git diff --check`, inspect the final diff, and preserve the user-provided untracked review document.
