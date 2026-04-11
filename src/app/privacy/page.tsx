import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | page2md",
  description: "Privacy policy for the page2md web app and Chrome extension.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="policyShell">
      <article className="policyCard">
        <h1>Privacy Policy</h1>
        <p className="policyMeta">Last updated: April 2026</p>

        <p>
          This Privacy Policy applies to the page2md web app and the page2md Chrome extension. It
          explains what data is processed, how it is used, and the choices available to users.
        </p>

        <h2>What page2md does</h2>
        <p>
          page2md converts webpage content into Markdown. In the extension, conversion runs on the
          active tab after explicit user action. In the web app, conversion runs when users submit
          content or a URL.
        </p>

        <h2>Data we process</h2>
        <ul>
          <li>Website content selected for conversion (for example text, headings, tables, code).</li>
          <li>Page metadata needed for output (for example page title, page URL, conversion time).</li>
          <li>Conversion history stored by the extension and web app for user convenience.</li>
        </ul>

        <h2>How data is stored</h2>
        <ul>
          <li>
            The Chrome extension stores history locally in browser extension storage (
            <code>chrome.storage.local</code>).
          </li>
          <li>
            The web app stores recent history in browser local/session storage for the current
            device/browser profile.
          </li>
          <li>No account is required for these local history features.</li>
        </ul>

        <h2>How data is used</h2>
        <ul>
          <li>To perform conversion and generate Markdown output.</li>
          <li>To show preview and history entries in the app/extension UI.</li>
          <li>To support optional history syncing behavior between the local app tab and extension.</li>
        </ul>

        <h2>Data sharing</h2>
        <p>
          page2md does not sell personal data. Data processed by the extension for conversion
          history is intended to remain local to the user&rsquo;s browser storage. If you use hosted
          API endpoints, submitted conversion input may be processed by that service to return
          results.
        </p>

        <h2>Permissions (Chrome extension)</h2>
        <ul>
          <li>
            <strong>activeTab</strong>: used after user click to read the current page for
            conversion.
          </li>
          <li>
            <strong>scripting</strong>: used to run extraction logic in the active tab.
          </li>
          <li>
            <strong>storage</strong>: used to store local conversion history and settings.
          </li>
        </ul>

        <h2>Your choices</h2>
        <ul>
          <li>Clear saved history in the extension using the &ldquo;Clear all history&rdquo; action.</li>
          <li>Clear browser storage to remove locally stored web app history.</li>
          <li>Uninstall the extension at any time.</li>
        </ul>

        <h2>Contact</h2>
        <p>
          For privacy questions, email{" "}
          <a href="mailto:page2md@gmail.com">page2md@gmail.com</a>.
        </p>

        <p className="policyBackLink">
          <Link href="/">Back to page2md</Link>
        </p>
      </article>
    </main>
  );
}
