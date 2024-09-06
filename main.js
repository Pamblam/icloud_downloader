import puppeteer from 'puppeteer';
import { iCloudLogin } from './iCloudLogin.js';
import {getDisks, chooseDownloadDrive} from './getDisks.js';
import fs from "fs";
import { prompt, writeOverLine } from "./readlineInterface.js";
import { sleep } from "./sleep.js";
import { waitForDownload } from './waitForDownload.js';

let disks = await getDisks();
let location = await chooseDownloadDrive(disks);
if(location === false){
	console.log('Invalid selection');
	process.exit();
}

let path = await prompt("Enter the path to the folder you want to save files to: ");
let fullpath = `${location}/${path}`.replaceAll('//', '/');
if(!fs.existsSync(fullpath) || !fs.lstatSync(fullpath).isDirectory()){
	console.log(`Path (${fullpath}) either does not exist or is not a directory.`);
	process.exit();
}

const browser = await puppeteer.launch({headless: false});
const page = await browser.newPage();

let login_success = await iCloudLogin(page);

if(!login_success){
	console.log('Unable to login.');
	process.exit();
}

console.log('Login success!');

// Open the photos page
await page.goto('https://www.icloud.com/photos/');

// Set the download location.
const client = await page.createCDPSession();
await client.send('Page.setDownloadBehavior', {
	behavior: 'allow',
	downloadPath: fullpath,
});

// Get the reference to the frame
const frame_handle = await page.waitForSelector('iframe.child-application');
const frame = await frame_handle.contentFrame();

// Get the box that contains all the images and scroll it to the top
await frame.waitForSelector('.grid-scroll');
await frame.evaluate(()=>{
	document.querySelector('.grid-scroll').scrollTo(0, 0);
});

// Get all the grid items
let grid_items = await frame.$$('.grid-item');
let total_items = grid_items.length;
let completed_items = 0;

if(!total_items){
	console.log('Nothing left to downlaod.');
	process.exit();
}

// Press shift and select the first 6 items
let items_to_process = Math.min(total_items, 6);
await page.keyboard.down('Shift');
for(let i=0; i<items_to_process; i++){
	await grid_items[i].click();
	await sleep(500);
}
await page.keyboard.up('Shift');
await sleep(500);

// Wait for the meatball, which is loaded when the photo items are ready
await grid_items[0].hover();
await frame.waitForSelector('.grid-item:nth-of-type(1) .ContextMeatballButton');

let dl_btn = await frame.$('.DownloadButton');
await dl_btn.hover();
await dl_btn.click();

// wait for the download to finish rendering.
console.log('Starting Download...');
await waitForDownload(browser, page, (status)=>{
	writeOverLine(`Downloading ${completed_items+1}-${completed_items+items_to_process} of ${total_items}: ${status}`);
});
console.log(''); // To create a new line

// Delete the ones we just downloaded.
await sleep(500);
let del_btn = await frame.$('.DeleteButton');
await del_btn.hover();
await del_btn.click();

console.log('waiting for button');
let confirm_delete_btn = await frame.waitForSelector('.destructive');
await sleep(500);

console.log('hovering');
await confirm_delete_btn.hover();
await sleep(500);

console.log('clicking');
await confirm_delete_btn.click();
await sleep(500);

await (function waitForDelete(total_grid_items){
	return new Promise(resolve=>{
		const checkItemCount = async ()=>{
			let grid_items = await frame.$$('.grid-item');
			if(grid_items.length === total_grid_items){
				console.log('not yuet...');
				setTimeout(checkItemCount, 500);
			}else{
				resolve();
			}
		};
		checkItemCount();
	});
})(total_items);

console.log('Items deleted');