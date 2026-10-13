/**
 * Privacy Policy and Terms of Service, as plain data.
 *
 * One source for both the in-app pages (/privacy, /terms) and the static HTML
 * copies the build writes to dist/privacy/index.html and dist/terms/index.html
 * (see legalPages() in vite.config.ts), so crawlers and Google's OAuth
 * reviewers get the full text without running JavaScript.
 *
 * Keep this file free of React and `import.meta`: vite.config.ts imports it.
 *
 * Inline markup in strings: `**bold**` and `[label](href)`. Nothing else.
 *
 * Written from what the code actually does (audit 2026-10-13). If you change
 * what data the app collects, change this file in the same PR.
 */
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_GOVERNING_LAW,
  LEGAL_LAST_UPDATED,
  LEGAL_OPERATOR,
} from "./contact.ts";

export type LegalBlock = string | { list: string[] };

export type LegalSection = {
  id: string;
  heading: string;
  body: LegalBlock[];
};

export type LegalDoc = {
  /** URL path segment: /privacy, /terms. */
  slug: "privacy" | "terms";
  title: string;
  /** <meta name="description"> on the static copy. */
  summary: string;
  updated: string;
  intro: LegalBlock[];
  sections: LegalSection[];
};

const contact = `[${LEGAL_CONTACT_EMAIL}](mailto:${LEGAL_CONTACT_EMAIL})`;

export const privacyPolicy: LegalDoc = {
  slug: "privacy",
  title: "Privacy Policy",
  summary:
    "How Aria (karaoke-arena.vercel.app) handles your Google account details, camera and microphone, scores, and analytics.",
  updated: LEGAL_LAST_UPDATED,
  intro: [
    `Aria is a 1v1 karaoke game at karaoke-arena.vercel.app, run by ${LEGAL_OPERATOR} ("we", "us"). This policy explains what information the game collects, why, who it is shared with, and the choices you have. It covers the website and its game server.`,
    "The short version: you sign in with Google so your rating belongs to you. Your camera and microphone are streamed live to the people in your room and are **not recorded on our servers**. Your singing is scored **in your browser**. We store your display name, scores, rating and match results so the leaderboard works.",
  ],
  sections: [
    {
      id: "collect",
      heading: "1. Information we collect",
      body: [
        "**Google account details (when you sign in).** Sign-in uses Google, through our authentication provider Supabase. With your permission Google shares your name, email address, profile picture URL and Google account identifier. Supabase creates an account record for you, and its user id becomes your player id in the game.",
        "**Account settings.** Stored with your account record: the display name you choose (it starts from your Google name), whether you have completed or skipped the first-time device and voice checks, and, if you take the voice check, your measured vocal range (lowest, highest and centre note, and when it was measured). The range only tunes the on-screen pitch guide.",
        "**Game records.** Our game server stores, in our database: your player id and display name, your ELO rating and number of matches played, and for each ranked or duet match the room, mode, song, both players' ids, display names and score cards (overall, pitch, tone and word scores, a one-line verdict), the winner and the rating change. Best duet scores are stored with both singers' display names.",
        "**Live room state.** While you are queued or in a room, the server keeps short-lived records (room code, mode, who is seated, timing). Matchmaking entries expire after seconds to minutes and live-room snapshots after about two hours.",
        "**Safety records.** If you report someone, we store the reporter's and reported player's ids and display names, the room code, the mode, the reason you picked, your optional note (up to a short limit), and the time. Blocks store who blocked whom and when. A removal from a room stores the player id, room code, who removed them and why, and expires automatically after about two hours.",
        "**Camera and microphone.** See section 3. Audio and video are streamed live and not stored by us.",
        "**Usage analytics.** If analytics is enabled, we use PostHog to understand how the game is used: page views, clicks on buttons and links, and game events such as \"match started\", \"song played\", \"queue joined\", \"room created\", \"score submitted\" and \"share clicked\", with details like mode, song and room code. Analytics events are linked to your player id and display name once you sign in. **Session recording (screen replay) is turned off**, because the stage shows people's cameras.",
        "**Technical data.** Like any website, our hosting provider (Vercel) and our other providers receive your IP address, browser type and request details when your browser talks to them, and may keep short-term logs for security and operations.",
      ],
    },
    {
      id: "device",
      heading: "2. Stored on your device",
      body: [
        "Aria uses your browser's local storage and session storage (not advertising cookies) for things that make the game work: your sign-in session (Supabase), your player id and display name, your chosen camera and microphone, a copy of your onboarding progress so the game works offline, and where to return after signing in. PostHog, when enabled, stores an anonymous identifier in local storage and a first-party cookie.",
        "You can clear these at any time in your browser settings. Clearing them signs you out.",
      ],
    },
    {
      id: "camera",
      heading: "3. Camera, microphone and your voice",
      body: [
        "Aria is a game where your opponent sees and hears you. When you are in a room, your camera and microphone are streamed in real time to the other people in that room through LiveKit, a WebRTC video service. Our servers do not record, store or analyse your audio or video. LiveKit relays the streams to deliver them and does not keep them for us.",
        "**Scoring happens in your browser.** Pitch, tone and timing are measured on your own device from your microphone. Only the resulting numbers are sent to our server, never your audio.",
        "**Share video and share card.** During a match your browser builds a short highlight video (both cameras, the lyrics and the mixed audio) and a still share card, entirely on your device. They are not uploaded to us. They leave your device only if you choose to download or share them, and then they go wherever you send them. The same is true on your opponent's device: they can save a clip of the match that includes your camera and voice. Please sing with that in mind, and use report and block if someone misuses it.",
        "You can stop sharing your camera or microphone at any time by leaving the room or revoking the permission in your browser.",
      ],
    },
    {
      id: "use",
      heading: "4. How we use information",
      body: [
        {
          list: [
            "To sign you in and keep your rating, history and settings tied to your account.",
            "To run matches: matchmaking, rooms, live video, scoring, ratings and leaderboards.",
            "To show your display name, rating and results to other players (see section 5).",
            "To keep rooms safe: handling reports, enforcing blocks and removals, and preventing abuse.",
            "To understand and improve the game through aggregate usage analytics.",
            "To write a one-line verdict after a song (see Google Gemini below).",
          ],
        },
        "We do not sell your personal information, we do not use it for advertising, and we do not use your Google data for anything other than signing you in and showing your name in the game.",
      ],
    },
    {
      id: "public",
      heading: "5. What other players see",
      body: [
        "Your display name, rating and match results are public: they appear in rooms, on results screens, and on the public leaderboard and stats pages, which anyone can view without signing in. People in your room see and hear your live camera and microphone. Your email address is never shown to other players.",
      ],
    },
    {
      id: "processors",
      heading: "6. Service providers we share data with",
      body: [
        "We use these providers to run Aria. Each only receives what it needs for its part of the service:",
        {
          list: [
            "**Google** (Google Sign-In / Google Identity Services): authenticates you and shares the profile details listed above with us. Google's own privacy policy applies to your Google account. Our pages also load fonts from Google Fonts.",
            "**Supabase** (authentication): stores your account record, profile details from Google, and account settings, and issues the sign-in tokens our server checks.",
            "**LiveKit** (real-time video): relays camera and microphone streams between players in a room. Not recorded by us.",
            "**MongoDB Atlas** (database): stores player records, ratings, match results, duet scores, safety records and short-lived matchmaking state.",
            "**Vercel** (hosting): serves the website and runs the game server; receives standard request data such as IP addresses.",
            "**PostHog** (product analytics, when enabled): receives the usage events described in section 1. Session recording is off.",
            "**Google Gemini** (AI verdict): after a song, our server sends Gemini your score numbers (overall, pitch, tone) and up to a few lines of the song's lyrics, and Gemini returns a one-line comment. No audio, video, name, email or account identifier is sent.",
          ],
        },
        "We may also disclose information if required by law, to protect the safety of players or the public, or as part of a transfer of the service, in which case this policy continues to apply to your information.",
      ],
    },
    {
      id: "retention",
      heading: "7. How long we keep it",
      body: [
        {
          list: [
            "Account record and settings: until you ask us to delete your account.",
            "Player record, ratings and match history: while the game runs, so ratings and leaderboards stay accurate, or until you ask us to delete them.",
            "Matchmaking and live-room state: deleted automatically, from seconds up to about two hours.",
            "Room removals: deleted automatically after about two hours.",
            "Reports and blocks: kept while needed for safety and to handle repeat abuse.",
            "Analytics: kept by PostHog under our project's retention settings.",
          ],
        },
      ],
    },
    {
      id: "rights",
      heading: "8. Your choices and rights",
      body: [
        `You can change your display name in Settings, sign out at any time, and remove Aria's access to your Google account from your Google Account's security settings. To get a copy of your data, correct it, or delete your account and the data tied to it, email ${contact} from the email address on your account. We will confirm the request and act on it within 30 days. Match results that also belong to your opponent may be kept with your name removed.`,
        "Depending on where you live (for example in the EU, UK or California) you may have further rights, such as to object to or restrict processing, or to complain to a data protection authority. We process account and game data to provide the service you asked for, and analytics and safety records on the basis of our legitimate interest in running a safe, working game.",
      ],
    },
    {
      id: "children",
      heading: "9. Children",
      body: [
        "Aria is not directed at children. You must be at least 13 years old to use it (or older where your country requires it). We do not knowingly collect information from children under 13. If you believe a child has signed up, contact us and we will delete the account.",
      ],
    },
    {
      id: "security",
      heading: "10. Security and international transfers",
      body: [
        "Connections to Aria use HTTPS, sign-in tokens are verified on the server, and secrets never reach your browser. No system is perfectly secure, though, so we cannot guarantee absolute security. Our providers may process data in the United States and other countries.",
      ],
    },
    {
      id: "changes",
      heading: "11. Changes and contact",
      body: [
        `We will update this policy when the game changes how it handles data, and change the "Last updated" date above. For any question about privacy, email ${contact}.`,
      ],
    },
  ],
};

export const termsOfService: LegalDoc = {
  slug: "terms",
  title: "Terms of Service",
  summary: "The rules for using Aria (karaoke-arena.vercel.app), a live 1v1 karaoke game.",
  updated: LEGAL_LAST_UPDATED,
  intro: [
    `These terms are an agreement between you and ${LEGAL_OPERATOR} ("we", "us") for using Aria at karaoke-arena.vercel.app. By signing in or playing you agree to them and to our [Privacy Policy](/privacy). If you do not agree, do not use Aria.`,
  ],
  sections: [
    {
      id: "eligibility",
      heading: "1. Who can use Aria",
      body: [
        "You must be at least 13 years old (or older where your country requires it). If you are under the age of majority where you live, you need a parent or guardian's permission. You need a Google account to play, and you are responsible for activity under your account.",
      ],
    },
    {
      id: "service",
      heading: "2. The service",
      body: [
        "Aria matches you with other people for live karaoke: everyone in a room sees and hears each other's camera and microphone in real time, and scores are computed automatically. Ratings, scores and AI-written verdicts are for fun; they are automated, may be imperfect, and we may reset or adjust them (for example to fix bugs or undo abuse). Aria is an early-stage project and may change, break or be unavailable at any time.",
      ],
    },
    {
      id: "conduct",
      heading: "3. Acceptable use",
      body: [
        "You are on camera with real people. You agree **not** to:",
        {
          list: [
            "show nudity or sexual content, or anything sexual involving minors (we will report this to the authorities);",
            "harass, threaten, bully, or show hate toward anyone, or share violent or graphic content;",
            "record, screenshot or share other players in a way meant to embarrass or harass them, or share their clips without their consent where the law requires it;",
            "impersonate someone, or use an offensive or misleading display name;",
            "cheat: tamper with scoring, play back recordings instead of singing to game the rating, use multiple accounts to boost a rating, or exploit bugs;",
            "disrupt the service: attack, overload, scrape, or reverse-engineer it to get around its limits or safety features;",
            "break the law or infringe anyone's rights.",
          ],
        },
        "Use **Report** and **Block** in a room if someone breaks these rules. Hosts of private rooms can remove people, and public rooms can vote someone out. We review reports and may act on them.",
      ],
    },
    {
      id: "content",
      heading: "4. Your content",
      body: [
        "Your live video, voice, display name and anything else you put into Aria remain yours. You give us a limited licence to transmit and display them to the people you play with, and to show your display name and results on leaderboards, only as needed to run the service. Share videos and cards are made on your device; if you share them, you are responsible for where they go.",
      ],
    },
    {
      id: "music",
      heading: "5. Music and lyrics",
      body: [
        "Songs, instrumentals and lyrics in Aria are provided for demonstration and personal, non-commercial play only. All rights in them belong to their respective owners. Do not copy or redistribute them outside the game. If you are a rights holder and have a concern about any material, contact us and we will respond promptly.",
      ],
    },
    {
      id: "termination",
      heading: "6. Suspension and termination",
      body: [
        "You can stop using Aria at any time and ask us to delete your account (see the [Privacy Policy](/privacy)). We may suspend or end your access, remove you from rooms, or reset your rating if you break these terms, if it is needed to protect other players, or if we stop running the service.",
      ],
    },
    {
      id: "warranty",
      heading: "7. No warranty",
      body: [
        "Aria is provided **\"as is\" and \"as available\"**, without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement. We do not promise that the service will be uninterrupted, secure or error-free, or that scores and ratings will be accurate. We are not responsible for what other players say, show or do.",
      ],
    },
    {
      id: "liability",
      heading: "8. Limitation of liability",
      body: [
        "To the fullest extent the law allows, we are not liable for any indirect, incidental, special, consequential or punitive damages, or for lost data, profits or goodwill, arising from your use of Aria. Our total liability for any claim about the service is limited to US$50. Some places do not allow these limits, so they may not fully apply to you.",
      ],
    },
    {
      id: "law",
      heading: "9. Governing law",
      body: [
        `These terms are governed by the laws of ${LEGAL_GOVERNING_LAW}, without regard to conflict-of-law rules, and disputes will be resolved in the courts located there, unless the law where you live requires otherwise.`,
      ],
    },
    {
      id: "changes",
      heading: "10. Changes and contact",
      body: [
        `We may update these terms; when we do, we will change the "Last updated" date above, and continuing to use Aria means you accept the new terms. Questions: ${contact}.`,
      ],
    },
  ],
};

export const legalDocs = [privacyPolicy, termsOfService] as const;
