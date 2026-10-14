The chat header uses a compact avatar/name capsule that opens the existing editor. This fix preserves native search styling and matches the iOS capsule to the native back button; macOS continues to compare against native search.

Closes #296

## Screenshots

Captured from `proof/att-mac` and `proof/att-ios` at `9d4a18c`. All 16 window captures were inspected; none contains a system dialog. The direct and group captures exercise empty conversations; Chief exercises a populated conversation. Profile captures show the header dimmed while its existing editor is open.

The fixture editor currently reports a missing profile response. That existing data-load error is separate from the header sizing change.

### macOS

| Header | Light | Dark |
|---|---|---|
| 1:1 | ![mac direct Light](https://github.com/CarlvinceTan/polymux/raw/refs/heads/agent/cl1-compact-header-capsule-attem/.proof/pr288-cl1/screenshots/mac-CL1-direct-Light.png) | ![mac direct Dark](https://github.com/CarlvinceTan/polymux/raw/refs/heads/agent/cl1-compact-header-capsule-attem/.proof/pr288-cl1/screenshots/mac-CL1-direct-Dark.png) |
| Group, five members | ![mac group-five Light](https://github.com/CarlvinceTan/polymux/raw/refs/heads/agent/cl1-compact-header-capsule-attem/.proof/pr288-cl1/screenshots/mac-CL1-group-five-Light.png) | ![mac group-five Dark](https://github.com/CarlvinceTan/polymux/raw/refs/heads/agent/cl1-compact-header-capsule-attem/.proof/pr288-cl1/screenshots/mac-CL1-group-five-Dark.png) |
| Chief | ![mac chief Light](https://github.com/CarlvinceTan/polymux/raw/refs/heads/agent/cl1-compact-header-capsule-attem/.proof/pr288-cl1/screenshots/mac-CL1-chief-Light.png) | ![mac chief Dark](https://github.com/CarlvinceTan/polymux/raw/refs/heads/agent/cl1-compact-header-capsule-attem/.proof/pr288-cl1/screenshots/mac-CL1-chief-Dark.png) |
| Profile editor | ![mac profile Light](https://github.com/CarlvinceTan/polymux/raw/refs/heads/agent/cl1-compact-header-capsule-attem/.proof/pr288-cl1/screenshots/mac-CL1-profile-Light.png) | ![mac profile Dark](https://github.com/CarlvinceTan/polymux/raw/refs/heads/agent/cl1-compact-header-capsule-attem/.proof/pr288-cl1/screenshots/mac-CL1-profile-Dark.png) |

### iOS

| Header | Light | Dark |
|---|---|---|
| 1:1 | ![ios direct Light](https://github.com/CarlvinceTan/polymux/raw/refs/heads/agent/cl1-compact-header-capsule-attem/.proof/pr288-cl1/screenshots/ios-CL1-direct-Light.png) | ![ios direct Dark](https://github.com/CarlvinceTan/polymux/raw/refs/heads/agent/cl1-compact-header-capsule-attem/.proof/pr288-cl1/screenshots/ios-CL1-direct-Dark.png) |
| Group, five members | ![ios group-five Light](https://github.com/CarlvinceTan/polymux/raw/refs/heads/agent/cl1-compact-header-capsule-attem/.proof/pr288-cl1/screenshots/ios-CL1-group-five-Light.png) | ![ios group-five Dark](https://github.com/CarlvinceTan/polymux/raw/refs/heads/agent/cl1-compact-header-capsule-attem/.proof/pr288-cl1/screenshots/ios-CL1-group-five-Dark.png) |
| Chief | ![ios chief Light](https://github.com/CarlvinceTan/polymux/raw/refs/heads/agent/cl1-compact-header-capsule-attem/.proof/pr288-cl1/screenshots/ios-CL1-chief-Light.png) | ![ios chief Dark](https://github.com/CarlvinceTan/polymux/raw/refs/heads/agent/cl1-compact-header-capsule-attem/.proof/pr288-cl1/screenshots/ios-CL1-chief-Dark.png) |
| Profile editor | ![ios profile Light](https://github.com/CarlvinceTan/polymux/raw/refs/heads/agent/cl1-compact-header-capsule-attem/.proof/pr288-cl1/screenshots/ios-CL1-profile-Light.png) | ![ios profile Dark](https://github.com/CarlvinceTan/polymux/raw/refs/heads/agent/cl1-compact-header-capsule-attem/.proof/pr288-cl1/screenshots/ios-CL1-profile-Dark.png) |

## Verification

Command: `VERIFY_TARGETS=affected bash /Users/carlvincetan/code/proj/Polymux/scripts/verify.sh`

## verify.sh: PASS
commit `9d4a18c` on cvmini, 2026-10-15 01:38:55 +08, worktree lane3-show-a-compact-header-capsule-in
targets: affected (go: none; swift: all; app: 1)
level: **macOS and iOS UI tests passed**, ready (chats.list + 12 sidebar rows + waits): yes

| step | result | tests | time |
|---|---|---|---|
| readiness-tests | PASS | - | 0s |
| test-integrity | PASS | - | 0s |
| affected-tests | PASS | - | 1s |
| go-vet | SKIP | not affected | 0s |
| go-test | SKIP | not affected | 0s |
| fixture-off | SKIP | not affected | 0s |
| packages | PASS | 211 passed, 0 failed | 8s |
| macos-build | PASS | - | 4s |
| macos-test | PASS | 6 passed, 0 failed | 66s |
| ios-test | PASS | 6 passed, 0 failed | 126s |
| ios-ready | PASS | 2 passed, 0 failed | 29s |

### Exit checks

```text
PASS Native search button has no custom frame, glass effect or button style
PASS Header overlay, headerRole and toolbar hit-region workaround removed
PASS iOS capsule uses a 30 pt content minimum with native glass padding
PASS macos testHeightMatchesToolbar green
PASS macos testGroupPlusN green
PASS macos testProfileOpens green
PASS macos testStallMissesBudget green
PASS ios testHeightMatchesToolbar green
PASS ios testGroupPlusN green
PASS ios testProfileOpens green
PASS ios testStallMissesBudget green
PASS testHeightMatchesToolbar deliberate failure twin red
PASS testGroupPlusN deliberate failure twin red
PASS testProfileOpens deliberate failure twin red
PASS testStallMissesBudget deliberate failure twin red
PASS 16 full-resolution CL1 captures present
PASS verify.sh exited successfully
PASS Visual inspection: all 16 captures have no system dialogs
Exit checks: 0
```

### xcodebuild tails

macos-build:

```text
PruneExplicitPrecompiledModules .build/DD/SDKExplicitPrecompiledModules

PruneExplicitPrecompiledModules .build/DD/Build/Intermediates.noindex/SwiftExplicitPrecompiledModules

PruneExplicitPrecompiledModules .build/DD/Build/Intermediates.noindex/ExplicitPrecompiledModules

** BUILD SUCCEEDED **

```

macos-test:

```text
2026-10-15 01:36:18.312 xcodebuild[45992:57956433] [MT] IDETestOperationsObserverDebug: 63.942 sec, +63.942 sec -- end

Test session results, code coverage, and logs:
	.build/results/mac.xcresult

** TEST SUCCEEDED **

Testing started
```

ios-test:

```text
2026-10-15 01:38:26.569 xcodebuild[48028:57965408] [MT] IDETestOperationsObserverDebug: 119.779 sec, +119.779 sec -- end

Test session results, code coverage, and logs:
	.build/results/ios.xcresult

** TEST SUCCEEDED **

Testing started
```

### Paired deliberate red and restored green tests

The temporary mutations reduced the iOS capsule content height, limited avatars to two, delayed normal profile feedback by 100 ms, and removed the explicit stall delay. Production code was restored before the final green run. Tests were never skipped or weakened. Height's red twin is on iOS, where this round changes sizing; the three other twins also failed on macOS.

The red run exited 1. Its iOS suite completed with all four expected assertion failures, but xcodebuild hung afterward and was terminated; readiness subsequently passed. The restored green run exited 0 without interruption.

testHeightMatchesToolbar:

```text
RED ios:
apps/Polymux/PolymuxUITests/HeaderCapsuleUITests.swift:25: error: -[PolymuxUITests.HeaderCapsuleUITests testHeightMatchesToolbar] : XCTAssertEqualWithAccuracy failed: ("38.0") is not equal to ("44.0") +/- ("1.0")
GREEN ios:
Test Case '-[PolymuxUITests.HeaderCapsuleUITests testHeightMatchesToolbar]' passed (20.856 seconds).
```

testGroupPlusN:

```text
RED ios:
apps/Polymux/PolymuxUITests/HeaderCapsuleUITests.swift:34: error: -[PolymuxUITests.HeaderCapsuleUITests testGroupPlusN] : XCTAssertEqual failed: ("Optional("2 avatars")") is not equal to ("Optional("3 avatars")")
GREEN ios:
Test Case '-[PolymuxUITests.HeaderCapsuleUITests testGroupPlusN]' passed (19.606 seconds).
RED macos:
apps/Polymux/PolymuxUITests/HeaderCapsuleUITests.swift:34: error: -[PolymuxUITests.HeaderCapsuleUITests testGroupPlusN] : XCTAssertEqual failed: ("Optional("2 avatars")") is not equal to ("Optional("3 avatars")")
GREEN macos:
Test Case '-[PolymuxUITests.HeaderCapsuleUITests testGroupPlusN]' passed (8.867 seconds).
```

testProfileOpens:

```text
RED ios:
apps/Polymux/PolymuxUITests/HeaderCapsuleUITests.swift:47: error: -[PolymuxUITests.HeaderCapsuleUITests testProfileOpens] : XCTAssertEqual failed: ("Optional("miss")") is not equal to ("Optional("met")")
GREEN ios:
Test Case '-[PolymuxUITests.HeaderCapsuleUITests testProfileOpens]' passed (23.376 seconds).
RED macos:
apps/Polymux/PolymuxUITests/HeaderCapsuleUITests.swift:47: error: -[PolymuxUITests.HeaderCapsuleUITests testProfileOpens] : XCTAssertEqual failed: ("Optional("miss")") is not equal to ("Optional("met")")
GREEN macos:
Test Case '-[PolymuxUITests.HeaderCapsuleUITests testProfileOpens]' passed (15.997 seconds).
```

testStallMissesBudget:

```text
RED ios:
apps/Polymux/PolymuxUITests/HeaderCapsuleUITests.swift:58: error: -[PolymuxUITests.HeaderCapsuleUITests testStallMissesBudget] : XCTAssertEqual failed: ("Optional("met")") is not equal to ("Optional("miss")")
GREEN ios:
Test Case '-[PolymuxUITests.HeaderCapsuleUITests testStallMissesBudget]' passed (12.052 seconds).
RED macos:
apps/Polymux/PolymuxUITests/HeaderCapsuleUITests.swift:58: error: -[PolymuxUITests.HeaderCapsuleUITests testStallMissesBudget] : XCTAssertEqual failed: ("Optional("met")") is not equal to ("Optional("miss")")
GREEN macos:
Test Case '-[PolymuxUITests.HeaderCapsuleUITests testStallMissesBudget]' passed (7.568 seconds).
```

Release Notes:

- Chat: Improved the chat header with a compact capsule showing the agent's avatar and name.
