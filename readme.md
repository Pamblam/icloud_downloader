![](logo.png)

# iCloud Downloader

Uses Puppeteer to log into iCloud, download files, extract them, and then delete them from iCloud to save space.

This was written for my own personal use and intended to be run on a Mac. Feel free to use at your own risk.

# Usage

 1. clone the repo
 2. `cd` into the repo
 3. `npm i`
 4. `npm run main`
 5. When prompted, select the drive and path at which to save files.
 6. When prompted enter your iCloud email/password.
 7. When prompted, enter the security code.
 8. Wait.

# Behaviour

This will download files archived in batches of 6 (can be configured in the source code) to a temporary directory and extract the files to wherever you specified. If the filename already exists in the destination directory a number will be appended to the end of the filename to make it unique.

# A note on running on Apple Silicone:

If you get the "Degraded Performance warning, you can switch architectures like this: https://gist.github.com/LeZuse/bf838718ff2689c5fc035c5a6825a11c 