## verify.sh: FAIL
commit `67036cb` on cvmini, 2026-10-14 19:16:48 +08, worktree lane3-fix-pr-39-after-liam-fix-at-669b
targets: full
level: **failed**, ready (chats.list + 12 sidebar rows + waits): yes

| step | result | tests | time |
|---|---|---|---|
| readiness-tests | PASS | - | 0s |
| test-integrity | PASS | - | 0s |
| affected-tests | PASS | - | 1s |
| go-vet | PASS | - | 1s |
| go-test | PASS | - | 59s |
| fixture-off | PASS | - | 2s |
| packages | FAIL | 225 passed, 2 failed | 22s |
| macos-build | PASS | - | 17s |
| macos-test | FAIL | 2 passed, 1 failed | 99s |
| ios-test | PASS | 3 passed, 0 failed | 102s |
| ios-ready | PASS | 3 passed, 0 failed | 40s |

media: ready-0D3B65E3-D766-434B-83D6-04920E10F694.png ready-1A6EF82D-4F84-4FE4-9472-57BD9E803471.png ready-3A5961EC-F969-460E-B5C3-7A303E7A67F2.png ready-3A7D1545-466B-4023-8770-2D6423B1A535.png ready-4B23EC5A-D528-4C02-BA26-B19A54604DBE.png ready-5CA7B53D-0212-4C1C-85C6-8974754DB246.png ready-7D0F5B3E-8852-4B3D-93A9-36AABB854341.png ready-8E3F084B-7E9C-48D8-AB80-2C6B5D95B75B.png ready-99FD31B8-36D0-4E61-BFF7-6EFE7E3BFC70.png ready-C93721C2-A640-4026-B615-BE03D621E3A0.png ready-EDC3E82E-67B8-4F1F-8DD3-19A901DB0202.png ready-F0253DC7-869F-4050-97A9-BC12ABF70FA1.png ready-F29A1AED-0CA4-44F8-8D1C-326F4B8A032C.png ready-F3214709-BDC8-44D3-BBCF-DDA128B7A40A.png ready-F4B7EF24-594E-438B-98D6-6614DA199B53.png 

```
/Users/carlvincetan/code/wt/lane3-fix-pr-39-after-liam-fix-at-669b/apps/Polymux/PolymuxUITests/ReadinessTests.swift:101: error: -[PolymuxUITests.ReadinessTests testInlineActivity] : failed - readiness wait 'activity.rows.light' timed out
Test Case '-[PolymuxUITests.ReadinessTests testInlineActivity]' failed (38.289 seconds).
```
evidence: /Users/carlvincetan/code/wt/lane3-fix-pr-39-after-liam-fix-at-669b/.build/lanehome/verify-evidence/lane3-fix-pr-39-after-liam-fix-at-669b/20261014-191648-67036cb
