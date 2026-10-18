
import { launchBrowser } from './modules/launchBrowser.js';
import { clickElement, hoverElement } from './modules/clickElement.js';
import { selectGridItems, waitForGridToSettle } from './modules/selectGridItems.js';
import { iCloudLogin } from './modules/iCloudLogin.js';
import { sleep } from "./modules/sleep.js";
import { askSettings, askCredentials } from './modules/settings.js';
import { progress } from './modules/progress.js';
import { dismissAlert } from './modules/alerts.js';
import { handleErrors, setBrowserForErrors } from './modules/errorHandler.js';

const items_per_iteration = 50;

// Print errors on their own line and screenshot the browser when one happens.
handleErrors();

const settings = await askSettings(false);

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
let batch = 0;
let delete_failures = 0;
const max_delete_failures = 5;
let deleted = 0;

// Open the photos page
progress.setStep('Opening Recently Deleted');
await page.goto('https://www.icloud.com/photos/#/recentlydeleted/');



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
		progress.log('Nothing left to delete.');
		break;
	}

	// Close any alert iCloud left up (it would block clicking the grid).
	const stray_alert = await dismissAlert(frame);
	if(stray_alert) progress.log(`iCloud showed an alert: "${stray_alert}". Closed it and carrying on.`);

	// Press shift and select the first n items
	let items_to_process = Math.min(grid_items.length, items_per_iteration);
	batch++;
	const step = text => progress.setStep(`Batch ${batch} (${items_to_process} items, ${deleted.toLocaleString()} deleted so far)`, text);
	step('selecting items');
	await selectGridItems(page, frame, items_to_process, step);

	// Click the delete button
	step('permanently deleting');
	let dl_btn = await frame.$('.ExpungeButton');
	await clickElement(page, dl_btn);

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
			throw new Error(`iCloud failed to delete ${max_delete_failures} batches in a row (last error: "${delete_error}"). Try again later.`);
		}
		const wait = 15 * delete_failures;
		progress.log(`Batch ${batch}: iCloud couldn't delete it ("${delete_error}"). Retrying in ${wait}s.`);
		step(`waiting ${wait}s before retrying`);
		await sleep(wait * 1000);
		continue;
	}
	delete_failures = 0;
	deleted += items_to_process;
}

progress.stop();
console.log(`All done! Permanently deleted ${deleted.toLocaleString()} items.`);
process.exit();