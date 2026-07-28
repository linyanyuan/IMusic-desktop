# 鎼滅储銆佹挱鏀句笌姝屽崟鍝嶅簲浼樺寲 鈥?Code Review

| 椤?| 鍐呭 |
| --- | --- |
| 鍒濆鏃ユ湡 | 2026-07-27 |
| 澶嶅鏃ユ湡 | 2026-07-27锛坈ommit `cb8c63a` 涔嬪悗锛?|
| 鍒嗘敮 | `codex/search-playback-responsiveness` |
| 瀵规瘮鍩虹嚎 | merge-base `08ea3db`锛堢浉瀵?`origin/main`锛?|
| 澶嶅 HEAD | `cb8c63a` 鈥?`fix: close playback and library concurrency races` |
| 鍏宠仈鏂囨。 | [鍙樻洿璇存槑](./2026-07-27-search-playback-responsiveness-changes.md)銆乕璁捐璇存槑](./superpowers/specs/2026-07-27-search-playback-responsiveness-design.md)銆乕骞跺彂淇璁″垝](./superpowers/plans/2026-07-27-code-review-concurrency-fixes.md) |

---

## 澶嶅缁撹锛堝綋鍓嶏級

**涓婃鍒楀嚭鐨?4 涓?P0 Bug 鍧囧凡鍦?`cb8c63a` 涓鐥囦慨澶嶏紝浠ｇ爜璺緞涓庢柊澧炴祴璇曟剰鍥句竴鑷淬€?*  
鍦ㄩ潤鎬佸鏌ワ紙璇诲疄鐜?+ 璇诲洖褰掓祴璇?+ `dart analyze`锛変笅锛?*鏈彂鐜版柊鐨勯樆濉炵骇 bug**锛涘墿浣欎负杈圭晫 UX / 韬唤 key 涓€鑷存€х被 P1鈥揚2銆?
| 涓ラ噸搴?| 鍒濆 | 澶嶅锛堝綋鍓嶏級 | 璇存槑 |
| --- | --- | --- | --- |
| Bug锛圥0锛?| 4 | **0** | 鍥涢」鍧囧凡鍏抽棴 |
| Suggestion锛圥1锛?| 3 | **2** | 瑙?搂4 |
| Nit锛圥2锛?| 2 | **2** | 瑙?搂4 |

**鍚堝苟寤鸿锛?* 浠庡苟鍙戞纭€х湅鍙互鍚堝叆銆? 
**楠岃瘉缂哄彛锛?* 鏈幆澧?`flutter test` 鍦ㄥ姞杞界敤渚嬫椂鍥?`HttpException: Connection closed before full header was received` 鏃犳硶鎷夎捣 VM锛堜笌涓氬姟鏂█鏃犲叧锛夈€俙dart analyze` 瀵规敼鍔ㄦ枃浠朵粎鏈夋棦鏈?info锛坧rint / withOpacity锛夛紝鏃?error/warning銆傚缓璁湪鏈湴鍐嶈窇锛?
```bash
flutter test test/library_service_test.dart test/playback_commands_test.dart test/widget_test.dart
dart analyze
```

---

## 1. 鍒濆 P0 闂幆鏍稿

### BUG-1 璐﹀彿鍒囨崲闈欓粯涓㈠啓 鈫?**宸蹭慨澶?*

| 椤?| 鍐呭 |
| --- | --- |
| 瀹炵幇 | `_enqueueRemoteMutation` 鍦?generation 涓嶅尮閰嶆椂 `throw LibraryMutationCancelled`锛沗_startLibraryGeneration()` 閲嶇疆 `_mutationTail`銆乷wners銆乴ike tails |
| 璋冪敤鏂?| 鍔犳瓕 UI 鍗曠嫭 `on LibraryMutationCancelled` 鏀惰捣銆屾鍦ㄦ坊鍔犮€峉nackBar锛屼笉鍐嶆樉绀烘垚鍔?|
| 娴嬭瘯 | 鏃ц处鍙?mutation / 鎺掗槦 like 鍦?`setLibraryFromLogin` 鍚庡彉涓?cancelled锛涙柊璐﹀彿 mutation 涓嶅牭鍦ㄦ棫闃熷垪鍚?|

### BUG-2 涔愯鍔犳瓕鍙栨秷浠嶆彁绀烘垚鍔?鈫?**宸蹭慨澶?*

| 椤?| 鍐呭 |
| --- | --- |
| 瀹炵幇 | `!stillPresent` 鏃?`throw LibraryMutationCancelled('Song add was cancelled')` |
| UI | `desktop_search_screen` / `desktop_playlist_detail_screen` 鎴愬姛鏂囨浠呭湪 await 姝ｅ父杩斿洖鍚庢樉绀?|
| 娴嬭瘯 | `removing an optimistic song reports its pending add as cancelled` |

### BUG-3 鍙屽嚮 like 鏈湴/杩滅鍒嗗弶 鈫?**宸蹭慨澶嶏紙涓昏矾寰勶級**

| 椤?| 鍐呭 |
| --- | --- |
| 瀹炵幇 | 鎸?`like:<identity>` 缁存姢 `_likeMutationTails` 涓茶锛涚浜屾鎺掗槦鍚庝細鍩轰簬鏈€鏂?`isLiked` 鍐嶆墽琛岋紙鍏?like 鍐?unlike锛?|
| 娴嬭瘯 | 骞跺彂涓ゆ like锛氱浜屾杩滅澶辫触鏃舵湰鍦颁粛淇濈暀绗竴娆℃垚鍔熺殑 like |
| 绌?identity | `songIdentityValues` 涓虹┖鏃?`ArgumentError`锛屼笉鍐?`.first` 宕╂簝 |

### BUG-4 杩囨湡 `setSource` 瑕嗙洊闊虫簮 鈫?**宸蹭慨澶?*

| 椤?| 鍐呭 |
| --- | --- |
| 瀹炵幇 | `Expando` 涓婃寕 `_playbackSourceMutationTails` 涓茶 setSource/resume锛涘叆閾惧墠妫€ serial锛況esume 鍚庤繃鏈熷垯 `stop()`锛涢摼 tail 鍚為敊璇伩鍏嶆瘨鍖栧悗缁?|
| 璁捐鍙栬垗 | 棣栨 `player.stop()` 浠嶅湪閾惧锛岀偣鍑荤珛鍗冲仠鏃ф瓕 |
| 娴嬭瘯 | `late stale setSource cannot replace the newest audio source`锛涘け璐?setSource 涓嶉樆濉炰笅涓€棣?|

### 鍒濆 P1 璺熻繘

| 椤?| 鐘舵€?|
| --- | --- |
| SUG-1 姝ｅ湪鎾斁楂樹寒鐢?`songsShareIdentity` | **宸蹭慨**锛坰earch / playlist detail / right rail锛?|
| SUG-3 璐﹀彿鍒囨崲閲嶇疆 mutation tail | **宸蹭慨**锛坄_startLibraryGeneration`锛?|
| SUG-2 鍏ㄥ簱缁熶竴 B 绔?canonicalizer | **閮ㄥ垎**锛歚song_identity` 宸叉妸缂?page 瑙勮寖涓?`:p1`锛沴ibrary/hybrid/music_service 浠嶅悇鏈変竴浠?`_canonicalBilibiliPlaybackId`锛岄潪鏁板瓧 page 琛屼负浠嶅彲鑳界暐涓嶄竴鑷?|

---

## 2. 澶嶅浠嶅缓璁叧娉ㄧ殑鐐癸紙闈為樆濉烇級

### P1-A锛歭ike 涓茶 key 鍙?`identities.first`锛岃法褰㈡€佸悓鏇插彲鑳戒笉涓茶

- **浣嶇疆**锛歚library_service.dart` 鈥?`toggleLike` 鈫?`entityKey = 'like:${identities.first}'`
- **璇存槑**锛歚songIdentityValues` 鎸?`id 鈫?playbackId 鈫?鈥 鎻掑叆銆? 
  - `{id: meta:1, playbackId: bilibili:BVxxx}` 鈫?first = `meta:1`  
  - `{id: bilibili:BVxxx:p1}` 鈫?first = `bilibili:BVxxx:p1`  
  浜岃€?`songsShareIdentity` 涓?true锛屼絾 **like 闃熷垪 key 涓嶅悓**锛屼粛鍙兘骞惰銆?- **褰卞搷**锛氬悓涓€閫昏緫姝屼粠涓嶅悓鍏ュ彛鏋侀€熻繛鐐规椂锛岀悊璁轰笂浠嶅彲鑳戒氦閿欙紱鍚?UI 琛屽弻鍑伙紙鍚屼竴 map锛夊凡涓茶锛屼富璺緞 OK銆?- **寤鸿锛堝彲閫夛級**锛歟ntityKey 鐢ㄦ帓搴忓悗鐨?identity 闆嗗悎锛屾垨浼樺厛 bilibili canonical id锛沜laim 鏃跺鎵€鏈?identity 鍒悕鍔犻攣銆?
### P1-B锛氬凡鍦ㄦ瓕鍗曟椂 `!inserted` 闈欓粯鎴愬姛锛孶I 浠嶆彁绀恒€屽凡娣诲姞鍒版瓕鍗曘€?
- **浣嶇疆**锛歚addSongToPlaylist` 鍦?`!inserted` 鏃?`return`锛涙悳绱?璇︽儏 UI 鍙涓?throw 灏?toast 鎴愬姛銆?- **褰卞搷**锛氶噸澶嶆坊鍔犱細鏄剧ず鎴愬姛锛堣涔夊亸銆屽凡鍦ㄦ瓕鍗曘€嶄篃鍙帴鍙楋級锛屼笌璁″垝涓殑 `unchanged` 鏋氫妇鏈畬鍏ㄨ惤鍦般€?- **寤鸿锛堝彲閫夛級**锛氳繑鍥?`added | unchanged | cancelled`锛宍unchanged` 涓嶅脊鎴愬姛鎴栨敼涓恒€屽凡鍦ㄦ瓕鍗曚腑銆嶃€?
### P2-A锛氶儴鍒?like UI 鏈尯鍒嗗彇娑堜笌澶辫触

- **浣嶇疆**锛歴earch / playlist detail 鐨?`toggleLike` 灏嗕换鎰忓紓甯革紙鍚?`LibraryMutationCancelled`锛夋樉绀轰负銆屾搷浣滃け璐ャ€嶏紱`desktop_app_shell` / lyrics window 鐢氳嚦鏈?catch銆?- **褰卞搷**锛氳处鍙峰垏鎹㈡椂鍙兘 toast銆屾搷浣滃け璐ャ€嶆垨鏈鐞?Future 閿欒锛涘姛鑳芥纭€т笉鍙楀奖鍝嶃€?- **寤鸿**锛氬彇娑堥潤榛橈紱澶辫触鍐嶆彁绀恒€?
### P2-B锛歚setSource` 瀹屾垚鍚庛€乣resume` 鍓嶈嫢 serial 杩囨湡鍙?return锛屼笉 stop

- **浣嶇疆**锛歚playback_actions.dart` source 閾惧唴 `setSource` 鍚?`if (serial stale) return false`锛堟棤 stop锛夈€?- **褰卞搷**锛氶€氬父涓嬩竴鏉￠摼涓婄殑鏂拌姹備細 `setSource`锛涜嫢鏂拌姹傚湪鍏ラ摼鍓嶅け璐ワ紝鎾斁鍣ㄥ彲鑳界煭鏆傚仠鍦ㄦ棫 source 涓斿凡 stop銆傚彲鎺ュ彈杈硅銆?- **寤鸿**锛氫笌 resume 杩囨湡璺緞涓€鑷达紝杩囨湡鏃?`stop()` 鏇村绉般€?
### P2-C锛氬弻鍑诲枩娆?= like 鍚?unlike锛堜覆琛屽壇浣滅敤锛?
- **璇存槑**锛氫覆琛屼慨澶嶅悗锛屽揩閫熺偣涓ゆ蹇冨舰浼氬彉鎴愩€屽枩娆?鈫?鍙栨秷鍠滄銆嶃€傝繖鏄?toggle 璇箟锛屼笉鏄姸鎬佸垎鍙?bug銆?- **寤鸿**锛氳繘琛屼腑绂佺敤鎸夐挳鎴?debounce锛岄伩鍏嶈鍙栨秷銆?
---

## 3. 鍒濆鏃剁殑浼樼偣锛堜粛鎴愮珛锛?
1. 鎾斁璇锋眰搴忓彿 + 绔嬪嵆 loading銆?2. 姝岃瘝/瀛楀箷绂诲紑鍏抽敭璺緞銆?3. 鎼滅储 request-id + 姝屽崟娓愯繘琛ュ叏銆?4. 鏇插簱 mutation 闃熷垪 + committed 褰卞瓙 + 閫夋嫨鎬у洖婊氥€?5. 涔愯鍔犳瓕鍙В鏋愮ǔ瀹?playbackId銆?6. 骞跺彂鐩稿叧娴嬭瘯鏄庢樉鍔犲己锛堣处鍙峰垏鎹?cancelled銆乻etSource 绔炴€併€佸苟鍙?like 澶辫触鍥炴粴锛夈€?
---

## 4. 鍒濆闂娓呭崟鐘舵€侊紙褰掓。锛?
| ID | 鍒濆涓ラ噸搴?| 澶嶅鐘舵€?|
| --- | --- | --- |
| BUG-1 鍒囪处鍙烽潤榛樹涪鍐?| P0 | **Closed** 鈥?鎶?`LibraryMutationCancelled` + 閲嶇疆 tail |
| BUG-2 鍔犳瓕鍋囨垚鍔?| P0 | **Closed** 鈥?鍙栨秷鎶涢敊 + UI 鍒嗘敮 |
| BUG-3 鍙屽嚮 like 鍒嗗弶 | P0 | **Closed** 鈥?per-key like 涓茶锛堣 P1-A 娈嬩綑锛?|
| BUG-4 setSource 绔炴€?| P0 | **Closed** 鈥?source mutation 閾?|
| SUG-1 isCurrent 韬唤 | P1 | **Closed** |
| SUG-2 canonical 缁熶竴 | P1 | **Open / 閮ㄥ垎** 鈥?缂?page鈫抪1 宸插榻愶紱澶氫唤瀹炵幇浠嶅湪 |
| SUG-3 閲嶇疆 mutation tail | P1 | **Closed** |
| NIT-1 绌?identity | P2 | **Closed** |
| NIT-2 duration cast | P2 | **鏈湪鏈?commit 澶勭悊**锛堝彲閫夛級 |

---

## 5. 淇 commit 瑙﹀強鏂囦欢

`cb8c63a fix: close playback and library concurrency races`

- `lib/playback/playback_actions.dart`
- `lib/services/library_service.dart`
- `lib/desktop/screens/desktop_search_screen.dart`
- `lib/desktop/screens/desktop_playlist_detail_screen.dart`
- `lib/desktop/widgets/desktop_right_rail.dart`
- `test/library_service_test.dart`
- `test/playback_commands_test.dart`
- `test/widget_test.dart`
- `docs/superpowers/plans/2026-07-27-code-review-concurrency-fixes.md`

---

## 6. 鎬荤粨

| 杞 | 缁撹 |
| --- | --- |
| 鍒濆 | 鍝嶅簲浼樺寲鏂瑰悜瀵癸紝浣?4 涓苟鍙?闈欓粯鎴愬姛 P0 寤鸿淇悗鍐嶅悎 |
| **澶嶅** | **P0 宸插叧闂紱瀹炵幇绠€娲併€佷笌璁″垝瀵归綈锛涙棤鏂扮殑闃诲绾ч棶棰?* |

鍓╀綑 P1/P2 涓嶉樆濉炲悎骞躲€傛湰鍦拌ˉ璺戠浉鍏?`flutter test` 閫氳繃鍚庡嵆鍙悎鍏ャ€?
