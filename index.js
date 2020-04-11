const fs = require('fs');
const request = require('request');
const https = require('https');
const {promisify} = require('util');
const app = require('express')();

const POST = promisify(request.post);
const GET = promisify(request.get);

const config = JSON.parse(fs.readFileSync('config.json').toString());
const port = config.port || 3322;

var scoreboard = Array.from({length: config.games.length}, x => []);
try {
	scoreboard = JSON.parse(fs.readFileSync('scoreboard.json').toString());
} catch (e) {
	saveScoreboard();
}
function saveScoreboard() {
	fs.writeFileSync('scoreboard.json', JSON.stringify(scoreboard, null, '\t'));
}

app.use((req, res, next) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	next();
});

let proofedAccounts = {};
app.post('/auth', async (req, res) => {
	let code = req.query.code;
	if (typeof code !== 'string')
		return req.status(400).end();

	let token = randomString();

	let authData = await POST('https://id.twitch.tv/oauth2/token?'+
					'client_id='+config.auth.client_id + '&' +
					'client_secret='+config.auth.client_secret + '&' + 
					'code='+encodeURIComponent(code) + '&' + 
					'grant_type=authorization_code&' +
					'redirect_uri='+encodeURIComponent(config.auth.redirect_uri));
	let authBody = JSON.parse(authData.body);
	let access_token = authBody.access_token;

	if (!access_token) {
		console.error('/oauth2/token', authBody);
		return res.status(500).end();
	}

	let userData = await GET({
		uri: 'https://api.twitch.tv/helix/users',
		headers: {
			'Authorization': 'Bearer ' + access_token
		}
	});
	let userBody = JSON.parse(userData.body);
	if (!userBody.data) {
		console.error('/users/', userBody);
		return res.status(500).end();
	}

	let users = userBody.data.map(user => ({
		image: user.profile_image_url,
		name: user.display_name,
		id: user.id,
		link: 'https://twitch.tv/' + user.login + '/'
	}));

	proofedAccounts[token] = users;

	res.json({
		token, users
	}).end();
});
app.post('/fast-auth', (req, res) => {
	let code = req.query.code;
	if (typeof code !== 'string')
		return res.status(400).end();

	if (typeof proofedAccounts[code] === 'undefined')
		return res.status(404).end();

	res.status(200).json(proofedAccounts[code]);
});

app.get('/board', (req, res) => {
	res.status(200).json({
		board: scoreboard.map(board => 
			board.slice(0, 10).map(element => ({
				place: element.place,
				name: element.name,
				score: element.score,
				image: element.image,
				link: element.link,
				proof: element.proof
			}))
		),
		games: config.games
	});
});

app.post('/upload', (req, res) => {
	let {game, score, user, code} = req.query;
	let proofLink = req.query.proof;
	if (typeof game !== 'string' ||
		typeof score !== 'string' ||
		typeof user !== 'string' ||
		typeof code !== 'string' ||
		typeof proofLink !== 'string')
		return res.status(400).end();

	game = parseInt(game);
	score = parseFloat(score);
	if (isNaN(game) || isNaN(score) ||
		game < 0 || game >= config.games.length ||
		score < 0)
		return res.status(400).end();

	let proof = proofedAccounts[code], userIndex;
	if (typeof proof === 'undefined' ||
		(userIndex = proof.findIndex(userData => userData.id == user)) < 0)
		return res.status(403).end();

	let board = scoreboard[game];
	let index;
	if ((index = board.findIndex(el => el.id == user)) >= 0) {
		board[index].score = score;
		board[index].proof = proofLink;
	} else {
		let userObj = proof[userIndex];
		board.push({
			place: 999,
			id: userObj.id,
			name: userObj.name,
			image: userObj.image,
			link: userObj.link,
			score,
			proof: proofLink
		});
	}
	recalculatePlaces(game);
	saveScoreboard();
	return res.status(200).end();
});
function recalculatePlaces(i) {
	let board = scoreboard[i];
	board.sort((a, b) => b.score - a.score);
	for (let j = 0, p = 0; j < board.length; ++j) {
		if (j == 0 || board[j - 1].score > board[j].score)
			p++;
		board[j].place = p;
	}
}

if (config.ssl) {
	let server = https.createServer({
		key: fs.readFileSync(config.ssl.key),
		cert: fs.readFileSync(config.ssl.cert)
	}, app);
	server.listen(port, (err) => {
		if (err)
			throw err;
		console.log("Listening at :" + port + " (https)");
	});
} else {
	app.listen(port, (err) => {
		if (err)
			throw err;
		console.log("Listening at :" + port);
	});
}


function randomString(n = 16, q = 'qwertyuiopasdfghjklzxcvbnm1234567890QWERTYUIOPASDFGHJKLZXCVBNM') {
	return Array.from({length: n}, x => q[Math.round(Math.random() * (q.length - 1))]).join('');
}