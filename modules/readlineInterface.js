import readline from 'node:readline';

export const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

// readline keeps the terminal in raw mode, so Ctrl-C arrives here instead of killing the process.
rl.on('SIGINT', ()=>{
	process.stdout.write('\n');
	process.exit(130);
});

// Only let readline echo to the terminal while we're asking a question. Otherwise keys pressed
// while the script is working would scribble over the progress display.
// 'idle' swallows everything, 'visible' echoes normally, 'hidden' shows the question but not what's typed.
let echo_mode = 'idle';
let current_question = '';
rl._writeToOutput = function(s){
	if(echo_mode === 'visible'){
		rl.output.write(s);
	}else if(echo_mode === 'hidden' && s.startsWith(current_question)){
		rl.output.write(current_question);
	}
};

const ask = (question, mode) => new Promise(resolve => {
	// Throw away anything typed while we weren't asking.
	rl.write(null, {ctrl: true, name: 'u'});
	echo_mode = mode;
	current_question = question;
	rl.question(question, answer=>{
		if(mode === 'hidden') rl.output.write('\n');
		echo_mode = 'idle';
		resolve(answer);
	});
});

export const prompt = question => ask(question, 'visible');

/**
 * Ask a question, using default_value if the user just presses Enter.
 */
export async function promptWithDefault(question, default_value){
	const hint = default_value ? ` [${default_value}]` : '';
	const answer = (await prompt(`${question}${hint}: `)).trim();
	return answer || default_value || '';
}

/**
 * Ask for a secret without echoing it. If has_saved is true, pressing Enter returns ''
 * so the caller can fall back to the saved value.
 */
export async function promptHidden(question, has_saved = false){
	const hint = has_saved ? ' [press Enter to use saved]' : '';
	return ask(`${question}${hint}: `, 'hidden');
}

/**
 * Ask a yes/no question. Returns default_value if the user just presses Enter.
 */
export async function promptYesNo(question, default_value = false){
	const hint = default_value ? 'Y/n' : 'y/N';
	while(true){
		const answer = (await prompt(`${question} (${hint}): `)).trim().toLowerCase();
		if(!answer) return default_value;
		if(['y', 'yes'].includes(answer)) return true;
		if(['n', 'no'].includes(answer)) return false;
		console.log('Please answer y or n.');
	}
}
