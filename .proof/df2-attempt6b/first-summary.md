## verify.sh: FAIL
commit `b758832` on cvmini, 2026-10-14 00:50:13 +08, worktree lane3-df2-fix-pr-39-ar-at-785d9dd-inli
targets: full
level: **failed**, ready (chats.list + 12 sidebar rows + waits): yes

| step | result | tests | time |
|---|---|---|---|
| test-integrity | PASS | - | 1s |
| affected-tests | PASS | - | 1s |
| go-vet | PASS | - | 2s |
| go-test | PASS | - | 57s |
| fixture-off | PASS | - | 2s |
| packages | PASS | 204 passed, 0 failed | 22s |
| macos-build | PASS | - | 22s |
| ios-test | FAIL | 1 passed, 1 failed | 440s |
| ios-ready | PASS | 2 passed, 0 failed | 44s |

media: ready-11B4DB95-6FE8-4BD4-8150-78BDF857EF18.png ready-187A898D-A7C8-4BDE-BEA8-68E2F63CF0E4.png ready-601573B5-7A83-4580-AD54-82860FC78733.png ready-8A6D05AD-662B-43BF-8DD0-17E7E9B4B677.png ready-97B0BED2-4578-4525-88FA-1DE1A5A3A020.png ready-E256AF31-8145-4395-AC7B-5A9F2B762043.png 

```
/Users/carlvincetan/code/wt/lane3-df2-fix-pr-39-ar-at-785d9dd-inli/apps/Polymux/PolymuxUITests/ReadinessTests.swift:55: error: -[PolymuxUITests.ReadinessTests testInlineActivity] : failed - readiness wait 'activity.rows.light' timed out
Test Case '-[PolymuxUITests.ReadinessTests testInlineActivity]' failed (40.001 seconds).
```
evidence: /Users/carlvincetan/verify-evidence/lane3-df2-fix-pr-39-ar-at-785d9dd-inli/20261014-005013-b758832
