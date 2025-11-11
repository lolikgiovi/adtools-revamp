export const AboutTemplate = /*html*/ `
  <section class="about-page">
    <article class="about-content">
      <section>
        <h3>Welcome</h3>
        <p>
          Hi there! welcome to AD Tools. This app bundles practical utilities that ease daily tasks for you guys: The ADs. 
          
          <br><br>AD Tools was initially made to help me automate non practical chores like to generate multiple UUIDs without formatting (some public UUID generator has font format, which is not what I want), to encode/decode Base64, and to create SQL Insert Query.  
          
          <br><br>The app started from a Static Page Application hosted in Cloudflare Pages, and now I made it as a Desktop (using Tauri) and Web App (in Cloudflare Workers).
        </p>
      </section>

      <section>
        <h3>Control</h3>
        <ul class="about-list">
          <li>Cmd + / to show or hide the sidebar.</li>
          <li>Cmd + R to refresh the page.</li>
          <li>Cmd + P to navigate between feature via global search.</li>
        </ul>
      </section>

      <section>
        <h3>How to Use</h3>
        <ol class="about-steps">
          <li>Register yourself using Work e-mail address, the app will send you OTP via that e-mail.</li>
          <li>The verification is needed to fetch some configs I've prepared on cloud.</li>
          <li>Open <em>Settings</em> from the sidebar footer to Load Default Settings, and configure tokens.</li>
          <li>Open <em>Quick Query</em> then <em>Schemas</em> then <em>Import default Schemas</em> to load default schemas from remote.</li>
          <li>Return to <em>Home</em> anytime to see featured tools and usage overview.</li>
        </ol>
      </section>

      <section>
        <h3>Desktop vs Web</h3>
        <p>
          Feature related to Jenkins will only be available on Desktop Version.
        </p>
      </section>

      <section>
        <h3>Regards</h3>
        <p>
          I initially built AD Tools to help my self, but turns out it was so useful that I decided to share it with others. So if you have any suggestions or flow, let me know.

          <br><br>© 2025 - <a href="https://linkedin.com/in/fashalli/" target="_blank" style="color:#000; text-decoration-color:#000;">Fashalli Giovi Bilhaq (Lolik)</a>
        </p>
      </section>
    </article>
  </section>
`;
