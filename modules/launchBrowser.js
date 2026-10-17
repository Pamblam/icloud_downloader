import puppeteer from 'puppeteer';

/**
 * Launch a browser that behaves the same whether or not it's headless.
 * @param bool headless
 * @returns Promise<{browser, page}>
 */
export async function launchBrowser(headless){
	const browser = await puppeteer.launch({
		headless,
		defaultViewport: {width: 1440, height: 900},
		args: [
			'--window-size=1440,900',
			// Keep background tabs/frames rendering and running timers at full speed, otherwise
			// the iCloud tab stalls while chrome://downloads is in front.
			'--disable-background-timer-throttling',
			'--disable-backgrounding-occluded-windows',
			'--disable-renderer-backgrounding',
		],
	});
	const page = await browser.newPage();

	// Headless Chrome advertises itself as "HeadlessChrome", which iCloud can treat differently.
	const user_agent = await browser.userAgent();
	await page.setUserAgent(user_agent.replace('HeadlessChrome', 'Chrome'));

	return {browser, page};
}
