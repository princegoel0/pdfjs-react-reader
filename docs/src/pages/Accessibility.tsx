export function Accessibility() {
  return (
    <>
      <h1>Accessibility &amp; the screen-reader pass</h1>
      <p className="doc-lede">
        Three of this package&rsquo;s four evidence legs are files something writes. The fourth — a person
        operating a real screen reader — is a log, and the log is allowed to say <em>not run</em>.
      </p>

      <h2>What is automated, and where it stops</h2>
      <p>
        <code>npm run a11y</code> runs axe twice on purpose: once under jsdom, once inside Chromium, Firefox and
        WebKit through Playwright. Each run leaves a committed record — <code>a11y/latest.json</code> and{' '}
        <code>a11y/browser.json</code> — because a rule that reports <code>incomplete</code> in one environment is
        a statement about the environment, not about the viewer. Under jsdom, <code>color-contrast</code> cannot
        see a painted pixel and <code>target-size</code> happily passes boxes it measured as 0×0; in a real layout
        both rules do their job, and both have. What neither can decide is whether a reader actually <em>says</em>{' '}
        the thing: the live region&rsquo;s wording, the order a reader walks a table, whether a signature box is
        announced as a box. That is the pass below, and no automated rule substitutes for it.
      </p>

      <h2>The three pairings</h2>
      <p>
        FR-45 requires NVDA with Firefox, JAWS with Chromium, and VoiceOver with Safari.{' '}
        <code>a11y/certifications.json</code> holds one row per pairing. Today all three read{' '}
        <code>not-run</code>, and each row names the thing that is missing — the reader is not installed on the
        machine that builds this package, and VoiceOver needs macOS with Safari rather than WebKit under a
        driver. That is a reading of this project&rsquo;s environment, recorded so a host can see what has and has
        not been tested.
      </p>

      <h2>Running a pass</h2>
      <p>Six things have to be exercised, in the reader&rsquo;s own words rather than a screenshot of them:</p>
      <ol>
        <li>
          <strong>loading</strong> — start <code>npm run dev</code> (the playground, port 5199), paste a fixture
          URL such as <code>public/fixtures/long-sample.pdf</code> into the source field, and confirm the reader
          announces the failure, the password prompt, or the page count as each arrives.
        </li>
        <li>
          <strong>navigation</strong> — Tab into the toolbar and drive it from the keyboard only: page field,
          next and previous, zoom, layout, the sidebar tabs and the outline. Every stop has a visible focus ring
          and none of them traps.
        </li>
        <li>
          <strong>search</strong> — search for a term and read the match counter as it moves; the counter is a
          polite live region, so the announcement should arrive without the reader being re-focused.
        </li>
        <li>
          <strong>forms</strong> — load <code>public/fixtures/form-sample.pdf</code> and complete each field with
          the keyboard, including the checkbox and the list. Signature fields are boxes, not controls, and should
          be described as such.
        </li>
        <li>
          <strong>annotations</strong> — load <code>public/fixtures/annotated-sample.pdf</code>, switch on the{' '}
          <em>annotate</em> feature, and check that an existing highlight, its colour and its popup are announced
          and reachable.
        </li>
        <li>
          <strong>tagged structure</strong> — load <code>public/fixtures/tagged-sample.pdf</code> with the{' '}
          <em>structure</em> feature on, and read a table and a heading the document&rsquo;s own tag tree names.
        </li>
      </ol>

      <h2>Recording it</h2>
      <pre>
        <code>{`npm run a11y:certify --record="NVDA+Firefox" --status=pass \\
  --operator="A. Tester" --date=2026-11-02 \\
  --environment="Windows 11 23H2, NVDA 2026.1, Firefox 155.0" \\
  --tasks="loading,navigation,search,forms,annotations,tagged structure" \\
  --evidence=a11y/logs/nvda-2026-11-02.txt

npm run a11y:certify --check   # what verify runs on every push`}
        </code>
      </pre>
      <p>
        The writer refuses the shapes that would make the file worthless: a pass with no person named, a date in
        the future, an environment shorter than &ldquo;Windows&rdquo;, four of the six tasks, an evidence path that
        is not in the tree, or a <code>not-run</code> row that does not say what it is waiting for. It also refuses
        a pairing FR-45 does not name — the three pairings and the six tasks are read out of the requirement&rsquo;s
        own sentence, so if the clause changes the writer has to be told in the same change.{' '}
        <code>npm run a11y:certify</code> with no arguments prints the current rows and what is missing from each.
      </p>
      <p>
        What the record cannot do is certify the release: §9 is signed by a person, and this file is one of the
        things that signature is written against.
      </p>
    </>
  );
}
