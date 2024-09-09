import puppeteer from 'puppeteer';
import os from "os";
import path from "path";
import fs from "fs";

import { iCloudLogin } from './modules/iCloudLogin.js';
import {getDisks, chooseDownloadDrive} from './modules/getDisks.js';
import { prompt, writeOverLine } from "./modules/readlineInterface.js";
import { sleep } from "./modules/sleep.js";
import { waitForDownload } from './modules/waitForDownload.js';
import { processArchive } from './modules/processArchive.js';

const headless = true;
const items_per_iteration = 5;
const temp_dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'icloud-downloader'));
const zip_source = path.join(temp_dir, 'iCloud Photos.zip');

let disks = await getDisks();
let location = await chooseDownloadDrive(disks);
if(location === false){
	console.log('Invalid selection');
	process.exit();
}

let destination_path = await prompt("Enter the path to the folder you want to save files to: ");
destination_path = `${location}/${destination_path}`.replaceAll('//', '/');
if(!fs.existsSync(destination_path) || !fs.lstatSync(destination_path).isDirectory()){
	console.log(`Path (${destination_path}) either does not exist or is not a directory.`);
	process.exit();
}

const browser = await puppeteer.launch({headless});
const page = await browser.newPage();

let login_success = await iCloudLogin(page);

if(!login_success){
	console.log('Unable to login.');
	process.exit();
}

console.log('Login success!');

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

let completed_items = 0;

// Open the photos page
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
		console.log('Nothing left to download.');
		break;
	}

	if(grid_items.length < 30){
		console.log('Done for now... Killing to handle smaller batches');
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

	// Click the download button
	let dl_btn = await frame.$('.DownloadButton');
	await dl_btn.hover();
	await dl_btn.click();

	// wait for the download to finish rendering.
	await waitForDownload(browser, page, (status)=>{
		writeOverLine(`Downloading ${completed_items+1}-${completed_items+items_to_process} of ${total_items}: ${status}`);
	});
	console.log(''); // To create a new line

	// Extract the file
	await processArchive(zip_source, destination_path, filename=>{
		completed_items++;
		console.log(`Extracted ${completed_items} of ${total_items}: ${filename}`);
	});
	fs.unlinkSync(zip_source);

	// Delete the ones we just downloaded.
	await sleep(500);
	let del_btn = await frame.$('.DeleteButton');
	await del_btn.hover();
	await del_btn.click();

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

	await sleep(1000);
}

console.log("All done!");
process.exit();