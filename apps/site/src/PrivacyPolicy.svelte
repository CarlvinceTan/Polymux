<script lang="ts">
  import logo from '../../desktop/src/renderer/public/polymux.svg';
</script>

<svelte:head>
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
</svelte:head>

<header>
  <a class="brand" href="/" aria-label="Polymux home">
    <img src={logo} alt="" />
    <span>Polymux</span>
  </a>
  <a class="home-link" href="/">Back to home</a>
</header>

<main>
  <div class="title-block">
    <p class="eyebrow">Legal</p>
    <h1>Privacy Policy</h1>
    <p class="effective">Effective 24 August 2026</p>
  </div>

  <article>
    <section>
      <h2>Overview</h2>
      <p>
        Polymux is a desktop workspace that can connect to your browser, files,
        messages, email, and AI providers when you ask it to. This policy
        explains how the Polymux desktop app and browser extension handle
        information.
      </p>
    </section>

    <section>
      <h2>Information Polymux handles</h2>
      <h3>Browser tab information</h3>
      <p>
        The browser extension makes a local inventory of open-tab metadata,
        including tab titles, URLs, window identifiers, active or pinned state,
        audible state, and last-accessed time. This inventory does not include
        page contents.
      </p>

      <h3>Assigned-tab content and activity</h3>
      <p>
        When you ask Polymux to work in a specific browser tab, it may read page
        content and perform or observe interactions needed for that task. This
        can include accessibility information, screenshots, navigation, clicks,
        typing, scrolling, console or network information, dialogs, and task
        results. Polymux limits this access to the tab assigned to the task.
      </p>

      <h3>Connected services</h3>
      <p>
        If you connect a service or AI provider through the desktop app,
        Polymux handles the information required to complete the actions you
        request. The connected provider's own privacy policy also applies to
        information sent to that provider.
      </p>
    </section>

    <section>
      <h2>How information is used</h2>
      <p>Polymux uses information only to:</p>
      <ul>
        <li>identify the app, window, file, conversation, or browser tab you mean;</li>
        <li>complete tasks you request and return their results;</li>
        <li>maintain secure local connections between the extension and desktop app; and</li>
        <li>diagnose errors and protect the reliability and security of the product.</li>
      </ul>
    </section>

    <section>
      <h2>Local browser-extension communication</h2>
      <p>
        The extension communicates with the locally installed Polymux desktop
        app through a native-messaging host and a loopback-only service on your
        computer. Open-tab metadata, assigned-tab commands, cursor status, and
        task results stay on your device through these channels. The extension
        does not send browsing data to a hosted Polymux service.
      </p>
    </section>

    <section>
      <h2>Browser permissions</h2>
      <p>The extension uses browser permissions to:</p>
      <ul>
        <li>list tabs and identify the exact tab assigned to Polymux;</li>
        <li>communicate with the locally installed desktop app;</li>
        <li>refresh its local connection after the browser suspends it;</li>
        <li>read and interact with an assigned tab through browser debugging tools; and</li>
        <li>display the Polymux badge and cursor on ordinary HTTP and HTTPS pages.</li>
      </ul>
    </section>

    <section>
      <h2>Sharing and sale of data</h2>
      <p>
        Polymux does not sell user data. It does not use or transfer user data
        for advertising, creditworthiness, lending, or purposes unrelated to
        the product's disclosed function. Information is shared with a service
        provider only when needed to use a connection you configured or to
        complete an action you requested.
      </p>
    </section>

    <section>
      <h2>Storage, retention, and control</h2>
      <p>
        Browser-tab inventory and connection state are stored locally for the
        desktop app to use. Access to an assigned tab ends when the task
        releases it, the tab closes, the desktop app disconnects, or you disable
        the extension. You can also remove locally stored Polymux data by
        uninstalling the extension or desktop app and deleting its application
        data.
      </p>
    </section>

    <section>
      <h2>Security</h2>
      <p>
        Polymux limits browser control to an identified assigned tab and uses
        local-only communication for the extension-to-desktop connection. No
        system can guarantee absolute security, but Polymux is designed to
        minimise access and keep you in control of connected services.
      </p>
    </section>

    <section>
      <h2>Changes to this policy</h2>
      <p>
        This policy may change as Polymux develops. The effective date above
        will be updated when material changes are published.
      </p>
    </section>

    <section>
      <h2>Contact</h2>
      <p>
        For privacy questions, email
        <a href="mailto:carlvince@polymux.com">carlvince@polymux.com</a>.
      </p>
    </section>
  </article>
</main>

<footer>
  <a class="brand" href="/"><img src={logo} alt="" /><span>Polymux</span></a>
  <span>Privacy Policy</span>
</footer>

<style>
  :global(:root) {
    font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #171717;
    background: #f7f7f5;
    font-synthesis: none;
  }

  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; min-width: 320px; background: #f7f7f5; }
  :global(a) { color: inherit; text-decoration: none; }
  :global(::selection) { color: #fff; background: #171717; }

  header,
  footer {
    width: min(900px, calc(100% - 40px));
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  header { height: 68px; border-bottom: 1px solid #deded9; }
  footer { min-height: 100px; border-top: 1px solid #deded9; color: #6f6f6b; font-size: 12px; }

  .brand { display: inline-flex; align-items: center; gap: 4.875px; color: #171717; font-size: 19.5px; font-weight: 750; letter-spacing: -.045em; text-rendering: geometricPrecision; -webkit-font-smoothing: antialiased; }
  .brand img { width: 26px; height: 26px; object-fit: contain; }
  .home-link { color: #6f6f6b; font-size: 13px; }
  .home-link:hover, article a:hover { color: #171717; }

  main { width: min(900px, calc(100% - 40px)); margin: 0 auto; padding: 88px 0 112px; }
  .title-block { padding-bottom: 48px; border-bottom: 1px solid #deded9; }
  .eyebrow { margin: 0 0 18px; color: #6f6f6b; font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
  h1 { margin: 0; font-size: clamp(46px, 7vw, 72px); line-height: 1; letter-spacing: -.055em; font-weight: 620; }
  .effective { margin: 20px 0 0; color: #6f6f6b; font-size: 13px; }

  article { max-width: 680px; padding-top: 18px; }
  section { padding: 34px 0; border-bottom: 1px solid #deded9; }
  section:last-child { border-bottom: 0; }
  h2 { margin: 0 0 16px; font-size: 22px; line-height: 1.25; letter-spacing: -.025em; font-weight: 620; }
  h3 { margin: 26px 0 8px; font-size: 15px; line-height: 1.4; font-weight: 650; }
  p, li { color: #565652; font-size: 15px; line-height: 1.72; }
  p { margin: 0; }
  ul { margin: 12px 0 0; padding-left: 21px; }
  li + li { margin-top: 7px; }
  article a { color: #171717; text-decoration: underline; text-decoration-color: #b8b8b2; text-underline-offset: 3px; }

  @media (max-width: 640px) {
    header, footer, main { width: min(100% - 28px, 900px); }
    main { padding: 64px 0 82px; }
    .title-block { padding-bottom: 38px; }
    section { padding: 28px 0; }
  }
</style>
