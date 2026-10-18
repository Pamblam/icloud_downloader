import { prompt } from "./readlineInterface.js";
import { sleep } from "./sleep.js";
import { withTimeout } from "./withTimeout.js";
import { clickElement } from "./clickElement.js";
import { progress } from "./progress.js";

/**
 * Given a Puppeteer Page object, run through the steps of logging into an iCloud account.
 * @param Page page
 * @param object credentials {email, password}
 * @param function onBadLogin Called when the email/password is rejected; resolves to new {email, password}.
 * @returns Promise<bool>
 */
export async function iCloudLogin(page, credentials, onBadLogin){

	// Navigate to the iCloud site
	progress.start();
	progress.setStep('Signing in', 'opening icloud.com');
	await page.goto('https://www.icloud.com/');
	await page.waitForSelector('.sign-in-button');

	// Click the sign in button and wait for the login iframe
	progress.setDetail('opening the sign-in form');
	const [sign_in_frame_handle] = await Promise.all([
		page.waitForSelector('#aid-auth-widget-iFrame'),
		page.$('.sign-in-button').then(btn=>clickElement(page, btn))
	]);

	// Get a reference to the login iframe
	const sign_in_frame = await sign_in_frame_handle.contentFrame();

	// Wait for the email input field
	await sign_in_frame.waitForSelector('#account_name_text_field');

	// Enter the email
	progress.setDetail('entering email');
	const username_input = await sign_in_frame.$('#account_name_text_field');
	await username_input.type(credentials.email);

	await sleep(1000);

	// Hit enter and wait for the password field
	await Promise.all([
		sign_in_frame.waitForSelector('#password_text_field'),
		username_input.press('Enter')
	]);

	// Sometimes we get this button asking if we want to use a password or a key,
	// If it's there, click it.
	try{
		const continue_btn = await sign_in_frame.waitForSelector('#continue-password', {timeout: 5000});
		await clickElement(page, continue_btn);
	}catch(e){}

	// Enter password and hit enter
	progress.setDetail('entering password');
	const password_input = await sign_in_frame.$('#password_text_field');
	await password_input.type(credentials.password);

	// Wait for either a security code input, or a sign in error
	progress.setDetail('checking email and password');
	await Promise.all([
		Promise.race([
			sign_in_frame.waitForSelector('div.signin-error'),
			sign_in_frame.waitForSelector('.form-security-code-input')
		]),
		password_input.press('Enter')
	]);

	// If we didn't get teh security code input, assume it's a bad login and try again
	let successful_login = !!(await sign_in_frame.$('.form-security-code-input'));
	if(!successful_login){
		progress.stop();
		console.log("Bad login or password. Try again.");
		return await iCloudLogin(page, await onBadLogin(), onBadLogin);
	}

	// Get the security code from the user
	progress.stop();
	let seccode = await prompt("Enter the 6-digit security code: ");
	while(!/^\d{6}$/.test(seccode.trim())){
		console.log("Invalid security code.");
		seccode = await prompt("Enter the 6-digit security code: ");
	}
	seccode = seccode.trim();
	progress.start();
	progress.setStep('Signing in', 'entering security code');

	// Input the security code
	const code_inputs = await sign_in_frame.$$('.form-security-code-input');
	for(let i=0; i<code_inputs.length; i++){
		await code_inputs[i].type(seccode.charAt(i));
		await sleep(150);
	}

	progress.setDetail('checking security code');
	await page.waitForNetworkIdle();
	// If the sign-in frame is already gone, the code was accepted.
	let successful_code = true;
	try{
		successful_code = !(await withTimeout(sign_in_frame.$('[id^="form-security-code-error"]'), 10000));
	}catch(e){}
	if(!successful_code){
		progress.log("Bad security code.");
		return false;
	}

	// If we are prompted to "Trust this Browser," click the submit button to do so.
	// Use a DOM click instead of Puppeteer's click(): that one waits on an IntersectionObserver
	// which never fires in the sign-in iframe and hangs until Runtime.callFunctionOn times out.
	try{
		let prompted_to_trust_browser = await withTimeout(sign_in_frame.evaluate(()=>{
			const btn = document.querySelector('button[type="submit"]');
			if(btn) btn.click();
			return !!btn;
		}), 10000);
		if(prompted_to_trust_browser){
			progress.setDetail('trusting this browser');
			try{ await page.waitForNetworkIdle() }catch(e){};
		}
	}catch(e){} // The sign-in frame may already be gone, which is fine.

	// Confirm the sign-in actually took: the sign-in form goes away and no Sign In button is left.
	progress.setDetail('waiting for iCloud to finish signing in');
	try{
		await page.waitForFunction(
			()=>!document.querySelector('#aid-auth-widget-iFrame') && !document.querySelector('.sign-in-button'),
			{timeout: 30000}
		);
	}catch(e){
		return false;
	}

	return true;
}
