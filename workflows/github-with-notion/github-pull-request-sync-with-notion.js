/* ========================================================================
 
                        github-pull-request-sync-with-notion
                        
======================================================================== */

const { Client } = require("@notionhq/client");
const dotenv = require("dotenv");
const { Octokit } = require("octokit");
const _ = require("lodash");
const { markdownToBlocks } = require("@tryfabric/martian");

dotenv.config();
const octokit = new Octokit({ auth: process.env.PERSONAL_GITHUB_ACCESS_KEY });
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_PR_DATABASE_ID;
const OPERATION_BATCH_SIZE = 10;

/**
 * Local map to store Github Pull Request ID to its Notion pageId.
 * { [pullRequestId: string]: string }
 */

const githubPullRequestIdToNotionPageId = {};

/**
 * Get and set the initial data store with PRs currently in the database.
 */
async function setInitialGithubToNotionIdMap() {
  const currentPullRequests = await getPullRequestsFromNotionDatabase();
  for (const { pageId, prNumber } of currentPullRequests) {
    githubPullRequestIdToNotionPageId[prNumber] = pageId;
  }
}

/**
 * Get pages from the Notion database.
 *
 * @returns {Promise<Array<{ pageId: string, issueNumber: number }>>}
 */
async function getPullRequestsFromNotionDatabase() {
  const pages = [];
  let cursor = undefined;
  while (true) {
    const { results, next_cursor } = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
    });
    pages.push(...results);
    if (!next_cursor) {
      break;
    }

    cursor = next_cursor;
  }
  console.log(`${pages.length} PRs successfully fetched.`);

  const prs = [];
  for (const page of pages) {
    const prNumberPropertyId = page.properties["Pull Request Number"].id;
    const propertyResult = await notion.pages.properties.retrieve({
      page_id: page.id,
      property_id: prNumberPropertyId,
    });
    prs.push({
      pageId: page.id,
      prNumber: propertyResult.number,
    });
  }

  return prs;
}

/**
 * Gets closed PRs from a GitHub repository.
 *
 * https://docs.github.com/en/rest/guides/traversing-with-pagination
 * https://docs.github.com/en/rest/pulls/pulls#list-pull-requests
 * https://octokit.github.io/rest.js/v19#pulls-list
 *
 * @returns {Promise<Array<{ title: string, state: "open" | "closed", number: string, body: string, url: string, requested_reviewers: Array<string>}>>}
 */
async function getGitHubPRsForRepository() {
  const pullRequests = [];
  const iterator = octokit.paginate.iterator(octokit.rest.pulls.list, {
    owner: process.env.REPO_OWNER,
    repo: process.env.REPO_NAME,
    state: "all",
    per_page: 100,
  });
  for await (const { data } of iterator) {
    for (const pr of data) {
      pullRequests.push({
        title: pr.title,
        state: pr.state,
        number: pr.number,
        body: pr.body,
        url: pr.url,
        requested_reviewers: pr.requested_reviewers,
      });
    }
  }

  return pullRequests;
}

/**
 * Determines if a PR is already in the Notion database.
 *
 * @param {Array<{ title: string, state: "open" | "closed", number: string, body: string, url: string, requested_reviewers: Array<string>}>}
 * @returns {{
 *    pageToCreate: Array<{ title: string, state: "open" | "closed", number: string, body: string, url: string, requested_reviewers: Array<string> }>,
 *    pageToUpdate: Array<{ pageId: string, title: string, state: "open" | "closed", number: string, body: string, url: string, requested_reviewers: Array<string> }>
 * }}
 */
function getNotionOperations(pullRequests) {
  const pagesToCreate = [];
  const pagesToUpdate = [];

  for (const pr of pullRequests) {
    const pageId = githubPullRequestIdToNotionPageId[pr.number];
    if (!pageId) {
      pagesToCreate.push(pr);
    } else {
      pagesToUpdate.push({ pageId, ...pr });
    }
  }

  return { pagesToCreate, pagesToUpdate };
}

/**
 * Creates new pages in Notion.
 *
 * @param {Array<{ title: string, state: "open" | "closed", number: string, body: string, url: string, requested_reviewers: Array<string> }>} pagesToCreate
 */
async function createPages(pagesToCreate) {
  const pagesToCreateChunks = _.chunk(pagesToCreate, OPERATION_BATCH_SIZE);
  for (const pagesToCreateBatch of pagesToCreateChunks) {
    await Promise.all(
      pagesToCreateBatch.map(async (pr) => {
        await notion.pages.create({
          parent: { database_id: databaseId },
          properties: getPropertiesFromPullRequest(pr),
          children: [...markdownToBlocks(pr.body)],
        });
      })
    );
  }
  console.log(`Successfully created ${pagesToCreate.length} PR(s) in Notion.`);
}

/**
 * Updates provided pages in Notion.
 *
 * @param {Array<{ pageId: string, title: string, state: "open" | "closed", number: string, body: string, url: string, requested_reviewers: Array<string> }>} pagesToUpdate
 */
async function updatePages(pagesToUpdate) {
  const pagesToUpdateChunks = _.chunk(pagesToUpdate, OPERATION_BATCH_SIZE);
  for (const pagesToUpdateBatch of pagesToUpdateChunks) {
    await Promise.all(
      pagesToUpdateBatch.map(({ pageId, ...pr }) =>
        notion.pages.update({
          page_id: pageId,
          properties: getPropertiesFromPullRequest(pr),
        })
      )
    );
    console.log(`Completed batch size: ${pagesToUpdateBatch.length}`);
  }
}

/**
 * Returns the Github Pull Request to conform to this database's schema properties.
 *
 * @param {{ title: string, state: "open" | "closed", number: string, body: string, url: string, requested_reviewers: Array<string> }} pr
 */
function getPropertiesFromPullRequest(pullRequest) {
  const { title, state, number, body, url, requested_reviewers } = pullRequest;
  return {
    "Pull Request": {
      title: [{ type: "text", text: { content: title } }],
    },
    "Pull Request Number": {
      number,
    },
    State: {
      select: { name: state },
    },
    URL: {
      url,
    },
    "Requested Reviewers": {
      type: "multi_select",
      multi_select: requested_reviewers?.map((reviewer) => ({
        name: reviewer.login,
      })),
    },
  };
}

async function syncNotionDatabaseWithGithub() {
  // Get all pull requests currently in the provided GitHub repository.
  console.log("\nFetching pull requests from GitHub repository...");
  const pullRequests = await getGitHubPRsForRepository();
  console.log(
    `Fetched ${pullRequests.length} pull requests from GitHub repository.`
  );
  const { pagesToCreate, pagesToUpdate } = getNotionOperations(pullRequests);

  // Create pages for new pull requests.
  console.log(`\n${pagesToCreate.length} new pull requests to add to Notion.`);
  if (pagesToCreate.length > 0) {
    await createPages(pagesToCreate);
  }

  // Updates pages for existing pull requests.
  console.log(`\n${pagesToUpdate.length} pull requests to update in Notion.`);
  if (pagesToUpdate.length > 0) {
    await updatePages(pagesToUpdate);
  }

  // Success!
  console.log("\n✅ Notion database is synced with GitHub.");
}

module.exports = async function githubPullRequestSyncWithNotion() {
  console.log("Github PullReqeust Sync With Notion");
  await setInitialGithubToNotionIdMap().then(syncNotionDatabaseWithGithub);
};
