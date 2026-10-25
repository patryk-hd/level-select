# Installing Level Select

One-click installers for people trying Level Select. Each carries the app and its own
Node.js; the Windows one also carries Python. Nothing personal is ever packaged: only files
Git sees (tracked or new, never ignored ones like `library/data`).

## Building

| Installer | Command | Where it's built |
|---|---|---|
| Windows (`Level-Select-Setup-<version>.exe`) | `npm run package -- --windows` | GitHub Actions: the **Installers** workflow builds it on Windows, installs it silently, checks it end to end and attaches it to the run (Artifacts → `level-select-windows`). Locally it needs NSIS (`brew install makensis`). |
| macOS (`Level-Select-<version>-mac-<arm64\|x64>.dmg`) | `npm run package -- --mac` | On a Mac with Xcode. |

Output goes to `dist-installers/` (not committed). Downloaded runtimes are cached in
`.build/cache` and checked: Node.js against its published checksums, Python against the
checksum pinned in `scripts/package-runtimes.json`.

## What gets installed

**Windows** (no administrator rights needed):
- The app goes to `%LOCALAPPDATA%\Programs\Level Select`, with shortcuts on the Start menu
  and the desktop.
- **Level Select** starts the library and opens it in the browser. Its icon sits by the
  clock: click it to open Level Select, right-click for sections or **Stop Level Select**.
- Imported games and settings stay in `...\Level Select\app\library\data`.
- Uninstalling (Settings → Apps) asks whether to delete them too. It stops Level Select
  first, its icon by the clock included, and leaves no other files or folders behind.
- Steam, GOG Galaxy, Playnite and ES-DE (installed, portable or EmuDeck) are found where
  Windows keeps them. Steam is located through the registry, so any drive works. Installed
  Steam games are read from every library folder Steam lists, Family Sharing games included.
- **Choose folder** opens Windows' folder picker.

**macOS:**
- Drag **Level Select** to Applications.
- On first open it copies itself to `~/Library/Application Support/Level Select/app` (an app
  can't write inside /Applications), and again when a newer version is installed. Imported
  games stay.
- To uninstall, choose **Level Select → Uninstall Level Select…** in the menu bar. It asks
  whether to delete imported games too, removes its Application Support folder and moves
  the app to the Trash. (Dragging the app to the Trash leaves that folder behind.)
- The dashboard window opens sections and stops the library.
- Building a library from imported games uses Python 3, which Macs don't include. Level
  Select finds Homebrew's, python.org's or the one in Apple's command-line tools. It never
  runs `/usr/bin/python3`, which is only a stand-in that offers to install those tools.
  Without Python, **Import games** starts with a "Python 3" card that has the steps below
  and a **Check again** button.
  The setup guide mentions it too, and **Update data** explains it if it's still missing.

Both use their own address, http://127.0.0.1:8790, so an installed copy never mixes browser
data with a copy run from the project folder (8765). The first visit starts the setup guide.

## For testers

Send them the installer and this:

- **Windows:** run the installer. Windows may say "Windows protected your PC" (the installer
  isn't signed): choose **More info → Run anyway**.
- **Mac:** open the disk image and drag Level Select to Applications. The first time, macOS
  may say it can't check the app: open **System Settings → Privacy & Security** and choose
  **Open Anyway**.
- **Mac, before importing games: install Python 3 once** (free, about two minutes):
  1. Go to [python.org/downloads](https://www.python.org/downloads/) and click the yellow
     **Download Python 3…** button (the site picks the Mac version).
  2. Open the downloaded `.pkg` file from Downloads. Click **Continue**, **Agree** and
     **Install**, and enter your Mac's password when asked.
  3. When it says the installation was successful, close the installer. In Level Select, open
     **Import games** and click **Check again**.

  Prefer Apple's tools? In Terminal, `xcode-select --install` installs them, Python included.
  Homebrew users: `brew install python`. Windows needs nothing: its installer includes Python.
- **Games no import can see** (cartridges, discs, console games): **+ Add game** in the Library.
  Search, pick the platform you own it on, and add it, with your own cover picture if you like.
- **A wrong title, year, platform or cover:** open the game in your Library and choose
  **Edit details**. Your fix stays through every import.
- Level Select opens in your browser with a one-minute setup guide. Keep using the same
  browser: your play tracking lives there. **Backup & import** saves a copy.
- **Scores:**
  - **Game Atlas** scores come with the app.
  - **Your own games:**
    - Steam games get Steam reviews (no key needed).
    - **IGDB** adds critic and player ratings and time to beat. It needs your own free keys
      (about five minutes, once). **Import games → Scores** walks you through it:
      1. Sign in at dev.twitch.tv/console with a Twitch account.
      2. Turn on two-factor sign-in.
      3. Register an application (Confidential, redirect `http://localhost`).
      4. Copy its Client ID and a new Client Secret into Level Select.
    - **VideoGamesCritic** works without a key, 60 lookups an hour, so a big library fills in
      over a few updates. Import games shows how many games are waiting. A free key from
      videogamescritic.com/developers allows 5,000 a day.
  - Installers never include anyone's keys. Yours are checked with the service, then saved
    only on your computer.

## Privacy

- **What installers carry:** only files Git sees, never ignored ones (`library/data`, exports,
  keys). They also leave out tests, docs and dot-folders (CI and other tools' settings).
- **The privacy check** (`npm run check:share`, also in CI) fails if a file that would be
  shared contains your Git name or email, your user name or your home folder. It reads them
  on your computer, so they're never written down.
- **The local server** listens only on this computer and answers only `127.0.0.1` and
  `localhost` on its own port. It refuses requests addressed to any other name, so another
  website can't point its domain at your computer and read your library (DNS rebinding).
- **Other websites can't use Level Select's files.** A cross-site request that isn't a plain
  link is refused, so another site can't load your library file into its page.
  `Cross-Origin-Resource-Policy: same-origin` does the same for older browsers.
- **Headers:** Level Select can't be shown inside another site's page (`X-Frame-Options`,
  `frame-ancestors`). Links out send no referrer. Writes need the app's own origin and a
  custom header.
- **Your keys** (Steam Web API, IGDB, VideoGamesCritic) are saved only in
  `library/data/secrets.json` (readable by you alone). The app shows only whether each is set,
  never the key, and keys aren't included in backups. **Forget** removes them.
- **What leaves your computer:** only game titles and ids (for scores and prices), your
  Steam ID (for the wishlist), and each key to its own service only.
