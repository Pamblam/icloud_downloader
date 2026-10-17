import os from "os";
import path from "path";
import fs from "fs";

import { launchBrowser } from './modules/launchBrowser.js';
import { clickElement, hoverElement } from './modules/clickElement.js';
import { iCloudLogin } from './modules/iCloudLogin.js';
import { askSettings, askCredentials } from './modules/settings.js';
import { progress } from './modules/progress.js';
import { sleep } from "./modules/sleep.js";
import { waitForDownload } from './modules/waitForDownload.js';
import { processArchive } from './modules/processArchive.js';

const items_per_iteration = 5;
const temp_dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'icloud-downloader'));
const zip_source = path.join(temp_dir, 'iCloud Photos.zip');

// Make sure errors print on their own line instead of after the status display.
process.on('uncaughtException', e=>{
	progress.stop();
	console.error(e);
	process.exit(1);
});

const settings = await askSettings(true);
const destination_path = settings.destination_path;

progress.start();
progress.setStep('Starting the browser');
const {browser, page} = await launchBrowser(settings.headless);

let login_success = await iCloudLogin(page, settings, async ()=>{
	const credentials = await askCredentials();
	settings.saveCredentials(credentials);
	return credentials;
});

if(!login_success){
	progress.stop();
	console.log('Unable to login.');
	process.exit();
}

progress.log('Signed in.');
progress.setStep('Counting photos and videos');

await page.waitForSelector('article[aria-label="Photos"] .description-text-content');

// Parse the piece of text that shows how many photos and videos there are
let total_items = await page.evaluate(async ()=>{
	return document
		.querySelector('article[aria-label="Photos"] .description-text-content')
		.innerText
		.replaceAll(/,/g, '')
		.match(/\d+/g)
		.map(i=>parseInt(i))
		.reduce((a,c)=>a+c,0);
});

progress.setTotal(total_items);
let batch = 0;

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

	// Press shift and select the first n items
	let items_to_process = Math.min(grid_items.length, items_per_iteration);
	batch++;
	const step = text => progress.setStep(`Batch ${batch} (${items_to_process} items)`, text);
	step('selecting items');
	await page.keyboard.down('Shift');
	for(let i=0; i<items_to_process; i++){
		await clickElement(page, grid_items[i]);
		await sleep(500);
	}
	await page.keyboard.up('Shift');
	await sleep(500);

	// Wait for the .has_asset class to indicate that the item is loaded
	step('waiting for the selected items to load');
	await frame.waitForSelector('.PhotoItemView.is-selected.has-asset');

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
	await processArchive(zip_source, destination_path, filename=>{
		progress.addFile();
		step(`extracted ${path.basename(filename)}`);
	});
	fs.unlinkSync(zip_source);

	// Delete the ones we just downloaded.
	step('deleting from iCloud');
	await sleep(500);
	let del_btn = await frame.$('.DeleteButton');
	await clickElement(page, del_btn);

	// Confirm the delete
	let confirm_delete_btn = await frame.waitForSelector('.destructive');
	await sleep(500);
	await hoverElement(page, confirm_delete_btn);
	await sleep(500);

	await clickElement(page, confirm_delete_btn);

	// Wait for the delete to finish. Don't wait on the .Spinner: on fast deletes it can come and
	// go before we see it. The selected items disappearing is the real signal.
	step('waiting for iCloud to finish deleting');
	let delete_started = Date.now();
	while(true){
		await sleep(500);
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

	progress.addDone(items_to_process);
	await sleep(1000);
}

progress.stop();
console.log(`All done! Saved ${progress.files.toLocaleString()} files from ${progress.done.toLocaleString()} items to ${destination_path}`);
process.exit();