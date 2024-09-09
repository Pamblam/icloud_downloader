import puppeteer from 'puppeteer';

import { iCloudLogin } from './modules/iCloudLogin.js';
import { sleep } from "./modules/sleep.js";
import { prompt } from "./modules/readlineInterface.js";

const headless = true;
const items_per_iteration = 50;

const browser = await puppeteer.launch({headless});
const page = await browser.newPage();

let login_success = await iCloudLogin(page);

if(!login_success){
	console.log('Unable to login.');
	process.exit();
}

console.log('Login success!');

// Open the photos page
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
		console.log('Nothing left to delete.');
		break;
	}

	// Press shift and select the first n items
	let items_to_process = Math.min(grid_items.length, items_per_iteration);
	await page.keyboard.down('Shift');
	for(let i=0; i<items_to_process; i++){
		await grid_items[i].click();
		await sleep(500);
	}
	await page.keyboard.up('Shift');
	await sleep(500);

	// Wait for the .has_asset class to indicate that the item is loaded
	await frame.waitForSelector('.PhotoItemView.is-selected.has-asset');

	// Click the delete button
	let dl_btn = await frame.$('.ExpungeButton');
	await dl_btn.hover();
	await dl_btn.click();

	// Confirm the delete
	let confirm_delete_btn = await frame.waitForSelector('.destructive');
	await sleep(500);
	await confirm_delete_btn.hover();
	await sleep(500);

	// Wait for the spinner to to show up and click confirm delete button
	await Promise.all([
		frame.waitForSelector('.Spinner'),
		confirm_delete_btn.click()
	]);

	// Wait for the delete to finish
	while(true){
		await sleep(500);
		let delete_complete = !(await frame.$('.PhotoItemView.is-selected'));
		if(delete_complete) break;
	}

	console.log(`Deleted ${items_to_process} items.`);
	await sleep(1000);
}

console.log("All done!");
process.exit();