import { prompt } from "./readlineInterface.js";

/**
 * Given a Puppeteer Page object, run through the steps of logging into an iCloud account.
 * @param Page page 
 * @returns Promise<bool>
 */
export async function iCloudLogin(page){

	// Helper function to sleep 
	const sleep = timeout => new Promise(resolve=>setTimeout(resolve, timeout));

	// Navigate to the iCloud site
	await page.goto('https://www.icloud.com/');
	await page.waitForSelector('.sign-in-button');

	// Click the sign in button and wait for the login iframe
	const [sign_in_frame_handle] = await Promise.all([
		page.waitForSelector('#aid-auth-widget-iFrame'),
		page.click('.sign-in-button')
	]);

	// Get a reference to the login iframe
	const sign_in_frame = await sign_in_frame_handle.contentFrame();

	// Wait for the email input field
	await sign_in_frame.waitForSelector('#account_name_text_field');

	// Get the email from the user via command line and enter it
	const username_input = await sign_in_frame.$('#account_name_text_field');
	let email = await prompt("Enter your iCloud email: ");
	await username_input.type(email);

	await sleep(1000);

	// Hit enter and wait for the password field
	await Promise.all([
		sign_in_frame.waitForSelector('#password_text_field'),
		username_input.press('Enter')
	]);

	// Sometimes we get this button asking if we want to use a password or a key,
	// If it's there, click it.
	try{
		await sign_in_frame.waitForSelector('#continue-password');
		await sign_in_frame.click('#continue-password')
	}catch(e){}

	// Enter password and hit enter
	const password_input = await sign_in_frame.$('#password_text_field');
	let password = await prompt("Enter your iCloud password: ");
	await password_input.type(password);

	// Wait for either a security code input, or a sign in error
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
		console.log("Bad login or password. Try again.");
		return await iCloudLogin(page);
	}

	// Get the security code from the user
	let seccode = await prompt("Enter the 6-digit security code: ");
	while(seccode.length !== 6){
		console.log("Invalid security code.");
		seccode = await prompt("Enter the 6-digit security code: ");
	}

	// Input the security code
	const code_inputs = await sign_in_frame.$$('.form-security-code-input');
	for(let i=0; i<code_inputs.length; i++){
		await code_inputs[i].type(seccode.charAt(i));
		await sleep(150);
	}

	await page.waitForNetworkIdle();
	let successful_code = !(await sign_in_frame.$('[id^="form-security-code-error"]'));
	if(!successful_code){
		console.log("Bad security code.");
		return false;
	}

	// If we are prompted to "Trust this Browser," click the submit button to do so
	let prompted_to_trust_browser = !!(await sign_in_frame.$('button[type="submit"]'));
	if(prompted_to_trust_browser){
		await sign_in_frame.click('button[type="submit"]');
		try{ await page.waitForNetworkIdle() }catch(e){};
	}
	
	return true;
}
