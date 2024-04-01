/* ========================================================================
 
                        1. github-issues-sync-with-notion
                        2. github-pull-request-sync-with-notion
                        3. github-discussion-sync-with-notion
                        
======================================================================== */

const githubDiscussionSyncWithNotion = require("./github-with-notion/github-discussion-sync-with-notion");
const githubIssueSyncWithNotion = require("./github-with-notion/github-issue-sync-with-notion");
const githubPullRequestSyncWithNotion = require("./github-with-notion/github-pull-request-sync-with-notion");

async function main() {
  await githubIssueSyncWithNotion();
  await githubDiscussionSyncWithNotion();
  await githubPullRequestSyncWithNotion();
}

main();
