# DeepVibe Desktop Stitch UI 设计提示词

将下面提示词复制给 Stitch 使用。

```text
Design a production-grade desktop music player interface for DeepVibe Desktop.

Product context:
DeepVibe is a Flutter music player. The mobile app already supports Bilibili-first music search and playback, metadata fallback, playlists, favorites, history, queue, lyrics, login, user library sync, playback modes, and local storage. The desktop version should preserve the same logic but use a desktop-first layout, not a stretched mobile UI.

Primary design direction:
Create a “Listening Studio” desktop workspace. It should feel like a serious, elegant music control room for daily listening and lightweight library management. The interface should be calm, precise, high-density, and useful for repeated use. It must not look like a marketing landing page.

Core layout:
Use a four-zone desktop layout:
1. Left persistent sidebar navigation.
2. Central workbench for home, search results, playlist detail, and library management.
3. Right persistent now-playing context rail for lyrics, queue, and current source metadata.
4. Bottom playback transport bar that is always visible and stable in height.

Canvas size:
Design primarily for 1440x900 desktop. Also consider a minimum width of 1024px. Do not create a mobile layout. Avoid huge hero sections.

Visual style:
- Dark refined workspace, not pure black.
- Use charcoal, ink, graphite, deep green-gray, subtle cyan accents, and occasional warm status accents.
- Avoid purple/blue gradient dominance, decorative orb backgrounds, bokeh blobs, oversized glow effects, beige/brown themes, and marketing-style hero composition.
- Use sharp, professional hierarchy with compact spacing.
- Cards must have 8px radius or less.
- Page sections should not be floating cards inside cards.
- Use real album artwork placeholders as cover images, not abstract SVG illustrations.
- Use icons for playback, search, queue, lyrics, favorite, download/cache, settings, more menu, shuffle, repeat, volume, and close/minimize.
- Text must never overflow buttons or panels. Use truncation and tooltips where appropriate.

Required screens / states:

Screen 1: Home workspace
- Left sidebar: DeepVibe logo, Home, Search, My Music, Settings.
- Top central area: compact greeting and search command bar.
- Main content: Continue Playing, Hot Playlists, Recent Plays.
- Hot Playlists should support infinite loading without jumping back to top; visually show a bottom loading row.
- Right rail: current track artwork, title, artist, source tags, lyrics preview, queue preview.
- Bottom bar: previous, play/pause, next, progress, duration, volume, playback mode, current source label.

Screen 2: Search workspace
- Prominent desktop search field with keyboard hint Ctrl+F.
- Result tabs: All, Songs, Playlists, Artists/Collections.
- Song results shown as a dense table with columns: title, artist/uploader, album/source, duration, playback source, actions.
- Playlist/collection results shown as compact cards or rows.
- Selecting a song should visually update queue and now-playing rail.
- Include empty, loading, and error states.

Screen 3: Playlist detail
- Header with cover, title, subtitle, source label, play all, shuffle play, collect/uncollect, batch manage.
- Song table below with multi-select checkboxes.
- Right-click/context actions: play now, play next, add to playlist, favorite, cache, remove.
- Keep bottom playback bar visible.

Screen 4: My Music / Library
- Tabs or segmented control: Favorites, My Playlists, History, Offline Cache.
- Favorites and history use song table.
- My Playlists use a compact grid/list hybrid with create playlist action.
- Offline Cache shows status chips: uncached, caching, cached, failed.

Screen 5: Focus player mode
- Larger artwork and lyric panel.
- Still keep essential playback controls.
- Show queue side panel or collapsible queue.
- This is a player focus mode, not the default first screen.

Interaction requirements:
- Play/pause must feel instant and must not imply reloading when resuming.
- Loading states should preserve existing content whenever possible.
- Use stable dimensions for player bar, queue rows, song rows, icon buttons, and cover tiles.
- Support keyboard-centric desktop workflows.
- Use right-click menus and hover actions sparingly but clearly.

Information hierarchy:
- The current song and playback controls are always visible.
- Search and queue should be reachable without losing the current playback context.
- Lyrics should be readable but not dominate the whole app unless in focus mode.
- Source labels are important: show metadata source and playback source separately when relevant, e.g. “Tencent Music metadata · Bilibili playback”.

Components to include:
- Sidebar navigation.
- Search command bar.
- Song table.
- Playlist cards.
- Playlist detail header.
- Queue panel.
- Lyrics panel with loading and empty states.
- Bottom playback bar.
- Volume slider.
- Playback mode segmented/icon control.
- Context menu.
- Mini player preview optional.

Tone:
Quiet, capable, modern, desktop-native, music-focused, polished. It should feel like an app someone can keep open all day while working.

Avoid:
- Landing page layout.
- Giant centered marketing hero.
- Excessive gradients.
- Decorative blobs/orbs.
- Card inside card nesting.
- Oversized mobile-style cards everywhere.
- Low-density dashboard clichés.
- Generic SaaS dashboard feel.

Deliverable:
Create high-fidelity desktop UI screens for the core app experience. Prioritize layout clarity, current playback persistence, search efficiency, queue visibility, and library management ergonomics.
```

## 设计师补充说明

推荐 Stitch 第一轮只生成 3 个画面：

1. Home workspace
2. Search workspace
3. Playlist detail

第一轮不要让 Stitch 同时生成所有页面，否则容易平均化、失焦。确认桌面端视觉语言后，再扩展 My Music、Settings、Focus Player 和 Mini Player。

