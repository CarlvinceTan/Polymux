# Third-party notices

## Bloub

Polymux's Team-avatar geometry, customization catalogues, spherical-eye model,
deterministic liveliness, and eye-fit data are adapted from
[Bloub](https://github.com/jeremy-prt/bloub) revision
`b4bb3c1b5f93c7b87a2e8d620f667c4093d97749`.

Copyright (c) 2026 Jérémy Perret

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Bloub states that it is not affiliated with, endorsed by, or connected to
x.ai, and that its MIT licence covers its code rather than the visual design
it recreates. Polymux likewise uses the implementation as an independent Team
avatar customizer and does not claim affiliation with x.ai.

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
`LICENSE.mobile-ios-device-helper.txt`.

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

## jsQR

Device QR scanning uses [jsQR](https://github.com/cozmo/jsQR), licensed under Apache-2.0. The Apache-2.0 license is included in this
repository's LICENSE file. jsQR decodes camera frames and selected images locally.

## grok-mermaid

The Polymux CLI uses grok-mermaid 0.2.2 for Unicode terminal diagrams.
Copyright 2023-2026 SpaceXAI and Copyright 2026 Alexey Zaytsev.
Licensed under Apache License 2.0; the CLI distribution includes the full text
as `LICENSE.grok-mermaid.txt`.

## IDE language registries

The IDE uses [CodeMirror language-data](https://code.haverbeke.berlin/codemirror/language-data),
[linguist-languages](https://github.com/ikatyang-collab/linguist-languages) with
[GitHub Linguist](https://github.com/github-linguist/linguist) metadata, and
[binary-extensions](https://github.com/sindresorhus/binary-extensions).
These projects are licensed under the MIT License.

Copyright (C) 2018-2021 Marijn Haverbeke and others (CodeMirror).
Copyright (c) Ika (linguist-languages).
Copyright (c) 2017 GitHub, Inc. (Linguist).
Copyright (c) Sindre Sorhus and Paul Miller (binary-extensions).

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
