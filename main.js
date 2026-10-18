import os from "os";
import path from "path";
import fs from "fs";

import { launchBrowser } from './modules/launchBrowser.js';
import { clickElement, hoverElement } from './modules/clickElement.js';
import { selectGridItems, waitForGridToSettle, waitForThumbnails, fingerprintItems, ensureSelectedForDelete } from './modules/selectGridItems.js';
import { iCloudLogin } from './modules/iCloudLogin.js';
import { askSettings, askCredentials } from './modules/settings.js';
import { progress } from './modules/progress.js';
import { dismissAlert } from './modules/alerts.js';
import { handleErrors, setBrowserForErrors } from './modules/errorHandler.js';
import { sleep } from "./modules/sleep.js";
import { waitForDownload } from './modules/waitForDownload.js';
import { processArchive } from './modules/processArchive.js';

const items_per_iteration = 5;
const temp_dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'icloud-downloader'));
const zip_source = path.join(temp_dir, 'iCloud Photos.zip');

// Print errors on their own line and screenshot the browser when one happens.
handleErrors();

const settings = await askSettings(true);
const destination_path = settings.destination_path;

progress.start();
progress.setStep('Starting the browser');
const {browser, page} = await launchBrowser(settings.headless);
setBrowserForErrors(browser);

let login_success = await iCloudLogin(page, settings, async ()=>{
	const credentials = await askCredentials();
	settings.saveCredentials(credentials);
	return credentials;
});

if(!login_success){
	// Thrown so the error handler saves a screenshot of what iCloud is showing.
	throw new Error(`iCloud didn't finish signing in.`
		+ (settings.headless ? ` iCloud may not accept sign-ins from a hidden browser; try again and answer "n" to running headless.` : ''));
}

progress.log('Signed in.');
progress.setStep('Counting photos and videos');

// Parse the piece of text on the iCloud home page that shows how many photos and videos there are.
// It's only used for the progress bar, so carry on without it if it can't be found.
let total_items = 0;
try{
	await page.waitForSelector('article[aria-label="Photos"] .description-text-content', {timeout: 60000});
	total_items = await page.evaluate(async ()=>{
		return document
			.querySelector('article[aria-label="Photos"] .description-text-content')
			.innerText
			.replaceAll(/,/g, '')
			.match(/\d+/g)
			.map(i=>parseInt(i))
			.reduce((a,c)=>a+c,0);
	});
}catch(e){
	progress.log(`Couldn't find how many photos and videos there are (${e.message.split('\n')[0]}). Continuing without a total.`);
}
progress.setTotal(total_items);
let batch = 0;
let delete_failures = 0;
const max_delete_failures = 5;

// Open the photos page
progress.setStep('Opening iCloud Photos');
await page.goto('https://www.icloud.com/photos/');

// Set the download location.
const client = await page.createCDPSession();
await client.send('Page.setDownloadBehavior', {
	behavior: 'allow',
	downloadPath: temp_dir,
});

// Get the reference to the frame
const frame_handle = await page.waitForSelector('iframe.child-application');
const frame = await frame_handle.contentFrame();

// Get the box that contains all the images and scroll it to the top
await frame.waitForSelector('.grid-scroll');
await frame.evaluate(()=>{
	document.querySelector('.grid-scroll').scrollTo(0, 0);
});

while(true){
	// Get all the grid items
	let grid_items = await frame.$$('.grid-item');

	if(!grid_items.length){
		progress.log('Nothing left to download.');
		break;
	}

	if(grid_items.length < 30){
		progress.log('Fewer than 30 items left. Stopping here; run again to handle the rest in smaller batches.');
		break;
	}

	// Close any alert iCloud left up (it would block clicking the grid).
	const stray_alert = await dismissAlert(frame);
	if(stray_alert) progress.log(`iCloud showed an alert: "${stray_alert}". Closed it and carrying on.`);

	// Press shift and select the first n items
	let items_to_process = Math.min(grid_items.length, items_per_iteration);
	batch++;
	const step = text => progress.setStep(`Batch ${batch} (${items_to_process} items)`, text);
	step('selecting items');
	const batch_items = await selectGridItems(page, frame, items_to_process, step);
	step('waiting for thumbnails to load');
	await waitForThumbnails(frame, items_to_process);
	const batch_fingerprints = await fingerprintItems(batch_items);

	// Click the download button
	step('waiting for iCloud to prepare the download');
	let dl_btn = await frame.$('.DownloadButton');
	await clickElement(page, dl_btn);

	// wait for the download to finish rendering.
	await waitForDownload(browser, page, (status)=>{
		step(`downloading (${status})`);
	});

	// Extract the file
	step('extracting');
	await processArchive(zip_source, destination_path, (filename, skipped)=>{
		if(skipped){
			progress.addSkipped();
			step(`skipped ${path.basename(filename)} (already saved)`);
		}else{
			progress.addFile();
			step(`extracted ${path.basename(filename)}`);
		}
	});
	fs.unlinkSync(zip_source);

	// Delete the ones we just downloaded.
	step('deleting from iCloud');
	await sleep(500);
	await ensureSelectedForDelete(page, frame, batch_items, batch_fingerprints, step);
	let del_btn = await frame.$('.DeleteButton');
	await clickElement(page, del_btn);

	// Confirm the delete
	let confirm_delete_btn = await frame.waitForSelector('.destructive', {timeout: 60000});
	await sleep(500);
	await hoverElement(page, confirm_delete_btn);
	await sleep(500);

	await clickElement(page, confirm_delete_btn);

	// Wait for the delete to finish. Don't wait on the .Spinner: on fast deletes it can come and
	// go before we see it. The selected items disappearing is the real signal.
	step('waiting for iCloud to finish deleting');
	let delete_started = Date.now();
	let delete_error = null;
	while(true){
		await sleep(500);
		// iCloud reports a failed delete with an alert, e.g. "Unable to Delete Items ... server error".
		delete_error = await dismissAlert(frame);
		if(delete_error) break;
		let delete_complete = !(await frame.$('.PhotoItemView.is-selected'));
		if(delete_complete) break;

		// If the confirm dialog is still up after a few seconds, the click didn't register; retry it.
		let confirm_still_open = await frame.$('.destructive');
		if(confirm_still_open && Date.now() - delete_started > 5000){
			await clickElement(page, confirm_still_open);
			delete_started = Date.now();
		}

		if(Date.now() - delete_started > 120000){
			throw new Error('Timed out waiting for the delete to finish.');
		}
	}

	// iCloud clears selections made while it's still shuffling the grid after a delete.
	step('waiting for the photo grid to settle');
	await waitForGridToSettle(frame);

	// The failed-delete alert sometimes only shows up after the selection has cleared.
	delete_error ??= await dismissAlert(frame);
	if(delete_error){
		// The photos are still at the top of the grid, so the next batch picks them up again.
		delete_failures++;
		if(delete_failures >= max_delete_failures){
			throw new Error(`iCloud failed to delete ${max_delete_failures} batches in a row (last error: "${delete_error}"). Everything up to now is saved; try again later.`);
		}
		const wait = 15 * delete_failures;
		progress.log(`Batch ${batch}: iCloud couldn't delete it ("${delete_error}"). Retrying in ${wait}s.`);
		step(`waiting ${wait}s before retrying`);
		await sleep(wait * 1000);
		continue;
	}
	delete_failures = 0;
	progress.addDone(items_to_process);
}

progress.stop();
console.log(`All done! Saved ${progress.files.toLocaleString()} files from ${progress.done.toLocaleString()} items to ${destination_path}`
	+ (progress.skipped ? ` (skipped ${progress.skipped.toLocaleString()} already saved)` : ''));
process.exit();