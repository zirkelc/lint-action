const { name: actionName } = require("../package");
const { getEnv, getInput, log, run } = require("./utils/action");
const request = require("./utils/request");

const ANNOTATION_LEVELS = ["notice", "warning", "failure"];

/**
 * Returns information about the GitHub repository and action trigger event
 *
 * @returns {{actor: string, ref: string, workspace: string, eventName: string, repository: string,
 * sha: string, token: string, username: string}}: Object information about the GitHub repository
 * and action trigger event
 */
function getGithubInfo() {
	// Information provided by environment
	const actor = getEnv("github_actor");
	const eventName = getEnv("github_event_name");
	const ref = getEnv("github_ref");
	const sha = getEnv("github_sha");
	const [username, repository] = getEnv("github_repository").split("/");
	const workspace = getEnv("github_workspace");

	// Information provided by action user
	const token = getInput("github_token", true);

	return {
		actor,
		eventName,
		ref,
		repository,
		sha,
		token,
		username,
		workspace,
	};
}

/**
 * Creates a new check on GitHub which annotates the relevant commit with linting errors
 *
 * @param checkName {string}: Name which will be displayed in the check list
 * @param github {{actor: string, ref: string, workspace: string, eventName: string, repository:
 * string, sha: string, token: string, username: string}}: Object information about the GitHub
 * repository and action trigger event
 * @param results {object[]}: Results from the linter execution
 */
async function createCheck(checkName, github, results) {
	let annotations = [];
	for (let level = 0; level < 3; level += 1) {
		annotations = [
			...annotations,
			...results[level].map(result => ({
				path: result.path,
				start_line: result.firstLine,
				end_line: result.lastLine,
				annotation_level: ANNOTATION_LEVELS[level],
				message: result.message,
			})),
		];
	}

	// Only use the first 50 annotations (limit for a single API request)
	if (annotations.length > 50) {
		log(
			`There are more than 50 errors/warnings from ${checkName}. Annotations are created for the first 50 results only.`,
		);
		annotations = annotations.slice(0, 50);
	}

	const body = {
		name: checkName,
		head_sha: github.sha,
		conclusion: annotations.length === 0 ? "success" : "failure",
		output: {
			title: checkName,
			summary: `${checkName} found ${annotations.length === 0 ? "no" : annotations.length} issue${
				annotations.length !== 1 ? "s" : ""
			}`,
			annotations,
		},
	};

	try {
		await request(
			`https://api.github.com/repos/${github.username}/${github.repository}/check-runs`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					// "Accept" header is required to access Checks API during preview period
					Accept: "application/vnd.github.antiope-preview+json",
					Authorization: `Bearer ${github.token}`,
					"User-Agent": actionName,
				},
				body,
			},
		);
	} catch (err) {
		log(err, "error");
		throw new Error(
			`Error trying to create "${checkName}" annotations using GitHub API: ${err.message}`,
		);
	}
}

/**
 * Stages and commits all changes using Git
 *
 * @param message {string}: Git commit message
 */
function commitChanges(message) {
	// Check diff and only create a commit if there are changes (command will fail otherwise)
	run(`(git diff --quiet && git diff --staged --quiet) || git commit -am "${message}"`);
}

/**
 * Pushes all changes to the GitHub repository
 *
 * @param github {{actor: string, ref: string, workspace: string, eventName: string, repository:
 * string, sha: string, token: string, username: string}}: Object information about the GitHub
 * repository and action trigger event
 */
function pushChanges(github) {
	const remote = `https://${github.actor}:${github.token}@github.com/${github.username}/${github.repository}.git`;
	run(`git push "${remote}" HEAD:${github.ref} --follow-tags`);
}

/**
 * Updates the global Git configuration with the provided information
 *
 * @param name {string}: Git user name
 * @param email {string}: Git email address
 */
function setGitUserInfo(name, email) {
	run(`git config --global user.name "${name}"`);
	run(`git config --global user.email "${email}"`);
}

module.exports = {
	commitChanges,
	createCheck,
	getGithubInfo,
	pushChanges,
	setGitUserInfo,
};
