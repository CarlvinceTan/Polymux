# Third-party notices

## scrcpy and Android Debug Bridge

Polymux bundles the pinned official [scrcpy](https://github.com/Genymobile/scrcpy)
runtime for Android display and control. Its release archive also supplies the
matching Android Debug Bridge executable. The bundled runtime includes its
Apache License 2.0 as `LICENSE.scrcpy.txt`.

Copyright (C) 2018 Genymobile

Copyright (C) 2018-2026 Romain Vimont

## go-ios

Polymux bundles the pinned [go-ios](https://github.com/danielpaulus/go-ios)
command-line runtime for iPhone discovery, userspace tunnels, app installation,
XCUITest launch, port forwarding, and local WebDriverAgent signing. Its MIT
License is included as `LICENSE.go-ios.txt`.

Copyright (c) 2019 danielpaulus

## Appium WebDriverAgent

Polymux bundles an unsigned build of
[Appium WebDriverAgent](https://github.com/appium/WebDriverAgent). Release
infrastructure compiles it from the pinned npm source package; an end user’s
local signing profile is added only during iPhone setup. Its Apache License
2.0 is included as `LICENSE.WebDriverAgent.txt`.

## pymobiledevice3 iPhone tunnel companion

Polymux bundles [pymobiledevice3](https://github.com/doronz88/pymobiledevice3)
and its pinned Python dependencies as a separate companion process for
normal-user iPhone developer tunnels and XCTest launch. On macOS it rides
Apple's existing `remoted` tunnel; on Windows and Linux it provides an
in-process userspace network stack and a loopback-only WDA relay.

pymobiledevice3 is licensed under GPL-3.0-or-later. Its license and the exact,
hash-verified source distributions for every bundled GPL/LGPL dependency are
included as `LICENSE.pymobiledevice3.txt`, `SOURCE_ARCHIVES.json`, and the
archives under `sources/`. Packages with conflicting license metadata are
included conservatively. Dependency license metadata remains in the companion's
`site-packages` directory. The companion also carries a dedicated Python 3.13
distribution so its wireless TCP-PSK tunnel uses Python's supported PSK
callback API; the Python license is included as
`LICENSE.python-standalone.txt`. Polymux's companion helper source is shipped
as `helper.py` and is distributed under GPL-3.0-or-later as
`LICENSE.phone-ios-device-helper.txt`.

This source-and-license packaging is an engineering safeguard, not a legal
opinion. Before a public release, counsel should confirm that the companion's
process and HTTP/JSON boundary remains a separate aggregate from the
Apache-2.0 Polymux desktop application.

## Local iPhone signing runtime

Polymux's optional local iPhone setup bundles a pinned, minimal subset of
[iPASide](https://github.com/pwnapplehat/iPASide) for Apple Account
authentication and developer provisioning, [zsign](https://github.com/zhlynn/zsign)
for recursive iOS code signing, and a relocatable
[python-build-standalone](https://github.com/astral-sh/python-build-standalone)
runtime. Their licenses are included beside the runtime as
`LICENSE.iPASide.txt`, `LICENSE.zsign.txt`, and
`LICENSE.python-standalone.txt`. Python package license metadata remains in the
bundled `site-packages` directory.

On macOS, Apple sign-in headers come from the operating system's AOSKit and
AuthKit frameworks. On Windows and Linux, the portable anisette implementation
needs [Unicorn](https://github.com/unicorn-engine/unicorn). Its Python package
is BSD licensed and its emulator core is GPL-2.0. Polymux does not redistribute
that package: on first Apple setup, the separate signer helper downloads the
exact platform wheel directly from PyPI, verifies its pinned SHA-256 digest,
and keeps it in the private local signer directory.
