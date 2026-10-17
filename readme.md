![](logo.png)

# iCloud Downloader

Uses Puppeteer to log into iCloud, download files, extract them, and then delete them from iCloud to save space.

This was written for my own personal use and intended to be run on a Mac. Feel free to use at your own risk.

# Usage

 1. clone the repo
 2. `cd` into the repo
 3. `npm i`
 4. `npm run main`
 5. When prompted, choose whether to run the browser hidden (headless) or visible.
 6. When prompted, select the drive and path at which to save files.
 7. When prompted enter your iCloud email/password.
 8. Choose whether to save your answers to `config.json`. Saved answers become the defaults next time, so you can just press Enter.
 9. When prompted, enter the security code.
 10. Wait. A progress bar shows how far along it is and what it's doing right now.
 11. When your content is downloaded, you can clear your iCloud storage by running `npm run delete` to permanently remove it from the cloud.

# Config

`config.json` (next to `main.js`) stores your answers: headless mode, drive, folder, email and, if you choose, your password. The password is stored as plain text, so the file is readable only by your user account and is excluded from git. Delete the file to start fresh.

# Behaviour

This will download files archived in batches of 6 (can be configured in the source code) to a temporary directory and extract the files to wherever you specified. If the filename already exists in the destination directory a number will be appended to the end of the filename to make it unique.

# A note on running on Apple Silicone:

If you get the "Degraded Performance warning, you can switch architectures like this: https://gist.github.com/LeZuse/bf838718ff2689c5fc035c5a6825a11c 