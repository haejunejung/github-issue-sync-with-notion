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
 * Local map to store Github PR ID to its Notion pageId.
 * { [prId: string]: string }
 */

const githubPRIdToNotionPageId = {};

/**
 * Get and set the initial data store with PRs currently in the database.
 */
async function setInitialGithubToNotionIdMap() {
  const currentPRs = await getPRsFromNotionDatabase();
  for (const { pageId, prNumber } of currentPRs) {
    githubPRIdToNotionPageId[prNumber] = pageId;
  }
}

/**
 * Get pages from the Notion database.
 *
 * @returns {Promise<Array<{ pageId: string, issueNumber: number }>>}
 */
async function getPRsFromNotionDatabase() {
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
 * @returns {Promise<Array<{ title: string, task_link: string, state: "open" | "closed", pr_link: string, pr_status: "Closed - Merged | "Closed - Not Merged}>>}
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
      console.log("pr: \n", pr);
      if (pr.body) {
        notionPRLinkMatch = pr.body.match(
          /https:\/\/www\.notion\.so\/([A-Za-z0-9]+(-[A-Za-z0-9]+)+)$/
        );
        if (notionPRLinkMatch && pr.state == "closed") {
          const page_id = notionPRLinkMatch[0]
            .split("-")
            .pop()
            .replaceAll("-", "");

          var status = "";
          var content = "";
          if (pr.merged_at != null) {
            status = "Closed - Merged";
            content = " has been merged!";
          } else {
            status = "Closed - Not Merged";
            content = " was closed but not merged!";
          }

          pullRequests.push({
            task_link: notionPRLinkMatch[0],
            state: pr.state,
            page_id: page_id,
            pr_link: pr.html_url,
            pr_status: status,
            comment_content: content,
          });
        }
      } else {
        console.log("Error: PR body is empty");
      }
    }
    return pullRequests;
  }
}

// /**
//  * Enable to change status property in Notion Database
//  * When enabling this, make sure you have a set the STATUS_FIELD_NAME
//  */
// const UPDATE_STATUS_IN_NOTION_DB = process.env.UPDATE_STATUS_IN_NOTION_DB;
// const STATUS_PROPERTY_NAME = process.env.STATUS_PROPERTY_NAME;

// /**
//  * Entry Point
//  */
// updateNotionDBwithGithubPRs();

// /**
//  * Fetches PRs from Github and updates the according Notion Task
//  */
// async function updateNotionDBwithGithubPRs() {
//   // Get all issues currently in the provided GitHub repository.
//   console.log("\nFetching PRs from GitHub repository...");
//   var prs = await getGitHubPRsForRepository();
//   console.log(`Fetched ${prs.length} closed PR(s) from GitHub repository.`);

//   var prsToUpdate = [];
//   for (var pr of prs) {
//     if (!(await hasIntegrationCommentedOnPage(pr.page_id))) {
//       prsToUpdate.push(pr);
//     }
//   }
//   updatePages(prsToUpdate);
// }

// /**
//  * Returns whether integration has commented
//  * @params page_id: string
//  * @returns {Promise<Boolean>}
//  */
// async function hasIntegrationCommentedOnPage(page_id) {
//   const comments = await notion.comments.list({ block_id: page_id });
//   const bot = await notion.users.me();
//   if (comments.results) {
//     for (const comment of comments.results) {
//       if (comment.created_by.id === bot.id) {
//         return true;
//       }
//     }
//   }
//   return false;
// }

// /***
//  *
//  * @param pagesToUpdate: [pages]
//  * @returns Promise
//  */
// async function updatePages(pagesToUpdate) {
//   const pagesToUpdateChunks = _.chunk(pagesToUpdate, OPERATION_BATCH_SIZE);
//   for (const pagesToUpdateBatch of pagesToUpdateChunks) {
//     //Update page status property
//     if (UPDATE_STATUS_IN_NOTION_DB) {
//       await Promise.all(
//         pagesToUpdateBatch.map(({ ...pr }) =>
//           //Update Notion Page status
//           notion.pages.update({
//             page_id: pr.page_id,
//             properties: {
//               [STATUS_PROPERTY_NAME]: {
//                 status: {
//                   name: pr.pr_status,
//                 },
//               },
//             },
//           })
//         )
//       );
//     }
//     //Write Comment
//     await Promise.all(
//       pagesToUpdateBatch.map(({ pageId, ...pr }) =>
//         notion.comments.create({
//           parent: {
//             page_id: pr.page_id,
//           },
//           rich_text: [
//             {
//               type: "text",
//               text: {
//                 content: "Your PR",
//                 link: {
//                   url: pr.pr_link,
//                 },
//               },
//               annotations: {
//                 bold: true,
//               },
//             },
//             {
//               type: "text",
//               text: {
//                 content: pr.comment_content,
//               },
//             },
//           ],
//         })
//       )
//     );
//   }
//   if (pagesToUpdate.length == 0) {
//     console.log("Notion Tasks are already up-to-date");
//   } else {
//     console.log(
//       "Successfully updated " + pagesToUpdate.length + " task(s) in Notion"
//     );
//   }
// }

module.exports = async function githubPullRequestSyncWithNotion() {
  console.log("Github PullReqeust Sync With Notion");
  await setInitialGithubToNotionIdMap().then(getGitHubPRsForRepository);
};
